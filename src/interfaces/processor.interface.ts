import {
  ChargeRequest, ChargeResult,
  RefundRequest, RefundResult,
  SaveCardRequest, SaveCardResult, StoredCard,
  CreateSubscriptionRequest, ResumeSubscriptionRequest, SubscriptionResult,
  VerifyResult, SubscriptionTransaction,
} from '../types/processor.types';

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

  cancelSubscription(subscriptionId: string): Promise<{ success: boolean; errorMessage?: string; notFound?: boolean }>;

  verifyTransaction(transactionId: string): Promise<VerifyResult>;

  listSubscriptionTransactions?(
    subscriptionId: string,
    opts?: { startDate?: string; endDate?: string; limit?: number },
  ): Promise<SubscriptionTransaction[]>;

  testConnection(): Promise<{ success: boolean; message: string }>;
}
