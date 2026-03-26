import { Router } from 'express';
import { apiLimiter, webhookLimiter } from '../middleware/rateLimiter';
import healthRoutes from './health.routes';
import authRoutes from './auth.routes';
import merchantRoutes from './merchant.routes';
import offerRoutes from './offer.routes';
import enrollmentRoutes from './enrollment.routes';
import evidenceRoutes from './evidence.routes';
import defenseRoutes from './defense.routes';
import dashboardRoutes from './dashboard.routes';
import adminRoutes from './admin.routes';
import webhookRoutes from './webhook.routes';

const router = Router();

// Health — no rate limiting
router.use(healthRoutes);

// Auth — no rate limiting (OAuth callbacks)
router.use('/auth', authRoutes);

// API routes (rate limited)
router.use('/api/merchants', apiLimiter, merchantRoutes);
router.use('/api/offers', apiLimiter, offerRoutes);
router.use('/api/enrollment', apiLimiter, enrollmentRoutes);
router.use('/api/evidence', apiLimiter, evidenceRoutes);
router.use('/api/defense', apiLimiter, defenseRoutes);
router.use('/api/dashboard', apiLimiter, dashboardRoutes);
router.use('/api/admin', apiLimiter, adminRoutes);

// Webhook routes (higher rate limit)
router.use('/webhooks', webhookLimiter, webhookRoutes);

export default router;
