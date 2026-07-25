import { getSupabase } from '../clients/supabase.client';
import {
  ScheduledJobCompletion,
  ScheduledJobRun,
  TimedOutScheduledJobSettlement,
} from '../types/durable-scheduled-job.types';

function firstRow<T>(data: unknown): T | null {
  if (Array.isArray(data)) return (data[0] as T | undefined) || null;
  return (data as T | null) || null;
}

export const durableScheduledJobRepository = {
  async claim(input: {
    jobKey: string;
    windowStart: string;
    windowEnd: string;
    workerId: string;
    leaseSeconds: number;
    maxAttempts: number;
  }): Promise<ScheduledJobRun | null> {
    const { data, error } = await getSupabase().rpc('claim_scheduled_job_run', {
      p_job_key: input.jobKey,
      p_window_start: input.windowStart,
      p_window_end: input.windowEnd,
      p_worker_id: input.workerId,
      p_lease_seconds: input.leaseSeconds,
      p_max_attempts: input.maxAttempts,
    });
    if (error) throw error;
    return firstRow<ScheduledJobRun>(data);
  },

  async complete(input: ScheduledJobCompletion): Promise<void> {
    const { error } = await getSupabase().rpc('complete_scheduled_job_run', {
      p_run_id: input.runId,
      p_worker_id: input.workerId,
      p_status: input.status,
      p_processed_count: input.processedCount || 0,
      p_failed_count: input.failedCount || 0,
      p_skipped_count: input.skippedCount || 0,
      p_error_class: input.errorClass || null,
      p_error_message: input.errorMessage || null,
      p_result_summary: input.resultSummary || {},
    });
    if (error) throw error;
  },

  async settleTimedOut(input: TimedOutScheduledJobSettlement): Promise<void> {
    const { error } = await getSupabase().rpc(
      'settle_timed_out_scheduled_job_run',
      {
        p_run_id: input.runId,
        p_worker_id: input.workerId,
        p_late_outcome: input.lateOutcome,
      },
    );
    if (error) throw error;
  },
};
