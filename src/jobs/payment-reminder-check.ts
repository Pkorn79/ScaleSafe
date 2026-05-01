import { getSupabase } from '../clients/supabase.client';
import { triggerService } from '../services/trigger.service';
import { logger } from '../utils/logger';

/**
 * Daily job: scan enrollments for upcoming installment/subscription payments
 * due tomorrow. Fires ss_upcoming_payment_reminder for each.
 */
export async function runPaymentReminderCheck(): Promise<void> {
  const supabase = getSupabase();

  // Target date = tomorrow
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + 1);
  const targetDateStr = targetDate.toISOString().split('T')[0]; // YYYY-MM-DD

  try {
    const { data: enrollments, error } = await supabase
      .from('enrollments')
      .select('id, location_id, contact_id, offer_id, next_billing_date, payment_type, payments_made, payments_total')
      .eq('next_billing_date', targetDateStr)
      .in('status', ['enrolled', 'active'])
      .in('payment_type', ['installments', 'installment', 'subscription']);

    if (error) { logger.error({ err: error.message }, 'Payment reminder query failed'); return; }
    if (!enrollments || enrollments.length === 0) { logger.info('No upcoming payments tomorrow'); return; }

    let sent = 0;
    for (const enr of enrollments) {
      try {
        // Get offer details for amount and name
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

        const paymentsRemaining = (enr.payments_total || 0) - (enr.payments_made || 0);

        await triggerService.fireTrigger(enr.location_id, 'ss_upcoming_payment_reminder', {
          contact_id: enr.contact_id,
          amount,
          next_billing_date: enr.next_billing_date,
          payments_remaining: paymentsRemaining > 0 ? paymentsRemaining : 0,
          offer_name: offerName,
        });
        sent++;
      } catch (err: any) {
        logger.warn({ err: err.message, enrollmentId: enr.id }, 'Payment reminder trigger failed');
      }
    }

    logger.info({ total: enrollments.length, sent, targetDate: targetDateStr }, 'Payment reminder check complete');
  } catch (err: any) {
    logger.error({ err: err.message }, 'Payment reminder check failed');
  }
}
