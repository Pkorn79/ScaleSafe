import axios from 'axios';
import { ghlApi } from '../clients/ghl.client';
import { getSupabase } from '../clients/supabase.client';
import { triggerRepository } from '../repositories/trigger.repository';
import { logger } from '../utils/logger';
import { isAllowedTriggerSubscriptionUrl } from '../utils/trigger-subscription-url';
import crypto from 'crypto';

const RETRY_DELAYS = [1000, 5000, 30000]; // 1s, 5s, 30s
interface TriggerDeliveryResult {
  success: boolean;
  httpStatus?: number;
  attemptCount: number;
  errorMessage?: string;
  status?: 'sent' | 'failed' | 'no_subscription';
}

const DELIVERY_KEY_FIELDS = new Set([
  'trigger_delivery_key',
  'triggerDeliveryKey',
]);

function stableSerialize(value: unknown, seen = new WeakSet<object>()): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : JSON.stringify(String(value));
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (typeof value !== 'object') return JSON.stringify(String(value));
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (seen.has(value)) return JSON.stringify('[Circular]');

  seen.add(value);
  let serialized: string;
  if (Array.isArray(value)) {
    serialized = `[${value.map((item) => stableSerialize(item, seen)).join(',')}]`;
  } else {
    const record = value as Record<string, unknown>;
    serialized = `{${Object.keys(record)
      .filter((key) => !DELIVERY_KEY_FIELDS.has(key))
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key], seen)}`)
      .join(',')}}`;
  }
  seen.delete(value);
  return serialized;
}

function buildDeliveryIdentity(
  normalized: Record<string, unknown>,
  eventIdentity: string,
): Record<string, unknown> {
  const isManualTest = normalized.manual_test === true
    || String(normalized.manualTest || '').toLowerCase() === 'true';
  const occurrence = firstNonBlank(
    normalized.event_id,
    normalized.eventId,
    normalized.source_event_id,
    normalized.sourceEventId,
    normalized.request_id,
    normalized.requestId,
    normalized.idempotency_key,
    normalized.idempotencyKey,
    isManualTest ? normalized.sent_at : undefined,
    isManualTest ? normalized.sentAt : undefined,
    normalized.payment_event_id,
    normalized.paymentEventId,
    normalized.transaction_id,
    normalized.transactionId,
    normalized.refund_id,
    normalized.refundId,
    normalized.dispute_id,
    normalized.disputeId,
    normalized.defense_id,
    normalized.defenseId,
    normalized.milestone_completion_id,
    normalized.milestoneCompletionId,
    normalized.milestone_id,
    normalized.milestoneId,
    normalized.signoff_id,
    normalized.signoffId,
    normalized.pulse_due_at,
    normalized.pulseDueAt,
    normalized.next_billing_date,
    normalized.nextBillingDate,
    normalized.next_payment_date,
    normalized.nextPaymentDate,
    normalized.scheduled_at,
    normalized.scheduledAt,
    normalized.occurred_at,
    normalized.occurredAt,
    normalized.completed_at,
    normalized.completedAt,
  );
  const identity: Record<string, unknown> = {
    eventIdentity,
    contactId: normalized.contact_id || '',
    enrollmentId: normalized.enrollment_id || '',
    offerId: normalized.offer_id || '',
    occurrence,
    reminderWindow: normalized.reminder_window || normalized.reminderWindow || '',
    paymentNumber: normalized.payment_number || normalized.paymentNumber || '',
    attemptCount: normalized.attempt_count || normalized.attemptCount || '',
  };

  // Older trigger call sites do not all provide an immutable event ID. Their
  // normalized payload remains the deterministic fallback until they do.
  if (!occurrence) identity.payloadFingerprint = stableSerialize(normalized);
  return identity;
}

function normalizeTriggerPayload(
  locationId: string,
  triggerKey: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const fallbackEventType = triggerKey.replace(/^ss_/, '');
  const eventType = firstNonBlank(payload.event_type, payload.eventType, fallbackEventType);
  const eventTypeAlias = firstNonBlank(payload.eventType, payload.event_type, eventType);
  const eventIdentity = firstNonBlank(
    payload.event_type_key,
    payload.eventTypeKey,
    payload.event_key,
    payload.eventKey,
    payload.app_event_type,
    payload.appEventType,
    payload.eventType,
    payload.event_type,
    fallbackEventType,
  );
  const normalized: Record<string, unknown> = {
    ...payload,
    event_type: eventType,
    eventType: eventTypeAlias,
    location_id: locationId,
    locationId,
  };

  for (const [snakeCase, camelCase] of [
    ['contact_id', 'contactId'],
    ['enrollment_id', 'enrollmentId'],
    ['offer_id', 'offerId'],
    ['payment_event_id', 'paymentEventId'],
    ['transaction_id', 'transactionId'],
    ['defense_id', 'defenseId'],
  ] as const) {
    const canonicalValue = firstNonBlank(normalized[snakeCase], normalized[camelCase]);
    if (canonicalValue) {
      normalized[snakeCase] = canonicalValue;
      normalized[camelCase] = canonicalValue;
    }
  }

  const deliveryKey = crypto
    .createHash('sha256')
    .update(`${locationId}|${triggerKey}|${stableSerialize(buildDeliveryIdentity(normalized, eventIdentity))}`)
    .digest('hex');
  normalized.trigger_delivery_key = deliveryKey;
  normalized.triggerDeliveryKey = deliveryKey;

  return normalized;
}

function firstNonBlank(...values: unknown[]): string {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

function isGhlTriggerExecuteUrl(url: string): boolean {
  return isAllowedTriggerSubscriptionUrl(url);
}

function isInactiveGhlTriggerError(message?: string): boolean {
  return Boolean(message && /trigger with id: .*(?:inactive|deleted)/i.test(message));
}

async function postTriggerUrl(
  locationId: string,
  url: string,
  payload: Record<string, unknown>,
): Promise<{ status: number }> {
  const deliveryKey = String(payload.trigger_delivery_key || payload.triggerDeliveryKey || '');
  const options = {
    timeout: 10000,
    headers: deliveryKey ? { 'Idempotency-Key': deliveryKey, 'X-ScaleSafe-Trigger-Key': deliveryKey } : undefined,
  };
  if (isGhlTriggerExecuteUrl(url)) {
    const api = await ghlApi(locationId);
    return api.post(url, payload, options);
  }

  return axios.post(url, payload, options);
}

function isAmbiguousNetworkFailure(err: any): boolean {
  const message = err instanceof Error ? err.message : String(err || '');
  if (err?.response?.status) return false;

  const code = String(err?.code || '').toUpperCase();
  return [
    'ECONNABORTED',
    'ECONNRESET',
    'EPIPE',
    'ETIMEDOUT',
    'ERR_NETWORK',
  ].includes(code) || /timeout|timed out|socket hang up|connection reset|broken pipe/i.test(message);
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
      if (isAmbiguousNetworkFailure(err)) {
        return {
          success: false,
          httpStatus: lastStatus,
          attemptCount: attempt + 1,
          errorMessage: `Ambiguous trigger delivery failure; not retried automatically. ${message}`,
        };
      }
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
  const deliveryKey = String(
    params.payload.trigger_delivery_key || params.payload.triggerDeliveryKey || '',
  );
  try {
    const supabase = getSupabase();
    const { error } = await supabase
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
    if (error) {
      logger.warn(
        { err: error.message || String(error), triggerKey: params.triggerKey, deliveryKey },
        'Trigger delivery log insert failed',
      );
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(
      { err: message, triggerKey: params.triggerKey, deliveryKey },
      'Trigger delivery log insert failed',
    );
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
    const deliveryKey = String(normalizedPayload.trigger_delivery_key || '');

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
      logger.warn({ locationId, triggerKey, deliveryKey }, 'No active subscriptions for trigger');
      return { sent: 0, failed: 0 };
    }

    let sent = 0;
    let failed = 0;

    const results = await Promise.allSettled(
      subscriptions.map(async (sub) => {
        if (!isAllowedTriggerSubscriptionUrl(sub.subscription_url)) {
          failed++;
          const result: TriggerDeliveryResult = {
            success: false,
            status: 'failed',
            attemptCount: 0,
            errorMessage: 'Unsupported trigger subscription URL',
          };
          await recordTriggerDelivery({
            locationId,
            triggerKey,
            subscriptionUrl: sub.subscription_url,
            result,
            payload: normalizedPayload,
          });
          logger.error(
            { locationId, triggerKey, subscriptionUrl: sub.subscription_url, deliveryKey },
            'Skipped unsupported trigger subscription URL',
          );
          return;
        }

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
                { locationId, triggerKey, subscriptionUrl: sub.subscription_url, deliveryKey },
                'Deactivated stale inactive GHL trigger subscription',
              );
            } catch (err: any) {
              logger.warn(
                {
                  locationId,
                  triggerKey,
                  subscriptionUrl: sub.subscription_url,
                  deliveryKey,
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
              deliveryKey,
              httpStatus: result.httpStatus,
              error: result.errorMessage,
            },
            'Trigger delivery failed after all retries',
          );
        }
      }),
    );

    logger.info(
      { locationId, triggerKey, deliveryKey, total: subscriptions.length, sent, failed },
      'Trigger fired',
    );

    return { sent, failed };
  },
};
