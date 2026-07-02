/* eslint-disable @typescript-eslint/no-var-requires */
import { ProcessorInterface } from '../interfaces/processor.interface';
import {
  ChargeRequest, ChargeResult,
  RefundRequest, RefundResult,
  SaveCardRequest, SaveCardResult, StoredCard,
  CreateSubscriptionRequest, ResumeSubscriptionRequest, SubscriptionResult,
  VerifyResult,
} from '../types/processor.types';
import { ProcessorError } from '../errors/processor.error';
import { config } from '../config';
import { logger } from '../utils/logger';

// Stripe v22 default export is a constructor function, not a class.
// Use require() for clean instantiation — types come from inference.
const Stripe = require('stripe');

/**
 * Compute a subscription cancel_at (epoch seconds) that yields exactly `totalPayments`
 * calendar cycles. Uses calendar arithmetic (real month lengths / leap years) rather than a
 * fixed 30-day approximation, then backs off 1h so cancel_at lands between the Nth and (N+1)th
 * billing anchors (bug hunt #16). Returns undefined for open-ended subscriptions.
 */
export function stripeCancelAtSeconds(startMs: number, interval: string, totalPayments: number): number | undefined {
  if (!(totalPayments > 0)) return undefined;
  const d = new Date(startMs);
  switch (interval) {
    case 'daily': d.setUTCDate(d.getUTCDate() + totalPayments); break;
    case 'weekly': d.setUTCDate(d.getUTCDate() + 7 * totalPayments); break;
    case 'biweekly': d.setUTCDate(d.getUTCDate() + 14 * totalPayments); break;
    case 'quarterly': d.setUTCMonth(d.getUTCMonth() + 3 * totalPayments); break;
    case 'annual': d.setUTCFullYear(d.getUTCFullYear() + totalPayments); break;
    case 'monthly':
    default: d.setUTCMonth(d.getUTCMonth() + totalPayments); break;
  }
  return Math.floor(d.getTime() / 1000) - 3600;
}

export class StripeClient implements ProcessorInterface {
  readonly processorType = 'stripe' as const;

  private readonly stripe: any;
  private readonly stripeAccountId: string;

  constructor(cfg: { stripeAccountId: string }) {
    this.stripe = new Stripe(config.stripe.secretKey, {
      apiVersion: '2025-03-31.basil',
    });
    this.stripeAccountId = cfg.stripeAccountId;
  }

  private get acct() {
    return { stripeAccount: this.stripeAccountId };
  }

