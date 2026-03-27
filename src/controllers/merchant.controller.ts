import { Request, Response, NextFunction } from 'express';
import { merchantRepository } from '../repositories/merchant.repository';
import { merchantService } from '../services/merchant.service';
import { resolveLocationId } from '../middleware/tenantContext';
import { ValidationError } from '../utils/errors';

export const merchantController = {
  /** GET /api/merchants/config — get merchant configuration */
  async getConfig(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');

      const merchant = await merchantRepository.getByLocationId(locationId);
      res.json({
        locationId: merchant.location_id,
        businessName: merchant.business_name,
        supportEmail: merchant.support_email,
        status: merchant.status,
        snapshotStatus: merchant.snapshot_status,
        modules: {
          sessions: merchant.module_sessions,
          milestones: merchant.module_milestones,
          pulse: merchant.module_pulse,
          payments: merchant.module_payments,
          course: merchant.module_course,
        },
        config: merchant.config,
      });
    } catch (err) { next(err); }
  },

  /** PUT /api/merchants/config — update merchant configuration */
  async updateConfig(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');

      const updates: Record<string, unknown> = {};

      // Direct fields
      if (req.body.businessName !== undefined) updates.business_name = req.body.businessName;
      if (req.body.supportEmail !== undefined) updates.support_email = req.body.supportEmail;

      // Module toggles
      if (req.body.modules) {
        if (req.body.modules.sessions !== undefined) updates.module_sessions = req.body.modules.sessions;
        if (req.body.modules.milestones !== undefined) updates.module_milestones = req.body.modules.milestones;
        if (req.body.modules.pulse !== undefined) updates.module_pulse = req.body.modules.pulse;
        if (req.body.modules.payments !== undefined) updates.module_payments = req.body.modules.payments;
        if (req.body.modules.course !== undefined) updates.module_course = req.body.modules.course;
      }

      // Config JSONB (merge with existing)
      if (req.body.config) {
        const existing = await merchantRepository.getConfig(locationId);
        updates.config = { ...existing, ...req.body.config };
      }

      const merchant = await merchantRepository.update(locationId, updates as any);
      res.json({ status: 'ok', locationId: merchant.location_id });
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
