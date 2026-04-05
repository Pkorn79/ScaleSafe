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
  async verifyChain(paymentEventId: string): Promise<EvidenceChainResult> {
    const supabase = getSupabase();
    const { data: payment } = await supabase
      .from('payment_events')
      .select('*')
      .eq('id', paymentEventId)
      .single();

    if (!payment) {
      return { complete: false, links: [], gaps: ['Payment event not found'], chainStrength: 0 };
    }

    const links: EvidenceLink[] = [];
    const gaps: string[] = [];

    // Link 1: Consent record
    if (payment.consent_token) {
      const { data: packet } = await supabase
        .from('enrollment_packets')
        .select('*')
        .eq('consent_token', payment.consent_token)
        .single();

      if (packet) {
        links.push({
          type: 'consent',
          id: packet.id,
          timestamp: packet.consent_timestamp || packet.created_at,
          verified: true,
        });

        // IP match
        if (packet.consent_ip === payment.ip_address) {
          links.push({
            type: 'ip_match',
            id: null,
            timestamp: payment.created_at,
            verified: true,
            detail: `Consent IP ${packet.consent_ip} matches payment IP`,
          });
        } else {
          gaps.push(`IP mismatch: consent=${packet.consent_ip}, payment=${payment.ip_address}`);
        }
      } else {
        gaps.push('Consent token present but enrollment packet not found');
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
      const { data: vault } = await supabase
        .from('stripe_evidence_vault')
        .select('*')
        .eq('stripe_payment_intent_id', payment.processor_transaction_id)
        .single();

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
