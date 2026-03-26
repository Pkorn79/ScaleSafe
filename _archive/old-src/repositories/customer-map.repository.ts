/**
 * customer-map.repository.ts — AB Customer Map Data Access
 *
 * Maps accept.blue customer IDs to GHL contact/location/offer data.
 * When a client enrolls, we create a mapping so that future recurring
 * payment webhooks (which only contain the accept.blue customer_id)
 * can be traced back to the correct GHL contact and merchant.
 *
 * Replaces Make.com Data Store DS 83038.
 */

import { getSupabaseClient } from '../clients/supabase.client';
import { logger } from '../utils/logger';

export interface CustomerMapRow {
  id: string;
  ab_customer_id: string;
  contact_id: string;
  location_id: string;
  offer_id: string | null;
  program_name: string | null;
  payment_type: string | null;
  installment_amount: number | null;
  installment_frequency: string | null;
}

/** Looks up a GHL contact by their accept.blue customer ID. */
export async function findByAbCustomerId(abCustomerId: string): Promise<CustomerMapRow | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('ab_customer_map')
    .select('*')
    .eq('ab_customer_id', abCustomerId)
    .single();

  if (error && error.code !== 'PGRST116') {
    logger.error({ error, abCustomerId }, 'Error looking up customer map');
    throw error;
  }

  return data;
}

/** Creates a new customer mapping at enrollment time. */
export async function create(mapping: Omit<CustomerMapRow, 'id'>): Promise<CustomerMapRow> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('ab_customer_map')
    .upsert(mapping, { onConflict: 'ab_customer_id' })
    .select()
    .single();

  if (error) {
    logger.error({ error, abCustomerId: mapping.ab_customer_id }, 'Error creating customer map');
    throw error;
  }

  logger.info(
    { abCustomerId: mapping.ab_customer_id, contactId: mapping.contact_id },
    'Customer map entry created'
  );

  return data;
}

/** Finds all customer maps for a given GHL contact. */
export async function findByContactId(
  locationId: string,
  contactId: string
): Promise<CustomerMapRow[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('ab_customer_map')
    .select('*')
    .eq('location_id', locationId)
    .eq('contact_id', contactId);

  if (error) {
    logger.error({ error, contactId }, 'Error finding customer maps by contact');
    throw error;
  }

  return data || [];
}
