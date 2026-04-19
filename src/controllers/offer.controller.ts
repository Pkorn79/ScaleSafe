import { Request, Response, NextFunction } from 'express';
import { offerService } from '../services/offer.service';
import { merchantService } from '../services/merchant.service';
import { config } from '../config';
import { resolveLocationId } from '../middleware/tenantContext';
import { ValidationError } from '../utils/errors';

export const offerController = {
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');

      const { offerName } = req.body;
      if (!offerName) throw new ValidationError('offerName required');

      const offer = await offerService.create({ locationId, ...req.body });
      res.status(201).json(offer);
    } catch (err) { next(err); }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const offer = await offerService.getById(req.params.id);
      res.json(offer);
    } catch (err) { next(err); }
  },

  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');

      const offers = await offerService.listByLocation(locationId);
      res.json(offers);
    } catch (err) { next(err); }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const offer = await offerService.update(req.params.id, req.body);
      res.json(offer);
    } catch (err) { next(err); }
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      await offerService.delete(req.params.id);
      res.status(204).end();
    } catch (err) { next(err); }
  },

  async getEnrollmentLink(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      const offer = await offerService.getById(req.params.id);
      const appBaseUrl = config.appUrl;

      // Read the merchant's funnel URL from config
      let funnelBaseUrl = '';
      if (locationId) {
        try {
          const mc = await merchantService.getFullConfig(locationId);
          funnelBaseUrl = mc.enrollmentFunnelUrl || '';
        } catch {}
      }

      const link = offerService.generateEnrollmentLink(offer.id, appBaseUrl, (offer as any).checkout_mode, funnelBaseUrl);
      res.json({ link, funnelConfigured: !!funnelBaseUrl });
    } catch (err) { next(err); }
  },

  async clone(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');

      const offer = await offerService.cloneOffer(req.params.id, locationId);
      res.status(201).json({
        success: true,
        offer,
        message: 'Offer cloned. Edit the copy and activate when ready.',
      });
    } catch (err) { next(err); }
  },
};
