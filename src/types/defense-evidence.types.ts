import { EvidenceType } from '../constants/evidence-types';

export type DefenseProofRole =
  | 'authorization'
  | 'customer_identity'
  | 'terms_acceptance'
  | 'payment_history'
  | 'prior_undisputed_transaction'
  | 'service_delivery'
  | 'service_access'
  | 'client_engagement'
  | 'communication'
  | 'cancellation'
  | 'refund'
  | 'billing_update'
  | 'dunning'
  | 'policy_disclosure'
  | 'merchant_action'
  | 'system_event'
  | 'other';

export type DefenseReasonCodeTag =
  | 'authorization'
  | 'fraud'
  | 'services_not_provided'
  | 'not_as_described'
  | 'credit_not_processed'
  | 'cancelled_recurring'
  | 'duplicate_processing'
  | 'unrecognized'
  | 'general';

export interface DefenseDisputeRelevance {
  tags?: DefenseReasonCodeTag[];
  networks?: Array<'visa' | 'mastercard' | 'amex' | 'discover' | 'stripe' | 'nmi' | 'other'>;
  reasonCodes?: string[];
  priority?: 'critical' | 'high' | 'medium' | 'low';
  confidence?: 'strong' | 'moderate' | 'weak';
}

export interface DefenseEvidenceMetadata {
  actor?: 'client' | 'merchant' | 'processor' | 'system' | 'third_party' | 'unknown';
  customerIdentity?: {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    ipAddress?: string | null;
    deviceFingerprint?: string | null;
    browser?: string | null;
  };
  service?: {
    enrollmentId?: string | null;
    offerId?: string | null;
    offerName?: string | null;
    deliverableName?: string | null;
    serviceDate?: string | null;
    accessConfirmed?: boolean;
  };
  transaction?: {
    paymentEventId?: string | null;
    processor?: string | null;
    transactionId?: string | null;
    subscriptionId?: string | null;
    amount?: number | string | null;
    currency?: string | null;
    cardBrand?: string | null;
    cardLastFour?: string | null;
    paymentSequence?: string | number | null;
  };
  policy?: {
    policyType?: 'refund' | 'cancellation' | 'recurring_billing' | 'terms' | 'other';
    policyVersion?: string | null;
    policyHash?: string | null;
    policyTextExcerpt?: string | null;
    acceptedAt?: string | null;
  };
  communication?: {
    channel?: string | null;
    sourceChannel?: string | null;
    direction?: 'inbound' | 'outbound' | 'note' | null;
    purpose?: string | null;
    nature?: string | null;
    natureLabel?: string | null;
    excerpt?: string | null;
    ghlConversationId?: string | null;
    ghlMessageId?: string | null;
  };
  source?: {
    system?: string | null;
    recordId?: string | null;
    rawEventType?: string | null;
  };
  [key: string]: unknown;
}

export interface DefenseEvidenceFields {
  enrollment_id?: string | null;
  payment_event_id?: string | null;
  defense_summary?: string | null;
  issuer_exhibit_title?: string | null;
  proof_role?: DefenseProofRole | null;
  reason_code_tags?: DefenseReasonCodeTag[] | null;
  dispute_relevance?: DefenseDisputeRelevance | null;
  source_record_id?: string | null;
  actor?: DefenseEvidenceMetadata['actor'] | string | null;
  defense_metadata?: DefenseEvidenceMetadata | null;
}

export interface DefenseEvidenceRecord extends DefenseEvidenceFields {
  id?: string;
  location_id: string;
  contact_id: string;
  evidence_type?: EvidenceType | string;
  source?: string | null;
  created_at?: string;
}
