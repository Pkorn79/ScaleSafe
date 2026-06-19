import { Request, Response, NextFunction } from 'express';
import { resolveLocationId } from '../middleware/tenantContext';
import { ValidationError } from '../utils/errors';
import { fanbasisConfigService } from '../services/fanbasis-config.service';
import { logger } from '../utils/logger';

/**
 * FanBasis credential management (Model B), mirroring whop-config.controller.ts.
 * SSO/tenant-scoped via resolveLocationId; no ProcessorInterface involvement.
 */
export const fanbasisConfigController = {
  async get(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');
      res.json(await fanbasisConfigService.getPublic(locationId));
    } catch (err) { next(err); }
  },

  async save(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');
      const { creatorHandle, creatorId, apiKey, webhookSecret, environment } = req.body || {};
      const config = await fanbasisConfigService.upsert(locationId, {
        creatorHandle,
        creatorId,
        apiKey,
        webhookSecret,
        environment,
      });
      logger.info({ locationId, creatorHandle: config.creatorHandle, environment: config.environment }, 'FanBasis config saved');
      res.json(config);
    } catch (err) { next(err); }
  },

  async test(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');
      res.json(await fanbasisConfigService.testConnection(locationId));
    } catch (err) { next(err); }
  },

  async disconnect(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');
      await fanbasisConfigService.disconnect(locationId);
      logger.info({ locationId }, 'FanBasis disconnected');
      res.json({ success: true });
    } catch (err) { next(err); }
  },
};
