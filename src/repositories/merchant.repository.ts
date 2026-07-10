import { getSupabase } from '../clients/supabase.client';
import { NotFoundError } from '../utils/errors';
import crypto from 'crypto';
import { encrypt } from '../utils/field-encryption';

export interface MerchantRecord {
  id: string;
  location_id: string;
  company_id: string | null;
  ghl_access_token: string | null;
  ghl_refresh_token: string | null;
  ghl_access_token_encrypted: string | null;
  ghl_refresh_token_encrypted: string | null;
  ghl_token_expires_at: string | null;
  ghl_scopes: string | null;
  business_name: string | null;
  support_email: string | null;
  config: Record<string, unknown>;
  module_sessions: boolean;
  module_milestones: boolean;
  module_pulse: boolean;
  module_payments: boolean;
  module_course: boolean;
  dba_name: string | null;
  descriptor: string | null;
  logo_url: string | null;
  industry: string | null;
  onboarding_complete: boolean;
  tc_clause_toggles: Record<string, boolean>;
  custom_value_ids: Record<string, string>;
  snapshot_status: string;
  snapshot_attempts: number;
  trigger_ids: Record<string, string>;
  webhook_secret: string | null;
  // Payment infrastructure (Phase A/D)
  default_processor: string | null;
  stripe_connected: boolean;
  stripe_user_id: string | null;
  payment_provider_registered: boolean;
  provider_api_key: string | null;
  provider_publishable_key: string | null;
  status: string;
  installed_at: string;
  updated_at: string;
}

