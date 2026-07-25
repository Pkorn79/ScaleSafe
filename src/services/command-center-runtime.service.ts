import { runDailyHealthCheck } from '../jobs/daily-health-check';
import { runPaymentReminderCheck } from '../jobs/payment-reminder-check';
import { runPifCompletionCheck } from '../jobs/pif-completion-check';
import { runPulseCadenceCheck } from '../jobs/pulse-cadence-check';
import { runProvisioningRecovery } from '../jobs/provisioning-recovery';
import { commandCenterHealthRepository } from '../repositories/command-center-health.repository';
import { COMMAND_CENTER_HEALTH_SCHEMA_VERSION } from './schema-readiness.service';
import { DurableScheduledJob } from './durable-scheduled-job.service';
import { applicationMetricsService } from './application-metrics.service';
import { commandCenterHealthService } from './command-center-health.service';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const merchantHealthWorkerId = `merchant_health_${process.pid}`;

const jobs = [
  new DurableScheduledJob({
    jobKey: 'job.provisioning_recovery',
    cadenceMs: 5 * MINUTE_MS,
    timeoutMs: 240_000,
    leaseSeconds: 300,
    task: async () => {
      const result = await runProvisioningRecovery();
      return {
        processedCount: result.started,
        failedCount: result.failed,
        skippedCount: result.waitingForOauth,
        summary: {
          started: result.started,
          waitingForOauth: result.waitingForOauth,
        },
      };
    },
  }),
  new DurableScheduledJob({
    jobKey: 'job.payment_reminder_check',
    cadenceMs: HOUR_MS,
    timeoutMs: 600_000,
    leaseSeconds: 720,
    retryProbeMs: 15 * MINUTE_MS,
    task: async () => {
      const result = await runPaymentReminderCheck();
      return {
        processedCount: result.sent,
        skippedCount: result.skipped,
        summary: { sent: result.sent },
      };
    },
  }),
  new DurableScheduledJob({
    jobKey: 'job.pulse_cadence_check',
    cadenceMs: HOUR_MS,
    timeoutMs: 600_000,
    leaseSeconds: 720,
    retryProbeMs: 15 * MINUTE_MS,
    task: async () => {
      const result = await runPulseCadenceCheck();
      return {
        processedCount: result.sent,
        skippedCount: result.skipped,
        summary: { sent: result.sent },
      };
    },
  }),
  new DurableScheduledJob({
    jobKey: 'job.daily_account_health',
    cadenceMs: DAY_MS,
    timeoutMs: 3_600_000,
    leaseSeconds: 3900,
    retryProbeMs: HOUR_MS,
    task: async () => {
      const result = await runDailyHealthCheck();
      return {
        processedCount: result.processed,
        failedCount: result.failed,
      };
    },
  }),
  new DurableScheduledJob({
    jobKey: 'job.pif_completion_check',
    cadenceMs: DAY_MS,
    timeoutMs: 1_800_000,
    leaseSeconds: 2100,
    retryProbeMs: HOUR_MS,
    task: async () => {
      const result = await runPifCompletionCheck();
      return {
        processedCount: result.completed,
        failedCount: result.failed,
        skippedCount: result.skipped,
        summary: { completed: result.completed },
      };
    },
  }),
  new DurableScheduledJob({
    jobKey: 'job.command_center_health_reconcile',
    cadenceMs: 5 * MINUTE_MS,
    timeoutMs: 240_000,
    leaseSeconds: 300,
    // Let the jobs and workers monitored by this check publish their first
    // successful state before the initial global evaluation.
    initialDelayMs: 30_000,
    task: async () => {
      const evaluationStartedAt = Date.now();
      let evaluation: {
        evaluatedCount: number;
        databaseSchemaVersion: number;
      };
      try {
        evaluation = await commandCenterHealthRepository.evaluateGlobalHealth({
          codeSchemaVersion: COMMAND_CENTER_HEALTH_SCHEMA_VERSION,
          ...commandCenterHealthService.productionSafetyPosture(),
        });
        applicationMetricsService.recordDatabaseCanary(
          Date.now() - evaluationStartedAt,
          false,
        );
      } catch (error) {
        applicationMetricsService.recordDatabaseCanary(
          Date.now() - evaluationStartedAt,
          true,
        );
        throw error;
      }

      const reconciled = await commandCenterHealthRepository.reconcileDirtyMerchantHealth(
        200,
        merchantHealthWorkerId,
      );
      return {
        processedCount: evaluation.evaluatedCount + reconciled,
        summary: {
          databaseSchemaVersion: evaluation.databaseSchemaVersion,
          globalChecksEvaluated: evaluation.evaluatedCount,
          merchantsReconciled: reconciled,
        },
      };
    },
  }),
  new DurableScheduledJob({
    jobKey: 'job.merchant_health_full_sweep',
    cadenceMs: DAY_MS,
    timeoutMs: 1_800_000,
    leaseSeconds: 2100,
    retryProbeMs: HOUR_MS,
    task: async (context) => {
      let batchCount = 0;
      let latest = {
        processedInBatch: 0,
        totalProcessed: 0,
        nextCursor: null as string | null,
        complete: false,
      };
      while (!latest.complete && batchCount < 100) {
        latest = await commandCenterHealthRepository.reconcileMerchantHealthSweepBatch({
          runId: context.runId,
          workerId: context.workerId,
          limit: 1000,
        });
        batchCount += 1;
      }
      if (!latest.complete) {
        throw new Error('Merchant health full sweep exceeded its bounded batch count');
      }
      return {
        processedCount: latest.totalProcessed,
        summary: {
          batches: batchCount,
          nextCursor: latest.nextCursor,
          complete: true,
        },
      };
    },
  }),
  new DurableScheduledJob({
    jobKey: 'job.health_retention',
    cadenceMs: DAY_MS,
    timeoutMs: 600_000,
    leaseSeconds: 720,
    retryProbeMs: HOUR_MS,
    task: async () => {
      const result = await commandCenterHealthRepository.runRetention();
      return {
        processedCount:
          result.metricBucketsDeleted
          + result.jobRunsDeleted
          + result.observationsDeleted
          + result.incidentsDeleted,
        summary: result,
      };
    },
  }),
];

export const commandCenterRuntime = {
  start(): void {
    applicationMetricsService.start();
    jobs.forEach((job) => job.start());
  },
  stop(): void {
    jobs.forEach((job) => job.stop());
    applicationMetricsService.stop();
  },
};
