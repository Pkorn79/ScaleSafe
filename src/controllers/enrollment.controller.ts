import { Request, Response, NextFunction } from 'express';
import { enrollmentService } from '../services/enrollment.service';
import { ValidationError } from '../utils/errors';
import { logger } from '../utils/logger';

export const enrollmentController = {
  // ─── Funnel Widget Endpoints (public, no auth) ─────────────────

  /** POST /api/enrollment/device-capture — Page 1 widget */
  async deviceCapture(req: Request, res: Response, next: NextFunction) {
    try {
      const { offerId, email, paidEnrollmentToken, ipAddress, userAgent, deviceFingerprint, screenResolution, timezone, browserLanguage } = req.body;
      if (!offerId || (!email && !paidEnrollmentToken)) {
        res.status(400).json({ error: 'offerId and email are required' });
        return;
      }

      const result = await enrollmentService.captureDevice({
        offerId,
        email,
        paidEnrollmentToken,
        ipAddress: ipAddress || req.ip || '',
        userAgent: userAgent || req.headers['user-agent'] || '',
        deviceFingerprint: deviceFingerprint || '',
        screenResolution: screenResolution || '',
        timezone: timezone || '',
        browserLanguage: browserLanguage || '',
      });

      res.json(result);
    } catch (err: any) {
      if (err.message === 'Offer not found or inactive') {
        res.status(404).json({ error: 'Offer not found' });
        return;
      }
      if (err.message?.includes('Paid enrollment link')) {
        res.status(400).json({ error: err.message });
        return;
      }
      logger.error({ err: err.message }, 'Device capture failed');
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  /** GET /api/enrollment/offer/:offerId/public — Page 2 widget */
  async getPublicOffer(req: Request, res: Response, next: NextFunction) {
    try {
      const offer = await enrollmentService.getPublicOffer(req.params.offerId);
      if (!offer) {
        res.status(404).json({ error: 'Offer not found' });
        return;
      }
      res.json(offer);
    } catch (err: any) {
      logger.error({ err: err.message }, 'Public offer fetch failed');
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  /** GET /api/enrollment/paid-context — paid/QMS enrollment context for public widgets */
  async getPaidEnrollmentContext(req: Request, res: Response, next: NextFunction) {
    try {
      const offerId = String(req.query.offerId || '');
      const paidEnrollmentToken = String(req.query.paidEnrollmentToken || '');
      const result = await enrollmentService.getPaidEnrollmentContext({ offerId, paidEnrollmentToken });
      res.json(result);
    } catch (err: any) {
      if (err.message === 'Offer not found or inactive') {
        res.status(404).json({ error: 'Offer not found' });
        return;
      }
      if (err.message?.includes('Paid enrollment link') || err.message?.includes('action token') || err.message?.includes('required')) {
        res.status(400).json({ error: err.message });
        return;
      }
      logger.error({ err: err.message }, 'Paid enrollment context fetch failed');
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  /** POST /api/enrollment/consent — Page 3 widget (updated for funnel) */
  async funnelConsent(req: Request, res: Response, next: NextFunction) {
    try {
      const {
        offerId, email, consentTimestamp, ipAddress,
        userAgent, deviceFingerprint, screenResolution,
        timezone, browserLanguage, tcVersionHash,
        digitalSignature, clausesAccepted, scrollDepth, paidEnrollmentToken,
        selectedAddonIds,
      } = req.body;

      if (!offerId || (!email && !paidEnrollmentToken) || !digitalSignature) {
        res.status(400).json({ error: 'offerId, email, and digitalSignature are required' });
        return;
      }

      const result = await enrollmentService.captureFunnelConsent({
        offerId,
        email,
        paidEnrollmentToken,
        consentTimestamp: consentTimestamp || new Date().toISOString(),
        ipAddress: ipAddress || req.ip || '',
        userAgent: userAgent || req.headers['user-agent'] || '',
        deviceFingerprint: deviceFingerprint || '',
        screenResolution: screenResolution || '',
        timezone: timezone || '',
        browserLanguage: browserLanguage || '',
        tcVersionHash: tcVersionHash || '',
        digitalSignature,
        clausesAccepted: clausesAccepted || [],
        scrollDepth: typeof scrollDepth === 'number' ? scrollDepth : 0,
        selectedAddonIds: Array.isArray(selectedAddonIds) ? selectedAddonIds : [],
      });

      res.json(result);
    } catch (err: any) {
      if (err.message === 'Offer not found or inactive') {
        res.status(404).json({ error: 'Offer not found' });
        return;
      }
      if (err.message?.includes('Paid enrollment link')) {
        res.status(400).json({ error: err.message });
        return;
      }
      logger.error({ err: err.message }, 'Funnel consent capture failed');
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // ─── Original Endpoints (SSO-gated) ───────────────────────────

  /** Page 1: Create/update contact */
  async prep(req: Request, res: Response, next: NextFunction) {
    try {
      const { locationId, offerId, firstName, lastName, email, phone } = req.body;
      if (!locationId || !offerId || !firstName || !lastName || !email) {
        throw new ValidationError('locationId, offerId, firstName, lastName, email required');
      }

      const result = await enrollmentService.prepEnrollment({
        locationId, offerId, firstName, lastName, email, phone,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });

      res.json(result);
    } catch (err) { next(err); }
  },

  /** Page 2: Fetch offer for display */
  async getOffer(req: Request, res: Response, next: NextFunction) {
    try {
      const offer = await enrollmentService.getOfferForEnrollment(req.params.id);
      res.json(offer);
    } catch (err) { next(err); }
  },

  /** Page 3: Capture consent (legacy — SSO-gated) */
  async captureConsent(req: Request, res: Response, next: NextFunction) {
    try {
      const { locationId, contactId, offerId, tcHtml, deviceFingerprint, browser } = req.body;
      if (!locationId || !contactId || !offerId || !tcHtml) {
        throw new ValidationError('locationId, contactId, offerId, tcHtml required');
      }

      const result = await enrollmentService.captureConsent({
        locationId, contactId, offerId,
        consentTimestamp: new Date().toISOString(),
        ip: req.ip || '',
        deviceFingerprint: deviceFingerprint || '',
        browser: browser || '',
        userAgent: req.headers['user-agent'] || '',
        tcHtml,
      });

      res.json(result);
    } catch (err) { next(err); }
  },

  /**
   * GET /api/enrollment/consent-lookup/:consentToken
   * Look up enrollment-time customer info by consent token. Used by the checkout
   * page to detect "full funnel" path (consent token present) and prefill the
   * customer fields that were collected on Page 1, so they don't get re-asked.
   */
  async getConsentData(req: Request, res: Response, next: NextFunction) {
    try {
      const consentToken = req.params.consentToken;
      if (!consentToken) {
        res.status(400).json({ error: 'Missing consent token' });
        return;
      }

      const { getSupabase } = await import('../clients/supabase.client');
      const supabase = getSupabase();
      const { data: enrollment } = await supabase
        .from('enrollments')
        .select('email, contact_id, first_name, last_name, digital_signature, selected_checkout_items')
        .eq('consent_token', consentToken)
        .maybeSingle();

      if (!enrollment) {
        res.status(404).json({ error: 'Consent record not found' });
        return;
      }

      res.json({
        email: enrollment.email || '',
        firstName: enrollment.first_name || '',
        lastName: enrollment.last_name || '',
        contactId: enrollment.contact_id || '',
        digitalSignature: enrollment.digital_signature || '',
        selectedCheckoutItems: Array.isArray(enrollment.selected_checkout_items) ? enrollment.selected_checkout_items : [],
      });
    } catch (err) { next(err); }
  },
};
