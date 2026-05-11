import { getSupabase } from '../clients/supabase.client';

type IssuePriority = 'high' | 'medium' | 'low';

interface ReconciliationOptions {
  lookbackDays?: number;
}

interface ReconciliationIssue {
  id: string;
  priority: IssuePriority;
  type: string;
  title: string;
  detail: string;
  contactId: string | null;
  customerName: string;
  customerEmail: string;
  enrollmentId: string | null;
  offerId: string | null;
  programName: string;
  processor: string;
  paymentType: string;
  amount: number | null;
  eventId: string | null;
  transactionId: string | null;
  subscriptionId: string | null;
  eventDate: string | null;
}

interface ReconciliationResult {
  checkedAt: string;
  lookbackDays: number;
  summary: {
    issueCount: number;
    high: number;
    medium: number;
    low: number;
    activeRecurringEnrollments: number;
    paymentEventsScanned: number;
    processors: Record<string, number>;
  };
  issues: ReconciliationIssue[];
}

const ENROLLMENT_COLUMNS = [
  'id',
  'contact_id',
  'email',
  'first_name',
  'last_name',
  'digital_signature',
  'offer_id',
  'status',
  'payment_type',
  'payment_amount',
  'processor_type',
  'processor_subscription_id',
  'payments_made',
  'payments_total',
  'next_billing_date',
  'billing_completed_at',
  'completed_at',
  'cancelled_at',
  'enrolled_at',
  'created_at',
].join(', ');

const EVENT_COLUMNS = [
  'id',
  'contact_id',
  'enrollment_id',
  'offer_id',
  'event_type',
  'processor',
  'processor_transaction_id',
  'processor_subscription_id',
  'amount',
  'failure_reason',
  'source',
  'is_recurring',
  'payment_number',
  'payments_total',
  'created_at',
].join(', ');

const OFFER_COLUMNS = 'id, offer_name, payment_type, price, installment_amount, installment_frequency, num_payments';

function clampLookbackDays(value: unknown): number {
  const parsed = Number(value || 30);
  if (!Number.isFinite(parsed)) return 30;
  return Math.min(365, Math.max(1, Math.floor(parsed)));
}

function isRecurringType(value: unknown): boolean {
  const type = String(value || '').toLowerCase();
  return ['installment', 'installments', 'subscription'].includes(type);
}

function isActiveStatus(value: unknown): boolean {
  const status = String(value || '').toLowerCase();
  return ['enrolled', 'active', 'paused'].includes(status);
}

function isPaidEvent(event: any): boolean {
  return ['sale', 'subscription_payment', 'capture'].includes(String(event?.event_type || '').toLowerCase());
}

function isFailureEvent(event: any): boolean {
  return String(event?.event_type || '').toLowerCase() === 'payment_failed' || Boolean(event?.failure_reason);
}

function displayName(enrollment: any): string {
  const first = String(enrollment?.first_name || '').trim();
  const last = String(enrollment?.last_name || '').trim();
  const full = [first, last].filter(Boolean).join(' ').trim();
  if (full) return full;
  if (enrollment?.digital_signature) return String(enrollment.digital_signature);
  if (enrollment?.email) return String(enrollment.email);
  if (enrollment?.contact_id) return String(enrollment.contact_id).slice(0, 12);
  return 'Unknown client';
}

function normalizeProcessor(value: unknown): string {
  return String(value || '').toLowerCase() || 'unknown';
}

function normalizePaymentType(value: unknown): string {
  const type = String(value || '').toLowerCase();
  if (type === 'installments') return 'installment';
  if (type === 'one_time' || type === 'paid_in_full') return 'pif';
  return type || 'unknown';
}

function daysBetweenDates(earlier: string, later: Date): number {
  const earlierDate = new Date(`${earlier}T00:00:00.000Z`);
  const laterDate = new Date(Date.UTC(later.getUTCFullYear(), later.getUTCMonth(), later.getUTCDate()));
  const ms = laterDate.getTime() - earlierDate.getTime();
  return Math.floor(ms / 86400000);
}

function issueBase(
  type: string,
  priority: IssuePriority,
  title: string,
  detail: string,
  enrollment: any | null,
  offer: any | null,
  event: any | null = null,
  contextEnrollment: any | null = null,
): ReconciliationIssue {
  const displayEnrollment = enrollment || contextEnrollment;
  const processor = normalizeProcessor(event?.processor || enrollment?.processor_type);
  const eventIsUnlinked = Boolean(event) && !enrollment;
  return {
    id: `${type}:${event?.id || enrollment?.id || event?.processor_transaction_id || Math.random().toString(36).slice(2)}`,
    priority,
    type,
    title,
    detail,
    contactId: event?.contact_id || displayEnrollment?.contact_id || null,
    customerName: displayEnrollment ? displayName(displayEnrollment) : 'Unknown client',
    customerEmail: String(displayEnrollment?.email || '').trim(),
    enrollmentId: event?.enrollment_id || enrollment?.id || null,
    offerId: event?.offer_id || enrollment?.offer_id || offer?.id || null,
    programName: offer?.offer_name || (eventIsUnlinked ? 'Unassigned payment' : 'Unassigned program'),
    processor,
    paymentType: normalizePaymentType(enrollment?.payment_type || offer?.payment_type),
    amount: event?.amount == null ? null : Number(event.amount),
    eventId: event?.id || null,
    transactionId: event?.processor_transaction_id || null,
    subscriptionId: event?.processor_subscription_id || enrollment?.processor_subscription_id || null,
    eventDate: event?.created_at || null,
  };
}

