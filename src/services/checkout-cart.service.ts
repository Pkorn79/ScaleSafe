import { getSupabase } from '../clients/supabase.client';
import type { OfferRecord } from '../repositories/offer.repository';
import { buildDualPricingQuote, dualPricingService, PaymentMethod } from './dual-pricing.service';
import { ValidationError } from '../utils/errors';
import { logger } from '../utils/logger';

export type CheckoutAddonKind = 'order_bump' | 'pre_payment_upsell';

export interface CheckoutAddonInput {
  id?: string;
  kind: CheckoutAddonKind;
  title: string;
  description?: string | null;
  price: number;
  active?: boolean;
  sortOrder?: number;
}

export interface CheckoutLineItem {
  type: 'base_offer' | CheckoutAddonKind;
  addonId?: string;
  label: string;
  description?: string;
  amountCents: number;
  amount: number;
}

export interface CheckoutCartQuote {
  dualPricingEnabled: boolean;
  paymentChoice: string;
  paymentMethod: PaymentMethod;
  baseAmountCents: number;
  addonAmountCents: number;
  dueTodayAmountCents: number;
  achAmountCents: number;
  cardAmountCents: number;
  selectedAmountCents: number;
  achAmount: number;
  cardAmount: number;
  selectedAmount: number;
  futureRecurringAchAmountCents: number;
  futureRecurringCardAmountCents: number;
  futureRecurringSelectedAmountCents: number;
  futureRecurringAchAmount: number;
  futureRecurringCardAmount: number;
  futureRecurringSelectedAmount: number;
  cardUpliftPercent: number;
  processorDeductionPercent: number;
  achAccessPolicy: 'after_settlement' | 'after_submission';
  lineItems: CheckoutLineItem[];
}

function dollarsToCents(value: unknown): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.round(numeric * 100);
}

function centsToDollars(cents: number): number {
  return Math.round(cents) / 100;
}

