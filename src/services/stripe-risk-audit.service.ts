import { getSupabase } from '../clients/supabase.client';
import { config } from '../config';
import type { ModuleRecommendation, RiskAuditResult } from '../types/stripe-defense.types';
import { logger } from '../utils/logger';

const Stripe = require('stripe');

const RISK_LEVELS = new Set<RiskAuditResult['overallRiskLevel']>([
  'low', 'moderate', 'elevated', 'high', 'critical', 'unknown',
]);

export function normalizeRiskAuditResult(row: Record<string, any>): RiskAuditResult {
  const riskLevel = row.overall_risk_level ?? row.overallRiskLevel ?? 'unknown';
  return {
    id: String(row.id || ''),
    merchantId: String(row.merchant_id ?? row.merchantId ?? ''),
    createdAt: String(row.created_at ?? row.createdAt ?? ''),
    auditPeriodStart: String(row.audit_period_start ?? row.auditPeriodStart ?? ''),
    auditPeriodEnd: String(row.audit_period_end ?? row.auditPeriodEnd ?? ''),
    totalCharges: Number(row.total_charges ?? row.totalCharges ?? 0),
    totalDisputes: Number(row.total_disputes ?? row.totalDisputes ?? 0),
    totalEfws: Number(row.total_efws ?? row.totalEfws ?? 0),
    totalDisputeAmountCents: Number(row.total_dispute_amount_cents ?? row.totalDisputeAmountCents ?? 0),
    disputesWon: Number(row.disputes_won ?? row.disputesWon ?? 0),
    disputesLost: Number(row.disputes_lost ?? row.disputesLost ?? 0),
    disputesPending: Number(row.disputes_pending ?? row.disputesPending ?? 0),
    reasonCodeBreakdown: row.reason_code_breakdown ?? row.reasonCodeBreakdown ?? {},
    avgTransactionCents: Number(row.avg_transaction_cents ?? row.avgTransactionCents ?? 0),
    repeatCustomerCount: Number(row.repeat_customer_count ?? row.repeatCustomerCount ?? 0),
    uniqueCustomerCount: Number(row.unique_customer_count ?? row.uniqueCustomerCount ?? 0),
    scoreDisputeRate: Number(row.score_dispute_rate ?? row.scoreDisputeRate ?? 0),
    scoreEvidenceReadiness: Number(row.score_evidence_readiness ?? row.scoreEvidenceReadiness ?? 0),
    scoreDescriptorQuality: Number(row.score_descriptor_quality ?? row.scoreDescriptorQuality ?? 0),
    scoreRepeatClientRate: Number(row.score_repeat_client_rate ?? row.scoreRepeatClientRate ?? 0),
    scoreRadarDataQuality: Number(row.score_radar_data_quality ?? row.scoreRadarDataQuality ?? 0),
    overallRiskLevel: RISK_LEVELS.has(riskLevel) ? riskLevel : 'unknown',
    moduleRecommendations: Array.isArray(row.module_recommendations ?? row.moduleRecommendations)
      ? (row.module_recommendations ?? row.moduleRecommendations)
      : [],
  };
}

/**
 * Per-transaction data checks only make sense for customer-present
 * transactions. Stripe-billed subscription invoices (pi.invoice set) are
 * merchant-initiated: the customer isn't there, so no session IP or email can
 * ever be on those PaymentIntents. Scoring them as "missing data" permanently
 * penalizes recurring-revenue merchants whose enrollments carry full consent
 * forensics in ScaleSafe.
 */
export function customerPresentPaymentIntents(pis: any[]): any[] {
  return (pis || []).filter((pi: any) => !pi?.invoice);
}

