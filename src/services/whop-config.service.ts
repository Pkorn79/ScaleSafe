import { getSupabase } from '../clients/supabase.client';
import { merchantRepository } from '../repositories/merchant.repository';
import { encrypt, decrypt } from '../utils/field-encryption';
import { ValidationError, NotFoundError } from '../utils/errors';

export type WhopEnvironment = 'production' | 'sandbox';

export interface WhopConfigRecord {
  id: string;
  merchant_id: string;
  location_id: string;
  company_id: string;
  api_key_encrypted: string;
  webhook_secret_encrypted: string | null;
  environment: WhopEnvironment;
  status: string;
  last_verified_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface WhopConfigPublic {
  id: string;
  companyId: string;
  environment: WhopEnvironment;
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
  return `${base}/webhooks/whop`;
}

function toPublic(row: WhopConfigRecord | null): WhopConfigPublic {
  return {
    id: row?.id || '',
    companyId: row?.company_id || '',
    environment: row?.environment || 'production',
    connected: !!row,
    hasApiKey: !!row?.api_key_encrypted,
    hasWebhookSecret: !!row?.webhook_secret_encrypted,
    status: row?.status || 'not_configured',
    lastVerifiedAt: row?.last_verified_at || null,
    lastError: row?.last_error || null,
    webhookUrl: webhookUrl(),
  };
}

export const whopConfigService = {
  async get(locationId: string): Promise<WhopConfigRecord | null> {
    const { data, error } = await getSupabase()
      .from('whop_configs')
      .select('*')
      .eq('location_id', locationId)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  },

  async findByCompanyId(companyId: string): Promise<WhopConfigRecord | null> {
    const { data, error } = await getSupabase()
      .from('whop_configs')
      .select('*')
      .eq('company_id', companyId)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  },

  async getPublic(locationId: string): Promise<WhopConfigPublic> {
    return toPublic(await this.get(locationId));
  },

  async getRequired(locationId: string): Promise<WhopConfigRecord> {
    const row = await this.get(locationId);
    if (!row) throw new NotFoundError('Whop connection');
    return row;
  },

  async upsert(locationId: string, input: {
    companyId: string;
    apiKey?: string;
    webhookSecret?: string;
    environment?: WhopEnvironment;
  }): Promise<WhopConfigPublic> {
    const companyId = String(input.companyId || '').trim();
    const apiKey = String(input.apiKey || '').trim();
    const environment = input.environment || 'production';
    if (!companyId) throw new ValidationError('Whop company ID is required');
    if (!['production', 'sandbox'].includes(environment)) throw new ValidationError('Invalid Whop environment');

    const merchant = await merchantRepository.getByLocationId(locationId);
    const existing = await this.get(locationId);
    if (!apiKey && !existing?.api_key_encrypted) {
      throw new ValidationError('Whop API key is required');
    }

    const payload: Record<string, unknown> = {
      merchant_id: merchant.id,
      location_id: locationId,
      company_id: companyId,
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
      .from('whop_configs')
      .upsert(payload, { onConflict: 'merchant_id,location_id' })
      .select('*')
      .single();
    if (error) throw error;
    return toPublic(data);
  },

  async disconnect(locationId: string): Promise<void> {
    const { error } = await getSupabase()
      .from('whop_configs')
      .delete()
      .eq('location_id', locationId);
    if (error) throw error;
  },

  decryptApiKey(row: WhopConfigRecord): string {
    return decrypt(row.api_key_encrypted);
  },

  decryptWebhookSecret(row: WhopConfigRecord): string | null {
    return row.webhook_secret_encrypted ? decrypt(row.webhook_secret_encrypted) : null;
  },

  async markError(locationId: string, message: string): Promise<void> {
    await getSupabase()
      .from('whop_configs')
      .update({ status: 'error', last_error: message, updated_at: new Date().toISOString() })
      .eq('location_id', locationId);
  },

  async markVerified(locationId: string): Promise<void> {
    await getSupabase()
      .from('whop_configs')
      .update({
        status: 'connected',
        last_error: null,
        last_verified_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('location_id', locationId);
  },
};
