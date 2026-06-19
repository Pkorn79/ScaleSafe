import { getSupabase } from '../clients/supabase.client';
import { merchantRepository } from '../repositories/merchant.repository';
import { encrypt, decrypt } from '../utils/field-encryption';
import { ValidationError, NotFoundError } from '../utils/errors';
import { makeFanbasisClient, FanbasisEnvironment } from '../clients/fanbasis.client';

/**
 * Per-merchant FanBasis credentials (Model B). Parallel to whop-config.service.ts — stored in its
 * own `fanbasis_configs` table, NOT in `processor_configs` (which is the NMI/Stripe ProcessorInterface).
 */

export interface FanbasisConfigRecord {
  id: string;
  merchant_id: string;
  location_id: string;
  creator_handle: string | null;
  creator_id: string | null;
  api_key_encrypted: string;
  webhook_secret_encrypted: string | null;
  environment: FanbasisEnvironment;
  status: string;
  last_verified_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface FanbasisConfigPublic {
  id: string;
  creatorHandle: string;
  creatorId: string;
  environment: FanbasisEnvironment;
  connected: boolean;
  hasApiKey: boolean;
  hasWebhookSecret: boolean;
  status: string;
  lastVerifiedAt: string | null;
  lastError: string | null;
  webhookUrl: string;
}

function webhookUrl(): string {
  const base = (process.env.APP_URL || process.env.PUBLIC_APP_URL || 'https://dashboard.scalesafe.app').replace(/\/+$/, '');
  return `${base}/webhooks/fanbasis`;
}

function toPublic(row: FanbasisConfigRecord | null): FanbasisConfigPublic {
  return {
    id: row?.id || '',
    creatorHandle: row?.creator_handle || '',
    creatorId: row?.creator_id || '',
    environment: row?.environment || 'sandbox',
    connected: !!row,
    hasApiKey: !!row?.api_key_encrypted,
    hasWebhookSecret: !!row?.webhook_secret_encrypted,
    status: row?.status || 'not_configured',
    lastVerifiedAt: row?.last_verified_at || null,
    lastError: row?.last_error || null,
    webhookUrl: webhookUrl(),
  };
}

export const fanbasisConfigService = {
  async get(locationId: string): Promise<FanbasisConfigRecord | null> {
    const { data, error } = await getSupabase()
      .from('fanbasis_configs')
      .select('*')
      .eq('location_id', locationId)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  },

  async getPublic(locationId: string): Promise<FanbasisConfigPublic> {
    return toPublic(await this.get(locationId));
  },

  async getRequired(locationId: string): Promise<FanbasisConfigRecord> {
    const row = await this.get(locationId);
    if (!row) throw new NotFoundError('FanBasis connection');
    return row;
  },

  async upsert(locationId: string, input: {
    creatorHandle?: string;
    creatorId?: string;
    apiKey?: string;
    webhookSecret?: string;
    environment?: FanbasisEnvironment;
  }): Promise<FanbasisConfigPublic> {
    const creatorHandle = String(input.creatorHandle || '').trim();
    const creatorId = String(input.creatorId || '').trim();
    const apiKey = String(input.apiKey || '').trim();
    const environment = input.environment || 'sandbox';
    if (!['production', 'sandbox'].includes(environment)) throw new ValidationError('Invalid FanBasis environment');

    const merchant = await merchantRepository.getByLocationId(locationId);
    const existing = await this.get(locationId);
    if (!apiKey && !existing?.api_key_encrypted) {
      throw new ValidationError('FanBasis API key is required');
    }

    const payload: Record<string, unknown> = {
      merchant_id: merchant.id,
      location_id: locationId,
      creator_handle: creatorHandle || existing?.creator_handle || null,
      creator_id: creatorId || existing?.creator_id || null,
      api_key_encrypted: apiKey ? encrypt(apiKey) : existing?.api_key_encrypted,
      environment,
      status: 'connected',
      last_error: null,
      updated_at: new Date().toISOString(),
    };
    const secret = String(input.webhookSecret || '').trim();
    if (secret) {
      payload.webhook_secret_encrypted = encrypt(secret);
    }

    const { data, error } = await getSupabase()
      .from('fanbasis_configs')
      .upsert(payload, { onConflict: 'merchant_id,location_id' })
      .select('*')
      .single();
    if (error) throw error;
    return toPublic(data);
  },

  async disconnect(locationId: string): Promise<void> {
    const { error } = await getSupabase()
      .from('fanbasis_configs')
      .delete()
      .eq('location_id', locationId);
    if (error) throw error;
  },

  decryptApiKey(row: FanbasisConfigRecord): string {
    return decrypt(row.api_key_encrypted);
  },

  decryptWebhookSecret(row: FanbasisConfigRecord): string | null {
    return row.webhook_secret_encrypted ? decrypt(row.webhook_secret_encrypted) : null;
  },

  async markError(locationId: string, message: string): Promise<void> {
    await getSupabase()
      .from('fanbasis_configs')
      .update({ status: 'error', last_error: message, updated_at: new Date().toISOString() })
      .eq('location_id', locationId);
  },

  async markVerified(locationId: string): Promise<void> {
    await getSupabase()
      .from('fanbasis_configs')
      .update({
        status: 'connected',
        last_error: null,
        last_verified_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('location_id', locationId);
  },

  /**
   * Verify stored credentials against FanBasis. NOTE: the underlying client endpoint is a sandbox-gate
   * item (unconfirmed) — a negative result may be a false negative until the endpoint is confirmed.
   */
  async testConnection(locationId: string): Promise<{ connected: boolean; status?: number; message?: string }> {
    const row = await this.getRequired(locationId);
    const apiKey = this.decryptApiKey(row);
    const client = makeFanbasisClient({ apiKey, environment: row.environment });
    const result = await client.testConnection();
    if (result.ok) {
      await this.markVerified(locationId);
      return { connected: true, status: result.status };
    }
    await this.markError(locationId, result.message || 'FanBasis connection failed');
    return { connected: false, status: result.status, message: result.message };
  },
};
