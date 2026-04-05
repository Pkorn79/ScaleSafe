/**
 * Daily Health Check Job — Phase S4
 *
 * Iterates all Stripe-connected merchants and computes health snapshots.
 * Called from admin route or scheduler.
 */

import { getSupabase } from '../clients/supabase.client';
import { StripeHealthService } from '../services/stripe-health.service';
import { logger } from '../utils/logger';

/**
 * Run daily health check for all Stripe-connected merchants.
 * Rate-limited: 1-second pause between merchants to avoid Stripe API limits.
 */
export async function runDailyHealthCheck(): Promise<{ processed: number; failed: number }> {
  const healthService = new StripeHealthService();
  const supabase = getSupabase();

  // Get all merchants with Stripe connected
  const { data: merchants, error } = await supabase
    .from('merchants')
    .select('id, location_id')
    .eq('stripe_connected', true);

  if (error) {
    logger.error({ error }, 'Failed to fetch Stripe-connected merchants');
    return { processed: 0, failed: 0 };
  }

  if (!merchants || merchants.length === 0) {
    logger.info('No Stripe-connected merchants found for health check');
    return { processed: 0, failed: 0 };
  }

  let processed = 0;
  let failed = 0;

  for (const merchant of merchants) {
    try {
      await healthService.computeHealthSnapshot(merchant.id, merchant.location_id);
      processed++;
    } catch (err) {
      failed++;
      logger.error({ err, merchantId: merchant.id, locationId: merchant.location_id }, 'Health check failed for merchant');
    }

    // Rate limiting — 1 second between merchants to avoid Stripe rate limits
    if (merchants.indexOf(merchant) < merchants.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  logger.info({ processed, failed, total: merchants.length }, 'Daily health check complete');
  return { processed, failed };
}
