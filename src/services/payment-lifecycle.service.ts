import { getSupabase } from '../clients/supabase.client';
import { ghlApi } from '../clients/ghl.client';
import { resolveProcessor, createProcessorClient } from './processor.factory';
import { triggerService } from './trigger.service';
import { evidenceService } from './evidence.service';
import { merchantRepository } from '../repositories/merchant.repository';
import { collapseVisiblePaymentMethods, archivePaymentMethod } from './payment-methods.service';
import { logger } from '../utils/logger';
import { createPublicActionToken } from '../utils/public-action-token';
import { EVIDENCE_TYPES } from '../constants/evidence-types';
import {
  OFFER_CONTACT_FIELDS,
  SS_CONTACT_FIELDS,
  WORKFLOW_COMPAT_OFFER_CONTACT_FIELDS,
  WORKFLOW_PAYMENT_CONTACT_FIELDS,
} from '../constants/ghl-fields';
import type { DunningParams, SubscriptionParams, CardManagementParams } from '../types/payment-lifecycle.types';
import type { StoredCard } from '../types/processor.types';
import type { InvoicePaymentResult } from '../interfaces/processor.interface';
import { buildDefenseEvidenceFields } from '../utils/defense-evidence';
import { ExternalServiceError, ValidationError } from '../utils/errors';
import { whopService } from './whop.service';
import { moneyOperationService } from './money-operation.service';
import { resolveProgramName } from '../utils/program-name';
import { resolveWorkflowRefundPolicy, resolveWorkflowTermsUrl } from '../utils/workflow-offer-fields';

function formatMoney(value: unknown): string {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? `$${amount.toFixed(2)}` : String(value || '');
}

function today(): string {
  return new Date().toISOString().split('T')[0];
}

