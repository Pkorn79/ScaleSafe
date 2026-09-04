import crypto from 'crypto';
import { durableScheduledJobRepository } from '../repositories/durable-scheduled-job.repository';
import { logger } from '../utils/logger';
import { classifyCommandCenterError } from './command-center-health.service';

export interface DurableJobResult {
  processedCount?: number;
  failedCount?: number;
  skippedCount?: number;
  summary?: Record<string, unknown>;
}

export interface DurableScheduledJobTaskContext {
  runId: string;
  workerId: string;
  windowStart: string;
  windowEnd: string;
}

type SettledDurableTaskOutcome =
  | { kind: 'completed'; result: DurableJobResult }
  | { kind: 'failed'; error: unknown };

type DurableTaskOutcome =
  | SettledDurableTaskOutcome
  | {
    kind: 'timed_out';
    settlement: Promise<SettledDurableTaskOutcome>;
  };

export interface DurableScheduledJobOptions {
  jobKey: string;
  cadenceMs: number;
  leaseSeconds: number;
  timeoutMs: number;
  maxAttempts?: number;
  initialDelayMs?: number;
  retryProbeMs?: number;
  task: (context: DurableScheduledJobTaskContext) => Promise<DurableJobResult>;
  now?: () => Date;
}

function scheduledWindow(now: Date, cadenceMs: number): { start: Date; end: Date } {
  const startMs = Math.floor(now.getTime() / cadenceMs) * cadenceMs;
  return {
    start: new Date(startMs),
    end: new Date(startMs + cadenceMs),
  };
}

export class DurableScheduledJob {
  private readonly workerId: string;
  private readonly options: Required<Omit<DurableScheduledJobOptions, 'maxAttempts' | 'initialDelayMs' | 'retryProbeMs' | 'now'>>
    & Pick<DurableScheduledJobOptions, 'maxAttempts' | 'initialDelayMs' | 'retryProbeMs' | 'now'>;
  private timer: NodeJS.Timeout | null = null;
  private started = false;
  private running = false;

  constructor(options: DurableScheduledJobOptions) {
    if (
      options.cadenceMs < 60_000
      || options.leaseSeconds < 30
      || options.timeoutMs < 1_000
      || options.timeoutMs >= options.leaseSeconds * 1000
    ) {
      throw new Error(`Invalid durable schedule for ${options.jobKey}`);
    }
    this.options = options;
    this.workerId = `job_${options.jobKey.replace(/[^a-z0-9]+/gi, '_')}_${process.pid}_${crypto.randomBytes(4).toString('hex')}`;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.schedule(this.options.initialDelayMs ?? 15_000);
  }

  stop(): void {
    this.started = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  async runOnce(): Promise<void> {
    await this.execute();
  }

  private schedule(delayMs: number): void {
    if (!this.started) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.execute(), Math.max(1_000, delayMs));
    this.timer.unref();
  }

  private nextDelay(now: Date, windowEnd: Date, retry = false): number {
    if (retry) return this.options.retryProbeMs ?? 5 * 60_000;
    const untilNextWindow = Math.max(1_000, windowEnd.getTime() - now.getTime() + 1_000);
    return Math.min(this.options.retryProbeMs ?? 5 * 60_000, untilNextWindow);
  }

  private async runTaskWithTimeout(
    context: DurableScheduledJobTaskContext,
  ): Promise<DurableTaskOutcome> {
    let timeout: NodeJS.Timeout | null = null;
    const taskOutcome: Promise<SettledDurableTaskOutcome> = this.options.task(context)
      .then((result): SettledDurableTaskOutcome => ({ kind: 'completed', result }))
      .catch((error): SettledDurableTaskOutcome => ({ kind: 'failed', error }));
    const timeoutOutcome = new Promise<{ kind: 'timed_out' }>((resolve) => {
      timeout = setTimeout(
        () => resolve({ kind: 'timed_out' }),
        this.options.timeoutMs,
      );
    });

    const outcome = await Promise.race([taskOutcome, timeoutOutcome]);
    if (timeout) clearTimeout(timeout);
    return outcome.kind === 'timed_out'
      ? { ...outcome, settlement: taskOutcome }
      : outcome;
  }

  private observeTimedOutSettlement(
    runId: string,
    settlement: Extract<DurableTaskOutcome, { kind: 'timed_out' }>['settlement'],
  ): void {
    void settlement.then(async (lateOutcome) => {
      try {
        await durableScheduledJobRepository.settleTimedOut({
          runId,
          workerId: this.workerId,
          lateOutcome: lateOutcome.kind,
        });
      } catch (error) {
        const classified = classifyCommandCenterError(error);
        logger.error(
          {
            jobKey: this.options.jobKey,
            errorClass: classified.errorClass,
          },
          'Timed-out scheduled job settlement could not be recorded',
        );
      }
    });
  }

  private async execute(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const now = (this.options.now || (() => new Date()))();
    const window = scheduledWindow(now, this.options.cadenceMs);
    let retryCurrentWindow = false;

    try {
      const run = await durableScheduledJobRepository.claim({
        jobKey: this.options.jobKey,
        windowStart: window.start.toISOString(),
        windowEnd: window.end.toISOString(),
        workerId: this.workerId,
        leaseSeconds: this.options.leaseSeconds,
        maxAttempts: this.options.maxAttempts ?? 3,
      });
      if (!run) return;

      const startedAt = Date.now();
      try {
        const outcome = await this.runTaskWithTimeout({
          runId: run.id,
          workerId: this.workerId,
          windowStart: window.start.toISOString(),
          windowEnd: window.end.toISOString(),
        });
        if (outcome.kind === 'failed') throw outcome.error;
        if (outcome.kind === 'timed_out') {
          await durableScheduledJobRepository.complete({
            runId: run.id,
            workerId: this.workerId,
            status: 'timed_out',
            errorClass: 'JOB_TIMEOUT',
            errorMessage: 'The job exceeded its approved execution window.',
          });
          logger.error(
            {
              jobKey: this.options.jobKey,
              durationMs: Date.now() - startedAt,
              errorClass: 'JOB_TIMEOUT',
            },
            'Durable scheduled job timed out',
          );
          this.observeTimedOutSettlement(run.id, outcome.settlement);
          return;
        }

        const result = outcome.result;
        await durableScheduledJobRepository.complete({
          runId: run.id,
          workerId: this.workerId,
          status: 'succeeded',
          processedCount: result.processedCount,
          failedCount: result.failedCount,
          skippedCount: result.skippedCount,
          resultSummary: result.summary,
        });
      } catch (error) {
        retryCurrentWindow = true;
        const classified = classifyCommandCenterError(error);
        await durableScheduledJobRepository.complete({
          runId: run.id,
          workerId: this.workerId,
          status: 'failed',
          errorClass: classified.errorClass,
          errorMessage: classified.safeMessage,
        });
        logger.error(
          { jobKey: this.options.jobKey, errorClass: classified.errorClass },
          'Durable scheduled job failed',
        );
      }
    } catch (error) {
      retryCurrentWindow = true;
      const classified = classifyCommandCenterError(error);
      logger.error(
        { jobKey: this.options.jobKey, errorClass: classified.errorClass },
        'Durable scheduled job coordination failed',
      );
    } finally {
      this.running = false;
      if (this.started) {
        const completedAt = (this.options.now || (() => new Date()))();
        this.schedule(this.nextDelay(completedAt, window.end, retryCurrentWindow));
      }
    }
  }
}
