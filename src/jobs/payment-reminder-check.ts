import { getSupabase } from '../clients/supabase.client';
import { triggerService } from '../services/trigger.service';
import { logger } from '../utils/logger';

/**
 * Daily job: scan enrollments for upcoming installment/subscription payments
 * due in 3 days and 1 day. Fires ss_upcoming_payment_reminder for each.
 */
export async function runPaymentReminderCheck(): Promise<void> {
  const supabase = getSupabase();

  try {
    const results = await Promise.all(([3, 1] as const).map((daysUntilPayment) =>
      sendRemindersForDay(supabase, daysUntilPayment),
    ));

    logger.info({
      total: results.reduce((sum, result) => sum + result.total, 0),
      sent: results.reduce((sum, result) => sum + result.sent, 0),
      reminders: results,
    }, 'Payment reminder check complete');
  } catch (err: any) {
    logger.error({ err: err.message }, 'Payment reminder check failed');
  }
}

async function sendRemindersForDay(supabase: ReturnType<typeof getSupabase>, daysUntilPayment: 1 | 3): Promise<{
  daysUntilPayment: number;
  targetDate: string;
  total: number;
  sent: number;
}> {
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + daysUntilPayment);
  const targetDateStr = targetDate.toISOString().split('T')[0];

  const { data: enrollments, error } = await supabase
    .from('enrollments')
    .select('id, location_id, contact_id, offer_id, next_billing_date, payment_type, payments_made, payments_total')
    .eq('next_billing_date', targetDateStr)
    .in('status', ['enrolled', 'active'])
    .in('payment_type', ['installments', 'installment', 'subscription']);

  if (error) {
    logger.error({ err: error.message, daysUntilPayment, targetDate: targetDateStr }, 'Payment reminder query failed');
    return { daysUntilPayment, targetDate: targetDateStr, total: 0, sent: 0 };
  }
  if (!enrollments || enrollments.length === 0) {
    logger.info({ daysUntilPayment, targetDate: targetDateStr }, 'No upcoming payments for reminder window');
    return { daysUntilPayment, targetDate: targetDateStr, total: 0, sent: 0 };
  }

  let sent = 0;
  for (const enr of enrollments) {
    try {
      let amount = 0;
      let offerName = '';
      if (enr.offer_id) {
        const { data: offer } = await supabase
          .from('offers_mirror')
          .select('offer_name, installment_amount, price')
          .eq('id', enr.offer_id)
          .single();
        offerName = offer?.offer_name || '';
        amount = offer?.installment_amount || offer?.price || 0;
      }

      const paymentsMade = enr.payments_made || 0;
      const paymentsTotal = enr.payments_total || 0;
      const nextPaymentNumber = paymentsMade + 1;
      const paymentsRemaining = Math.max(0, paymentsTotal - paymentsMade);

      await triggerService.fireTrigger(enr.location_id, 'ss_upcoming_payment_reminder', {
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
        installment_amount: amount,
        installmentAmount: amount,
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
      });
      sent++;
    } catch (err: any) {
      logger.warn({ err: err.message, enrollmentId: enr.id, daysUntilPayment }, 'Payment reminder trigger failed');
    }
  }

  return { daysUntilPayment, targetDate: targetDateStr, total: enrollments.length, sent };
}
