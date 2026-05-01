export type ProcessorType = 'nmi' | 'stripe';

// ============================================================
// Charge
// ============================================================
export interface ChargeRequest {
  amount: number; // in cents
  currency: string;
  paymentToken: string; // NMI payment_token from Collect.js OR Stripe PaymentMethod ID
  customerId?: string;
  description?: string;
  metadata?: Record<string, string>;
  statementDescriptorSuffix?: string;
  requestThreeDSecure?: boolean; // Stripe only
  processorId?: string; // NMI multi-MID routing
  shouldVault?: boolean; // When true, vault card during charge (NMI atomic sale+vault)
  customerEmail?: string; // Required when shouldVault=true
  customerName?: string; // Optional, for vault customer record
}

export interface ChargeResult {
  success: boolean;
  transactionId: string;
  chargeId?: string; // Stripe charge ID
  amount: number;
  currency: string;
  status: 'approved' | 'declined' | 'error' | 'pending_3ds';
  errorMessage?: string;
  errorCode?: string;
  avsResponse?: string;
  cvvResponse?: string;
  threeDSecureUrl?: string;
  rawResponse?: Record<string, any>;
  // Populated when shouldVault=true and vault succeeded (NMI customer_vault_id)
  vaultedCustomerId?: string;
  vaultedCardLastFour?: string;
  vaultedCardBrand?: string;
  vaultedCardExpMonth?: number;
  vaultedCardExpYear?: number;
}

// ============================================================
// Refund
// ============================================================
export interface RefundRequest {
  transactionId: string;
  amount?: number; // partial refund in cents; omit for full
  reason?: string;
}

export interface RefundResult {
  success: boolean;
  refundId: string;
  amount: number;
  status: 'refunded' | 'pending' | 'failed';
  errorMessage?: string;
}

// ============================================================
// Saved Cards
// ============================================================
export interface SaveCardRequest {
  paymentToken: string;
  contactId: string;
  customerEmail: string;
  customerName?: string;
}

export interface SaveCardResult {
  success: boolean;
  paymentMethodId: string;
  customerId: string;
  cardLastFour: string;
  cardBrand: string;
  cardExpMonth: number;
  cardExpYear: number;
}

export interface StoredCard {
  paymentMethodId: string;
  customerId: string;
  cardLastFour: string;
  cardBrand: string;
  cardExpMonth: number;
  cardExpYear: number;
  isDefault: boolean;
}

// ============================================================
// Subscriptions
// ============================================================
export interface CreateSubscriptionRequest {
  paymentMethodId: string;
  customerId: string;
  planAmount: number; // in cents
  interval: 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'annual';
  totalPayments: number;
  startDate?: string; // ISO date
  description?: string;
  metadata?: Record<string, string>;
}

export interface ResumeSubscriptionRequest {
  subscriptionId: string;        // existing processor subscription ID (Stripe only; NMI creates new)
  paymentMethodId: string;       // NMI vault ID or Stripe payment method ID
  customerId: string;            // NMI vault ID or Stripe customer ID
  planAmount: number;            // in cents
  interval: 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'annual';
  remainingPayments: number;     // how many payments left
  startDate?: string;            // ISO date for next charge
  description?: string;
}

export interface SubscriptionResult {
  success: boolean;
  subscriptionId: string;
  status: 'active' | 'pending' | 'failed';
  nextPaymentDate?: string;
  errorMessage?: string;
}

// ============================================================
// Verify
// ============================================================
export interface VerifyResult {
  success: boolean;
  transactionId: string;
  status: 'settled' | 'pending' | 'failed' | 'voided' | 'refunded';
  amount: number;
  settledAt?: string;
}

// ============================================================
// Processor Config (DB row shape)
// ============================================================
export interface ProcessorConfig {
  id: string;
  merchant_id: string;
  location_id: string;
  processor_type: ProcessorType;
  label: string | null;

  // NMI
  nmi_security_key_encrypted: string | null;
  nmi_tokenization_key: string | null;
  nmi_processor_id: string | null;

  // Stripe Connect
  stripe_user_id: string | null;
  stripe_access_token_encrypted: string | null;
  stripe_refresh_token_encrypted: string | null;
  stripe_publishable_key: string | null;
  stripe_token_expires_at: string | null;
  stripe_webhook_endpoint_id: string | null;

  is_active: boolean;
  is_default: boolean;
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
}
