import { getSupabase } from '../clients/supabase.client';
import { ghlApi } from '../clients/ghl.client';
import {
  OFFER_CONTACT_FIELDS,
  WORKFLOW_COMPAT_OFFER_CONTACT_FIELDS,
  WORKFLOW_PAYMENT_CONTACT_FIELDS,
} from '../constants/ghl-fields';
import { idempotencyRepository } from '../repositories/idempotency.repository';
import { triggerService } from '../services/trigger.service';
import { logger } from '../utils/logger';

/**
 * Frequent job: scan enrollments for upcoming installment/subscription payments
 * due in 3 days or within the next 24 hours. Fires the shared ss_app_event
 * trigger with event_type=upcoming_payment_reminder for each. Idempotency keys
 * prevent duplicate reminders when the job runs hourly.
 */
export async function runPaymentReminderCheck(): Promise<{
  total: number;
  sent: number;
  skipped: number;
  reminders: Array<Awaited<ReturnType<typeof sendRemindersForWindow>>>;
}> {
  const supabase = getSupabase();

  try {
    const results = await Promise.all([
      sendRemindersForWindow(supabase, { type: 'three_day', daysUntilPayment: 3 }),
      sendRemindersForWindow(supabase, { type: 'next_24_hours', daysUntilPayment: 1 }),
    ]);

    const summary = {
      total: results.reduce((sum, result) => sum + result.total, 0),
      sent: results.reduce((sum, result) => sum + result.sent, 0),
      skipped: results.reduce((sum, result) => sum + result.skipped, 0),
      reminders: results,
    };
    logger.info(summary, 'Payment reminder check complete');
    return summary;
  } catch (err: any) {
    logger.error({ err: err.message }, 'Payment reminder check failed');
    return { total: 0, sent: 0, skipped: 0, reminders: [] };
  }
}

type ReminderWindow = {
  type: 'three_day' | 'next_24_hours';
  daysUntilPayment: 1 | 3;
};

export interface PaymentReminderWindowDiagnostic {
  type: ReminderWindow['type'];
  daysUntilPayment: 1 | 3;
  targetDate: string;
  dueCount: number;
  eligibleCount: number;
  billingNotReadyCount: number;
  missingProcessorSubscriptionCount: number;
  idempotencySkippedCount: number;
  triggerMissingCount: number;
}

export interface PaymentReminderDiagnosticReport {
  activeAppEventSubscriptions: number;
  recentReminderSentAt: string | null;
  recentReminderNoSubscriptionAt: string | null;
  windows: PaymentReminderWindowDiagnostic[];
  totalDueCount: number;
  totalEligibleCount: number;
  totalBillingNotReadyCount: number;
  totalIdempotencySkippedCount: number;
  status: 'ready' | 'needs_setup' | 'no_due_payments';
  message: string;
}

function dateOnly(date: Date): string {
  return date.toISOString().split('T')[0];
}

function formatMoney(amount: number): string {
  return `$${Number(amount || 0).toFixed(2)}`;
}

