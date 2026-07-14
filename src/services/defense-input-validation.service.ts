import { getSupabase } from '../clients/supabase.client';
import { ghlApi } from '../clients/ghl.client';
import { ValidationError } from '../utils/errors';

export interface DefenseCompileReferences {
  locationId: string;
  contactId: string;
  paymentEventId?: string;
  enrollmentId?: string;
  offerId?: string;
  disputeEventId?: string;
  processor?: DefenseProcessor;
  disputeDate?: string;
  disputeTimezone?: string;
}

export type DefenseProcessor = 'stripe' | 'nmi' | 'whop';

const DEFENSE_PROCESSORS = new Set<DefenseProcessor>(['stripe', 'nmi', 'whop']);

export function calendarDateInTimeZone(timestamp: string, timeZone: string): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) throw new ValidationError('Selected transaction has an invalid timestamp');
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    throw new ValidationError('Dispute timezone is invalid');
  }
}

function normalizeProcessor(value: unknown, label: string): DefenseProcessor | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const normalized = String(value).toLowerCase() as DefenseProcessor;
  if (!DEFENSE_PROCESSORS.has(normalized)) {
    throw new ValidationError(`${label} processor is not supported for defense compilation`);
  }
  return normalized;
}

async function requireRow(query: any, label: string): Promise<any> {
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) throw new ValidationError(`${label} does not belong to this client and sub-account`);
  return data;
}

export const defenseInputValidationService = {
  async validate(input: DefenseCompileReferences): Promise<DefenseCompileReferences> {
    const supabase = getSupabase();
    let paymentEventId = input.paymentEventId || '';
    let enrollmentId = input.enrollmentId || '';
    let offerId = input.offerId || '';
    let processor = normalizeProcessor(input.processor, 'Selected');
    let transactionDate = '';
    let contactVerified = false;

    if (input.disputeEventId) {
      const dispute = await requireRow(
        supabase
          .from('dispute_events')
          .select('id, contact_id, payment_event_id, processor')
          .eq('id', input.disputeEventId)
          .eq('location_id', input.locationId),
        'Dispute',
      );
      if (dispute.contact_id && dispute.contact_id !== input.contactId) {
        throw new ValidationError('Dispute does not belong to this client and sub-account');
      }
      if (paymentEventId && dispute.payment_event_id && dispute.payment_event_id !== paymentEventId) {
        throw new ValidationError('Dispute does not match the selected transaction');
      }
      paymentEventId = paymentEventId || dispute.payment_event_id || '';
      const disputeProcessor = normalizeProcessor(dispute.processor, 'Dispute');
      if (processor && disputeProcessor && processor !== disputeProcessor) {
        throw new ValidationError('Selected processor does not match the dispute');
      }
      processor = disputeProcessor || processor;
      contactVerified = dispute.contact_id === input.contactId;
    }

    if (paymentEventId) {
      const payment = await requireRow(
        supabase
          .from('payment_events')
          .select('id, contact_id, enrollment_id, offer_id, processor, created_at')
          .eq('id', paymentEventId)
          .eq('location_id', input.locationId)
          .eq('contact_id', input.contactId),
        'Payment',
      );
      if (enrollmentId && payment.enrollment_id && payment.enrollment_id !== enrollmentId) {
        throw new ValidationError('Selected enrollment does not match the disputed transaction');
      }
      if (offerId && payment.offer_id && payment.offer_id !== offerId) {
        throw new ValidationError('Selected offer does not match the disputed transaction');
      }
      enrollmentId = payment.enrollment_id || enrollmentId;
      offerId = payment.offer_id || offerId;
      const paymentProcessor = normalizeProcessor(payment.processor, 'Payment');
      if (processor && paymentProcessor && processor !== paymentProcessor) {
        throw new ValidationError('Selected processor does not match the disputed transaction');
      }
      processor = paymentProcessor || processor;
      transactionDate = payment.created_at || '';
      contactVerified = true;
    }

    if (transactionDate && input.disputeDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.disputeDate)) {
        throw new ValidationError('Dispute date must be a calendar date');
      }
      const transactionCalendarDate = calendarDateInTimeZone(
        transactionDate,
        input.disputeTimezone || 'UTC',
      );
      if (input.disputeDate < transactionCalendarDate) {
        throw new ValidationError(
          `Dispute date cannot be before the selected transaction date (${transactionCalendarDate})`,
        );
      }
    }

    if (enrollmentId) {
      const enrollment = await requireRow(
        supabase
          .from('enrollments')
          .select('id, offer_id')
          .eq('id', enrollmentId)
          .eq('location_id', input.locationId)
          .eq('contact_id', input.contactId),
        'Enrollment',
      );
      if (offerId && enrollment.offer_id && enrollment.offer_id !== offerId) {
        throw new ValidationError('Selected offer does not match the enrollment');
      }
      offerId = enrollment.offer_id || offerId;
      contactVerified = true;
    }

    if (offerId) {
      await requireRow(
        supabase
          .from('offers_mirror')
          .select('id')
          .eq('id', offerId)
          .eq('location_id', input.locationId),
        'Offer',
      );
    }

    if (!contactVerified) {
      try {
        const api = await ghlApi(input.locationId);
        const response = await api.get(`/contacts/${input.contactId}`);
        const contact = response.data?.contact || response.data;
        if (!contact?.id || String(contact.id) !== input.contactId) {
          throw new Error('Contact was not returned by GHL');
        }
      } catch {
        throw new ValidationError('Client does not belong to this sub-account');
      }
    }

    return {
      ...input,
      paymentEventId: paymentEventId || undefined,
      enrollmentId: enrollmentId || undefined,
      offerId: offerId || undefined,
      processor,
    };
  },
};
