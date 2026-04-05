import crypto from 'crypto';
import { getSupabase } from '../clients/supabase.client';
import { ProcessorType, ProcessorConfig } from '../types/processor.types';
import { ProcessorError } from '../errors/processor.error';
import { logger } from '../utils/logger';

// ============================================================
// Encryption helpers (AES-256-GCM)
// ============================================================

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const key = process.env.PROCESSOR_ENCRYPTION_KEY;
  if (!key) {
    throw new Error('PROCESSOR_ENCRYPTION_KEY environment variable is not set');
  }
  // Key must be 32 bytes (256 bits). Accept hex-encoded (64 chars) or base64.
  if (key.length === 64 && /^[0-9a-fA-F]+$/.test(key)) {
    return Buffer.from(key, 'hex');
  }
  const buf = Buffer.from(key, 'base64');
  if (buf.length !== 32) {
    throw new Error('PROCESSOR_ENCRYPTION_KEY must be 32 bytes (64 hex chars or 44 base64 chars)');
  }
  return buf;
}

export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Format: base64(iv + authTag + ciphertext)
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

export function decrypt(ciphertext: string): string {
  const key = getEncryptionKey();
  const data = Buffer.from(ciphertext, 'base64');
  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted) + decipher.final('utf8');
}

// ============================================================
// CRUD operations
// ============================================================

export interface CreateNmiConfigInput {
  merchantId: string;
  locationId: string;
  label?: string;
  securityKey: string; // plaintext — will be encrypted
  tokenizationKey: string;
  processorId?: string; // for multi-MID
  isDefault?: boolean;
}

export interface CreateStripeConfigInput {
  merchantId: string;
  locationId: string;
  label?: string;
  stripeUserId: string; // Connected account ID (acct_xxx) — NOT a secret
  webhookEndpointId?: string;
  isDefault?: boolean;
}

