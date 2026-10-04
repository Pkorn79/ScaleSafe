import { getSupabase } from '../clients/supabase.client';
import { AuthenticationError, ConflictError, NotFoundError, ServiceUnavailableError } from '../utils/errors';
import crypto from 'crypto';
import { decrypt, encrypt } from '../utils/field-encryption';
import { LocationIdentityRecord } from '../utils/merchant-location-identity';

export interface MerchantRecord extends LocationIdentityRecord {
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
  test_access_approved_at: string | null;
  test_access_approved_by: string | null;
  test_access_revoked_at: string | null;
  test_access_note: string | null;
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
   * Unique inserts retry against the winning stub; updates merge fresh config
   * under the database row version. A callback cannot override an uninstall.
   */
  async upsertOAuthInstall(
    data: OAuthInstallRecord,
    authorizationStartedAt = new Date().toISOString(),
    installWaitDeadlineMs = Date.now(),
  ): Promise<MerchantRecord> {
    let conflicts = 0;
    while (conflicts < 5) {
      const current = await this.findByLocationId(data.location_id);
      if (current?.company_id && data.company_id && current.company_id !== data.company_id) {
        throw new AuthenticationError('OAuth authorization does not match the installed agency.');
      }
      if (current && !['active', 'uninstalled'].includes(current.status)) {
        throw new AuthenticationError('This ScaleSafe account is not enabled. Contact ScaleSafe support.');
      }
      // A revocation observed while this exchange was in flight must win.
      const uninstalledAt = Date.parse(String(
        current?.config?.ghl_last_uninstalled_at || current?.config?.ghl_uninstalled_at || '',
      ));
      if (Number.isFinite(uninstalledAt) && uninstalledAt >= Date.parse(authorizationStartedAt)) {
        throw new AuthenticationError('Installation changed during authorization. Contact ScaleSafe support to complete the connection.');
      }
      // Native callbacks have no trustworthy issuance time. Keep the exchange
      // in memory briefly while an earlier revocation awaits a signed INSTALL;
      // do not exchange the one-use code again or make the revoked row active.
      // The deadline is shared by all targets in one callback, not per target.
      if (current?.status === 'uninstalled') {
        const remainingMs = installWaitDeadlineMs - Date.now();
        if (remainingMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, Math.min(250, remainingMs)));
          continue;
        }
        throw new ConflictError('ScaleSafe has not received confirmation of a new installation. Contact ScaleSafe support; do not uninstall again or reload this authorization link.');
      }
      const row = {
        ...data,
        status: 'active',
        config: { ...(current?.config || {}), ...(data.config || {}) },
      };
      if (current) {
        const saved = await this.updateIfUnchanged(current, { ...row, business_name: current.business_name });
        if (saved) return saved;
      } else {
        try {
          return await this.create(row);
        } catch (error: any) {
          // An INSTALL stub won the insert race. Reload and merge its metadata.
          if (error?.code !== '23505') throw error;
        }
      }
      conflicts++;
    }
    throw new ServiceUnavailableError('Installation changed during authorization. Please retry the connection.');
  },

  /** Database-guarded write; never apply a patch derived from an obsolete read. */
  async updateIfUnchanged(
    current: MerchantRecord,
    updates: Partial<MerchantRecord>,
  ): Promise<MerchantRecord | null> {
    if (!current.updated_at) throw new ServiceUnavailableError('Installation version is unavailable.');
    const write = (patch: Partial<MerchantRecord>) => getSupabase()
      .from('merchants')
      .update(patch)
      .eq('location_id', current.location_id)
      .eq('status', current.status)
      .eq('updated_at', current.updated_at)
      .select('*')
      .maybeSingle();
    let result = await write(this.encryptTokenUpdates(updates));
    if (this.isMissingEncryptedTokenColumn(result.error)) result = await write(updates);
    if (result.error) throw result.error;
    return result.data || null;
  },

  /**
   * Future-location installs may arrive only as a signed GHL INSTALL webhook.
   * Reuse an existing company-scoped authorization from the same company; a
   * location-scoped token is never copied to a sibling sub-account.
   */
  async adoptCompanyAuthorization(locationId: string, companyId: string): Promise<MerchantRecord | null> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const existing = await this.findByLocationId(locationId);
      // Adoption only completes a verified active installation. It cannot create
      // one, revive an uninstall, or replace a location-scoped direct callback.
      if (!existing || existing.status !== 'active' || existing.company_id !== companyId) return null;
      if (merchantHasOAuthCredentials(existing)) {
        return existing;
      }

      const companyMerchants = await this.findAllByCompanyId(companyId);
      const source = companyMerchants.find((merchant) =>
        merchant.location_id !== locationId
        && merchant.company_id === companyId
        && merchant.status === 'active'
        && merchant.config?.ghl_token_scope === 'company'
        && merchant.config?.ghl_token_company_id === companyId
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

      const saved = await this.updateIfUnchanged(existing, {
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
      if (saved) return saved;
    }
    throw new ServiceUnavailableError('Installation changed while connecting the agency authorization.');
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

  async writeLocationIdentity(
    current: MerchantRecord,
    patch: Pick<LocationIdentityRecord, 'ghl_location_name' | 'ghl_location_name_source' | 'ghl_location_name_verified_at' | 'ghl_location_name_checked_at' | 'ghl_location_name_error' | 'ghl_location_name_refresh_id'>,
  ): Promise<boolean> {
    // A concurrent authorization, uninstall, approval, or newer lookup wins.
    const { data, error } = await getSupabase().from('merchants').update(patch)
      .eq('location_id', current.location_id).eq('updated_at', current.updated_at)
      .select('location_id').maybeSingle();
    if (error) throw error;
    return Boolean(data);
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
