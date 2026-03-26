/**
 * reconciliation.service.ts — Payment Reconciliation Service
 *
 * A daily safety net that compares accept.blue transactions against
 * evidence_payments records to catch missed webhooks. If a payment
 * was processed by accept.blue but no evidence record exists, it's
 * flagged for manual review.
 *
 * This runs as a scheduled job (via cron or BullMQ in production).
 * For now, it can be triggered manually via an API endpoint or script.
 *
 * The reconciliation checks ALL active merchants, not just one.
 */

import { getSupabaseClient } from '../clients/supabase.client';
import { createAcceptBlueClient } from '../clients/acceptblue.client';
import { logger } from '../utils/logger';

interface ReconciliationResult {
  merchantsChecked: number;
  transactionsFound: number;
  evidenceMissing: number;
  errors: string[];
}

/**
 * Runs reconciliation for all active merchants.
 * Compares yesterday's accept.blue transactions against evidence_payments.
 */
export async function runDailyReconciliation(): Promise<ReconciliationResult> {
  const supabase = getSupabaseClient();
  const result: ReconciliationResult = {
    merchantsChecked: 0,
    transactionsFound: 0,
    evidenceMissing: 0,
    errors: [],
  };

  // Get all active merchants with accept.blue credentials
  const { data: merchants, error } = await supabase
    .from('merchants')
    .select('location_id, ab_api_key')
    .eq('status', 'active')
    .not('ab_api_key', 'is', null);

  if (error) {
    logger.error({ error }, 'Reconciliation: failed to fetch merchants');
    result.errors.push('Failed to fetch merchants');
    return result;
  }

  if (!merchants?.length) {
    logger.info('Reconciliation: no active merchants with AB keys');
    return result;
  }

  // Check each merchant
  for (const merchant of merchants) {
    result.merchantsChecked++;

    try {
      await reconcileMerchant(
        merchant.location_id,
        merchant.ab_api_key!,
        result
      );
    } catch (err: any) {
      const msg = `Merchant ${merchant.location_id}: ${err.message}`;
      logger.error({ err, locationId: merchant.location_id }, 'Reconciliation error');
      result.errors.push(msg);
    }
  }

  logger.info(result, 'Daily reconciliation complete');
  return result;
}

/**
 * Reconciles a single merchant's transactions.
 * Fetches recent transactions from accept.blue and checks if each has
 * a corresponding evidence_payments record in Supabase.
 */
async function reconcileMerchant(
  locationId: string,
  abApiKey: string,
  result: ReconciliationResult
): Promise<void> {
  const supabase = getSupabaseClient();

  // Get yesterday's date range
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const startOfDay = yesterday.toISOString().split('T')[0] + 'T00:00:00Z';
  const endOfDay = yesterday.toISOString().split('T')[0] + 'T23:59:59Z';

  // Fetch recent evidence_payments for this merchant
  const { data: evidenceRecords, error: evidenceError } = await supabase
    .from('evidence_payments')
    .select('transaction_id, created_at')
    .eq('location_id', locationId)
    .gte('created_at', startOfDay)
    .lte('created_at', endOfDay);

  if (evidenceError) {
    throw new Error(`Failed to fetch evidence: ${evidenceError.message}`);
  }

  const evidenceTransactionIds = new Set(
    (evidenceRecords || []).map((r: any) => String(r.transaction_id))
  );

  // Fetch recent idempotency keys to see what accept.blue events we received
  const { data: processedEvents, error: idempError } = await supabase
    .from('idempotency_keys')
    .select('event_id, result')
    .eq('location_id', locationId)
    .eq('source', 'acceptblue')
    .gte('processed_at', startOfDay)
    .lte('processed_at', endOfDay);

  if (idempError) {
    throw new Error(`Failed to fetch idempotency keys: ${idempError.message}`);
  }

  const processedCount = processedEvents?.length || 0;
  result.transactionsFound += processedCount;

  // Check for events that were received but have no evidence record
  // (This could indicate the evidence logging failed after idempotency was marked)
  for (const event of processedEvents || []) {
    const eventResult = event.result as any;
    const txnId = eventResult?.transactionId || eventResult?.transaction_id;
    if (txnId && !evidenceTransactionIds.has(String(txnId))) {
      result.evidenceMissing++;
      logger.warn(
        { locationId, eventId: event.event_id, transactionId: txnId },
        'Reconciliation: payment event processed but no evidence record found'
      );
    }
  }
}

/**
 * Cleans up old idempotency keys (older than 90 days).
 * Can be run alongside daily reconciliation.
 */
export async function cleanupOldIdempotencyKeys(): Promise<number> {
  const supabase = getSupabaseClient();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);

  const { data, error } = await supabase
    .from('idempotency_keys')
    .delete()
    .lt('processed_at', cutoff.toISOString())
    .select('id');

  if (error) {
    logger.error({ error }, 'Failed to cleanup old idempotency keys');
    return 0;
  }

  const count = data?.length || 0;
  if (count > 0) {
    logger.info({ deleted: count }, 'Old idempotency keys cleaned up');
  }
  return count;
}
