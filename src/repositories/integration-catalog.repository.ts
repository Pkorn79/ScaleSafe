import { getSupabase } from '../clients/supabase.client';

export const integrationCatalogRepository = {
  async listReleases(): Promise<any[]> {
    const { data, error } = await getSupabase()
      .from('evidence_provider_releases')
      .select('*')
      .order('wave')
      .order('provider_key');
    if (error) throw error;
    return data || [];
  },

  async listLocationReleases(locationId: string): Promise<any[]> {
    const { data, error } = await getSupabase()
      .from('evidence_provider_location_releases')
      .select('*')
      .eq('location_id', locationId);
    if (error) throw error;
    return data || [];
  },

  async setLocationRelease(providerKey: string, locationId: string, enabled: boolean, actorLabel: string): Promise<any> {
    const { data, error } = await getSupabase()
      .from('evidence_provider_location_releases')
      .upsert({
        provider_key: providerKey,
        location_id: locationId,
        enabled,
        enabled_by: actorLabel,
        enabled_at: new Date().toISOString(),
      }, { onConflict: 'provider_key,location_id' })
      .select('*')
      .single();
    if (error) throw error;
    return data;
  },

  async listConnections(locationId: string): Promise<any[]> {
    const { data, error } = await getSupabase()
      .from('evidence_connections')
      .select('id, name, source_label, connection_type, status, setup_status, health_status, provider_key, auth_mode, external_account_id, external_account_name, provider_capabilities, last_event_at, last_success_at, last_error_message, created_at')
      .eq('location_id', locationId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async listOfferOptions(locationId: string): Promise<any[]> {
    const { data, error } = await getSupabase()
      .from('evidence_resource_mappings')
      .select('id, connection_id, resource_type, external_resource_id, external_resource_name, offer_id, approval_status, connection:evidence_connections!inner(id, name, provider_key, status, setup_status, provider_capabilities)')
      .eq('location_id', locationId)
      .eq('approval_status', 'approved')
      .eq('connection.status', 'active')
      .eq('connection.setup_status', 'active')
      .order('external_resource_name');
    if (error) throw error;
    return data || [];
  },

  async getPrimaryOfferIntegration(locationId: string, offerId: string): Promise<any | null> {
    const { data, error } = await getSupabase()
      .from('offer_evidence_integrations')
      .select('*')
      .eq('location_id', locationId)
      .eq('offer_id', offerId)
      .eq('is_primary', true)
      .eq('active', true)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  },

  async savePrimaryOfferIntegration(input: Record<string, unknown>): Promise<any> {
    const { data, error } = await getSupabase().rpc('save_primary_offer_evidence_integration', input);
    if (error) throw error;
    return data;
  },

  async clearPrimaryOfferIntegration(locationId: string, offerId: string): Promise<number> {
    const { data, error } = await getSupabase().rpc('clear_primary_offer_evidence_integration', {
      p_location_id: locationId,
      p_offer_id: offerId,
    });
    if (error) throw error;
    return Number(data || 0);
  },
};
