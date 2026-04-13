import { ProcessorType } from './processor.types';

export type SubscriptionAction = 'pause' | 'resume' | 'cancel';

export interface DunningParams {
  merchantId: string;
  locationId: string;
  contactId: string;
  offerId: string;
  paymentEventId: string;
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
  processorSubscriptionId?: string;
}

export interface CardManagementParams {
  merchantId: string;
  locationId: string;
  contactId: string;
}
