import { Router } from 'express';
import { apiLimiter, webhookLimiter, checkoutLimiter } from '../middleware/rateLimiter';
import healthRoutes from './health.routes';
import authRoutes from './auth.routes';
import merchantRoutes from './merchant.routes';
import offerRoutes from './offer.routes';
import enrollmentRoutes from './enrollment.routes';
import phase2EnrollmentRoutes from './phase2Enrollment.routes';
import evidenceRoutes from './evidence.routes';
import defenseRoutes from './defense.routes';
import dashboardRoutes from './dashboard.routes';
import adminRoutes from './admin.routes';
import webhookRoutes from './webhook.routes';
import stripeConnectRoutes from './stripe-connect.routes';
import paymentProviderRoutes from './payment-provider.routes';
import checkoutRoutes from './checkout.routes';
import evidenceUploadRoutes from './evidence-upload.routes';
import disputeRoutes from './dispute.routes';
import efwRoutes from './efw.routes';
import stripeDefenseRoutes from './stripe-defense.routes';
import paymentManagementRoutes from './payment-management.routes';
import termsRoutes from './terms.routes';
import paymentUpdateRoutes from './payment-update.routes';
import paymentLifecycleRoutes from './payment-lifecycle.routes';
import processorConfigRoutes from './processor-config.routes';

const router = Router();

// Health — no rate limiting
router.use(healthRoutes);

// Auth — no rate limiting (OAuth callbacks)
router.use('/auth', authRoutes);
router.use('/auth/stripe', stripeConnectRoutes);

// API routes (rate limited)
router.use('/api/merchants', apiLimiter, merchantRoutes);
router.use('/api/offers', apiLimiter, offerRoutes);
router.use('/api/enrollment', apiLimiter, enrollmentRoutes);
router.use('/api/enrollments', apiLimiter, phase2EnrollmentRoutes);
router.use('/api/evidence', apiLimiter, evidenceRoutes);
router.use('/api/evidence', apiLimiter, evidenceUploadRoutes);
router.use('/api/defense', apiLimiter, defenseRoutes);
router.use('/api/dashboard', apiLimiter, dashboardRoutes);
router.use('/api/admin', apiLimiter, adminRoutes);

// Public enrollment page (client-facing, no SSO)
router.use('/enrollment', enrollmentRoutes);

// Payment provider queryUrl (GHL → ScaleSafe)
router.use('/api/payments', paymentProviderRoutes);
// Payment customer search + management (SSO-gated)
router.use('/api/payments', apiLimiter, paymentManagementRoutes);

// Checkout page + API (public, rate limited)
router.use('/api/checkout', checkoutLimiter);
router.use(checkoutRoutes);

// Payment management (SSO-gated)
router.use('/api/payments/manage', apiLimiter, paymentManagementRoutes);

// Dispute + EFW management (SSO-gated)
router.use('/api/disputes', apiLimiter, disputeRoutes);
router.use('/api/efws', apiLimiter, efwRoutes);

// Stripe management (SSO-gated)
router.use('/api/stripe', apiLimiter, stripeConnectRoutes);
router.use('/api/stripe', apiLimiter, stripeDefenseRoutes);

// Payment update widget (public, rate limited — client-facing)
router.use(paymentUpdateRoutes);

// Payment lifecycle (SSO-gated — subscription mgmt, card mgmt, dunning)
router.use('/api/payments/lifecycle', apiLimiter, paymentLifecycleRoutes);

// Processor connection management (SSO-gated — Settings page)
router.use('/api/processor-config', apiLimiter, processorConfigRoutes);

// Terms page (public, no auth)
router.use('/terms', termsRoutes);

// Webhook routes (higher rate limit)
router.use('/webhooks', webhookLimiter, webhookRoutes);

export default router;
