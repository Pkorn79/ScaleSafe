import express from 'express';
import cors from 'cors';
import path from 'path';
import { requestLogger } from './middleware/requestLogger';
import { errorHandler } from './middleware/errorHandler';
import { captureRawBody } from './middleware/rawBody';
import { securityHeaders } from './middleware/securityHeaders';
import routes from './routes';
import { config } from './config';
import { applicationMetrics } from './middleware/applicationMetrics';

export function createApp(): express.Application {
  const app = express();

  const operator = (config as any).operator;
  if (operator?.enabled && operator.trustProxyHops > 0) {
    app.set('trust proxy', operator.trustProxyHops);
  }

  app.disable('x-powered-by');
  app.use(securityHeaders);

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
  app.use('/api/milestone-signoff', cors({
    origin: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    credentials: false,
  }));

  // Parse JSON with raw body capture for webhook signature verification
  app.use(express.json({ verify: captureRawBody as any }));
  app.use(express.urlencoded({ extended: true, verify: captureRawBody as any }));

  // Request logging
  app.use(requestLogger);
  app.use(applicationMetrics);

  // All routes
  app.use(routes);

  // Internal namespaces always fail closed. They must never fall through to
  // the merchant SPA when a feature is disabled or a path is misspelled.
  app.all(/^\/internal(?:\/|$)/, (_req, res) => {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Not found' });
  });

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
      // index.html must never be cached because it references hashed asset filenames.
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      }
    },
  }));
  // SPA catch-all: serve index.html for all routes EXCEPT API, auth, health,
  // webhooks, enrollment, checkout, and widgets
  app.get(/^\/(?!api|auth|health|internal|webhooks|enrollment|checkout|quick-checkout|payment-update|payment-thank-you|subscription-cancel|milestone-signoff|widgets|terms).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(uiPath, 'index.html'));
  });

  // Global error handler (must be last)
  app.use(errorHandler);

  return app;
}
