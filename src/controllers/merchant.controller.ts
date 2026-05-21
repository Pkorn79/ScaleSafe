import { Request, Response, NextFunction } from 'express';
import { merchantRepository } from '../repositories/merchant.repository';
import { merchantService } from '../services/merchant.service';
import { resolveLocationId } from '../middleware/tenantContext';
import { ValidationError } from '../utils/errors';
import { logger } from '../utils/logger';
import { storageService } from '../services/storage.service';

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

  /** GET /api/merchants/provisioning-health - fresh-install diagnostic */
  async getProvisioningHealth(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');

      const report = await merchantService.getProvisioningHealth(locationId);
      res.json(report);
    } catch (err) { next(err); }
  },

  /** POST /api/merchants/provisioning-health/repair-webhook-secret - discover/sync webhook secret CV */
  async repairWebhookSecretCustomValue(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');

      const report = await merchantService.repairWorkflowWebhookSecretCustomValue(locationId);
      res.json(report);
    } catch (err) { next(err); }
  },

  /** POST /api/merchants/provisioning-health/repair-custom-fields - create missing beta workflow fields */
  async repairWorkflowCustomFields(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');

      const report = await merchantService.repairWorkflowCompatibleCustomFields(locationId);
      res.json(report);
    } catch (err) { next(err); }
  },

  /** POST /api/merchants/provisioning-health/custom-field-cleanup - dry run by default; deletes only with confirmDelete=true */
  async cleanupWorkflowCustomFields(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');

      const report = await merchantService.cleanupWorkflowCustomFieldCandidates(locationId, req.body?.confirmDelete === true);
      res.json(report);
    } catch (err) { next(err); }
  },

  /** GET /api/merchants/webhook-secret - return this merchant's workflow webhook secret */
  async getWebhookSecret(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');

      const secret = await merchantService.ensureWorkflowWebhookSecret(locationId);
      res.json({
        secret,
        headerName: 'x-scalesafe-webhook-secret',
        mergeField: '{{ custom_values.scalesafe_webhook_secret }}',
        enforceRequired: process.env.REQUIRE_WEBHOOK_SECRET === 'true',
      });
    } catch (err) { next(err); }
  },

  /** POST /api/merchants/webhook-secret/rotate - rotate this merchant's workflow webhook secret */
  async rotateWebhookSecret(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');

      const secret = await merchantService.rotateWorkflowWebhookSecret(locationId);
      logger.warn({ locationId }, 'Merchant workflow webhook secret rotated');
      res.json({
        secret,
        headerName: 'x-scalesafe-webhook-secret',
        mergeField: '{{ custom_values.scalesafe_webhook_secret }}',
        enforceRequired: process.env.REQUIRE_WEBHOOK_SECRET === 'true',
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

  /** POST /api/merchants/logo — upload merchant logo to Supabase Storage */
  async uploadLogo(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');

      const file = (req as any).file;
      if (!file) throw new ValidationError('No file uploaded');

      const allowedTypes = ['image/png', 'image/jpeg', 'image/webp'];
      if (!allowedTypes.includes(file.mimetype)) {
        throw new ValidationError('File must be PNG, JPEG, or WebP');
      }

      const extByMime: Record<string, string> = {
        'image/png': '.png',
        'image/jpeg': '.jpg',
        'image/webp': '.webp',
      };
      const ext = extByMime[file.mimetype] || '.png';
      const storagePath = `logos/${locationId}/logo${ext}`;

      const logoUrl = await storageService.uploadPublicAsset(storagePath, file.buffer, file.mimetype);
      logger.info({ logoUrl }, 'Logo public URL generated');

      // Save to merchant record
      await merchantService.updateFullConfig(locationId, { logoUrl });

      res.json({ logoUrl, storagePath });
    } catch (err) { next(err); }
  },
};
