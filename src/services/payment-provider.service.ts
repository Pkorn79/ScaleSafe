import crypto from 'crypto';
import { ghlApi } from '../clients/ghl.client';
import { getSupabase } from '../clients/supabase.client';
import { config } from '../config';
import { logger } from '../utils/logger';

export const paymentProviderService = {
  /**
   * Register ScaleSafe as the custom payment provider on a merchant's GHL location.
   */
  async registerProvider(locationId: string): Promise<void> {
    const api = await ghlApi(locationId);

    try {
      await api.post('/payments/custom-provider/provider', {
        name: 'ScaleSafe',
        description: 'Secure payment processing with evidence capture for high-ticket businesses',
        imageUrl: `${config.appUrl}/logo.png`,
        locationId,
        queryUrl: `${config.appUrl}/api/payments/query`,
        paymentsUrl: `${config.appUrl}/checkout`,
      });

      logger.info({ locationId }, 'Registered as custom payment provider in GHL');
    } catch (err: any) {
      // 409 = already registered, which is fine
      if (err.response?.status === 409) {
        logger.info({ locationId }, 'Payment provider already registered');
        return;
      }
      logger.error({ err: err.message, locationId }, 'Failed to register payment provider');
      throw err;
    }
  },

  /**
   * Generate and store a unique API key pair for this merchant-location.
   */
  async generateProviderApiKey(locationId: string): Promise<{ apiKey: string; publishableKey: string }> {
    const apiKey = `ss_live_${crypto.randomBytes(24).toString('hex')}`;
    const publishableKey = `ss_pub_${crypto.randomBytes(16).toString('hex')}`;

    const supabase = getSupabase();
    const { error } = await supabase
      .from('merchants')
      .update({
        provider_api_key: apiKey,
        provider_publishable_key: publishableKey,
      })
      .eq('location_id', locationId);

    if (error) {
      logger.error({ err: error, locationId }, 'Failed to store provider API keys');
      throw error;
    }

    logger.info({ locationId }, 'Provider API keys generated');
    return { apiKey, publishableKey };
  },

  /**
   * Ensure this merchant has a stable provider API key pair without rotating
   * existing credentials. Used by provisioning repair flows.
   */
  async ensureProviderApiKey(locationId: string): Promise<{ apiKey: string; publishableKey: string }> {
    const supabase = getSupabase();
    const { data: merchant, error } = await supabase
      .from('merchants')
      .select('provider_api_key, provider_publishable_key')
      .eq('location_id', locationId)
      .single();

    if (error) throw error;
    if (merchant?.provider_api_key && merchant?.provider_publishable_key) {
      return {
        apiKey: merchant.provider_api_key,
        publishableKey: merchant.provider_publishable_key,
      };
    }

    return this.generateProviderApiKey(locationId);
  },

  /**
   * Submit credentials to GHL so the provider is marked as connected.
   * Called after merchant connects a processor (NMI or Stripe).
   */
  async connectConfig(locationId: string): Promise<void> {
    const supabase = getSupabase();
    const { data: merchant, error } = await supabase
      .from('merchants')
      .select('provider_api_key, provider_publishable_key')
      .eq('location_id', locationId)
      .single();

    if (error || !merchant?.provider_api_key) {
      throw new Error(`No provider API key found for ${locationId}`);
    }

    const api = await ghlApi(locationId);

    await api.post('/payments/custom-provider/connect', {
      locationId,
      live: {
        apiKey: merchant.provider_api_key,
        publishableKey: merchant.provider_publishable_key,
      },
    });

    // Mark merchant as payment provider registered
    await supabase
      .from('merchants')
      .update({ payment_provider_registered: true })
      .eq('location_id', locationId);

    logger.info({ locationId }, 'Provider config connected with GHL');
  },

  async repairProvider(locationId: string): Promise<void> {
    await this.registerProvider(locationId);
    await this.ensureProviderApiKey(locationId);
    await this.connectConfig(locationId);
  },

  /**
   * Delete the provider registration (on app uninstall).
   */
  async deleteProvider(locationId: string): Promise<void> {
    try {
      const api = await ghlApi(locationId);
      await api.delete('/payments/custom-provider/provider', {
        data: { locationId },
      });
      logger.info({ locationId }, 'Payment provider deleted from GHL');
    } catch (err: any) {
      logger.warn({ err: err.message, locationId }, 'Failed to delete payment provider');
    }
  },

  /**
   * Look up merchant by their ScaleSafe API key.
   */
  async getMerchantByApiKey(apiKey: string): Promise<{ merchantId: string; locationId: string } | null> {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('merchants')
      .select('id, location_id')
      .eq('provider_api_key', apiKey)
      .eq('status', 'active')
      .single();

    if (error || !data) return null;
    return { merchantId: data.id, locationId: data.location_id };
  },

  /**
   * Look up merchant by their ScaleSafe publishable key.
   * Used by checkout page to identify merchant.
   */
  async getMerchantByPublishableKey(publishableKey: string): Promise<{ merchantId: string; locationId: string } | null> {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('merchants')
      .select('id, location_id')
      .eq('provider_publishable_key', publishableKey)
      .eq('status', 'active')
      .single();

    if (error || !data) return null;
    return { merchantId: data.id, locationId: data.location_id };
  },
};