function formatWorkflowDate(value: unknown): string {
  if (!value) return '';
  const dateOnly = String(value).slice(0, 10);
  const parsed = new Date(`${dateOnly}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

async function syncLifecycleWorkflowContact(params: {
  locationId: string;
  contactId: string;
  enrollmentStatus: 'paused' | 'enrolled';
  offerName: string;
  paymentsRemaining: number;
  nextBillingDate?: string;
  triggerKey: 'ss_subscription_paused' | 'ss_subscription_resumed';
}): Promise<boolean> {
  try {
    const api = await ghlApi(params.locationId);
    await api.put(`/contacts/${params.contactId}`, {
      customField: {
        [SS_CONTACT_FIELDS.ENROLLMENT_STATUS]: params.enrollmentStatus,
        [OFFER_CONTACT_FIELDS.OFFER_NAME]: params.offerName,
        [WORKFLOW_COMPAT_OFFER_CONTACT_FIELDS.PROGRAM_NAME]: params.offerName,
        [WORKFLOW_PAYMENT_CONTACT_FIELDS.NEXT_PAYMENT_DATE]: formatWorkflowDate(params.nextBillingDate),
        [WORKFLOW_PAYMENT_CONTACT_FIELDS.PAYMENTS_REMAINING]: params.paymentsRemaining,
      },
    });
    return true;
  } catch (err: any) {
    logger.warn(
      {
        err: err?.message || String(err),
        locationId: params.locationId,
        contactId: params.contactId,
        triggerKey: params.triggerKey,
      },
      'Lifecycle workflow contact field sync failed; customer trigger suppressed',
    );
    return false;
  }
}

async function syncCancellationWorkflowContact(params: {
  locationId: string;
  contactId: string;
  offerName: string;
  businessName: string;
  supportEmail: string;
  refundPolicy: string;
  termsUrl: string;
}): Promise<boolean> {
  if (!params.offerName) {
    logger.warn(
      { locationId: params.locationId, contactId: params.contactId },
      'Cancellation workflow contact field sync skipped because the exact program name was unavailable',
    );
    return false;
  }

  try {
    const api = await ghlApi(params.locationId);
    await api.put(`/contacts/${params.contactId}`, {
      customField: {
        [OFFER_CONTACT_FIELDS.BUSINESS_NAME]: params.businessName,
        [OFFER_CONTACT_FIELDS.OFFER_NAME]: params.offerName,
        [WORKFLOW_COMPAT_OFFER_CONTACT_FIELDS.PROGRAM_NAME]: params.offerName,
        [WORKFLOW_COMPAT_OFFER_CONTACT_FIELDS.SUPPORT_EMAIL]: params.supportEmail,
        [WORKFLOW_COMPAT_OFFER_CONTACT_FIELDS.REFUND_POLICY]: params.refundPolicy,
        [WORKFLOW_COMPAT_OFFER_CONTACT_FIELDS.TC_DOCUMENT_URL]: params.termsUrl,
      },
    });
    return true;
  } catch (err: any) {
    logger.warn(
      {
        err: err?.message || String(err),
        locationId: params.locationId,
        contactId: params.contactId,
        triggerKey: 'ss_cancellation_requested',
      },
      'Cancellation workflow contact field sync failed; customer trigger suppressed',
    );
    return false;
  }
}

function plainText(value: unknown, fallback = ''): string {
  if (value == null) return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

function fireTriggerInBackground(
  locationId: string,
  triggerKey: string,
  payload: Record<string, unknown>,
): void {
  triggerService.fireTrigger(locationId, triggerKey, payload).catch((err: any) => {
    logger.warn(
      { err: err?.message || String(err), triggerKey, locationId },
      'Workflow trigger failed after enrollment action response',
    );
  });
}

function assertProcessorSuccess(
  result: { success?: boolean; errorMessage?: string } | undefined,
  processor: string,
  action: string,
): void {
  if (!result || result.success === false) {
    throw new ExternalServiceError(processor, result?.errorMessage || `Unable to ${action} subscription`);
  }
}

function isWhopProcessor(processorType: unknown): boolean {
  return String(processorType || '').toLowerCase() === 'whop';
}

function requireWhopMembershipId(params: SubscriptionParams, action: string): string {
  const membershipId = String(params.processorSubscriptionId || '').trim();
  if (!membershipId.startsWith('mem_')) {
    throw new ValidationError(`Unable to ${action} Whop membership: missing Whop membership ID`);
  }
  return membershipId;
}

async function updateEnrollmentForLifecycleAction(params: {
  locationId: string;
  enrollmentId?: string;
  contactId: string;
  processorSubscriptionId?: string;
  fallbackStatuses?: string[];
  updates: Record<string, unknown>;
  action: string;
}): Promise<any> {
  let query = getSupabase()
    .from('enrollments')
    .update(params.updates)
    .eq('location_id', params.locationId);

  if (params.enrollmentId) {
    query = query.eq('id', params.enrollmentId);
  } else {
    query = query.eq('contact_id', params.contactId);
    if (params.processorSubscriptionId) {
      query = query.eq('processor_subscription_id', params.processorSubscriptionId);
    } else if (params.fallbackStatuses?.length) {
      query = query.in('status', params.fallbackStatuses);
    }
  }

  const { data, error } = await query
    .select('id, status, next_billing_date, processor_subscription_id')
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    throw new ValidationError(`Unable to ${params.action} subscription: enrollment was not updated`);
  }
  return data;
}

export const paymentLifecycleService = {

  // ═══════════════════════════════════════════════════════════════
  // DUNNING (functions 29-31)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Start dunning sequence after a failed recurring payment.
   * Sets retry schedule based on failure type, fires trigger for GHL workflow.
   */
  async initiateDunning(params: DunningParams): Promise<void> {
    const supabase = getSupabase();

    // Check if dunning is enabled for this merchant
    const merchant = await merchantRepository.getByLocationId(params.locationId);
    if (!(merchant as any).dunning_enabled) {
      logger.info({ locationId: params.locationId, contactId: params.contactId }, 'Dunning disabled for this merchant — skipping auto-retry');
      return;
    }
    const maxRetries = (merchant as any).dunning_max_retries || 3;

    // Determine retry schedule based on failure reason
    const isSoftDecline = ['insufficient_funds', 'card_declined', 'do_not_honor']
      .some(code => (params.failureReason + (params.failureCode || '')).toLowerCase().includes(code));

    const retryDays = isSoftDecline ? [3, 7, 14].slice(0, maxRetries) : []; // Hard decline = no auto-retry
    const nextRetryDate = retryDays.length > 0
      ? new Date(Date.now() + retryDays[0] * 24 * 60 * 60 * 1000).toISOString()
      : null;

    // Update payment event with dunning metadata. Skipped when the ledger insert failed (#6):
    // the customer-facing recovery comms below still fire, but auto-retry can't be scheduled.
    if (params.paymentEventId) {
      await supabase.from('payment_events').update({
        dunning_status: 'active',
        dunning_retry_count: 0,
        dunning_next_retry: nextRetryDate,
        dunning_started_at: new Date().toISOString(),
      }).eq('id', params.paymentEventId);
    } else {
      logger.warn({ locationId: params.locationId, contactId: params.contactId }, 'Dunning initiated without a payment_events row — comms only, no auto-retry scheduled');
    }

    const failedPaymentCount = Math.max(1, params.attemptCount || 1);
    try {
      const api = await ghlApi(params.locationId);
      await api.put(`/contacts/${params.contactId}`, {
        customField: {
          [SS_CONTACT_FIELDS.ENROLLMENT_STATUS]: 'past_due',
          [WORKFLOW_PAYMENT_CONTACT_FIELDS.PAYMENT_STATUS]: 'Past Due',
          [WORKFLOW_PAYMENT_CONTACT_FIELDS.FAILED_PAYMENT_COUNT]: failedPaymentCount,
          [WORKFLOW_PAYMENT_CONTACT_FIELDS.LAST_FAILED_PAYMENT_DATE]: today(),
          [WORKFLOW_PAYMENT_CONTACT_FIELDS.LAST_PAYMENT_AMOUNT]: formatMoney(params.amountCents / 100),
        },
      });
    } catch (err: any) {
      logger.warn({ err: err.message, contactId: params.contactId }, 'Dunning contact field sync failed');
    }

    // Fire trigger for GHL dunning workflow
    try {
      await triggerService.fireTrigger(params.locationId, 'ss_payment_failed', {
        event_type: 'payment_failed',
        location_id: params.locationId,
        locationId: params.locationId,
        contact_id: params.contactId,
        contactId: params.contactId,
        amount: params.amountCents / 100,
        amount_display: formatMoney(params.amountCents / 100),
        amountDisplay: formatMoney(params.amountCents / 100),
        failure_reason: params.failureReason,
        failureReason: params.failureReason,
        attempt_count: failedPaymentCount,
        attemptCount: failedPaymentCount,
        next_retry_date: nextRetryDate || 'none',
        nextRetryDate: nextRetryDate || 'none',
        dunning_stage: 'initial',
        dunningStage: 'initial',
      });
    } catch (err: any) {
      logger.warn({ err: err.message, contactId: params.contactId }, 'Dunning trigger failed');
    }

    // Update GHL contact status
    try {
      const api = await ghlApi(params.locationId);
      await api.put(`/contacts/${params.contactId}`, {
        customField: {
          [SS_CONTACT_FIELDS.ENROLLMENT_STATUS]: 'past_due',
        },
      });
    } catch { /* non-blocking */ }

    logger.info({
      contactId: params.contactId, paymentEventId: params.paymentEventId,
      isSoftDecline, nextRetryDate,
    }, 'Dunning sequence initiated');
  },

  /**
   * Retry a failed payment during dunning.
   * Fetches the saved card and attempts to charge again.
   */
  async retryPayment(merchantId: string, locationId: string, contactId: string, paymentEventId: string): Promise<{
    success: boolean;
    error?: string;
    reconciliationRequired?: boolean;
  }> {
    const supabase = getSupabase();
    let preserveRetryClaim = false;

    // Get the original failed payment event
    const { data: originalEvent } = await supabase
      .from('payment_events')
      .select('*')
      .eq('id', paymentEventId)
      .eq('merchant_id', merchantId)
      .eq('location_id', locationId)
      .eq('contact_id', contactId)
      .single();

    if (!originalEvent) {
      return { success: false, error: 'Payment event not found' };
    }
    if (originalEvent.event_type !== 'payment_failed') {
      return { success: false, error: 'Only a failed payment event can be retried' };
    }

    const originalProcessor = String(originalEvent.processor || '').toLowerCase();
    if (originalProcessor !== 'stripe' && originalProcessor !== 'nmi') {
      return { success: false, error: 'The failed payment does not have a supported original processor' };
    }

    const rawContext = originalEvent.raw_webhook_payload
      && typeof originalEvent.raw_webhook_payload === 'object'
      ? originalEvent.raw_webhook_payload as Record<string, unknown>
      : {};
    const stripeInvoiceId = originalProcessor === 'stripe'
      ? String(rawContext.stripe_invoice_id || '').trim()
      : '';
    const stripeAccountId = originalProcessor === 'stripe'
      ? String(rawContext.stripe_account_id || '').trim()
      : '';

    if (originalProcessor === 'stripe') {
      if (!stripeInvoiceId.startsWith('in_') || stripeInvoiceId !== originalEvent.processor_transaction_id) {
        return { success: false, error: 'Stripe retry requires the exact stored failed invoice' };
      }
      if (!stripeAccountId.startsWith('acct_')) {
        return { success: false, error: 'Stripe retry requires the exact stored connected account' };
      }
    }

    // Stripe retries the invoice's own payment method. NMI requires a saved
    // method from the same processor as the original failed event.
    let method: any = null;
    if (originalProcessor === 'nmi') {
      const { data } = await supabase
        .from('payment_methods')
        .select('*')
        .eq('location_id', locationId)
        .eq('contact_id', contactId)
        .eq('processor_type', originalProcessor)
        .eq('is_default', true)
        .limit(1)
        .maybeSingle();
      method = data;
    }

    if (originalProcessor === 'nmi' && !method) {
      return { success: false, error: 'No saved payment method found' };
    }

    // Attempt charge
    try {
      // Idempotency lock (#2): atomically claim the retry. Only one request can move the
      // event from 'active' to 'retrying'; a concurrent /dunning/retry (double-click, retry
      // storm) finds 0 rows and bails without charging. The claim is released back to
      // 'active' on failure/exception so legitimate scheduled retries still run (no poisoning).
      const { data: claimedRows } = await supabase
        .from('payment_events')
        .update({ dunning_status: 'retrying', dunning_started_at: new Date().toISOString() })
        .eq('id', paymentEventId)
        .eq('merchant_id', merchantId)
        .eq('location_id', locationId)
        .eq('contact_id', contactId)
        .eq('dunning_status', 'active')
        .select('id');
      if (!Array.isArray(claimedRows) || claimedRows.length === 0) {
        logger.info({ paymentEventId, contactId }, 'Dunning retry skipped — already in progress or no longer eligible');
        return { success: false, error: 'Retry already in progress or no longer eligible' };
      }

      const { config: procConfig } = await resolveProcessor(merchantId, locationId, {
        processor_override: originalProcessor,
        nmi_processor_id: originalProcessor === 'nmi'
          ? String(rawContext.nmi_processor_id || '').trim() || null
          : null,
        stripe_account_id: originalProcessor === 'stripe' ? stripeAccountId : null,
      });
      if (procConfig.processor_type !== originalProcessor) {
        throw new Error('Resolved processor does not match the failed payment processor');
      }
      if (originalProcessor === 'stripe' && procConfig.stripe_user_id !== stripeAccountId) {
        throw new Error('Resolved Stripe account does not match the failed invoice account');
      }
      const processor = createProcessorClient(procConfig);
      const token = method?.nmi_customer_vault_id || '';
      const customerId = method?.nmi_customer_vault_id || '';

      const amountCents = Math.round(Number(originalEvent.amount) * 100);
      const retryAttempt = Number(originalEvent.dunning_retry_count || 0) + 1;
      const operation = await moneyOperationService.begin({
        locationId,
        merchantId,
        operationType: 'dunning_retry',
        operationKey: `${paymentEventId}:${retryAttempt}`,
        request: {
          paymentEventId,
          contactId,
          enrollmentId: originalEvent.enrollment_id || null,
          paymentMethodId: method?.id || null,
          amountCents,
          currency: originalEvent.currency || 'usd',
          processorType: originalProcessor,
          stripeInvoiceId: stripeInvoiceId || null,
          stripeAccountId: stripeAccountId || null,
          retryAttempt,
        },
      });
      if (operation.action === 'replay') {
        return operation.response as { success: boolean; error?: string };
      }
      if (operation.action === 'blocked') {
        preserveRetryClaim = true;
        return { success: false, error: 'Retry is awaiting processor reconciliation' };
      }

      let result;
      const providerIdempotencyKey = `dunning-${paymentEventId}-${retryAttempt}`;
      await moneyOperationService.markProviderStarted({
        id: operation.operation.id,
        locationId,
        processorType: procConfig.processor_type,
      });
      try {
        if (originalProcessor === 'stripe' && typeof processor.payInvoice !== 'function') {
          throw new Error('Stripe invoice retry is unavailable');
        }
        result = originalProcessor === 'stripe'
          ? await processor.payInvoice!(stripeInvoiceId, {
            stripeAccountId,
            idempotencyKey: providerIdempotencyKey,
          })
          : await processor.chargeStoredCard(customerId, token, {
            amount: Math.round(Number(originalEvent.amount) * 100), // convert to cents (rounded — Stripe rejects non-integers)
            currency: originalEvent.currency || 'usd',
            paymentToken: token,
            description: 'Dunning retry payment',
            idempotencyKey: providerIdempotencyKey,
          });
      } catch (chargeErr: any) {
        preserveRetryClaim = true;
        await moneyOperationService.markUnknown({
          id: operation.operation.id,
          locationId,
          processorType: procConfig.processor_type,
          error: chargeErr.message || 'Processor result is unknown',
        });
        return {
          success: false,
          error: chargeErr.message || 'Processor result is unknown',
          reconciliationRequired: true,
        };
      }

      const stripeInvoiceResult = originalProcessor === 'stripe'
        ? result as InvoicePaymentResult
        : null;
      if (stripeInvoiceResult?.outcome === 'unknown') {
        preserveRetryClaim = true;
        await moneyOperationService.markUnknown({
          id: operation.operation.id,
          locationId,
          processorType: originalProcessor,
          error: stripeInvoiceResult.errorMessage || 'Stripe invoice result is unknown',
        });
        return {
          success: false,
          error: stripeInvoiceResult.errorMessage || 'Stripe invoice result is unknown',
          reconciliationRequired: true,
        };
      }

      if (result.success) {
        preserveRetryClaim = true;
        const recoveredTransactionId = String(result.transactionId || '').trim();
        if (!recoveredTransactionId || recoveredTransactionId === originalEvent.processor_transaction_id) {
          await moneyOperationService.markUnknown({
            id: operation.operation.id,
            locationId,
            processorType: originalProcessor,
            error: 'Processor success did not include a distinct successful payment reference',
          });
          return {
            success: false,
            error: 'Processor success requires reconciliation before dunning can be resolved',
            reconciliationRequired: true,
          };
        }
        await moneyOperationService.markProviderAccepted({
          id: operation.operation.id,
          locationId,
          processorType: originalProcessor,
          processorReference: recoveredTransactionId,
          response: { success: true, transactionId: recoveredTransactionId },
          reconciliationPayload: {
            transactionId: recoveredTransactionId,
            paymentEventId,
            enrollmentId: originalEvent.enrollment_id || null,
            contactId,
            stripeInvoiceId: stripeInvoiceId || null,
            stripeAccountId: stripeAccountId || null,
            invoicePaymentId: stripeInvoiceResult?.invoicePaymentId || null,
          },
        });
        // #5: record the recovered installment atomically — insert the ledger row, increment
        // payments_made, and advance next_billing_date — so the recurring schedule reflects the
        // recovery and the enrollment is not re-billed by the cron or shown as overdue.
        if (originalEvent.enrollment_id) {
          let interval = 'monthly';
          try {
            const { data: enrRow } = await supabase.from('enrollments')
              .select('offer_id').eq('id', originalEvent.enrollment_id).eq('location_id', locationId).single();
            if (enrRow?.offer_id) {
              const { data: ofr } = await supabase.from('offers_mirror')
                .select('installment_frequency').eq('id', enrRow.offer_id).eq('location_id', locationId).single();
              if (ofr?.installment_frequency) interval = ofr.installment_frequency;
            }
          } catch { /* default monthly for the schedule estimate */ }
          const { data: recordData, error: recordErr } = await supabase.rpc('record_recurring_payment', {
            p_enrollment_id: originalEvent.enrollment_id,
            p_location_id: locationId,
            p_processor: originalProcessor,
            p_transaction_id: recoveredTransactionId,
            p_amount: originalEvent.amount,
            p_next_billing_date: null,
            p_next_billing_source: 'estimated',
            p_interval: interval,
            p_source: 'dunning_retry',
            p_raw_payload: {
              dunning_retry: true,
              original_payment_event_id: paymentEventId,
              stripe_invoice_id: stripeInvoiceId || null,
              stripe_account_id: stripeAccountId || null,
              stripe_invoice_payment_id: stripeInvoiceResult?.invoicePaymentId || null,
            },
          });
          if (recordErr) {
            logger.error({ err: recordErr.message, enrollmentId: originalEvent.enrollment_id, paymentEventId }, 'Dunning retry: record_recurring_payment failed');
            throw new Error(`Dunning recovery ledger write failed: ${recordErr.message}`);
          }
          const recordRow = Array.isArray(recordData) ? recordData[0] : recordData;
          let successfulPaymentEventId = recordRow?.is_duplicate ? null : recordRow?.payment_event_id;
          if (!successfulPaymentEventId) {
            const { data: existingSale, error: existingSaleError } = await supabase
              .from('payment_events')
              .select('id')
              .eq('location_id', locationId)
              .eq('contact_id', contactId)
              .eq('enrollment_id', originalEvent.enrollment_id)
              .eq('processor', originalProcessor)
              .eq('event_type', 'sale')
              .eq('processor_transaction_id', recoveredTransactionId)
              .maybeSingle();
            if (existingSaleError) {
              throw new Error(`Dunning recovery ledger verification failed: ${existingSaleError.message}`);
            }
            successfulPaymentEventId = existingSale?.id || null;
          }
          if (!successfulPaymentEventId || successfulPaymentEventId === paymentEventId) {
            throw new Error('Dunning recovery ledger did not contain a distinct successful payment record');
          }
        } else {
          // No enrollment link — record the standalone recovered sale (legacy behaviour).
          const { data: successfulSale, error: insertError } = await supabase.from('payment_events').insert({
            merchant_id: merchantId,
            location_id: locationId,
            contact_id: contactId,
            event_type: 'sale',
            processor: originalProcessor,
            processor_transaction_id: recoveredTransactionId,
            amount: originalEvent.amount,
            currency: originalEvent.currency || 'usd',
            source: 'dunning_retry',
            is_recurring: true,
          }).select('id').single();
          if (insertError) throw new Error(`Dunning recovery ledger write failed: ${insertError.message}`);
          if (!successfulSale?.id || successfulSale.id === paymentEventId) {
            throw new Error('Dunning recovery ledger did not contain a distinct successful payment record');
          }
        }

        // Resolve dunning
        const { data: resolvedRows, error: resolveError } = await supabase.from('payment_events').update({
          dunning_status: 'resolved',
          dunning_resolved_at: new Date().toISOString(),
        })
          .eq('id', paymentEventId)
          .eq('merchant_id', merchantId)
          .eq('location_id', locationId)
          .eq('contact_id', contactId)
          .eq('dunning_status', 'retrying')
          .select('id');
        if (resolveError) throw new Error(`Dunning recovery status write failed: ${resolveError.message}`);
        if (!Array.isArray(resolvedRows) || resolvedRows.length !== 1) {
          const { data: currentDunning, error: currentDunningError } = await supabase
            .from('payment_events')
            .select('id, dunning_status')
            .eq('id', paymentEventId)
            .eq('merchant_id', merchantId)
            .eq('location_id', locationId)
            .eq('contact_id', contactId)
            .maybeSingle();
          if (currentDunningError || currentDunning?.dunning_status !== 'resolved') {
            throw new Error(currentDunningError
              ? `Dunning recovery status verification failed: ${currentDunningError.message}`
              : 'Dunning recovery status was not resolved');
          }
        }

        await moneyOperationService.markRecorded({
          id: operation.operation.id,
          locationId,
          response: { success: true },
          processorType: originalProcessor,
          processorReference: recoveredTransactionId,
          providerCalled: true,
        });

        // Log evidence
        try {
          await evidenceService.logEvidence(
            EVIDENCE_TYPES.PAYMENT_CONFIRMATION, locationId, contactId, 'dunning_retry',
            {
            amount: originalEvent.amount,
            payment_date: new Date().toISOString(),
            ghl_transaction_id: recoveredTransactionId,
            payment_event_id: paymentEventId,
            raw_payload: { originalEvent, result },
            ...buildDefenseEvidenceFields({
              summary: `Dunning retry recovered payment of $${Number(originalEvent.amount || 0).toFixed(2)}. Transaction: ${recoveredTransactionId}.`,
              title: 'Dunning Recovery Payment',
              proofRole: 'payment_history',
              relevance: { tags: ['credit_not_processed', 'cancelled_recurring'], priority: 'high', confidence: 'strong' },
              paymentEventId,
              metadata: {
                actor: 'processor',
                transaction: {
                  paymentEventId,
                  processor: originalProcessor,
                  transactionId: recoveredTransactionId,
                  amount: originalEvent.amount,
                  currency: originalEvent.currency || 'usd',
                },
                source: { system: 'dunning_retry', rawEventType: 'dunning_resolved' },
              },
            }),
            },
          );
        } catch (evidenceErr: any) {
          logger.warn({ err: evidenceErr.message, paymentEventId }, 'Dunning recovery evidence write failed after payment was recorded');
        }

        // Fire success trigger
        try {
          await triggerService.fireTrigger(locationId, 'ss_payment_received', {
            event_type: 'payment_received',
            location_id: locationId,
            locationId,
            contact_id: contactId,
            contactId,
            enrollment_id: originalEvent.enrollment_id || '',
            enrollmentId: originalEvent.enrollment_id || '',
            offer_id: originalEvent.offer_id || '',
            offerId: originalEvent.offer_id || '',
            amount: originalEvent.amount,
            amount_display: formatMoney(originalEvent.amount),
            amountDisplay: formatMoney(originalEvent.amount),
            transaction_id: recoveredTransactionId,
            transactionId: recoveredTransactionId,
            action: 'dunning_resolved',
            payment_kind: 'dunning_recovery',
            paymentKind: 'dunning_recovery',
            payment_source: 'dunning_retry',
            paymentSource: 'dunning_retry',
            payment_timing: 'dunning_recovery',
            paymentTiming: 'dunning_recovery',
            receipt_only: true,
            receiptOnly: true,
            send_receipt: true,
            sendReceipt: true,
            send_welcome: false,
            sendWelcome: false,
          });
        } catch { /* non-blocking */ }

        // Update GHL contact status back to active
        try {
          const api = await ghlApi(locationId);
          await api.put(`/contacts/${contactId}`, {
            customField: { [SS_CONTACT_FIELDS.ENROLLMENT_STATUS]: 'enrolled' },
          });
        } catch { /* non-blocking */ }

        logger.info({ contactId, paymentEventId, transactionId: recoveredTransactionId }, 'Dunning retry succeeded');
        return { success: true };
      }

      // Retry failed — update retry count
      const retryCount = (originalEvent.dunning_retry_count || 0) + 1;
      const retryDays = [3, 7, 14];
      const nextRetry = retryCount < retryDays.length
        ? new Date(Date.now() + retryDays[retryCount] * 24 * 60 * 60 * 1000).toISOString()
        : null;

      await supabase.from('payment_events').update({
        dunning_status: 'active', // release the claim so scheduled retries can run
        dunning_retry_count: retryCount,
        dunning_next_retry: nextRetry,
      })
        .eq('id', paymentEventId)
        .eq('merchant_id', merchantId)
        .eq('location_id', locationId)
        .eq('contact_id', contactId);

      await moneyOperationService.markRecorded({
        id: operation.operation.id,
        locationId,
        response: { success: false, error: result.errorMessage || 'Charge declined' },
        processorType: originalProcessor,
        processorReference: result.transactionId || null,
        providerCalled: true,
      });

      if (!nextRetry) {
        await this.escalateDunning(locationId, contactId, paymentEventId);
      }

      return { success: false, error: result.errorMessage || 'Charge declined' };
    } catch (err: any) {
      // Never reopen eligibility after the processor may have accepted the charge.
      if (!preserveRetryClaim) {
        try {
          await supabase.from('payment_events').update({ dunning_status: 'active' })
            .eq('id', paymentEventId)
            .eq('merchant_id', merchantId)
            .eq('location_id', locationId)
            .eq('contact_id', contactId);
        } catch { /* best effort */ }
      }
      logger.error({ err: err.message, contactId, paymentEventId }, 'Dunning retry charge failed');
      return {
        success: false,
        error: err.message,
        ...(preserveRetryClaim ? { reconciliationRequired: true } : {}),
      };
    }
  },

  /**
   * Escalate dunning after max retries reached.
   * Marks the payment_event as escalated and the GHL contact as delinquent.
   * SS - Payment Failed workflow handles merchant/client comms via the standard
   * payment_failed trigger path; engagement-status is intentionally NOT touched
   * here — it belongs to the multi-factor disengagement scorer, not raw payment state.
   */
  async escalateDunning(locationId: string, contactId: string, paymentEventId: string): Promise<void> {
    const supabase = getSupabase();

    await supabase.from('payment_events').update({
      dunning_status: 'escalated',
    }).eq('id', paymentEventId);

    const { data: paymentEvent } = await supabase
      .from('payment_events')
      .select('amount, failure_reason, dunning_retry_count, enrollment_id, offer_id')
      .eq('id', paymentEventId)
      .eq('location_id', locationId)
      .maybeSingle();

    const amount = Number(paymentEvent?.amount || 0);
    const attemptCount = Number(paymentEvent?.dunning_retry_count || 0) + 1;

    // Log evidence of collection attempts
    await evidenceService.logEvidence(
      EVIDENCE_TYPES.FAILED_PAYMENT, locationId, contactId, 'dunning_escalation',
      {
        failure_date: new Date().toISOString(),
        decline_reason: 'Max retries reached',
        attempt_count: attemptCount,
        payment_event_id: paymentEventId,
        raw_payload: { action: 'dunning_escalated', reason: 'Max retries reached' },
        ...buildDefenseEvidenceFields({
          summary: 'Payment collection escalated after the configured retry sequence was exhausted.',
          title: 'Dunning Escalation',
          proofRole: 'dunning',
          relevance: { tags: ['credit_not_processed', 'cancelled_recurring'], priority: 'medium', confidence: 'moderate' },
          paymentEventId,
          metadata: {
            actor: 'system',
            transaction: { paymentEventId },
            source: { system: 'payment_lifecycle', rawEventType: 'dunning_escalated' },
          },
        }),
      },
    );

    // Update GHL contact — enrollment status only. Engagement is decoupled from dunning.
    try {
      const api = await ghlApi(locationId);
      await api.put(`/contacts/${contactId}`, {
        customField: {
          [SS_CONTACT_FIELDS.ENROLLMENT_STATUS]: 'delinquent',
          [WORKFLOW_PAYMENT_CONTACT_FIELDS.PAYMENT_STATUS]: 'Delinquent',
          [WORKFLOW_PAYMENT_CONTACT_FIELDS.FAILED_PAYMENT_COUNT]: attemptCount,
          [WORKFLOW_PAYMENT_CONTACT_FIELDS.LAST_FAILED_PAYMENT_DATE]: today(),
          [WORKFLOW_PAYMENT_CONTACT_FIELDS.LAST_PAYMENT_AMOUNT]: formatMoney(amount),
        },
      });
    } catch (err: any) {
      logger.warn({ err: err.message, contactId }, 'Dunning escalation contact field sync failed');
    }

    try {
      await triggerService.fireTrigger(locationId, 'ss_payment_failed', {
        event_type: 'payment_failed',
        location_id: locationId,
        locationId,
        contact_id: contactId,
        contactId,
        enrollment_id: paymentEvent?.enrollment_id || '',
        enrollmentId: paymentEvent?.enrollment_id || '',
        offer_id: paymentEvent?.offer_id || '',
        offerId: paymentEvent?.offer_id || '',
        amount,
        amount_display: formatMoney(amount),
        amountDisplay: formatMoney(amount),
        failure_reason: paymentEvent?.failure_reason || 'Max retries reached',
        failureReason: paymentEvent?.failure_reason || 'Max retries reached',
        attempt_count: attemptCount,
        attemptCount,
        next_retry_date: 'none',
        nextRetryDate: 'none',
        dunning_stage: 'escalated',
        dunningStage: 'escalated',
      });
    } catch (err: any) {
      logger.warn({ err: err.message, contactId }, 'Dunning escalation trigger failed');
    }

    logger.info({ contactId, paymentEventId }, 'Dunning escalated — client marked delinquent');
  },

  // ═══════════════════════════════════════════════════════════════
  // SUBSCRIPTION MANAGEMENT (functions 38-40)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Pause a subscription. Logs evidence, fires trigger, updates GHL.
   */
  async pauseSubscription(params: SubscriptionParams): Promise<void> {
    const pauseReason = plainText(params.reason, 'Merchant-initiated pause');
    // Pause via processor if we have a subscription ID
    if (isWhopProcessor(params.processorType)) {
      const membershipId = requireWhopMembershipId(params, 'pause');
      await whopService.pauseMembership(params.locationId, membershipId);
    } else if (params.processorSubscriptionId) {
      try {
        const { config: procConfig } = await resolveProcessor(params.merchantId, params.locationId, {
          processor_override: params.processorType || null,
          nmi_processor_id: null,
        });
        const processor = createProcessorClient(procConfig);
        const result = await processor.pauseSubscription(params.processorSubscriptionId);
        assertProcessorSuccess(result, procConfig.processor_type || 'processor', 'pause');
      } catch (err: any) {
        logger.warn({ err: err.message, enrollmentId: params.enrollmentId }, 'Processor subscription pause failed');
        throw err;
      }

    }

    await updateEnrollmentForLifecycleAction({
      locationId: params.locationId,
      enrollmentId: params.enrollmentId,
      contactId: params.contactId,
      fallbackStatuses: ['enrolled', 'active'],
      updates: { status: 'paused', next_billing_date: null },
      action: 'pause',
    });

    // Log evidence (enriched with context for defense letters)
    await evidenceService.logEvidence(
      EVIDENCE_TYPES.SUBSCRIPTION_CHANGE, params.locationId, params.contactId, 'merchant_action',
      {
        action: 'pause',
        change_date: new Date().toISOString(),
        reason: pauseReason,
        initiated_by: 'merchant',
        previous_status: 'enrolled',
        new_status: 'paused',
        enrollment_id: params.enrollmentId || null,
        raw_payload: params as any,
        ...buildDefenseEvidenceFields({
          summary: `Merchant paused the subscription. Reason: ${pauseReason || 'not specified'}. Future billing was paused with enrollment status moved from enrolled to paused.`,
          title: 'Subscription Paused',
          proofRole: 'billing_update',
          relevance: { tags: ['cancelled_recurring', 'credit_not_processed'], priority: 'medium', confidence: 'moderate' },
          enrollmentId: params.enrollmentId || null,
          metadata: {
            actor: 'merchant',
            service: { enrollmentId: params.enrollmentId || null, offerId: params.offerId || null },
            transaction: {
              processor: params.processorType || null,
              subscriptionId: params.processorSubscriptionId || null,
            },
            source: { system: 'payment_lifecycle', rawEventType: 'subscription_pause' },
          },
        }),
      },
    );

    // Fire trigger — flat payload
    try {
      let enrollmentId = params.enrollmentId || '';
      let offerId = params.offerId || '';
      let offerName = '';
      let paymentsRemaining = 0;
      let processor = params.processorType || '';
      let subscriptionId = params.processorSubscriptionId || '';
      try {
        const supabase = getSupabase();
        let enrollmentQuery = supabase.from('enrollments')
          .select('id, offer_id, program_name_snapshot, payments_made, payments_total, processor_type, processor_subscription_id')
          .eq('location_id', params.locationId)
          .eq('contact_id', params.contactId);
        if (params.enrollmentId) {
          enrollmentQuery = enrollmentQuery.eq('id', params.enrollmentId);
        } else {
          enrollmentQuery = enrollmentQuery.order('created_at', { ascending: false }).limit(1);
        }
        const { data: enr } = await enrollmentQuery.maybeSingle();
        enrollmentId = enrollmentId || enr?.id || '';
        offerId = offerId || enr?.offer_id || '';
        processor = processor || enr?.processor_type || '';
        subscriptionId = subscriptionId || enr?.processor_subscription_id || '';
        if (enr?.offer_id) {
          const { data: ofr } = await supabase.from('offers_mirror').select('offer_name, num_payments').eq('id', enr.offer_id).eq('location_id', params.locationId).single();
          offerName = resolveProgramName(enr, ofr);
          paymentsRemaining = Math.max(0, (enr.payments_total || ofr?.num_payments || 0) - (enr.payments_made || 0));
        }
      } catch {}
      const workflowFieldsReady = await syncLifecycleWorkflowContact({
        locationId: params.locationId,
        contactId: params.contactId,
        enrollmentStatus: 'paused',
        offerName,
        paymentsRemaining,
        triggerKey: 'ss_subscription_paused',
      });
      if (workflowFieldsReady) {
        fireTriggerInBackground(params.locationId, 'ss_subscription_paused', {
          event_type: 'subscription_paused',
          location_id: params.locationId,
          locationId: params.locationId,
          contact_id: params.contactId,
          contactId: params.contactId,
          enrollment_id: enrollmentId,
          enrollmentId,
          offer_id: offerId,
          offerId,
          offer_name: offerName,
          offerName,
          program_name: offerName,
          programName: offerName,
          processor,
          subscription_id: subscriptionId,
          subscriptionId,
          pause_reason: pauseReason,
          pauseReason,
          pause_resume_date: '',
          payments_remaining: paymentsRemaining,
          paymentsRemaining,
        });
      }
    } catch { /* non-blocking */ }

    try {
      const api = await ghlApi(params.locationId);
      await api.post(`/contacts/${params.contactId}/notes`, {
        body: `Subscription paused: ${pauseReason}`,
      });
    } catch { /* non-blocking */ }

    logger.info({ contactId: params.contactId, reason: pauseReason }, 'Subscription paused');
  },

  /**
   * Resume a paused subscription. Logs evidence, fires trigger, updates GHL.
   */
  async resumeSubscription(params: SubscriptionParams): Promise<void> {
    // Resume via processor if we have a subscription ID
    if (isWhopProcessor(params.processorType)) {
      const membershipId = requireWhopMembershipId(params, 'resume');
      const result = await whopService.resumeMembership(params.locationId, membershipId);
      if (!result.nextPaymentDate) {
        throw new ValidationError('Unable to resume Whop membership: Whop returned no renewal date');
      }
      await updateEnrollmentForLifecycleAction({
        locationId: params.locationId,
        enrollmentId: params.enrollmentId,
        contactId: params.contactId,
        processorSubscriptionId: membershipId,
        updates: {
          status: 'enrolled',
          next_billing_date: result.nextPaymentDate.split('T')[0],
        },
        action: 'resume',
      });
    } else if (params.processorSubscriptionId) {
      try {
        const supabase = getSupabase();
        const { config: procConfig } = await resolveProcessor(params.merchantId, params.locationId, {
          processor_override: params.processorType || null,
          nmi_processor_id: null,
        });
        const processor = createProcessorClient(procConfig);

        // Fetch enrollment + offer for remaining payments and frequency
        let enrollmentQuery = supabase.from('enrollments')
          .select('id, offer_id, payments_made, payments_total, status')
          .eq('location_id', params.locationId)
          .eq('contact_id', params.contactId)
          .eq('processor_subscription_id', params.processorSubscriptionId);
        if (params.enrollmentId) {
          enrollmentQuery = enrollmentQuery.eq('id', params.enrollmentId);
        }
        const { data: enr } = await enrollmentQuery.maybeSingle();
        if (!enr) {
          throw new ValidationError('Unable to resume subscription: enrollment was not found');
        }
        if (enr.status !== 'paused') {
          throw new ValidationError('Only a paused subscription can be resumed');
        }

        let interval: 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'annual' = 'monthly';
        let planAmount = 0;
        let remaining = 0;
        let description = '';
        if (enr?.offer_id) {
          const { data: ofr } = await supabase.from('offers_mirror')
            .select('offer_name, installment_amount, installment_frequency')
            .eq('id', enr.offer_id).single();
          if (ofr) {
            const freq = (ofr.installment_frequency || 'monthly').toLowerCase();
            interval =
              freq === 'daily' ? 'daily' :
              freq === 'weekly' ? 'weekly' :
              freq === 'bi_weekly' || freq === 'biweekly' ? 'biweekly' :
              freq === 'quarterly' ? 'quarterly' :
              freq === 'annual' ? 'annual' : 'monthly';
            planAmount = Math.round(Number(ofr.installment_amount || 0) * 100);
            description = ofr.offer_name || '';
          }
          remaining = Math.max(0, (enr.payments_total || 0) - (enr.payments_made || 0));
        }

        // Get payment method for customerId/paymentMethodId
        const { data: pm } = await supabase.from('payment_methods')
          .select('*').eq('location_id', params.locationId)
          .eq('contact_id', params.contactId).eq('is_default', true).limit(1).maybeSingle();

        const customerId = pm?.nmi_customer_vault_id || pm?.stripe_customer_id || '';
        const paymentMethodId = pm?.stripe_payment_method_id || pm?.nmi_customer_vault_id || '';

        if (procConfig.processor_type === 'stripe') {
          const result = await processor.resumeSubscription({
            subscriptionId: params.processorSubscriptionId,
            paymentMethodId,
            customerId,
            planAmount,
            interval,
            remainingPayments: remaining,
            description,
          });
          assertProcessorSuccess(result, procConfig.processor_type || 'processor', 'resume');

          const resumeUpdates: Record<string, unknown> = {
            status: 'enrolled',
          };
          if (result.subscriptionId && result.subscriptionId !== params.processorSubscriptionId) {
            resumeUpdates.processor_subscription_id = result.subscriptionId;
          }
          if (result.nextPaymentDate) {
            resumeUpdates.next_billing_date = result.nextPaymentDate.split('T')[0];
          }

          await updateEnrollmentForLifecycleAction({
            locationId: params.locationId,
            enrollmentId: enr.id,
            contactId: params.contactId,
            updates: resumeUpdates,
            action: 'resume',
          });
        } else {
          // NMI resumes by creating a replacement subscription from the saved vault.
          const nextDate = new Date();
          if (interval === 'daily') nextDate.setDate(nextDate.getDate() + 1);
          else if (interval === 'weekly') nextDate.setDate(nextDate.getDate() + 7);
          else if (interval === 'biweekly') nextDate.setDate(nextDate.getDate() + 14);
          else if (interval === 'quarterly') nextDate.setMonth(nextDate.getMonth() + 3);
          else if (interval === 'annual') nextDate.setFullYear(nextDate.getFullYear() + 1);
          else nextDate.setMonth(nextDate.getMonth() + 1);

          if (remaining > 0 && planAmount > 0 && customerId) {
            const operation = await moneyOperationService.begin({
              locationId: params.locationId,
              merchantId: params.merchantId,
              operationType: 'subscription_resume',
              operationKey: `${enr.id}:${params.processorSubscriptionId}`,
              request: {
                enrollmentId: enr.id,
                contactId: params.contactId,
                priorSubscriptionId: params.processorSubscriptionId,
                paymentMethodId,
                customerId,
                planAmount,
                interval,
                remainingPayments: remaining,
                startDate: nextDate.toISOString().split('T')[0],
              },
            });

            let result: any = null;
            if (operation.action === 'execute') {
              try {
                await moneyOperationService.markProviderStarted({
                  id: operation.operation.id,
                  locationId: params.locationId,
                  processorType: procConfig.processor_type,
                });
                result = await processor.resumeSubscription({
                  subscriptionId: params.processorSubscriptionId,
                  paymentMethodId,
                  customerId,
                  planAmount,
                  interval,
                  remainingPayments: remaining,
                  startDate: nextDate.toISOString().split('T')[0],
                  description,
                  idempotencyKey: `resume-${enr.id}-${params.processorSubscriptionId}`,
                });
              } catch (resumeErr: any) {
                await moneyOperationService.markUnknown({
                  id: operation.operation.id,
                  locationId: params.locationId,
                  processorType: procConfig.processor_type,
                  error: resumeErr.message || 'Processor result is unknown',
                });
                throw resumeErr;
              }
              assertProcessorSuccess(result, procConfig.processor_type || 'processor', 'resume');
              await moneyOperationService.markProviderAccepted({
                id: operation.operation.id,
                locationId: params.locationId,
                processorType: procConfig.processor_type,
                processorReference: result.subscriptionId,
                response: {
                  subscriptionId: result.subscriptionId,
                  nextPaymentDate: result.nextPaymentDate || nextDate.toISOString(),
                },
              });
            } else {
              const storedResponse = operation.action === 'replay'
                ? operation.response
                : operation.operation.status === 'provider_accepted'
                  ? operation.operation.response_payload
                  : null;
              if (!storedResponse?.subscriptionId) {
                throw new ValidationError('Subscription resume is awaiting processor reconciliation');
              }
              result = {
                success: true,
                subscriptionId: String(storedResponse.subscriptionId),
                nextPaymentDate: storedResponse.nextPaymentDate
                  ? String(storedResponse.nextPaymentDate)
                  : nextDate.toISOString(),
              };
            }

            const resumeUpdates: Record<string, unknown> = {
              status: 'enrolled',
              next_billing_date: nextDate.toISOString().split('T')[0],
            };
            if (result.subscriptionId && result.subscriptionId !== params.processorSubscriptionId) {
              resumeUpdates.processor_subscription_id = result.subscriptionId;
            }

            await updateEnrollmentForLifecycleAction({
              locationId: params.locationId,
              enrollmentId: enr.id,
              contactId: params.contactId,
              updates: resumeUpdates,
              action: 'resume',
            });
            if (operation.action !== 'replay') {
              await moneyOperationService.markRecorded({
                id: operation.operation.id,
                locationId: params.locationId,
                response: {
                  success: true,
                  subscriptionId: result.subscriptionId,
                  nextPaymentDate: result.nextPaymentDate || nextDate.toISOString(),
                },
                processorType: procConfig.processor_type,
                processorReference: result.subscriptionId,
                providerCalled: true,
              });
            }
          } else {
            throw new ValidationError('Unable to resume subscription: recurring amount, saved payment method, or remaining payments are missing');
          }
        }
      } catch (err: any) {
        logger.warn({ err: err.message, enrollmentId: params.enrollmentId }, 'Processor subscription resume failed');
        throw err;
      }
    } else {
      // No processor subscription - just update enrollment status back to 'enrolled'
      await updateEnrollmentForLifecycleAction({
        locationId: params.locationId,
        enrollmentId: params.enrollmentId,
        contactId: params.contactId,
        fallbackStatuses: ['paused'],
        updates: { status: 'enrolled' },
        action: 'resume',
      });
    }

    // Log evidence (enriched with context for defense letters)
    await evidenceService.logEvidence(
      EVIDENCE_TYPES.SUBSCRIPTION_CHANGE, params.locationId, params.contactId, 'merchant_action',
      {
        action: 'resume',
        change_date: new Date().toISOString(),
        reason: params.reason,
        initiated_by: 'merchant',
        previous_status: 'paused',
        new_status: 'enrolled',
        enrollment_id: params.enrollmentId || null,
        raw_payload: params as any,
        ...buildDefenseEvidenceFields({
          summary: `Merchant resumed the subscription. Reason: ${params.reason || 'not specified'}. Billing status moved from paused to enrolled.`,
          title: 'Subscription Resumed',
          proofRole: 'billing_update',
          relevance: { tags: ['cancelled_recurring', 'credit_not_processed'], priority: 'medium', confidence: 'moderate' },
          enrollmentId: params.enrollmentId || null,
          metadata: {
            actor: 'merchant',
            service: { enrollmentId: params.enrollmentId || null, offerId: params.offerId || null },
            transaction: {
              processor: params.processorType || null,
              subscriptionId: params.processorSubscriptionId || null,
            },
            source: { system: 'payment_lifecycle', rawEventType: 'subscription_resume' },
          },
        }),
      },
    );

    // Fire trigger — flat doc contract: contact_id, offer_name, next_billing_date, payments_remaining, days_paused
    try {
      let enrollmentId = params.enrollmentId || '';
      let offerId = params.offerId || '';
      let offerName = '';
      let paymentsRemaining = 0;
      let daysPaused = 0;
      let processor = params.processorType || '';
      let subscriptionId = params.processorSubscriptionId || '';
      let nextBillingDate = '';
      try {
        const supabase = getSupabase();
        let enrollmentQuery = supabase.from('enrollments')
          .select('id, offer_id, program_name_snapshot, payments_made, payments_total, updated_at, next_billing_date, processor_type, processor_subscription_id')
          .eq('location_id', params.locationId)
          .eq('contact_id', params.contactId);
        if (params.enrollmentId) {
          enrollmentQuery = enrollmentQuery.eq('id', params.enrollmentId);
        } else {
          enrollmentQuery = enrollmentQuery.order('created_at', { ascending: false }).limit(1);
        }
        const { data: enr } = await enrollmentQuery.maybeSingle();
        enrollmentId = enrollmentId || enr?.id || '';
        offerId = offerId || enr?.offer_id || '';
        processor = processor || enr?.processor_type || '';
        subscriptionId = subscriptionId || enr?.processor_subscription_id || '';
        nextBillingDate = enr?.next_billing_date || '';
        if (enr?.offer_id) {
          const { data: ofr } = await supabase.from('offers_mirror').select('offer_name, num_payments').eq('id', enr.offer_id).eq('location_id', params.locationId).single();
          offerName = resolveProgramName(enr, ofr);
          paymentsRemaining = Math.max(0, (enr.payments_total || ofr?.num_payments || 0) - (enr.payments_made || 0));
        }
        if (enr?.updated_at) {
          daysPaused = Math.floor((Date.now() - new Date(enr.updated_at).getTime()) / (1000 * 60 * 60 * 24));
        }
      } catch {}
      const workflowFieldsReady = await syncLifecycleWorkflowContact({
        locationId: params.locationId,
        contactId: params.contactId,
        enrollmentStatus: 'enrolled',
        offerName,
        paymentsRemaining,
        nextBillingDate,
        triggerKey: 'ss_subscription_resumed',
      });
      if (workflowFieldsReady) {
        fireTriggerInBackground(params.locationId, 'ss_subscription_resumed', {
          event_type: 'subscription_resumed',
          location_id: params.locationId,
          locationId: params.locationId,
          contact_id: params.contactId,
          contactId: params.contactId,
          enrollment_id: enrollmentId,
          enrollmentId,
          offer_id: offerId,
          offerId,
          offer_name: offerName,
          offerName,
          program_name: offerName,
          programName: offerName,
          processor,
          subscription_id: subscriptionId,
          subscriptionId,
          next_billing_date: nextBillingDate,
          nextBillingDate,
          payments_remaining: paymentsRemaining,
          paymentsRemaining,
          days_paused: daysPaused,
          daysPaused,
        });
      }
    } catch { /* non-blocking */ }

    logger.info({ contactId: params.contactId }, 'Subscription resumed');
  },

  /**
   * Cancel a subscription. Logs both subscription change + cancellation evidence.
   */
  async cancelSubscription(params: SubscriptionParams): Promise<void> {
    const processorSubscriptionId = params.processorSubscriptionId;
    const shouldCancelProcessor = Boolean(processorSubscriptionId)
      && params.processorCancellationRequired !== false;
    const cancelledEnrollmentUpdates = {
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      next_billing_date: null,
      pulse_cadence_enabled: false,
      next_pulse_due_at: null,
    };

    // Cancel via processor if we have a subscription ID
    if (isWhopProcessor(params.processorType) && shouldCancelProcessor) {
      const membershipId = requireWhopMembershipId(params, 'cancel');
      const result = await whopService.cancelMembership(params.locationId, membershipId);
      await updateEnrollmentForLifecycleAction({
        locationId: params.locationId,
        enrollmentId: params.enrollmentId,
        contactId: params.contactId,
        processorSubscriptionId: membershipId,
        updates: {
          status: 'cancelled',
          cancelled_at: result.canceledAt || new Date().toISOString(),
          next_billing_date: null,
          pulse_cadence_enabled: false,
          next_pulse_due_at: null,
        },
        action: 'cancel',
      });
    } else if (shouldCancelProcessor && processorSubscriptionId) {
      try {
        const { config: procConfig } = await resolveProcessor(params.merchantId, params.locationId, {
          processor_override: params.processorType || null,
          nmi_processor_id: null,
        });
        const processor = createProcessorClient(procConfig);
        const result = await processor.cancelSubscription(processorSubscriptionId);
        assertProcessorSuccess(result, procConfig.processor_type || 'processor', 'cancel');
      } catch (err: any) {
        logger.warn({ err: err.message, enrollmentId: params.enrollmentId }, 'Processor subscription cancel failed');
        throw err;
      }
      // Keep the processor subscription reference as historical billing evidence.
      await updateEnrollmentForLifecycleAction({
        locationId: params.locationId,
        enrollmentId: params.enrollmentId,
        contactId: params.contactId,
        processorSubscriptionId,
        updates: cancelledEnrollmentUpdates,
        action: 'cancel',
      });
    } else {
      // No future processor billing remains, so close the ScaleSafe enrollment
      // without calling a disconnected or historical processor account.
      await updateEnrollmentForLifecycleAction({
        locationId: params.locationId,
        enrollmentId: params.enrollmentId,
        contactId: params.contactId,
        fallbackStatuses: ['enrolled', 'active', 'paused'],
        updates: cancelledEnrollmentUpdates,
        action: 'cancel',
      });
    }

    // Log subscription change evidence (enriched with context — non-fatal)
    try {
      await evidenceService.logEvidence(
        EVIDENCE_TYPES.SUBSCRIPTION_CHANGE, params.locationId, params.contactId, 'merchant_action',
        {
          action: 'cancel',
          change_date: new Date().toISOString(),
          reason: params.reason,
          initiated_by: params.reason?.startsWith('Client-initiated:') ? 'client' : 'merchant',
          previous_status: 'enrolled',
          new_status: 'cancelled',
          enrollment_id: params.enrollmentId || null,
          raw_payload: params as any,
          ...buildDefenseEvidenceFields({
            summary: `Subscription cancellation recorded. Initiated by ${params.reason?.startsWith('Client-initiated:') ? 'client' : 'merchant'}. Reason: ${params.reason || 'not specified'}.`,
            title: 'Subscription Cancelled',
            proofRole: 'cancellation',
            relevance: { tags: ['cancelled_recurring', 'credit_not_processed'], priority: 'high', confidence: 'strong' },
            enrollmentId: params.enrollmentId || null,
            metadata: {
              actor: params.reason?.startsWith('Client-initiated:') ? 'client' : 'merchant',
              service: { enrollmentId: params.enrollmentId || null, offerId: params.offerId || null },
              transaction: {
                processor: params.processorType || null,
                subscriptionId: params.processorSubscriptionId || null,
              },
              source: { system: 'payment_lifecycle', rawEventType: 'subscription_cancel' },
            },
          }),
        },
      );
    } catch (evErr: any) {
      logger.warn({ err: evErr.message, enrollmentId: params.enrollmentId }, 'Cancel subscription change evidence failed (non-fatal)');
    }

    // Log cancellation evidence (enriched for defense letter quality)
    let cancelEnrollmentId: string | null = null;
    let cancelContactName = '';
    let cancelContactEmail = '';
    let cancelPaymentsMade = 0;
    let cancelPaymentsTotal = 0;
    let cancelEnrolledAt = '';
    try {
      const supabase = getSupabase();
      let enrollmentQuery = supabase.from('enrollments')
        .select('id, email, first_name, last_name, digital_signature, payments_made, payments_total, enrolled_at')
        .eq('location_id', params.locationId)
        .eq('contact_id', params.contactId);
      if (params.enrollmentId) {
        enrollmentQuery = enrollmentQuery.eq('id', params.enrollmentId);
      } else {
        enrollmentQuery = enrollmentQuery.order('created_at', { ascending: false }).limit(1);
      }
      const { data: enr } = await enrollmentQuery.maybeSingle();
      if (enr) {
        cancelEnrollmentId = enr.id;
        cancelContactName = [enr.first_name, enr.last_name].filter(Boolean).join(' ') || enr.digital_signature || '';
        cancelContactEmail = enr.email || '';
        cancelPaymentsMade = enr.payments_made || 0;
        cancelPaymentsTotal = enr.payments_total || 0;
        cancelEnrolledAt = enr.enrolled_at || '';
      }
    } catch {}

    const cancelDate = new Date().toISOString();
    const fmtCancelDate = new Date(cancelDate).toLocaleDateString('en-US', { dateStyle: 'long' });
    const fmtEnrolledAt = cancelEnrolledAt ? new Date(cancelEnrolledAt).toLocaleDateString('en-US', { dateStyle: 'long' }) : 'unknown';
    const daysSinceEnroll = cancelEnrolledAt
      ? Math.floor((Date.now() - new Date(cancelEnrolledAt).getTime()) / 86400000)
      : null;

    try {
      await evidenceService.logEvidence(
        EVIDENCE_TYPES.CANCELLATION, params.locationId, params.contactId, 'merchant_action',
        {
          cancellation_date: cancelDate,
          reason: params.reason,
          refund_eligibility: 'per_terms',
          status_at_cancellation: 'cancelled',
          initiated_by: 'merchant',
          enrollment_id: cancelEnrollmentId,
          contact_name: cancelContactName || null,
          contact_email: cancelContactEmail || null,
          description: `Merchant-initiated cancellation on ${fmtCancelDate}. Reason: ${params.reason || 'not specified'}. Status at cancellation: enrolled (${cancelPaymentsMade} of ${cancelPaymentsTotal || '?'} payments made). Active service period: ${fmtEnrolledAt} to ${fmtCancelDate}${daysSinceEnroll !== null ? ` (${daysSinceEnroll} days)` : ''}.`,
          raw_payload: params as any,
          ...buildDefenseEvidenceFields({
            summary: `Cancellation recorded on ${fmtCancelDate}. Reason: ${params.reason || 'not specified'}. Active service period: ${fmtEnrolledAt} to ${fmtCancelDate}${daysSinceEnroll !== null ? ` (${daysSinceEnroll} days)` : ''}.`,
            title: 'Cancellation Record',
            proofRole: 'cancellation',
            relevance: { tags: ['cancelled_recurring', 'credit_not_processed'], priority: 'critical', confidence: 'strong' },
            enrollmentId: cancelEnrollmentId,
            metadata: {
              actor: params.reason?.startsWith('Client-initiated:') ? 'client' : 'merchant',
              customerIdentity: { name: cancelContactName || null, email: cancelContactEmail || null },
              service: { enrollmentId: cancelEnrollmentId, offerId: params.offerId || null },
              transaction: { processor: params.processorType || null, subscriptionId: params.processorSubscriptionId || null },
              source: { system: 'payment_lifecycle', rawEventType: 'cancellation_record' },
            },
          }),
        },
      );
    } catch (evErr: any) {
      logger.warn({ err: evErr.message, enrollmentId: params.enrollmentId }, 'Cancellation evidence failed (non-fatal)');
    }

    // Fire trigger — flat doc contract: contact_id, offer_id, reason, refund_eligibility, enrollment_date
    try {
      const supabase = getSupabase();
      let enrollmentQuery = supabase.from('enrollments')
        .select('id, enrolled_at, offer_id, program_name_snapshot')
        .eq('location_id', params.locationId)
        .eq('contact_id', params.contactId);
      if (params.enrollmentId) {
        enrollmentQuery = enrollmentQuery.eq('id', params.enrollmentId);
      } else {
        enrollmentQuery = enrollmentQuery.order('created_at', { ascending: false }).limit(1);
      }
      const { data: enrollment, error: enrollmentError } = await enrollmentQuery.maybeSingle();
      if (enrollmentError) throw enrollmentError;
      if (!enrollment) throw new Error('Exact cancellation enrollment was not found');

      const resolvedOfferId = params.offerId || enrollment.offer_id || '';
      if (!resolvedOfferId) throw new Error('Cancellation enrollment has no offer');

      const { data: offer, error: offerError } = await supabase.from('offers_mirror')
        .select('offer_name, refund_window_text, tc_url')
        .eq('id', resolvedOfferId)
        .eq('location_id', params.locationId)
        .maybeSingle();
      if (offerError) throw offerError;
      if (!offer) throw new Error('Cancellation offer was not found');

      const merchant = await merchantRepository.getByLocationId(params.locationId);
      const offerName = resolveProgramName(enrollment, offer);
      const workflowFieldsReady = await syncCancellationWorkflowContact({
        locationId: params.locationId,
        contactId: params.contactId,
        offerName,
        businessName: merchant.dba_name || merchant.business_name || '',
        supportEmail: merchant.support_email || '',
        refundPolicy: resolveWorkflowRefundPolicy(offer),
        termsUrl: resolveWorkflowTermsUrl(offer, merchant),
      });

      if (workflowFieldsReady) {
        fireTriggerInBackground(params.locationId, 'ss_cancellation_requested', {
          event_type: 'cancellation_requested',
          location_id: params.locationId,
          locationId: params.locationId,
          contact_id: params.contactId,
          contactId: params.contactId,
          enrollment_id: enrollment.id,
          enrollmentId: enrollment.id,
          offer_id: resolvedOfferId,
          offerId: resolvedOfferId,
          offer_name: offerName,
          offerName,
          program_name: offerName,
          programName: offerName,
          processor: params.processorType || '',
          subscription_id: params.processorSubscriptionId || '',
          subscriptionId: params.processorSubscriptionId || '',
          reason: params.reason,
          refund_eligibility: 'per_terms',
          refundEligibility: 'per_terms',
          enrollment_date: enrollment.enrolled_at || '',
          enrollmentDate: enrollment.enrolled_at || '',
        });
      }
    } catch (err: any) {
      logger.warn(
        { err: err?.message || String(err), enrollmentId: params.enrollmentId, locationId: params.locationId },
        'Cancellation workflow trigger suppressed because exact enrollment fields could not be prepared',
      );
    }

    // Update GHL contact — only set status to 'cancelled' if NO other active enrollments exist
    try {
      const api = await ghlApi(params.locationId);
      const supabaseCheck = getSupabase();
      const { data: otherActive } = await supabaseCheck.from('enrollments')
        .select('id')
        .eq('location_id', params.locationId)
        .eq('contact_id', params.contactId)
        .in('status', ['enrolled', 'active', 'paused'])
        .neq('id', params.enrollmentId || '_none_')
        .limit(1)
        .maybeSingle();

      if (!otherActive) {
        await api.put(`/contacts/${params.contactId}`, {
          customField: { [SS_CONTACT_FIELDS.ENROLLMENT_STATUS]: 'cancelled' },
        });
      }
      await api.post(`/contacts/${params.contactId}/notes`, {
        body: `Subscription cancelled: ${params.reason}`,
      });
    } catch { /* non-blocking */ }

    logger.info({ contactId: params.contactId, reason: params.reason }, 'Subscription cancelled');
  },

  /**
   * Manually complete an enrollment. Logs evidence, fires trigger, updates GHL.
   * Cancels any active processor subscription.
   */
  async completeEnrollment(params: SubscriptionParams): Promise<void> {
    const supabase = getSupabase();

    // Cancel processor subscription if one exists
    if (params.processorSubscriptionId) {
      try {
        const { config: procConfig } = await resolveProcessor(params.merchantId, params.locationId, {
          processor_override: params.processorType || null,
          nmi_processor_id: null,
        });
        const processor = createProcessorClient(procConfig);
        await processor.cancelSubscription(params.processorSubscriptionId);
      } catch (err: any) {
        logger.warn({ err: err.message }, 'Processor subscription cancel on complete failed — completing anyway');
      }
    }

    // Update enrollment status — scope to single enrollment when enrollmentId is provided
    const completedAt = new Date().toISOString();
    try {
      if (params.enrollmentId) {
        await supabase.from('enrollments').update({
          status: 'completed', completed_at: completedAt,
          next_billing_date: null,
        }).eq('id', params.enrollmentId);
      } else if (params.processorSubscriptionId) {
        await supabase.from('enrollments').update({
          status: 'completed', completed_at: completedAt,
          next_billing_date: null,
        }).eq('location_id', params.locationId).eq('contact_id', params.contactId)
         .eq('processor_subscription_id', params.processorSubscriptionId);
      } else {
        await supabase.from('enrollments').update({
          status: 'completed', completed_at: completedAt, next_billing_date: null,
        }).eq('location_id', params.locationId).eq('contact_id', params.contactId)
         .in('status', ['enrolled', 'active', 'paused']);
      }
    } catch {}

    // Log evidence
    await evidenceService.logEvidence(
      EVIDENCE_TYPES.SUBSCRIPTION_CHANGE, params.locationId, params.contactId, 'merchant_action',
      {
        action: 'complete',
        change_date: completedAt,
        reason: params.reason,
        initiated_by: 'merchant',
        previous_status: 'enrolled',
        new_status: 'completed',
        enrollment_id: params.enrollmentId || null,
        raw_payload: params as any,
        ...buildDefenseEvidenceFields({
          summary: `Merchant marked the subscription complete. Reason: ${params.reason || 'not specified'}.`,
          title: 'Subscription Completed',
          proofRole: 'billing_update',
          relevance: { tags: ['services_not_provided', 'cancelled_recurring'], priority: 'medium', confidence: 'moderate' },
          enrollmentId: params.enrollmentId || null,
          metadata: {
            actor: 'merchant',
            service: { enrollmentId: params.enrollmentId || null, offerId: params.offerId || null },
            transaction: {
              processor: params.processorType || null,
              subscriptionId: params.processorSubscriptionId || null,
            },
            source: { system: 'payment_lifecycle', rawEventType: 'subscription_complete' },
          },
        }),
      },
    );

    // Fire trigger
    try {
      let offerName = '';
      try {
        const { data: ofr } = await getSupabase().from('offers_mirror').select('offer_name').eq('id', params.offerId).maybeSingle();
        offerName = ofr?.offer_name || '';
      } catch {}
      fireTriggerInBackground(params.locationId, 'ss_program_completed', {
        event_type: 'program_completed',
        location_id: params.locationId,
        locationId: params.locationId,
        contact_id: params.contactId,
        contactId: params.contactId,
        enrollment_id: params.enrollmentId || '',
        enrollmentId: params.enrollmentId || '',
        offer_id: params.offerId,
        offerId: params.offerId,
        offer_name: offerName,
        offerName,
        program_name: offerName,
        programName: offerName,
        processor: params.processorType || '',
        subscription_id: params.processorSubscriptionId || '',
        subscriptionId: params.processorSubscriptionId || '',
        completed_at: completedAt,
        completedAt,
        completion_reason: params.reason || 'manual_complete',
        completionReason: params.reason || 'manual_complete',
      });
    } catch {}

    // Update GHL contact
    try {
      const api = await ghlApi(params.locationId);
      await api.put(`/contacts/${params.contactId}`, {
        customField: { [SS_CONTACT_FIELDS.ENROLLMENT_STATUS]: 'completed' },
      });
      await api.post(`/contacts/${params.contactId}/notes`, {
        body: `Program marked complete: ${params.reason || 'Merchant action'}`,
      });
    } catch {}

    logger.info({ contactId: params.contactId, reason: params.reason }, 'Enrollment manually completed');
  },

  // ═══════════════════════════════════════════════════════════════
  // CARD MANAGEMENT (functions 34-37)
  // ═══════════════════════════════════════════════════════════════

  /**
   * List saved cards for a contact.
   */
  async listCards(params: CardManagementParams): Promise<StoredCard[]> {
    const supabase = getSupabase();
    const { data: methods } = await supabase
      .from('payment_methods')
      .select('*')
      .eq('location_id', params.locationId)
      .eq('contact_id', params.contactId)
      .order('created_at', { ascending: false });

    const { visible } = collapseVisiblePaymentMethods(methods || []);
    return visible.map(m => ({
      paymentMethodId: m.stripe_payment_method_id || m.nmi_customer_vault_id || m.id,
      customerId: m.stripe_customer_id || m.nmi_customer_vault_id || '',
      cardLastFour: m.card_last_four || '',
      cardBrand: m.card_brand || '',
      cardExpMonth: m.card_exp_month || 0,
      cardExpYear: m.card_exp_year || 0,
      isDefault: m.is_default || false,
    }));
  },

  /**
   * Delete a saved card. Removes from processor + payment_methods table.
   */
  async deleteCard(params: CardManagementParams, cardId: string): Promise<void> {
    const supabase = getSupabase();

    const { data: method } = await supabase
      .from('payment_methods')
      .select('*')
      .eq('id', cardId)
      .eq('location_id', params.locationId)
      .eq('contact_id', params.contactId)
      .single();

    if (!method) throw new Error('Payment method not found');

    await archivePaymentMethod(params.locationId, params.contactId, cardId);

    logger.info({ contactId: params.contactId, cardId }, 'Payment method deleted');
  },

  /**
   * Set a card as the default payment method.
   */
  async updateDefaultCard(params: CardManagementParams, cardId: string): Promise<void> {
    const supabase = getSupabase();

    // Unset all existing defaults
    await supabase.from('payment_methods')
      .update({ is_default: false })
      .eq('location_id', params.locationId)
      .eq('contact_id', params.contactId);

    // Set new default
    await supabase.from('payment_methods')
      .update({ is_default: true })
      .eq('id', cardId)
      .eq('location_id', params.locationId)
      .eq('contact_id', params.contactId);

    logger.info({ contactId: params.contactId, cardId }, 'Default payment method updated');
  },

  // ═══════════════════════════════════════════════════════════════
  // PAYMENT NOTIFICATION HELPERS (functions 41-43)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Fire GHL trigger for a successful payment.
   */
  async notifyPaymentSuccess(locationId: string, contactId: string, data: {
    amount: number; transactionId: string; paymentsRemaining?: number; runningTotal?: number; action?: string;
  }): Promise<void> {
    try {
      const api = await ghlApi(locationId);
      await api.put(`/contacts/${contactId}`, {
        customField: {
          [WORKFLOW_PAYMENT_CONTACT_FIELDS.PAYMENT_STATUS]: 'Current',
          [WORKFLOW_PAYMENT_CONTACT_FIELDS.LAST_PAYMENT_AMOUNT]: formatMoney(data.amount),
          [WORKFLOW_PAYMENT_CONTACT_FIELDS.LAST_PAYMENT_DATE]: today(),
          [WORKFLOW_PAYMENT_CONTACT_FIELDS.PAYMENTS_REMAINING]: data.paymentsRemaining ?? 0,
          [WORKFLOW_PAYMENT_CONTACT_FIELDS.TOTAL_PAID]: formatMoney(data.runningTotal ?? data.amount),
        },
      });
      await triggerService.fireTrigger(locationId, 'ss_payment_received', {
        event_type: 'payment_received',
        location_id: locationId,
        locationId,
        contact_id: contactId,
        contactId,
        enrollment_id: '',
        enrollmentId: '',
        offer_id: '',
        offerId: '',
        amount: data.amount,
        amount_display: formatMoney(data.amount),
        amountDisplay: formatMoney(data.amount),
        transaction_id: data.transactionId,
        transactionId: data.transactionId,
        payments_remaining: data.paymentsRemaining ?? 0,
        paymentsRemaining: data.paymentsRemaining ?? 0,
        running_total: data.runningTotal ?? data.amount,
        runningTotal: data.runningTotal ?? data.amount,
        running_total_display: formatMoney(data.runningTotal ?? data.amount),
        runningTotalDisplay: formatMoney(data.runningTotal ?? data.amount),
        action: data.action || 'payment_received',
        payment_kind: data.action || 'payment_received',
        paymentKind: data.action || 'payment_received',
        payment_source: 'payment_lifecycle',
        paymentSource: 'payment_lifecycle',
        payment_timing: 'manual',
        paymentTiming: 'manual',
        receipt_only: true,
        receiptOnly: true,
        send_receipt: true,
        sendReceipt: true,
        send_welcome: false,
        sendWelcome: false,
      });
    } catch (err: any) {
      logger.warn({ err: err.message, contactId }, 'Payment success notification trigger failed');
    }
  },

  /**
   * Fire GHL trigger for a failed payment.
   */
  async notifyPaymentFailed(locationId: string, contactId: string, data: {
    amount: number; failureReason: string; attemptCount?: number; nextRetryDate?: string;
  }): Promise<void> {
    try {
      const api = await ghlApi(locationId);
      await api.put(`/contacts/${contactId}`, {
        customField: {
          [SS_CONTACT_FIELDS.ENROLLMENT_STATUS]: 'past_due',
          [WORKFLOW_PAYMENT_CONTACT_FIELDS.PAYMENT_STATUS]: 'Past Due',
          [WORKFLOW_PAYMENT_CONTACT_FIELDS.FAILED_PAYMENT_COUNT]: data.attemptCount || 1,
          [WORKFLOW_PAYMENT_CONTACT_FIELDS.LAST_FAILED_PAYMENT_DATE]: today(),
          [WORKFLOW_PAYMENT_CONTACT_FIELDS.LAST_PAYMENT_AMOUNT]: formatMoney(data.amount),
        },
      });
      await triggerService.fireTrigger(locationId, 'ss_payment_failed', {
        event_type: 'payment_failed',
        location_id: locationId,
        locationId,
        contact_id: contactId,
        contactId,
        amount: data.amount,
        amount_display: formatMoney(data.amount),
        amountDisplay: formatMoney(data.amount),
        failure_reason: data.failureReason,
        failureReason: data.failureReason,
        attempt_count: data.attemptCount || 1,
        attemptCount: data.attemptCount || 1,
        next_retry_date: data.nextRetryDate || 'none',
        nextRetryDate: data.nextRetryDate || 'none',
        dunning_stage: (data.attemptCount || 1) > 1 ? 'retry_failed' : 'initial',
        dunningStage: (data.attemptCount || 1) > 1 ? 'retry_failed' : 'initial',
      });
    } catch (err: any) {
      logger.warn({ err: err.message, contactId }, 'Payment failed notification trigger failed');
    }
  },

  /**
   * Fire GHL trigger for a processed refund.
   */
  async notifyRefundProcessed(locationId: string, contactId: string, data: {
    amount: number; refundType: string; reason: string; transactionId?: string;
    enrollmentId?: string | null; offerId?: string | null; programName?: string | null;
    processor?: string | null; subscriptionId?: string | null;
  }): Promise<void> {
    try {
      const api = await ghlApi(locationId);
      await api.put(`/contacts/${contactId}`, {
        customField: {
          [WORKFLOW_PAYMENT_CONTACT_FIELDS.REFUND_AMOUNT]: formatMoney(data.amount),
          [WORKFLOW_PAYMENT_CONTACT_FIELDS.REFUND_DATE]: today(),
          [WORKFLOW_PAYMENT_CONTACT_FIELDS.REFUND_TRANSACTION_ID]: data.transactionId || '',
        },
      });
      await triggerService.fireTrigger(locationId, 'ss_refund_processed', {
        event_type: 'refund_processed',
        location_id: locationId,
        locationId,
        contact_id: contactId,
        contactId,
        enrollment_id: data.enrollmentId || '',
        enrollmentId: data.enrollmentId || '',
        offer_id: data.offerId || '',
        offerId: data.offerId || '',
        program_name: data.programName || '',
        programName: data.programName || '',
        offer_name: data.programName || '',
        offerName: data.programName || '',
        processor: data.processor || '',
        subscription_id: data.subscriptionId || '',
        subscriptionId: data.subscriptionId || '',
        amount: data.amount,
        amount_display: formatMoney(data.amount),
        amountDisplay: formatMoney(data.amount),
        refund_type: data.refundType,
        refundType: data.refundType,
        reason: data.reason,
        transaction_id: data.transactionId || '',
        transactionId: data.transactionId || '',
        refund_transaction_id: data.transactionId || '',
        refundTransactionId: data.transactionId || '',
      });
    } catch (err: any) {
      logger.warn({ err: err.message, contactId }, 'Refund notification trigger failed');
    }
  },

  // ═══════════════════════════════════════════════════════════════
  // SEND CARD UPDATE REQUEST
  // ═══════════════════════════════════════════════════════════════

  /**
   * Send a card update request to a client via GHL trigger.
   * Constructs the payment-update URL and fires ss_payment_failed
   * with action: card_update_requested so the merchant's GHL workflow
   * can send the link via email/SMS.
   */
  async sendCardUpdateRequest(locationId: string, contactId: string, options: { sendTrigger?: boolean; enrollmentId?: string } = {}): Promise<{ success: boolean; link: string }> {
    if (!options.enrollmentId) {
      throw new Error('enrollmentId required');
    }

    const { config: appConfig } = require('../config');
    const baseUrl = appConfig.appUrl;
    const actionToken = createPublicActionToken({
      action: 'payment_update',
      contactId,
      locationId,
      enrollmentId: options.enrollmentId,
    });
    const link = `${baseUrl}/payment-update?actionToken=${encodeURIComponent(actionToken)}`;

    if (options.sendTrigger !== false) {
      // Write URL to GHL contact custom field so workflow can use it
      try {
        const api = await ghlApi(locationId);
        await api.put(`/contacts/${contactId}`, {
          customField: {
            [SS_CONTACT_FIELDS.LAST_EVIDENCE_DATE]: new Date().toISOString().split('T')[0],
          },
        });
      } catch { /* non-blocking */ }

      // Fire trigger for GHL workflow to send the link
      try {
        await triggerService.fireTrigger(locationId, 'ss_payment_failed', {
          contact_id: contactId,
          contactId,
          enrollment_id: options.enrollmentId,
          enrollmentId: options.enrollmentId,
          amount: 0,
          failure_reason: 'card_update_requested',
          failureReason: 'card_update_requested',
          attempt_count: 0,
          attemptCount: 0,
          next_retry_date: 'none',
          nextRetryDate: 'none',
          dunning_stage: 'card_update_requested',
          dunningStage: 'card_update_requested',
          card_update_link: link,
          cardUpdateLink: link,
        });
      } catch (err: any) {
        logger.warn({ err: err.message, contactId }, 'Card update request trigger failed');
      }
    }

    logger.info({ contactId, locationId, linkGenerated: true }, 'Card update request sent');
    return { success: true, link };
  },

  // ═══════════════════════════════════════════════════════════════
  // ENRICHED TRIGGER PAYLOAD BUILDER
  // ═══════════════════════════════════════════════════════════════

};
