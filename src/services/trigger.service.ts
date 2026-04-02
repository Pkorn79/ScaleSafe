import axios from 'axios';
import { triggerRepository } from '../repositories/trigger.repository';
import { logger } from '../utils/logger';

const RETRY_DELAYS = [1000, 5000, 30000]; // 1s, 5s, 30s

async function postWithRetry(url: string, payload: Record<string, unknown>): Promise<boolean> {
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      const response = await axios.post(url, payload, { timeout: 10000 });
      if (response.status >= 200 && response.status < 300) return true;
      logger.warn({ url, status: response.status, attempt }, 'Trigger POST non-2xx');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ url, attempt, error: message }, 'Trigger POST failed');
    }
    if (attempt < RETRY_DELAYS.length) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt]));
    }
  }
  return false;
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
        const success = await postWithRetry(sub.subscription_url, payload);
        if (success) {
          sent++;
        } else {
          failed++;
          logger.error(
            { locationId, triggerKey, subscriptionUrl: sub.subscription_url },
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
