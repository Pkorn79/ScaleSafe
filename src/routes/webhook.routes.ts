import { Router } from 'express';
import { webhookController } from '../controllers/webhook.controller';
import { triggerController } from '../controllers/trigger.controller';
import { handleStripeWebhook } from '../controllers/stripe-webhook.controller';
import { handleNmiSilentPost } from '../controllers/nmi-silent-post.controller';
import { handleNmiWebhookEvent } from '../controllers/nmi-webhook-events.controller';
import { handleWhopWebhook } from '../controllers/whop-webhook.controller';
import { requireGhlWebhookSignature } from '../middleware/ghlWebhookSignature';
import { requireMerchantWebhookSecretStrict } from '../middleware/merchantWebhookSecret';
import { requireRawEvidenceConnection } from '../middleware/evidenceConnectorAuth';
import { evidenceConnectorController } from '../controllers/evidence-connector.controller';
import { zoomIntegrationController } from '../controllers/zoom-integration.controller';

const router = Router();

// Marketplace workflow trigger subscription lifecycle. HighLevel sends the
// target workflow execution URL here when a workflow using one of our custom
// triggers is created/updated/deleted.
router.post('/ghl/triggers', requireGhlWebhookSignature, triggerController.handleSubscription);

// Official GHL marketplace/payment webhooks are signed by HighLevel.
router.post('/ghl', requireGhlWebhookSignature, webhookController.ghlUnified);
router.post('/ghl/payment', requireGhlWebhookSignature, webhookController.ghlPayment);
router.post('/ghl/activity', requireGhlWebhookSignature, webhookController.ghlActivity);
router.post('/ghl/course-activity', requireMerchantWebhookSecretStrict, webhookController.ghlCourseActivity);
router.post('/ghl/forms', requireMerchantWebhookSecretStrict, webhookController.ghlForms);
router.post('/external', requireMerchantWebhookSecretStrict, webhookController.external);
router.post('/connectors/:connectionId', requireRawEvidenceConnection, evidenceConnectorController.ingestRaw);
router.post('/connectors/:connectionId/:secret', requireRawEvidenceConnection, evidenceConnectorController.ingestRaw);

// Stripe webhooks: signature verified inside the handler using req.rawBody.
router.post('/stripe/:locationId', handleStripeWebhook);
router.post('/stripe', handleStripeWebhook);

// NMI Silent Post: verified by calling verifyTransaction() per notification.
router.post('/nmi/silent-post', handleNmiSilentPost);

// NMI official webhooks: signed JSON events. Configure this URL in NMI.
router.post('/nmi/events/:processorConfigId', handleNmiWebhookEvent);

// Whop Standard Webhooks: signature verified inside the handler using req.rawBody.
router.post('/whop', handleWhopWebhook);

// Zoom meeting attendance. URL validation and signed event verification are
// handled in the controller using the exact captured request body.
router.post('/zoom', zoomIntegrationController.webhook);

export default router;
