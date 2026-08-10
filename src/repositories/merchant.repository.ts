import { getSupabase } from '../clients/supabase.client';
import { NotFoundError } from '../utils/errors';
import crypto from 'crypto';
import { decrypt, encrypt } from '../utils/field-encryption';

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
  marketplace_plan_id: string | null;
  marketplace_plan_key: 'legacy' | 'test' | 'standard' | 'wholepay' | 'unknown';
  marketplace_billing_status: 'unknown' | 'pending' | 'complete' | 'failed';
  marketplace_plan_updated_at: string | null;
  marketplace_billing_updated_at: string | null;
  wholepay_approved_at: string | null;
  wholepay_approved_by: string | null;
  wholepay_approval_revoked_at: string | null;
  wholepay_merchant_reference: string | null;
}

export function merchantHasOAuthCredentials(merchant: Partial<MerchantRecord> | null | undefined): boolean {
  return Boolean(
    merchant?.ghl_access_token_encrypted
    || merchant?.ghl_access_token,
  );
}

interface OAuthInstallRecord {
  location_id: string;
  company_id?: string;
  ghl_access_token: string;
  ghl_refresh_token: string;
  ghl_token_expires_at?: string;
  ghl_scopes?: string;
  business_name?: string;
  config?: Record<string, unknown>;
  marketplace_plan_id?: string;
  marketplace_plan_key?: 'legacy' | 'test' | 'standard' | 'wholepay' | 'unknown';
  marketplace_plan_updated_at?: string;
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
    config?: Record<string, unknown>;
    marketplace_plan_id?: string;
    marketplace_plan_key?: 'legacy' | 'test' | 'standard' | 'wholepay' | 'unknown';
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

  /**
   * Atomically reconcile an OAuth installation with an INSTALL-webhook stub.
   * The lifecycle webhook and OAuth callback can arrive in either order; an
   * upsert avoids a unique-location race that previously surfaced as a false
   * installation failure after the stub had already been created.
   */
  async upsertOAuthInstall(data: OAuthInstallRecord): Promise<MerchantRecord> {
    const row = { ...data, status: 'active' };
    const encryptedRow = this.encryptTokenUpdates(row);
    let merchant: any = null;
    let error: any = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await getSupabase()
        .from('merchants')
        .upsert(encryptedRow, { onConflict: 'location_id' })
        .select()
        .single();
      merchant = result.data;
      error = result.error;
      if (!error || this.isMissingEncryptedTokenColumn(error)) break;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }

    if (this.isMissingEncryptedTokenColumn(error)) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const legacyResult = await getSupabase()
          .from('merchants')
          .upsert(row, { onConflict: 'location_id' })
          .select()
          .single();
        merchant = legacyResult.data;
        error = legacyResult.error;
        if (!error) break;
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
      }
    }

    if (error) throw error;
    return merchant;
  },

  /**
   * Future-location installs may arrive only as a signed GHL INSTALL webhook.
   * Reuse an existing company-scoped authorization from the same company; a
   * location-scoped token is never copied to a sibling sub-account.
   */
  async adoptCompanyAuthorization(locationId: string, companyId: string): Promise<MerchantRecord | null> {
    const existing = await this.findByLocationId(locationId);
    if (existing && merchantHasOAuthCredentials(existing)
      && existing.config?.ghl_token_scope === 'company') {
      return existing;
    }

    const companyMerchants = await this.findAllByCompanyId(companyId);
    const source = companyMerchants.find((merchant) =>
      merchant.location_id !== locationId
      && merchant.status === 'active'
      && merchant.config?.ghl_token_scope === 'company'
      && merchantHasOAuthCredentials(merchant)
      && Boolean(merchant.ghl_refresh_token_encrypted || merchant.ghl_refresh_token));

    if (!source) return null;

    const accessToken = source.ghl_access_token_encrypted
      ? decrypt(source.ghl_access_token_encrypted)
      : source.ghl_access_token || '';
    const refreshToken = source.ghl_refresh_token_encrypted
      ? decrypt(source.ghl_refresh_token_encrypted)
      : source.ghl_refresh_token || '';
    if (!accessToken || !refreshToken) return null;

    return this.upsertOAuthInstall({
      location_id: locationId,
      company_id: companyId,
      ghl_access_token: accessToken,
      ghl_refresh_token: refreshToken,
      ghl_token_expires_at: source.ghl_token_expires_at || undefined,
      ghl_scopes: source.ghl_scopes || undefined,
      business_name: existing?.business_name || undefined,
      config: {
        ...(existing?.config || {}),
        ghl_token_scope: 'company',
        ghl_token_company_id: companyId,
        ghl_token_location_id: null,
        ghl_oauth_adopted_at: new Date().toISOString(),
      },
    });
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
    // Attempt increments are owned by claimProvisioning(), where status and
    // attempt are updated together under a compare-and-set guard.

    const { error } = await getSupabase()
      .from('merchants')
      .update(updates)
      .eq('location_id', locationId);

    if (error) throw error;
  },

  async resetProvisioning(locationId: string): Promise<void> {
    const { error } = await getSupabase()
      .from('merchants')
      .update({
        snapshot_status: 'pending',
        snapshot_attempts: 0,
        snapshot_error: null,
      })
      .eq('location_id', locationId);

    if (error) throw error;
  },

  /** Compare-and-set claim so only one Railway instance provisions a tenant. */
  async claimProvisioning(
    locationId: string,
    staleBefore: Date,
    maxAttempts = 5,
  ): Promise<MerchantRecord | null> {
    const current = await this.getByLocationId(locationId);
    const status = current.snapshot_status || 'pending';
    const attempts = Number(current.snapshot_attempts || 0);
    const allowed = ['pending', 'failed', 'installing', 'partial'].includes(status);
    if (!allowed || attempts >= maxAttempts) return null;

    if (status === 'installing') {
      const updatedAt = current.updated_at ? new Date(current.updated_at) : null;
      if (updatedAt && Number.isFinite(updatedAt.getTime()) && updatedAt >= staleBefore) {
        return null;
      }
    }

    let query: any = getSupabase()
      .from('merchants')
      .update({
        snapshot_status: 'installing',
        snapshot_attempts: attempts + 1,
        snapshot_error: null,
      })
      .eq('location_id', locationId)
      .eq('snapshot_status', status)
      .eq('snapshot_attempts', attempts);

    if (current.updated_at) query = query.eq('updated_at', current.updated_at);
    const { data, error } = await query.select('*').maybeSingle();
    if (error) throw error;
    return data || null;
  },

  async listProvisioningCandidates(limit = 50, maxAttempts = 5): Promise<MerchantRecord[]> {
    const { data, error } = await getSupabase()
      .from('merchants')
      .select('*')
      .eq('status', 'active')
      .in('snapshot_status', ['pending', 'failed', 'installing'])
      .lt('snapshot_attempts', maxAttempts)
      .order('updated_at', { ascending: true })
      .limit(limit);

    if (error) throw error;
    return data || [];
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
