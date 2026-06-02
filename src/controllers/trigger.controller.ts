import { Request, Response, NextFunction } from 'express';
import { triggerRepository } from '../repositories/trigger.repository';
import { normalizeTriggerKey } from '../constants/trigger-keys';
import { logger } from '../utils/logger';
import { ValidationError } from '../utils/errors';
import { isAllowedTriggerSubscriptionUrl } from '../utils/trigger-subscription-url';

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function findTriggerKey(body: Record<string, any>): string {
  return firstString(
    body.triggerKey,
    body.trigger_key,
    body.triggerData?.key,
    body.triggerData?.triggerKey,
    body.triggerData?.trigger_key,
    body.triggerData?.name,
    body.triggerData?.label,
    body.meta?.key,
    body.meta?.triggerKey,
    body.meta?.name,
    body.meta?.label,
    body.eventType,
    body.event_type,
    body.filters?.eventType,
    body.filters?.event_type,
    body.filter?.eventType,
    body.filter?.event_type,
  );
}

export const triggerController = {
  /**
   * POST /webhooks/ghl/triggers
   * Handles GHL custom trigger lifecycle: subscribe and unsubscribe events.
   */
  async handleSubscription(req: Request, res: Response, next: NextFunction) {
    try {
      const body = req.body || {};
      const eventType = body.type || body.triggerData?.eventType;
      const type = String(eventType || '').toLowerCase();
      const locationId = firstString(
        body.locationId,
        body.location_id,
        body.location?.id,
        body.extras?.locationId,
        body.extras?.location_id,
        body.triggerData?.locationId,
        body.triggerData?.location_id,
        body.meta?.locationId,
        body.meta?.location_id,
      );
      const rawTriggerKey = findTriggerKey(body);
      const triggerKey = normalizeTriggerKey(rawTriggerKey);
      const subscriptionUrl = firstString(
        body.subscriptionUrl,
        body.subscription_url,
        body.targetUrl,
        body.target_url,
        body.webhookUrl,
        body.webhook_url,
        body.url,
        body.triggerData?.targetUrl,
        body.triggerData?.target_url,
        body.triggerData?.subscriptionUrl,
        body.triggerData?.subscription_url,
      );

      if (!type || !locationId || !triggerKey || !subscriptionUrl) {
        logger.warn(
          {
            bodyKeys: Object.keys(body),
            triggerDataKeys: body.triggerData ? Object.keys(body.triggerData) : [],
            extrasKeys: body.extras ? Object.keys(body.extras) : [],
            metaKeys: body.meta ? Object.keys(body.meta) : [],
            rawTriggerKey,
            normalizedTriggerKey: triggerKey,
          },
          'Invalid trigger subscription payload',
        );
        throw new ValidationError('type, locationId, valid triggerKey, subscriptionUrl required');
      }

      if (!isAllowedTriggerSubscriptionUrl(String(subscriptionUrl))) {
        logger.warn({ locationId, triggerKey, type }, 'Rejected unsupported trigger subscription URL');
        throw new ValidationError('Unsupported trigger subscription URL');
      }

      if (type === 'subscribe' || type === 'created' || type === 'updated') {
        await triggerRepository.upsertSubscription(locationId, triggerKey, subscriptionUrl);
        logger.info({ locationId, triggerKey, rawTriggerKey, subscriptionUrl, type }, 'Trigger subscribed');
      } else if (type === 'unsubscribe' || type === 'deleted') {
        await triggerRepository.deactivateSubscription(locationId, triggerKey, subscriptionUrl);
        logger.info({ locationId, triggerKey, rawTriggerKey, subscriptionUrl, type }, 'Trigger unsubscribed');
      } else {
        throw new ValidationError(`Invalid subscription type: ${type}`);
      }

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
};
