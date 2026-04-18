import axios from 'axios';
import { ProcessorInterface } from '../interfaces/processor.interface';
import {
  ChargeRequest, ChargeResult,
  RefundRequest, RefundResult,
  SaveCardRequest, SaveCardResult, StoredCard,
  CreateSubscriptionRequest, ResumeSubscriptionRequest, SubscriptionResult,
  VerifyResult,
} from '../types/processor.types';
import { ProcessorError } from '../errors/processor.error';
import {
  parseNmiResponse,
  parseNmiQueryTransactions,
  parseNmiVaultRecords,
  centsToDollars,
  formatNmiDate,
  extractLastFour,
  parseNmiExpiry,
} from '../utils/nmi.utils';
import { logger } from '../utils/logger';

export class NmiClient implements ProcessorInterface {
  readonly processorType = 'nmi' as const;

  private readonly securityKey: string;
  private readonly tokenizationKey: string;
  private readonly processorId?: string;

  private readonly transactUrl = 'https://secure.nmi.com/api/transact.php';
  private readonly queryUrl = 'https://secure.nmi.com/api/query.php';

  constructor(config: {
    securityKey: string;
    tokenizationKey: string;
    processorId?: string;
  }) {
    this.securityKey = config.securityKey;
    this.tokenizationKey = config.tokenizationKey;
    this.processorId = config.processorId;
  }

  // ─── charge ────────────────────────────────────────────────

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    const params = new URLSearchParams();
    params.set('security_key', this.securityKey);
    params.set('type', 'sale');
    params.set('amount', centsToDollars(request.amount));
    params.set('currency', (request.currency || 'USD').toUpperCase());
    params.set('payment_token', request.paymentToken);

    // Atomic vault: charge + vault in a single NMI API call.
    // NMI tokens are single-use — if we charge first then try to vault separately,
    // the vault fails because the token is consumed. This combines both operations.
    if (request.shouldVault) {
      params.set('customer_vault', 'add_customer');
      if (request.customerEmail) params.set('email', request.customerEmail);
      if (request.customerName) {
        const parts = request.customerName.split(' ');
        params.set('first_name', parts[0] || '');
        if (parts.length > 1) params.set('last_name', parts.slice(1).join(' '));
      }
    }

    this.addProcessorId(params);
    this.addMetadata(params, request);

    const nmi = await this.postTransact(params);
    const result = this.toChargeResult(nmi);

    // If vault succeeded, populate vault metadata on the result
    if (result.success && nmi.customer_vault_id) {
      result.vaultedCustomerId = nmi.customer_vault_id;
      console.log('[NMI] Vault created, ID:', nmi.customer_vault_id, 'Transact response keys:', Object.keys(nmi).join(','));
      try {
        const cardInfo = await this.queryVaultCard(nmi.customer_vault_id);
        result.vaultedCardLastFour = cardInfo.lastFour;
        result.vaultedCardBrand = cardInfo.brand;
        result.vaultedCardExpMonth = cardInfo.expMonth;
        result.vaultedCardExpYear = cardInfo.expYear;
        console.log('[NMI] Card metadata from vault query:', { last4: cardInfo.lastFour, brand: cardInfo.brand, expMonth: cardInfo.expMonth, expYear: cardInfo.expYear });
      } catch (vaultErr: any) {
        // Vault query failed — try extracting from the charge response directly
        console.warn('[NMI] Vault card query FAILED:', vaultErr.message, '— trying transact response fallback');
        console.log('[NMI] Transact response cc fields:', { cc_number: nmi.cc_number, cc_type: nmi.cc_type, cc_exp: nmi.cc_exp });
        const maskedCC = nmi.cc_number || '';
        if (maskedCC.length >= 4) {
          result.vaultedCardLastFour = maskedCC.slice(-4);
        } else {
          result.vaultedCardLastFour = '****';
        }
        result.vaultedCardBrand = nmi.cc_type || 'unknown';
        const expStr = nmi.cc_exp || '';
        if (expStr.length === 4) {
          result.vaultedCardExpMonth = parseInt(expStr.substring(0, 2)) || 0;
          result.vaultedCardExpYear = 2000 + (parseInt(expStr.substring(2, 4)) || 0);
        } else {
          result.vaultedCardExpMonth = 0;
          result.vaultedCardExpYear = 0;
        }
      }
    }

