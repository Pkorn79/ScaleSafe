import axios from 'axios';
import { ghlApi } from '../clients/ghl.client';
import { getSupabase } from '../clients/supabase.client';
import { triggerRepository } from '../repositories/trigger.repository';
import { logger } from '../utils/logger';

const RETRY_DELAYS = [1000, 5000, 30000]; // 1s, 5s, 30s
const GHL_TRIGGER_EXECUTE_URL = 'services.leadconnectorhq.com/workflows-marketplace/triggers/execute';

interface TriggerDeliveryResult {
  success: boolean;
  httpStatus?: number;
  attemptCount: number;
  errorMessage?: string;
  status?: 'sent' | 'failed' | 'no_subscription';
}

function normalizeTriggerPayload(
  locationId: string,
  triggerKey: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {
    event_type: String(payload.event_type || payload.eventType || triggerKey.replace(/^ss_/, '')),
    location_id: locationId,
    locationId,
    ...payload,
  };

  if (normalized.contact_id && !normalized.contactId) {
    normalized.contactId = normalized.contact_id;
  }
  if (normalized.contactId && !normalized.contact_id) {
    normalized.contact_id = normalized.contactId;
  }
  if (normalized.enrollment_id && !normalized.enrollmentId) {
    normalized.enrollmentId = normalized.enrollment_id;
  }
  if (normalized.enrollmentId && !normalized.enrollment_id) {
    normalized.enrollment_id = normalized.enrollmentId;
  }
  if (normalized.offer_id && !normalized.offerId) {
    normalized.offerId = normalized.offer_id;
  }
  if (normalized.offerId && !normalized.offer_id) {
    normalized.offer_id = normalized.offerId;
  }

  return normalized;
}

function isGhlTriggerExecuteUrl(url: string): boolean {
  return url.includes(GHL_TRIGGER_EXECUTE_URL);
}

function isInactiveGhlTriggerError(message?: string): boolean {
  return Boolean(message && /trigger with id: .*inactive/i.test(message));
}

async function postTriggerUrl(
  locationId: string,
  url: string,
  payload: Record<string, unknown>,
): Promise<{ status: number }> {
  if (isGhlTriggerExecuteUrl(url)) {
    const api = await ghlApi(locationId);
    return api.post(url, payload, { timeout: 10000 });
  }

  return axios.post(url, payload, { timeout: 10000 });
}

async function postWithRetry(
  locationId: string,
  url: string,
  payload: Record<string, unknown>,
): Promise<TriggerDeliveryResult> {
  let lastStatus: number | undefined;
  let lastError: string | undefined;

  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      const response = await postTriggerUrl(locationId, url, payload);
      lastStatus = response.status;
      if (response.status >= 200 && response.status < 300) {
        return { success: true, httpStatus: response.status, attemptCount: attempt + 1 };
      }
      logger.warn({ url, status: response.status, attempt }, 'Trigger POST non-2xx');
    } catch (err: any) {
      if (err?.response?.status) lastStatus = err.response.status;
      const message = err instanceof Error ? err.message : String(err);
      lastError = message;
      logger.warn({ url, attempt, status: lastStatus, error: message }, 'Trigger POST failed');
      if (isInactiveGhlTriggerError(message)) {
        return {
          success: false,
          httpStatus: lastStatus,
          attemptCount: attempt + 1,
          errorMessage: message,
        };
      }
    }
    if (attempt < RETRY_DELAYS.length) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt]));
    }
  }

  return {
    success: false,
    httpStatus: lastStatus,
    attemptCount: RETRY_DELAYS.length + 1,
    errorMessage: lastError || (lastStatus ? `HTTP ${lastStatus}` : 'Unknown trigger delivery failure'),
  };
}

async function recordTriggerDelivery(params: {
  locationId: string;
  triggerKey: string;
  subscriptionUrl: string;
  result: TriggerDeliveryResult;
  payload: Record<string, unknown>;
}): Promise<void> {
  try {
    const supabase = getSupabase();
    await supabase
      .from('trigger_delivery_logs')
      .insert({
        location_id: params.locationId,
        trigger_key: params.triggerKey,
        subscription_url: params.subscriptionUrl,
        status: params.result.status || (params.result.success ? 'sent' : 'failed'),
        http_status: params.result.httpStatus ?? null,
        attempt_count: params.result.attemptCount,
        error_message: params.result.errorMessage ?? null,
        payload: params.payload,
      });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.debug({ err: message, triggerKey: params.triggerKey }, 'Trigger delivery log insert skipped');
  }
}

export const triggerService = {
  /**
   * Fire a trigger to all active subscriptions for a location + trigger key.
   * Each subscription URL receives the payload via POST.
   * Retries up to 3 times with exponential backoff on failure.
   */
  async fireTrigger(
    locationId: string,
    triggerKey: string,
    payload: Record<string, unknown>,
  ): Promise<{ sent: number; failed: number }> {
    const subscriptions = await triggerRepository.getActiveSubscriptions(locationId, triggerKey);
    const normalizedPayload = normalizeTriggerPayload(locationId, triggerKey, payload);

    if (subscriptions.length === 0) {
      await recordTriggerDelivery({
        locationId,
        triggerKey,
        subscriptionUrl: 'no_subscription',
        result: {
          success: false,
          status: 'no_subscription',
          attemptCount: 0,
          errorMessage: 'No active GHL workflow subscriptions for this trigger key',
        },
        payload: normalizedPayload,
      });
      logger.warn({ locationId, triggerKey }, 'No active subscriptions for trigger');
      return { sent: 0, failed: 0 };
    }

    let sent = 0;
    let failed = 0;

    const results = await Promise.allSettled(
      subscriptions.map(async (sub) => {
        const result = await postWithRetry(locationId, sub.subscription_url, normalizedPayload);
        await recordTriggerDelivery({
          locationId,
          triggerKey,
          subscriptionUrl: sub.subscription_url,
          result,
          payload: normalizedPayload,
        });

        if (result.success) {
          sent++;
        } else {
          failed++;
          if (isInactiveGhlTriggerError(result.errorMessage)) {
            try {
              await triggerRepository.deactivateSubscription(locationId, triggerKey, sub.subscription_url);
              logger.warn(
                { locationId, triggerKey, subscriptionUrl: sub.subscription_url },
                'Deactivated stale inactive GHL trigger subscription',
              );
            } catch (err: any) {
              logger.warn(
                {
                  locationId,
                  triggerKey,
                  subscriptionUrl: sub.subscription_url,
                  err: err?.message || String(err),
                },
                'Failed to deactivate stale inactive GHL trigger subscription',
              );
            }
          }
          logger.error(
            {
              locationId,
              triggerKey,
              subscriptionUrl: sub.subscription_url,
              httpStatus: result.httpStatus,
              error: result.errorMessage,
            },
            'Trigger delivery failed after all retries',
          );
        }
      }),
    );

    logger.info(
      { locationId, triggerKey, total: subscriptions.length, sent, failed },
      'Trigger fired',
    );

    return { sent, failed };
  },
};
