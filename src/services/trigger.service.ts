import axios from 'axios';
import { getSupabase } from '../clients/supabase.client';
import { triggerRepository } from '../repositories/trigger.repository';
import { logger } from '../utils/logger';

const RETRY_DELAYS = [1000, 5000, 30000]; // 1s, 5s, 30s

interface TriggerDeliveryResult {
  success: boolean;
  httpStatus?: number;
  attemptCount: number;
  errorMessage?: string;
}

async function postWithRetry(url: string, payload: Record<string, unknown>): Promise<TriggerDeliveryResult> {
  let lastStatus: number | undefined;
  let lastError: string | undefined;

  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      const response = await axios.post(url, payload, { timeout: 10000 });
      lastStatus = response.status;
      if (response.status >= 200 && response.status < 300) {
        return { success: true, httpStatus: response.status, attemptCount: attempt + 1 };
      }
      logger.warn({ url, status: response.status, attempt }, 'Trigger POST non-2xx');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      lastError = message;
      logger.warn({ url, attempt, error: message }, 'Trigger POST failed');
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
        status: params.result.success ? 'sent' : 'failed',
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

    if (subscriptions.length === 0) {
      logger.debug({ locationId, triggerKey }, 'No active subscriptions for trigger');
      return { sent: 0, failed: 0 };
    }

    let sent = 0;
    let failed = 0;

    const results = await Promise.allSettled(
      subscriptions.map(async (sub) => {
        const result = await postWithRetry(sub.subscription_url, payload);
        await recordTriggerDelivery({
          locationId,
          triggerKey,
          subscriptionUrl: sub.subscription_url,
          result,
          payload,
        });

        if (result.success) {
          sent++;
        } else {
          failed++;
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
