import axios from 'axios';
import { ProcessorInterface } from '../interfaces/processor.interface';
import {
  ChargeRequest, ChargeResult,
  RefundRequest, RefundResult,
  SaveCardRequest, SaveCardResult, StoredCard,
  CreateSubscriptionRequest, ResumeSubscriptionRequest, SubscriptionResult,
  VerifyResult, SubscriptionTransaction,
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
import { config as appConfig } from '../config';

function formatNmiQueryDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value.replace(/[^0-9]/g, '').slice(0, 14);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}${hh}${min}${ss}`;
}

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
    const paymentMethodType = request.paymentMethodType === 'ach' ? 'ach' : 'card';
    const params = new URLSearchParams();
    params.set('security_key', this.securityKey);
    params.set('type', 'sale');
    params.set('amount', centsToDollars(request.amount));
    params.set('currency', (request.currency || 'USD').toUpperCase());
    params.set('payment_token', request.paymentToken);
    if (paymentMethodType === 'ach') {
      params.set('payment', 'check');
      params.set('sec_code', request.achSecCode || 'WEB');
      params.set('account_holder_type', request.achAccountHolderType || 'personal');
      params.set('account_type', request.achAccountType || 'checking');
    }

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
    if (paymentMethodType === 'ach' && result.success) {
      result.status = 'processing';
    }

    // If vault succeeded, populate vault metadata on the result
    result.amount = request.amount;
    result.currency = (request.currency || 'usd').toLowerCase();

    if (result.success && nmi.customer_vault_id) {
      result.vaultedCustomerId = nmi.customer_vault_id;
      logger.debug({ responseKeys: Object.keys(nmi) }, 'NMI vault created');
      if (paymentMethodType === 'ach') {
        result.vaultedBankLastFour = this.extractBankLastFour(nmi);
        result.vaultedBankAccountType = request.achAccountType || nmi.account_type || 'checking';
        result.vaultedBankHolderType = request.achAccountHolderType || nmi.account_holder_type || 'personal';
        return result;
      }
      try {
        const cardInfo = await this.queryVaultCard(nmi.customer_vault_id);
        result.vaultedCardLastFour = cardInfo.lastFour;
        result.vaultedCardBrand = cardInfo.brand;
        result.vaultedCardExpMonth = cardInfo.expMonth;
        result.vaultedCardExpYear = cardInfo.expYear;
        logger.debug('NMI vault card metadata resolved');
      } catch (vaultErr: any) {
        // Vault query failed — try extracting from the charge response directly
        logger.warn({ err: vaultErr?.message }, 'NMI vault card query failed; using transact response fallback');
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
    const paymentMethodType = request.paymentMethodType === 'ach' ? 'ach' : 'card';
    const params = new URLSearchParams();
    params.set('security_key', this.securityKey);
    params.set('customer_vault', 'add_customer');
    params.set('payment_token', request.paymentToken);
    params.set('email', request.customerEmail);
    if (paymentMethodType === 'ach') {
      params.set('payment', 'check');
      params.set('sec_code', request.achSecCode || 'WEB');
      params.set('account_holder_type', request.achAccountHolderType || 'personal');
      params.set('account_type', request.achAccountType || 'checking');
    }

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

    if (paymentMethodType === 'ach') {
      return {
        success: true,
        paymentMethodId: vaultId,
        customerId: vaultId,
        cardLastFour: '',
        cardBrand: 'bank',
        cardExpMonth: 0,
        cardExpYear: 0,
        paymentMethodKind: 'ach',
        bankLastFour: this.extractBankLastFour(nmi),
        bankAccountType: request.achAccountType || nmi.account_type || 'checking',
        bankHolderType: request.achAccountHolderType || nmi.account_holder_type || 'personal',
      };
    }

    // Query the vault for canonical display data, but seed from the transact
    // response so NMI test-mode cards can still show real details if the query
    // endpoint is unavailable or returns an unexpected XML shape.
    let cardInfo = this.extractCardInfoFromTransactResponse(nmi);
    try {
      cardInfo = await this.queryVaultCard(vaultId);
    } catch (vaultErr: any) {
      logger.warn({ vaultId, err: vaultErr.message }, 'saveCard: vault query failed — returning placeholder card metadata');
    }

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
    if (request.totalPayments > 0) {
      params.set('plan_payments', String(request.totalPayments));
    }
    params.set('plan_amount', centsToDollars(request.planAmount));
    params.set('customer_vault_id', request.paymentMethodId);

    // Interval mapping
    switch (request.interval) {
      case 'daily':
        params.set('day_frequency', '1');
        break;
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

    if (request.metadata) {
      const m = request.metadata;
      if (m.enrollment_id) {
        params.set('order_id', m.enrollment_id);
        params.set('merchant_defined_field_1', m.enrollment_id);
      }
      if (m.contact_id) params.set('merchant_defined_field_2', m.contact_id);
      if (m.offer_id) params.set('merchant_defined_field_3', m.offer_id);
      if (m.location_id) params.set('merchant_defined_field_4', m.location_id);
      if (m.payment_type) params.set('merchant_defined_field_5', m.payment_type);
    }

    // Per-subscription Silent Post target.
    // NMI's gateway-level Silent Post URL covers direct transactions only — it does NOT
    // dispatch for transactions generated by the recurring engine. Without redirect_url,
    // the recurring charge succeeds on NMI's side but the app never hears about it,
    // leaving payments_made / next_billing_date stuck at the values from upfront enrollment.
    // Setting redirect_url here makes NMI POST per-subscription cycle notifications to
    // /webhooks/nmi/silent-post the same way gateway-level Silent Post does for direct charges.
    params.set('redirect_url', `${appConfig.appUrl}/webhooks/nmi/silent-post`);

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

    const subscriptionId = nmi.subscription_id
      || nmi.subscriptionid
      || nmi.subscriptionId
      || nmi.recurring_subscription_id
      || nmi.recurringsubscriptionid
      || '';

    if (!subscriptionId) {
      return {
        success: false,
        subscriptionId: '',
        status: 'failed',
        errorMessage: `NMI approved recurring setup but did not return a subscription ID. Response: ${nmi.responsetext || 'Unknown response'}`,
      };
    }

    return {
      success: true,
      subscriptionId,
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
      ...(tx.source ? { source: tx.source } : {}),
      ...(tx.subscriptionId ? { subscriptionId: tx.subscriptionId } : {}),
      ...(tx.orderId ? { orderId: tx.orderId } : {}),
      ...(tx.customerVaultId ? { customerVaultId: tx.customerVaultId } : {}),
      ...(tx.processorId ? { processorId: tx.processorId } : {}),
      ...(tx.responseCode ? { responseCode: tx.responseCode } : {}),
      ...(tx.responseText ? { responseText: tx.responseText } : {}),
      ...(tx.processorResponseCode ? { processorResponseCode: tx.processorResponseCode } : {}),
      ...(tx.processorResponseDescription ? { processorResponseDescription: tx.processorResponseDescription } : {}),
      ...(tx.processorResponseText ? { processorResponseText: tx.processorResponseText } : {}),
      ...(String(tx.recurring || '').toLowerCase() === '1'
        || String(tx.recurring || '').toLowerCase() === 'true'
        ? { recurring: true }
        : {}),
      ...(tx.currency ? { currency: tx.currency } : {}),
      ...(tx.ipAddress ? { ipAddress: tx.ipAddress } : {}),
      ...(tx.originalTransactionId ? { originalTransactionId: tx.originalTransactionId } : {}),
      ...(tx.merchantDefinedFields && Object.keys(tx.merchantDefinedFields).length ? { merchantDefinedFields: tx.merchantDefinedFields } : {}),
    };
  }

  async listSubscriptionTransactions(
    subscriptionId: string,
    opts: { startDate?: string; endDate?: string; limit?: number } = {},
  ): Promise<SubscriptionTransaction[]> {
    const params = new URLSearchParams();
    params.set('security_key', this.securityKey);
    params.set('subscription_id', subscriptionId);
    params.set('source', 'recurring');
    params.set('result_limit', String(Math.min(100, Math.max(1, opts.limit || 50))));
    if (opts.startDate) params.set('start_date', formatNmiQueryDate(opts.startDate));
    if (opts.endDate) params.set('end_date', formatNmiQueryDate(opts.endDate));

    const xml = await this.postQuery(params);
    return parseNmiQueryTransactions(xml)
      .filter(tx => tx.transactionId)
      .map((tx): SubscriptionTransaction => {
        const status = this.mapNmiCondition(tx.condition);
        return {
          transactionId: tx.transactionId,
          status,
          amount: Math.round(parseFloat(tx.amount || '0') * 100),
          occurredAt: tx.date || undefined,
          responseText: tx.responseText || undefined,
          success: tx.success === null ? ['settled', 'pending'].includes(status) : tx.success,
          source: tx.source,
          ...(tx.subscriptionId ? { subscriptionId: tx.subscriptionId } : {}),
          ...(tx.orderId ? { orderId: tx.orderId } : {}),
          ...(tx.customerVaultId ? { customerVaultId: tx.customerVaultId } : {}),
          ...(tx.processorId ? { processorId: tx.processorId } : {}),
          ...(tx.responseCode ? { responseCode: tx.responseCode } : {}),
          ...(tx.processorResponseCode ? { processorResponseCode: tx.processorResponseCode } : {}),
          ...(tx.processorResponseDescription ? { processorResponseDescription: tx.processorResponseDescription } : {}),
          ...(tx.processorResponseText ? { processorResponseText: tx.processorResponseText } : {}),
          ...(String(tx.recurring || '').toLowerCase() === '1'
            || String(tx.recurring || '').toLowerCase() === 'true'
            ? { recurring: true }
            : {}),
          ...(tx.currency ? { currency: tx.currency } : {}),
          ...(tx.ipAddress ? { ipAddress: tx.ipAddress } : {}),
          ...(tx.originalTransactionId ? { originalTransactionId: tx.originalTransactionId } : {}),
          ...(tx.merchantDefinedFields && Object.keys(tx.merchantDefinedFields).length ? { merchantDefinedFields: tx.merchantDefinedFields } : {}),
        };
      });
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

  private mapNmiCondition(condition: string): VerifyResult['status'] {
    const statusMap: Record<string, VerifyResult['status']> = {
      complete: 'settled',
      pendingsettlement: 'pending',
      pending: 'pending',
      failed: 'failed',
      canceled: 'voided',
    };
    return statusMap[String(condition || '').toLowerCase()] || 'pending';
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
    const isAch = String(nmi.payment || nmi.payment_type || '').toLowerCase() === 'check'
      || Boolean(nmi.check_hash || nmi.check_account || nmi.account_type || nmi.sec_code);

    return {
      success: approved,
      transactionId: nmi.transactionid || '',
      amount: 0, // caller knows the amount
      currency: 'usd',
      status: approved ? (isAch ? 'processing' : 'approved') : (nmi.response === '2' ? 'declined' : 'error'),
      errorMessage: !approved ? nmi.responsetext : undefined,
      errorCode: !approved ? nmi.response_code : undefined,
      avsResponse: nmi.avsresponse,
      cvvResponse: nmi.cvvresponse,
      rawResponse: nmi,
    };
  }

  private extractCardInfoFromTransactResponse(nmi: Record<string, string>): {
    lastFour: string;
    brand: string;
    expMonth: number;
    expYear: number;
  } {
    const exp = nmi.cc_exp ? parseNmiExpiry(nmi.cc_exp) : { month: 0, year: 0 };
    return {
      lastFour: extractLastFour(nmi.cc_number || ''),
      brand: (nmi.cc_type || 'unknown').toLowerCase(),
      expMonth: exp.month,
      expYear: exp.year,
    };
  }

  private extractBankLastFour(nmi: Record<string, string>): string {
    const raw = nmi.check_account || nmi.account_number || nmi.checkaccount || '';
    const digits = raw.replace(/\D/g, '');
    if (digits.length >= 4) return digits.slice(-4);
    const hash = nmi.check_hash || nmi.checkhash || '';
    return hash ? 'bank' : '';
  }

  /**
   * Query the vault to get card display info after a vault add.
   * Throws when the query fails OR when the parser returns zero records —
   * callers that have a secondary fallback (e.g. charge()'s transact-response
   * fields) can catch and use that. Callers without one (saveCard) should
   * catch and substitute placeholder values themselves.
   */
  private async queryVaultCard(vaultId: string): Promise<{
    lastFour: string;
    brand: string;
    expMonth: number;
    expYear: number;
  }> {
    const params = new URLSearchParams();
    params.set('security_key', this.securityKey);
    params.set('customer_vault_id', vaultId);

    const xml = await this.postQuery(params);
    logger.info({ vaultId, xmlLen: xml.length, xmlPreview: xml.substring(0, 200) }, '[NMI] Vault query response');
    const records = parseNmiVaultRecords(xml);

    if (records.length === 0) {
      logger.warn({ vaultId, xmlPreview: xml.substring(0, 400) }, '[NMI] Vault query parsed zero records — XML structure may not match expected <customer_vault><customer><billing>');
      throw new ProcessorError(
        'NMI vault query returned no records',
        'nmi',
        'VAULT_EMPTY',
        false,
      );
    }

    const r = records[0];
    const exp = parseNmiExpiry(r.ccExp);
    logger.info({ vaultId, ccType: r.ccType, ccExp: r.ccExp, ccNumber: r.ccNumber }, '[NMI] Vault card metadata extracted');
    return {
      lastFour: extractLastFour(r.ccNumber),
      brand: r.ccType.toLowerCase(),
      expMonth: exp.month,
      expYear: exp.year,
    };
  }
}
