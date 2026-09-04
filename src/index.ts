import { config } from './config';
import { createApp } from './app';
import { logger } from './utils/logger';
import { runDailyHealthCheck } from './jobs/daily-health-check';
import { runPaymentReminderCheck } from './jobs/payment-reminder-check';
import { runPifCompletionCheck } from './jobs/pif-completion-check';
import { runPulseCadenceCheck } from './jobs/pulse-cadence-check';
import { runProvisioningRecovery } from './jobs/provisioning-recovery';
import { storageService } from './services/storage.service';
import { evidenceConnectorWorker } from './services/evidence-connector-worker';
import { defenseCompilationWorker } from './services/defense-compilation-worker';
import { moneyReconciliationWorker } from './services/money-reconciliation-worker';
import { triggerDeliveryWorker } from './services/trigger-delivery-worker';
import { schemaReadinessService } from './services/schema-readiness.service';

// Backstop: Express 4 does not forward async handler rejections, and Node's
// default on an unhandled rejection is process exit — one bad webhook payload
// would take down every tenant. Log loudly and keep the process alive;
// handlers own their own error replies.
process.on('unhandledRejection', (reason: any) => {
  logger.error(
    { err: reason?.message || String(reason), stack: reason?.stack },
    'Unhandled promise rejection (backstop) — investigate the offending handler',
  );
});

const app = createApp();

async function start(): Promise<void> {
  await schemaReadinessService.assertReady();
  app.listen(config.port, () => {
    logger.info({ port: config.port, env: config.nodeEnv }, 'ScaleSafe server started');

    // Ensure split storage exists: public assets stay public, evidence files stay private.
    (async () => {
      try {
        await storageService.ensureStorageBuckets();
      } catch (err: any) {
        logger.warn({ err: err.message, stack: err.stack }, 'Could not ensure storage bucket exists');
      }
    })();

    // Schedule jobs (first run 5 min after startup). Payment reminders and pulse
    // checks run hourly with idempotency so due windows are responsive without
    // duplicate customer messages.
    const DAY_MS = 24 * 60 * 60 * 1000;
    const HOUR_MS = 60 * 60 * 1000;
    setTimeout(() => {
      runDailyHealthCheck().catch(err => logger.error({ err }, 'Daily health check failed'));
      runPaymentReminderCheck().catch(err => logger.error({ err }, 'Payment reminder check failed'));
      runPulseCadenceCheck().catch(err => logger.error({ err }, 'Pulse cadence check failed'));
      setInterval(() => runDailyHealthCheck().catch(err => logger.error({ err }, 'Daily health check failed')), DAY_MS);
      setInterval(() => runPaymentReminderCheck().catch(err => logger.error({ err }, 'Payment reminder check failed')), HOUR_MS);
      setInterval(() => runPulseCadenceCheck().catch(err => logger.error({ err }, 'Pulse cadence check failed')), HOUR_MS);
      runPifCompletionCheck().catch(err => logger.error({ err }, 'PIF completion check failed'));
      setInterval(() => runPifCompletionCheck().catch(err => logger.error({ err }, 'PIF completion check failed')), DAY_MS);
    }, 5 * 60 * 1000);

    // Database-leased worker; safe to run on multiple Railway instances.
    evidenceConnectorWorker.start();
    defenseCompilationWorker.start();
    moneyReconciliationWorker.start();
    triggerDeliveryWorker.start();

    // Reclaim provisioning interrupted by deploys. The repository claim is a
    // database compare-and-set, so this remains safe across Railway instances.
    const PROVISIONING_RECOVERY_MS = 5 * 60 * 1000;
    setTimeout(() => {
      runProvisioningRecovery().catch(err => logger.error({ err }, 'Provisioning recovery failed'));
      setInterval(
        () => runProvisioningRecovery().catch(err => logger.error({ err }, 'Provisioning recovery failed')),
        PROVISIONING_RECOVERY_MS,
      );
    }, 15 * 1000);
  });
}

start().catch((err: any) => {
  logger.fatal({ err: err?.message || String(err) }, 'ScaleSafe startup blocked by deployment readiness check');
  process.exit(1);
});
