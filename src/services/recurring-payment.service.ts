import { getSupabase } from '../clients/supabase.client';
import { paymentLifecycleService } from './payment-lifecycle.service';
import { triggerService } from './trigger.service';
import { evidenceService } from './evidence.service';
import { EVIDENCE_TYPES } from '../constants/evidence-types';
import { logger } from '../utils/logger';

/**
 * Shared handlers for recurring payment success/failure.
 *
 * Called from three sources:
 *   1. recurring-billing.ts (daily cron — legacy + fallback)
 *   2. stripe-webhook.controller.ts (invoice.payment_succeeded/failed)
 *   3. nmi-silent-post.controller.ts (NMI Silent Post notifications)
 */

interface RecurringPaymentParams {
  enrollment: {
    id: string;
    merchant_id: string;
    location_id: string;
    contact_id: string;
    offer_id: string | null;
    payments_made: number;
    payments_total: number | null;
    payment_type: string;
  };
  processorType: 'nmi' | 'stripe';
  transactionId: string;
  amountCents: number;
  offerName: string;
  installmentFrequency: string;
  source: string; // 'recurring_billing' | 'stripe_webhook' | 'nmi_silent_post'
}

interface RecurringFailureParams {
  enrollment: {
    id: string;
    merchant_id: string;
    location_id: string;
    contact_id: string;
    offer_id: string | null;
  };
  processorType: 'nmi' | 'stripe';
  amountCents: number;
  errorMessage: string;
  errorCode?: string;
  source: string;
}

/**
 * Handle a successful recurring payment — shared across cron, Stripe webhook, NMI silent post.
 *
 * Performs: payment_events insert, enrollment state update, evidence logging, trigger firing,
 * final-installment detection.
 */
export async function handleRecurringPaymentSuccess(params: RecurringPaymentParams): Promise<{
  paymentEventId: string | null;
  isFinal: boolean;
  newPaymentsMade: number;
}> {
  const { enrollment: enr, processorType, transactionId, amountCents, offerName, installmentFrequency, source } = params;
  const supabase = getSupabase();
  const amountDollars = amountCents / 100;
  const newPaymentsMade = (enr.payments_made || 0) + 1;

  // 1. Log payment_events row.
  // The insert error must NOT be silently swallowed — earlier this function destructured
  // only `data` and continued to step 2, which left enrollment.payments_made advancing
  // (and even flipping to status='completed') while the ledger row was missing entirely.
  const { data: insertedEvent, error: insertError } = await supabase
    .from('payment_events')
    .insert({
      merchant_id: enr.merchant_id,
      location_id: enr.location_id,
      contact_id: enr.contact_id,
      enrollment_id: enr.id,
      event_type: 'sale',
      processor: processorType,
      processor_transaction_id: transactionId,
      amount: amountDollars,
      currency: 'usd',
      source,
      is_recurring: true,
    })
    .select('id')
    .single();

  if (insertError) {
    logger.error({
      err: insertError.message,
      code: insertError.code,
      details: insertError.details,
      enrollmentId: enr.id,
      merchantId: enr.merchant_id,
      processor: processorType,
      transactionId,
      amountCents,
      source,
    }, 'Recurring payment: payment_events insert failed — enrollment will still advance, ledger row missing');
  }

  // 2. Advance enrollment state
  const updates: any = { payments_made: newPaymentsMade };
  const isFinal = enr.payments_total != null && newPaymentsMade >= enr.payments_total;

  if (isFinal) {
    updates.next_billing_date = null;
    updates.status = 'completed';
    updates.completed_at = new Date().toISOString();
    updates.pulse_cadence_enabled = false;
    updates.next_pulse_due_at = null;
  } else {
    const next = new Date();
    const freq = (installmentFrequency || 'monthly').toLowerCase();
    if (freq === 'weekly') next.setDate(next.getDate() + 7);
    else if (freq === 'bi_weekly' || freq === 'biweekly') next.setDate(next.getDate() + 14);
    else if (freq === 'quarterly') next.setMonth(next.getMonth() + 3);
    else if (freq === 'annual') next.setFullYear(next.getFullYear() + 1);
    else next.setMonth(next.getMonth() + 1);
    updates.next_billing_date = next.toISOString().split('T')[0];
  }

  await supabase.from('enrollments').update(updates).eq('id', enr.id);

  // 3. Log evidence (non-blocking)
  try {
    await evidenceService.logEvidence(
      EVIDENCE_TYPES.PAYMENT_CONFIRMATION,
      enr.location_id,
      enr.contact_id,
      source,
      {
        amount: amountDollars,
        transaction_id: transactionId,
        payment_number: newPaymentsMade,
        payments_remaining: Math.max(0, (enr.payments_total || 0) - newPaymentsMade),
        processor: processorType,
        timestamp: new Date().toISOString(),
      },
    );
  } catch (evErr: any) {
    logger.warn({ err: evErr.message, enrollmentId: enr.id }, 'Recurring payment evidence log failed (non-fatal)');
  }

  // 4. Fire ss_payment_received trigger (non-blocking)
  try {
    await triggerService.fireTrigger(enr.location_id, 'ss_payment_received', {
      contact_id: enr.contact_id,
      amount: amountDollars,
      transaction_id: transactionId,
      payments_remaining: Math.max(0, (enr.payments_total || 0) - newPaymentsMade),
      running_total: amountDollars * newPaymentsMade,
    });
  } catch (trigErr: any) {
    logger.warn({ err: trigErr.message, enrollmentId: enr.id }, 'Recurring payment trigger fire failed (non-fatal)');
  }

  // 5. Final-installment detection
  if (isFinal) {
    try {
      await triggerService.fireTrigger(enr.location_id, 'ss_program_completed', {
        contact_id: enr.contact_id,
        offer_id: enr.offer_id || '',
        total_paid: amountDollars * newPaymentsMade,
        completed_at: new Date().toISOString(),
      });
    } catch (trigErr: any) {
      logger.warn({ err: trigErr.message, enrollmentId: enr.id }, 'Program completed trigger failed (non-fatal)');
    }
    logger.info({ enrollmentId: enr.id, totalPayments: newPaymentsMade }, 'Recurring payment: final installment — enrollment completed');
  }

  return { paymentEventId: insertedEvent?.id || null, isFinal, newPaymentsMade };
}

