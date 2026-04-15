import { Request, Response, NextFunction } from 'express';
import { processorConfigService } from '../services/processor-config.service';
import { merchantRepository } from '../repositories/merchant.repository';
import { resolveLocationId } from '../middleware/tenantContext';
import { ValidationError } from '../utils/errors';
import { NmiClient } from '../clients/nmi.client';
import { getSupabase } from '../clients/supabase.client';
import { logger } from '../utils/logger';

/**
 * Processor connection management for the Settings page.
 *
 * NMI is connected via direct credential entry (security key + tokenization key).
 * Stripe is connected via the OAuth flow at src/routes/stripe-connect.routes.ts —
 * those endpoints already exist and aren't duplicated here.
 *
 * Both processors can be active simultaneously per merchant. When both are
 * connected, processor.factory.ts:resolveProcessor() reads merchants.default_processor
 * to choose which rail handles a given charge (with offer-level override support).
 */
export const processorConfigController = {
  /** POST /api/processor-config/nmi — store NMI credentials for this merchant */
  async createNmi(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');

      const { securityKey, tokenizationKey, processorId } = req.body || {};
      if (!securityKey || !tokenizationKey) {
        throw new ValidationError('securityKey and tokenizationKey are required');
      }
      if (typeof securityKey !== 'string' || typeof tokenizationKey !== 'string') {
        throw new ValidationError('securityKey and tokenizationKey must be strings');
      }

      const merchant = await merchantRepository.getByLocationId(locationId);
      const config = await processorConfigService.createNmiConfig({
        merchantId: merchant.id,
        locationId,
        securityKey,
        tokenizationKey,
        processorId: typeof processorId === 'string' && processorId ? processorId : undefined,
        isDefault: true, // first NMI config is default; setDefaultProcessor endpoint can change later
      });

      logger.info({ merchantId: merchant.id, locationId, configId: config.id }, 'NMI config created via Settings');

      // Don't echo the encrypted security key back to the client
      res.json({
        id: config.id,
        processor_type: config.processor_type,
        nmi_processor_id: config.nmi_processor_id,
        is_default: config.is_default,
        is_active: config.is_active,
        created_at: config.created_at,
      });
    } catch (err) { next(err); }
  },

  /**
   * POST /api/processor-config/nmi/test
   * Validate NMI credentials against the live NMI API without persisting.
   * Used by the Test Connection button in the Settings page.
   */
  async testNmi(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');

      const { securityKey, tokenizationKey, processorId } = req.body || {};
      if (!securityKey || !tokenizationKey) {
        throw new ValidationError('securityKey and tokenizationKey are required');
      }

      // One-shot client — never persisted
      const client = new NmiClient({
        securityKey,
        tokenizationKey,
        processorId: typeof processorId === 'string' && processorId ? processorId : undefined,
      });
      const result = await client.testConnection();

      logger.info({ locationId, success: result.success }, 'NMI test connection');
      res.json(result);
    } catch (err) { next(err); }
  },

  /**
   * DELETE /api/processor-config/nmi
   * Soft-disconnect: deactivate all NMI processor configs for this merchant.
   * If merchants.default_processor pointed at NMI, clear it.
   */
  async disconnectNmi(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');

      const merchant = await merchantRepository.getByLocationId(locationId);
      const supabase = getSupabase();

      const { data: configs } = await supabase
        .from('processor_configs')
        .select('id')
        .eq('merchant_id', merchant.id)
        .eq('processor_type', 'nmi')
        .eq('is_active', true);

      let deactivated = 0;
      for (const c of (configs || [])) {
        await processorConfigService.deactivate(c.id);
        deactivated++;
      }

      if ((merchant as any).default_processor === 'nmi') {
        await supabase.from('merchants')
          .update({ default_processor: null })
          .eq('id', merchant.id);
      }

      logger.info({ merchantId: merchant.id, locationId, deactivated }, 'NMI disconnected via Settings');
      res.json({ success: true, deactivated });
    } catch (err) { next(err); }
  },

  /**
   * POST /api/processor-config/default
   * Set merchants.default_processor for this merchant. Required when both NMI
   * and Stripe are connected so processor.factory.ts:resolveProcessor() knows
   * which rail to use by default. Validates that the chosen processor is
   * actually connected before writing.
   */
  async setDefaultProcessor(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');

      const { processor } = req.body || {};
      if (!['nmi', 'stripe'].includes(processor)) {
        throw new ValidationError('processor must be "nmi" or "stripe"');
      }

      const merchant = await merchantRepository.getByLocationId(locationId);
      const supabase = getSupabase();

      const { data: existing } = await supabase
        .from('processor_configs')
        .select('id')
        .eq('merchant_id', merchant.id)
        .eq('processor_type', processor)
        .eq('is_active', true)
        .limit(1);

      if (!existing || existing.length === 0) {
        throw new ValidationError(`${processor} is not connected for this merchant. Connect it first.`);
      }

      await supabase.from('merchants')
        .update({ default_processor: processor })
        .eq('id', merchant.id);

      logger.info({ merchantId: merchant.id, locationId, defaultProcessor: processor }, 'Default processor set');
      res.json({ success: true, defaultProcessor: processor });
    } catch (err) { next(err); }
  },
};
