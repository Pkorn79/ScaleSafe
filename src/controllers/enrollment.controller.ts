import { Request, Response, NextFunction } from 'express';
import { enrollmentService } from '../services/enrollment.service';
import { ValidationError } from '../utils/errors';

export const enrollmentController = {
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

  /** Page 3: Capture consent */
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
};
