import { getSupabase } from '../clients/supabase.client';
import type { OfferRecord } from '../repositories/offer.repository';
import { AppError, ValidationError } from '../utils/errors';

export type PaymentChoice = 'pif' | 'installment' | 'installments' | 'subscription';
export type PaymentMethod = 'card' | 'ach';

export interface DualPricingControl {
  id: string;
  location_id?: string | null;
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

export function basePaymentAmountCents(offer: OfferRecord, paymentChoice?: unknown): number {
  const choice = normalizePaymentChoice(paymentChoice, offer);
  if (choice === 'installment' || choice === 'subscription') {
    return toCents(offer.installment_amount ?? offer.price);
  }
  if (offer.pif_discount_enabled && offer.pif_price !== null && offer.pif_price !== undefined) {
    return toCents(offer.pif_price);
  }
  return toCents(offer.price);
}

export const baseCardAmountCents = basePaymentAmountCents;

export function buildDualPricingQuote(
  offer: OfferRecord,
  control: DualPricingControl | null,
  paymentChoice?: unknown,
  paymentMethod: PaymentMethod = 'card',
): DualPricingQuote {
  const choice = normalizePaymentChoice(paymentChoice, offer);
  const baseAmountCents = basePaymentAmountCents(offer, choice);
  const enabled = Boolean((offer as any).dual_pricing_enabled && (offer as any).ach_enabled && control);
  const cardUpliftPercent = enabled ? Number(control?.card_uplift_percent || 0) : 0;
  const processorDeductionPercent = enabled
    ? Number(control?.processor_deduction_percent ?? calculateProcessorDeductionPercent(cardUpliftPercent))
    : 0;
  const achAmountCents = baseAmountCents;
  const cardAmountCents = enabled
    ? Math.round(baseAmountCents * (1 + (cardUpliftPercent / 100)))
    : baseAmountCents;
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

function toDualPricingSettingsError(error: any): Error {
  const message = String(error?.message || '');
  if (
    error?.code === '42703'
    || error?.code === '42P01'
    || message.includes('dual_pricing_controls')
    || message.includes('location_id')
    || message.includes('updated_by')
  ) {
    return new AppError(
      'Dual pricing settings are not ready. Run migration 079_dual_pricing_location_controls.sql, then try again.',
      500,
      'DUAL_PRICING_MIGRATION_REQUIRED',
    );
  }
  return error;
}

export const dualPricingService = {
  async getActiveControl(locationId?: string | null): Promise<DualPricingControl | null> {
    const selectFields = 'id, location_id, card_uplift_percent, processor_deduction_percent, enabled_processors, effective_at';
    const supabase = getSupabase();

    async function fetchForLocation(targetLocationId: string): Promise<DualPricingControl | null> {
      const { data, error } = await supabase
        .from('dual_pricing_controls')
        .select(selectFields)
        .eq('active', true)
        .eq('location_id', targetLocationId)
        .lte('effective_at', new Date().toISOString())
        .order('effective_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as DualPricingControl | null;
    }

    async function fetchGlobal(): Promise<DualPricingControl | null> {
      const { data, error } = await supabase
        .from('dual_pricing_controls')
        .select(selectFields)
        .eq('active', true)
        .is('location_id', null)
        .lte('effective_at', new Date().toISOString())
        .order('effective_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as DualPricingControl | null;
    }

    try {
      if (locationId) {
        const scoped = await fetchForLocation(locationId);
        if (scoped) return scoped;
      }
      return await fetchGlobal();
    } catch (err: any) {
      const message = String(err?.message || '');
      if (
        err?.code === '42P01'
        || message.includes('dual_pricing_controls')
        || message.includes('location_id')
        || message.includes('.eq is not a function')
        || message.includes('.lte is not a function')
        || message.includes('.is is not a function')
      ) return null;
      throw err;
    }
  },

  async saveLocationControl(
    locationId: string,
    input: { cardUpliftPercent: unknown; enabledProcessors?: unknown; updatedBy?: string },
  ): Promise<DualPricingControl> {
    const cardUpliftPercent = Number(input.cardUpliftPercent);
    if (!Number.isFinite(cardUpliftPercent) || cardUpliftPercent < 0 || cardUpliftPercent > 10) {
      throw new ValidationError('Card price uplift must be between 0 and 10%.');
    }

    const allowedProcessors = new Set(['stripe', 'nmi']);
    const requestedProcessors = Array.isArray(input.enabledProcessors)
      ? input.enabledProcessors.map((value) => String(value).toLowerCase()).filter((value) => allowedProcessors.has(value))
      : ['stripe', 'nmi'];
    const enabledProcessors = requestedProcessors.length ? Array.from(new Set(requestedProcessors)) : ['stripe', 'nmi'];
    const supabase = getSupabase();

    const { error: deactivateError } = await supabase
      .from('dual_pricing_controls')
      .update({ active: false, updated_at: new Date().toISOString(), updated_by: input.updatedBy || 'app' })
      .eq('location_id', locationId)
      .eq('active', true);
    if (deactivateError) throw toDualPricingSettingsError(deactivateError);

    const { data, error } = await supabase
      .from('dual_pricing_controls')
      .insert({
        location_id: locationId,
        active: true,
        card_uplift_percent: cardUpliftPercent,
        enabled_processors: enabledProcessors,
        internal_notes: 'Merchant-specific dual-pricing control.',
        created_by: input.updatedBy || 'app',
        updated_by: input.updatedBy || 'app',
      })
      .select('id, location_id, card_uplift_percent, processor_deduction_percent, enabled_processors, effective_at')
      .single();
    if (error) throw toDualPricingSettingsError(error);
    return data as DualPricingControl;
  },

  async quoteOffer(
    offer: OfferRecord,
    paymentChoice?: unknown,
    paymentMethod: PaymentMethod = 'card',
  ): Promise<DualPricingQuote> {
    const control = await this.getActiveControl(offer.location_id);
    return buildDualPricingQuote(offer, control, paymentChoice, paymentMethod);
  },
};
