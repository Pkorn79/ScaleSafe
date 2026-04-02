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
      const { type, locationId, triggerKey, subscriptionUrl } = req.body;

      if (!type || !locationId || !triggerKey || !subscriptionUrl) {
        throw new ValidationError('type, locationId, triggerKey, subscriptionUrl required');
      }

      if (!isValidTriggerKey(triggerKey)) {
        throw new ValidationError(`Invalid trigger key: ${triggerKey}`);
      }

      if (type === 'subscribe') {
        await triggerRepository.upsertSubscription(locationId, triggerKey, subscriptionUrl);
        logger.info({ locationId, triggerKey, subscriptionUrl }, 'Trigger subscribed');
      } else if (type === 'unsubscribe') {
        await triggerRepository.deactivateSubscription(locationId, triggerKey, subscriptionUrl);
        logger.info({ locationId, triggerKey, subscriptionUrl }, 'Trigger unsubscribed');
      } else {
        throw new ValidationError(`Invalid subscription type: ${type}`);
      }

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
};
