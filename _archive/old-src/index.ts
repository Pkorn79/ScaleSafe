/**
 * index.ts — Application Entry Point
 *
 * Starts the ScaleSafe Express server.
 * Config is validated at import time — if any required env vars are missing,
 * the app fails immediately with a clear error message.
 */

import { config } from './config';
import { createApp } from './app';
import { logger } from './utils/logger';

const app = createApp();

app.listen(config.port, () => {
  logger.info(
    {
      port: config.port,
      env: config.nodeEnv,
    },
    `ScaleSafe app listening on port ${config.port}`
  );
});
