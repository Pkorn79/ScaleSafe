import { getSupabase } from '../clients/supabase.client';
import { cleanPostgrestLikeTerm, isSafeOrFilterSearchInput } from '../utils/search-input';

export interface PaymentLedgerFilters {
  contactId?: string;
  search?: string;
  trackingId?: string;
  processor?: string;
  paymentType?: string;
  eventType?: string;
  status?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface PaymentLedgerRow {
  id: string;
  date: string;
  contactId: string;
  customerName: string;
  customerEmail: string;
  enrollmentId: string | null;
  offerId: string | null;
  offerTrackingId: string | null;
  programName: string;
  amount: number;
  currency: string;
  type: string;
  typeLabel: string;
  status: string;
  statusLabel: string;
  processor: string;
  paymentType: string;
  paymentTypeLabel: string;
  source: string;
  isRecurring: boolean;
  paymentNumber: number | null;
  paymentsRemaining: number | null;
  processorTransactionId: string | null;
  processorSubscriptionId: string | null;
  description: string;
  lineItems: unknown[];
  refundable: boolean;
  dunningStatus?: string | null;
  dunningRetryCount?: number;
  dunningNextRetry?: string | null;
}

interface PaymentLedgerResult {
  payments: PaymentLedgerRow[];
  total: number;
  limit: number;
  offset: number;
  summary: {
    totalCharged: number;
    totalRefunded: number;
    failedAmount: number;
    visibleCount: number;
  };
}

const PAYMENT_EVENT_COLUMNS = [
  'id',
  'location_id',
  'contact_id',
  'enrollment_id',
  'offer_id',
  'event_type',
  'processor',
  'processor_transaction_id',
  'processor_subscription_id',
  'amount',
  'currency',
  'payment_number',
  'payments_total',
  'failure_reason',
  'source',
  'is_recurring',
  'customer_email',
  'dunning_status',
  'dunning_retry_count',
  'dunning_next_retry',
  'line_items',
  'created_at',
].join(', ');

const BASE_PAYMENT_EVENT_COLUMNS = [
  'id',
  'location_id',
  'contact_id',
  'enrollment_id',
  'event_type',
  'processor',
  'processor_transaction_id',
  'amount',
  'currency',
  'payment_number',
  'payments_total',
  'failure_reason',
  'raw_webhook_payload',
  'line_items',
  'created_at',
].join(', ');

const PAYMENT_EVENT_FALLBACK_DEFAULTS = {
  offer_id: null,
  processor_subscription_id: null,
  source: null,
  is_recurring: false,
  customer_email: null,
  payment_number: null,
  payments_total: null,
  payments_remaining: null,
  dunning_status: null,
  dunning_retry_count: 0,
  dunning_next_retry: null,
  line_items: [],
};

const MINIMAL_PAYMENT_EVENT_COLUMNS = [
  'id',
  'location_id',
  'contact_id',
  'enrollment_id',
  'event_type',
  'processor',
  'processor_transaction_id',
  'processor_subscription_id',
  'amount',
  'currency',
  'payment_number',
  'payments_total',
  'failure_reason',
  'line_items',
  'created_at',
].join(', ');

const ENROLLMENT_COLUMNS = [
  'id',
  'contact_id',
  'offer_id',
  'email',
  'first_name',
  'last_name',
  'digital_signature',
  'payment_type',
  'payment_amount',
  'processor_type',
  'processor_subscription_id',
  'payments_made',
  'payments_total',
  'billing_completed_at',
  'status',
  'created_at',
].join(', ');

const BASE_ENROLLMENT_COLUMNS = [
  'id',
  'contact_id',
  'offer_id',
  'payment_type',
  'payment_amount',
  'payments_made',
  'payments_total',
  'status',
  'created_at',
].join(', ');

const ENROLLMENT_FALLBACK_DEFAULTS = {
  email: null,
  first_name: null,
  last_name: null,
  digital_signature: null,
  processor_type: null,
  processor_subscription_id: null,
  billing_completed_at: null,
};

function cleanLike(value: string): string {
  return cleanPostgrestLikeTerm(value);
}

function cleanTrackingLike(value: string): string {
  return value.replace(/[%]/g, '').trim();
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

function clampLimit(value: unknown): number {
  const parsed = Number(value || 50);
  if (!Number.isFinite(parsed)) return 50;
  return Math.min(200, Math.max(1, Math.floor(parsed)));
}

function normalizePaymentType(value: unknown): string {
  const raw = String(value || '').toLowerCase();
  if (raw === 'installments') return 'installment';
  if (raw === 'one_time' || raw === 'paid_in_full') return 'pif';
  if (raw === 'subscription') return 'subscription';
  if (raw === 'free') return 'free';
  if (raw === 'manual') return 'manual';
  if (raw === 'installment') return 'installment';
  if (raw === 'pif') return 'pif';
  return raw || 'unknown';
}

function paymentTypeLabel(value: unknown): string {
  const normalized = normalizePaymentType(value);
  const labels: Record<string, string> = {
    pif: 'PIF',
    installment: 'Installment',
    subscription: 'Subscription',
    free: 'Free',
    manual: 'Manual',
    unknown: 'Unknown',
  };
  return labels[normalized] || normalized.replace(/_/g, ' ');
}

function eventStatus(event: any): { status: string; label: string } {
  const eventType = String(event?.event_type || '').toLowerCase();
  if (eventType === 'payment_failed' || event?.failure_reason) {
    return { status: 'failed', label: 'Failed' };
  }
  if (eventType === 'refund') {
    return { status: 'refunded', label: 'Refunded' };
  }
  if (eventType === 'subscription_cancelled') {
    return { status: 'cancelled', label: 'Cancelled' };
  }
  if (eventType === 'subscription_created') {
    return { status: 'created', label: 'Created' };
  }
  return { status: 'paid', label: 'Paid' };
}

function eventTypeLabel(value: unknown): string {
  const raw = String(value || '').toLowerCase();
  const labels: Record<string, string> = {
    sale: 'Charge',
    payment_success: 'Charge',
    subscription_payment: 'Subscription payment',
    payment_failed: 'Failed payment',
    refund: 'Refund',
    subscription_created: 'Subscription created',
    subscription_cancelled: 'Subscription cancelled',
    auth: 'Authorization',
    capture: 'Capture',
    void: 'Void',
  };
  return labels[raw] || raw.replace(/_/g, ' ') || 'Payment';
}

function normalizeLineItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function displayName(enrollment: any, fallbackEmail: string, contactId: string): string {
  const first = String(enrollment?.first_name || '').trim();
  const last = String(enrollment?.last_name || '').trim();
  const full = [first, last].filter(Boolean).join(' ').trim();
  if (full) return full;
  if (enrollment?.digital_signature) return String(enrollment.digital_signature);
  if (fallbackEmail) return fallbackEmail;
  return contactId ? contactId.slice(0, 12) : 'Unknown client';
}

async function findMatchingEnrollmentIds(
  locationId: string,
  filters: Pick<PaymentLedgerFilters, 'search' | 'trackingId' | 'paymentType'>,
): Promise<string[] | null> {
  const search = String(filters.search || '').trim();
  if (search && !isSafeOrFilterSearchInput(search)) {
    throw new Error('Invalid search value');
  }
  const trackingId = String((filters as PaymentLedgerFilters).trackingId || '').trim();
  const paymentType = normalizePaymentType(filters.paymentType);
  const needsPreFilter = !!search || !!trackingId || (paymentType && paymentType !== 'unknown');
  if (!needsPreFilter) return null;

  const supabase = getSupabase();
  const ids = new Set<string>();

  async function runEnrollmentQuery(extra?: (query: any) => any) {
    let query: any = supabase
      .from('enrollments')
      .select('id')
      .eq('location_id', locationId);

    if (paymentType && paymentType !== 'unknown') {
      const values = paymentType === 'pif' ? ['pif', 'one_time', 'paid_in_full'] : [paymentType];
      query = query.in('payment_type', values);
    }

    if (extra) query = extra(query);
    const { data, error } = await query.limit(500);
    if (error) throw error;
    for (const row of data || []) ids.add(row.id);
  }

  async function findOffersByTrackingId(value: string): Promise<string[]> {
    const escaped = cleanTrackingLike(value);
    let response = await supabase
      .from('offers_mirror')
      .select('id')
      .eq('location_id', locationId)
      .ilike('tracking_id', `%${escaped}%`)
      .limit(500);

    if (response.error && isColumnCompatibilityError(response.error)) {
      return [];
    }
    if (response.error) throw response.error;
    return (response.data || []).map((o: any) => o.id).filter(Boolean);
  }

  if (search) {
    const escaped = cleanLike(search);
    await runEnrollmentQuery((query) => query.or([
      `contact_id.ilike.%${escaped}%`,
      `email.ilike.%${escaped}%`,
      `first_name.ilike.%${escaped}%`,
      `last_name.ilike.%${escaped}%`,
      `digital_signature.ilike.%${escaped}%`,
    ].join(',')));

    let offerResponse = await supabase
      .from('offers_mirror')
      .select('id')
      .eq('location_id', locationId)
      .or(`offer_name.ilike.%${escaped}%,tracking_id.ilike.%${escaped}%`)
      .limit(100);

    if (offerResponse.error && isColumnCompatibilityError(offerResponse.error)) {
      offerResponse = await supabase
        .from('offers_mirror')
        .select('id')
        .eq('location_id', locationId)
        .ilike('offer_name', `%${escaped}%`)
        .limit(100);
    }

    if (offerResponse.error) throw offerResponse.error;

    const offerIds = (offerResponse.data || []).map((o: any) => o.id).filter(Boolean);
    if (offerIds.length > 0) {
      await runEnrollmentQuery((query) => query.in('offer_id', offerIds));
    }
  }

  if (trackingId) {
    const offerIds = await findOffersByTrackingId(trackingId);
    if (offerIds.length > 0) {
      await runEnrollmentQuery((query) => query.in('offer_id', offerIds));
    }
  } else if (!search) {
    await runEnrollmentQuery();
  }

  return [...ids];
}

function buildPaymentEventsQuery(
  locationId: string,
  filters: PaymentLedgerFilters,
  enrollmentFilterIds: string[] | null,
  columns: string,
) {
  let query: any = getSupabase()
    .from('payment_events')
    .select(columns, { count: 'exact' })
    .eq('location_id', locationId);

  if (filters.contactId) query = query.eq('contact_id', filters.contactId);
  if (filters.processor) query = query.eq('processor', String(filters.processor).toLowerCase());
  if (filters.eventType) query = query.eq('event_type', filters.eventType);
  if (filters.from) query = query.gte('created_at', filters.from);
  if (filters.to) query = query.lte('created_at', filters.to);
  if (enrollmentFilterIds) query = query.in('enrollment_id', enrollmentFilterIds.slice(0, 500));

  const status = String(filters.status || '').toLowerCase();
  if (status === 'failed') query = query.eq('event_type', 'payment_failed');
  if (status === 'refunded') query = query.eq('event_type', 'refund');
  if (status === 'paid') query = query.in('event_type', ['sale', 'payment_success', 'subscription_payment', 'capture']);

  return query;
}

async function fetchPaymentEvents(
  locationId: string,
  filters: PaymentLedgerFilters,
  enrollmentFilterIds: string[] | null,
  limit: number,
  offset: number,
) {
  const columnSets = [
    PAYMENT_EVENT_COLUMNS,
    BASE_PAYMENT_EVENT_COLUMNS,
    MINIMAL_PAYMENT_EVENT_COLUMNS,
  ];

  for (let index = 0; index < columnSets.length; index += 1) {
    const response = await buildPaymentEventsQuery(locationId, filters, enrollmentFilterIds, columnSets[index])
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (response.error && isColumnCompatibilityError(response.error) && index < columnSets.length - 1) {
      continue;
    }

    if (response.error) throw response.error;
    return {
      events: (response.data || []).map((row: any) => ({ ...PAYMENT_EVENT_FALLBACK_DEFAULTS, ...row })),
      count: response.count,
    };
  }

  return { events: [], count: 0 };
}

async function selectEnrollments(
  locationId: string,
  column: 'id' | 'contact_id',
  values: string[],
  options: { newestFirst?: boolean; limit?: number } = {},
) {
  if (values.length === 0) return [];

  function baseQuery(columns: string) {
    let query: any = getSupabase()
      .from('enrollments')
      .select(columns)
      .eq('location_id', locationId)
      .in(column, values);

    if (options.newestFirst) query = query.order('created_at', { ascending: false });
    if (options.limit) query = query.limit(options.limit);
    return query;
  }

  let response = await baseQuery(ENROLLMENT_COLUMNS);
  if (response.error && isColumnCompatibilityError(response.error)) {
    response = await baseQuery(BASE_ENROLLMENT_COLUMNS);
    if (response.error) throw response.error;
    return (response.data || []).map((row: any) => ({ ...ENROLLMENT_FALLBACK_DEFAULTS, ...row }));
  }

  if (response.error) throw response.error;
  return response.data || [];
}

async function fetchEnrollmentMaps(locationId: string, events: any[]) {
  const enrollmentIds = [...new Set(events.map(e => e.enrollment_id).filter(Boolean))];
  const contactIds = [...new Set(events.map(e => e.contact_id).filter(Boolean))];

  const byId = new Map<string, any>();
  const byContact = new Map<string, any>();

  if (enrollmentIds.length > 0) {
    const rows = await selectEnrollments(locationId, 'id', enrollmentIds);
    for (const row of (rows as any[])) {
      byId.set(row.id, row);
      if (row.contact_id && !byContact.has(row.contact_id)) byContact.set(row.contact_id, row);
    }
  }

  const missingContactIds = contactIds.filter(cid => !byContact.has(cid));
  if (missingContactIds.length > 0) {
    const rows = await selectEnrollments(locationId, 'contact_id', missingContactIds, { newestFirst: true, limit: 500 });
    for (const row of (rows as any[])) {
      if (row.contact_id && !byContact.has(row.contact_id)) byContact.set(row.contact_id, row);
      if (row.id && !byId.has(row.id)) byId.set(row.id, row);
    }
  }

  return { byId, byContact };
}

async function fetchOfferMap(locationId: string, events: any[], enrollments: Map<string, any>) {
  const offerIds = new Set<string>();
  for (const event of events) {
    if (event.offer_id) offerIds.add(event.offer_id);
    const enrollment = event.enrollment_id ? enrollments.get(event.enrollment_id) : null;
    if (enrollment?.offer_id) offerIds.add(enrollment.offer_id);
  }

  if (offerIds.size === 0) return new Map<string, any>();

  let response: any = await getSupabase()
    .from('offers_mirror')
    .select('id, offer_name, tracking_id, payment_type, price, installment_amount, installment_frequency, num_payments')
    .eq('location_id', locationId)
    .in('id', [...offerIds]);

  if (response.error && isColumnCompatibilityError(response.error)) {
    response = await getSupabase()
      .from('offers_mirror')
      .select('id, offer_name, payment_type, price, installment_amount, installment_frequency, num_payments')
      .eq('location_id', locationId)
      .in('id', [...offerIds]);
  }

  if (response.error) throw response.error;
  return new Map((response.data || []).map((offer: any) => [offer.id, { tracking_id: null, ...offer }]));
}

function buildRow(event: any, linkedEnrollment: any, contactEnrollment: any, offer: any): PaymentLedgerRow {
  const amount = Number(event.amount || 0);
  const status = eventStatus(event);
  const paymentType = normalizePaymentType(linkedEnrollment?.payment_type || offer?.payment_type);
  const customerEmail = String(linkedEnrollment?.email || contactEnrollment?.email || event.customer_email || '').trim();
  const processor = String(event.processor || linkedEnrollment?.processor_type || 'unknown').toLowerCase();
  const programName = offer?.offer_name || 'Unassigned payment';
  const paymentNumber = event.payment_number == null ? null : Number(event.payment_number);
  const eventPaymentsTotal = event.payments_total == null ? null : Number(event.payments_total);
  const enrollmentPaymentsTotal = linkedEnrollment?.payments_total == null ? null : Number(linkedEnrollment.payments_total);
  const paymentsTotal = Number.isFinite(eventPaymentsTotal) ? eventPaymentsTotal : enrollmentPaymentsTotal;
  const paymentsRemaining = event.payments_remaining == null
    ? (paymentNumber != null && paymentsTotal != null ? Math.max(0, paymentsTotal - paymentNumber) : null)
    : Number(event.payments_remaining);
  const recurring = Boolean(event.is_recurring);
  const typeLabel = eventTypeLabel(event.event_type);

  const progress = paymentNumber
    ? ` #${paymentNumber}${paymentsRemaining === 0 ? ' (final)' : ''}`
    : '';

  return {
    id: event.id,
    date: event.created_at,
    contactId: event.contact_id || linkedEnrollment?.contact_id || contactEnrollment?.contact_id || '',
    customerName: displayName(contactEnrollment || linkedEnrollment, customerEmail, event.contact_id || ''),
    customerEmail,
    enrollmentId: event.enrollment_id || linkedEnrollment?.id || null,
    offerId: offer?.id || linkedEnrollment?.offer_id || event.offer_id || null,
    offerTrackingId: offer?.tracking_id || null,
    programName,
    amount,
    currency: event.currency || 'usd',
    type: event.event_type,
    typeLabel,
    status: status.status,
    statusLabel: status.label,
    processor,
    paymentType,
    paymentTypeLabel: paymentTypeLabel(paymentType),
    source: event.source || (recurring ? 'recurring' : 'checkout'),
    isRecurring: recurring,
    paymentNumber,
    paymentsRemaining,
    processorTransactionId: event.processor_transaction_id || null,
    processorSubscriptionId: event.processor_subscription_id || linkedEnrollment?.processor_subscription_id || null,
    description: `${programName} - ${typeLabel}${progress}`,
    lineItems: normalizeLineItems(event.line_items),
    refundable: processor !== 'whop' && ['sale', 'payment_success', 'subscription_payment'].includes(String(event.event_type || '').toLowerCase()) && !event.failure_reason,
    dunningStatus: event.dunning_status || null,
    dunningRetryCount: event.dunning_retry_count || 0,
    dunningNextRetry: event.dunning_next_retry || null,
  };
}

export const paymentLedgerService = {
  async list(locationId: string, filters: PaymentLedgerFilters = {}): Promise<PaymentLedgerResult> {
    const limit = clampLimit(filters.limit);
    const offset = Math.max(0, Number(filters.offset || 0));
    const enrollmentFilterIds = await findMatchingEnrollmentIds(locationId, filters);

    if (enrollmentFilterIds && enrollmentFilterIds.length === 0) {
      return {
        payments: [],
        total: 0,
        limit,
        offset,
        summary: { totalCharged: 0, totalRefunded: 0, failedAmount: 0, visibleCount: 0 },
      };
    }

    const { events: rows, count } = await fetchPaymentEvents(locationId, filters, enrollmentFilterIds, limit, offset);
    const enrollmentMaps = await fetchEnrollmentMaps(locationId, rows);
    const allEnrollmentRows = new Map<string, any>([
      ...enrollmentMaps.byId,
      ...[...enrollmentMaps.byContact.values()].map((row: any) => [row.id, row] as [string, any]),
    ]);
    const offerMap = await fetchOfferMap(locationId, rows, allEnrollmentRows);

    const payments = rows.map((event: any) => {
      const linkedEnrollment = event.enrollment_id
        ? enrollmentMaps.byId.get(event.enrollment_id)
        : null;
      const contactEnrollment = linkedEnrollment || enrollmentMaps.byContact.get(event.contact_id);
      const offerId = event.offer_id || linkedEnrollment?.offer_id;
      const offer = offerId ? offerMap.get(offerId) : null;
      return buildRow(event, linkedEnrollment, contactEnrollment, offer);
    });

    const summary = payments.reduce(
      (acc: { totalCharged: number; totalRefunded: number; failedAmount: number; visibleCount: number }, payment: PaymentLedgerRow) => {
        if (payment.status === 'failed') acc.failedAmount += payment.amount;
        else if (payment.type === 'refund') acc.totalRefunded += payment.amount;
        else if (payment.status === 'paid') acc.totalCharged += payment.amount;
        return acc;
      },
      { totalCharged: 0, totalRefunded: 0, failedAmount: 0, visibleCount: payments.length },
    );

    return {
      payments,
      total: count || payments.length,
      limit,
      offset,
      summary,
    };
  },
};
