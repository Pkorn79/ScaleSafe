import express from 'express';
import cors from 'cors';
import path from 'path';
import { requestLogger } from './middleware/requestLogger';
import { errorHandler } from './middleware/errorHandler';
import { captureRawBody } from './middleware/rawBody';
import routes from './routes';

export function createApp(): express.Application {
  const app = express();

  // CORS for public endpoints (called from GHL iframes)
  app.use('/api/enrollment', cors({
    origin: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-requested-with'],
    credentials: false,
  }));
  app.use('/api/checkout', cors({
    origin: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    credentials: false,
  }));

  // Parse JSON with raw body capture for webhook signature verification
  app.use(express.json({ verify: captureRawBody as any }));
  app.use(express.urlencoded({ extended: true }));

  // Request logging
  app.use(requestLogger);

  // All routes
  app.use(routes);

  // Serve enrollment funnel widgets (static HTML/CSS/JS, CORS enabled for GHL iframes)
  app.use('/widgets', cors({ origin: true }));
  // In production (compiled): __dirname = dist/, widgets at dist/widgets/
  // Fallback: also try src/widgets from project root (dev)
  app.use('/widgets', express.static(path.join(__dirname, 'widgets')));
  app.use('/widgets', express.static(path.join(__dirname, '..', 'src', 'widgets')));

  // Serve Vue 3 frontend (built assets)
  const uiPath = path.join(__dirname, 'ui', 'dist');
  app.use(express.static(uiPath, {
    maxAge: '1y',
    immutable: true,
    setHeaders: (res, filePath) => {
      // index.html must never be cached — it references hashed asset filenames
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      }
    },
  }));
  // SPA catch-all: serve index.html for all routes EXCEPT API, auth, health,
  // webhooks, enrollment, checkout, and widgets
  app.get(/^\/(?!api|auth|health|webhooks|enrollment|checkout|quick-checkout|payment-update|subscription-cancel|widgets|terms).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(uiPath, 'index.html'));
  });

  // Global error handler (must be last)
  app.use(errorHandler);

  return app;
}
