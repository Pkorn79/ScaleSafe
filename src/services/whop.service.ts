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

type WhopMembershipState = {
  membershipId: string;
  status: string;
  paymentCollectionPaused: boolean | null;
  nextPaymentDate?: string;
  canceledAt?: string;
  cancelAtPeriodEnd: boolean | null;
};

type WhopMembershipLifecycleResult = WhopMembershipState & {
  success: true;
};

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

function extractRefundId(data: any): string | undefined {
  const candidates = [
    data?.refund_id,
    data?.refundId,
    data?.refund?.id,
    data?.id,
  ];
  const refundId = candidates.find(value => typeof value === 'string' && /^rf_[A-Za-z0-9]+$/.test(value));
  return typeof refundId === 'string' ? refundId : undefined;
}

function centsToDollars(cents: number): number {
  return Math.round(Number(cents || 0)) / 100;
}

function assertWhopMinimum(label: string, amount: number): void {
  if (!Number.isFinite(amount) || amount < 1) {
    throw new ValidationError(`${label} must be at least $1.00 for Whop checkout.`);
  }
}

function assertWhopId(label: string, value: string, prefix: string): void {
  if (!String(value || '').startsWith(prefix)) {
    throw new ValidationError(`${label} is missing or invalid for Whop.`);
  }
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

function membershipPayload(data: any): any {
  if (data?.data?.id) return data.data;
  if (data?.membership?.id) return data.membership;
  return data || {};
}

function normalizeMembershipState(data: any, membershipId: string): WhopMembershipState {
  const membership = membershipPayload(data);
  return {
    membershipId: String(membership?.id || membershipId),
    status: String(membership?.status || '').trim().toLowerCase(),
    paymentCollectionPaused: typeof membership?.payment_collection_paused === 'boolean'
      ? membership.payment_collection_paused
      : null,
    ...(membership?.renewal_period_end
      ? { nextPaymentDate: String(membership.renewal_period_end) }
      : {}),
    ...(membership?.canceled_at ? { canceledAt: String(membership.canceled_at) } : {}),
    cancelAtPeriodEnd: typeof membership?.cancel_at_period_end === 'boolean'
      ? membership.cancel_at_period_end
      : null,
  };
}

function lifecycleResult(state: WhopMembershipState): WhopMembershipLifecycleResult {
  return { success: true, ...state };
}

function isEndedMembership(status: string): boolean {
  return ['completed', 'canceled', 'expired'].includes(status);
}

function assertRecurringMembership(state: WhopMembershipState, action: string): void {
  if (!state.status) {
    throw new ValidationError(`Unable to ${action} Whop membership: Whop returned no membership status`);
  }
  if (isEndedMembership(state.status)) {
    throw new ValidationError(
      `Unable to ${action} Whop membership: membership status is ${state.status}`,
    );
  }
  if (!state.nextPaymentDate) {
    throw new ValidationError(
      `Unable to ${action} Whop membership: this membership has no recurring renewal schedule`,
    );
  }
}

async function retrieveMembershipState(
  api: AxiosInstance,
  membershipId: string,
): Promise<WhopMembershipState> {
  const res = await api.get(`/memberships/${encodeURIComponent(membershipId)}`);
  const state = normalizeMembershipState(res.data, membershipId);
  if (state.membershipId !== membershipId) {
    throw new ValidationError('Whop membership lookup returned an unexpected membership ID');
  }
  return state;
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

      const planPayload: Record<string, unknown> = {
        company_id: row.company_id,
        product_id: productId,
        plan_type: recurring ? 'renewal' : 'one_time',
        release_method: 'buy_now',
        title: offer.offer_name,
        nickname: offer.offer_name,
        currency: 'usd',
        initial_price: recurring ? 0 : amount,
        visibility: 'hidden',
        unlimited_stock: true,
        metadata,
      };
      if (recurring) {
        planPayload.renewal_price = amount;
        planPayload.billing_period = recurring.billingPeriodDays;
        if (recurring.totalCycles) planPayload.split_pay_required_payments = recurring.totalCycles;
        assertWhopMinimum('Whop renewal price', amount);
      } else {
        assertWhopMinimum('Whop one-time price', amount);
      }

      // Whop plans are cheap to recreate and fragile to mutate across billing
      // shapes. Recreate the hidden plan on every offer sync so a PIF offer does
      // not keep pointing at a stale renewal plan, or vice versa.
      const planRes = await api.post('/plans', planPayload);
      const planId = extractId(planRes.data, 'plan');
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
    contactPhone?: string;
    consentToken?: string;
    checkoutMode: 'full_enrollment' | 'quick_checkout' | 'quick_manual_sale';
    sendEnrollment?: boolean;
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
      contact_email: input.contactEmail || '',
      contact_name: input.contactName || '',
      contact_phone: input.contactPhone || '',
      consent_token: input.consentToken || '',
      checkout_mode: input.checkoutMode,
      send_enrollment: input.sendEnrollment === false ? 'false' : 'true',
    };
    const quote = input.quote || null;
    const quoteChoice = quote?.paymentChoice || (
      String(input.offer.payment_type || '') === 'subscription'
        ? 'subscription'
        : String(input.offer.payment_type || '') === 'installments'
          ? 'installment'
          : 'pif'
    );
    metadata.payment_choice = quoteChoice;
    const recurring = quoteChoice === 'installment' || quoteChoice === 'subscription'
      ? billingPeriodDaysForOffer(input.offer)
      : null;
    const addonCents = quote?.addonAmountCents || 0;
    const futureRecurringCents = quote?.futureRecurringSelectedAmountCents || 0;
    const selectedCents = quote?.selectedAmountCents || 0;
    // Use the offer's synced Whop plan only when it exactly matches the selected
    // checkout shape. Create a checkout-specific hidden plan when add-ons change
    // today's amount or a dual PIF/installment offer is paid in full.
    const needsRecurringSessionPlan = Boolean(recurring && quote && addonCents > 0);
    const needsOneTimeSessionPlan = Boolean(!recurring && quote && (
      addonCents > 0 || ['installments', 'subscription'].includes(String(input.offer.payment_type || ''))
    ));
    let planId = input.offer.whop_plan_id;

    if ((needsRecurringSessionPlan || needsOneTimeSessionPlan) && !input.offer.whop_product_id) {
      throw new ValidationError('This Whop offer is missing its synced product ID. Save the offer again, then retry checkout.');
    }

    if (needsRecurringSessionPlan && recurring) {
      if (!input.offer.whop_product_id) {
        throw new ValidationError('This Whop offer is missing its synced product ID. Save the offer again, then retry checkout.');
      }
      const addonAmount = centsToDollars(addonCents);
      const renewalAmount = centsToDollars(futureRecurringCents);
      assertWhopMinimum('Selected one-time Whop add-ons', addonAmount);
      assertWhopMinimum('Whop renewal price', renewalAmount);
      const planPayload: Record<string, unknown> = {
        company_id: row.company_id,
        product_id: input.offer.whop_product_id,
        plan_type: 'renewal',
        release_method: 'buy_now',
        title: input.offer.offer_name,
        nickname: `${input.offer.offer_name} checkout`,
        currency: 'usd',
        initial_price: addonAmount,
        renewal_price: renewalAmount,
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
      logger.info({
        locationId: input.locationId,
        offerId: input.offer.id,
        companyId: row.company_id,
        productId: input.offer.whop_product_id,
        initialPrice: planPayload.initial_price,
        renewalPrice: planPayload.renewal_price,
        billingPeriod: planPayload.billing_period,
        splitPayments: planPayload.split_pay_required_payments || null,
      }, 'Creating Whop dynamic checkout plan');
      let planRes;
      try {
        planRes = await client(row).post('/plans', planPayload);
      } catch (err: any) {
        logger.error({
          locationId: input.locationId,
          offerId: input.offer.id,
          status: err?.response?.status,
          whopError: err?.response?.data,
          planPayload: {
            company_id: planPayload.company_id,
            product_id: planPayload.product_id,
            plan_type: planPayload.plan_type,
            initial_price: planPayload.initial_price,
            renewal_price: planPayload.renewal_price,
            billing_period: planPayload.billing_period,
            split_pay_required_payments: planPayload.split_pay_required_payments || null,
          },
        }, 'Whop dynamic checkout plan creation failed');
        throw new Error(whopErrorMessage(err, 'Whop dynamic checkout plan failed'));
      }
      planId = extractId(planRes.data, 'plan');
      if (!planId) throw new Error('Whop dynamic checkout plan returned no plan ID');
    } else if (needsOneTimeSessionPlan) {
      const oneTimeAmount = centsToDollars(selectedCents);
      assertWhopMinimum('Whop one-time price', oneTimeAmount);
      const planPayload: Record<string, unknown> = {
        company_id: row.company_id,
        product_id: input.offer.whop_product_id,
        plan_type: 'one_time',
        release_method: 'buy_now',
        title: input.offer.offer_name,
        nickname: `${input.offer.offer_name} checkout`,
        currency: 'usd',
        initial_price: oneTimeAmount,
        visibility: 'hidden',
        unlimited_stock: true,
        metadata: {
          ...metadata,
          scalesafe_dynamic_checkout_plan: true,
          due_today_amount: quote?.selectedAmount || 0,
          one_time_addon_amount: centsToDollars(addonCents),
          future_recurring_amount: 0,
          line_items: JSON.stringify(quote?.lineItems || []),
        },
      };
      logger.info({
        locationId: input.locationId,
        offerId: input.offer.id,
        companyId: row.company_id,
        productId: input.offer.whop_product_id,
        initialPrice: planPayload.initial_price,
      }, 'Creating Whop one-time checkout plan');
      let planRes;
      try {
        planRes = await client(row).post('/plans', planPayload);
      } catch (err: any) {
        logger.error({
          locationId: input.locationId,
          offerId: input.offer.id,
          status: err?.response?.status,
          whopError: err?.response?.data,
          planPayload: {
            company_id: planPayload.company_id,
            product_id: planPayload.product_id,
            plan_type: planPayload.plan_type,
            initial_price: planPayload.initial_price,
          },
        }, 'Whop one-time checkout plan creation failed');
        throw new Error(whopErrorMessage(err, 'Whop one-time checkout plan failed'));
      }
      planId = extractId(planRes.data, 'plan');
      if (!planId) throw new Error('Whop one-time checkout plan returned no plan ID');
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
      logger.info({
        locationId: input.locationId,
        offerId: input.offer.id,
        planId,
        checkoutMode: input.checkoutMode,
        hasConsentToken: Boolean(input.consentToken),
        addonCents,
        futureRecurringCents,
      }, 'Creating Whop checkout configuration');
      res = await client(row).post('/checkout_configurations', payload);
    } catch (err: any) {
      logger.error({
        locationId: input.locationId,
        offerId: input.offer.id,
        status: err?.response?.status,
        whopError: err?.response?.data,
        checkoutPayload: {
          plan_id: payload.plan_id,
          mode: payload.mode,
          currency: payload.currency,
          redirect_url: payload.redirect_url,
          source_url: payload.source_url,
        },
      }, 'Whop checkout configuration failed');
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

  async refundPayment(locationId: string, input: {
    paymentId: string;
    partialAmount?: number;
  }): Promise<{ success: boolean; refundId?: string; status?: string; raw?: any }> {
    const row = await whopConfigService.getRequired(locationId);
    assertWhopId('Whop payment ID', input.paymentId, 'pay_');
    const payload: Record<string, unknown> = {};
    if (input.partialAmount != null) {
      const amount = Number(input.partialAmount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new ValidationError('Whop refund amount must be greater than $0.00');
      }
      payload.partial_amount = amount;
    }
    try {
      const res = await client(row).post(`/payments/${encodeURIComponent(input.paymentId)}/refund`, payload);
      return {
        success: true,
        // Whop returns the updated Payment (`pay_...`) here. The canonical
        // refund identifier (`rf_...`) arrives on refund.created.
        refundId: extractRefundId(res.data),
        status: res.data?.status || res.data?.refund?.status || 'refunded',
        raw: res.data,
      };
    } catch (err: any) {
      throw new ValidationError(whopErrorMessage(err, 'Whop refund failed'));
    }
  },

  async pauseMembership(locationId: string, membershipId: string): Promise<WhopMembershipLifecycleResult> {
    const row = await whopConfigService.getRequired(locationId);
    assertWhopId('Whop membership ID', membershipId, 'mem_');
    try {
      const api = client(row);
      const before = await retrieveMembershipState(api, membershipId);
      assertRecurringMembership(before, 'pause');
      if (before.paymentCollectionPaused === true) return lifecycleResult(before);

      const res = await api.post(`/memberships/${encodeURIComponent(membershipId)}/pause`);
      let after = normalizeMembershipState(res.data, membershipId);
      if (after.membershipId !== membershipId || after.paymentCollectionPaused !== true || !after.status) {
        after = await retrieveMembershipState(api, membershipId);
      }
      assertRecurringMembership(after, 'pause');
      if (after.paymentCollectionPaused !== true) {
        throw new ValidationError('Unable to pause Whop membership: Whop did not confirm paused billing');
      }
      return lifecycleResult(after);
    } catch (err: any) {
      throw new ValidationError(whopErrorMessage(err, 'Whop membership pause failed'));
    }
  },

  async resumeMembership(locationId: string, membershipId: string): Promise<WhopMembershipLifecycleResult> {
    const row = await whopConfigService.getRequired(locationId);
    assertWhopId('Whop membership ID', membershipId, 'mem_');
    try {
      const api = client(row);
      const before = await retrieveMembershipState(api, membershipId);
      assertRecurringMembership(before, 'resume');
      if (before.paymentCollectionPaused === false) return lifecycleResult(before);

      const res = await api.post(`/memberships/${encodeURIComponent(membershipId)}/resume`);
      let after = normalizeMembershipState(res.data, membershipId);
      if (
        after.membershipId !== membershipId
        || after.paymentCollectionPaused !== false
        || !after.status
        || !after.nextPaymentDate
      ) {
        after = await retrieveMembershipState(api, membershipId);
      }
      assertRecurringMembership(after, 'resume');
      if (after.paymentCollectionPaused !== false) {
        throw new ValidationError('Unable to resume Whop membership: Whop did not confirm active billing');
      }
      return lifecycleResult(after);
    } catch (err: any) {
      throw new ValidationError(whopErrorMessage(err, 'Whop membership resume failed'));
    }
  },

  async cancelMembership(locationId: string, membershipId: string): Promise<WhopMembershipLifecycleResult> {
    const row = await whopConfigService.getRequired(locationId);
    assertWhopId('Whop membership ID', membershipId, 'mem_');
    try {
      const api = client(row);
      const before = await retrieveMembershipState(api, membershipId);
      if (['canceled', 'expired'].includes(before.status)) return lifecycleResult(before);
      assertRecurringMembership(before, 'cancel');

      const res = await api.post(`/memberships/${encodeURIComponent(membershipId)}/cancel`, {
        cancellation_mode: 'immediate',
      });
      let after = normalizeMembershipState(res.data, membershipId);
      if (after.membershipId !== membershipId || !['canceled', 'expired'].includes(after.status)) {
        after = await retrieveMembershipState(api, membershipId);
      }
      if (!['canceled', 'expired'].includes(after.status)) {
        throw new ValidationError('Unable to cancel Whop membership: Whop did not confirm immediate cancellation');
      }
      return lifecycleResult(after);
    } catch (err: any) {
      throw new ValidationError(whopErrorMessage(err, 'Whop membership cancel failed'));
    }
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
