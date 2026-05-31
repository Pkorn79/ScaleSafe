import { getSupabase } from '../clients/supabase.client';
import type { OfferRecord } from '../repositories/offer.repository';

export type PaymentChoice = 'pif' | 'installment' | 'installments' | 'subscription';
export type PaymentMethod = 'card' | 'ach';

export interface DualPricingControl {
  id: string;
  card_uplift_percent: number;
  processor_deduction_percent: number;
  enabled_processors: string[];
  effective_at: string;
}

export interface DualPricingQuote {
  dualPricingEnabled: boolean;
  paymentChoice: string;
  paymentMethod: PaymentMethod;
  cardAmountCents: number;
  achAmountCents: number;
  selectedAmountCents: number;
  cardAmount: number;
  achAmount: number;
  selectedAmount: number;
  cardUpliftPercent: number;
  processorDeductionPercent: number;
  achAccessPolicy: 'after_settlement' | 'after_submission';
}

function toCents(value: number | string | null | undefined): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.round(numeric * 100);
}

function centsToDollars(cents: number): number {
  return Math.round(cents) / 100;
}

function normalizePaymentChoice(choice: unknown, offer: OfferRecord): string {
  const raw = String(choice || offer.payment_type || 'pif').toLowerCase();
  if (raw === 'installments') return 'installment';
  if (raw === 'one_time' || raw === 'one-time') return 'pif';
  return raw || 'pif';
}

export function calculateProcessorDeductionPercent(cardUpliftPercent: number): number {
  const uplift = Number(cardUpliftPercent || 0);
  if (!Number.isFinite(uplift) || uplift <= 0) return 0;
  return (uplift / (100 + uplift)) * 100;
}

export function baseCardAmountCents(offer: OfferRecord, paymentChoice?: unknown): number {
  const choice = normalizePaymentChoice(paymentChoice, offer);
  if (choice === 'installment' || choice === 'subscription') {
    return toCents(offer.installment_amount ?? offer.price);
  }
  if (offer.pif_discount_enabled && offer.pif_price !== null && offer.pif_price !== undefined) {
    return toCents(offer.pif_price);
  }
  return toCents(offer.price);
}

export function buildDualPricingQuote(
  offer: OfferRecord,
  control: DualPricingControl | null,
  paymentChoice?: unknown,
  paymentMethod: PaymentMethod = 'card',
): DualPricingQuote {
  const choice = normalizePaymentChoice(paymentChoice, offer);
  const cardAmountCents = baseCardAmountCents(offer, choice);
  const enabled = Boolean((offer as any).dual_pricing_enabled && (offer as any).ach_enabled && control);
  const cardUpliftPercent = enabled ? Number(control?.card_uplift_percent || 0) : 0;
  const processorDeductionPercent = enabled
    ? Number(control?.processor_deduction_percent ?? calculateProcessorDeductionPercent(cardUpliftPercent))
    : 0;
  const achAmountCents = enabled
    ? Math.round(cardAmountCents / (1 + (cardUpliftPercent / 100)))
    : cardAmountCents;
  const normalizedMethod: PaymentMethod = paymentMethod === 'ach' ? 'ach' : 'card';
  const selectedAmountCents = normalizedMethod === 'ach' ? achAmountCents : cardAmountCents;

  return {
    dualPricingEnabled: enabled,
    paymentChoice: choice,
    paymentMethod: normalizedMethod,
    cardAmountCents,
    achAmountCents,
    selectedAmountCents,
    cardAmount: centsToDollars(cardAmountCents),
    achAmount: centsToDollars(achAmountCents),
    selectedAmount: centsToDollars(selectedAmountCents),
    cardUpliftPercent,
    processorDeductionPercent,
    achAccessPolicy: ((offer as any).ach_access_policy || 'after_settlement') as 'after_settlement' | 'after_submission',
  };
}

export const dualPricingService = {
  async getActiveControl(): Promise<DualPricingControl | null> {
    try {
      const { data, error } = await getSupabase()
        .from('dual_pricing_controls')
        .select('id, card_uplift_percent, processor_deduction_percent, enabled_processors, effective_at')
        .eq('active', true)
        .lte('effective_at', new Date().toISOString())
        .order('effective_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        const message = String(error.message || '');
        if (error.code === '42P01' || message.includes('dual_pricing_controls')) return null;
        throw error;
      }
      return data as DualPricingControl | null;
    } catch (err: any) {
      const message = String(err?.message || '');
      if (message.includes('dual_pricing_controls') || message.includes('.lte is not a function')) return null;
      throw err;
    }
  },

  async quoteOffer(
    offer: OfferRecord,
    paymentChoice?: unknown,
    paymentMethod: PaymentMethod = 'card',
  ): Promise<DualPricingQuote> {
    const control = await this.getActiveControl();
    return buildDualPricingQuote(offer, control, paymentChoice, paymentMethod);
  },
};
