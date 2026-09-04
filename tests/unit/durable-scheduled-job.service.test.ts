const claimScheduledJob = jest.fn();
const completeScheduledJob = jest.fn();
const settleTimedOutScheduledJob = jest.fn();

jest.mock('../../src/repositories/durable-scheduled-job.repository', () => ({
  durableScheduledJobRepository: {
    claim: (...args: unknown[]) => claimScheduledJob(...args),
    complete: (...args: unknown[]) => completeScheduledJob(...args),
    settleTimedOut: (...args: unknown[]) => settleTimedOutScheduledJob(...args),
  },
}));

jest.mock('../../src/utils/logger', () => ({
  logger: {
    error: jest.fn(),
  },
}));

jest.mock('../../src/services/command-center-health.service', () => ({
  classifyCommandCenterError: () => ({
    errorClass: 'WORKER_TICK_FAILED',
    safeMessage: 'The worker tick failed.',
  }),
}));

import {
  DurableJobResult,
  DurableScheduledJob,
} from '../../src/services/durable-scheduled-job.service';

const claimedRun = {
  id: 'run-1',
  job_key: 'job.test',
  scheduled_window_start: '2026-07-23T12:00:00.000Z',
  scheduled_window_end: '2026-07-23T13:00:00.000Z',
  status: 'running',
  attempt_count: 1,
  max_attempts: 3,
  lease_owner: 'worker',
  lease_expires_at: '2026-07-23T12:12:00.000Z',
  started_at: '2026-07-23T12:00:00.000Z',
};

describe('DurableScheduledJob', () => {
  beforeEach(() => {
    jest.useRealTimers();
    claimScheduledJob.mockReset();
    completeScheduledJob.mockReset();
    settleTimedOutScheduledJob.mockReset();
    completeScheduledJob.mockResolvedValue(undefined);
    settleTimedOutScheduledJob.mockResolvedValue(undefined);
  });

  it('records a completed run with item failures for health evaluation', async () => {
    claimScheduledJob.mockResolvedValue(claimedRun);
    const task = jest.fn().mockResolvedValue({
      processedCount: 8,
      failedCount: 1,
      skippedCount: 2,
      summary: { sent: 5 },
    });
    const job = new DurableScheduledJob({
      jobKey: 'job.test',
      cadenceMs: 60 * 60_000,
      timeoutMs: 60_000,
      leaseSeconds: 120,
      now: () => new Date('2026-07-23T12:34:56.000Z'),
      task,
    });

    await job.runOnce();

    expect(claimScheduledJob).toHaveBeenCalledWith(expect.objectContaining({
      jobKey: 'job.test',
      windowStart: '2026-07-23T12:00:00.000Z',
      windowEnd: '2026-07-23T13:00:00.000Z',
    }));
    expect(task).toHaveBeenCalledTimes(1);
    expect(completeScheduledJob).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-1',
      status: 'succeeded',
      processedCount: 8,
      failedCount: 1,
      skippedCount: 2,
      resultSummary: { sent: 5 },
    }));
  });

  it('does not execute the task when another instance owns or completed the window', async () => {
    claimScheduledJob.mockResolvedValue(null);
    const task = jest.fn();
    const job = new DurableScheduledJob({
      jobKey: 'job.test',
      cadenceMs: 5 * 60_000,
      timeoutMs: 60_000,
      leaseSeconds: 120,
      task,
    });

    await job.runOnce();

    expect(task).not.toHaveBeenCalled();
    expect(completeScheduledJob).not.toHaveBeenCalled();
  });

  it('records a sanitized failed run for a task exception', async () => {
    claimScheduledJob.mockResolvedValue(claimedRun);
    const job = new DurableScheduledJob({
      jobKey: 'job.test',
      cadenceMs: 5 * 60_000,
      timeoutMs: 60_000,
      leaseSeconds: 120,
      task: async () => {
        throw new Error('raw private failure');
      },
    });

    await job.runOnce();

    expect(completeScheduledJob).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      errorClass: 'WORKER_TICK_FAILED',
      errorMessage: 'The worker tick failed.',
    }));
    expect(JSON.stringify(completeScheduledJob.mock.calls)).not.toContain('raw private failure');
  });

  it('records a real timeout when the task never settles', async () => {
    jest.useFakeTimers();
    claimScheduledJob.mockResolvedValue(claimedRun);
    const task = jest.fn(() => new Promise<never>(() => undefined));
    const job = new DurableScheduledJob({
      jobKey: 'job.test',
      cadenceMs: 5 * 60_000,
      timeoutMs: 1_000,
      leaseSeconds: 30,
      task,
    });

    const execution = job.runOnce();
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(1_001);
    await execution;

    expect(task).toHaveBeenCalledTimes(1);
    expect(completeScheduledJob).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-1',
      status: 'timed_out',
      errorClass: 'JOB_TIMEOUT',
      errorMessage: 'The job exceeded its approved execution window.',
    }));
    expect(settleTimedOutScheduledJob).not.toHaveBeenCalled();
  });

  it('releases durable timeout quarantine only after the original task settles', async () => {
    jest.useFakeTimers();
    claimScheduledJob.mockResolvedValue(claimedRun);
    let release: (() => void) | undefined;
    const task = jest.fn(() => new Promise<DurableJobResult>((resolve) => {
      release = () => resolve({ processedCount: 1 });
    }));
    const job = new DurableScheduledJob({
      jobKey: 'job.test',
      cadenceMs: 5 * 60_000,
      timeoutMs: 1_000,
      leaseSeconds: 30,
      task,
    });

    const execution = job.runOnce();
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(1_001);
    await execution;
    expect(settleTimedOutScheduledJob).not.toHaveBeenCalled();

    release?.();
    await jest.advanceTimersByTimeAsync(0);
    expect(settleTimedOutScheduledJob).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-1',
      lateOutcome: 'completed',
    }));
  });

  it('rejects a timeout that is not shorter than the lease', () => {
    expect(() => new DurableScheduledJob({
      jobKey: 'job.test',
      cadenceMs: 5 * 60_000,
      timeoutMs: 120_000,
      leaseSeconds: 120,
      task: async () => ({}),
    })).toThrow('Invalid durable schedule');
  });
});
