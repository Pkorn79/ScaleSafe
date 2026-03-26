/**
 * merchant.repository.ts — Merchant Data Access Layer
 *
 * All database operations for the merchants table.
 * This is the only place that directly queries Supabase for merchant data.
 * Also implements the TokenStore interface so the GHL client can persist tokens.
 *
 * Every query includes location_id for multi-tenant isolation.
 */

import { getSupabaseClient } from '../clients/supabase.client';
import { TokenStore, GhlTokenData } from '../clients/ghl.client';
import { logger } from '../utils/logger';
import { NotFoundError } from '../utils/errors';

/** Shape of a merchant row in Supabase. */
export interface MerchantRow {
  id: string;
  location_id: string;
  company_id: string | null;
  ghl_access_token: string;
  ghl_refresh_token: string;
  ghl_token_expires_at: string | null;
  ab_api_key: string | null;
  ab_tokenization_key: string | null;
  ab_webhook_secret: string | null;
  business_name: string | null;
  dba_name: string | null;
  support_email: string | null;
  descriptor: string | null;
  logo_url: string | null;
  industry: string | null;
  module_sessions: boolean;
  module_milestones: boolean;
  module_pulse: boolean;
  module_payments: boolean;
  module_course: boolean;
  incentive_enabled: boolean;
  incentive_tier1_desc: string | null;
  incentive_tier1_threshold: number | null;
  incentive_tier2_desc: string | null;
  incentive_tier2_threshold: number | null;
  status: string;
  installed_at: string;
}

/** Finds a merchant by their GHL location ID. */
export async function findByLocationId(locationId: string): Promise<MerchantRow | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('merchants')
    .select('*')
    .eq('location_id', locationId)
    .single();

  if (error && error.code !== 'PGRST116') {
    // PGRST116 = "no rows returned" — not an error, just means merchant doesn't exist
    logger.error({ error, locationId }, 'Error fetching merchant');
    throw error;
  }

  return data;
}

/** Creates or updates a merchant record (upsert on location_id). */
export async function upsert(merchant: Partial<MerchantRow> & { location_id: string }): Promise<MerchantRow> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('merchants')
    .upsert(merchant, { onConflict: 'location_id' })
    .select()
    .single();

  if (error) {
    logger.error({ error, locationId: merchant.location_id }, 'Error upserting merchant');
    throw error;
  }

  return data;
}

/** Updates specific fields on a merchant record. */
export async function update(
  locationId: string,
  updates: Partial<MerchantRow>
): Promise<MerchantRow> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('merchants')
    .update(updates)
    .eq('location_id', locationId)
    .select()
    .single();

  if (error) {
    logger.error({ error, locationId }, 'Error updating merchant');
    throw error;
  }

  if (!data) {
    throw new NotFoundError(`Merchant not found: ${locationId}`);
  }

  return data;
}

/**
 * TokenStore implementation for the GHL client.
 * Allows the GHL client to read/write OAuth tokens from Supabase
 * without knowing about Supabase directly.
 */
export const tokenStore: TokenStore = {
  /** Gets the current access and refresh tokens for a resource (location or company). */
  async getTokens(resourceId: string) {
    const merchant = await findByLocationId(resourceId);
    if (!merchant) return null;
    return {
      accessToken: merchant.ghl_access_token,
      refreshToken: merchant.ghl_refresh_token,
    };
  },

  /** Saves tokens from an initial OAuth exchange (creates or updates the merchant). */
  async saveTokens(resourceId: string, data: GhlTokenData) {
    await upsert({
      location_id: data.locationId || resourceId,
      company_id: data.companyId || null,
      ghl_access_token: data.access_token,
      ghl_refresh_token: data.refresh_token,
      ghl_token_expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
      status: 'active',
    });
  },

  /** Updates tokens after a refresh (doesn't change other merchant fields). */
  async updateTokens(resourceId: string, accessToken: string, refreshToken: string) {
    await update(resourceId, {
      ghl_access_token: accessToken,
      ghl_refresh_token: refreshToken,
    });
  },
};
