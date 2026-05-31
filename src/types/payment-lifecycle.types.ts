import { ProcessorType } from './processor.types';

export type SubscriptionAction = 'pause' | 'resume' | 'cancel';

export interface DunningParams {
  merchantId: string;
  locationId: string;
  contactId: string;
  offerId: string;
  // Null when the failed-payment ledger insert failed (#6): dunning comms still fire, but the
  // saved-card auto-retry cannot be scheduled without an event row.
  paymentEventId: string | null;
  failureReason: string;
  failureCode?: string;
  amountCents: number;
  attemptCount: number;
}

export interface SubscriptionParams {
  merchantId: string;
  locationId: string;
  contactId: string;
  offerId: string;
  reason: string;
  enrollmentId?: string;
  processorSubscriptionId?: string;
  processorType?: ProcessorType;
}

export interface CardManagementParams {
  merchantId: string;
  locationId: string;
  contactId: string;
}
