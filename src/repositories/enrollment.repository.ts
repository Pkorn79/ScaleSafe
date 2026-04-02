import { getSupabase } from '../clients/supabase.client';
import { NotFoundError } from '../utils/errors';

export interface EnrollmentRecord {
  id: string;
  location_id: string;
  contact_id: string;
  offer_id: string | null;
  merchant_id: string | null;
  status: string;
  consent_token: string | null;
  consent_captured_at: string | null;
  consent_ip: string | null;
  consent_device: string | null;
  consent_browser: string | null;
  tc_version_hash: string | null;
  payment_amount: number | null;
  payment_type: string | null;
  payment_transaction_id: string | null;
  payments_made: number;
  payments_total: number | null;
  pipeline_opportunity_id: string | null;
  current_milestone: number;
  defense_readiness_score: number;
  risk_score: number;
  enrolled_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

export const enrollmentRepository = {
  async create(data: Partial<EnrollmentRecord> & {
    location_id: string;
    contact_id: string;
  }): Promise<EnrollmentRecord> {
    const { data: record, error } = await getSupabase()
      .from('enrollments')
      .insert(data)
      .select()
      .single();

    if (error) throw error;
    return record;
  },

  async findById(id: string): Promise<EnrollmentRecord | null> {
    const { data, error } = await getSupabase()
      .from('enrollments')
      .select('*')
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data;
  },

  async getById(id: string): Promise<EnrollmentRecord> {
    const record = await this.findById(id);
    if (!record) throw new NotFoundError(`Enrollment ${id}`);
    return record;
  },

  async findByConsentToken(token: string): Promise<EnrollmentRecord | null> {
    const { data, error } = await getSupabase()
      .from('enrollments')
      .select('*')
      .eq('consent_token', token)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data;
  },

  async findByContactAndOffer(
    contactId: string,
    offerId: string,
    locationId: string,
  ): Promise<EnrollmentRecord | null> {
    const { data, error } = await getSupabase()
      .from('enrollments')
      .select('*')
      .eq('contact_id', contactId)
      .eq('offer_id', offerId)
      .eq('location_id', locationId)
      .eq('status', 'consent_captured')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data;
  },

  async updateStatus(
    id: string,
    status: string,
    additionalData?: Partial<EnrollmentRecord>,
  ): Promise<EnrollmentRecord> {
    const updates: Record<string, unknown> = { status, ...additionalData };

    const { data, error } = await getSupabase()
      .from('enrollments')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async incrementPaymentsMade(id: string): Promise<void> {
    // Fetch current, increment, update
    const enrollment = await this.getById(id);
    const { error } = await getSupabase()
      .from('enrollments')
      .update({ payments_made: enrollment.payments_made + 1 })
      .eq('id', id);

    if (error) throw error;
  },

  async listByLocation(
    locationId: string,
    filters?: { status?: string; page?: number; limit?: number },
  ): Promise<{ data: EnrollmentRecord[]; total: number }> {
    const page = filters?.page || 1;
    const limit = filters?.limit || 50;
    const offset = (page - 1) * limit;

    let query = getSupabase()
      .from('enrollments')
      .select('*', { count: 'exact' })
      .eq('location_id', locationId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (filters?.status) {
      query = query.eq('status', filters.status);
    }

    const { data, error, count } = await query;

    if (error) throw error;
    return { data: data || [], total: count || 0 };
  },
};
