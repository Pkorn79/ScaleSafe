import { Request, Response, NextFunction } from 'express';
import { ghlApi } from '../clients/ghl.client';
import { offerRepository } from '../repositories/offer.repository';
import { merchantService } from '../services/merchant.service';
import { offerService } from '../services/offer.service';
import { resolveLocationId } from '../middleware/tenantContext';
import { triggerService } from '../services/trigger.service';
import { config } from '../config';
import { logger } from '../utils/logger';
import { buildDefenseEvidenceFields } from '../utils/defense-evidence';

/**
 * POST /api/enrollment/send-link
 *
 * Sends an enrollment link to a client via GHL email/SMS.
 * 1. Validates offer exists and is active
 * 2. Upserts GHL contact
 * 3. Writes enrollment URL + offer name to contact custom fields
 * 4. Fires ss_send_enrollment_link trigger for GHL workflow
 */
export async function sendEnrollmentLink(req: Request, res: Response, next: NextFunction) {
  try {
    const locationId = resolveLocationId(req);
    if (!locationId) {
      res.status(400).json({ error: 'locationId required' });
      return;
    }

    const { offerId, firstName, lastName, email, phone, sendVia } = req.body;

    // ─── Validation ──────────────────────────────────

    if (!offerId) {
      res.status(400).json({ error: 'offerId is required' });
      return;
    }
    if (!firstName) {
      res.status(400).json({ error: 'firstName is required' });
      return;
    }
    if (!Array.isArray(sendVia) || sendVia.length === 0) {
      res.status(400).json({ error: 'sendVia must include at least "email" or "sms"' });
      return;
    }
    if (sendVia.includes('email') && !email) {
      res.status(400).json({ error: 'email is required when sending via email' });
      return;
    }
    if (sendVia.includes('sms') && !phone) {
      res.status(400).json({ error: 'phone is required when sending via SMS' });
      return;
    }

    // ─── Verify offer ────────────────────────────────

    const offer = await offerRepository.findById(offerId);
    if (!offer || !offer.active) {
      res.status(404).json({ error: 'Offer not found or inactive' });
      return;
    }

    // ─── Build enrollment URL ────────────────────────

    const appBaseUrl = config.appUrl;
    const checkoutMode = (offer as any).checkout_mode || 'full_enrollment';

    // Read merchant's funnel URL
    let funnelBaseUrl = '';
    try {
      const mc = await merchantService.getFullConfig(locationId);
      funnelBaseUrl = mc.enrollmentFunnelUrl || '';
    } catch {}

    const enrollmentUrl = offerService.generateEnrollmentLink(offerId, appBaseUrl, checkoutMode, funnelBaseUrl);

    // ─── Upsert GHL contact ─────────────────────────

    const api = await ghlApi(locationId);
    let contactId: string;

    try {
      const upsertData: Record<string, unknown> = {
        firstName,
        lastName: lastName || '',
        locationId,
      };
      if (email) upsertData.email = email;
      if (phone) upsertData.phone = phone;

      const upsertRes = await api.post('/contacts/upsert', upsertData);
      contactId = upsertRes.data.contact?.id || upsertRes.data.id || '';

      if (!contactId) {
        throw new Error('GHL upsert returned no contact ID');
      }
    } catch (err: any) {
      logger.error({ err: err.message, locationId }, 'Failed to upsert GHL contact for send-link');
      res.status(500).json({ error: 'Unable to create contact in GHL' });
      return;
    }

    // ─── Write enrollment URL + offer name to contact ─

    try {
      await api.put(`/contacts/${contactId}`, {
        customField: {
          'contact.ss_enrollment_link': enrollmentUrl,
          'contact.ss_current_offer_name': offer.offer_name,
        },
      });
    } catch (err: any) {
      logger.warn({ err: err.message, contactId }, 'Failed to write enrollment link custom fields — continuing');
    }

    // ─── Fire GHL trigger ───────────────────────────

    try {
      await triggerService.fireTrigger(locationId, 'ss_send_enrollment_link', {
        event_type: 'send_enrollment_link',
        location_id: locationId,
        locationId,
        contact_id: contactId,
        contactId,
        offer_id: offerId,
        offerId,
        offer_name: offer.offer_name,
        offerName: offer.offer_name,
        program_name: offer.offer_name,
        programName: offer.offer_name,
        enrollment_url: enrollmentUrl,
        enrollmentUrl,
        send_via: sendVia,
        sendVia,
        first_name: firstName,
        firstName,
        last_name: lastName || '',
        lastName: lastName || '',
        email: email || '',
        phone: phone || '',
      });
    } catch (err: any) {
      logger.warn({ err: err.message, contactId }, 'Trigger fire failed — link still generated');
    }

    // ─── Send directly via GHL Conversations API ──────
    // The trigger above is for workflow automation. The direct send ensures
    // the message actually reaches the client even without a workflow.

    // GHL Conversations API: Email requires 'html' field (not 'message'); SMS uses 'message'
    if (sendVia.includes('email') && email) {
      try {
        const emailBody = `<p>Hi ${firstName},</p><p>Here's your enrollment link for <strong>${offer.offer_name}</strong>:</p><p><a href="${enrollmentUrl}">${enrollmentUrl}</a></p><p>Click the link above to get started.</p>`;
        await api.post('/conversations/messages', {
          type: 'Email',
          contactId,
          html: emailBody,
          subject: `Your enrollment link for ${offer.offer_name}`,
        });
        logger.info({ contactId, hasEmail: true }, 'Enrollment link email sent via GHL Conversations');
      } catch (emailErr: any) {
        logger.error({
          err: emailErr.message,
          status: emailErr.response?.status,
          responseKeys: emailErr.response?.data ? Object.keys(emailErr.response.data) : [],
          contactId,
        }, 'Failed to send enrollment link email via GHL Conversations');
      }
    }

    if (sendVia.includes('sms') && phone) {
      try {
        await api.post('/conversations/messages', {
          type: 'SMS',
          contactId,
          message: `Hi ${firstName}! Here's your enrollment link for ${offer.offer_name}: ${enrollmentUrl}`,
        });
        logger.info({ contactId, hasPhone: true }, 'Enrollment link SMS sent via GHL Conversations');
      } catch (smsErr: any) {
        logger.error({
          err: smsErr.message,
          status: smsErr.response?.status,
          responseKeys: smsErr.response?.data ? Object.keys(smsErr.response.data) : [],
          contactId,
        }, 'Failed to send enrollment link SMS via GHL Conversations');
      }
    }

    // Log COMMUNICATION evidence (enrollment link sent = outreach)
    try {
      const { evidenceService } = require('../services/evidence.service');
      const { EVIDENCE_TYPES } = require('../constants/evidence-types');
      await evidenceService.logEvidence(
        EVIDENCE_TYPES.COMMUNICATION, locationId, contactId, 'send_enrollment_link',
        {
          direction: 'outbound',
          comm_type: sendVia.includes('sms') ? 'sms' : 'email',
          comm_date: new Date().toISOString(),
          subject: `Enrollment link: ${offer.offer_name}`,
          summary: `Enrollment link sent for ${offer.offer_name} via ${sendVia.join(', ')}`,
          body_preview: `Secure enrollment link sent for ${offer.offer_name}.`,
          raw_payload: { offerId, sendVia, emailProvided: Boolean(email), phoneProvided: Boolean(phone) },
          ...buildDefenseEvidenceFields({
            summary: `Merchant sent an enrollment link for ${offer.offer_name} via ${sendVia.join(', ')} to begin the client's purchase and consent flow.`,
            title: 'Enrollment Link Sent',
            proofRole: 'communication',
            relevance: {
              tags: ['authorization', 'fraud', 'not_as_described'],
              priority: 'medium',
              confidence: 'moderate',
            },
            metadata: {
              actor: 'merchant',
              service: { offerId, offerName: offer.offer_name },
              communication: {
                channel: sendVia.includes('sms') ? 'sms' : 'email',
                direction: 'outbound',
                purpose: 'enrollment_invitation',
                excerpt: `Secure enrollment link sent for ${offer.offer_name}.`,
              },
              source: { system: 'send_enrollment_link', rawEventType: 'enrollment_link_sent' },
            },
          }),
        },
      );
    } catch (evErr: any) {
      logger.warn({ err: evErr.message, contactId }, 'Failed to log send-link evidence (non-blocking)');
    }

    logger.info({ contactId, offerId, sendVia, locationId }, 'Enrollment link sent');

    res.json({
      success: true,
      contactId,
      enrollmentUrl,
      sentVia: sendVia,
    });
  } catch (err) { next(err); }
}