function priorityRank(priority: IssuePriority): number {
  if (priority === 'high') return 0;
  if (priority === 'medium') return 1;
  return 2;
}

async function fetchOffers(locationId: string, enrollments: any[], events: any[]) {
  const ids = new Set<string>();
  for (const enrollment of enrollments) if (enrollment.offer_id) ids.add(enrollment.offer_id);
  for (const event of events) if (event.offer_id) ids.add(event.offer_id);
  if (ids.size === 0) return new Map<string, any>();

  const { data, error } = await getSupabase()
    .from('offers_mirror')
    .select(OFFER_COLUMNS)
    .eq('location_id', locationId)
    .in('id', [...ids]);
  if (error) throw error;
  return new Map((data || []).map((offer: any) => [offer.id, offer]));
}

export const paymentReconciliationService = {
  async report(locationId: string, options: ReconciliationOptions = {}): Promise<ReconciliationResult> {
    const lookbackDays = clampLookbackDays(options.lookbackDays);
    const since = new Date(Date.now() - lookbackDays * 86400000).toISOString();
    const supabase = getSupabase();

    const [enrollmentResponse, eventResponse] = await Promise.all([
      supabase
        .from('enrollments')
        .select(ENROLLMENT_COLUMNS)
        .eq('location_id', locationId)
        .order('created_at', { ascending: false })
        .limit(1000),
      supabase
        .from('payment_events')
        .select(EVENT_COLUMNS)
        .eq('location_id', locationId)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(2000),
    ]);

    if (enrollmentResponse.error) throw enrollmentResponse.error;
    if (eventResponse.error) throw eventResponse.error;

    const enrollments = (enrollmentResponse.data || []) as any[];
    const events = (eventResponse.data || []) as any[];
    const offerMap = await fetchOffers(locationId, enrollments, events);
    const enrollmentMap = new Map(enrollments.map((enrollment: any) => [enrollment.id, enrollment]));
    const contactEnrollmentMap = new Map<string, any>();
    for (const enrollment of enrollments) {
      if (enrollment.contact_id && !contactEnrollmentMap.has(enrollment.contact_id)) {
        contactEnrollmentMap.set(enrollment.contact_id, enrollment);
      }
    }

    const issues: ReconciliationIssue[] = [];
    const processors: Record<string, number> = {};
    let activeRecurringEnrollments = 0;
    const today = new Date();

    for (const enrollment of enrollments) {
      const offer = enrollment.offer_id ? offerMap.get(enrollment.offer_id) : null;
      const paymentType = normalizePaymentType(enrollment.payment_type || offer?.payment_type);
      const processor = normalizeProcessor(enrollment.processor_type);
      processors[processor] = (processors[processor] || 0) + 1;

      if (!isRecurringType(paymentType)) continue;
      if (isActiveStatus(enrollment.status)) activeRecurringEnrollments += 1;

      const paymentsMade = Number(enrollment.payments_made || 0);
      const paymentsTotal = enrollment.payments_total == null ? null : Number(enrollment.payments_total);
      const billingComplete = Boolean(enrollment.billing_completed_at)
        || (paymentType === 'installment' && paymentsTotal != null && paymentsTotal > 0 && paymentsMade >= paymentsTotal);

      if (isActiveStatus(enrollment.status) && processor === 'unknown') {
        issues.push(issueBase(
          'missing_processor',
          'high',
          'Recurring plan missing processor',
          'This recurring enrollment cannot be reliably reconciled or controlled because processor_type is blank.',
          enrollment,
          offer,
        ));
      }

      if (isActiveStatus(enrollment.status) && !billingComplete && !enrollment.processor_subscription_id) {
        issues.push(issueBase(
          'missing_subscription_id',
          'high',
          'Recurring plan missing subscription ID',
          'This plan is still active but has no processor subscription id on the enrollment.',
          enrollment,
          offer,
        ));
      }

      if (paymentType === 'installment' && paymentsTotal != null && paymentsTotal > 0 && paymentsMade >= paymentsTotal) {
        if (!enrollment.billing_completed_at) {
          issues.push(issueBase(
            'billing_complete_not_marked',
            'medium',
            'Installment appears paid off but billing is not marked complete',
            `${paymentsMade} of ${paymentsTotal} payments are recorded, but billing_completed_at is empty.`,
            enrollment,
            offer,
          ));
        }
        if (String(enrollment.status || '').toLowerCase() === 'completed') {
          issues.push(issueBase(
            'program_completed_after_payoff',
            'medium',
            'Program is completed after installment payoff',
            'Billing payoff should not complete the client program by itself. Review whether this was manually completed or historical drift.',
            enrollment,
            offer,
          ));
        }
      }

      if (isActiveStatus(enrollment.status) && !billingComplete && enrollment.next_billing_date) {
        const overdueDays = daysBetweenDates(String(enrollment.next_billing_date).slice(0, 10), today);
        if (overdueDays > 1) {
          issues.push(issueBase(
            'overdue_next_billing',
            overdueDays >= 7 ? 'high' : 'medium',
            'Recurring plan has an overdue next billing date',
            `Next billing date is ${overdueDays} days in the past. This may mean a missed webhook, failed billing, or stale enrollment state.`,
            enrollment,
            offer,
          ));
        }
      }
    }

    const transactionGroups = new Map<string, any[]>();
    for (const event of events) {
      const linkedEnrollment = event.enrollment_id ? enrollmentMap.get(event.enrollment_id) : null;
      const contactEnrollment = !linkedEnrollment && event.contact_id ? contactEnrollmentMap.get(event.contact_id) : null;
      const offer = (event.offer_id ? offerMap.get(event.offer_id) : null)
        || (linkedEnrollment?.offer_id ? offerMap.get(linkedEnrollment.offer_id) : null);
      const eventProcessor = normalizeProcessor(event.processor);
      const enrollmentProcessor = normalizeProcessor(linkedEnrollment?.processor_type);

      if (eventProcessor !== 'unknown') processors[eventProcessor] = (processors[eventProcessor] || 0) + 1;

      if (event.processor_transaction_id) {
        const key = `${eventProcessor}:${event.processor_transaction_id}`;
        const group = transactionGroups.get(key) || [];
        group.push(event);
        transactionGroups.set(key, group);
      }

      if (event.enrollment_id && linkedEnrollment && eventProcessor !== 'unknown' && enrollmentProcessor !== 'unknown' && eventProcessor !== enrollmentProcessor) {
        issues.push(issueBase(
          'processor_mismatch',
          'high',
          'Payment processor does not match enrollment processor',
          `Payment event processor is ${eventProcessor}, but the enrollment processor is ${enrollmentProcessor}.`,
          linkedEnrollment,
          offer,
          event,
        ));
      }

      if ((isPaidEvent(event) || isFailureEvent(event)) && !event.enrollment_id) {
        issues.push(issueBase(
          'unassigned_payment_event',
          'medium',
          'Payment event is not tied to an enrollment',
          'This payment exists in ScaleSafe but is not connected to a specific program enrollment.',
          null,
          offer,
          event,
          contactEnrollment || null,
        ));
      }

      if (isPaidEvent(event) && !event.processor_transaction_id) {
        issues.push(issueBase(
          'missing_transaction_id',
          'medium',
          'Paid event missing processor transaction ID',
          'This payment is marked paid but has no processor transaction id, making processor reconciliation difficult.',
          linkedEnrollment || null,
          offer,
          event,
          contactEnrollment || null,
        ));
      }

      if (isFailureEvent(event)) {
        issues.push(issueBase(
          'recent_failed_payment',
          event.is_recurring ? 'high' : 'medium',
          'Recent failed payment',
          event.failure_reason || 'A recent payment_failed event was recorded.',
          linkedEnrollment || null,
          offer,
          event,
          contactEnrollment || null,
        ));
      }
    }

    for (const [key, group] of transactionGroups.entries()) {
      if (group.length <= 1) continue;
      const first = group[0];
      const linkedEnrollment = first.enrollment_id ? enrollmentMap.get(first.enrollment_id) : null;
      const contactEnrollment = !linkedEnrollment && first.contact_id ? contactEnrollmentMap.get(first.contact_id) : null;
      const offer = (first.offer_id ? offerMap.get(first.offer_id) : null)
        || (linkedEnrollment?.offer_id ? offerMap.get(linkedEnrollment.offer_id) : null);
      issues.push(issueBase(
        'duplicate_transaction_id',
        'high',
        'Duplicate processor transaction ID',
        `${group.length} payment_events rows share ${key}. This can inflate reporting or double-fire workflows.`,
        linkedEnrollment || null,
        offer,
        first,
        contactEnrollment || null,
      ));
    }

    issues.sort((a, b) => {
      const rank = priorityRank(a.priority) - priorityRank(b.priority);
      if (rank !== 0) return rank;
      return String(b.eventDate || '').localeCompare(String(a.eventDate || ''));
    });

    const summary = issues.reduce(
      (acc, issue) => {
        acc.issueCount += 1;
        acc[issue.priority] += 1;
        return acc;
      },
      {
        issueCount: 0,
        high: 0,
        medium: 0,
        low: 0,
        activeRecurringEnrollments,
        paymentEventsScanned: events.length,
        processors,
      },
    );

    return {
      checkedAt: new Date().toISOString(),
      lookbackDays,
      summary,
      issues,
    };
  },
};
