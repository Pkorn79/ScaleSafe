import {
  ChargeRequest, ChargeResult,
  RefundRequest, RefundResult,
  SaveCardRequest, SaveCardResult, StoredCard,
  CreateSubscriptionRequest, SubscriptionResult,
  VerifyResult,
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

  cancelSubscription(subscriptionId: string): Promise<{ success: boolean; errorMessage?: string }>;

  verifyTransaction(transactionId: string): Promise<VerifyResult>;

  testConnection(): Promise<{ success: boolean; message: string }>;
}
