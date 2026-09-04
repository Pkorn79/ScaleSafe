import {
  ChargeRequest, ChargeResult,
  RefundRequest, RefundResult,
  SaveCardRequest, SaveCardResult, StoredCard,
  CreateSubscriptionRequest, ResumeSubscriptionRequest, SubscriptionResult,
  VerifyResult, SubscriptionTransaction,
} from '../types/processor.types';

export interface InvoicePaymentResult {
  success: boolean;
  outcome: 'succeeded' | 'failed' | 'unknown';
  transactionId?: string;
  invoicePaymentId?: string | null;
  errorMessage?: string;
  errorCode?: string;
}

/**
 * ProcessorInterface — implemented by both NMI and Stripe clients.
 * All amounts are in CENTS (integer). Convert to dollars only at display layer.
 * All methods are async. All throw ProcessorError on unrecoverable failure.
 */
export interface ProcessorInterface {
  readonly processorType: 'nmi' | 'stripe';

  charge(request: ChargeRequest): Promise<ChargeResult>;

  refund(request: RefundRequest): Promise<RefundResult>;

  saveCard(request: SaveCardRequest): Promise<SaveCardResult>;

  listCards(customerId: string): Promise<StoredCard[]>;

  chargeStoredCard(
    customerId: string,
    paymentMethodId: string,
    request: ChargeRequest,
  ): Promise<ChargeResult>;

  createSubscription(request: CreateSubscriptionRequest): Promise<SubscriptionResult>;

  pauseSubscription(subscriptionId: string): Promise<{ success: boolean; errorMessage?: string }>;

  resumeSubscription(request: ResumeSubscriptionRequest): Promise<SubscriptionResult>;

  cancelSubscription(subscriptionId: string): Promise<{ success: boolean; errorMessage?: string }>;

  /**
   * Stripe only: settle an open subscription invoice with a saved payment
   * method. Dunning retries for invoice-originated failures must pay the
   * invoice itself so the processor's own retry schedule stops.
   */
  payInvoice?(invoiceId: string, opts: {
    idempotencyKey: string;
    stripeAccountId: string;
    paymentMethodId?: string;
  }): Promise<InvoicePaymentResult>;

  verifyTransaction(transactionId: string): Promise<VerifyResult>;

  listSubscriptionTransactions?(
    subscriptionId: string,
    opts?: { startDate?: string; endDate?: string; limit?: number },
  ): Promise<SubscriptionTransaction[]>;

  testConnection(): Promise<{ success: boolean; message: string }>;
}
