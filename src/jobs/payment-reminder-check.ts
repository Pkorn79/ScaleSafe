import { getSupabase } from '../clients/supabase.client';
import { idempotencyRepository } from '../repositories/idempotency.repository';
import { triggerService } from '../services/trigger.service';
import { logger } from '../utils/logger';

/**
 * Frequent job: scan enrollments for upcoming installment/subscription payments
 * due in 3 days and within the next 24 hours. Fires ss_upcoming_payment_reminder
 * for each. Idempotency keys prevent duplicate reminders when the job runs hourly.
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

function dateOnly(date: Date): string {
  return date.toISOString().split('T')[0];
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
    .select('id, location_id, contact_id, offer_id, next_billing_date, payment_type, processor_type, payments_made, payments_total')
    .in('status', ['enrolled', 'active'])
    .in('payment_type', ['installments', 'installment', 'subscription']);

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
      if (await idempotencyRepository.exists(reminderEventId, 'payment_reminder')) {
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
        amount_display: `$${Number(amount || 0).toFixed(2)}`,
        amountDisplay: `$${Number(amount || 0).toFixed(2)}`,
        installment_amount: amount,
        installmentAmount: amount,
        program_name: offerName,
        programName: offerName,
        next_billing_date: enr.next_billing_date,
        nextBillingDate: enr.next_billing_date,
        next_payment_number: nextPaymentNumber,
        nextPaymentNumber,
        payments_made: paymentsMade,
        paymentsMade,
        payments_total: paymentsTotal,
        paymentsTotal,
        days_until_payment: window.daysUntilPayment,
        daysUntilPayment: window.daysUntilPayment,
        reminder_window: window.type,
        reminderWindow: window.type,
        payments_remaining: paymentsRemaining,
        paymentsRemaining,
        processor,
        support_email: supportEmail,
        supportEmail,
        business_name: businessName,
        businessName,
        offer_name: offerName,
        offerName,
        offer: {
          name: offerName,
          installment_amount: amount,
        },
        subscription: {
          next_billing_date: enr.next_billing_date,
          next_payment_number: nextPaymentNumber,
          payments_made: paymentsMade,
          payments_total: paymentsTotal,
          payments_remaining: paymentsRemaining,
        },
      };
      const result = await triggerService.fireTrigger(enr.location_id, 'ss_upcoming_payment_reminder', payload);
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