  // ─── charge ────────────────────────────────────────────────

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    if (request.paymentMethodType === 'ach') {
      return {
        success: false,
        transactionId: '',
        amount: request.amount,
        currency: request.currency || 'usd',
        status: 'error',
        errorMessage: 'Stripe bank transfer uses the secure bank-account checkout flow.',
        errorCode: 'STRIPE_ACH_NOT_ENABLED',
      };
    }
    try {
      const params: Record<string, any> = {
        amount: request.amount,
        currency: request.currency || 'usd',
        payment_method: request.paymentToken,
        confirm: true,
        automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
        description: request.description,
        metadata: this.buildMetadata(request),
        statement_descriptor_suffix: request.statementDescriptorSuffix?.substring(0, 22),
        receipt_email: request.metadata?.customer_email || undefined,
      };

      // Atomic vault: attach customer + save card for future off-session use
      // Stripe equivalent of NMI's customer_vault=add_customer during charge
      let vaultCustomer: any = null;
      if (request.shouldVault && request.customerEmail) {
        vaultCustomer = await this.findOrCreateCustomer(
          request.customerEmail,
          request.customerName,
        );
        params.customer = vaultCustomer.id;
        params.setup_future_usage = 'off_session';
      }

      if (request.requestThreeDSecure) {
        params.payment_method_options = {
          card: { request_three_d_secure: 'any' },
        };
      }

      // Expand latest_charge so we get card details (last4, brand, exp) without a separate API call
      params.expand = ['latest_charge'];

      const pi = await this.stripe.paymentIntents.create(params, this.acct);
      const result = this.toChargeResult(pi);

      // Populate vault metadata from the PaymentIntent's charge object
      // (avoids a separate API call and works even if token format changed)
      if (result.success && vaultCustomer) {
        result.vaultedCustomerId = vaultCustomer.id;
        const latestCharge = typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
        logger.debug({ latestChargeType: typeof pi.latest_charge, hasLatestCharge: !!latestCharge }, 'Stripe latest charge expanded');
        const pmDetails = latestCharge?.payment_method_details?.card;
        if (pmDetails) {
          result.vaultedCardLastFour = pmDetails.last4 || '****';
          result.vaultedCardBrand = pmDetails.brand || 'unknown';
          result.vaultedCardExpMonth = pmDetails.exp_month || 0;
          result.vaultedCardExpYear = pmDetails.exp_year || 0;
          logger.debug('Stripe vault card metadata resolved from expanded charge');
        } else {
          logger.debug('Stripe charge did not include card metadata; trying payment method fallback');
          try {
            // Stripe Node SDK signature: retrieve(id, params, options).
            // Calling retrieve(id, this.acct) with two args makes the SDK treat
            // { stripeAccount } as `params`, and Stripe rejects with
            // "Received unknown parameter: stripeAccount". Use the explicit 3-arg form.
            const pm = await this.stripe.paymentMethods.retrieve(request.paymentToken, undefined, this.acct);
            result.vaultedCardLastFour = pm.card?.last4 || '****';
            result.vaultedCardBrand = pm.card?.brand || 'unknown';
            result.vaultedCardExpMonth = pm.card?.exp_month || 0;
            result.vaultedCardExpYear = pm.card?.exp_year || 0;
            logger.debug('Stripe vault card metadata resolved from payment method');
          } catch (pmErr: any) {
            logger.warn({ err: pmErr?.message }, 'Stripe payment method fallback failed');
            result.vaultedCardLastFour = '****';
            result.vaultedCardBrand = 'unknown';
            result.vaultedCardExpMonth = 0;
            result.vaultedCardExpYear = 0;
          }
        }
      }

      return result;
    } catch (err) {
      return this.handleChargeError(err);
    }
  }

  // ─── refund ────────────────────────────────────────────────

  async refund(request: RefundRequest): Promise<RefundResult> {
    try {
      const transactionId = String(request.transactionId || '').trim();
      const params: Record<string, any> = {
        reason: 'requested_by_customer',
      };
      if (transactionId.startsWith('ch_')) {
        params.charge = transactionId;
      } else {
        params.payment_intent = transactionId;
      }

      if (request.amount !== undefined) {
        params.amount = request.amount;
      }

      const requestOptions = request.idempotencyKey
        ? { ...this.acct, idempotencyKey: request.idempotencyKey }
        : this.acct;
      const refund = await this.stripe.refunds.create(params, requestOptions);

      return {
        success: refund.status === 'succeeded',
        refundId: refund.id,
        amount: refund.amount,
        status: refund.status === 'succeeded' ? 'refunded' : 'pending',
        errorMessage: refund.status === 'failed' ? refund.failure_reason || undefined : undefined,
      };
    } catch (err) {
      throw this.toProcessorError(err);
    }
  }

  // ─── saveCard ──────────────────────────────────────────────

  async saveCard(request: SaveCardRequest): Promise<SaveCardResult> {
    if (request.paymentMethodType === 'ach') {
      throw new ProcessorError(
        'Stripe bank transfer uses the secure bank-account setup flow.',
        'stripe',
        'STRIPE_ACH_NOT_ENABLED',
      );
    }
    try {
      const customer = await this.findOrCreateCustomer(
        request.customerEmail,
        request.customerName,
      );

      await this.stripe.paymentMethods.attach(
        request.paymentToken,
        { customer: customer.id },
        this.acct,
      );

      // Stripe Node SDK signature: retrieve(id, params, options) — see Group E note in charge().
      const pm = await this.stripe.paymentMethods.retrieve(request.paymentToken, undefined, this.acct);

      return {
        success: true,
        paymentMethodId: pm.id,
        customerId: customer.id,
        cardLastFour: pm.card?.last4 || '****',
        cardBrand: pm.card?.brand || 'unknown',
        cardExpMonth: pm.card?.exp_month || 0,
        cardExpYear: pm.card?.exp_year || 0,
      };
    } catch (err) {
      throw this.toProcessorError(err);
    }
  }

  // ─── listCards ─────────────────────────────────────────────

  async listCards(customerId: string): Promise<StoredCard[]> {
    try {
      const methods = await this.stripe.paymentMethods.list(
        { customer: customerId, type: 'card' },
        this.acct,
      );

      // 3-arg form: stripeAccount must be the options arg, not params (bug hunt #15).
      const customer = await this.stripe.customers.retrieve(customerId, undefined, this.acct);
      const defaultPmId = customer.invoice_settings?.default_payment_method;

      return methods.data.map((pm: any) => ({
        paymentMethodId: pm.id,
        customerId,
        cardLastFour: pm.card?.last4 || '****',
        cardBrand: pm.card?.brand || 'unknown',
        cardExpMonth: pm.card?.exp_month || 0,
        cardExpYear: pm.card?.exp_year || 0,
        isDefault: pm.id === defaultPmId,
      }));
    } catch (err) {
      throw this.toProcessorError(err);
    }
  }

  // ─── chargeStoredCard ──────────────────────────────────────

  async chargeStoredCard(
    customerId: string,
    paymentMethodId: string,
    request: ChargeRequest,
  ): Promise<ChargeResult> {
    try {
      const pi = await this.stripe.paymentIntents.create(
        {
          amount: request.amount,
          currency: request.currency || 'usd',
          customer: customerId,
          payment_method: paymentMethodId,
          confirm: true,
          off_session: true,
          description: request.description,
          metadata: this.buildMetadata(request),
          statement_descriptor_suffix: request.statementDescriptorSuffix?.substring(0, 22),
        },
        this.acct,
      );

      return this.toChargeResult(pi);
    } catch (err) {
      return this.handleChargeError(err);
    }
  }

  // ─── createSubscription ────────────────────────────────────

  async createSubscription(request: CreateSubscriptionRequest): Promise<SubscriptionResult> {
    try {
      const price = await this.stripe.prices.create(
        {
          unit_amount: request.planAmount,
          currency: 'usd',
          recurring: {
            interval: request.interval === 'daily' ? 'day' : request.interval === 'weekly' ? 'week' : request.interval === 'annual' ? 'year' : 'month',
            interval_count: request.interval === 'biweekly' ? 2 : request.interval === 'quarterly' ? 3 : 1,
          },
          product_data: { name: request.description || 'ScaleSafe Subscription' },
        },
        this.acct,
      );

      const subParams: Record<string, any> = {
        customer: request.customerId,
        items: [{ price: price.id }],
        default_payment_method: request.paymentMethodId,
        metadata: request.metadata,
      };

      // Defer the first billing cycle to startDate (next_billing_date) instead of
      // letting Stripe auto-bill a subscription_create invoice immediately at
      // subscription creation time. Without billing_cycle_anchor, Stripe defaults
      // to billing_cycle_anchor=now, which fires a full-amount subscription_create
      // invoice on day 1 — duplicating the upfront processor.charge() call and
      // double-billing the customer (PMG symptom: $1.00 charged on enrollment day
      // for a $0.50/2-pay offer instead of $0.50). proration_behavior=none keeps
      // the implicit gap from "now" to "billing_cycle_anchor" from being prorated.
      const startMs = request.startDate
        ? new Date(request.startDate).getTime()
        : Date.now();
      const startSec = Math.floor(startMs / 1000);
      const nowSec = Math.floor(Date.now() / 1000);

      if (startSec > nowSec + 60) {
        subParams.billing_cycle_anchor = startSec;
        subParams.proration_behavior = 'none';
      }

      // Stripe doesn't have "stop after N" — use a cancel_at timestamp computed with calendar
      // arithmetic so it cannot overshoot into an extra invoice (bug hunt #16).
      const cancelAt = stripeCancelAtSeconds(startMs, request.interval, request.totalPayments);
      if (cancelAt !== undefined) {
        subParams.cancel_at = cancelAt;
      }

      const subscription = await this.stripe.subscriptions.create(subParams, this.acct);

      return {
        success: true,
        subscriptionId: subscription.id,
        status: subscription.status === 'active' ? 'active' : 'pending',
        nextPaymentDate: subscription.current_period_end
          ? new Date(subscription.current_period_end * 1000).toISOString()
          : undefined,
      };
    } catch (err) {
      const procErr = this.toProcessorError(err);
      return {
        success: false,
        subscriptionId: '',
        status: 'failed',
        errorMessage: procErr.message,
      };
    }
  }

  // ─── cancelSubscription ────────────────────────────────────

  async cancelSubscription(subscriptionId: string): Promise<{ success: boolean; errorMessage?: string }> {
    try {
      // Stripe SDK v22 uses (id, params?, options?). Passing stripeAccount as the
      // second argument makes Stripe treat it as a request param and reject it.
      await this.stripe.subscriptions.cancel(subscriptionId, undefined, this.acct);
      return { success: true };
    } catch (err) {
      const procErr = this.toProcessorError(err);
      return { success: false, errorMessage: procErr.message };
    }
  }

  // ─── pauseSubscription ──────────────────────────────────────

  async pauseSubscription(subscriptionId: string): Promise<{ success: boolean; errorMessage?: string }> {
    try {
      await this.stripe.subscriptions.update(
        subscriptionId,
        { pause_collection: { behavior: 'void' } },
        this.acct,
      );
      return { success: true };
    } catch (err) {
      const procErr = this.toProcessorError(err);
      return { success: false, errorMessage: procErr.message };
    }
  }

  // ─── resumeSubscription ────────────────────────────────────

  async resumeSubscription(request: ResumeSubscriptionRequest): Promise<SubscriptionResult> {
    try {
      // For Stripe, resume = remove pause_collection from existing subscription
      const subscription = await this.stripe.subscriptions.update(
        request.subscriptionId,
        { pause_collection: null as any },
        this.acct,
      );
      return {
        success: true,
        subscriptionId: subscription.id,
        status: subscription.status === 'active' ? 'active' : 'pending',
        nextPaymentDate: subscription.current_period_end
          ? new Date(subscription.current_period_end * 1000).toISOString()
          : undefined,
      };
    } catch (err) {
      const procErr = this.toProcessorError(err);
      return { success: false, subscriptionId: request.subscriptionId, status: 'failed', errorMessage: procErr.message };
    }
  }

  // ─── verifyTransaction ─────────────────────────────────────

  async verifyTransaction(transactionId: string): Promise<VerifyResult> {
    try {
      // 3-arg form: stripeAccount must be the options arg, not params (bug hunt #15).
      const pi = await this.stripe.paymentIntents.retrieve(transactionId, undefined, this.acct);

      const statusMap: Record<string, VerifyResult['status']> = {
        succeeded: 'settled',
        processing: 'pending',
        requires_payment_method: 'failed',
        requires_confirmation: 'pending',
        requires_action: 'pending',
        canceled: 'voided',
      };

      return {
        success: true,
        transactionId: pi.id,
        status: statusMap[pi.status] || 'pending',
        amount: pi.amount,
      };
    } catch (err) {
      throw this.toProcessorError(err);
    }
  }

  // ─── testConnection ────────────────────────────────────────

  async createAchPaymentIntent(request: {
    amount: number;
    currency?: string;
    customerEmail: string;
    customerName?: string;
    description?: string;
    metadata?: Record<string, string>;
    setupFutureUsage?: boolean;
  }): Promise<{
    paymentIntentId: string;
    clientSecret: string;
    status: string;
    customerId: string;
    stripeAccountId: string;
  }> {
    try {
      const customer = await this.findOrCreateCustomer(
        request.customerEmail,
        request.customerName,
      );

      const params: Record<string, any> = {
        amount: request.amount,
        currency: request.currency || 'usd',
        customer: customer.id,
        payment_method_types: ['us_bank_account'],
        payment_method_options: {
          us_bank_account: {
            financial_connections: {
              permissions: ['payment_method'],
            },
          },
        },
        description: request.description,
        metadata: request.metadata || {},
      };

      if (request.setupFutureUsage) {
        params.setup_future_usage = 'off_session';
      }

      const pi = await this.stripe.paymentIntents.create(params, this.acct);
      return {
        paymentIntentId: pi.id,
        clientSecret: pi.client_secret,
        status: pi.status,
        customerId: customer.id,
        stripeAccountId: this.stripeAccountId,
      };
    } catch (err) {
      throw this.toProcessorError(err);
    }
  }

  async retrievePaymentIntent(paymentIntentId: string): Promise<any> {
    try {
      return this.stripe.paymentIntents.retrieve(
        paymentIntentId,
        { expand: ['payment_method', 'latest_charge'] },
        this.acct,
      );
    } catch (err) {
      throw this.toProcessorError(err);
    }
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const account = await this.stripe.accounts.retrieve(this.stripeAccountId);
      return {
        success: true,
        message: `Connected to ${account.business_profile?.name || account.id}`,
      };
    } catch (err) {
      return {
        success: false,
        message: err instanceof ProcessorError ? err.message : 'Connection failed',
      };
    }
  }

  // ─── Private helpers ───────────────────────────────────────

  private buildMetadata(request: ChargeRequest): Record<string, string> {
    const meta: Record<string, string> = {
      scalesafe_offer_id: request.metadata?.scalesafe_offer_id || '',
      terms_accepted: request.metadata?.terms_accepted || '',
      terms_accepted_at: request.metadata?.terms_accepted_at || '',
      ce30_eligible: request.metadata?.ce30_eligible || '',
      customer_ip: request.metadata?.customer_ip || request.metadata?.ip_address || '',
    };

    if (request.metadata) {
      for (const [key, value] of Object.entries(request.metadata)) {
        if (!meta[key]) meta[key] = value;
      }
    }

    return meta;
  }

  private async findOrCreateCustomer(email: string, name?: string): Promise<any> {
    const customers = await this.stripe.customers.list(
      { email, limit: 1 },
      this.acct,
    );

    if (customers.data.length > 0) {
      return customers.data[0];
    }

    return this.stripe.customers.create({ email, name }, this.acct);
  }

  private toChargeResult(pi: any): ChargeResult {
    const latestCharge = pi.latest_charge;
    const chargeId = typeof latestCharge === 'string' ? latestCharge : latestCharge?.id;

    switch (pi.status) {
      case 'succeeded':
        return {
          success: true,
          transactionId: pi.id,
          chargeId,
          amount: pi.amount,
          currency: pi.currency,
          status: 'approved',
          rawResponse: { id: pi.id, status: pi.status },
        };

      case 'requires_action':
        return {
          success: false,
          transactionId: pi.id,
          chargeId,
          amount: pi.amount,
          currency: pi.currency,
          status: 'pending_3ds',
          threeDSecureUrl: pi.next_action?.redirect_to_url?.url || undefined,
        };

      default:
        return {
          success: false,
          transactionId: pi.id,
          chargeId,
          amount: pi.amount,
          currency: pi.currency,
          status: 'declined',
          errorMessage: pi.last_payment_error?.message,
          errorCode: pi.last_payment_error?.code,
        };
    }
  }

  private handleChargeError(err: unknown): ChargeResult {
    // Stripe SDK errors have a `type` field
    if (err instanceof Error && (err as any).type === 'StripeCardError') {
      return {
        success: false,
        transactionId: '',
        amount: 0,
        currency: 'usd',
        status: 'declined',
        errorMessage: err.message,
        errorCode: (err as any).code,
      };
    }
    if (err instanceof Error && (err as any).type === 'StripeInvalidRequestError') {
      return {
        success: false,
        transactionId: '',
        amount: 0,
        currency: 'usd',
        status: 'error',
        errorMessage: err.message,
        errorCode: (err as any).code || 'stripe_invalid_request',
      };
    }
    throw this.toProcessorError(err);
  }

  private toProcessorError(err: unknown): ProcessorError {
    if (!(err instanceof Error)) {
      return new ProcessorError('Unknown Stripe error', 'stripe', 'UNKNOWN');
    }

    const stripeErr = err as any;
    const type = stripeErr.type as string | undefined;

    if (type === 'StripeConnectionError' || type === 'StripeRateLimitError') {
      return new ProcessorError(err.message, 'stripe', stripeErr.code, true, err);
    }
    if (type === 'StripeAuthenticationError') {
      return new ProcessorError('Stripe authentication failed', 'stripe', stripeErr.code, false, err);
    }
    if (type?.startsWith('Stripe')) {
      return new ProcessorError(err.message, 'stripe', stripeErr.code, false, err);
    }

    return new ProcessorError(err.message, 'stripe', 'UNKNOWN');
  }

}