    return result;
  }

  // ─── refund ────────────────────────────────────────────────

  async refund(request: RefundRequest): Promise<RefundResult> {
    const params = new URLSearchParams();
    params.set('security_key', this.securityKey);
    params.set('type', 'refund');
    params.set('transactionid', request.transactionId);

    if (request.amount !== undefined) {
      params.set('amount', centsToDollars(request.amount));
    }

    const nmi = await this.postTransact(params);

    return {
      success: nmi.response === '1',
      refundId: nmi.transactionid || '',
      amount: request.amount ?? 0,
      status: nmi.response === '1' ? 'refunded' : 'failed',
      errorMessage: nmi.response !== '1' ? nmi.responsetext : undefined,
    };
  }

  // ─── saveCard ──────────────────────────────────────────────

  async saveCard(request: SaveCardRequest): Promise<SaveCardResult> {
    const params = new URLSearchParams();
    params.set('security_key', this.securityKey);
    params.set('customer_vault', 'add_customer');
    params.set('payment_token', request.paymentToken);
    params.set('email', request.customerEmail);

    if (request.customerName) {
      const [first, ...rest] = request.customerName.split(' ');
      params.set('first_name', first);
      if (rest.length) params.set('last_name', rest.join(' '));
    }

    const nmi = await this.postTransact(params);

    if (nmi.response !== '1' || !nmi.customer_vault_id) {
      throw new ProcessorError(
        `Failed to save card: ${nmi.responsetext || 'Unknown error'}`,
        'nmi',
        nmi.response_code,
      );
    }

    const vaultId = nmi.customer_vault_id;

    // NMI doesn't return card details on vault add — query for them
    const cardInfo = await this.queryVaultCard(vaultId);

    return {
      success: true,
      paymentMethodId: vaultId,
      customerId: vaultId,
      cardLastFour: cardInfo.lastFour,
      cardBrand: cardInfo.brand,
      cardExpMonth: cardInfo.expMonth,
      cardExpYear: cardInfo.expYear,
    };
  }

  // ─── listCards ─────────────────────────────────────────────

  async listCards(customerId: string): Promise<StoredCard[]> {
    const params = new URLSearchParams();
    params.set('security_key', this.securityKey);
    params.set('customer_vault_id', customerId);

    const xml = await this.postQuery(params);
    const records = parseNmiVaultRecords(xml);

    return records.map((r, idx) => {
      const exp = parseNmiExpiry(r.ccExp);
      return {
        paymentMethodId: r.customerVaultId,
        customerId: r.customerVaultId,
        cardLastFour: extractLastFour(r.ccNumber),
        cardBrand: r.ccType.toLowerCase(),
        cardExpMonth: exp.month,
        cardExpYear: exp.year,
        isDefault: idx === 0,
      };
    });
  }

  // ─── chargeStoredCard ──────────────────────────────────────

  async chargeStoredCard(
    customerId: string,
    _paymentMethodId: string,
    request: ChargeRequest,
  ): Promise<ChargeResult> {
    const params = new URLSearchParams();
    params.set('security_key', this.securityKey);
    params.set('type', 'sale');
    params.set('amount', centsToDollars(request.amount));
    params.set('currency', (request.currency || 'USD').toUpperCase());
    params.set('customer_vault_id', customerId);

    this.addProcessorId(params);
    this.addMetadata(params, request);

    const nmi = await this.postTransact(params);
    return this.toChargeResult(nmi);
  }

  // ─── createSubscription ────────────────────────────────────

  async createSubscription(request: CreateSubscriptionRequest): Promise<SubscriptionResult> {
    const params = new URLSearchParams();
    params.set('security_key', this.securityKey);
    params.set('recurring', 'add_subscription');
    params.set('plan_payments', String(request.totalPayments));
    params.set('plan_amount', centsToDollars(request.planAmount));
    params.set('customer_vault_id', request.paymentMethodId);

    // Interval mapping
    switch (request.interval) {
      case 'weekly':
        params.set('day_frequency', '7');
        break;
      case 'biweekly':
        params.set('day_frequency', '14');
        break;
      case 'monthly':
        params.set('month_frequency', '1');
        break;
      case 'quarterly':
        params.set('month_frequency', '3');
        break;
      case 'annual':
        params.set('month_frequency', '12');
        break;
    }

    // Start date
    const startDate = request.startDate
      ? new Date(request.startDate)
      : new Date();
    params.set('start_date', formatNmiDate(startDate));

    if (request.description) {
      params.set('order_description', request.description);
    }

    this.addProcessorId(params);

    const nmi = await this.postTransact(params);

    if (nmi.response !== '1') {
      return {
        success: false,
        subscriptionId: '',
        status: 'failed',
        errorMessage: nmi.responsetext || 'Subscription creation failed',
      };
    }

    return {
      success: true,
      subscriptionId: nmi.subscription_id || '',
      status: 'active',
    };
  }

  // ─── cancelSubscription ────────────────────────────────────

  async cancelSubscription(subscriptionId: string): Promise<{ success: boolean; errorMessage?: string }> {
    const params = new URLSearchParams();
    params.set('security_key', this.securityKey);
    params.set('recurring', 'delete_subscription');
    params.set('subscription_id', subscriptionId);

    const nmi = await this.postTransact(params);

    return {
      success: nmi.response === '1',
      errorMessage: nmi.response !== '1' ? nmi.responsetext : undefined,
    };
  }

  // ─── pauseSubscription ──────────────────────────────────────
  // NMI has no pause concept — delete the subscription. resumeSubscription creates a new one.

  async pauseSubscription(subscriptionId: string): Promise<{ success: boolean; errorMessage?: string }> {
    return this.cancelSubscription(subscriptionId);
  }

  // ─── resumeSubscription ────────────────────────────────────
  // NMI has no resume — create a brand new subscription with remaining payments.

  async resumeSubscription(request: ResumeSubscriptionRequest): Promise<SubscriptionResult> {
    return this.createSubscription({
      paymentMethodId: request.paymentMethodId,
      customerId: request.customerId,
      planAmount: request.planAmount,
      interval: request.interval,
      totalPayments: request.remainingPayments,
      startDate: request.startDate,
      description: request.description,
    });
  }

  // ─── verifyTransaction ─────────────────────────────────────

  async verifyTransaction(transactionId: string): Promise<VerifyResult> {
    const params = new URLSearchParams();
    params.set('security_key', this.securityKey);
    params.set('transaction_id', transactionId);

    const xml = await this.postQuery(params);
    const transactions = parseNmiQueryTransactions(xml);

    if (transactions.length === 0) {
      return {
        success: false,
        transactionId,
        status: 'failed',
        amount: 0,
      };
    }

    const tx = transactions[0];
    const statusMap: Record<string, VerifyResult['status']> = {
      complete: 'settled',
      pendingsettlement: 'pending',
      pending: 'pending',
      failed: 'failed',
      canceled: 'voided',
    };

    return {
      success: true,
      transactionId: tx.transactionId,
      status: statusMap[tx.condition] || 'pending',
      amount: Math.round(parseFloat(tx.amount) * 100), // dollars → cents
      settledAt: tx.condition === 'complete' ? tx.date : undefined,
    };
  }

  // ─── testConnection ────────────────────────────────────────

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      // Validate the key by querying for recent transactions (limit 1)
      const params = new URLSearchParams();
      params.set('security_key', this.securityKey);
      params.set('result_limit', '1');

      const xml = await this.postQuery(params);

      // If we get a valid XML response, the key works
      if (xml.includes('nm_response')) {
        return { success: true, message: 'NMI connection verified' };
      }

      return { success: false, message: 'Unexpected response from NMI' };
    } catch (err: any) {
      return {
        success: false,
        message: err instanceof ProcessorError ? err.message : 'Connection failed',
      };
    }
  }

  // ─── Private helpers ───────────────────────────────────────

  private addProcessorId(params: URLSearchParams): void {
    if (this.processorId) {
      params.set('processor_id', this.processorId);
    }
  }

  private addMetadata(params: URLSearchParams, request: ChargeRequest): void {
    if (request.description) {
      params.set('order_description', request.description);
    }
    if (request.metadata) {
      const m = request.metadata;
      if (m.first_name) params.set('first_name', m.first_name);
      if (m.last_name) params.set('last_name', m.last_name);
      if (m.email) params.set('email', m.email);
      if (m.ip_address) params.set('ip_address', m.ip_address);
    }
    if (request.statementDescriptorSuffix) {
      params.set('order_description',
        request.statementDescriptorSuffix.substring(0, 22));
    }
  }

  private async postTransact(params: URLSearchParams): Promise<Record<string, string>> {
    try {
      const response = await axios.post(this.transactUrl, params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 30000,
      });

      return parseNmiResponse(response.data);
    } catch (err: any) {
      logger.error({ err: err.message }, 'NMI transact API call failed');
      throw new ProcessorError(
        'NMI API request failed',
        'nmi',
        'NETWORK_ERROR',
        true, // retryable
        err,
      );
    }
  }

  private async postQuery(params: URLSearchParams): Promise<string> {
    try {
      const response = await axios.post(this.queryUrl, params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 30000,
      });

      return response.data;
    } catch (err: any) {
      logger.error({ err: err.message }, 'NMI query API call failed');
      throw new ProcessorError(
        'NMI Query API request failed',
        'nmi',
        'NETWORK_ERROR',
        true,
        err,
      );
    }
  }

  private toChargeResult(nmi: Record<string, string>): ChargeResult {
    const approved = nmi.response === '1';

    return {
      success: approved,
      transactionId: nmi.transactionid || '',
      amount: 0, // caller knows the amount
      currency: 'usd',
      status: approved ? 'approved' : (nmi.response === '2' ? 'declined' : 'error'),
      errorMessage: !approved ? nmi.responsetext : undefined,
      errorCode: !approved ? nmi.response_code : undefined,
      avsResponse: nmi.avsresponse,
      cvvResponse: nmi.cvvresponse,
      rawResponse: nmi,
    };
  }

  /**
   * Query the vault to get card display info after a vault add.
   */
  private async queryVaultCard(vaultId: string): Promise<{
    lastFour: string;
    brand: string;
    expMonth: number;
    expYear: number;
  }> {
    try {
      const params = new URLSearchParams();
      params.set('security_key', this.securityKey);
      params.set('customer_vault_id', vaultId);

      const xml = await this.postQuery(params);
      console.log('[NMI] Vault query XML length:', xml.length, 'first 200 chars:', xml.substring(0, 200));
      const records = parseNmiVaultRecords(xml);
      console.log('[NMI] Parsed vault records:', records.length, records.length > 0 ? { ccNumber: records[0].ccNumber, ccType: records[0].ccType, ccExp: records[0].ccExp } : 'none');

      if (records.length > 0) {
        const r = records[0];
        const exp = parseNmiExpiry(r.ccExp);
        return {
          lastFour: extractLastFour(r.ccNumber),
          brand: r.ccType.toLowerCase(),
          expMonth: exp.month,
          expYear: exp.year,
        };
      }
    } catch (err) {
      logger.warn({ vaultId }, 'Failed to query vault card details after add');
    }

    // Fallback if query fails — return unknowns
    return { lastFour: '****', brand: 'unknown', expMonth: 0, expYear: 0 };
  }
}
