export type ScheduledJobRunStatus =
  | 'scheduled'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'timed_out'
  | 'exhausted'
  | 'missed';

export interface ScheduledJobRun {
  id: string;
  job_key: string;
  scheduled_window_start: string;
  scheduled_window_end: string;
  status: ScheduledJobRunStatus;
  attempt_count: number;
  max_attempts: number;
  lease_owner: string | null;
  lease_expires_at: string | null;
  started_at: string | null;
}

export interface ScheduledJobCompletion {
  runId: string;
  workerId: string;
  status: 'succeeded' | 'failed' | 'timed_out';
  processedCount?: number;
  failedCount?: number;
  skippedCount?: number;
  errorClass?: string;
  errorMessage?: string;
  resultSummary?: Record<string, unknown>;
}

export interface TimedOutScheduledJobSettlement {
  runId: string;
  workerId: string;
  lateOutcome: 'completed' | 'failed';
}
