import axios, { AxiosInstance } from 'axios';
import crypto from 'crypto';
import { getSupabase } from '../clients/supabase.client';
import { OfferRecord } from '../repositories/offer.repository';
import { merchantRepository } from '../repositories/merchant.repository';
import { whopConfigService, WhopConfigRecord } from './whop-config.service';
import { config } from '../config';
import { logger } from '../utils/logger';
import { ValidationError } from '../utils/errors';

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

function intervalForOffer(offer: OfferRecord): { interval: string; intervalCount: number; totalCycles?: number } | null {
  if (!['installments', 'subscription'].includes(String(offer.payment_type || ''))) return null;
  const freq = String(offer.installment_frequency || 'monthly');
  const intervalMap: Record<string, { interval: string; intervalCount: number }> = {
    daily: { interval: 'day', intervalCount: 1 },
    weekly: { interval: 'week', intervalCount: 1 },
    bi_weekly: { interval: 'week', intervalCount: 2 },
    biweekly: { interval: 'week', intervalCount: 2 },
    monthly: { interval: 'month', intervalCount: 1 },
    quarterly: { interval: 'month', intervalCount: 3 },
    annual: { interval: 'year', intervalCount: 1 },
  };
  const base = intervalMap[freq] || intervalMap.monthly;
  return {
    ...base,
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
      const message = err?.response?.data?.error?.message || err?.response?.data?.message || err.message || 'Whop connection failed';
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

      const recurring = intervalForOffer(offer);
      const amountCents = offer.payment_type === 'installments' || offer.payment_type === 'subscription'
        ? dollarsToCents(offer.installment_amount || offer.price)
        : dollarsToCents(
          offer.pif_discount_enabled && offer.pif_price != null ? offer.pif_price : offer.price,
        );

      let planId = offer.whop_plan_id || '';
      const planPayload: Record<string, unknown> = {
        company_id: row.company_id,
        product_id: productId,
        title: offer.offer_name,
        nickname: offer.offer_name,
        currency: 'usd',
        amount: amountCents,
        metadata,
      };
      if (recurring) {
        planPayload.billing_period = recurring.interval;
        planPayload.billing_period_count = recurring.intervalCount;
        if (recurring.totalCycles) planPayload.total_cycles = recurring.totalCycles;
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
      const message = err?.response?.data?.error?.message || err?.response?.data?.message || err.message || 'Whop sync failed';
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
  }): Promise<{ sessionId: string; checkoutUrl?: string; planId: string; embedScriptUrl: string }> {
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

    const redirectUrl = `${config.appUrl.replace(/\/+$/, '')}/payment-thank-you?offerId=${encodeURIComponent(input.offer.id)}`;
    const payload = {
      company_id: row.company_id,
      plan_id: input.offer.whop_plan_id,
      metadata,
      customer: {
        email: input.contactEmail || undefined,
        name: input.contactName || undefined,
      },
      success_url: redirectUrl,
      cancel_url: redirectUrl,
    };
    const res = await client(row).post('/checkout/sessions', payload);
    const sessionId = extractId(res.data, 'checkout_session', 'session') || res.data?.checkout_session_id || res.data?.checkoutSessionId || '';
    const checkoutUrl = res.data?.url || res.data?.checkout_url || res.data?.checkoutSession?.url;
    if (!sessionId) throw new Error('Whop checkout session returned no ID');

    return {
      sessionId,
      checkoutUrl,
      planId: input.offer.whop_plan_id,
      embedScriptUrl: process.env.WHOP_EMBED_SCRIPT_URL || 'https://js.whop.com/checkout.js',
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
