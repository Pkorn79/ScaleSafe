import { getSupabase } from '../clients/supabase.client';
import { idempotencyRepository } from '../repositories/idempotency.repository';
import { triggerService } from '../services/trigger.service';
import { logger } from '../utils/logger';

/**
 * Frequent job: scan enrollments for upcoming installment/subscription payments
 * due in 3 days and 1 day. Fires ss_upcoming_payment_reminder for each.
 * Idempotency keys prevent duplicate 3-day or 1-day reminders when the job runs hourly.
 */
export async function runPaymentReminderCheck(): Promise<{
  total: number;
  sent: number;
  skipped: number;
  reminders: Array<Awaited<ReturnType<typeof sendRemindersForDay>>>;
}> {
  const supabase = getSupabase();

  try {
    const results = await Promise.all(([3, 1] as const).map((daysUntilPayment) =>
      sendRemindersForDay(supabase, daysUntilPayment),
    ));

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

async function sendRemindersForDay(supabase: ReturnType<typeof getSupabase>, daysUntilPayment: 1 | 3): Promise<{
  daysUntilPayment: number;
  targetDate: string;
  total: number;
  sent: number;
  skipped: number;
}> {
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + daysUntilPayment);
  const targetDateStr = targetDate.toISOString().split('T')[0];

  const { data: enrollments, error } = await supabase
    .from('enrollments')
    .select('id, location_id, contact_id, offer_id, next_billing_date, payment_type, processor_type, payments_made, payments_total')
    .eq('next_billing_date', targetDateStr)
    .in('status', ['enrolled', 'active'])
    .in('payment_type', ['installments', 'installment', 'subscription']);

  if (error) {
    logger.error({ err: error.message, daysUntilPayment, targetDate: targetDateStr }, 'Payment reminder query failed');
    return { daysUntilPayment, targetDate: targetDateStr, total: 0, sent: 0, skipped: 0 };
  }
  if (!enrollments || enrollments.length === 0) {
    logger.info({ daysUntilPayment, targetDate: targetDateStr }, 'No upcoming payments for reminder window');
    return { daysUntilPayment, targetDate: targetDateStr, total: 0, sent: 0, skipped: 0 };
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
        `${daysUntilPayment}d`,
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
        days_until_payment: daysUntilPayment,
        daysUntilPayment,
        reminder_window: daysUntilPayment === 3 ? 'three_day' : 'one_day',
        reminderWindow: daysUntilPayment === 3 ? 'three_day' : 'one_day',
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
          days_until_payment: daysUntilPayment,
          next_billing_date: enr.next_billing_date,
          sent: result.sent,
          failed: result.failed,
        });
        sent++;
      } else {
        logger.warn(
          { enrollmentId: enr.id, daysUntilPayment, nextBillingDate: enr.next_billing_date },
          'Payment reminder trigger had no active successful deliveries',
        );
      }
    } catch (err: any) {
      logger.warn({ err: err.message, enrollmentId: enr.id, daysUntilPayment }, 'Payment reminder trigger failed');
    }
  }

  return { daysUntilPayment, targetDate: targetDateStr, total: enrollments.length, sent, skipped };
}
