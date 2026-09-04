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
  processor_config_id: string | null;
  amount: number;
  currency: string;
  payment_number: number | null;
  payments_total: number | null;
  payments_remaining: number | null;
  failure_reason: string | null;
  attempt_count: number;
  raw_webhook_payload: Record<string, unknown> | null;
  line_items?: unknown[] | null;
  source: string | null;
  is_recurring: boolean | null;
  created_at: string;
}

export interface PaymentEventInsert {
  merchant_id?: string | null;
  location_id: string;
  contact_id: string;
  enrollment_id?: string | null;
  offer_id?: string | null;
  event_type: string;
  processor?: string;
  processor_transaction_id?: string;
  processor_subscription_id?: string | null;
  processor_config_id?: string | null;
  amount: number;
  currency?: string;
  payment_number?: number;
  payments_total?: number | null;
  payments_remaining?: number;
  failure_reason?: string;
  attempt_count?: number;
  raw_webhook_payload?: Record<string, unknown>;
  line_items?: unknown[] | null;
  source?: string;
  is_recurring?: boolean;
  payment_status?: string;
  payment_method_type?: string;
  selected_payment_method?: string;
  settled_at?: string | null;
  returned_at?: string | null;
  return_reason?: string | null;
  card_uplift_percent?: number | null;
  processor_deduction_percent?: number | null;
  external_payment_source?: string | null;
  external_payment_reference?: string | null;
  external_payment_method?: string | null;
  recorded_by?: string | null;
  recorded_at?: string | null;
}

const COMPATIBILITY_COLUMNS = [
  'payment_status',
  'selected_payment_method',
  'settled_at',
  'returned_at',
  'return_reason',
  'card_uplift_percent',
  'processor_deduction_percent',
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

  async createOrReuseByTransaction(data: PaymentEventInsert): Promise<PaymentEventRecord> {
    if (!data.processor_transaction_id) return this.create(data);

    const existing = await this.findByTransactionId(
      data.processor || 'ghl',
      data.processor_transaction_id,
      data.location_id,
      data.processor_config_id,
    );

    if (existing?.id) {
      const update: Record<string, unknown> = {};
      const fields = [
        'merchant_id',
        'contact_id',
        'enrollment_id',
        'offer_id',
        'processor_subscription_id',
        'processor_config_id',
        'payment_number',
        'payments_total',
        'source',
        'raw_webhook_payload',
        'payment_status',
        'payment_method_type',
        'selected_payment_method',
      ] as const;

      for (const field of fields) {
        const value = data[field as keyof PaymentEventInsert];
        if (value !== undefined && value !== null && value !== '') update[field] = value;
      }

      if (Object.keys(update).length > 0) {
        let updated = await getSupabase()
          .from('payment_events')
          .update(update)
          .eq('id', existing.id)
          .select()
          .single();

        if (updated.error && isMissingColumnError(updated.error)) {
          updated = await getSupabase()
            .from('payment_events')
            .update(withoutCompatibilityColumns(update))
            .eq('id', existing.id)
            .select()
            .single();
        }

        if (updated.error) throw updated.error;
        return updated.data;
      }

      return existing;
    }

    try {
      return await this.create(data);
    } catch (err: any) {
      if (err?.code !== '23505') throw err;
      const duplicate = await this.findByTransactionId(
        data.processor || 'ghl',
        data.processor_transaction_id,
        data.location_id,
        data.processor_config_id,
      );
      if (duplicate) return duplicate;
      throw err;
    }
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
    processorConfigId?: string | null,
  ): Promise<PaymentEventRecord | null> {
    let query = getSupabase()
      .from('payment_events')
      .select('*')
      .eq('processor', processor)
      .eq('processor_transaction_id', transactionId)
      .limit(1);

    if (locationId) query = query.eq('location_id', locationId);
    if (processorConfigId) query = query.eq('processor_config_id', processorConfigId);

    const { data, error } = await query.single();

    if (error && error.code !== 'PGRST116') throw error;
    return data;
  },
};
