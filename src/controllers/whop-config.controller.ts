import { Request, Response, NextFunction } from 'express';
import { resolveLocationId } from '../middleware/tenantContext';
import { ValidationError } from '../utils/errors';
import { whopConfigService } from '../services/whop-config.service';
import { whopService } from '../services/whop.service';
import { logger } from '../utils/logger';

export const whopConfigController = {
  async get(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');
      res.json(await whopConfigService.getPublic(locationId));
    } catch (err) { next(err); }
  },

  async save(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');
      const { companyId, apiKey, webhookSecret, environment } = req.body || {};
      const config = await whopConfigService.upsert(locationId, {
        companyId,
        apiKey,
        webhookSecret,
        environment,
      });
      logger.info({ locationId, companyId: config.companyId, environment: config.environment }, 'Whop config saved');
      res.json(config);
    } catch (err) { next(err); }
  },

  async test(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');
      res.json(await whopService.testConnection(locationId));
    } catch (err) { next(err); }
  },

  async disconnect(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');
      await whopConfigService.disconnect(locationId);
      logger.info({ locationId }, 'Whop disconnected');
      res.json({ success: true });
    } catch (err) { next(err); }
  },
};
