import { Request, Response, NextFunction } from 'express';
import { merchantRepository } from '../repositories/merchant.repository';
import { merchantService } from '../services/merchant.service';
import { resolveLocationId } from '../middleware/tenantContext';
import { ValidationError } from '../utils/errors';

export const merchantController = {
  /** GET /api/merchants/config — get full merchant configuration */
  async getConfig(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');

      const config = await merchantService.getFullConfig(locationId);
      res.json(config);
    } catch (err) { next(err); }
  },

  /** PUT /api/merchants/config — update merchant configuration */
  async updateConfig(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');

      const config = await merchantService.updateFullConfig(locationId, req.body);
      res.json(config);
    } catch (err) { next(err); }
  },

  /** GET /api/merchants/onboarding-status — check if onboarding is complete */
  async getOnboardingStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');

      const merchant = await merchantRepository.getByLocationId(locationId);
      res.json({
        onboardingComplete: merchant.onboarding_complete,
        snapshotStatus: merchant.snapshot_status,
      });
    } catch (err) { next(err); }
  },

  /** POST /api/merchants/provision — manually trigger provisioning */
  async provision(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');

      const merchant = await merchantRepository.getByLocationId(locationId);

      // Allow re-provisioning if pending or failed
      if (merchant.snapshot_status === 'installed') {
        return res.json({ status: 'already_installed', locationId });
      }

      // Reset status for retry
      await merchantRepository.updateSnapshotStatus(locationId, 'pending');

      merchantService.provisionMerchant(locationId).catch(() => {});
      res.json({ status: 'provisioning_started', locationId });
    } catch (err) { next(err); }
  },
};
