import { getSupabase } from '../clients/supabase.client';
import { config } from '../config';
import { stripeEvidenceVaultService } from './stripe-evidence-vault.service';
import {
  DisputeTriageResult,
  DisputeRecommendation,
  EvidencePacket,
} from '../types/stripe-defense.types';
import { logger } from '../utils/logger';

const Stripe = require('stripe');

function getStripe(): any {
  return new Stripe(config.stripe.secretKey);
}

export const stripeDisputeService = {

  // ─── Dispute Triage ───────────────────────────────────────────────

  async triageDispute(
    dispute: any,
    merchant: any,
  ): Promise<DisputeTriageResult> {
    const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id;

    // 1. Get the vault entry for this charge
    const vaultEntry = chargeId
      ? await stripeEvidenceVaultService.getVaultEntryForCharge(chargeId)
      : null;

    // 2. Get evidence gaps
    const gaps = stripeEvidenceVaultService.getEvidenceGaps(vaultEntry);

    // 3. Compute triage score
    const score = this.computeTriageScore(dispute, vaultEntry);

    // 4. Determine recommendation
    const recommendation = this.getRecommendation(score, dispute.amount || 0);

    // 5. Calculate deadline alerts
    const dueBy = dispute.evidence_details?.due_by;
    const deadlineAlerts = dueBy ? this.calculateDeadlineAlerts(dueBy) : null;

    // 6. Update the dispute_events record
    const supabase = getSupabase();
    await supabase
      .from('dispute_events')
      .update({
        triage_score: score,
        triage_recommendation: recommendation.action,
        recommendation_reason: recommendation.reason,
        evidence_gaps: gaps,
        evidence_score: vaultEntry?.evidence_score || 0,
        alert_t7_at: deadlineAlerts?.t7 || null,
        alert_t3_at: deadlineAlerts?.t3 || null,
        alert_t1_at: deadlineAlerts?.t1 || null,
        triaged_at: new Date().toISOString(),
      })
      .eq('stripe_dispute_id', dispute.id)
      .eq('merchant_id', merchant.id);

    // 7. Send merchant alert
    await this.alertMerchant(merchant, dispute, score, recommendation, gaps);

    logger.info({
      event: 'dispute_triaged',
      merchantId: merchant.id,
      disputeId: dispute.id,
      score,
      recommendation: recommendation.action,
      evidenceGaps: gaps.length,
      timestamp: new Date().toISOString(),
    }, 'Dispute triaged');

    return { score, recommendation, gaps, deadlineAlerts };
  },

  // ─── Triage Scoring ───────────────────────────────────────────────

  computeTriageScore(dispute: any, vaultEntry: any | null): number {
    let score = 0;

    // POSITIVE factors (evidence strength)
    if (vaultEntry) {
      if (vaultEntry.contract_file_id || vaultEntry.terms_file_id) score += 30;
      if (vaultEntry.communication_file_id) score += 20;
      if (vaultEntry.session_file_ids?.length > 0) score += 20;
      if (vaultEntry.ce30_eligible) score += 15;
      if (vaultEntry.customer_email) score += 10;
      if (vaultEntry.customer_billing_address) score += 5;
    }

    // NEGATIVE factors (dispute characteristics)
    const reason = dispute.reason;
    if (reason === 'product_not_received' || reason === 'general') score -= 20;

    // No customer ID means new/unknown customer
    if (!vaultEntry?.stripe_customer_id) score -= 15;

    // Large amount (>$3000)
    if ((dispute.amount || 0) > 300000) score -= 10;

    // Clamp to 0-100
    return Math.max(0, Math.min(100, score));
  },

  // ─── Recommendation Logic ─────────────────────────────────────────

  getRecommendation(score: number, amountCents: number): DisputeRecommendation {
    if (score >= 60) {
      return {
        action: 'fight',
        reason: 'Strong evidence on file. ScaleSafe can auto-assemble an evidence packet.',
        estimatedCost: `$15 dispute fee. If won, you recover $${(amountCents / 100).toFixed(2)}.`,
      };
    }

    if (score >= 30) {
      return {
        action: 'review',
        reason: 'Some evidence available but gaps exist. Review the evidence packet before submitting.',
        estimatedCost: '$15 dispute fee + $15 counter fee if lost. Review evidence gaps before deciding.',
      };
    }

    return {
      action: 'accept',
      reason: 'Evidence is weak. Fighting this dispute is unlikely to succeed and costs $30 if lost.',
      estimatedCost: '$15 dispute fee (unavoidable). Fighting adds $15 counter fee risk with low win probability.',
    };
  },

  // ─── Deadline Tracking ────────────────────────────────────────────

  calculateDeadlineAlerts(dueByTimestamp: number): {
    dueBy: string;
    t7: string | null;
    t3: string | null;
    t1: string | null;
  } {
    const dueBy = new Date(dueByTimestamp * 1000);
    const now = new Date();

    const t7 = new Date(dueBy.getTime() - (7 * 24 * 60 * 60 * 1000));
    const t3 = new Date(dueBy.getTime() - (3 * 24 * 60 * 60 * 1000));
    const t1 = new Date(dueBy.getTime() - (1 * 24 * 60 * 60 * 1000));

    return {
      dueBy: dueBy.toISOString(),
      t7: t7 > now ? t7.toISOString() : null,
      t3: t3 > now ? t3.toISOString() : null,
      t1: t1 > now ? t1.toISOString() : null,
    };
  },

  // ─── Evidence Assembly ────────────────────────────────────────────

  async assembleEvidencePacket(
    stripeDisputeId: string,
    merchantId: string,
  ): Promise<EvidencePacket> {
    const supabase = getSupabase();

    // 1. Get the dispute record
    const { data: disputeEvent } = await supabase
      .from('dispute_events')
      .select('*')
      .eq('stripe_dispute_id', stripeDisputeId)
      .eq('merchant_id', merchantId)
      .single();

    if (!disputeEvent) throw new Error(`Dispute ${stripeDisputeId} not found`);

    // 2. Get the vault entry
    const vaultEntry = disputeEvent.stripe_charge_id
      ? await stripeEvidenceVaultService.getVaultEntryForCharge(disputeEvent.stripe_charge_id)
      : null;

    // 3. Get offer terms file if available
    let offerTermsFileId: string | null = null;
    if (vaultEntry?.offer_id) {
      const { data: offer } = await supabase
        .from('offers_mirror')
        .select('stripe_terms_file_id, description, refund_policy, title')
        .eq('id', vaultEntry.offer_id)
        .single();
      offerTermsFileId = offer?.stripe_terms_file_id || null;
    }

    // 4. Build evidence based on reason code
    const reason = (disputeEvent.reason || '') as string;
    const evidence = this.mapReasonCodeToEvidence(reason, vaultEntry, offerTermsFileId);

    return {
      stripeDisputeId,
      evidence,
      vaultEntry,
      complete: (disputeEvent.evidence_gaps || []).length === 0,
    };
  },

  // ─── Reason Code → Evidence Field Mapping ─────────────────────────

  mapReasonCodeToEvidence(
    reason: string,
    vault: any | null,
    offerTermsFileId: string | null,
  ): Record<string, string> {
    const evidence: Record<string, string> = {};

    if (!vault) return evidence;

    // Common fields for ALL reason codes
    if (vault.customer_name) evidence['customer_name'] = vault.customer_name;
    if (vault.customer_email) evidence['customer_email_address'] = vault.customer_email;
    if (vault.offer_description) evidence['product_description'] = vault.offer_description;

    switch (reason) {
      case 'fraudulent':
        if (vault.customer_ip) evidence['customer_purchase_ip'] = vault.customer_ip;
        if (vault.customer_billing_address) {
          const addr = vault.customer_billing_address as any;
          evidence['billing_address'] = `${addr.line1 || ''}, ${addr.city || ''} ${addr.state || ''} ${addr.postal_code || ''}`.trim();
        }
        if (vault.contract_file_id) evidence['uncategorized_file'] = vault.contract_file_id;
        if (vault.ce30_eligible) {
          evidence['uncategorized_text'] = 'This transaction is CE 3.0 eligible. The cardholder has prior non-disputed transactions with matching IP address and email. Visa CE 3.0 pre-dispute block criteria met.';
        }
        break;

      case 'product_not_received':
        if (vault.service_start_date) evidence['service_date'] = vault.service_start_date;
        if (vault.communication_file_id) evidence['customer_communication'] = vault.communication_file_id;
        if (vault.session_file_ids?.length > 0) {
          evidence['uncategorized_file'] = vault.session_file_ids[0];
          if (vault.session_file_ids.length > 1) {
            evidence['uncategorized_text'] = `${vault.session_file_ids.length} session logs on file documenting service delivery. Primary log attached. Client was active throughout the engagement.`;
          }
        }
        break;

      case 'general':
        if (vault.contract_file_id) {
          evidence['uncategorized_file'] = vault.contract_file_id;
        } else if (offerTermsFileId) {
          evidence['uncategorized_file'] = offerTermsFileId;
        }
        if (vault.communication_file_id) evidence['customer_communication'] = vault.communication_file_id;
        if (vault.refund_policy_text) evidence['refund_policy'] = vault.refund_policy_text;
        evidence['cancellation_policy'] = vault.refund_policy_text || 'No cancellations after program commencement per signed agreement.';
        break;

      case 'credit_not_processed':
        if (vault.refund_policy_text) evidence['refund_policy'] = vault.refund_policy_text;
        if (vault.contract_file_id) evidence['uncategorized_file'] = vault.contract_file_id;
        evidence['uncategorized_text'] = vault.terms_accepted
          ? `Client accepted terms including no-refund policy on ${vault.terms_accepted_at || 'date of enrollment'}.`
          : 'Offer terms were presented to client at time of purchase.';
        break;

      case 'unrecognized':
        if (vault.customer_ip) evidence['customer_purchase_ip'] = vault.customer_ip;
        if (vault.customer_email) evidence['customer_email_address'] = vault.customer_email;
        evidence['uncategorized_text'] = `Purchase was made for "${vault.offer_title || 'service'}". Statement descriptor reflects merchant business name. Receipt was sent to ${vault.customer_email || 'customer email on file'}.`;
        break;

      default:
        if (vault.contract_file_id) evidence['uncategorized_file'] = vault.contract_file_id;
        if (vault.communication_file_id) evidence['customer_communication'] = vault.communication_file_id;
        if (vault.refund_policy_text) evidence['refund_policy'] = vault.refund_policy_text;
        break;
    }

    return evidence;
  },

  // ─── Evidence Submission ──────────────────────────────────────────

  async submitEvidence(params: {
    stripeDisputeId: string;
    merchantId: string;
    evidence: Record<string, string>;
    autoSubmit: boolean;
  }): Promise<{ success: boolean; staged: boolean }> {
    const supabase = getSupabase();

    // Get merchant's Stripe account
    const { data: merchant } = await supabase
      .from('merchants')
      .select('stripe_user_id')
      .eq('id', params.merchantId)
      .single();

    if (!merchant?.stripe_user_id) {
      throw new Error('Merchant has no Stripe account connected');
    }

    const stripe = getStripe();
    await stripe.disputes.update(
      params.stripeDisputeId,
      {
        evidence: params.evidence,
        submit: params.autoSubmit,
      },
      { stripeAccount: merchant.stripe_user_id },
    );

    // Record submission in database
    await supabase
      .from('dispute_events')
      .update({
        evidence_submitted: true,
        evidence_submitted_at: new Date().toISOString(),
        evidence_submitted_mode: params.autoSubmit ? 'auto' : 'manual',
        evidence_auto_submitted: params.autoSubmit,
      })
      .eq('stripe_dispute_id', params.stripeDisputeId)
      .eq('merchant_id', params.merchantId);

    logger.info(
      { disputeId: params.stripeDisputeId, merchantId: params.merchantId, autoSubmit: params.autoSubmit },
      'Evidence submitted to Stripe',
    );

    return { success: true, staged: !params.autoSubmit };
  },

  // ─── Merchant Alert ───────────────────────────────────────────────

  async alertMerchant(
    merchant: any,
    dispute: any,
    score: number,
    recommendation: DisputeRecommendation,
    gaps: string[],
  ): Promise<void> {
    // Log for now — Phase F will render in dashboard, future phases add email/SMS
    logger.info(
      {
        merchantId: merchant.id,
        disputeId: dispute.id,
        score,
        action: recommendation.action,
        gapCount: gaps.length,
      },
      `[DISPUTE ALERT] ${recommendation.action.toUpperCase()} — ${recommendation.reason}`,
    );
  },
};
