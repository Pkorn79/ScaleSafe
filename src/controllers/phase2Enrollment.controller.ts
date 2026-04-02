import { Request, Response, NextFunction } from 'express';
import { consentService } from '../services/consent.service';
import { phase2EnrollmentService } from '../services/phase2Enrollment.service';
import { enrollmentRepository } from '../repositories/enrollment.repository';
import { ValidationError } from '../utils/errors';

export const phase2EnrollmentController = {
  /**
   * POST /api/enrollment/consent
   * Public endpoint — called by JavaScript on enrollment funnel Page 3.
   */
  async captureConsent(req: Request, res: Response, next: NextFunction) {
    try {
      const {
        offerId, contactId, contactEmail, contactName,
        tcVersionHash, signatureText, consentCheckboxes,
      } = req.body;

      if (!offerId || !contactId) {
        throw new ValidationError('offerId and contactId are required');
      }

      const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '';
      const userAgent = req.headers['user-agent'] || '';
      const device = parseDevice(userAgent);
      const browser = parseBrowser(userAgent);

      const result = await consentService.captureConsent({
        offerId,
        locationId: req.body.locationId || '',
        contactId,
        contactEmail: contactEmail || '',
        contactName: contactName || '',
        ip,
        device,
        browser,
        tcVersionHash: tcVersionHash || '',
        signatureText: signatureText || '',
        consentCheckboxes,
      });

      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/enrollments
   * Merchant-authenticated — list enrollments for the merchant's location.
   */
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = req.tenantContext?.locationId;
      if (!locationId) throw new ValidationError('Location context required');

      const status = req.query.status as string | undefined;
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

      const result = await enrollmentRepository.listByLocation(locationId, { status, page, limit });

      res.json({
        enrollments: result.data,
        total: result.total,
        page,
        limit,
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/enrollments/:id
   * Merchant-authenticated — enrollment detail with evidence + payment events.
   */
  async detail(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = req.tenantContext?.locationId;
      if (!locationId) throw new ValidationError('Location context required');

      const result = await phase2EnrollmentService.getEnrollmentDetails(
        req.params.id,
        locationId,
      );

      res.json(result);
    } catch (err) {
      next(err);
    }
  },
};

function parseDevice(ua: string): string {
  if (/mobile/i.test(ua)) return 'mobile';
  if (/tablet/i.test(ua)) return 'tablet';
  return 'desktop';
}

function parseBrowser(ua: string): string {
  if (/chrome/i.test(ua) && !/edge/i.test(ua)) return 'Chrome';
  if (/firefox/i.test(ua)) return 'Firefox';
  if (/safari/i.test(ua) && !/chrome/i.test(ua)) return 'Safari';
  if (/edge/i.test(ua)) return 'Edge';
  return ua.slice(0, 50);
}
