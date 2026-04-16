import { getSupabase } from '../clients/supabase.client';
import { resolveProcessor, createProcessorClient } from '../services/processor.factory';
import { handleRecurringPaymentSuccess, handleRecurringPaymentFailure } from '../services/recurring-payment.service';
import { logger } from '../utils/logger';

/**
 * Daily job: charge the next installment for any enrollment whose
 * next_billing_date is on or before today.
 *
 * Only runs for installment / subscription payment_types — PIF enrollments
 * never appear here because they don't have a next_billing_date.
 *
 * Card resolution depends on the funnel checkout having persisted the card
 * to payment_methods on enrollment (see checkout.controller.ts shouldSaveCard).
 * Without a row with is_default=true, the enrollment is logged + skipped.
 *
 * On success: logs payment_events ('sale'), advances next_billing_date,
 * increments payments_made, fires ss_payment_received, runs final-installment
 * detection → ss_program_completed.
 *
 * On failure: logs payment_events ('payment_failed') and hands off to
 * paymentLifecycleService.initiateDunning() which has its own retry schedule.
 */
export async function runRecurringBilling(): Promise<void> {
  const supabase = getSupabase();
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  let due: any[] = [];
  try {
    const { data, error } = await supabase
      .from('enrollments')
      .select('id, location_id, merchant_id, contact_id, offer_id, payment_type, payments_made, payments_total, next_billing_date, status, email')
      .lte('next_billing_date', today)
      .in('status', ['enrolled', 'active'])
      .in('payment_type', ['installments', 'installment', 'subscription'])
      .is('processor_subscription_id', null);

    if (error) {
      logger.error({ err: error.message }, 'Recurring billing query failed');
      return;
    }
    due = data || [];
  } catch (err: any) {
    logger.error({ err: err.message }, 'Recurring billing query threw');
    return;
  }

  if (due.length === 0) {
    logger.info({ today }, 'No recurring charges due');
    return;
  }

  let charged = 0;
  let failed = 0;
  let skipped = 0;

  for (const enr of due) {
    try {
      // Skip if final installment already collected (subscriptions never hit this — payments_total is null)
      if (enr.payment_type !== 'subscription' && enr.payments_total != null
          && (enr.payments_made || 0) >= enr.payments_total) {
        logger.info({ enrollmentId: enr.id }, 'Recurring billing: payments_made >= payments_total — skipping');
        skipped++;
        continue;
      }

      // 1. Load default payment method
      const { data: pm } = await supabase
        .from('payment_methods')
        .select('*')
        .eq('location_id', enr.location_id)
        .eq('contact_id', enr.contact_id)
        .eq('is_default', true)
        .limit(1)
        .maybeSingle();

      if (!pm) {
        logger.warn({ enrollmentId: enr.id, contactId: enr.contact_id }, 'Recurring billing: no default payment method — skipping (will require manual card update)');
        skipped++;
        continue;
      }

      // 2. Resolve offer for amount + frequency + name
      const { data: offer } = await supabase
        .from('offers_mirror')
        .select('id, offer_name, installment_amount, installment_frequency')
        .eq('id', enr.offer_id)
        .single();

      if (!offer || !offer.installment_amount) {
        logger.warn({ enrollmentId: enr.id, offerId: enr.offer_id }, 'Recurring billing: offer missing installment_amount — skipping');
        skipped++;
        continue;
      }

      const amountCents = Math.round(Number(offer.installment_amount) * 100);
      const amountDollars = Number(offer.installment_amount);

      // 3. Resolve processor
      const { config: procConfig } = await resolveProcessor(enr.merchant_id, enr.location_id);
      const processor = createProcessorClient(procConfig);

      const customerId = pm.nmi_customer_vault_id || pm.stripe_customer_id || '';
      const paymentMethodToken = pm.stripe_payment_method_id || pm.nmi_customer_vault_id || '';
      const nextPaymentNumber = (enr.payments_made || 0) + 1;

      // 4. Charge the saved card
      const result = await processor.chargeStoredCard(customerId, paymentMethodToken, {
        amount: amountCents,
        currency: 'usd',
        paymentToken: paymentMethodToken,
        description: `${offer.offer_name} — installment ${nextPaymentNumber}${enr.payments_total ? `/${enr.payments_total}` : ''}`,
        metadata: {
          scalesafe_enrollment_id: enr.id,
          scalesafe_offer_id: offer.id,
          payment_number: String(nextPaymentNumber),
          source: 'recurring_billing',
        },
      });

      if (result.success) {
        const { isFinal, newPaymentsMade, paymentEventId } = await handleRecurringPaymentSuccess({
          enrollment: enr,
          processorType: procConfig.processor_type,
          transactionId: result.transactionId,
          amountCents,
          offerName: offer.offer_name || '',
          installmentFrequency: offer.installment_frequency || 'monthly',
          source: 'recurring_billing',
        });

        charged++;
        logger.info({
          enrollmentId: enr.id,
          contactId: enr.contact_id,
          paymentNumber: newPaymentsMade,
          paymentsTotal: enr.payments_total,
          amount: amountDollars,
          isFinal,
          eventId: paymentEventId,
        }, 'Recurring billing: charge succeeded');
      } else {
        await handleRecurringPaymentFailure({
          enrollment: enr,
          processorType: procConfig.processor_type,
          amountCents,
          errorMessage: result.errorMessage || 'Unknown failure',
          errorCode: result.errorCode,
          source: 'recurring_billing',
        });

        failed++;
        logger.warn({
          enrollmentId: enr.id,
          contactId: enr.contact_id,
          reason: result.errorMessage,
          code: result.errorCode,
        }, 'Recurring billing: charge failed — dunning initiated');
      }
    } catch (err: any) {
      logger.error({ err: err.message, stack: err.stack, enrollmentId: enr.id }, 'Recurring billing: iteration threw');
      failed++;
    }
  }

  logger.info({ today, total: due.length, charged, failed, skipped }, 'Recurring billing batch complete');
}
