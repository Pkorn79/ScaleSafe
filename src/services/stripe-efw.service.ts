import { getSupabase } from '../clients/supabase.client';
import { config } from '../config';
import { stripeEvidenceVaultService } from './stripe-evidence-vault.service';
import { EfwRecommendation } from '../types/stripe-defense.types';
import { logger } from '../utils/logger';

const Stripe = require('stripe');

function getStripe(): any {
  return new Stripe(config.stripe.secretKey);
}

export const stripeEfwService = {

  async handleEfw(efw: any, merchant: any): Promise<void> {
    const chargeId = typeof efw.charge === 'string' ? efw.charge : efw.charge?.id || null;

    // 1. Get evidence vault entry
    const vaultEntry = chargeId
      ? await stripeEvidenceVaultService.getVaultEntryForCharge(chargeId)
      : null;
    const evidenceScore = vaultEntry?.evidence_score || 0;

    // 2. Get current dispute rate
    const disputeRate = await this.getCurrentDisputeRate(merchant);

    // 3. Apply decision tree
    const recommendation = this.computeEfwRecommendation(evidenceScore, disputeRate, efw);

    // 4. Store the EFW with recommendation
    const supabase = getSupabase();
    await supabase
      .from('efw_events')
      .upsert({
        merchant_id: merchant.id,
        location_id: merchant.location_id,
        stripe_efw_id: efw.id,
        stripe_charge_id: chargeId,
        stripe_payment_intent_id: typeof efw.payment_intent === 'string' ? efw.payment_intent : null,
        fraud_type: efw.fraud_type || null,
        evidence_score: evidenceScore,
        dispute_rate_at_time: disputeRate,
        recommendation: recommendation.action,
        recommendation_reason: recommendation.reason,
        response_deadline: new Date(Date.now() + (72 * 60 * 60 * 1000)).toISOString(),
        raw_efw_object: efw,
      }, { onConflict: 'stripe_efw_id' });

    logger.info({
      event: 'efw_processed',
      merchantId: merchant.id,
      efwId: efw.id,
      recommendation: recommendation.action,
      evidenceScore,
      disputeRate,
      timestamp: new Date().toISOString(),
    }, 'EFW processed');

    // 5. Alert merchant IMMEDIATELY
    await this.alertMerchantEfw(merchant, efw, recommendation);
  },

  computeEfwRecommendation(
    evidenceScore: number,
    disputeRate: number,
    _efw: any,
  ): EfwRecommendation {
    // Rule 1: If dispute rate approaching 0.65%, ALWAYS recommend refund
    if (disputeRate >= 0.006) {
      return {
        action: 'refund',
        reason: `Your dispute rate is ${(disputeRate * 100).toFixed(2)}% — approaching Visa VAMP threshold. Refunding this EFW protects your account.`,
      };
    }

    // Rule 2: If evidence is strong, recommend hold
    if (evidenceScore >= 60) {
      return {
        action: 'hold',
        reason: `Evidence score is ${evidenceScore}/100. Strong documentation on file. Hold and prepare to fight if this escalates to a formal dispute.`,
      };
    }

    // Rule 3: Weak evidence — recommend refund
    return {
      action: 'refund',
      reason: `Evidence score is ${evidenceScore}/100. Consider refunding to avoid a formal dispute. Refund window closes in ~72 hours.`,
    };
  },

  async getCurrentDisputeRate(merchant: any): Promise<number> {
    if (!merchant.stripe_user_id) return 0;

    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);
    const stripe = getStripe();

    try {
      const [disputes, charges] = await Promise.all([
        stripe.disputes.list(
          { created: { gte: thirtyDaysAgo }, limit: 100 },
          { stripeAccount: merchant.stripe_user_id },
        ),
        stripe.charges.list(
          { created: { gte: thirtyDaysAgo }, limit: 100 },
          { stripeAccount: merchant.stripe_user_id },
        ),
      ]);

      if (charges.data.length === 0) return 0;
      return disputes.data.length / charges.data.length;
    } catch (err: any) {
      logger.error({ err: err.message }, 'Failed to compute dispute rate');
      return 0;
    }
  },

  async respondToEfw(params: {
    efwId: string;
    merchantId: string;
    action: 'refund' | 'hold';
  }): Promise<{ success: boolean; action: string }> {
    const supabase = getSupabase();

    const { data: efwEvent } = await supabase
      .from('efw_events')
      .select('*')
      .eq('merchant_id', params.merchantId)
      .eq('id', params.efwId)
      .single();

    if (!efwEvent) throw new Error('EFW not found');

    if (params.action === 'refund' && efwEvent.stripe_charge_id) {
      const { data: merchant } = await supabase
        .from('merchants')
        .select('stripe_user_id')
        .eq('id', params.merchantId)
        .single();

      if (merchant?.stripe_user_id) {
        const stripe = getStripe();
        await stripe.refunds.create(
          { charge: efwEvent.stripe_charge_id },
          { stripeAccount: merchant.stripe_user_id },
        );
      }
    }

    await supabase
      .from('efw_events')
      .update({
        responded: true,
        response_action: params.action === 'refund' ? 'refunded' : 'held',
        action_taken: params.action === 'refund' ? 'refunded' : 'held',
        action_taken_at: new Date().toISOString(),
      })
      .eq('id', params.efwId)
      .eq('merchant_id', params.merchantId);

    logger.info(
      { efwId: params.efwId, merchantId: params.merchantId, action: params.action },
      'EFW response recorded',
    );

    return { success: true, action: params.action };
  },

  async alertMerchantEfw(
    merchant: any,
    efw: any,
    recommendation: EfwRecommendation,
  ): Promise<void> {
    logger.info(
      {
        merchantId: merchant.id,
        efwId: efw.id,
        action: recommendation.action,
      },
      `[EFW ALERT] ${recommendation.action.toUpperCase()} — ${recommendation.reason}`,
    );
  },
};