/**
 * Handle a failed recurring payment — shared across cron, Stripe webhook, NMI silent post.
 *
 * Performs: payment_events insert, dunning initiation.
 */
export async function handleRecurringPaymentFailure(params: RecurringFailureParams): Promise<{
  paymentEventId: string | null;
}> {
  const { enrollment: enr, processorType, amountCents, errorMessage, errorCode, source } = params;
  const supabase = getSupabase();
  const amountDollars = amountCents / 100;

  const { data: failedEvent, error: failedInsertError } = await supabase
    .from('payment_events')
    .insert({
      merchant_id: enr.merchant_id,
      location_id: enr.location_id,
      contact_id: enr.contact_id,
      enrollment_id: enr.id,
      event_type: 'payment_failed',
      processor: processorType,
      amount: amountDollars,
      currency: 'usd',
      failure_reason: errorMessage || 'Unknown failure',
      source,
      is_recurring: true,
    })
    .select('id')
    .single();

  if (failedInsertError) {
    logger.error({
      err: failedInsertError.message,
      code: failedInsertError.code,
      details: failedInsertError.details,
      enrollmentId: enr.id,
      merchantId: enr.merchant_id,
      processor: processorType,
      amountCents,
      source,
    }, 'Recurring failure: payment_events insert failed — dunning will not initiate');
  }

  if (failedEvent?.id) {
    try {
      await paymentLifecycleService.initiateDunning({
        merchantId: enr.merchant_id,
        locationId: enr.location_id,
        contactId: enr.contact_id,
        offerId: enr.offer_id || '',
        paymentEventId: failedEvent.id,
        failureReason: errorMessage || 'Recurring charge failed',
        failureCode: errorCode,
        amountCents,
        attemptCount: 0,
      });
    } catch (dunErr: any) {
      logger.error({ err: dunErr.message, enrollmentId: enr.id }, 'Recurring payment: initiateDunning threw');
    }
  }

  return { paymentEventId: failedEvent?.id || null };
}
