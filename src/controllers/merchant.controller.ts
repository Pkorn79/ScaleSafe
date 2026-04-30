import { Request, Response, NextFunction } from 'express';
import path from 'path';
import { merchantRepository } from '../repositories/merchant.repository';
import { merchantService } from '../services/merchant.service';
import { resolveLocationId } from '../middleware/tenantContext';
import { ValidationError } from '../utils/errors';
import { getSupabase } from '../clients/supabase.client';
import { config } from '../config';
import { logger } from '../utils/logger';

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

  /** GET /api/merchants/webhook-secret - return this merchant's workflow webhook secret */
  async getWebhookSecret(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');

      const secret = await merchantRepository.ensureWebhookSecret(locationId);
      res.json({
        secret,
        headerName: 'x-scalesafe-webhook-secret',
        enforceRequired: process.env.REQUIRE_WEBHOOK_SECRET === 'true',
      });
    } catch (err) { next(err); }
  },

  /** POST /api/merchants/webhook-secret/rotate - rotate this merchant's workflow webhook secret */
  async rotateWebhookSecret(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');

      const secret = await merchantRepository.rotateWebhookSecret(locationId);
      logger.warn({ locationId }, 'Merchant workflow webhook secret rotated');
      res.json({
        secret,
        headerName: 'x-scalesafe-webhook-secret',
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

      const allowedTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
      if (!allowedTypes.includes(file.mimetype)) {
        throw new ValidationError('File must be PNG, JPEG, WebP, or SVG');
      }

      const ext = path.extname(file.originalname).toLowerCase() || '.png';
      const storagePath = `logos/${locationId}/logo${ext}`;

      const supabase = getSupabase();

      // Ensure storage bucket exists
      const { data: buckets } = await supabase.storage.listBuckets();
      if (!buckets?.find((b: any) => b.name === 'scalesafe-files')) {
        await supabase.storage.createBucket('scalesafe-files', {
          public: true,
          fileSizeLimit: 5242880,
          allowedMimeTypes: ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'],
        });
      }

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('scalesafe-files')
        .upload(storagePath, file.buffer, {
          contentType: file.mimetype,
          upsert: true,
        });

      if (uploadError) {
        logger.error({ err: uploadError, storagePath, mimetype: file.mimetype }, 'Logo upload failed');
        throw uploadError;
      }

      logger.info({ storagePath, uploadData }, 'Logo uploaded successfully');

      const { data: urlData } = supabase.storage
        .from('scalesafe-files')
        .getPublicUrl(storagePath);

      const logoUrl = urlData.publicUrl;
      logger.info({ logoUrl }, 'Logo public URL generated');

      // Save to merchant record
      await merchantService.updateFullConfig(locationId, { logoUrl });

      res.json({ logoUrl, storagePath });
    } catch (err) { next(err); }
  },
};
