import { getSupabase } from '../clients/supabase.client';
import { NotFoundError } from '../utils/errors';

export interface OfferRecord {
  id: string;
  location_id: string;
  ghl_product_id: string | null;
  ghl_price_ids: Record<string, string>;
  ghl_custom_object_id: string | null;
  offer_name: string;
  program_description: string | null;
  delivery_method: string | null;
  price: number | null;
  payment_type: string | null;
  installment_amount: number | null;
  installment_frequency: string | null;
  num_payments: number | null;
  pif_price: number | null;
  pif_discount_enabled: boolean;
  compiled_tc_html: string | null;
  refund_window_text: string | null;
  redirect_slug: string | null;
  price_display: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
  // Clause slots 1-11
  [key: `clause_slot_${number}_title`]: string | null;
  [key: `clause_slot_${number}_text`]: string | null;
  // Milestones 1-8
  [key: `m${number}_name`]: string | null;
  [key: `m${number}_delivers`]: string | null;
  [key: `m${number}_client_does`]: string | null;
}

export const offerRepository = {
  async findById(id: string): Promise<OfferRecord | null> {
    const { data, error } = await getSupabase()
      .from('offers_mirror')
      .select('*')
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data;
  },

  async getById(id: string): Promise<OfferRecord> {
    const offer = await this.findById(id);
    if (!offer) throw new NotFoundError(`Offer ${id}`);
    return offer;
  },

  async listByLocation(locationId: string): Promise<OfferRecord[]> {
    const { data, error } = await getSupabase()
      .from('offers_mirror')
      .select('*')
      .eq('location_id', locationId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  },

  async create(offer: Partial<OfferRecord> & { location_id: string; offer_name: string }): Promise<OfferRecord> {
    const { data, error } = await getSupabase()
      .from('offers_mirror')
      .insert(offer)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async update(id: string, updates: Partial<OfferRecord>): Promise<OfferRecord> {
    const { data, error } = await getSupabase()
      .from('offers_mirror')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async delete(id: string): Promise<void> {
    const { error } = await getSupabase()
      .from('offers_mirror')
      .delete()
      .eq('id', id);

    if (error) throw error;
  },
};
