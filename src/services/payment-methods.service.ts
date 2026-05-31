import { getSupabase } from '../clients/supabase.client';
import { logger } from '../utils/logger';

type ProcessorType = 'nmi' | 'stripe';

interface SavePaymentMethodParams {
  merchantId: string;
  locationId: string;
  contactId: string;
  processorType: ProcessorType;
  paymentMethodKind?: 'card' | 'ach';
  customerId: string;
  paymentMethodId: string;
  cardLastFour?: string;
  cardBrand?: string;
  cardExpMonth?: number;
  cardExpYear?: number;
  bankLastFour?: string;
  bankAccountType?: string;
  bankHolderType?: string;
  makeDefault?: boolean;
}

function isColumnCompatibilityError(error: any): boolean {
  const text = [
    error?.code,
    error?.message,
    error?.details,
    error?.hint,
  ].filter(Boolean).join(' ').toLowerCase();

  return text.includes('pgrst204')
    || text.includes('schema cache')
    || text.includes('could not find')
    || (text.includes('column') && text.includes('does not exist'));
}

const NEW_PAYMENT_METHOD_COLUMNS = new Set([
  'payment_method_kind',
  'bank_last_four',
  'bank_account_type',
  'bank_holder_type',
  'archived_at',
]);

function withoutNewPaymentMethodColumns(record: Record<string, unknown>): Record<string, unknown> {
  const next = { ...record };
  for (const column of NEW_PAYMENT_METHOD_COLUMNS) delete next[column];
  return next;
}

function tokenColumn(processorType: ProcessorType): 'nmi_customer_vault_id' | 'stripe_payment_method_id' {
  return processorType === 'nmi' ? 'nmi_customer_vault_id' : 'stripe_payment_method_id';
}

function tokenValue(params: Pick<SavePaymentMethodParams, 'processorType' | 'customerId' | 'paymentMethodId'>): string {
  return params.processorType === 'nmi' ? params.customerId : params.paymentMethodId;
}

function normalizedLastFour(value: unknown): string {
  const raw = String(value || '').trim();
  return /^\d{4}$/.test(raw) ? raw : '';
}

function displayFingerprint(method: any): string {
  const processor = String(method.processor_type || '').toLowerCase();
  const last4 = normalizedLastFour(method.card_last_four);
  const brand = String(method.card_brand || '').toLowerCase();
  const expMonth = Number(method.card_exp_month || 0) || 0;
  const expYear = Number(method.card_exp_year || 0) || 0;
  const token = method.nmi_customer_vault_id || method.stripe_payment_method_id || method.stripe_customer_id || method.id || '';

  if (last4 && expMonth && expYear) {
    return `${processor}:${brand}:${last4}:${expMonth}:${expYear}`;
  }

  return `${processor}:${token}`;
}

function exactTokenFingerprint(method: any): string {
  return [
    String(method.processor_type || '').toLowerCase(),
    method.nmi_customer_vault_id || '',
    method.stripe_payment_method_id || '',
    method.stripe_customer_id || '',
  ].join(':');
}

function sortMethods(methods: any[]): any[] {
  return [...methods].sort((a, b) => {
    if (Boolean(a.archived_at) !== Boolean(b.archived_at)) return a.archived_at ? 1 : -1;
    if (Boolean(a.is_default) !== Boolean(b.is_default)) return a.is_default ? -1 : 1;
    return String(b.created_at || '').localeCompare(String(a.created_at || ''));
  });
}

async function updatePaymentMethodWithArchivedFallback(id: string, values: Record<string, unknown>) {
  const supabase = getSupabase();
  const { error } = await supabase.from('payment_methods').update(values).eq('id', id);
  if (!error) return;

  if (isColumnCompatibilityError(error)) {
    const fallbackValues = withoutNewPaymentMethodColumns(values);
    if (Object.keys(fallbackValues).length > 0) {
      const { error: fallbackError } = await supabase.from('payment_methods').update(fallbackValues).eq('id', id);
      if (fallbackError) throw fallbackError;
    }
    return;
  }

  throw error;
}