function normalizeAddonIds(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

function normalizeKind(value: unknown): CheckoutAddonKind {
  return value === 'pre_payment_upsell' ? 'pre_payment_upsell' : 'order_bump';
}

function normalizePaymentChoice(choice: unknown, offer: OfferRecord): string {
  const raw = String(choice || offer.payment_type || 'pif').toLowerCase();
  if (raw === 'installments') return 'installment';
  if (raw === 'one_time' || raw === 'one-time') return 'pif';
  return raw || 'pif';
}

function checkoutAddonWriteMessage(err: any): string {
  const message = String(err?.message || '');
  if (
    err?.code === '42P01'
    || message.includes('offer_checkout_addons')
    || message.includes('Could not find the table')
  ) {
    return 'Checkout add-ons are not ready in the database. Apply migration 080_checkout_addons.sql, then try again.';
  }
  if (err?.code === '42703' || err?.code === 'PGRST204') {
    return 'Checkout add-on columns are not ready in the database. Apply migration 080_checkout_addons.sql, then try again.';
  }
  if (err?.code === '42501' || message.toLowerCase().includes('row-level security')) {
    return 'Checkout add-ons could not be saved because the database write was blocked by permissions.';
  }
  if (err?.code === '23503') {
    return 'Checkout add-ons could not be linked to this offer. Reload the offer and try again.';
  }
  if (err?.code === '23514') {
    return 'Checkout add-ons contain an invalid value. Check the add-on type and price, then try again.';
  }
  return `Checkout add-ons could not be saved: ${message || 'unknown database error'}`;
}

function baseAmountCents(offer: OfferRecord, paymentChoice: unknown): number {
  const choice = normalizePaymentChoice(paymentChoice, offer);
  if (choice === 'installment' || choice === 'subscription') {
    return dollarsToCents(offer.installment_amount ?? offer.price);
  }
  if (offer.pif_discount_enabled && offer.pif_price !== null && offer.pif_price !== undefined) {
    return dollarsToCents(offer.pif_price);
  }
  return dollarsToCents(offer.price);
}

function baseLabel(offer: OfferRecord, paymentChoice: string): string {
  if (paymentChoice === 'installment') return `${offer.offer_name} - first installment`;
  if (paymentChoice === 'subscription') return `${offer.offer_name} - first subscription payment`;
  return offer.offer_name;
}

export const checkoutCartService = {
  normalizeAddonIds,

  async listAddons(offerId: string, locationId?: string, activeOnly = false): Promise<CheckoutAddonInput[]> {
    try {
      const supabase = getSupabase();
      if (!supabase || typeof (supabase as any).from !== 'function') return [];
      let query = (supabase as any)
        .from('offer_checkout_addons')
        .select('id, kind, title, description, price, active, sort_order')
        .eq('offer_id', offerId);
      if (typeof query.order === 'function') {
        query = query.order('sort_order', { ascending: true }).order('created_at', { ascending: true });
      }
      if (locationId) query = query.eq('location_id', locationId);
      if (activeOnly) query = query.eq('active', true);
      const { data, error } = await query;
      if (error) throw error;
      return (data || []).map((row: any) => ({
        id: row.id,
        kind: normalizeKind(row.kind),
        title: row.title || '',
        description: row.description || '',
        price: Number(row.price || 0),
        active: row.active !== false,
        sortOrder: Number(row.sort_order || 0),
      }));
    } catch (err: any) {
      const message = String(err?.message || '');
      if (
        err instanceof TypeError
        || err?.code === '42P01'
        || err?.code === '42703'
        || err?.code === 'PGRST204'
        || message.includes('offer_checkout_addons')
      ) {
        return [];
      }
      throw err;
    }
  },

  async replaceOfferAddons(locationId: string, offerId: string, addons: CheckoutAddonInput[] = []): Promise<void> {
    try {
      const supabase = getSupabase();
      const { error: deleteError } = await supabase
        .from('offer_checkout_addons')
        .delete()
        .eq('location_id', locationId)
        .eq('offer_id', offerId);
      if (deleteError) throw deleteError;

      const rows = (addons || [])
        .map((addon, index) => ({
          location_id: locationId,
          offer_id: offerId,
          kind: normalizeKind(addon.kind),
          title: String(addon.title || '').trim(),
          description: String(addon.description || '').trim() || null,
          price: Number(addon.price || 0),
          active: addon.active !== false,
          sort_order: Number.isFinite(Number(addon.sortOrder)) ? Number(addon.sortOrder) : index,
        }))
        .filter((addon) => addon.title && Number.isFinite(addon.price) && addon.price >= 0);

      if (rows.length === 0) return;
      const { error } = await supabase.from('offer_checkout_addons').insert(rows);
      if (error) throw error;
    } catch (err: any) {
      logger.error({
        locationId,
        offerId,
        addonCount: Array.isArray(addons) ? addons.length : 0,
        errorCode: err?.code,
        errorMessage: err?.message,
        errorDetails: err?.details,
        errorHint: err?.hint,
      }, 'Offer checkout add-ons save failed');
      throw new ValidationError(checkoutAddonWriteMessage(err));
    }
  },

  async quoteOffer(
    offer: OfferRecord,
    selectedAddonIds: unknown,
    paymentChoice: unknown,
    paymentMethod: PaymentMethod,
  ): Promise<CheckoutCartQuote> {
    const selectedIds = normalizeAddonIds(selectedAddonIds);
    const activeAddons = await this.listAddons(offer.id, offer.location_id, true);
    const selectedAddons = activeAddons.filter((addon) => addon.id && selectedIds.includes(addon.id));
    const missingIds = selectedIds.filter((id) => !selectedAddons.some((addon) => addon.id === id));
    if (missingIds.length > 0) {
      throw new ValidationError('One or more selected add-ons are no longer available.');
    }

    const choice = normalizePaymentChoice(paymentChoice, offer);
    const baseCents = baseAmountCents(offer, choice);
    const addonCents = selectedAddons.reduce((sum, addon) => sum + dollarsToCents(addon.price), 0);
    const totalBaseCents = baseCents + addonCents;
    const control = await dualPricingService.getActiveControl(offer.location_id);
    const isRecurringChoice = choice === 'installment' || choice === 'subscription';
    const syntheticOffer = {
      ...offer,
      price: centsToDollars(totalBaseCents),
      pif_price: null,
      pif_discount_enabled: false,
      installment_amount: centsToDollars(totalBaseCents),
    } as OfferRecord;
    const quote = buildDualPricingQuote(syntheticOffer, control, choice, paymentMethod);
    const recurringQuote = isRecurringChoice
      ? buildDualPricingQuote({
        ...offer,
        price: centsToDollars(baseCents),
        pif_price: null,
        pif_discount_enabled: false,
        installment_amount: centsToDollars(baseCents),
      } as OfferRecord, control, choice, paymentMethod)
      : null;
    const lineItems: CheckoutLineItem[] = [
      {
        type: 'base_offer',
        label: baseLabel(offer, choice),
        amountCents: baseCents,
        amount: centsToDollars(baseCents),
      },
      ...selectedAddons.map((addon) => {
        const amountCents = dollarsToCents(addon.price);
        return {
          type: addon.kind,
          addonId: addon.id,
          label: addon.title,
          description: addon.description || '',
          amountCents,
          amount: centsToDollars(amountCents),
        };
      }),
    ];

    return {
      dualPricingEnabled: quote.dualPricingEnabled,
      paymentChoice: choice,
      paymentMethod: quote.paymentMethod,
      baseAmountCents: baseCents,
      addonAmountCents: addonCents,
      dueTodayAmountCents: quote.selectedAmountCents,
      achAmountCents: quote.achAmountCents,
      cardAmountCents: quote.cardAmountCents,
      selectedAmountCents: quote.selectedAmountCents,
      achAmount: quote.achAmount,
      cardAmount: quote.cardAmount,
      selectedAmount: quote.selectedAmount,
      futureRecurringAchAmountCents: recurringQuote?.achAmountCents || 0,
      futureRecurringCardAmountCents: recurringQuote?.cardAmountCents || 0,
      futureRecurringSelectedAmountCents: recurringQuote?.selectedAmountCents || 0,
      futureRecurringAchAmount: recurringQuote?.achAmount || 0,
      futureRecurringCardAmount: recurringQuote?.cardAmount || 0,
      futureRecurringSelectedAmount: recurringQuote?.selectedAmount || 0,
      cardUpliftPercent: quote.cardUpliftPercent,
      processorDeductionPercent: quote.processorDeductionPercent,
      achAccessPolicy: quote.achAccessPolicy,
      lineItems,
    };
  },

  async selectedAddonIdsForConsent(consentToken: string): Promise<string[]> {
    if (!consentToken) return [];
    const { data, error } = await getSupabase()
      .from('enrollments')
      .select('selected_checkout_items')
      .eq('consent_token', consentToken)
      .maybeSingle();
    if (error) throw error;
    const items = Array.isArray(data?.selected_checkout_items) ? data.selected_checkout_items : [];
    return normalizeAddonIds(items.map((item: any) => item.addonId || item.addon_id));
  },

  lineItemsToSelectedCheckoutItems(lineItems: CheckoutLineItem[]): CheckoutLineItem[] {
    return lineItems.filter((item) => item.type !== 'base_offer');
  },
};
