import { getSupabase } from '../clients/supabase.client';
import { ConflictError } from '../utils/errors';

export type TriggerDeliveryJobStatus = 'pending' | 'processing' | 'succeeded' | 'failed' | 'unknown';

export interface TriggerDeliveryJob {
  id: string;
  location_id: string;
  trigger_key: string;
  idempotency_key: string;
  contact_id: string | null;
  payload: Record<string, unknown>;
  contact_field_updates: Record<string, unknown> | null;
  status: TriggerDeliveryJobStatus;
  attempt_count: number;
  max_attempts: number;
  available_at: string;
  lease_owner: string | null;
  lease_expires_at: string | null;
  trigger_result: Record<string, unknown> | null;
  error_message: string | null;
}

interface EnqueueTriggerDeliveryInput {
  locationId: string;
  triggerKey: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  contactId?: string;
  contactFieldUpdates?: Record<string, unknown>;
}

const JOB_SELECT = [
  'id',
  'location_id',
  'trigger_key',
  'idempotency_key',
  'contact_id',
  'payload',
  'contact_field_updates',
  'status',
  'attempt_count',
  'max_attempts',
  'available_at',
  'lease_owner',
  'lease_expires_at',
  'trigger_result',
  'error_message',
].join(',');

async function findExisting(locationId: string, idempotencyKey: string): Promise<TriggerDeliveryJob | null> {
  const { data, error } = await getSupabase()
    .from('trigger_delivery_jobs')
    .select(JOB_SELECT)
    .eq('location_id', locationId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  if (error) throw error;
  return (data || null) as TriggerDeliveryJob | null;
}

export const triggerDeliveryJobService = {
  async enqueue(input: EnqueueTriggerDeliveryInput): Promise<{ job: TriggerDeliveryJob; created: boolean }> {
    const idempotencyKey = input.idempotencyKey.trim();
    if (!idempotencyKey) throw new Error('Trigger delivery idempotency key is required');

    const { data, error } = await getSupabase()
      .from('trigger_delivery_jobs')
      .insert({
        location_id: input.locationId,
        trigger_key: input.triggerKey,
        idempotency_key: idempotencyKey,
        contact_id: input.contactId || null,
        payload: {
          ...input.payload,
          idempotency_key: idempotencyKey,
          idempotencyKey,
        },
        contact_field_updates: input.contactFieldUpdates || null,
      })
      .select(JOB_SELECT)
      .single();

    if (!error && data) return { job: data as unknown as TriggerDeliveryJob, created: true };
    if (error?.code !== '23505') throw error;

    const existing = await findExisting(input.locationId, idempotencyKey);
    if (!existing) throw error;
    if (existing.trigger_key !== input.triggerKey) {
      throw new ConflictError('Trigger delivery idempotency key is already assigned to a different event');
    }
    return { job: existing, created: false };
  },
};
