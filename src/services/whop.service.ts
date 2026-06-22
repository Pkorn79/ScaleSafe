import axios, { AxiosInstance } from 'axios';
import crypto from 'crypto';
import { getSupabase } from '../clients/supabase.client';
import { OfferRecord } from '../repositories/offer.repository';
import { merchantRepository } from '../repositories/merchant.repository';
import { whopConfigService, WhopConfigRecord } from './whop-config.service';
import { config } from '../config';
import { logger } from '../utils/logger';
import { ValidationError } from '../utils/errors';
import type { CheckoutCartQuote } from './checkout-cart.service';

type WhopMetadata = Record<string, string | number | boolean | null | undefined>;

export function whopApiBaseUrl(environment: string): string {
  const explicitBase = environment === 'sandbox'
    ? process.env.WHOP_SANDBOX_API_BASE_URL || process.env.WHOP_API_BASE_URL
    : process.env.WHOP_API_BASE_URL;
  if (explicitBase) return explicitBase.replace(/\/+$/, '');
  return environment === 'sandbox'
    ? 'https://sandbox-api.whop.com/api/v1'
    : 'https://api.whop.com/api/v5';
}

function client(row: WhopConfigRecord): AxiosInstance {
  return axios.create({
    baseURL: whopApiBaseUrl(row.environment),
    timeout: 15000,
    headers: {
      Authorization: `Bearer ${whopConfigService.decryptApiKey(row)}`,
      'Content-Type': 'application/json',
    },
  });
}

function dollarsToCents(value: unknown): number {
  const amount = Number(value || 0);
  return Math.max(0, Math.round(amount * 100));
}

function billingPeriodDaysForOffer(offer: OfferRecord): { billingPeriodDays: number; totalCycles?: number } | null {
  if (!['installments', 'subscription'].includes(String(offer.payment_type || ''))) return null;
  const freq = String(offer.installment_frequency || 'monthly');
  const daysMap: Record<string, number> = {
    daily: 1,
    weekly: 7,
    bi_weekly: 14,
    biweekly: 14,
    monthly: 30,
    quarterly: 90,
    annual: 365,
  };
  return {
    billingPeriodDays: daysMap[freq] || daysMap.monthly,
    ...(offer.payment_type === 'installments' && offer.num_payments ? { totalCycles: Number(offer.num_payments) } : {}),
  };
}

function extractId(data: any, ...keys: string[]): string {
  for (const key of keys) {
    const value = data?.[key];
    if (typeof value === 'string') return value;
    if (value?.id) return value.id;
  }
  return data?.id || data?._id || '';
}

function centsToDollars(cents: number): number {
  return Math.round(Number(cents || 0)) / 100;
}

function whopErrorMessage(err: any, fallback: string): string {
  const body = err?.response?.data;
  const errors = Array.isArray(body?.errors)
    ? body.errors.map((e: any) => e?.message || e?.detail || e).filter(Boolean).join('; ')
    : '';
  const candidates = [
    body?.error?.message,
    body?.error,
    body?.message,
    body?.detail,
    errors,
    err?.message,
  ].filter(Boolean);
  const message = candidates.find((value) => typeof value === 'string' && value.trim());
  return message || fallback;
}

async function updateWhopSync(locationId: string, offerId: string, updates: Record<string, unknown>): Promise<void> {
  await getSupabase()
    .from('offers_mirror')
    .update(updates)
    .eq('id', offerId)
    .eq('location_id', locationId);
}

