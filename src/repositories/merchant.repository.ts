import { getSupabase } from '../clients/supabase.client';
import { NotFoundError } from '../utils/errors';

export interface MerchantRecord {
  id: string;
  location_id: string;
  company_id: string | null;
  ghl_access_token: string;
  ghl_refresh_token: string;
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
  snapshot_status: string;
  snapshot_attempts: number;
  trigger_ids: Record<string, string>;
  status: string;
  installed_at: string;
  updated_at: string;
}

export const merchantRepository = {
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
    const { data: merchant, error } = await getSupabase()
      .from('merchants')
      .insert(data)
      .select()
      .single();

    if (error) throw error;
    return merchant;
  },

  async update(locationId: string, updates: Partial<MerchantRecord>): Promise<MerchantRecord> {
    const { data, error } = await getSupabase()
      .from('merchants')
      .update(updates)
      .eq('location_id', locationId)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async updateTokens(locationId: string, accessToken: string, refreshToken: string, expiresAt: Date): Promise<void> {
    const { error } = await getSupabase()
      .from('merchants')
      .update({
        ghl_access_token: accessToken,
        ghl_refresh_token: refreshToken,
        ghl_token_expires_at: expiresAt.toISOString(),
      })
      .eq('location_id', locationId);

    if (error) throw error;
  },

  async updateSnapshotStatus(locationId: string, status: string, errorMsg?: string): Promise<void> {
    const updates: Record<string, unknown> = { snapshot_status: status };
    if (status === 'failed' && errorMsg) updates.snapshot_error = errorMsg;
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
