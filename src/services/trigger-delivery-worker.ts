import crypto from 'crypto';
import { getSupabase } from '../clients/supabase.client';
import { ghlApi } from '../clients/ghl.client';
import { logger } from '../utils/logger';
import { AdaptivePoller } from '../utils/adaptive-poller';
import { commandCenterHealthService } from './command-center-health.service';
import { triggerService } from './trigger.service';
import type { TriggerDeliveryJob } from './trigger-delivery-job.service';

const workerId = `trigger_${process.pid}_${crypto.randomBytes(6).toString('hex')}`;
let running = false;

async function claimJobs(limit = 5): Promise<TriggerDeliveryJob[]> {
  const { data, error } = await getSupabase().rpc('claim_trigger_delivery_jobs', {
    p_limit: limit,
    p_worker_id: workerId,
    p_lease_seconds: 180,
  });
  if (error) {
    if (error.code === '42883' || String(error.message || '').includes('claim_trigger_delivery_jobs')) {
      throw new Error('Trigger delivery worker requires migration 099.');
    }
    throw error;
  }
  return (data || []) as TriggerDeliveryJob[];
}

async function updateClaimedJob(job: TriggerDeliveryJob, updates: Record<string, unknown>): Promise<void> {
  const { error } = await getSupabase()
    .from('trigger_delivery_jobs')
    .update({
      ...updates,
      lease_owner: null,
      lease_expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', job.id)
    .eq('location_id', job.location_id)
    .eq('lease_owner', workerId);
  if (error) throw error;
  commandCenterHealthService.markMerchantDirty(job.location_id, 'trigger_delivery_changed');
}

async function retryFieldSync(job: TriggerDeliveryJob, error: Error): Promise<void> {
  const finalAttempt = Number(job.attempt_count || 0) >= Number(job.max_attempts || 3);
  const delaySeconds = Math.min(120, 10 * Math.pow(2, Math.max(0, Number(job.attempt_count || 1) - 1)));
  await updateClaimedJob(job, finalAttempt
    ? {
      status: 'failed',
      completed_at: new Date().toISOString(),
      error_message: `Contact field sync failed after ${job.attempt_count} attempts: ${error.message}`,
    }
    : {
      status: 'pending',
      available_at: new Date(Date.now() + delaySeconds * 1000).toISOString(),
      error_message: `Contact field sync will retry: ${error.message}`,
    });
}

async function processJob(job: TriggerDeliveryJob): Promise<void> {
  if (job.contact_id && job.contact_field_updates && Object.keys(job.contact_field_updates).length > 0) {
    try {
      const api = await ghlApi(job.location_id);
      await api.put(`/contacts/${job.contact_id}`, { customField: job.contact_field_updates });
    } catch (err: any) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.warn(
        { err: error.message, jobId: job.id, locationId: job.location_id, triggerKey: job.trigger_key },
        'Queued trigger contact field sync failed before delivery',
      );
      await retryFieldSync(job, error);
      return;
    }
  }

  try {
    const result = await triggerService.fireTrigger(job.location_id, job.trigger_key, job.payload || {});
    const completedAt = new Date().toISOString();
    if (result.sent > 0 && result.failed === 0) {
      await updateClaimedJob(job, {
        status: 'succeeded',
        completed_at: completedAt,
        trigger_result: result,
        error_message: null,
      });
      return;
    }

    if (result.sent > 0 && result.failed > 0) {
      await updateClaimedJob(job, {
        status: 'unknown',
        completed_at: completedAt,
        trigger_result: result,
        error_message: 'Some GHL subscriptions accepted the event while others failed; automatic replay was disabled to prevent duplicates.',
      });
      return;
    }

    await updateClaimedJob(job, {
      status: 'failed',
      completed_at: completedAt,
      trigger_result: result,
      error_message: result.failed > 0
        ? 'GHL rejected the trigger delivery.'
        : 'No active GHL workflow subscription accepted this trigger.',
    });
  } catch (err: any) {
    const message = err instanceof Error ? err.message : String(err);
    // Once fireTrigger begins, the provider boundary is ambiguous. Never
    // replay automatically: GHL may have accepted the request before failure.
    await updateClaimedJob(job, {
      status: 'unknown',
      completed_at: new Date().toISOString(),
      error_message: `Trigger delivery outcome is unknown; manual review is required before replay. ${message}`,
    });
    logger.error(
      { err: message, jobId: job.id, locationId: job.location_id, triggerKey: job.trigger_key },
      'Queued trigger delivery outcome is unknown',
    );
  }
}

async function tick(): Promise<number> {
  if (running) return 0;
  running = true;
  const startedAt = new Date();
  let workCount = 0;
  let tickError: unknown;
  try {
    const jobs = await claimJobs(5);
    await Promise.all(jobs.map(processJob));
    workCount = jobs.length;
    return workCount;
  } catch (err: any) {
    tickError = err;
    logger.error({ err: err?.message || String(err) }, 'Trigger delivery worker tick failed');
    return 0;
  } finally {
    running = false;
    commandCenterHealthService.recordWorkerTick({
      workerKey: 'worker.trigger_delivery',
      instanceId: workerId,
      startedAt,
      workCount,
      error: tickError,
    });
  }
}

const poller = new AdaptivePoller({
  task: tick,
  taskTimeoutMs: commandCenterHealthService.workerTimeoutMs('worker.trigger_delivery'),
  onTimeout: ({ startedAt, timedOutAt }) => commandCenterHealthService.recordWorkerTick({
    workerKey: 'worker.trigger_delivery',
    instanceId: workerId,
    startedAt,
    completedAt: timedOutAt,
    workCount: 0,
    timedOut: true,
  }),
});

export const triggerDeliveryWorker = {
  start(): void {
    poller.start();
  },
  async runOnce(): Promise<void> {
    await tick();
  },
  wake(): void {
    poller.wake();
  },
  stop(): void {
    poller.stop();
  },
};
