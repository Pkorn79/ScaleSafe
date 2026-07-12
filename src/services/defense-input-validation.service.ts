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
    let contactVerified = false;

    if (input.disputeEventId) {
      const dispute = await requireRow(
        supabase
          .from('dispute_events')
          .select('id, contact_id, payment_event_id')
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
      contactVerified = dispute.contact_id === input.contactId;
    }

    if (paymentEventId) {
      const payment = await requireRow(
        supabase
          .from('payment_events')
          .select('id, contact_id, enrollment_id, offer_id')
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
      contactVerified = true;
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
    };
  },
};
