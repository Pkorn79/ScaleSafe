import { Request, Response, NextFunction } from 'express';
import { offerService } from '../services/offer.service';
import { merchantService } from '../services/merchant.service';
import { config } from '../config';
import { resolveLocationId } from '../middleware/tenantContext';
import { ValidationError } from '../utils/errors';
import { dualPricingService } from '../services/dual-pricing.service';
import { logger } from '../utils/logger';
import { offerEvidenceIntegrationService } from '../services/offer-evidence-integration.service';
import { merchantRepository } from '../repositories/merchant.repository';
import { assertNewProcessorActivityAllowed } from '../services/marketplace-entitlement.service';

function actor(req: Request): string {
  return req.tenantContext?.email || req.tenantContext?.userId || 'merchant_offer_editor';
}

async function assertOfferProcessorAllowed(
  locationId: string,
  input: Record<string, any>,
  existing?: Record<string, any>,
): Promise<void> {
  const checkoutType = input.checkoutType ?? existing?.checkout_type ?? 'direct';
  if (checkoutType === 'whop') {
    await assertNewProcessorActivityAllowed(locationId, 'whop');
    return;
  }
  const override = input.processorOverride !== undefined
    ? input.processorOverride
    : existing?.processor_override;
  if (override === 'nmi' || override === 'stripe') {
    await assertNewProcessorActivityAllowed(locationId, override);
    return;
  }
  const merchant = await merchantRepository.getByLocationId(locationId);
  if (merchant.default_processor === 'nmi' || merchant.default_processor === 'stripe') {
    await assertNewProcessorActivityAllowed(locationId, merchant.default_processor);
  }
}

export const offerController = {
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');

      const { offerName } = req.body;
      if (!offerName) throw new ValidationError('offerName required');

      await assertOfferProcessorAllowed(locationId, req.body || {});
      const offer = await offerService.create({ ...req.body, locationId });
      res.status(201).json(offer);
    } catch (err) { next(err); }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');

      const offer = await offerService.getById(req.params.id, locationId);
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

  async dualPricingConfig(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');
      const control = await dualPricingService.getActiveControl(locationId);
      res.json({
        enabled: !!control,
        locationScoped: !!control?.location_id,
        cardUpliftPercent: control?.card_uplift_percent || 0,
        processorDeductionPercent: control?.processor_deduction_percent || 0,
        enabledProcessors: control?.enabled_processors || [],
        effectiveAt: control?.effective_at || null,
      });
    } catch (err) { next(err); }
  },

  async updateDualPricingConfig(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');
      const control = await dualPricingService.saveLocationControl(locationId, {
        cardUpliftPercent: req.body?.cardUpliftPercent,
        enabledProcessors: req.body?.enabledProcessors,
        updatedBy: 'settings',
      });
      res.json({
        enabled: true,
        locationScoped: true,
        cardUpliftPercent: control.card_uplift_percent,
        processorDeductionPercent: control.processor_deduction_percent,
        enabledProcessors: control.enabled_processors,
        effectiveAt: control.effective_at,
      });
    } catch (err) { next(err); }
  },

  async quote(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');
      const { offerId, paymentChoice, paymentMethod } = req.body;
      if (!offerId) throw new ValidationError('offerId required');
      const offer = await offerService.getById(String(offerId), locationId);
      const quote = await dualPricingService.quoteOffer(
        offer,
        paymentChoice,
        paymentMethod === 'ach' ? 'ach' : 'card',
      );
      res.json(quote);
    } catch (err) { next(err); }
  },

  async getEvidenceIntegration(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');
      const integration = await offerEvidenceIntegrationService.get(locationId, req.params.id);
      res.json({ integration });
    } catch (err) { next(err); }
  },

  async updateEvidenceIntegration(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');
      const integration = await offerEvidenceIntegrationService.save(locationId, req.params.id, actor(req), req.body || {});
      res.json({ integration });
    } catch (err) { next(err); }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');
      const existing = await offerService.getById(req.params.id, locationId);
      await assertOfferProcessorAllowed(locationId, req.body || {}, existing as any);
      const offer = await offerService.update(req.params.id, locationId, req.body);
      res.json(offer);
    } catch (err) { next(err); }
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');
      await offerService.delete(req.params.id, locationId);
      res.status(204).end();
    } catch (err) { next(err); }
  },

  async getEnrollmentLink(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');
      const offer = await offerService.getById(req.params.id, locationId);
      await assertOfferProcessorAllowed(locationId, {}, offer as any);
      const appBaseUrl = config.appUrl;

      // Read the merchant's funnel URL from config
      let funnelBaseUrl = '';
      if (locationId) {
        try {
          const mc = await merchantService.getFullConfig(locationId);
          funnelBaseUrl = mc.enrollmentFunnelUrl || '';
        } catch (err: any) {
          logger.warn(
            { err: err?.message || String(err), locationId, offerId: req.params.id },
            'Failed to load merchant funnel URL for offer enrollment link',
          );
        }
      }

      const checkoutMode = (offer as any).checkout_mode || 'full_enrollment';
      if (checkoutMode !== 'quick_checkout' && !funnelBaseUrl) {
        res.status(400).json({
          error: 'Full enrollment links require an Enrollment Funnel URL in Settings. Add the merchant funnel URL or switch this offer to Quick Checkout before copying.',
          funnelConfigured: false,
        });
        return;
      }

      const link = offerService.generateEnrollmentLink(offer.id, appBaseUrl, checkoutMode, funnelBaseUrl);
      res.json({ link, funnelConfigured: !!funnelBaseUrl });
    } catch (err) { next(err); }
  },

  async clone(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');

      const source = await offerService.getById(req.params.id, locationId);
      await assertOfferProcessorAllowed(locationId, {}, source as any);
      const offer = await offerService.cloneOffer(req.params.id, locationId);
      res.status(201).json({
        success: true,
        offer,
        message: 'Offer cloned. Edit the copy and activate when ready.',
      });
    } catch (err) { next(err); }
  },
};
