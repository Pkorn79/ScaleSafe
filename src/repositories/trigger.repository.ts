import { getSupabase } from '../clients/supabase.client';

export interface TriggerSubscriptionRecord {
  id: string;
  location_id: string;
  trigger_key: string;
  subscription_url: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export const triggerRepository = {
  async upsertSubscription(
    locationId: string,
    triggerKey: string,
    subscriptionUrl: string,
  ): Promise<TriggerSubscriptionRecord> {
    const { data, error } = await getSupabase()
      .from('trigger_subscriptions')
      .upsert(
        {
          location_id: locationId,
          trigger_key: triggerKey,
          subscription_url: subscriptionUrl,
          is_active: true,
        },
        { onConflict: 'location_id,trigger_key,subscription_url' },
      )
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async deactivateSubscription(
    locationId: string,
    triggerKey: string,
    subscriptionUrl: string,
  ): Promise<void> {
    const { error } = await getSupabase()
      .from('trigger_subscriptions')
      .update({ is_active: false })
      .eq('location_id', locationId)
      .eq('trigger_key', triggerKey)
      .eq('subscription_url', subscriptionUrl);

    if (error) throw error;
  },

  async getActiveSubscriptions(
    locationId: string,
    triggerKey: string,
  ): Promise<TriggerSubscriptionRecord[]> {
    const { data, error } = await getSupabase()
      .from('trigger_subscriptions')
      .select('*')
      .eq('location_id', locationId)
      .eq('trigger_key', triggerKey)
      .eq('is_active', true);

    // Table may not exist — triggers fire directly to GHL Marketplace without it
    if (error) return [];
    return data || [];
  },
};
