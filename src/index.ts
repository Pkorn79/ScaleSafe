import { config } from './config';
import { createApp } from './app';
import { logger } from './utils/logger';

const app = createApp();

app.listen(config.port, () => {
  logger.info({ port: config.port, env: config.nodeEnv }, 'ScaleSafe server started');
});
