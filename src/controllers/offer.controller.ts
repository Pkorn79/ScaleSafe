import { Request, Response, NextFunction } from 'express';
import { offerService } from '../services/offer.service';
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
      const offer = await offerService.getById(req.params.id);
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const link = offerService.generateEnrollmentLink(offer.id, baseUrl);
      res.json({ link });
    } catch (err) { next(err); }
  },
};