export const merchantRepository = {
  isMissingEncryptedTokenColumn(error: any): boolean {
    const message = String(error?.message || '');
    return error?.code === '42703' && (
      message.includes('ghl_access_token_encrypted')
      || message.includes('ghl_refresh_token_encrypted')
    );
  },

  encryptTokenUpdates<T extends Record<string, any>>(updates: T): T {
    const next: Record<string, any> = { ...updates };
    // Empty strings (e.g. INSTALL-webhook merchant stubs created before OAuth
    // completes) are stored as-is: encrypting '' and nulling the plaintext
    // column violates the legacy NOT NULL constraint on schemas without
    // migration 088, and an empty token has nothing worth encrypting.
    if (typeof next.ghl_access_token === 'string' && next.ghl_access_token) {
      next.ghl_access_token_encrypted = encrypt(next.ghl_access_token);
      next.ghl_access_token = null;
    }
    if (typeof next.ghl_refresh_token === 'string' && next.ghl_refresh_token) {
      next.ghl_refresh_token_encrypted = encrypt(next.ghl_refresh_token);
      next.ghl_refresh_token = null;
    }
    return next as T;
  },

  async findByLocationId(locationId: string): Promise<MerchantRecord | null> {
    const { data, error } = await getSupabase()
      .from('merchants')
      .select('*')
      .eq('location_id', locationId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data;
  },

  async getByLocationId(locationId: string): Promise<MerchantRecord> {
    const merchant = await this.findByLocationId(locationId);
    if (!merchant) throw new NotFoundError(`Merchant ${locationId}`);
    return merchant;
  },

  async findByCompanyId(companyId: string): Promise<MerchantRecord | null> {
    const { data, error } = await getSupabase()
      .from('merchants')
      .select('*')
      .eq('company_id', companyId)
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data;
  },

  async findByWebhookSecret(secret: string): Promise<MerchantRecord | null> {
    const { data, error } = await getSupabase()
      .from('merchants')
      .select('*')
      .eq('webhook_secret', secret)
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data;
  },

  /**
   * Find ALL merchants for a company. Used for safe disambiguation
   * when SSO payload has companyId but no locationId.
   */
  async findAllByCompanyId(companyId: string): Promise<MerchantRecord[]> {
    const { data, error } = await getSupabase()
      .from('merchants')
      .select('*')
      .eq('company_id', companyId);

    if (error) throw error;
    return data || [];
  },

  async create(data: {
    location_id: string;
    company_id?: string;
    ghl_access_token: string;
    ghl_refresh_token: string;
    ghl_token_expires_at?: string;
    ghl_scopes?: string;
    business_name?: string;
    support_email?: string;
  }): Promise<MerchantRecord> {
    const insertData = this.encryptTokenUpdates(data);
    let { data: merchant, error } = await getSupabase()
      .from('merchants')
      .insert(insertData)
      .select()
      .single();

    if (this.isMissingEncryptedTokenColumn(error)) {
      const legacyResult = await getSupabase()
        .from('merchants')
        .insert(data)
        .select()
        .single();
      merchant = legacyResult.data;
      error = legacyResult.error;
    }

    if (error) throw error;
    return merchant;
  },

  async update(locationId: string, updates: Partial<MerchantRecord>): Promise<MerchantRecord> {
    const safeUpdates = this.encryptTokenUpdates(updates);
    let { data, error } = await getSupabase()
      .from('merchants')
      .update(safeUpdates)
      .eq('location_id', locationId)
      .select()
      .single();

    if (this.isMissingEncryptedTokenColumn(error)) {
      const legacyResult = await getSupabase()
        .from('merchants')
        .update(updates)
        .eq('location_id', locationId)
        .select()
        .single();
      data = legacyResult.data;
      error = legacyResult.error;
    }

    if (error) throw error;
    return data;
  },

  async updateTokens(locationId: string, accessToken: string, refreshToken: string, expiresAt: Date): Promise<void> {
    let { error } = await getSupabase()
      .from('merchants')
      .update(this.encryptTokenUpdates({
        ghl_access_token: accessToken,
        ghl_refresh_token: refreshToken,
        ghl_token_expires_at: expiresAt.toISOString(),
      }))
      .eq('location_id', locationId);

    if (this.isMissingEncryptedTokenColumn(error)) {
      const legacyResult = await getSupabase()
        .from('merchants')
        .update({
          ghl_access_token: accessToken,
          ghl_refresh_token: refreshToken,
          ghl_token_expires_at: expiresAt.toISOString(),
        })
        .eq('location_id', locationId);
      error = legacyResult.error;
    }

    if (error) throw error;
  },

  async updateSnapshotStatus(locationId: string, status: string, errorMsg?: string): Promise<void> {
    const updates: Record<string, unknown> = { snapshot_status: status };
    if (status === 'failed' || status === 'partial') {
      updates.snapshot_error = errorMsg || null;
    } else if (status === 'installed') {
      updates.snapshot_error = null;
    }
    if (status === 'installing') {
      // Increment attempt count
      const merchant = await this.getByLocationId(locationId);
      updates.snapshot_attempts = merchant.snapshot_attempts + 1;
    }

    const { error } = await getSupabase()
      .from('merchants')
      .update(updates)
      .eq('location_id', locationId);

    if (error) throw error;
  },

  async updateTriggerIds(locationId: string, triggerIds: Record<string, string>): Promise<void> {
    const { error } = await getSupabase()
      .from('merchants')
      .update({ trigger_ids: triggerIds })
      .eq('location_id', locationId);

    if (error) throw error;
  },

  generateWebhookSecret(): string {
    return crypto.randomBytes(32).toString('hex');
  },

  async ensureWebhookSecret(locationId: string): Promise<string | null> {
    const merchant = await this.getByLocationId(locationId);
    if (merchant.webhook_secret) return merchant.webhook_secret;

    const secret = this.generateWebhookSecret();
    const { data, error } = await getSupabase()
      .from('merchants')
      .update({ webhook_secret: secret })
      .eq('location_id', locationId)
      .select('webhook_secret')
      .single();

    if (error) throw error;
    return data?.webhook_secret || secret;
  },

  async rotateWebhookSecret(locationId: string): Promise<string> {
    const secret = this.generateWebhookSecret();
    const { data, error } = await getSupabase()
      .from('merchants')
      .update({ webhook_secret: secret })
      .eq('location_id', locationId)
      .select('webhook_secret')
      .single();

    if (error) throw error;
    return data?.webhook_secret || secret;
  },

  async getConfig(locationId: string): Promise<Record<string, unknown>> {
    const merchant = await this.getByLocationId(locationId);
    return merchant.config;
  },

  async updateConfig(locationId: string, config: Record<string, unknown>): Promise<void> {
    const { error } = await getSupabase()
      .from('merchants')
      .update({ config })
      .eq('location_id', locationId);

    if (error) throw error;
  },

  async listActive(): Promise<MerchantRecord[]> {
    const { data, error } = await getSupabase()
      .from('merchants')
      .select('*')
      .eq('status', 'active');

    if (error) throw error;
    return data || [];
  },
};
