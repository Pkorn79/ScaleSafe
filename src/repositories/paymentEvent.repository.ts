import { getSupabase } from '../clients/supabase.client';

export interface PaymentEventRecord {
  id: string;
  location_id: string;
  contact_id: string;
  enrollment_id: string | null;
  event_type: string;
  processor: string;
  processor_transaction_id: string | null;
  processor_subscription_id: string | null;
  amount: number;
  currency: string;
  payment_number: number | null;
  payments_remaining: number | null;
  failure_reason: string | null;
  attempt_count: number;
  raw_webhook_payload: Record<string, unknown> | null;
  source: string | null;
  is_recurring: boolean | null;
  created_at: string;
}

export interface PaymentEventInsert {
  location_id: string;
  contact_id: string;
  enrollment_id?: string | null;
  event_type: string;
  processor?: string;
  processor_transaction_id?: string;
  processor_subscription_id?: string | null;
  amount: number;
  currency?: string;
  payment_number?: number;
  payments_remaining?: number;
  failure_reason?: string;
  attempt_count?: number;
  raw_webhook_payload?: Record<string, unknown>;
  source?: string;
  is_recurring?: boolean;
}

export const paymentEventRepository = {
  async create(data: PaymentEventInsert): Promise<PaymentEventRecord> {
    const record = { processor: 'ghl', currency: 'usd', ...data };
    const { data: result, error } = await getSupabase()
      .from('payment_events')
      .insert(record)
      .select()
      .single();

    if (error) throw error;
    return result;
  },

  async findByEnrollment(enrollmentId: string): Promise<PaymentEventRecord[]> {
    const { data, error } = await getSupabase()
      .from('payment_events')
      .select('*')
      .eq('enrollment_id', enrollmentId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  },

  async findByTransactionId(
    processor: string,
    transactionId: string,
  ): Promise<PaymentEventRecord | null> {
    const { data, error } = await getSupabase()
      .from('payment_events')
      .select('*')
      .eq('processor', processor)
      .eq('processor_transaction_id', transactionId)
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data;
  },
};
