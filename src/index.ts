import { config } from './config';
import { createApp } from './app';
import { logger } from './utils/logger';
import { getSupabase } from './clients/supabase.client';

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
});
