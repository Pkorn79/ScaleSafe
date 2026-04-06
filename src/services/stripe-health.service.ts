/**
 * Stripe Account Health Monitor — Phase S4, Module 6
 *
 * Computes and stores daily account health snapshots:
 * dispute rate, EFW rate, recovery rate, evidence completeness,
 * financial exposure, VAMP/MC threshold monitoring.
 */

const Stripe = require('stripe');
import { getSupabase } from '../clients/supabase.client';
import { logger } from '../utils/logger';
import type { AccountHealthSnapshot } from '../types/stripe-defense.types';

let _stripe: any = null;
function getStripe() {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY not configured');
    _stripe = Stripe(key, { apiVersion: '2024-12-18.acacia' });
  }
  return _stripe;
}

export class StripeHealthService {
  /**
   * Compute a health snapshot for a merchant, pulling live data from Stripe.
   * Stores result in account_health_snapshots table.
   */
  async computeHealthSnapshot(merchantId: string, locationId: string): Promise<AccountHealthSnapshot> {
    const supabase = getSupabase();

    // Look up the merchant's Stripe account ID
    const { data: merchant, error: merchantErr } = await supabase
      .from('merchants')
      .select('id, stripe_user_id, stripe_connected, location_id')
      .eq('id', merchantId)
      .eq('location_id', locationId)
      .single();

    if (merchantErr || !merchant) {
      throw new Error(`Merchant not found: ${merchantId}`);
    }
    if (!merchant.stripe_user_id) {
      throw new Error('Merchant has no Stripe account connected');
    }

    const stripeAccount = merchant.stripe_user_id;
    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);

    // Pull data from Stripe (parallel calls)
    let disputes: any, charges: any, efws: any;
    try {
      const results = await Promise.all([
        getStripe().disputes.list(
          { created: { gte: thirtyDaysAgo }, limit: 100 },
          { stripeAccount }
        ),
        getStripe().charges.list(
          { created: { gte: thirtyDaysAgo }, limit: 100 },
          { stripeAccount }
        ),
        getStripe().radar.earlyFraudWarnings.list(
          { created: { gte: thirtyDaysAgo }, limit: 100 },
          { stripeAccount }
        ).catch(() => ({ data: [] })), // EFW API may not be available
        getStripe().balanceTransactions.list(
          { type: 'adjustment', created: { gte: thirtyDaysAgo }, limit: 100 },
          { stripeAccount }
        ).catch(() => ({ data: [] })),
      ]);
      disputes = results[0];
      charges = results[1];
      efws = results[2];
    } catch (err: any) {
      logger.error({ err: err.message, merchantId, stripeAccount }, 'Failed to fetch Stripe data for health snapshot');
      throw new Error(`Stripe API error during health check: ${err.message}`);
    }

    // Compute metrics
    const totalCharges = charges.data.length;
    const totalDisputes = disputes.data.length;
    const totalEfws = efws.data.length;

    const disputeRate = totalCharges > 0 ? totalDisputes / totalCharges : 0;
    const efwRate = totalCharges > 0 ? totalEfws / totalCharges : 0;

    // Win/loss breakdown
    const won = disputes.data.filter((d: any) => d.status === 'won').length;
    const lost = disputes.data.filter((d: any) => d.status === 'lost').length;
    const pending = disputes.data.filter((d: any) => d.status !== 'won' && d.status !== 'lost').length;
    const recoveryRate = (won + lost) > 0 ? won / (won + lost) : 0;

    // Financial exposure: sum of pending dispute amounts
    const financialExposureCents = disputes.data
      .filter((d: any) => d.status !== 'won' && d.status !== 'lost')
      .reduce((sum: number, d: any) => sum + d.amount, 0);

    // Evidence completeness: pull from ScaleSafe evidence vault (if table exists)
    const { data: vaultEntries } = await supabase
      .from('stripe_evidence_vault')
      .select('evidence_score')
      .eq('merchant_id', merchantId);

    const avgEvidenceScore = vaultEntries?.length
      ? Math.round(vaultEntries.reduce((sum: number, e: any) => sum + (e.evidence_score || 0), 0) / vaultEntries.length)
      : 0;

