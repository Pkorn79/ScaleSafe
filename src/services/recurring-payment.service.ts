import { getSupabase } from '../clients/supabase.client';
import { ghlApi } from '../clients/ghl.client';
import { paymentLifecycleService } from './payment-lifecycle.service';
import { triggerService } from './trigger.service';
import { evidenceService } from './evidence.service';
import { EVIDENCE_TYPES } from '../constants/evidence-types';
import { WORKFLOW_PAYMENT_CONTACT_FIELDS } from '../constants/ghl-fields';
import { logger } from '../utils/logger';
import { buildDefenseEvidenceFields } from '../utils/defense-evidence';

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
    processor_subscription_id?: string | null;
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
    processor_subscription_id?: string | null;
  };
  processorType: 'nmi' | 'stripe';
  transactionId?: string | null;
  amountCents: number;
  errorMessage: string;
  errorCode?: string;
  source: string;
}

function formatMoney(value: unknown): string {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? `$${amount.toFixed(2)}` : String(value || '');
}

function today(): string {
  return new Date().toISOString().split('T')[0];
}

async function getMerchantWorkflowIdentity(merchantId: string, locationId: string): Promise<{
  businessName: string;
  supportEmail: string;
}> {
  try {
    const { data } = await getSupabase()
      .from('merchants')
      .select('business_name, dba_name, support_email, email')
      .eq('id', merchantId)
      .eq('location_id', locationId)
      .single();
    return {
      businessName: data?.dba_name || data?.business_name || '',
      supportEmail: data?.support_email || data?.email || '',
    };
  } catch {
    return { businessName: '', supportEmail: '' };
  }
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
  const isNmiHistorySync = source === 'nmi_history_sync';
  const newPaymentsMade = (enr.payments_made || 0) + 1;
  const isFiniteInstallment = enr.payment_type !== 'subscription' && enr.payments_total != null;
  const paymentsRemaining = isFiniteInstallment
    ? Math.max(0, Number(enr.payments_total) - newPaymentsMade)
    : null;
  const isFinal = isFiniteInstallment && paymentsRemaining === 0;

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
      processor_subscription_id: enr.processor_subscription_id || null,
      amount: amountDollars,
      currency: 'usd',
      payment_number: newPaymentsMade,
      payments_total: isFiniteInstallment ? Number(enr.payments_total) : null,
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

  if (isFinal) {
    updates.next_billing_date = null;
    updates.billing_completed_at = new Date().toISOString();
  } else {
    const next = new Date();
    const freq = (installmentFrequency || 'monthly').toLowerCase();
    if (freq === 'daily') next.setDate(next.getDate() + 1);
    else if (freq === 'weekly') next.setDate(next.getDate() + 7);
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
        ghl_transaction_id: transactionId,
        payment_date: new Date().toISOString(),
        payment_number: newPaymentsMade,
        payments_remaining: paymentsRemaining,
        running_total: amountDollars * newPaymentsMade,
        processor: processorType,
        enrollment_id: enr.id,
        raw_payload: {
          transactionId,
          processorType,
          amountCents,
          source,
          paymentType: enr.payment_type,
          offerName,
          recovery_note: isNmiHistorySync
            ? 'Imported from NMI transaction history'
            : null,
        },
        ...buildDefenseEvidenceFields({
          summary: isNmiHistorySync
            ? `${enr.payment_type === 'subscription' ? 'Subscription' : 'Installment'} payment #${newPaymentsMade} of $${amountDollars.toFixed(2)} for ${offerName || 'program'} was imported from NMI transaction history. Transaction: ${transactionId}. Payments remaining: ${paymentsRemaining}.`
            : `${enr.payment_type === 'subscription' ? 'Subscription' : 'Installment'} payment #${newPaymentsMade} of $${amountDollars.toFixed(2)} for ${offerName || 'program'} processed via ${processorType}. Transaction: ${transactionId}. Payments remaining: ${paymentsRemaining}.`,
          title: isNmiHistorySync
            ? `Recovered NMI Payment #${newPaymentsMade}`
            : `Recurring Payment #${newPaymentsMade}`,
          proofRole: 'payment_history',
          relevance: {
            tags: ['authorization', 'fraud', 'services_not_provided', 'credit_not_processed', 'cancelled_recurring'],
            priority: 'high',
            confidence: 'strong',
          },
          enrollmentId: enr.id,
          metadata: {
            actor: 'processor',
            service: { enrollmentId: enr.id, offerId: enr.offer_id, offerName },
            transaction: {
              processor: processorType,
              transactionId,
              subscriptionId: enr.processor_subscription_id || null,
              amount: amountDollars,
              currency: 'USD',
              paymentSequence: newPaymentsMade,
            },
            source: { system: source, recordId: transactionId, rawEventType: 'recurring_payment_success' },
          },
        }),
      },
    );
  } catch (evErr: any) {
    logger.warn({ err: evErr.message, enrollmentId: enr.id }, 'Recurring payment evidence log failed (non-fatal)');
  }

  // 4. Fire ss_payment_received trigger for live payments only.
  // History sync repairs ScaleSafe records, but should not email clients about old payments.
  if (source === 'nmi_history_sync') {
    logger.info({ enrollmentId: enr.id, transactionId }, 'NMI history import: customer receipt workflow suppressed');
  } else {
    try {
      const paymentKind: 'installment' | 'subscription' = enr.payment_type === 'subscription' ? 'subscription' : 'installment';
      const runningTotal = amountDollars * newPaymentsMade;
      const merchantIdentity = await getMerchantWorkflowIdentity(enr.merchant_id, enr.location_id);
      try {
        const api = await ghlApi(enr.location_id);
        await api.put(`/contacts/${enr.contact_id}`, {
          customField: {
            [WORKFLOW_PAYMENT_CONTACT_FIELDS.PAYMENT_STATUS]: isFinal ? 'Completed' : 'Current',
            [WORKFLOW_PAYMENT_CONTACT_FIELDS.LAST_PAYMENT_AMOUNT]: formatMoney(amountDollars),
            [WORKFLOW_PAYMENT_CONTACT_FIELDS.LAST_PAYMENT_DATE]: today(),
            [WORKFLOW_PAYMENT_CONTACT_FIELDS.PAYMENTS_MADE]: newPaymentsMade,
            [WORKFLOW_PAYMENT_CONTACT_FIELDS.PAYMENTS_REMAINING]: paymentsRemaining,
            [WORKFLOW_PAYMENT_CONTACT_FIELDS.SUCCESSFUL_PAYMENT_COUNT]: newPaymentsMade,
            [WORKFLOW_PAYMENT_CONTACT_FIELDS.TOTAL_PAID]: formatMoney(runningTotal),
          },
        });
      } catch (syncErr: any) {
        logger.warn({ err: syncErr.message, enrollmentId: enr.id }, 'Recurring payment contact field sync failed (non-fatal)');
      }
      await triggerService.fireTrigger(enr.location_id, 'ss_payment_received', {
        event_type: 'payment_received',
        location_id: enr.location_id,
        locationId: enr.location_id,
        contact_id: enr.contact_id,
        contactId: enr.contact_id,
        enrollment_id: enr.id,
        enrollmentId: enr.id,
        offer_id: enr.offer_id,
        offerId: enr.offer_id,
        program_name: offerName,
        programName: offerName,
        offer_name: offerName,
        offerName,
        processor: processorType,
        source,
        amount: amountDollars,
        amount_display: formatMoney(amountDollars),
        amountDisplay: formatMoney(amountDollars),
        transaction_id: transactionId,
        transactionId,
        payment_number: newPaymentsMade,
        paymentNumber: newPaymentsMade,
        payments_total: isFiniteInstallment ? Number(enr.payments_total) : null,
        paymentsTotal: isFiniteInstallment ? Number(enr.payments_total) : null,
        payments_remaining: paymentsRemaining,
        paymentsRemaining,
        running_total: runningTotal,
        runningTotal,
        running_total_display: formatMoney(runningTotal),
        runningTotalDisplay: formatMoney(runningTotal),
        payment_kind: paymentKind,
        paymentKind,
        support_email: merchantIdentity.supportEmail,
        supportEmail: merchantIdentity.supportEmail,
        business_name: merchantIdentity.businessName,
        businessName: merchantIdentity.businessName,
      });
    } catch (trigErr: any) {
      logger.warn({ err: trigErr.message, enrollmentId: enr.id }, 'Recurring payment trigger fire failed (non-fatal)');
    }
  }

  // 5. Final-installment billing marker
  if (isFinal) {
    logger.info({ enrollmentId: enr.id, totalPayments: newPaymentsMade }, 'Recurring payment: final installment collected; billing marked complete');
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
  const { enrollment: enr, processorType, transactionId, amountCents, errorMessage, errorCode, source } = params;
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
      processor_transaction_id: transactionId || null,
      processor_subscription_id: enr.processor_subscription_id || null,
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
