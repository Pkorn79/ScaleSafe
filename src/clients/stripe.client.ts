/* eslint-disable @typescript-eslint/no-var-requires */
import { ProcessorInterface } from '../interfaces/processor.interface';
import {
  ChargeRequest, ChargeResult,
  RefundRequest, RefundResult,
  SaveCardRequest, SaveCardResult, StoredCard,
  CreateSubscriptionRequest, SubscriptionResult,
  VerifyResult,
} from '../types/processor.types';
import { ProcessorError } from '../errors/processor.error';
import { config } from '../config';
import { logger } from '../utils/logger';

// Stripe v22 default export is a constructor function, not a class.
// Use require() for clean instantiation — types come from inference.
const Stripe = require('stripe');

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
        receipt_email: request.metadata?.customer_email,
      };

      if (request.requestThreeDSecure) {
        params.payment_method_options = {
          card: { request_three_d_secure: 'any' },
        };
      }

      const pi = await this.stripe.paymentIntents.create(params, this.acct);
      return this.toChargeResult(pi);
    } catch (err) {
      return this.handleChargeError(err);
    }
  }

  // ─── refund ────────────────────────────────────────────────

  async refund(request: RefundRequest): Promise<RefundResult> {
    try {
      const params: Record<string, any> = {
        payment_intent: request.transactionId,
        reason: 'requested_by_customer',
      };

      if (request.amount !== undefined) {
        params.amount = request.amount;
      }

      const refund = await this.stripe.refunds.create(params, this.acct);

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

      const pm = await this.stripe.paymentMethods.retrieve(request.paymentToken, this.acct);

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

      const customer = await this.stripe.customers.retrieve(customerId, this.acct);
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
            interval: request.interval === 'weekly' ? 'week' : 'month',
            interval_count: request.interval === 'biweekly' ? 2 : 1,
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

      // Stripe doesn't have "stop after N" — use cancel_at timestamp
      if (request.totalPayments > 0) {
        const intervalSeconds = this.getIntervalSeconds(request.interval);
        const startMs = request.startDate
          ? new Date(request.startDate).getTime()
          : Date.now();
        subParams.cancel_at = Math.floor(startMs / 1000) + (request.totalPayments * intervalSeconds);
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
      await this.stripe.subscriptions.cancel(subscriptionId, this.acct);
      return { success: true };
    } catch (err) {
      const procErr = this.toProcessorError(err);
      return { success: false, errorMessage: procErr.message };
    }
  }

  // ─── verifyTransaction ─────────────────────────────────────

  async verifyTransaction(transactionId: string): Promise<VerifyResult> {
    try {
      const pi = await this.stripe.paymentIntents.retrieve(transactionId, this.acct);

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

  private getIntervalSeconds(interval: 'weekly' | 'biweekly' | 'monthly'): number {
    switch (interval) {
      case 'weekly': return 7 * 86400;
      case 'biweekly': return 14 * 86400;
      case 'monthly': return 30 * 86400;
    }
  }
}
