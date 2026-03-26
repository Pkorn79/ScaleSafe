import express from 'express';
import path from 'path';
import { requestLogger } from './middleware/requestLogger';
import { errorHandler } from './middleware/errorHandler';
import { captureRawBody } from './middleware/rawBody';
import routes from './routes';

export function createApp(): express.Application {
  const app = express();

  // Parse JSON with raw body capture for webhook signature verification
  app.use(express.json({ verify: captureRawBody as any }));
  app.use(express.urlencoded({ extended: true }));

  // Request logging
  app.use(requestLogger);

  // All routes
  app.use(routes);

  // Serve Vue 3 frontend (built assets)
  const uiPath = path.join(__dirname, 'ui', 'dist');
  app.use(express.static(uiPath));
  app.get(/^\/(?!api|auth|health|webhooks).*/, (_req, res) => {
    res.sendFile(path.join(uiPath, 'index.html'));
  });

  // Global error handler (must be last)
  app.use(errorHandler);

  return app;
}
