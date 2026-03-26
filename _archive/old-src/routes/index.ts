/**
 * routes/index.ts — Route Aggregator
 *
 * Mounts all route modules onto the Express app.
 * This is the single place where all routes are registered.
 * New route files get added here as we build each phase.
 */

import { Express } from 'express';
import healthRoutes from './health.routes';
import authRoutes from './auth.routes';
import webhookRoutes from './webhook.routes';
import evidenceRoutes from './evidence.routes';
import offerRoutes from './offer.routes';
import enrollmentRoutes from './enrollment.routes';
import milestoneRoutes from './milestone.routes';
import defenseRoutes from './defense.routes';
import merchantRoutes from './merchant.routes';
import adminRoutes from './admin.routes';
import { apiRateLimiter, webhookRateLimiter } from '../middleware/rateLimiter';

/** Registers all routes on the Express app. */
export function registerRoutes(app: Express): void {
  // Health checks (no auth, no rate limit)
  app.use(healthRoutes);

  // Auth routes (OAuth callback, SSO decryption)
  app.use(authRoutes);

  // Webhook routes (higher rate limit — accept.blue can burst during settlements)
  app.use('/webhooks', webhookRateLimiter);
  app.use(webhookRoutes);

  // API rate limiting for all /api/* routes
  app.use('/api', apiRateLimiter);

  // Evidence API (SSO required)
  app.use('/api/evidence', evidenceRoutes);

  // Offer API (SSO required)
  app.use('/api/offers', offerRoutes);

  // Enrollment API (mixed auth — some public, some SSO)
  app.use('/api/enrollment', enrollmentRoutes);

  // Milestone sign-off (public — client-facing)
  app.use('/api/milestones', milestoneRoutes);

  // Defense API (SSO required)
  app.use('/api/defense', defenseRoutes);

  // Merchant API (SSO required)
  app.use('/api/merchants', merchantRoutes);

  // Admin API (SSO required — reconciliation, subscription management)
  app.use('/api/admin', adminRoutes);
}
