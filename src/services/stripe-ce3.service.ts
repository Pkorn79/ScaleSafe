/**
 * Visa Compelling Evidence 3.0 — prior-transaction matching engine (MVP-4).
 *
 * Builds the `evidence.enhanced_evidence.visa_compelling_evidence_3` payload
 * for a Visa 10.4 (fraudulent) dispute: the disputed transaction's identity
 * fields plus EXACTLY TWO prior undisputed transactions from the same client
 * that share identity elements. A valid set shifts fraud liability back to
 * the issuing bank.
 *
 * Identity rule (Visa): the disputed + both prior transactions must share
 * either two "main" elements (purchase IP, device fingerprint) or one main +
 * one "secondary" element (email, shipping address, account id).
 * ScaleSafe's reliable pair is IP (main) + email (secondary); device
 * fingerprint strengthens the match when the checkout captured it.
 *
 * INTEGRITY RULE (do not relax): candidate transactions come ONLY from
 * payment_events rows tied to the same contact — never guessed across
 * contacts, and never included without a vault entry proving the identity
 * fields for that specific transaction.
 */

import { getSupabase } from '../clients/supabase.client';
import { config } from '../config';
import { logger } from '../utils/logger';

export interface Ce3Transaction {
  charge?: string;
  customer_email_address: string;
  customer_purchase_ip: string;
  customer_device_fingerprint?: string;
  merchandise_or_services?: 'merchandise' | 'services';
  product_description: string;
}

export interface Ce3Evidence {
  disputed_transaction: Ce3Transaction;
  prior_undisputed_transactions: Ce3Transaction[];
}

export interface Ce3BuildResult {
  evidence: Ce3Evidence | null;
  /** Merchant-readable reasons when evidence could not be assembled. */
  reasons: string[];
}

// Visa's qualification window: priors must be 120–364 days older than the
// disputed transaction. Stripe does not enforce the window in test mode, so
// we relax it there too — otherwise the official CE3 test flow could never
// find freshly seeded prior charges.
const WINDOW_MIN_DAYS = 120;
const WINDOW_MAX_DAYS = 364;

function isTestMode(): boolean {
  return (config.stripe.secretKey || '').startsWith('sk_test');
}

function sameEmail(a?: string | null, b?: string | null): boolean {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
}

function sameValue(a?: string | null, b?: string | null): boolean {
  return !!a && !!b && a === b;
}

