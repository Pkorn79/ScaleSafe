import { getSupabase } from '../clients/supabase.client';
import { resolveProcessor, createProcessorClient } from '../services/processor.factory';
import { paymentLifecycleService } from '../services/payment-lifecycle.service';
import { triggerService } from '../services/trigger.service';
import { evidenceService } from '../services/evidence.service';
import { EVIDENCE_TYPES } from '../constants/evidence-types';
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
      .in('payment_type', ['installments', 'installment', 'subscription']);

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
        // 5a. Log payment_events row (event_type='sale' so clientInfo.totalCharged picks it up)
        const { data: insertedEvent } = await supabase
          .from('payment_events')
          .insert({
            merchant_id: enr.merchant_id,
            location_id: enr.location_id,
            contact_id: enr.contact_id,
            enrollment_id: enr.id,
            event_type: 'sale',
            processor: procConfig.processor_type,
            processor_transaction_id: result.transactionId,
            amount: amountDollars,
            currency: 'usd',
            source: 'recurring_billing',
            is_recurring: true,
          })
          .select('id')
          .single();

        // 5b. Increment payments_made
        const newPaymentsMade = nextPaymentNumber;
        const updates: any = { payments_made: newPaymentsMade };

        // 5c. Advance next_billing_date (or clear it if final installment)
        const isFinal = enr.payments_total != null && newPaymentsMade >= enr.payments_total;
        if (isFinal) {
          updates.next_billing_date = null;
          updates.status = 'completed';
          updates.completed_at = new Date().toISOString();
        } else {
          const next = new Date();
          const freq = (offer.installment_frequency || 'monthly').toLowerCase();
          if (freq === 'weekly') next.setDate(next.getDate() + 7);
          else if (freq === 'bi_weekly' || freq === 'biweekly') next.setDate(next.getDate() + 14);
          else next.setMonth(next.getMonth() + 1);
          updates.next_billing_date = next.toISOString().split('T')[0];
        }

        await supabase.from('enrollments').update(updates).eq('id', enr.id);

        // 5d. Log evidence
        try {
          await evidenceService.logEvidence(
            EVIDENCE_TYPES.PAYMENT_CONFIRMATION,
            enr.location_id,
            enr.contact_id,
            'recurring_billing',
            {
              amount: amountDollars,
              transaction_id: result.transactionId,
              payment_number: nextPaymentNumber,
              payments_remaining: Math.max(0, (enr.payments_total || 0) - newPaymentsMade),
              processor: procConfig.processor_type,
              timestamp: new Date().toISOString(),
            },
          );
        } catch (evErr: any) {
          logger.warn({ err: evErr.message, enrollmentId: enr.id }, 'Recurring billing: evidence log failed (non-fatal)');
        }

        // 5e. Fire ss_payment_received trigger
        try {
          await triggerService.fireTrigger(enr.location_id, 'ss_payment_received', {
            contact_id: enr.contact_id,
            amount: amountDollars,
            transaction_id: result.transactionId,
            payments_remaining: Math.max(0, (enr.payments_total || 0) - newPaymentsMade),
            running_total: amountDollars * newPaymentsMade,
          });
        } catch (trigErr: any) {
          logger.warn({ err: trigErr.message, enrollmentId: enr.id }, 'Recurring billing: trigger fire failed (non-fatal)');
        }

        // 5f. Final-installment detection
        if (isFinal) {
          try {
            await triggerService.fireTrigger(enr.location_id, 'ss_program_completed', {
              contact_id: enr.contact_id,
              offer_id: offer.id,
              total_paid: amountDollars * newPaymentsMade,
              completed_at: new Date().toISOString(),
            });
          } catch (trigErr: any) {
            logger.warn({ err: trigErr.message, enrollmentId: enr.id }, 'Recurring billing: program_completed trigger failed (non-fatal)');
          }
          logger.info({ enrollmentId: enr.id, totalPayments: newPaymentsMade }, 'Recurring billing: final installment collected — enrollment completed');
        }

        charged++;
        logger.info({
          enrollmentId: enr.id,
          contactId: enr.contact_id,
          paymentNumber: nextPaymentNumber,
          paymentsTotal: enr.payments_total,
          amount: amountDollars,
          isFinal,
          eventId: insertedEvent?.id,
        }, 'Recurring billing: charge succeeded');
      } else {
        // 6. Failure → log + initiate dunning
        const { data: failedEvent } = await supabase
          .from('payment_events')
          .insert({
            merchant_id: enr.merchant_id,
            location_id: enr.location_id,
            contact_id: enr.contact_id,
            enrollment_id: enr.id,
            event_type: 'payment_failed',
            processor: procConfig.processor_type,
            amount: amountDollars,
            currency: 'usd',
            failure_reason: result.errorMessage || 'Unknown failure',
            source: 'recurring_billing',
            is_recurring: true,
          })
          .select('id')
          .single();

        if (failedEvent?.id) {
          try {
            await paymentLifecycleService.initiateDunning({
              merchantId: enr.merchant_id,
              locationId: enr.location_id,
              contactId: enr.contact_id,
              offerId: enr.offer_id || '',
              paymentEventId: failedEvent.id,
              failureReason: result.errorMessage || 'Recurring charge failed',
              failureCode: result.errorCode,
              amountCents,
              attemptCount: 0,
            });
          } catch (dunErr: any) {
            logger.error({ err: dunErr.message, enrollmentId: enr.id }, 'Recurring billing: initiateDunning threw');
          }
        }

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
