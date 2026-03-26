/**
 * webhook.routes.ts — Webhook Endpoint Definitions
 *
 * Defines the four webhook receiver endpoints:
 * 1. POST /webhooks/acceptblue — all accept.blue transaction events
 * 2. POST /webhooks/ghl        — all GHL form/workflow events
 * 3. POST /webhooks/external   — third-party tools (Calendly, Zoom, Kajabi, etc.)
 * 4. POST /webhooks/service-access — platform access events (S13 sources)
 *
 * These endpoints have NO authentication middleware (no SSO).
 * accept.blue webhooks are verified by HMAC signature.
 * GHL and external webhooks are trusted based on the webhook URL being secret.
 */

import { Router } from 'express';
import {
  handleAcceptBlueWebhook,
  handleGhlWebhook,
  handleExternalWebhook,
  handleServiceAccessWebhook,
} from '../controllers/webhook.controller';

const router = Router();

/** All accept.blue payment events (charge, refund, decline, ACH status, etc.) */
router.post('/webhooks/acceptblue', handleAcceptBlueWebhook);

/** All GHL form submissions and workflow trigger events */
router.post('/webhooks/ghl', handleGhlWebhook);

/** External integrations (Calendly, Zoom, Kajabi, Teachable, Zapier, etc.) */
router.post('/webhooks/external', handleExternalWebhook);

/** Platform access events (Kajabi logins, Skool course views, etc.) */
router.post('/webhooks/service-access', handleServiceAccessWebhook);

export default router;
