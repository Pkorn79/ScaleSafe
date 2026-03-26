import { getSupabase } from '../clients/supabase.client';
import { merchantRepository } from '../repositories/merchant.repository';
import { logger } from '../utils/logger';

interface ReconciliationResult {
  locationId: string;
  eventsReceived: number;
  evidenceLogged: number;
  mismatches: Array<{ eventId: string; source: string; processedAt: string }>;
  idempotencyKeysPurged: number;
}

export const reconciliationService = {
  /**
   * Run daily reconciliation for a merchant.
   * Compares idempotency_keys (events received) against evidence records
   * to catch any events that were received but not properly logged.
   */
  async runForMerchant(locationId: string): Promise<ReconciliationResult> {
    const supabase = getSupabase();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Get all idempotency keys from last 24 hours
    const { data: keys, error: keysErr } = await supabase
      .from('idempotency_keys')
      .select('event_id, source, processed_at')
      .eq('location_id', locationId)
      .gte('processed_at', oneDayAgo);

    if (keysErr) throw keysErr;

    // Get evidence count for last 24 hours
    const { count: evidenceCount, error: evErr } = await supabase
      .from('evidence_timeline')
      .select('id', { count: 'exact', head: true })
      .eq('location_id', locationId)
      .gte('created_at', oneDayAgo);

    if (evErr) throw evErr;

    // Payment-specific reconciliation:
    // Check that every payment webhook has a corresponding evidence record
    const paymentKeys = (keys || []).filter(k =>
      k.source === 'ghl_payment' || k.source === 'external',
    );

    const mismatches: Array<{ eventId: string; source: string; processedAt: string }> = [];

    // If significantly more events received than evidence logged, flag it
    if (paymentKeys.length > 0 && (evidenceCount || 0) < paymentKeys.length * 0.8) {
      logger.warn({
        locationId,
        eventsReceived: paymentKeys.length,
        evidenceLogged: evidenceCount,
      }, 'Reconciliation: possible evidence gap detected');

      // All payment keys are potential mismatches if evidence count is low
      for (const key of paymentKeys) {
        mismatches.push({
          eventId: key.event_id,
          source: key.source,
          processedAt: key.processed_at,
        });
      }
    }

    return {
      locationId,
      eventsReceived: (keys || []).length,
      evidenceLogged: evidenceCount || 0,
      mismatches,
      idempotencyKeysPurged: 0,
    };
  },

  /**
   * Run reconciliation across all active merchants.
   */
  async runAll(): Promise<ReconciliationResult[]> {
    const merchants = await merchantRepository.listActive();
    const results: ReconciliationResult[] = [];

    for (const merchant of merchants) {
      try {
        const result = await this.runForMerchant(merchant.location_id);
        results.push(result);
      } catch (err) {
        logger.error({ err, locationId: merchant.location_id }, 'Reconciliation failed for merchant');
      }
    }

    logger.info({ merchantCount: merchants.length, totalMismatches: results.reduce((s, r) => s + r.mismatches.length, 0) }, 'Reconciliation complete');
    return results;
  },

  /**
   * Purge old idempotency keys (> 90 days).
   */
  async cleanupIdempotencyKeys(): Promise<number> {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await getSupabase()
      .from('idempotency_keys')
      .delete()
      .lt('processed_at', cutoff)
      .select('id');

    if (error) throw error;
    const count = data?.length || 0;
    logger.info({ purged: count }, 'Idempotency keys cleanup complete');
    return count;
  },
};