export function collapseVisiblePaymentMethods(methods: any[]): { visible: any[]; hiddenCount: number } {
  const sorted = sortMethods(methods || []);
  const visible: any[] = [];
  const grouped = new Map<string, any[]>();

  for (const method of sorted) {
    if (method.archived_at) continue;
    const key = displayFingerprint(method);
    const group = grouped.get(key) || [];
    group.push(method);
    grouped.set(key, group);
  }

  for (const group of grouped.values()) {
    const [primary, ...duplicates] = group;
    visible.push({
      ...primary,
      hidden_duplicate_count: duplicates.length,
    });
  }

  const visibleIds = new Set(visible.map(method => method.id));
  const hiddenCount = sorted.filter(method => !visibleIds.has(method.id)).length;
  return { visible, hiddenCount };
}

export function selectProcessorPaymentMethod(methods: any[], processor?: string | null): any | null {
  const processorType = String(processor || '').toLowerCase();
  if (!['nmi', 'stripe'].includes(processorType)) return null;

  const { visible } = collapseVisiblePaymentMethods(methods || []);
  const matches = visible.filter(method => String(method.processor_type || '').toLowerCase() === processorType);
  return matches.find(method => method.is_default) || matches[0] || null;
}

export async function findSavedCardForProcessor(
  locationId: string,
  contactId: string,
  processorType: ProcessorType,
): Promise<any | null> {
  const { data, error } = await getSupabase()
    .from('payment_methods')
    .select('*')
    .eq('location_id', locationId)
    .eq('contact_id', contactId)
    .eq('processor_type', processorType)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) throw error;
  return selectProcessorPaymentMethod(data || [], processorType);
}

export async function saveOrReusePaymentMethod(params: SavePaymentMethodParams): Promise<any> {
  const supabase = getSupabase();
  const makeDefault = params.makeDefault !== false;
  const token = tokenValue(params);
  const column = tokenColumn(params.processorType);

  if (!token) throw new Error('Payment method token is required');

  if (makeDefault) {
    await supabase.from('payment_methods')
      .update({ is_default: false })
      .eq('location_id', params.locationId)
      .eq('contact_id', params.contactId)
      .eq('is_default', true);
  }

  const { data: existing, error: existingError } = await supabase
    .from('payment_methods')
    .select('*')
    .eq('location_id', params.locationId)
    .eq('contact_id', params.contactId)
    .eq('processor_type', params.processorType)
    .eq(column, token)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) throw existingError;

  const payload: Record<string, unknown> = {
    processor_type: params.processorType,
    payment_method_kind: params.paymentMethodKind || 'card',
    nmi_customer_vault_id: params.processorType === 'nmi' ? params.customerId : null,
    stripe_customer_id: params.processorType === 'stripe' ? params.customerId : null,
    stripe_payment_method_id: params.processorType === 'stripe' ? params.paymentMethodId : null,
    card_last_four: params.cardLastFour || '',
    card_brand: params.cardBrand || 'unknown',
    card_exp_month: params.cardExpMonth || 0,
    card_exp_year: params.cardExpYear || 0,
    bank_last_four: params.bankLastFour || null,
    bank_account_type: params.bankAccountType || null,
    bank_holder_type: params.bankHolderType || null,
    is_default: makeDefault,
    archived_at: null,
  };

  if (existing?.id) {
    await updatePaymentMethodWithArchivedFallback(existing.id, payload);
    return { ...existing, ...payload, id: existing.id, reused: true };
  }

  const insertPayload: Record<string, unknown> = {
    merchant_id: params.merchantId,
    location_id: params.locationId,
    contact_id: params.contactId,
    ...payload,
  };

  let inserted = await supabase.from('payment_methods').insert(insertPayload).select().single();
  if (inserted.error && isColumnCompatibilityError(inserted.error)) {
    const fallbackPayload = withoutNewPaymentMethodColumns(insertPayload);
    inserted = await supabase.from('payment_methods').insert(fallbackPayload).select().single();
  }
  if (inserted.error) throw inserted.error;

  return { ...inserted.data, reused: false };
}

export async function archivePaymentMethod(locationId: string, contactId: string, cardId: string): Promise<void> {
  try {
    await updatePaymentMethodWithArchivedFallback(cardId, {
      archived_at: new Date().toISOString(),
      is_default: false,
    });
  } catch (err: any) {
    logger.warn({ err: err.message, locationId, contactId, cardId }, 'Payment method archive failed; deleting as fallback');
    await getSupabase()
      .from('payment_methods')
      .delete()
      .eq('id', cardId)
      .eq('location_id', locationId)
      .eq('contact_id', contactId);
  }
}

export function exactTokenKey(method: any): string {
  return exactTokenFingerprint(method);
}
