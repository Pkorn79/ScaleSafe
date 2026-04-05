import axios from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';

const GHL_WEBHOOK_URL = 'https://backend.leadconnectorhq.com/payments/custom-provider/webhook';

interface SubscriptionSnapshot {
  id: string;
  status: string;
  trialEnd?: number | null;
  createdAt: number;
  nextCharge?: number;
}

interface ChargeSnapshot {
  status: string;
  amount: number;
  chargeId: string;
  chargedAt: number;
}

interface GhlWebhookEvent {
  type: 'payment.captured' | 'subscription.trialing' | 'subscription.active' | 'subscription.updated' | 'subscription.charged';
  chargeId?: string;
  ghlSubscriptionId?: string;
  ghlTransactionId?: string;
  locationId: string;
  apiKey: string;
  subscriptionSnapshot?: SubscriptionSnapshot;
  chargeSnapshot?: ChargeSnapshot;
}

export const ghlWebhookService = {
  /**
   * Send a subscription/payment lifecycle event to GHL.
   */
  async sendEvent(event: GhlWebhookEvent): Promise<void> {
    try {
      await axios.post(GHL_WEBHOOK_URL, {
        event: event.type,
        chargeId: event.chargeId,
        ghlSubscriptionId: event.ghlSubscriptionId,
        ghlTransactionId: event.ghlTransactionId,
        marketplaceAppId: config.ghl.clientId,
        locationId: event.locationId,
        apiKey: event.apiKey,
        subscriptionSnapshot: event.subscriptionSnapshot,
        chargeSnapshot: event.chargeSnapshot,
      }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000,
      });

      logger.info(
        { type: event.type, locationId: event.locationId },
        'GHL webhook sent',
      );
    } catch (err: any) {
      logger.error(
        { err: err.message, type: event.type, locationId: event.locationId },
        'Failed to send GHL webhook',
      );
    }
  },
};
