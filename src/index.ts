import { config } from './config';
import { createApp } from './app';
import { logger } from './utils/logger';
import { getSupabase } from './clients/supabase.client';

const app = createApp();

app.listen(config.port, () => {
  logger.info({ port: config.port, env: config.nodeEnv }, 'ScaleSafe server started');

  // Ensure storage bucket exists on startup
  (async () => {
    try {
      const supabase = getSupabase();
      const { data: buckets } = await supabase.storage.listBuckets();
      if (!buckets?.find((b: any) => b.name === 'scalesafe-files')) {
        await supabase.storage.createBucket('scalesafe-files', {
          public: true,
          fileSizeLimit: 5242880,
          allowedMimeTypes: ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'],
        });
        logger.info('Created scalesafe-files storage bucket');
      }
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Could not ensure storage bucket exists');
    }
  })();
});