export const stripeCe3Service = {
  /**
   * Assemble CE 3.0 evidence for a dispute, or explain why it can't be done.
   */
  async buildCe3Evidence(params: {
    merchant: any;
    disputeEvent: any;
    /** Preferred product description (offer name + program description). */
    productDescription?: string | null;
  }): Promise<Ce3BuildResult> {
    const supabase = getSupabase();
    const { merchant, disputeEvent } = params;
    const raw = disputeEvent?.raw_dispute_object || {};

    const disputedPi = disputeEvent?.stripe_payment_intent_id
      || (typeof raw.payment_intent === 'string' ? raw.payment_intent : raw.payment_intent?.id)
      || null;
    if (!disputedPi) {
      return { evidence: null, reasons: ['The disputed transaction has no PaymentIntent id on record.'] };
    }
    if (!disputeEvent?.contact_id) {
      return { evidence: null, reasons: ['The dispute is not linked to a client, so prior transactions cannot be verified.'] };
    }

    // Disputed-side identity from the vault
    const { data: disputedVault } = await supabase
      .from('stripe_evidence_vault')
      .select('*')
      .eq('stripe_payment_intent_id', disputedPi)
      .maybeSingle();
    if (!disputedVault) {
      return { evidence: null, reasons: ['No evidence vault entry exists for the disputed transaction.'] };
    }
    const missing: string[] = [];
    if (!disputedVault.customer_ip) missing.push('the disputed transaction has no captured IP address');
    if (!disputedVault.customer_email) missing.push('the disputed transaction has no captured email');
    if (missing.length) {
      return { evidence: null, reasons: missing };
    }

    // Candidate window (relaxed in test mode — see constant note)
    const disputeDate = raw.created
      ? new Date(raw.created * 1000)
      : new Date(disputeEvent.created_at || Date.now());
    const windowEnd = new Date(disputeDate.getTime() - WINDOW_MIN_DAYS * 86400000);
    const windowStart = new Date(disputeDate.getTime() - WINDOW_MAX_DAYS * 86400000);

    let candidateQuery = supabase
      .from('payment_events')
      .select('id, processor_transaction_id, created_at')
      .eq('location_id', merchant.location_id)
      .eq('contact_id', disputeEvent.contact_id)
      .eq('processor', 'stripe')
      .neq('processor_transaction_id', disputedPi)
      .order('created_at', { ascending: false })
      .limit(50);
    if (!isTestMode()) {
      candidateQuery = candidateQuery
        .gte('created_at', windowStart.toISOString())
        .lte('created_at', windowEnd.toISOString());
    }
    const { data: candidateEvents } = await candidateQuery;

    const candidatePis = [...new Set(
      (candidateEvents || []).map((e: any) => e.processor_transaction_id).filter(Boolean),
    )] as string[];
    if (candidatePis.length < 2) {
      return {
        evidence: null,
        reasons: [`Only ${candidatePis.length} prior Stripe transaction(s) exist for this client in the 120–364 day window — Visa requires 2.`],
      };
    }

    // Undisputed check: exclude any candidate PI that itself has a dispute row
    const { data: disputedRows } = await supabase
      .from('dispute_events')
      .select('stripe_payment_intent_id')
      .eq('merchant_id', merchant.id)
      .in('stripe_payment_intent_id', candidatePis);
    const disputedPis = new Set((disputedRows || []).map((r: any) => r.stripe_payment_intent_id));

    // Vault entries carry the per-transaction identity proof
    const { data: vaultRows } = await supabase
      .from('stripe_evidence_vault')
      .select('*')
      .in('stripe_payment_intent_id', candidatePis.filter((pi) => !disputedPis.has(pi)));

    // A candidate qualifies when it shares a main element with the disputed
    // transaction (IP or device fingerprint) AND the pair rule can be met:
    // two mains, or one main + matching email (secondary).
    const disputedCardFp = disputedVault.card_fingerprint || null;
    const qualifying = (vaultRows || []).filter((v: any) => {
      if (!v.stripe_charge_id) return false; // payload requires the charge id
      const ipMatch = sameValue(v.customer_ip, disputedVault.customer_ip);
      const deviceMatch = sameValue(v.customer_device_fingerprint, disputedVault.customer_device_fingerprint);
      const emailMatch = sameEmail(v.customer_email, disputedVault.customer_email);
      const identityOk = (ipMatch && deviceMatch) || (ipMatch && emailMatch) || (deviceMatch && emailMatch);
      if (!identityOk) return false;
      // Visa requires the priors to use the same payment method. When both
      // card fingerprints are on record and differ, exclude (live mode only —
      // Stripe skips this validation in test mode, and old vault rows predate
      // fingerprint capture).
      if (!isTestMode() && disputedCardFp && v.card_fingerprint && v.card_fingerprint !== disputedCardFp) {
        return false;
      }
      return true;
    });

    if (qualifying.length < 2) {
      return {
        evidence: null,
        reasons: [
          `Only ${qualifying.length} prior transaction(s) share enough identity elements (IP/device + email) with the disputed one — Visa requires 2.`,
        ],
      };
    }

    // Prefer same-card priors, then most complete identity, then most recent
    qualifying.sort((a: any, b: any) => {
      const aCard = disputedCardFp && a.card_fingerprint === disputedCardFp ? 1 : 0;
      const bCard = disputedCardFp && b.card_fingerprint === disputedCardFp ? 1 : 0;
      if (aCard !== bCard) return bCard - aCard;
      const aScore = (a.customer_ip ? 1 : 0) + (a.customer_device_fingerprint ? 1 : 0);
      const bScore = (b.customer_ip ? 1 : 0) + (b.customer_device_fingerprint ? 1 : 0);
      if (aScore !== bScore) return bScore - aScore;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    const priors = qualifying.slice(0, 2);

    const productDescription = (params.productDescription
      || disputedVault.offer_description
      || disputedVault.offer_title
      || 'Coaching / service program purchase').slice(0, 1500);

    const toTransaction = (v: any, includeCharge: boolean): Ce3Transaction => {
      const tx: Ce3Transaction = {
        customer_email_address: v.customer_email,
        customer_purchase_ip: v.customer_ip,
        product_description: (includeCharge
          ? (v.offer_description || v.offer_title || productDescription)
          : productDescription).slice(0, 1500),
      };
      if (v.customer_device_fingerprint) tx.customer_device_fingerprint = v.customer_device_fingerprint;
      if (includeCharge) tx.charge = v.stripe_charge_id;
      return tx;
    };

    const evidence: Ce3Evidence = {
      disputed_transaction: {
        ...toTransaction(disputedVault, false),
        merchandise_or_services: 'services',
      },
      prior_undisputed_transactions: priors.map((v: any) => toTransaction(v, true)),
    };

    logger.info(
      {
        disputeEventId: disputeEvent.id,
        disputedPi,
        priorCharges: evidence.prior_undisputed_transactions.map((t) => t.charge),
      },
      'CE 3.0 evidence assembled (2 qualifying prior undisputed transactions)',
    );

    return { evidence, reasons: [] };
  },
};
