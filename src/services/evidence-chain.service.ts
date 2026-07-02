import { getSupabase } from '../clients/supabase.client';
import { logger } from '../utils/logger';

export interface EvidenceLink {
  type: 'consent' | 'ip_match' | 'payment' | 'evidence_vault' | 'ghl_order';
  id: string | null;
  timestamp: string;
  verified: boolean;
  detail?: string;
}

export interface EvidenceChainResult {
  complete: boolean;
  links: EvidenceLink[];
  gaps: string[];
  chainStrength: number;
}

export const evidenceChainService = {
  async verifyChain(paymentEventId: string, locationId?: string): Promise<EvidenceChainResult> {
    const supabase = getSupabase();
    let paymentQuery = supabase
      .from('payment_events')
      .select('*')
      .eq('id', paymentEventId);

    if (locationId) {
      paymentQuery = paymentQuery.eq('location_id', locationId);
    }

    const { data: payment, error: paymentError } = await paymentQuery.single();

    if (paymentError || !payment) {
      return { complete: false, links: [], gaps: ['Payment event not found'], chainStrength: 0 };
    }

    const scopedLocationId = locationId || payment.location_id || '';
    const links: EvidenceLink[] = [];
    const gaps: string[] = [];

    // Link 1: Consent record
    if (payment.consent_token) {
      let consentQuery = supabase
        .from('enrollments')
        .select('id, consent_captured_at, consent_ip, created_at')
        .eq('consent_token', payment.consent_token)
      if (scopedLocationId) {
        consentQuery = consentQuery.eq('location_id', scopedLocationId);
      }
      const { data: consent, error: consentError } = await consentQuery.single();

      if (consentError) {
        logger.warn({
          err: consentError.message,
          paymentEventId,
          locationId: scopedLocationId || null,
          consentTokenPresent: true,
        }, 'Evidence chain consent lookup failed');
        gaps.push('Consent token present but enrollment consent record could not be verified');
      } else if (consent) {
        links.push({
          type: 'consent',
          id: consent.id,
          timestamp: consent.consent_captured_at || consent.created_at,
          verified: true,
        });

        // IP match
        const consentIp = String(consent.consent_ip || '').trim();
        const paymentIp = String(payment.ip_address || '').trim();
        if (consentIp && paymentIp && consentIp === paymentIp) {
          links.push({
            type: 'ip_match',
            id: null,
            timestamp: payment.created_at,
            verified: true,
            detail: `Consent IP ${consentIp} matches payment IP`,
          });
        } else if (consentIp && paymentIp) {
          gaps.push(`IP mismatch: consent=${consentIp}, payment=${paymentIp}`);
        } else {
          gaps.push(`IP match unavailable: consent=${consentIp || 'missing'}, payment=${paymentIp || 'missing'}`);
        }
      } else {
        gaps.push('Consent token present but enrollment consent record not found');
      }
    } else {
      gaps.push('No consent token linked to payment');
    }

    // Link 2: Payment record
    links.push({
      type: 'payment',
      id: payment.id,
      timestamp: payment.created_at,
      verified: true,
      detail: `${payment.processor} charge: $${Number(payment.amount).toFixed(2)}`,
    });

    // Link 3: Evidence vault (Stripe only)
    if (payment.processor === 'stripe' && payment.processor_transaction_id) {
      let vaultQuery = supabase
        .from('stripe_evidence_vault')
        .select('*')
        .eq('stripe_payment_intent_id', payment.processor_transaction_id);
      if (scopedLocationId) {
        vaultQuery = vaultQuery.eq('location_id', scopedLocationId);
      }
      const { data: vault } = await vaultQuery.single();

      if (vault) {
        links.push({
          type: 'evidence_vault',
          id: vault.id,
          timestamp: vault.created_at,
          verified: true,
          detail: `Evidence score: ${vault.evidence_score}/100`,
        });
      } else {
        gaps.push('Stripe evidence vault entry not found');
      }
    }

    // Link 4: GHL order
    if (payment.ghl_order_id) {
      links.push({
        type: 'ghl_order',
        id: payment.ghl_order_id,
        timestamp: payment.created_at,
        verified: true,
      });
    }

    return {
      complete: gaps.length === 0,
      links,
      gaps,
      chainStrength: this.computeChainStrength(links),
    };
  },

  computeChainStrength(links: EvidenceLink[]): number {
    let score = 0;
    if (links.some(l => l.type === 'consent')) score += 30;
    if (links.some(l => l.type === 'ip_match')) score += 20;
    if (links.some(l => l.type === 'payment')) score += 20;
    if (links.some(l => l.type === 'evidence_vault')) score += 20;
    if (links.some(l => l.type === 'ghl_order')) score += 10;
    return Math.min(100, score);
  },
};