function formatDateLabel(date: string | null | undefined): string {
  if (!date) return '';
  const parsed = new Date(`${String(date).slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return String(date);
  return parsed.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

async function syncReminderContactFields(params: {
  locationId: string;
  contactId?: string | null;
  offerName: string;
  amountDisplay: string;
  nextPaymentDateDisplay: string;
  paymentsMade: number;
  paymentsTotal: number;
  paymentsRemaining: number;
  supportEmail: string;
  businessName: string;
}): Promise<void> {
  if (!params.locationId || !params.contactId) return;

  const customField: Record<string, unknown> = {
    [OFFER_CONTACT_FIELDS.BUSINESS_NAME]: params.businessName,
    [OFFER_CONTACT_FIELDS.OFFER_NAME]: params.offerName,
    [OFFER_CONTACT_FIELDS.INSTALLMENT_AMOUNT]: params.amountDisplay,
    [OFFER_CONTACT_FIELDS.NUM_PAYMENTS]: params.paymentsTotal || '',
    [WORKFLOW_COMPAT_OFFER_CONTACT_FIELDS.PROGRAM_NAME]: params.offerName,
    [WORKFLOW_COMPAT_OFFER_CONTACT_FIELDS.NUMBER_OF_PAYMENTS]: params.paymentsTotal || '',
    [WORKFLOW_COMPAT_OFFER_CONTACT_FIELDS.SUPPORT_EMAIL]: params.supportEmail,
    [WORKFLOW_PAYMENT_CONTACT_FIELDS.PAYMENT_STATUS]: 'Current',
    [WORKFLOW_PAYMENT_CONTACT_FIELDS.LAST_PAYMENT_AMOUNT]: params.amountDisplay,
    [WORKFLOW_PAYMENT_CONTACT_FIELDS.NEXT_PAYMENT_DATE]: params.nextPaymentDateDisplay,
    [WORKFLOW_PAYMENT_CONTACT_FIELDS.PAYMENTS_MADE]: params.paymentsMade,
    [WORKFLOW_PAYMENT_CONTACT_FIELDS.PAYMENTS_REMAINING]: params.paymentsRemaining,
  };

  try {
    const api = await ghlApi(params.locationId);
    await api.put(`/contacts/${params.contactId}`, { customField });
  } catch (err: any) {
    logger.warn(
      {
        err: err?.message || String(err),
        locationId: params.locationId,
        contactId: params.contactId,
      },
      'Failed to sync upcoming payment reminder contact fields; continuing with trigger delivery',
    );
  }
}

function reminderWindows(now = new Date()): Array<ReminderWindow & { targetDate: string }> {
  return [
    { type: 'three_day', daysUntilPayment: 3, targetDate: dateOnly(new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)) },
    { type: 'next_24_hours', daysUntilPayment: 1, targetDate: dateOnly(new Date(now.getTime() + 24 * 60 * 60 * 1000)) },
  ];
}

function enrollmentInWindow(enrollment: any, window: ReminderWindow & { targetDate: string }, todayStr: string): boolean {
  const nextDate = String(enrollment.next_billing_date || '');
  if (!nextDate) return false;
  if (window.type === 'three_day') return nextDate === window.targetDate;
  return nextDate >= todayStr && nextDate <= window.targetDate;
}

function isBillingReady(enrollment: any): boolean {
  return String(enrollment.billing_setup_status || 'ok').toLowerCase() === 'ok';
}

function needsProcessorSubscription(enrollment: any): boolean {
  const processor = String(enrollment.processor_type || '').toLowerCase();
  return ['stripe', 'nmi', 'whop'].includes(processor) && !enrollment.processor_subscription_id;
}

export async function getPaymentReminderDiagnostics(locationId: string): Promise<PaymentReminderDiagnosticReport> {
  const supabase = getSupabase();
  const now = new Date();
  const todayStr = dateOnly(now);
  const windows = reminderWindows(now);
  const maxTargetDate = windows.reduce((max, window) => window.targetDate > max ? window.targetDate : max, todayStr);

  const [
    enrollmentRes,
    subscriptionRes,
    idempotencyRes,
    logsRes,
  ] = await Promise.all([
    supabase
      .from('enrollments')
      .select('id, location_id, contact_id, offer_id, next_billing_date, payment_type, processor_type, processor_subscription_id, billing_setup_status, status')
      .eq('location_id', locationId)
      .in('status', ['enrolled', 'active'])
      .in('payment_type', ['installments', 'installment', 'subscription'])
      .gte('next_billing_date', todayStr)
      .lte('next_billing_date', maxTargetDate),
    supabase
      .from('trigger_subscriptions')
      .select('id')
      .eq('location_id', locationId)
      .eq('trigger_key', 'ss_app_event')
      .eq('is_active', true),
    supabase
      .from('idempotency_keys')
      .select('event_id, processed_at')
      .eq('location_id', locationId)
      .eq('source', 'payment_reminder')
      .order('processed_at', { ascending: false })
      .limit(200),
    supabase
      .from('trigger_delivery_logs')
      .select('status, payload, created_at')
      .eq('location_id', locationId)
      .eq('trigger_key', 'ss_app_event')
      .order('created_at', { ascending: false })
      .limit(200),
  ]);

  if (enrollmentRes.error) throw enrollmentRes.error;
  if (subscriptionRes.error) throw subscriptionRes.error;
  if (idempotencyRes.error) throw idempotencyRes.error;
  if (logsRes.error) throw logsRes.error;

  const enrollments = enrollmentRes.data || [];
  const activeAppEventSubscriptions = (subscriptionRes.data || []).length;
  const idempotencyIds = new Set((idempotencyRes.data || []).map((row: any) => row.event_id));
  const logs = (logsRes.data || []).filter((log: any) => log.payload?.event_type === 'upcoming_payment_reminder');
  const recentReminderSentAt = logs.find((log: any) => log.status === 'sent')?.created_at || null;
  const recentReminderNoSubscriptionAt = logs.find((log: any) => log.status === 'no_subscription')?.created_at || null;

  const windowDiagnostics = windows.map((window) => {
    const due = enrollments.filter((enrollment: any) => enrollmentInWindow(enrollment, window, todayStr));
    const billingReady = due.filter(isBillingReady);
    const processorReady = billingReady.filter((enrollment: any) => !needsProcessorSubscription(enrollment));
    const idempotencySkippedCount = processorReady.filter((enrollment: any) => idempotencyIds.has([
      'payment-reminder',
      enrollment.location_id,
      enrollment.id,
      enrollment.next_billing_date,
      window.type,
    ].join(':'))).length;
    const eligibleCount = processorReady.filter((enrollment: any) => !idempotencyIds.has([
      'payment-reminder',
      enrollment.location_id,
      enrollment.id,
      enrollment.next_billing_date,
      window.type,
    ].join(':'))).length;
    return {
      type: window.type,
      daysUntilPayment: window.daysUntilPayment,
      targetDate: window.targetDate,
      dueCount: due.length,
      eligibleCount,
      billingNotReadyCount: due.filter((enrollment: any) => !isBillingReady(enrollment)).length,
      missingProcessorSubscriptionCount: due.filter(needsProcessorSubscription).length,
      idempotencySkippedCount,
      triggerMissingCount: activeAppEventSubscriptions === 0 && eligibleCount > 0 ? eligibleCount : 0,
    };
  });

  const totalDueCount = windowDiagnostics.reduce((sum, item) => sum + item.dueCount, 0);
  const totalEligibleCount = windowDiagnostics.reduce((sum, item) => sum + item.eligibleCount, 0);
  const totalBillingNotReadyCount = windowDiagnostics.reduce((sum, item) => sum + item.billingNotReadyCount, 0);
  const totalIdempotencySkippedCount = windowDiagnostics.reduce((sum, item) => sum + item.idempotencySkippedCount, 0);
  const status = totalDueCount === 0
    ? 'no_due_payments'
    : activeAppEventSubscriptions === 0 || totalBillingNotReadyCount > 0
      ? 'needs_setup'
      : 'ready';
  const message = totalDueCount === 0
    ? 'No recurring payments are currently inside the reminder windows.'
    : activeAppEventSubscriptions === 0
      ? 'Recurring payments are due, but the ScaleSafe App Event workflow is not subscribed.'
      : totalBillingNotReadyCount > 0
        ? `${totalBillingNotReadyCount} due payment(s) are waiting on processor billing setup.`
        : `${totalEligibleCount} reminder(s) are eligible to send.`;

  return {
    activeAppEventSubscriptions,
    recentReminderSentAt,
    recentReminderNoSubscriptionAt,
    windows: windowDiagnostics,
    totalDueCount,
    totalEligibleCount,
    totalBillingNotReadyCount,
    totalIdempotencySkippedCount,
    status,
    message,
  };
}

async function sendRemindersForWindow(supabase: ReturnType<typeof getSupabase>, window: ReminderWindow): Promise<{
  daysUntilPayment: number;
  targetDate: string;
  reminderWindow: string;
  total: number;
  sent: number;
  skipped: number;
}> {
  const today = new Date();
  const targetDate = new Date(today);
  targetDate.setDate(targetDate.getDate() + window.daysUntilPayment);
  const targetDateStr = dateOnly(targetDate);
  const todayStr = dateOnly(today);

  const baseQuery = supabase
    .from('enrollments')
    .select('id, location_id, contact_id, offer_id, next_billing_date, payment_type, processor_type, processor_subscription_id, payments_made, payments_total')
    .in('status', ['enrolled', 'active'])
    .in('payment_type', ['installments', 'installment', 'subscription'])
    // Batch H: never remind for an enrollment whose processor billing setup did not complete
    // (failed / needs_reconciliation / still pending); those have no live subscription.
    .eq('billing_setup_status', 'ok');

  const { data: enrollments, error } = window.type === 'next_24_hours'
    ? await baseQuery
        .gte('next_billing_date', todayStr)
        .lte('next_billing_date', targetDateStr)
    : await baseQuery.eq('next_billing_date', targetDateStr);

  if (error) {
    logger.error({ err: error.message, daysUntilPayment: window.daysUntilPayment, reminderWindow: window.type, targetDate: targetDateStr }, 'Payment reminder query failed');
    return { daysUntilPayment: window.daysUntilPayment, reminderWindow: window.type, targetDate: targetDateStr, total: 0, sent: 0, skipped: 0 };
  }
  if (!enrollments || enrollments.length === 0) {
    logger.info({ daysUntilPayment: window.daysUntilPayment, reminderWindow: window.type, targetDate: targetDateStr }, 'No upcoming payments for reminder window');
    return { daysUntilPayment: window.daysUntilPayment, reminderWindow: window.type, targetDate: targetDateStr, total: 0, sent: 0, skipped: 0 };
  }

  let sent = 0;
  let skipped = 0;
  for (const enr of enrollments) {
    try {
      const reminderEventId = [
        'payment-reminder',
        enr.location_id,
        enr.id,
        enr.next_billing_date,
        window.type,
      ].join(':');
      if (needsProcessorSubscription(enr)) {
        skipped++;
        logger.warn(
          {
            enrollmentId: enr.id,
            locationId: enr.location_id,
            processor: enr.processor_type,
            daysUntilPayment: window.daysUntilPayment,
            reminderWindow: window.type,
            nextBillingDate: enr.next_billing_date,
          },
          'Payment reminder skipped because processor subscription ID is missing',
        );
        continue;
      }
      if (await idempotencyRepository.exists(reminderEventId, 'payment_reminder', enr.location_id)) {
        skipped++;
        continue;
      }

      let amount = 0;
      let offerName = '';
      let processor = '';
      if (enr.offer_id) {
        const { data: offer } = await supabase
          .from('offers_mirror')
          .select('offer_name, installment_amount, price, processor_override')
          .eq('id', enr.offer_id)
          .single();
        offerName = offer?.offer_name || '';
        amount = offer?.installment_amount || offer?.price || 0;
        processor = enr.processor_type || offer?.processor_override || '';
      }

      let supportEmail = '';
      let businessName = '';
      try {
        const { data: merchant } = await supabase
          .from('merchants')
          .select('business_name, dba_name, support_email, email')
          .eq('location_id', enr.location_id)
          .single();
        supportEmail = merchant?.support_email || merchant?.email || '';
        businessName = merchant?.dba_name || merchant?.business_name || '';
      } catch {}

      const paymentsMade = enr.payments_made || 0;
      const paymentsTotal = enr.payments_total || 0;
      const nextPaymentNumber = paymentsMade + 1;
      const paymentsRemaining = Math.max(0, paymentsTotal - paymentsMade);
      const amountDisplay = formatMoney(amount);
      const nextPaymentDate = String(enr.next_billing_date || '');
      const nextPaymentDateDisplay = formatDateLabel(nextPaymentDate);
      const paymentNumberDisplay = paymentsTotal
        ? `${nextPaymentNumber} of ${paymentsTotal}`
        : String(nextPaymentNumber);

      const payload = {
        event_type: 'upcoming_payment_reminder',
        location_id: enr.location_id,
        locationId: enr.location_id,
        contact_id: enr.contact_id,
        contactId: enr.contact_id,
        enrollment_id: enr.id,
        enrollmentId: enr.id,
        offer_id: enr.offer_id,
        offerId: enr.offer_id,
        amount,
        amount_display: amountDisplay,
        amountDisplay,
        amount_formatted: amountDisplay,
        amountFormatted: amountDisplay,
        amount_text: amountDisplay,
        amountText: amountDisplay,
        payment_amount: amount,
        paymentAmount: amount,
        payment_amount_display: amountDisplay,
        paymentAmountDisplay: amountDisplay,
        installment_amount: amount,
        installmentAmount: amount,
        installment_amount_display: amountDisplay,
        installmentAmountDisplay: amountDisplay,
        program_name: offerName,
        programName: offerName,
        next_billing_date: nextPaymentDate,
        nextBillingDate: nextPaymentDate,
        next_billing_date_display: nextPaymentDateDisplay,
        nextBillingDateDisplay: nextPaymentDateDisplay,
        next_payment_date: nextPaymentDate,
        nextPaymentDate,
        next_payment_date_display: nextPaymentDateDisplay,
        nextPaymentDateDisplay: nextPaymentDateDisplay,
        due_date: nextPaymentDate,
        dueDate: nextPaymentDate,
        due_date_display: nextPaymentDateDisplay,
        dueDateDisplay: nextPaymentDateDisplay,
        next_payment_number: nextPaymentNumber,
        nextPaymentNumber,
        payment_number: nextPaymentNumber,
        paymentNumber: nextPaymentNumber,
        payment_number_display: paymentNumberDisplay,
        paymentNumberDisplay: paymentNumberDisplay,
        payments_made: paymentsMade,
        paymentsMade,
        payments_total: paymentsTotal,
        paymentsTotal,
        total_payments: paymentsTotal,
        totalPayments: paymentsTotal,
        number_of_payments: paymentsTotal,
        numberOfPayments: paymentsTotal,
        days_until_payment: window.daysUntilPayment,
        daysUntilPayment: window.daysUntilPayment,
        reminder_window: window.type,
        reminderWindow: window.type,
        payments_remaining: paymentsRemaining,
        paymentsRemaining,
        processor,
        support_email: supportEmail,
        supportEmail,
        merchant_support_email: supportEmail,
        merchantSupportEmail: supportEmail,
        offer_support_email: supportEmail,
        offerSupportEmail: supportEmail,
        business_name: businessName,
        businessName,
        merchant_business_name: businessName,
        merchantBusinessName: businessName,
        offer_business_name: businessName,
        offerBusinessName: businessName,
        offer_name: offerName,
        offerName,
        offer: {
          name: offerName,
          installment_amount: amount,
          installment_amount_display: amountDisplay,
          support_email: supportEmail,
          business_name: businessName,
        },
        merchant: {
          business_name: businessName,
          support_email: supportEmail,
        },
        subscription: {
          next_billing_date: nextPaymentDate,
          next_billing_date_display: nextPaymentDateDisplay,
          next_payment_date: nextPaymentDate,
          next_payment_date_display: nextPaymentDateDisplay,
          next_payment_number: nextPaymentNumber,
          payment_number: nextPaymentNumber,
          payment_number_display: paymentNumberDisplay,
          payments_made: paymentsMade,
          payments_total: paymentsTotal,
          payments_remaining: paymentsRemaining,
        },
      };

      await syncReminderContactFields({
        locationId: enr.location_id,
        contactId: enr.contact_id,
        offerName,
        amountDisplay,
        nextPaymentDateDisplay,
        paymentsMade,
        paymentsTotal,
        paymentsRemaining,
        supportEmail,
        businessName,
      });

      const result = await triggerService.fireTrigger(enr.location_id, 'ss_app_event', payload);
      if (result.sent > 0) {
        await idempotencyRepository.record(reminderEventId, 'payment_reminder', enr.location_id, {
          days_until_payment: window.daysUntilPayment,
          reminder_window: window.type,
          next_billing_date: enr.next_billing_date,
          sent: result.sent,
          failed: result.failed,
        });
        sent++;
      } else {
        logger.warn(
          { enrollmentId: enr.id, daysUntilPayment: window.daysUntilPayment, reminderWindow: window.type, nextBillingDate: enr.next_billing_date },
          'Payment reminder trigger had no active successful deliveries',
        );
      }
    } catch (err: any) {
      logger.warn({ err: err.message, enrollmentId: enr.id, daysUntilPayment: window.daysUntilPayment, reminderWindow: window.type }, 'Payment reminder trigger failed');
    }
  }

  return { daysUntilPayment: window.daysUntilPayment, reminderWindow: window.type, targetDate: targetDateStr, total: enrollments.length, sent, skipped };
}