export const processorConfigService = {
  /**
   * Create an NMI processor config for a merchant.
   */
  async createNmiConfig(input: CreateNmiConfigInput): Promise<ProcessorConfig> {
    const supabase = getSupabase();

    // If this is set as default, clear other NMI defaults for this merchant
    if (input.isDefault) {
      await this.clearDefaults(input.merchantId, 'nmi');
    }

    const { data, error } = await supabase
      .from('processor_configs')
      .insert({
        merchant_id: input.merchantId,
        location_id: input.locationId,
        processor_type: 'nmi',
        label: input.label || 'NMI Account',
        nmi_security_key_encrypted: encrypt(input.securityKey),
        nmi_tokenization_key: input.tokenizationKey,
        nmi_processor_id: input.processorId || null,
        is_default: input.isDefault ?? true,
      })
      .select('*')
      .single();

    if (error) {
      throw new ProcessorError(
        `Failed to create NMI config: ${error.message}`,
        'nmi',
        error.code,
      );
    }

    logger.info(
      { merchantId: input.merchantId, configId: data.id },
      'NMI processor config created',
    );

    return data as ProcessorConfig;
  },

  /**
   * Create a Stripe Connect processor config for a merchant.
   * A merchant can have at most one Stripe config.
   * Note: stripe_user_id is NOT a secret — stored unencrypted.
   * No access_token/refresh_token needed for Standard connected accounts.
   */
  async createStripeConfig(input: CreateStripeConfigInput): Promise<ProcessorConfig> {
    const supabase = getSupabase();

    // Upsert: if a Stripe config already exists, update it
    const { data, error } = await supabase
      .from('processor_configs')
      .upsert(
        {
          merchant_id: input.merchantId,
          location_id: input.locationId,
          processor_type: 'stripe',
          label: input.label || 'Stripe Connect',
          stripe_user_id: input.stripeUserId,
          stripe_webhook_endpoint_id: input.webhookEndpointId || null,
          is_active: true,
          is_default: input.isDefault ?? true,
        },
        { onConflict: 'merchant_id,processor_type,nmi_processor_id' },
      )
      .select('*')
      .single();

    if (error) {
      throw new ProcessorError(
        `Failed to create Stripe config: ${error.message}`,
        'stripe',
        error.code,
      );
    }

    // Also update the merchant record
    await supabase
      .from('merchants')
      .update({
        stripe_connected: true,
        stripe_user_id: input.stripeUserId,
      })
      .eq('id', input.merchantId);

    logger.info(
      { merchantId: input.merchantId, configId: data.id },
      'Stripe processor config created',
    );

    return data as ProcessorConfig;
  },

  /**
   * Get the active config for a merchant + processor type.
   * For NMI with multi-MID, optionally specify processorId.
   */
  async getConfig(
    merchantId: string,
    processorType: ProcessorType,
    processorId?: string,
  ): Promise<ProcessorConfig | null> {
    const supabase = getSupabase();

    let query = supabase
      .from('processor_configs')
      .select('*')
      .eq('merchant_id', merchantId)
      .eq('processor_type', processorType)
      .eq('is_active', true);

    if (processorType === 'nmi' && processorId) {
      query = query.eq('nmi_processor_id', processorId);
    } else {
      query = query.eq('is_default', true);
    }

    const { data, error } = await query.single();

    if (error || !data) return null;
    return data as ProcessorConfig;
  },

  /**
   * List all processor configs for a merchant.
   */
  async listConfigs(merchantId: string): Promise<ProcessorConfig[]> {
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('processor_configs')
      .select('*')
      .eq('merchant_id', merchantId)
      .order('processor_type')
      .order('is_default', { ascending: false });

    if (error) {
      throw new ProcessorError(
        `Failed to list configs: ${error.message}`,
        'nmi',
        error.code,
      );
    }

    return (data || []) as ProcessorConfig[];
  },

  /**
   * Update Stripe tokens (e.g., after a token refresh).
   */
  async updateStripeTokens(
    configId: string,
    accessToken: string,
    refreshToken: string,
    expiresAt?: string,
  ): Promise<void> {
    const supabase = getSupabase();

    const { error } = await supabase
      .from('processor_configs')
      .update({
        stripe_access_token_encrypted: encrypt(accessToken),
        stripe_refresh_token_encrypted: encrypt(refreshToken),
        stripe_token_expires_at: expiresAt || null,
      })
      .eq('id', configId);

    if (error) {
      throw new ProcessorError(
        `Failed to update Stripe tokens: ${error.message}`,
        'stripe',
        error.code,
      );
    }
  },

  /**
   * Mark a config as verified (successful test connection).
   */
  async markVerified(configId: string): Promise<void> {
    const supabase = getSupabase();

    await supabase
      .from('processor_configs')
      .update({ last_verified_at: new Date().toISOString() })
      .eq('id', configId);
  },

  /**
   * Deactivate a processor config.
   */
  async deactivate(configId: string): Promise<void> {
    const supabase = getSupabase();

    await supabase
      .from('processor_configs')
      .update({ is_active: false })
      .eq('id', configId);
  },

  /**
   * Delete a processor config.
   */
  async deleteConfig(configId: string): Promise<void> {
    const supabase = getSupabase();

    const { error } = await supabase
      .from('processor_configs')
      .delete()
      .eq('id', configId);

    if (error) {
      throw new ProcessorError(
        `Failed to delete config: ${error.message}`,
        'nmi',
        error.code,
      );
    }
  },

  /**
   * Set a config as the default for its processor type, clearing other defaults.
   */
  async setDefault(configId: string): Promise<void> {
    const supabase = getSupabase();

    // Look up the config to get merchant_id and processor_type
    const { data: config, error } = await supabase
      .from('processor_configs')
      .select('merchant_id, processor_type')
      .eq('id', configId)
      .single();

    if (error || !config) {
      throw new ProcessorError(
        'Config not found',
        'nmi',
        'CONFIG_NOT_FOUND',
      );
    }

    await this.clearDefaults(config.merchant_id, config.processor_type);

    await supabase
      .from('processor_configs')
      .update({ is_default: true })
      .eq('id', configId);
  },

  /**
   * Decrypt the NMI security key from a config row.
   */
  decryptNmiSecurityKey(config: ProcessorConfig): string {
    if (!config.nmi_security_key_encrypted) {
      throw new ProcessorError(
        'No encrypted NMI security key in config',
        'nmi',
        'MISSING_KEY',
      );
    }
    return decrypt(config.nmi_security_key_encrypted);
  },

  /**
   * Decrypt the Stripe access token from a config row.
   */
  decryptStripeAccessToken(config: ProcessorConfig): string {
    if (!config.stripe_access_token_encrypted) {
      throw new ProcessorError(
        'No encrypted Stripe access token in config',
        'stripe',
        'MISSING_TOKEN',
      );
    }
    return decrypt(config.stripe_access_token_encrypted);
  },

  /**
   * Decrypt the Stripe refresh token from a config row.
   */
  decryptStripeRefreshToken(config: ProcessorConfig): string {
    if (!config.stripe_refresh_token_encrypted) {
      throw new ProcessorError(
        'No encrypted Stripe refresh token in config',
        'stripe',
        'MISSING_TOKEN',
      );
    }
    return decrypt(config.stripe_refresh_token_encrypted);
  },

  // -- Internal helpers --

  async clearDefaults(merchantId: string, processorType: ProcessorType): Promise<void> {
    const supabase = getSupabase();

    await supabase
      .from('processor_configs')
      .update({ is_default: false })
      .eq('merchant_id', merchantId)
      .eq('processor_type', processorType);
  },
};
