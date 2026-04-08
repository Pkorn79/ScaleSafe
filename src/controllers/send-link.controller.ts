import { Request, Response, NextFunction } from 'express';
import { ghlApi } from '../clients/ghl.client';
import { offerRepository } from '../repositories/offer.repository';
import { merchantService } from '../services/merchant.service';
import { offerService } from '../services/offer.service';
import { resolveLocationId } from '../middleware/tenantContext';
import { triggerService } from '../services/trigger.service';
import { config } from '../config';
import { logger } from '../utils/logger';

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
        contactId,
        offerId,
        offerName: offer.offer_name,
        enrollmentUrl,
        sendVia,
        firstName,
        email: email || '',
        phone: phone || '',
      });
    } catch (err: any) {
      logger.warn({ err: err.message, contactId }, 'Trigger fire failed — link still generated');
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
