import { Router } from 'express';
import { webhookController } from '../controllers/webhook.controller';
import { triggerController } from '../controllers/trigger.controller';
import { handleStripeWebhook } from '../controllers/stripe-webhook.controller';
import { handleNmiSilentPost } from '../controllers/nmi-silent-post.controller';
import { requireGhlWebhookSignature } from '../middleware/ghlWebhookSignature';

const router = Router();

// All webhook routes are unauthenticated (validated by idempotency + source-specific verification)
router.post('/ghl/triggers', requireGhlWebhookSignature, triggerController.handleSubscription);
router.post('/ghl/payment', requireGhlWebhookSignature, webhookController.ghlPayment);
router.post('/ghl/forms', webhookController.ghlForms);
router.post('/external', webhookController.external);

// Stripe webhooks — signature verified inside the handler using req.rawBody
router.post('/stripe', handleStripeWebhook);

// NMI Silent Post — no signature; verified by calling verifyTransaction() per notification
router.post('/nmi/silent-post', handleNmiSilentPost);

export default router;
