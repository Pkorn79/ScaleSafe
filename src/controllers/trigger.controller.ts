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

function stringCandidates(...values: unknown[]): string[] {
  return values
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim());
}

function urlDebug(value: string): Record<string, string> | null {
  try {
    const url = new URL(value);
    return { protocol: url.protocol, host: url.hostname, path: url.pathname };
  } catch {
    return null;
  }
}

function findTriggerKey(body: Record<string, any>): string {
  return firstString(
    body.triggerKey,
    body.trigger_key,
    body.triggerName,
    body.trigger_name,
    body.name,
    body.label,
    body.workflowTriggerName,
    body.workflow_trigger_name,
    body.trigger?.key,
    body.trigger?.triggerKey,
    body.trigger?.trigger_key,
    body.trigger?.name,
    body.trigger?.label,
    body.event?.triggerKey,
    body.event?.trigger_key,
    body.event?.name,
    body.event?.label,
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

function findLifecycleType(body: Record<string, any>): string {
  return firstString(
    body.type,
    body.eventType,
    body.event_type,
    body.action,
    body.triggerData?.eventType,
    body.triggerData?.event_type,
    body.triggerData?.type,
    body.event?.type,
    body.event?.eventType,
    body.event?.event_type,
    body.meta?.eventType,
    body.meta?.event_type,
    body.meta?.type,
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
      const type = findLifecycleType(body).toLowerCase();
      const locationId = firstString(
        body.locationId,
        body.location_id,
        body.location?.id,
        body.trigger?.locationId,
        body.trigger?.location_id,
        body.event?.locationId,
        body.event?.location_id,
        body.extras?.locationId,
        body.extras?.location_id,
        body.data?.locationId,
        body.data?.location_id,
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
        body.trigger?.subscriptionUrl,
        body.trigger?.subscription_url,
        body.trigger?.targetUrl,
        body.trigger?.target_url,
        body.event?.subscriptionUrl,
        body.event?.subscription_url,
        body.event?.targetUrl,
        body.event?.target_url,
        body.data?.subscriptionUrl,
        body.data?.subscription_url,
        body.data?.targetUrl,
        body.data?.target_url,
        body.triggerData?.targetUrl,
        body.triggerData?.target_url,
        body.triggerData?.subscriptionUrl,
        body.triggerData?.subscription_url,
        body.triggerData?.url,
        body.meta?.subscriptionUrl,
        body.meta?.subscription_url,
        body.meta?.targetUrl,
        body.meta?.target_url,
        body.meta?.url,
      );

      if (!type || !locationId || !triggerKey || !subscriptionUrl) {
        const lifecycleTypeCandidates = stringCandidates(
          body.type,
          body.eventType,
          body.event_type,
          body.action,
          body.triggerData?.eventType,
          body.triggerData?.event_type,
          body.triggerData?.type,
          body.event?.type,
          body.event?.eventType,
          body.event?.event_type,
          body.meta?.eventType,
          body.meta?.event_type,
          body.meta?.type,
        );
        const locationIdCandidates = stringCandidates(
          body.locationId,
          body.location_id,
          body.location?.id,
          body.trigger?.locationId,
          body.trigger?.location_id,
          body.event?.locationId,
          body.event?.location_id,
          body.extras?.locationId,
          body.extras?.location_id,
          body.data?.locationId,
          body.data?.location_id,
          body.triggerData?.locationId,
          body.triggerData?.location_id,
          body.meta?.locationId,
          body.meta?.location_id,
        );
        logger.warn(
          {
            bodyKeys: Object.keys(body),
            triggerDataKeys: body.triggerData ? Object.keys(body.triggerData) : [],
            extrasKeys: body.extras ? Object.keys(body.extras) : [],
            metaKeys: body.meta ? Object.keys(body.meta) : [],
            rawTriggerKey,
            normalizedTriggerKey: triggerKey,
            lifecycleTypeCandidates,
            locationIdCandidates,
            subscriptionUrlDebug: subscriptionUrl ? urlDebug(subscriptionUrl) : null,
          },
          'Invalid trigger subscription payload',
        );
        throw new ValidationError('type, locationId, valid triggerKey, subscriptionUrl required');
      }

      if (!isAllowedTriggerSubscriptionUrl(String(subscriptionUrl))) {
        logger.warn({
          locationId,
          triggerKey,
          rawTriggerKey,
          type,
          subscriptionUrlDebug: urlDebug(String(subscriptionUrl)),
        }, 'Rejected unsupported trigger subscription URL');
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