    // Reason code breakdown
    const reasonBreakdown: Record<string, number> = {};
    for (const d of disputes.data) {
      const reason = (d as any).reason || 'unknown';
      reasonBreakdown[reason] = (reasonBreakdown[reason] || 0) + 1;
    }

    // Determine risk level, VAMP/MC status
    const riskLevel = this.assessRiskLevel(disputeRate, efwRate);
    const vampStatus = this.assessVampStatus(disputeRate);
    const mcStatus = this.assessMastercardStatus(disputeRate);

    // Store snapshot
    const snapshot: AccountHealthSnapshot = {
      merchant_id: merchantId,
      location_id: locationId,
      computed_at: new Date().toISOString(),
      period_days: 30,
      total_charges: totalCharges,
      total_disputes: totalDisputes,
      total_efws: totalEfws,
      dispute_rate: disputeRate,
      efw_rate: efwRate,
      disputes_won: won,
      disputes_lost: lost,
      disputes_pending: pending,
      recovery_rate: recoveryRate,
      financial_exposure_cents: financialExposureCents,
      avg_evidence_score: avgEvidenceScore,
      reason_code_breakdown: reasonBreakdown,
      risk_level: riskLevel,
      vamp_status: vampStatus,
      mc_status: mcStatus,
    };

    const { error: insertErr } = await supabase
      .from('account_health_snapshots')
      .insert(snapshot);

    if (insertErr) {
      logger.error({ err: insertErr, merchantId }, 'Failed to insert health snapshot');
      throw insertErr;
    }

    logger.info({ merchantId, locationId, riskLevel, disputeRate, vampStatus, mcStatus }, 'Health snapshot computed');
    return snapshot;
  }

  /**
   * Get the latest health snapshot for a merchant.
   */
  async getLatestSnapshot(merchantId: string, locationId: string): Promise<AccountHealthSnapshot | null> {
    const { data } = await getSupabase()
      .from('account_health_snapshots')
      .select('*')
      .eq('merchant_id', merchantId)
      .eq('location_id', locationId)
      .order('computed_at', { ascending: false })
      .limit(1)
      .single();

    return data || null;
  }

  /**
   * Get health snapshot history (last N snapshots) for trend analysis.
   */
  async getSnapshotHistory(merchantId: string, locationId: string, limit = 30): Promise<AccountHealthSnapshot[]> {
    const { data } = await getSupabase()
      .from('account_health_snapshots')
      .select('*')
      .eq('merchant_id', merchantId)
      .eq('location_id', locationId)
      .order('computed_at', { ascending: false })
      .limit(limit);

    return data || [];
  }

  /**
   * Assess overall risk level based on dispute and EFW rates.
   */
  assessRiskLevel(disputeRate: number, efwRate: number): string {
    if (disputeRate >= 0.009) return 'critical';   // 0.90% — Visa VAMP standard
    if (disputeRate >= 0.0065) return 'high';       // 0.65% — Visa VAMP early warning
    if (disputeRate >= 0.005) return 'elevated';    // 0.50% — approaching warning
    if (efwRate >= 0.005) return 'elevated';        // EFW rate concerning
    if (disputeRate >= 0.003) return 'moderate';    // 0.30% — monitor
    return 'low';
  }

  /**
   * Assess Visa VAMP program status based on dispute rate.
   */
  assessVampStatus(disputeRate: number): string {
    if (disputeRate >= 0.009) return 'standard_program';   // 0.90%
    if (disputeRate >= 0.0065) return 'early_warning';      // 0.65%
    if (disputeRate >= 0.005) return 'approaching';         // 0.50%
    return 'safe';
  }

  /**
   * Assess Mastercard ECM program status based on dispute rate.
   */
  assessMastercardStatus(disputeRate: number): string {
    if (disputeRate >= 0.015) return 'ecm_program';   // 1.50%
    if (disputeRate >= 0.0075) return 'warning';       // 0.75%
    return 'safe';
  }

  /**
   * Check if WholePay upgrade should be suggested.
   * Triggers when dispute rate exceeds early warning AND evidence is incomplete.
   */
  shouldSuggestUpgrade(disputeRate: number, evidenceCompleteness: number): boolean {
    return disputeRate > 0.0065 && evidenceCompleteness < 70;
  }
}

export const stripeHealthService = new StripeHealthService();
