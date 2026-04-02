import { Router } from 'express';
import { webhookController } from '../controllers/webhook.controller';
import { triggerController } from '../controllers/trigger.controller';

const router = Router();

// All webhook routes are unauthenticated (validated by idempotency + source-specific verification)
router.post('/ghl/triggers', triggerController.handleSubscription);
router.post('/ghl/payment', webhookController.ghlPayment);
router.post('/ghl/forms', webhookController.ghlForms);
router.post('/external', webhookController.external);

export default router;
