import { config } from './config';
import { createApp } from './app';
import { logger } from './utils/logger';
import { getSupabase } from './clients/supabase.client';
import { runDailyHealthCheck } from './jobs/daily-health-check';
import { runPaymentReminderCheck } from './jobs/payment-reminder-check';
import { runRecurringBilling } from './jobs/recurring-billing';

const app = createApp();

app.listen(config.port, () => {
  logger.info({ port: config.port, env: config.nodeEnv }, 'ScaleSafe server started');

  // Ensure storage bucket exists and accepts all file types (images + PDFs)
  (async () => {
    try {
      const supabase = getSupabase();
      const { data: buckets } = await supabase.storage.listBuckets();
      if (!buckets?.find((b: any) => b.name === 'scalesafe-files')) {
        await supabase.storage.createBucket('scalesafe-files', {
          public: true,
          fileSizeLimit: 10485760,
        });
        logger.info('Created scalesafe-files storage bucket (no MIME restriction)');
      } else {
        // Remove MIME type restriction so PDFs can be uploaded
        const { error: updateErr } = await supabase.storage.updateBucket('scalesafe-files', {
          public: true,
          fileSizeLimit: 10485760,
          allowedMimeTypes: null as any,
        });
        if (updateErr) {
          logger.warn({ err: updateErr.message }, 'Bucket update failed — trying without allowedMimeTypes param');
          // Fallback: try without the allowedMimeTypes field at all
          await supabase.storage.updateBucket('scalesafe-files', {
            public: true,
            fileSizeLimit: 10485760,
          });
        }
        logger.info('Storage bucket scalesafe-files verified');
      }
    } catch (err: any) {
      logger.warn({ err: err.message, stack: err.stack }, 'Could not ensure storage bucket exists');
    }
  })();

  // Schedule daily jobs (first run 5 min after startup, then every 24 hours)
  const DAY_MS = 24 * 60 * 60 * 1000;
  setTimeout(() => {
    runDailyHealthCheck().catch(err => logger.error({ err }, 'Daily health check failed'));
    runPaymentReminderCheck().catch(err => logger.error({ err }, 'Payment reminder check failed'));
    runRecurringBilling().catch(err => logger.error({ err }, 'Recurring billing failed'));
    setInterval(() => runDailyHealthCheck().catch(err => logger.error({ err }, 'Daily health check failed')), DAY_MS);
    setInterval(() => runPaymentReminderCheck().catch(err => logger.error({ err }, 'Payment reminder check failed')), DAY_MS);
    setInterval(() => runRecurringBilling().catch(err => logger.error({ err }, 'Recurring billing failed')), DAY_MS);
  }, 5 * 60 * 1000);
});
