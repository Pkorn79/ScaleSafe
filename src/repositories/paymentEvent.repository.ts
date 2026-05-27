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
  payments_total: number | null;
  payments_remaining: number | null;
  failure_reason: string | null;
  attempt_count: number;
  raw_webhook_payload: Record<string, unknown> | null;
  source: string | null;
  is_recurring: boolean | null;
  created_at: string;
}

export interface PaymentEventInsert {
  merchant_id?: string | null;
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
  payments_total?: number | null;
  payments_remaining?: number;
  failure_reason?: string;
  attempt_count?: number;
  raw_webhook_payload?: Record<string, unknown>;
  source?: string;
  is_recurring?: boolean;
  external_payment_source?: string | null;
  external_payment_reference?: string | null;
  external_payment_method?: string | null;
  recorded_by?: string | null;
  recorded_at?: string | null;
}

const COMPATIBILITY_COLUMNS = [
  'external_payment_source',
  'external_payment_reference',
  'external_payment_method',
  'recorded_by',
  'recorded_at',
];

function isMissingColumnError(err: any): boolean {
  const text = `${err?.code || ''} ${err?.message || ''} ${err?.details || ''}`.toLowerCase();
  return text.includes('pgrst204')
    || text.includes('schema cache')
    || text.includes('could not find')
    || text.includes('does not exist');
}

function withoutCompatibilityColumns(record: Record<string, unknown>): Record<string, unknown> {
  const next = { ...record };
  for (const column of COMPATIBILITY_COLUMNS) delete next[column];
  return next;
}

export const paymentEventRepository = {
  async create(data: PaymentEventInsert): Promise<PaymentEventRecord> {
    const { payments_remaining: paymentsRemaining, ...rest } = data;
    const record: Record<string, unknown> = { processor: 'ghl', currency: 'usd', ...rest };
    if (record.payments_total === undefined && record.payment_number != null && paymentsRemaining != null) {
      record.payments_total = Number(record.payment_number) + Number(paymentsRemaining);
    }

    let { data: result, error } = await getSupabase()
      .from('payment_events')
      .insert(record)
      .select()
      .single();

    if (error && isMissingColumnError(error)) {
      const retry = await getSupabase()
        .from('payment_events')
        .insert(withoutCompatibilityColumns(record))
        .select()
        .single();
      result = retry.data;
      error = retry.error;
    }

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
    locationId?: string,
  ): Promise<PaymentEventRecord | null> {
    let query = getSupabase()
      .from('payment_events')
      .select('*')
      .eq('processor', processor)
      .eq('processor_transaction_id', transactionId)
      .limit(1);

    if (locationId) query = query.eq('location_id', locationId);

    const { data, error } = await query.single();

    if (error && error.code !== 'PGRST116') throw error;
    return data;
  },
};
