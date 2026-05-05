import { Request, Response, NextFunction } from 'express';
import { triggerRepository } from '../repositories/trigger.repository';
import { isValidTriggerKey } from '../constants/trigger-keys';
import { logger } from '../utils/logger';
import { ValidationError } from '../utils/errors';

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
      const locationId = body.locationId || body.location_id || body.extras?.locationId || body.extras?.location_id;
      const triggerKey = body.triggerKey || body.trigger_key || body.triggerData?.key || body.meta?.key;
      const subscriptionUrl = body.subscriptionUrl || body.subscription_url || body.triggerData?.targetUrl;

      if (!type || !locationId || !triggerKey || !subscriptionUrl) {
        logger.warn(
          {
            bodyKeys: Object.keys(body),
            triggerDataKeys: body.triggerData ? Object.keys(body.triggerData) : [],
            extrasKeys: body.extras ? Object.keys(body.extras) : [],
            metaKeys: body.meta ? Object.keys(body.meta) : [],
          },
          'Invalid trigger subscription payload',
        );
        throw new ValidationError('type, locationId, triggerKey, subscriptionUrl required');
      }

      if (!isValidTriggerKey(triggerKey)) {
        throw new ValidationError(`Invalid trigger key: ${triggerKey}`);
      }

      if (type === 'subscribe' || type === 'created' || type === 'updated') {
        await triggerRepository.upsertSubscription(locationId, triggerKey, subscriptionUrl);
        logger.info({ locationId, triggerKey, subscriptionUrl, type }, 'Trigger subscribed');
      } else if (type === 'unsubscribe' || type === 'deleted') {
        await triggerRepository.deactivateSubscription(locationId, triggerKey, subscriptionUrl);
        logger.info({ locationId, triggerKey, subscriptionUrl, type }, 'Trigger unsubscribed');
      } else {
        throw new ValidationError(`Invalid subscription type: ${type}`);
      }

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
};
