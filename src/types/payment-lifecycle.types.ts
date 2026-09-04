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
  // False only when the tenant-scoped enrollment proves there is no future
  // processor billing to stop (for example, a completed finite payment plan).
  processorCancellationRequired?: boolean;
}

export interface CardManagementParams {
  merchantId: string;
  locationId: string;
  contactId: string;
}