export const whopService = {
  async testConnection(locationId: string): Promise<{ success: boolean; message: string }> {
    const row = await whopConfigService.getRequired(locationId);
    try {
      await client(row).get(`/companies/${encodeURIComponent(row.company_id)}`);
      await whopConfigService.markVerified(locationId);
      return { success: true, message: 'Whop connection verified.' };
    } catch (err: any) {
      const message = whopErrorMessage(err, 'Whop connection failed');
      await whopConfigService.markError(locationId, message);
      return { success: false, message };
    }
  },

  async syncOffer(locationId: string, offer: OfferRecord): Promise<OfferRecord> {
    const row = await whopConfigService.getRequired(locationId);
    const api = client(row);
    const metadata = {
      scalesafe_location_id: locationId,
      scalesafe_offer_id: offer.id,
      scalesafe_checkout_type: 'whop',
    };

    try {
      let productId = offer.whop_product_id || '';
      if (!productId) {
        const productRes = await api.post('/products', {
          company_id: row.company_id,
          title: offer.offer_name,
          name: offer.offer_name,
          description: offer.program_description || '',
          visibility: 'hidden',
          metadata,
        });
        productId = extractId(productRes.data, 'product');
      } else {
        await api.patch(`/products/${encodeURIComponent(productId)}`, {
          title: offer.offer_name,
          name: offer.offer_name,
          description: offer.program_description || '',
          metadata,
        });
      }

      if (!productId) throw new Error('Whop product sync returned no product ID');

      const recurring = billingPeriodDaysForOffer(offer);
      const amount = offer.payment_type === 'installments' || offer.payment_type === 'subscription'
        ? Number(offer.installment_amount || offer.price || 0)
        : Number(offer.pif_discount_enabled && offer.pif_price != null ? offer.pif_price : offer.price || 0);

      let planId = offer.whop_plan_id || '';
      const planPayload: Record<string, unknown> = {
        company_id: row.company_id,
        product_id: productId,
        plan_type: recurring ? 'renewal' : 'one_time',
        release_method: 'buy_now',
        title: offer.offer_name,
        nickname: offer.offer_name,
        currency: 'usd',
        initial_price: recurring ? 0 : amount,
        renewal_price: recurring ? amount : null,
        billing_period: recurring ? recurring.billingPeriodDays : null,
        visibility: 'hidden',
        unlimited_stock: true,
        metadata,
      };
      if (recurring) {
        if (recurring.totalCycles) planPayload.split_pay_required_payments = recurring.totalCycles;
      }

      if (!planId) {
        const planRes = await api.post('/plans', planPayload);
        planId = extractId(planRes.data, 'plan');
      } else {
        await api.patch(`/plans/${encodeURIComponent(planId)}`, planPayload);
      }
      if (!planId) throw new Error('Whop plan sync returned no plan ID');

      await updateWhopSync(locationId, offer.id, {
        whop_product_id: productId,
        whop_plan_id: planId,
        whop_sync_status: 'synced',
        whop_sync_error: null,
        whop_last_synced_at: new Date().toISOString(),
      });

      const { data } = await getSupabase()
        .from('offers_mirror')
        .select('*')
        .eq('id', offer.id)
        .eq('location_id', locationId)
        .single();
      return data;
    } catch (err: any) {
      const message = whopErrorMessage(err, 'Whop sync failed');
      logger.error({ locationId, offerId: offer.id, err: message }, 'Whop offer sync failed');
      await updateWhopSync(locationId, offer.id, {
        whop_sync_status: 'error',
        whop_sync_error: message,
      });
      throw new ValidationError(`Whop product/plan sync failed: ${message}`);
    }
  },

  async createCheckoutSession(input: {
    locationId: string;
    offer: OfferRecord;
    enrollmentId?: string;
    contactId?: string;
    contactEmail?: string;
    contactName?: string;
    consentToken?: string;
    checkoutMode: 'full_enrollment' | 'quick_checkout';
    quote?: CheckoutCartQuote | null;
  }): Promise<{ sessionId: string; checkoutUrl?: string; planId: string; embedScriptUrl: string; environment: string }> {
    const row = await whopConfigService.getRequired(input.locationId);
    const merchant = await merchantRepository.getByLocationId(input.locationId);
    if (!input.offer.whop_plan_id) {
      throw new ValidationError('This Whop offer is not synced yet. Save the offer again after connecting Whop.');
    }
    const metadata: WhopMetadata = {
      location_id: input.locationId,
      merchant_id: merchant.id,
      offer_id: input.offer.id,
      enrollment_id: input.enrollmentId || '',
      contact_id: input.contactId || '',
      consent_token: input.consentToken || '',
      checkout_mode: input.checkoutMode,
    };
    const quote = input.quote || null;
    const recurring = billingPeriodDaysForOffer(input.offer);
    const addonCents = quote?.addonAmountCents || 0;
    const futureRecurringCents = quote?.futureRecurringSelectedAmountCents || 0;
    const needsSessionPlan = Boolean(recurring && quote && (addonCents > 0 || futureRecurringCents > 0));
    let planId = input.offer.whop_plan_id;

    if (needsSessionPlan && recurring) {
      if (!input.offer.whop_product_id) {
        throw new ValidationError('This Whop offer is missing its synced product ID. Save the offer again, then retry checkout.');
      }
      const planPayload: Record<string, unknown> = {
        company_id: row.company_id,
        product_id: input.offer.whop_product_id,
        plan_type: 'renewal',
        release_method: 'buy_now',
        title: input.offer.offer_name,
        nickname: `${input.offer.offer_name} checkout`,
        currency: 'usd',
        initial_price: centsToDollars(addonCents),
        renewal_price: centsToDollars(futureRecurringCents),
        billing_period: recurring.billingPeriodDays,
        visibility: 'hidden',
        unlimited_stock: true,
        metadata: {
          ...metadata,
          scalesafe_dynamic_checkout_plan: true,
          due_today_amount: quote?.selectedAmount || 0,
          one_time_addon_amount: centsToDollars(addonCents),
          future_recurring_amount: centsToDollars(futureRecurringCents),
          line_items: JSON.stringify(quote?.lineItems || []),
        },
      };
      if (recurring.totalCycles) planPayload.split_pay_required_payments = recurring.totalCycles;
      const planRes = await client(row).post('/plans', planPayload);
      planId = extractId(planRes.data, 'plan');
      if (!planId) throw new Error('Whop dynamic checkout plan returned no plan ID');
    }

    const redirectUrl = `${config.appUrl.replace(/\/+$/, '')}/payment-thank-you?offerId=${encodeURIComponent(input.offer.id)}`;
    const payload = {
      plan_id: planId,
      mode: 'payment',
      currency: 'usd',
      metadata: {
        ...metadata,
        ...(quote ? {
          due_today_amount: quote.selectedAmount,
          selected_amount: quote.selectedAmount,
          one_time_addon_amount: centsToDollars(addonCents),
          future_recurring_amount: centsToDollars(futureRecurringCents),
          line_items: JSON.stringify(quote.lineItems || []),
        } : {}),
      },
      redirect_url: redirectUrl,
      source_url: config.appUrl,
      allow_promo_codes: false,
    };
    let res;
    try {
      res = await client(row).post('/checkout_configurations', payload);
    } catch (err: any) {
      throw new Error(whopErrorMessage(err, 'Whop checkout configuration failed'));
    }
    const sessionId = extractId(res.data, 'checkout_session', 'session') || res.data?.checkout_session_id || res.data?.checkoutSessionId || '';
    const checkoutUrl = res.data?.purchase_url || res.data?.url || res.data?.checkout_url || res.data?.checkoutSession?.url;
    if (!sessionId) throw new Error('Whop checkout configuration returned no ID');

    return {
      sessionId,
      checkoutUrl,
      planId,
      embedScriptUrl: process.env.WHOP_EMBED_SCRIPT_URL || 'https://js.whop.com/static/checkout/loader.js',
      environment: row.environment === 'sandbox' ? 'sandbox' : 'production',
    };
  },

  verifyStandardWebhook(rawBody: Buffer, headers: Record<string, any>, secret: string): boolean {
    const id = headers['webhook-id'] || headers['svix-id'];
    const timestamp = headers['webhook-timestamp'] || headers['svix-timestamp'];
    const signatureHeader = headers['webhook-signature'] || headers['svix-signature'];
    if (!id || !timestamp || !signatureHeader || !secret) return false;

    const signedPayload = `${id}.${timestamp}.${rawBody.toString('utf8')}`;
    const normalizedSecret = secret.startsWith('whsec_')
      ? Buffer.from(secret.slice('whsec_'.length), 'base64')
      : Buffer.from(secret, 'utf8');
    const expected = crypto.createHmac('sha256', normalizedSecret).update(signedPayload).digest('base64');
    const signatures = String(signatureHeader)
      .split(' ')
      .flatMap((part) => part.split(','))
      .map((part) => part.trim().replace(/^v1[=,]/, ''))
      .filter(Boolean);
    return signatures.some((sig) => {
      const a = Buffer.from(sig);
      const b = Buffer.from(expected);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    });
  },
};
