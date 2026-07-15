import { getSupabase } from '../clients/supabase.client';
import { ghlApi } from '../clients/ghl.client';
import { paymentLifecycleService } from './payment-lifecycle.service';
import { triggerService } from './trigger.service';
import { evidenceService } from './evidence.service';
import { EVIDENCE_TYPES } from '../constants/evidence-types';
import {
  OFFER_CONTACT_FIELDS,
  WORKFLOW_COMPAT_OFFER_CONTACT_FIELDS,
  WORKFLOW_PAYMENT_CONTACT_FIELDS,
} from '../constants/ghl-fields';
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
    next_billing_date?: string | null;
  };
  processorType: 'nmi' | 'stripe' | 'whop';
  transactionId: string;
  amountCents: number;
  offerName: string;
  installmentFrequency: string;
  source: string; // 'recurring_billing' | 'stripe_webhook' | 'nmi_silent_post'
  // Processor-resolved next billing date (event payload or subscription API lookup).
  // When omitted, the RPC anchors an estimate and marks the schedule 'estimated'.
  nextBillingDate?: string | null;
  rawPayload?: any;
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
  processorType: 'nmi' | 'stripe' | 'whop';
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
  duplicate: boolean;
}> {
  const { enrollment: enr, processorType, transactionId, amountCents, offerName, installmentFrequency, source } = params;
  const supabase = getSupabase();
  const amountDollars = amountCents / 100;
  const isNmiHistorySync = source === 'nmi_history_sync';
  const suppressCustomerReceipt = isNmiHistorySync;
  const isFiniteInstallment = enr.payment_type !== 'subscription' && enr.payments_total != null;

  // Atomic record: insert the ledger row (deduped on the partial unique index from
  // migration 072), then increment payments_made and advance the schedule — all in one
  // transaction. On a duplicate webhook delivery the RPC returns is_duplicate=true and
  // performs NO increment. next_billing_date is processor-resolved by the caller; when
  // absent the RPC anchors an estimate from the prior schedule and marks it 'estimated'.
  const resolvedNextBillingDate = params.nextBillingDate ?? null;
  const { data: rpcData, error: rpcError } = await supabase.rpc('record_recurring_payment', {
    p_enrollment_id: enr.id,
    p_location_id: enr.location_id,
    p_processor: processorType,
    p_transaction_id: transactionId,
    p_amount: amountDollars,
    p_next_billing_date: resolvedNextBillingDate,
    p_next_billing_source: resolvedNextBillingDate ? 'processor' : 'estimated',
    p_interval: installmentFrequency || 'monthly',
    p_source: source,
    p_raw_payload: params.rawPayload ?? null,
  });
  if (rpcError) throw rpcError;

  const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
  if (!row) {
    throw new Error(`record_recurring_payment returned no row for enrollment ${enr.id}`);
  }

  if (row.is_duplicate) {
    logger.info(
      { enrollmentId: enr.id, transactionId, processorType, source },
      'Recurring payment: duplicate webhook delivery ignored (ledger row already exists)',
    );
    return {
      paymentEventId: null,
      isFinal: false,
      newPaymentsMade: Number(row.payments_made || 0),
      duplicate: true,
    };
  }

  const newPaymentsMade = Number(row.payments_made || (enr.payments_made || 0) + 1);
  const paymentsRemaining = isFiniteInstallment
    ? Math.max(0, Number(enr.payments_total) - newPaymentsMade)
    : null;
  const isFinal = Boolean(row.is_final);
  const paymentEventId: string | null = row.payment_event_id || null;

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
          paymentEventId,
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
  if (suppressCustomerReceipt) {
    logger.info(
      { enrollmentId: enr.id, transactionId, processorType, source },
      'NMI history import: customer receipt workflow suppressed',
    );
  } else {
    try {
      const paymentKind: 'installment' | 'subscription' = enr.payment_type === 'subscription' ? 'subscription' : 'installment';
      const runningTotal = amountDollars * newPaymentsMade;
      const merchantIdentity = await getMerchantWorkflowIdentity(enr.merchant_id, enr.location_id);
      try {
        const api = await ghlApi(enr.location_id);
        await api.put(`/contacts/${enr.contact_id}`, {
          customField: {
            [OFFER_CONTACT_FIELDS.BUSINESS_NAME]: merchantIdentity.businessName,
            [OFFER_CONTACT_FIELDS.OFFER_NAME]: offerName,
            [WORKFLOW_COMPAT_OFFER_CONTACT_FIELDS.PROGRAM_NAME]: offerName,
            [WORKFLOW_COMPAT_OFFER_CONTACT_FIELDS.SUPPORT_EMAIL]: merchantIdentity.supportEmail,
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
        payment_source: source,
        paymentSource: source,
        payment_timing: 'recurring',
        paymentTiming: 'recurring',
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
        receipt_only: true,
        receiptOnly: true,
        send_receipt: true,
        sendReceipt: true,
        send_welcome: false,
        sendWelcome: false,
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

  return { paymentEventId, isFinal, newPaymentsMade, duplicate: false };
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

  // #6: initiate dunning even when the ledger insert failed. A transient DB blip must not
  // cost the customer-facing recovery sequence (past_due workflow, card-update link,
  // ss_payment_failed trigger). With a null paymentEventId, initiateDunning fires the comms
  // but cannot schedule the saved-card auto-retry (which needs the event row).
  try {
    await paymentLifecycleService.initiateDunning({
      merchantId: enr.merchant_id,
      locationId: enr.location_id,
      contactId: enr.contact_id,
      offerId: enr.offer_id || '',
      paymentEventId: failedEvent?.id || null,
      failureReason: errorMessage || 'Recurring charge failed',
      failureCode: errorCode,
      amountCents,
      attemptCount: 0,
    });
  } catch (dunErr: any) {
    logger.error({ err: dunErr.message, enrollmentId: enr.id }, 'Recurring payment: initiateDunning threw');
  }

  return { paymentEventId: failedEvent?.id || null };
}
