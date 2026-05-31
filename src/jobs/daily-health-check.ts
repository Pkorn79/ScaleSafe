/**
 * Daily Health Check Job — Phase S4 + Chargeback Ratio Monitoring
 *
 * Iterates all merchants with processors connected.
 * Per-processor: computes health snapshot + checks chargeback ratio thresholds.
 * Fires ss_chargeback_ratio_warning / ss_chargeback_ratio_critical per processor.
 */

import { getSupabase } from '../clients/supabase.client';
import { StripeHealthService } from '../services/stripe-health.service';
import { triggerService } from '../services/trigger.service';
import { logger } from '../utils/logger';
import { CHARGEBACK_THRESHOLDS } from '../constants/chargeback-thresholds';

export async function runDailyHealthCheck(): Promise<{ processed: number; failed: number }> {
  const healthService = new StripeHealthService();
  const supabase = getSupabase();

  // Get all merchants with any processor connected
  const { data: merchants, error } = await supabase
    .from('merchants')
    .select('id, location_id, stripe_connected');

  if (error) {
    logger.error({ error }, 'Failed to fetch merchants for health check');
    return { processed: 0, failed: 0 };
  }

  if (!merchants || merchants.length === 0) {
    logger.info('No merchants found for health check');
    return { processed: 0, failed: 0 };
  }

  let processed = 0;
  let failed = 0;

  for (const merchant of merchants) {
    try {
      // Stripe health check (if connected)
      if (merchant.stripe_connected) {
        const snapshot = await healthService.computeHealthSnapshot(merchant.id, merchant.location_id);
        await checkRatioThresholds(merchant.location_id, 'stripe', snapshot);
      }

      // NMI ratio check (count from payment_events + dispute_events)
      const { data: nmiConfig } = await supabase
        .from('processor_configs')
        .select('id')
        .eq('merchant_id', merchant.id)
        .eq('processor_type', 'nmi')
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();

      if (nmiConfig) {
        await checkNmiRatio(merchant.id, merchant.location_id);
      }

      processed++;
    } catch (err) {
      failed++;
      logger.error({ err, merchantId: merchant.id }, 'Health check failed for merchant');
    }

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  logger.info({ processed, failed, total: merchants.length }, 'Daily health check complete');
  return { processed, failed };
}

async function checkRatioThresholds(locationId: string, processor: string, snapshot: any): Promise<void> {
  if (!snapshot?.dispute_rate) return;

  const thresholds = processor === 'stripe' ? CHARGEBACK_THRESHOLDS.stripe : CHARGEBACK_THRESHOLDS.nmi;
  const ratio = snapshot.dispute_rate;
  const supabase = getSupabase();

  // Check if previous snapshot was below threshold (fire once on crossing)
  const { data: prevSnapshots } = await supabase
    .from('account_health_snapshots')
    .select('dispute_rate')
    .eq('location_id', locationId)
    .eq('processor', processor)
    .order('created_at', { ascending: false })
    .limit(2);

  const prevRate = prevSnapshots && prevSnapshots.length > 1 ? prevSnapshots[1].dispute_rate : 0;
  const trend = ratio > prevRate ? 'up' : ratio < prevRate ? 'down' : 'stable';

  if (ratio >= thresholds.critical && prevRate < thresholds.critical) {
    await triggerService.fireTrigger(locationId, 'ss_chargeback_ratio_critical', {
      location_id: locationId,
      processor,
      current_ratio: ratio,
      threshold: thresholds.critical,
      dispute_count: snapshot.dispute_count || 0,
      transaction_count: snapshot.transaction_count || 0,
      rolling_window_days: 30,
      trend,
    });
    logger.warn({ locationId, processor, ratio }, 'CRITICAL chargeback ratio threshold crossed');
  } else if (ratio >= thresholds.warning && prevRate < thresholds.warning) {
    await triggerService.fireTrigger(locationId, 'ss_chargeback_ratio_warning', {
      location_id: locationId,
      processor,
      current_ratio: ratio,
      threshold: thresholds.warning,
      dispute_count: snapshot.dispute_count || 0,
      transaction_count: snapshot.transaction_count || 0,
      rolling_window_days: 30,
      trend,
    });
    logger.warn({ locationId, processor, ratio }, 'WARNING chargeback ratio threshold crossed');
  }
}

async function checkNmiRatio(merchantId: string, locationId: string): Promise<void> {
  const supabase = getSupabase();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Count NMI transactions in last 30 days
  const { count: txCount } = await supabase
    .from('payment_events')
    .select('id', { count: 'exact', head: true })
    .eq('location_id', locationId)
    .eq('processor', 'nmi')
    .eq('event_type', 'sale')
    .gte('created_at', thirtyDaysAgo);

  // Count disputes (from evidence or dispute_events)
  const { count: disputeCount } = await supabase
    .from('dispute_events')
    .select('id', { count: 'exact', head: true })
    .eq('location_id', locationId)
    .gte('created_at', thirtyDaysAgo);

  if (!txCount || txCount === 0) return;

  const ratio = (disputeCount || 0) / txCount;

  // #23: persist today's NMI snapshot BEFORE evaluating thresholds so the crossing-guard in
  // checkRatioThresholds compares against yesterday's rate (prevSnapshots[1]). Without this,
  // no NMI snapshot ever exists, prevRate is always 0, and the chargeback-ratio trigger
  // re-fires every daily run instead of once when the ratio crosses the threshold.
  await supabase.from('account_health_snapshots').insert({
    merchant_id: merchantId,
    location_id: locationId,
    processor: 'nmi',
    computed_at: new Date().toISOString(),
    period_days: 30,
    total_charges: txCount,
    total_disputes: disputeCount || 0,
    total_efws: 0,
    dispute_rate: ratio,
    efw_rate: 0,
    disputes_won: 0,
    disputes_lost: 0,
    disputes_pending: 0,
    recovery_rate: 0,
    financial_exposure_cents: 0,
    avg_evidence_score: 0,
    reason_code_breakdown: {},
    risk_level: 'unknown',
    vamp_status: 'safe',
    mc_status: 'safe',
  } as any);

  await checkRatioThresholds(locationId, 'nmi', {
    dispute_rate: ratio,
    dispute_count: disputeCount || 0,
    transaction_count: txCount,
  });
}
