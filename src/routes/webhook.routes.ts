import { Router } from 'express';
import { webhookController } from '../controllers/webhook.controller';
import { triggerController } from '../controllers/trigger.controller';
import { handleStripeWebhook } from '../controllers/stripe-webhook.controller';
import { handleNmiSilentPost } from '../controllers/nmi-silent-post.controller';
import { requireGhlWebhookSignature } from '../middleware/ghlWebhookSignature';
import { requireMerchantWebhookSecret } from '../middleware/merchantWebhookSecret';

const router = Router();

// Marketplace workflow trigger subscription lifecycle. HighLevel sends the
// target workflow execution URL here when a workflow using one of our custom
// triggers is created/updated/deleted.
router.post('/ghl/triggers', triggerController.handleSubscription);

// Official GHL marketplace/payment webhooks are signed by HighLevel.
router.post('/ghl/payment', requireGhlWebhookSignature, webhookController.ghlPayment);
router.post('/ghl/forms', requireMerchantWebhookSecret, webhookController.ghlForms);
router.post('/external', requireMerchantWebhookSecret, webhookController.external);

// Stripe webhooks — signature verified inside the handler using req.rawBody
router.post('/stripe', handleStripeWebhook);

// NMI Silent Post — no signature; verified by calling verifyTransaction() per notification
router.post('/nmi/silent-post', handleNmiSilentPost);

export default router;
