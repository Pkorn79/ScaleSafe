import { config } from './config';
import { createApp } from './app';
import { logger } from './utils/logger';
import { runDailyHealthCheck } from './jobs/daily-health-check';
import { runPaymentReminderCheck } from './jobs/payment-reminder-check';
import { runPifCompletionCheck } from './jobs/pif-completion-check';
import { runPulseCadenceCheck } from './jobs/pulse-cadence-check';
import { storageService } from './services/storage.service';
import { evidenceConnectorWorker } from './services/evidence-connector-worker';

const app = createApp();

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
});