export const stripeRiskAuditService = {
  async runAudit(merchantId: string): Promise<RiskAuditResult> {
    const supabase = getSupabase();

    // Get merchant's stripe_user_id
    const { data: merchant } = await supabase
      .from('merchants')
      .select('stripe_user_id')
      .eq('id', merchantId)
      .single();

    if (!merchant?.stripe_user_id) {
      throw new Error('Merchant has no Stripe account connected');
    }

    const stripe = new Stripe(config.stripe.secretKey);
    const stripeAccount = merchant.stripe_user_id;
    const ninetyDaysAgo = Math.floor(Date.now() / 1000) - (90 * 24 * 60 * 60);
    const now = new Date();

    // Pull data in parallel with error handling
    let disputes: any[], charges: any[], efws: any[], customers: any[], recentPIs: any[];
    try {
      [disputes, charges, efws, customers, recentPIs] = await Promise.all([
        this.fetchAll(stripe, 'disputes', { created: { gte: ninetyDaysAgo } }, stripeAccount),
        this.fetchAll(stripe, 'charges', { created: { gte: ninetyDaysAgo } }, stripeAccount),
        this.fetchEfws(stripe, ninetyDaysAgo, stripeAccount),
        stripe.customers.list({ limit: 100 }, { stripeAccount }).then((r: any) => r.data).catch(() => []),
        stripe.paymentIntents.list({ limit: 100 }, { stripeAccount }).then((r: any) => r.data).catch(() => []),
      ]);
    } catch (err: any) {
      logger.error({ err: err.message, merchantId, stripeAccount }, 'Failed to fetch Stripe data for risk audit');
      throw new Error(`Stripe API error during risk audit: ${err.message}`);
    }

    // Compute raw stats
    const totalCharges = charges.length;
    const totalDisputes = disputes.length;
    const totalEfws = efws.length;
    const totalDisputeAmountCents = disputes.reduce((sum: number, d: any) => sum + (d.amount || 0), 0);
    const disputesWon = disputes.filter((d: any) => d.status === 'won').length;
    const disputesLost = disputes.filter((d: any) => d.status === 'lost').length;
    const disputesPending = disputes.filter((d: any) =>
      d.status === 'needs_response' || d.status === 'under_review'
    ).length;

    // Reason code breakdown
    const reasonBreakdown: Record<string, number> = {};
    disputes.forEach((d: any) => {
      reasonBreakdown[d.reason] = (reasonBreakdown[d.reason] || 0) + 1;
    });

    const totalAmountCents = charges.reduce((sum: number, c: any) => sum + (c.amount || 0), 0);
    const avgTransactionCents = totalCharges > 0 ? Math.round(totalAmountCents / totalCharges) : 0;

    // Repeat customers
    const customerChargeCounts: Record<string, number> = {};
    charges.forEach((c: any) => {
      const cid = typeof c.customer === 'string' ? c.customer : c.customer?.id;
      if (cid) customerChargeCounts[cid] = (customerChargeCounts[cid] || 0) + 1;
    });
    const uniqueCustomerCount = Object.keys(customerChargeCounts).length;
    const repeatCustomerCount = Object.values(customerChargeCounts).filter(n => n > 1).length;

    const customerPresentPIs = customerPresentPaymentIntents(recentPIs);

    // Compute 5 scores
    const scoreDisputeRate = this.computeDisputeRateScore(totalDisputes, totalCharges);
    const scoreEvidenceReadiness = this.computeEvidenceReadinessScore(customerPresentPIs, disputes);
    const scoreDescriptorQuality = await this.computeDescriptorQualityScore(stripe, stripeAccount, recentPIs);
    const scoreRepeatClientRate = this.computeRepeatClientRateScore(repeatCustomerCount, uniqueCustomerCount);
    const scoreRadarDataQuality = this.computeRadarDataQualityScore(customerPresentPIs);

    // Overall risk level
    const avgScore = (scoreDisputeRate + scoreEvidenceReadiness + scoreDescriptorQuality + scoreRepeatClientRate + scoreRadarDataQuality) / 5;
    const overallRiskLevel = avgScore >= 80 ? 'low'
      : avgScore >= 65 ? 'moderate'
      : avgScore >= 50 ? 'elevated'
      : avgScore >= 30 ? 'high'
      : 'critical';

    // Module recommendations
    const disputeRate = totalCharges > 0 ? totalDisputes / totalCharges : 0;
    const recommendations = this.generateModuleRecommendations(
      disputeRate, scoreEvidenceReadiness, scoreDescriptorQuality,
      repeatCustomerCount, uniqueCustomerCount, scoreRadarDataQuality,
    );

    // Store
    const { data, error } = await supabase
      .from('risk_audit_results')
      .insert({
        merchant_id: merchantId,
        audit_period_start: new Date(ninetyDaysAgo * 1000).toISOString(),
        audit_period_end: now.toISOString(),
        total_charges: totalCharges,
        total_disputes: totalDisputes,
        total_efws: totalEfws,
        total_dispute_amount_cents: totalDisputeAmountCents,
        disputes_won: disputesWon,
        disputes_lost: disputesLost,
        disputes_pending: disputesPending,
        reason_code_breakdown: reasonBreakdown,
        avg_transaction_cents: avgTransactionCents,
        repeat_customer_count: repeatCustomerCount,
        unique_customer_count: uniqueCustomerCount,
        sampled_transactions: recentPIs.slice(0, 5).map((pi: any) => ({
          id: pi.id, amount: pi.amount, status: pi.status,
          hasMetadata: Object.keys(pi.metadata || {}).length > 0,
        })),
        score_dispute_rate: scoreDisputeRate,
        score_evidence_readiness: scoreEvidenceReadiness,
        score_descriptor_quality: scoreDescriptorQuality,
        score_repeat_client_rate: scoreRepeatClientRate,
        score_radar_data_quality: scoreRadarDataQuality,
        overall_risk_level: overallRiskLevel,
        module_recommendations: recommendations,
      })
      .select()
      .single();

    if (error) {
      logger.error({ err: error }, 'Failed to store risk audit');
      throw error;
    }

    logger.info({ merchantId, overallRiskLevel, scoreDisputeRate }, 'Risk audit completed');
    return normalizeRiskAuditResult(data);
  },

  async getLatestAudit(merchantId: string): Promise<RiskAuditResult | null> {
    const { data } = await getSupabase()
      .from('risk_audit_results')
      .select('*')
      .eq('merchant_id', merchantId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    return data ? normalizeRiskAuditResult(data) : null;
  },

  // ─── Score computations ────────────────────────────────

  computeDisputeRateScore(totalDisputes: number, totalCharges: number): number {
    if (totalCharges === 0) return 100;
    const rate = totalDisputes / totalCharges;
    if (rate === 0) return 100;
    if (rate < 0.004) return 80;
    if (rate < 0.0065) return 60;
    if (rate < 0.0075) return 40;
    if (rate < 0.009) return 20;
    return 0;
  },

  // Callers pass customer-present PaymentIntents only — merchant-initiated
  // subscription charges can never carry session data and must not be scored.
  computeEvidenceReadinessScore(recentPIs: any[], disputes: any[]): number {
    // No customer-present transactions in the sample = nothing measurable is
    // missing. Do not raise a false alarm for recurring-only billing windows.
    if (recentPIs.length === 0) return 100;
    let score = 0;
    const total = recentPIs.length;

    const withEmail = recentPIs.filter((pi: any) => pi.receipt_email).length;
    if (withEmail / total > 0.8) score += 20;

    const withDescription = recentPIs.filter((pi: any) => pi.description).length;
    if (withDescription / total > 0.8) score += 20;

    const withIp = recentPIs.filter((pi: any) => pi.metadata?.customer_ip).length;
    if (withIp / total > 0.8) score += 20;

    // Billing address — check if customer objects have address (approximation)
    const withCustomer = recentPIs.filter((pi: any) => pi.customer).length;
    if (withCustomer / total > 0.8) score += 20;

    // Past dispute evidence submission
    const withEvidence = disputes.filter((d: any) => d.evidence?.customer_name || d.evidence_details?.has_evidence).length;
    if (disputes.length > 0 && withEvidence / disputes.length > 0.5) score += 20;
    else if (disputes.length === 0) score += 20;

    return score;
  },

  async computeDescriptorQualityScore(stripe: any, stripeAccount: string, recentPIs: any[]): Promise<number> {
    try {
      const account = await stripe.accounts.retrieve(stripeAccount);
      const descriptor = account.settings?.payments?.statement_descriptor || '';
      const hasDescriptor = descriptor.length > 3 && descriptor.toLowerCase() !== 'stripe';

      const withSuffix = recentPIs.filter((pi: any) => pi.statement_descriptor_suffix).length;
      const hasSuffix = recentPIs.length > 0 && withSuffix / recentPIs.length > 0.5;

      if (hasDescriptor && hasSuffix) return 100;
      if (hasDescriptor) return 50;
      return 0;
    } catch {
      return 0;
    }
  },

  computeRepeatClientRateScore(repeatCount: number, uniqueCount: number): number {
    if (uniqueCount === 0) return 0;
    const rate = repeatCount / uniqueCount;
    if (rate > 0.5) return 100;
    if (rate > 0.3) return 80;
    if (rate > 0.15) return 60;
    if (rate > 0.05) return 40;
    return 20;
  },

  // Callers pass customer-present PaymentIntents only — see runAudit.
  computeRadarDataQualityScore(recentPIs: any[]): number {
    if (recentPIs.length === 0) return 100;
    let score = 0;
    const total = recentPIs.length;

    const withIp = recentPIs.filter((pi: any) => pi.metadata?.customer_ip).length;
    if (withIp / total > 0.8) score += 50;

    const withEmail = recentPIs.filter((pi: any) => pi.receipt_email || pi.metadata?.customer_email).length;
    if (withEmail / total > 0.8) score += 50;

    return score;
  },

  generateModuleRecommendations(
    disputeRate: number,
    evidenceScore: number,
    descriptorScore: number,
    repeatCount: number,
    uniqueCount: number,
    radarScore: number,
  ): ModuleRecommendation[] {
    const recs: ModuleRecommendation[] = [];

    if (disputeRate > 0.0065) {
      recs.push({
        module: 'visa_pre_dispute_shield',
        priority: 'critical',
        reason: 'Your dispute rate exceeds Visa VAMP early warning threshold',
        metric: `Current rate: ${(disputeRate * 100).toFixed(2)}%`,
      });
    }

    if (evidenceScore < 60) {
      recs.push({
        module: 'evidence_vault',
        priority: 'high',
        reason: 'Customer-present transactions are missing evidence fields on the Stripe charge (email, IP, description)',
        metric: `${evidenceScore}% evidence completeness on customer-present transactions`,
      });
    }

    if (descriptorScore < 50) {
      recs.push({
        module: 'statement_descriptors',
        priority: 'medium',
        reason: 'Your statement descriptor is missing or generic',
        metric: `Descriptor quality score: ${descriptorScore}/100`,
      });
    }

    const repeatRate = uniqueCount > 0 ? (repeatCount / uniqueCount * 100) : 0;
    if (repeatRate > 30) {
      recs.push({
        module: 'ce30_blocking',
        priority: 'high',
        reason: 'Your repeat client rate qualifies many transactions for CE 3.0 dispute blocking',
        metric: `${repeatCount} repeat clients (${repeatRate.toFixed(0)}% of volume)`,
      });
    }

    if (radarScore < 50) {
      recs.push({
        module: 'radar_enrichment',
        priority: 'medium',
        reason: 'Customer IP and email data is missing from most customer-present transactions',
        metric: `Radar data quality: ${radarScore}/100 (customer-present transactions)`,
      });
    }

    return recs;
  },

  // ─── Helpers ───────────────────────────────────────────

  async fetchAll(stripe: any, resource: string, params: any, stripeAccount: string): Promise<any[]> {
    const items: any[] = [];
    let hasMore = true;
    let startingAfter: string | undefined;

    while (hasMore && items.length < 500) {
      const opts: any = { ...params, limit: 100 };
      if (startingAfter) opts.starting_after = startingAfter;

      const result = await (stripe as any)[resource].list(opts, { stripeAccount });
      items.push(...result.data);
      hasMore = result.has_more;
      if (result.data.length > 0) {
        startingAfter = result.data[result.data.length - 1].id;
      }
    }

    return items;
  },

  async fetchEfws(stripe: any, since: number, stripeAccount: string): Promise<any[]> {
    try {
      const result = await stripe.radar.earlyFraudWarnings.list(
        { limit: 100 },
        { stripeAccount },
      );
      return result.data.filter((e: any) => e.created >= since);
    } catch {
      // EFW API may not be available on all accounts
      return [];
    }
  },
};
