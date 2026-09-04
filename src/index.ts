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
import { commandCenterRuntime } from './services/command-center-runtime.service';
import { guardianReadinessService } from './services/guardian-readiness.service';

const app = createApp();

async function start(): Promise<void> {
  await schemaReadinessService.assertReady();
  await guardianReadinessService.assertReady();
  const onListening = (): void => {
    logger.info(
      { port: config.port, bindHost: config.bindHost || 'default', env: config.nodeEnv },
      'ScaleSafe server started',
    );

    // Ensure split storage exists: public assets stay public, evidence files stay private.
    (async () => {
      try {
        await storageService.ensureStorageBuckets();
      } catch (err: any) {
        logger.warn({ err: err.message, stack: err.stack }, 'Could not ensure storage bucket exists');
      }
    })();

    if (config.operator.healthEnabled) {
      // Migration 108-backed schedules run once across Railway instances.
      commandCenterRuntime.start();
    } else {
      // Preserve the production scheduler unchanged until the isolated Phase 2
      // feature and schema are explicitly enabled.
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
    }

    // Database-leased worker; safe to run on multiple Railway instances.
    evidenceConnectorWorker.start();
    defenseCompilationWorker.start();
    moneyReconciliationWorker.start();
    triggerDeliveryWorker.start();

    if (!config.operator.healthEnabled) {
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
    }
  };
  if (config.bindHost) {
    app.listen(config.port, config.bindHost, onListening);
  } else {
    app.listen(config.port, onListening);
  }
}

start().catch((err: any) => {
  logger.fatal({ err: err?.message || String(err) }, 'ScaleSafe startup blocked by deployment readiness check');
  process.exit(1);
});
