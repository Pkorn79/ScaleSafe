import { Request, Response, NextFunction } from 'express';
import { processorConfigService, nmiWebhookCallbackUrl } from '../services/processor-config.service';
import { assertNewProcessorActivityAllowed } from '../services/marketplace-entitlement.service';
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
  async listNmi(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');

      const merchant = await merchantRepository.getByLocationId(locationId);
      const configs = await processorConfigService.listConfigs(merchant.id);
      const nmiConfigs = configs
        .filter((config) => config.processor_type === 'nmi' && config.is_active)
        .map((config) => ({
          id: config.id,
          label: config.label || 'NMI Account',
          nmiProcessorId: config.nmi_processor_id || '',
          hasSecurityKey: !!config.nmi_security_key_encrypted,
          hasTokenizationKey: !!config.nmi_tokenization_key,
          isDefault: !!config.is_default,
          webhookStatus: config.nmi_webhook_status || 'manual_setup_required',
          webhookCallbackUrl: config.nmi_webhook_callback_url || null,
          webhookAdvancedCallbackUrl: nmiWebhookCallbackUrl(config.id),
          webhookHasKey: !!config.nmi_webhook_secret_encrypted,
          lastVerifiedAt: config.last_verified_at || null,
          createdAt: config.created_at,
        }));

      res.json({ configs: nmiConfigs });
    } catch (err) { next(err); }
  },

  /** POST /api/processor-config/nmi — store NMI credentials for this merchant */
  async createNmi(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');
      await assertNewProcessorActivityAllowed(locationId, 'nmi');

      const { label, securityKey, tokenizationKey, processorId, isDefault } = req.body || {};
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
        label: typeof label === 'string' && label.trim() ? label.trim() : undefined,
        securityKey,
        tokenizationKey,
        processorId: typeof processorId === 'string' && processorId ? processorId : undefined,
        isDefault: typeof isDefault === 'boolean' ? isDefault : undefined,
      });

      logger.info({ merchantId: merchant.id, locationId, configId: config.id }, 'NMI config created via Settings');
      let webhook = null;
      try {
        webhook = await processorConfigService.getOrCreateNmiWebhookConfig(locationId);
      } catch (webhookErr: any) {
        logger.warn({ err: webhookErr?.message, merchantId: merchant.id, locationId, configId: config.id }, 'NMI webhook setup lookup failed after config save');
      }

      // Don't echo the encrypted security key back to the client
      res.json({
        id: config.id,
        label: config.label,
        processor_type: config.processor_type,
        nmi_processor_id: config.nmi_processor_id,
        is_default: config.is_default,
        is_active: config.is_active,
        created_at: config.created_at,
        webhook,
      });
    } catch (err) { next(err); }
  },

  /** GET /api/processor-config/nmi/webhook — setup values for NMI official webhooks */
  async setDefaultNmi(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');
      await assertNewProcessorActivityAllowed(locationId, 'nmi');
      const { id } = req.params;
      if (!id) throw new ValidationError('NMI config id required');

      const merchant = await merchantRepository.getByLocationId(locationId);
      const supabase = getSupabase();
      const { data: config, error } = await supabase
        .from('processor_configs')
        .select('id')
        .eq('id', id)
        .eq('merchant_id', merchant.id)
        .eq('location_id', locationId)
        .eq('processor_type', 'nmi')
        .eq('is_active', true)
        .maybeSingle();

      if (error || !config) {
        throw new ValidationError('NMI route not found for this merchant.');
      }

      await processorConfigService.setDefault(id);
      logger.info({ merchantId: merchant.id, locationId, configId: id }, 'Default NMI route set');
      res.json({ success: true });
    } catch (err) { next(err); }
  },

  async deactivateNmi(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');
      const { id } = req.params;
      if (!id) throw new ValidationError('NMI config id required');

      const merchant = await merchantRepository.getByLocationId(locationId);
      const supabase = getSupabase();
      const { data: config, error } = await supabase
        .from('processor_configs')
        .select('id, is_default')
        .eq('id', id)
        .eq('merchant_id', merchant.id)
        .eq('location_id', locationId)
        .eq('processor_type', 'nmi')
        .eq('is_active', true)
        .maybeSingle();

      if (error || !config) {
        throw new ValidationError('NMI route not found for this merchant.');
      }

      await processorConfigService.deactivate(id);

      if ((config as any).is_default) {
        const { data: fallback } = await supabase
          .from('processor_configs')
          .select('id')
          .eq('merchant_id', merchant.id)
          .eq('location_id', locationId)
          .eq('processor_type', 'nmi')
          .eq('is_active', true)
          .limit(1)
          .maybeSingle();

        if (fallback?.id) {
          await processorConfigService.setDefault(fallback.id);
        } else if ((merchant as any).default_processor === 'nmi') {
          await supabase.from('merchants')
            .update({ default_processor: null })
            .eq('id', merchant.id);
        }
      }

      logger.info({ merchantId: merchant.id, locationId, configId: id }, 'NMI route deactivated');
      res.json({ success: true });
    } catch (err) { next(err); }
  },

  async getNmiWebhook(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');

      const webhook = await processorConfigService.getOrCreateNmiWebhookConfig(locationId);
      res.json(webhook);
    } catch (err) { next(err); }
  },

  /** POST /api/processor-config/nmi/webhook/key — save the NMI-provided webhook key */
  async saveNmiWebhookKey(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = resolveLocationId(req);
      if (!locationId) throw new ValidationError('locationId required');
      const { key } = req.body || {};
      if (typeof key !== 'string' || !key.trim()) {
        throw new ValidationError('NMI webhook key is required');
      }

      const webhook = await processorConfigService.saveNmiWebhookKey(locationId, key);
      res.json(webhook);
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
      await assertNewProcessorActivityAllowed(locationId, 'nmi');

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
      if (processor === 'nmi') {
        await assertNewProcessorActivityAllowed(locationId, 'nmi');
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
