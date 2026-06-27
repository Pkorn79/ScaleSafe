import { ghlApi } from '../clients/ghl.client';
import { triggerService } from './trigger.service';
import { logger } from '../utils/logger';

export interface EnrollmentLinkDeliveryInput {
  locationId: string;
  contactId: string;
  offerId: string;
  offerName: string;
  enrollmentUrl: string;
  enrollmentId?: string;
  paymentStatus?: string;
  paymentSource?: string;
  paymentTiming?: string;
  enrollmentStatus?: string;
  sendWelcome?: boolean;
  amount?: number;
  sendVia?: string[];
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  sendDirectMessage?: boolean;
  extraPayload?: Record<string, unknown>;
}

export interface EnrollmentLinkDeliveryResult {
  sent: number;
  failed: number;
  contactFieldSynced: boolean;
  contactFieldError?: string;
  triggerError?: string;
  directEmailSent?: boolean;
  directSmsSent?: boolean;
  directMessageErrors?: string[];
}

function messageFor(err: unknown): string {
  return err instanceof Error ? err.message : String(err || 'Unknown error');
}

export async function deliverEnrollmentLink(
  input: EnrollmentLinkDeliveryInput,
): Promise<EnrollmentLinkDeliveryResult> {
  let contactFieldSynced = true;
  let contactFieldError: string | undefined;
  let api: Awaited<ReturnType<typeof ghlApi>> | undefined;

  try {
    api = await ghlApi(input.locationId);
    await api.put(`/contacts/${input.contactId}`, {
      customField: {
        'contact.ss_enrollment_link': input.enrollmentUrl,
        'contact.ss_current_offer_name': input.offerName,
        'contact.ss_enrollment_status': input.enrollmentStatus || 'link_sent',
      },
    });
  } catch (err: unknown) {
    contactFieldSynced = false;
    contactFieldError = messageFor(err);
    logger.warn(
      {
        err: contactFieldError,
        locationId: input.locationId,
        contactId: input.contactId,
        offerId: input.offerId,
        enrollmentId: input.enrollmentId,
      },
      'Enrollment link contact field sync failed',
    );
  }

  const payload: Record<string, unknown> = {
    event_type: 'send_enrollment_link',
    location_id: input.locationId,
    locationId: input.locationId,
    contact_id: input.contactId,
    contactId: input.contactId,
    offer_id: input.offerId,
    offerId: input.offerId,
    offer_name: input.offerName,
    offerName: input.offerName,
    program_name: input.offerName,
    programName: input.offerName,
    enrollment_url: input.enrollmentUrl,
    enrollmentUrl: input.enrollmentUrl,
    payment_status: input.paymentStatus || 'not_paid',
    paymentStatus: input.paymentStatus || 'not_paid',
    enrollment_status: input.enrollmentStatus || 'link_sent',
    enrollmentStatus: input.enrollmentStatus || 'link_sent',
    send_welcome: input.sendWelcome ?? false,
    sendWelcome: input.sendWelcome ?? false,
    send_via: input.sendVia || ['email'],
    sendVia: input.sendVia || ['email'],
    first_name: input.firstName || '',
    firstName: input.firstName || '',
    last_name: input.lastName || '',
    lastName: input.lastName || '',
    email: input.email || '',
    phone: input.phone || '',
    ...(input.enrollmentId ? { enrollment_id: input.enrollmentId, enrollmentId: input.enrollmentId } : {}),
    ...(input.paymentSource ? { payment_source: input.paymentSource, paymentSource: input.paymentSource } : {}),
    ...(input.paymentTiming ? { payment_timing: input.paymentTiming, paymentTiming: input.paymentTiming } : {}),
    ...(typeof input.amount === 'number' ? { amount: input.amount } : {}),
    ...(input.extraPayload || {}),
  };

  try {
    const triggerResult = await triggerService.fireTrigger(input.locationId, 'ss_send_enrollment_link', payload);
    const direct = await sendDirectEnrollmentLinkMessage(input, api);
    return {
      ...triggerResult,
      contactFieldSynced,
      contactFieldError,
      ...direct,
    };
  } catch (err: unknown) {
    const triggerError = messageFor(err);
    logger.error(
      {
        err: triggerError,
        locationId: input.locationId,
        contactId: input.contactId,
        offerId: input.offerId,
        enrollmentId: input.enrollmentId,
      },
      'Enrollment link trigger failed',
    );
    return {
      sent: 0,
      failed: 1,
      contactFieldSynced,
      contactFieldError,
      triggerError,
      ...(await sendDirectEnrollmentLinkMessage(input, api)),
    };
  }
}

async function sendDirectEnrollmentLinkMessage(
  input: EnrollmentLinkDeliveryInput,
  existingApi?: Awaited<ReturnType<typeof ghlApi>>,
): Promise<Pick<EnrollmentLinkDeliveryResult, 'directEmailSent' | 'directSmsSent' | 'directMessageErrors'>> {
  if (!input.sendDirectMessage) return {};

  const directMessageErrors: string[] = [];
  let directEmailSent = false;
  let directSmsSent = false;
  let api = existingApi;

  try {
    if (!api) api = await ghlApi(input.locationId);
  } catch (err: unknown) {
    return { directEmailSent, directSmsSent, directMessageErrors: [messageFor(err)] };
  }

  if ((input.sendVia || ['email']).includes('email') && input.email) {
    try {
      const firstName = input.firstName || 'there';
      const emailBody = `<p>Hi ${firstName},</p><p>Here's your enrollment link for <strong>${input.offerName}</strong>:</p><p><a href="${input.enrollmentUrl}">${input.enrollmentUrl}</a></p><p>Click the link above to complete your enrollment packet.</p>`;
      await api.post('/conversations/messages', {
        type: 'Email',
        contactId: input.contactId,
        html: emailBody,
        subject: `Your enrollment link for ${input.offerName}`,
      });
      directEmailSent = true;
      logger.info(
        { contactId: input.contactId, offerId: input.offerId, enrollmentId: input.enrollmentId },
        'Enrollment link email sent via GHL Conversations',
      );
    } catch (err: any) {
      const error = messageFor(err);
      directMessageErrors.push(`email: ${error}`);
      logger.error(
        {
          err: error,
          status: err?.response?.status,
          contactId: input.contactId,
          offerId: input.offerId,
          enrollmentId: input.enrollmentId,
        },
        'Failed to send enrollment link email via GHL Conversations',
      );
    }
  }

  if ((input.sendVia || []).includes('sms') && input.phone) {
    try {
      const firstName = input.firstName || 'there';
      await api.post('/conversations/messages', {
        type: 'SMS',
        contactId: input.contactId,
        message: `Hi ${firstName}! Here's your enrollment link for ${input.offerName}: ${input.enrollmentUrl}`,
      });
      directSmsSent = true;
      logger.info(
        { contactId: input.contactId, offerId: input.offerId, enrollmentId: input.enrollmentId },
        'Enrollment link SMS sent via GHL Conversations',
      );
    } catch (err: any) {
      const error = messageFor(err);
      directMessageErrors.push(`sms: ${error}`);
      logger.error(
        {
          err: error,
          status: err?.response?.status,
          contactId: input.contactId,
          offerId: input.offerId,
          enrollmentId: input.enrollmentId,
        },
        'Failed to send enrollment link SMS via GHL Conversations',
      );
    }
  }

  return { directEmailSent, directSmsSent, directMessageErrors };
}
