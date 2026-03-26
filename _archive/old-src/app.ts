/**
 * app.ts — Express Application Factory
 *
 * Creates and configures the Express app with all middleware and routes.
 * Separated from index.ts so the app can be imported for testing
 * without starting the HTTP server.
 *
 * Middleware order matters:
 * 1. Request logger (logs every request)
 * 2. JSON body parser (with raw body preservation for webhook HMAC verification)
 * 3. Static file serving (Vue frontend)
 * 4. Routes (all API endpoints)
 * 5. Error handler (catches all thrown errors — must be last)
 */

import express, { Express } from 'express';
import { requestLogger } from './middleware/requestLogger';
import { errorHandler } from './middleware/errorHandler';
import { registerRoutes } from './routes';

const path = __dirname + '/ui/dist/';

/** Creates and returns a configured Express app. */
export function createApp(): Express {
  const app = express();

  // 1. Log every incoming request
  app.use(requestLogger);

  // 2. Parse JSON bodies, preserving the raw buffer for webhook signature verification
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as any).rawBody = buf;
      },
    })
  );

  // 3. Serve the Vue frontend static files
  app.use(express.static(path));

  // 4. Register all API routes
  registerRoutes(app);

  // 5. Serve Vue app for any unmatched routes (SPA fallback)
  app.get('/', (_req, res) => {
    res.sendFile(path + 'index.html');
  });

  // 6. Global error handler (must be registered last)
  app.use(errorHandler);

  return app;
}
