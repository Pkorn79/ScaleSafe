import { Request, Response } from 'express';
import { getSupabase } from '../clients/supabase.client';
import { resolveProcessor, createProcessorClient } from '../services/processor.factory';
import { handleRecurringPaymentSuccess, handleRecurringPaymentFailure } from '../services/recurring-payment.service';
import { nmiDiagnosticLogService } from '../services/nmi-diagnostic-log.service';
import { isNmiOfficialEventPayload, processNmiOfficialWebhookRequest } from './nmi-webhook-events.controller';
import { logger } from '../utils/logger';

async function createDiagnosticLog(
  supabase: ReturnType<typeof getSupabase>,
  fields: Record<string, unknown>,
): Promise<string | null> {
  void supabase;
  return nmiDiagnosticLogService.create(fields);
}

async function updateDiagnosticLog(
  supabase: ReturnType<typeof getSupabase>,
  logId: string | null,
  fields: Record<string, unknown>,
): Promise<void> {
  void supabase;
  await nmiDiagnosticLogService.update(logId, fields);
}

function isValidNmiIdentifier(value: string): boolean {
  return value.length >= 1
    && value.length <= 128
    && /^[A-Za-z0-9_-]+$/.test(value);
}

/**
 * POST /webhooks/nmi/silent-post
 *
 * Compatibility endpoint for the NMI webhook URL already configured in merchant
 * portals. It now accepts both official NMI event payloads and older
 * transaction/name-value payloads.
 */
export async function handleNmiSilentPost(req: Request, res: Response): Promise<void> {
  let diagnosticLogId: string | null = null;
  let diagnosticSupabase: ReturnType<typeof getSupabase> | null = null;

  try {
    const body = req.body || {};
    if (isNmiOfficialEventPayload(body)) {
      await processNmiOfficialWebhookRequest(req, res, { requireSignature: true });
      return;
    }

    const readBodyValue = (...keys: string[]): string => {
      for (const key of keys) {
        const value = body[key];
        if (value !== undefined && value !== null && String(value).trim() !== '') {
          return String(value).trim();
        }
      }
      return '';
    };

    const subscriptionId = readBodyValue(
      'subscription_id',
      'subscriptionid',
      'reference_id',
      'referenceid',
      'recurring_id',
      'recurringid',
    );
    const transactionId = readBodyValue('transactionid', 'transaction_id', 'transactionId', 'id');
    const rawKeys = Object.keys(body).sort();
    const supabase = getSupabase();
    diagnosticSupabase = supabase;

    diagnosticLogId = await createDiagnosticLog(supabase, {
      processor_subscription_id: subscriptionId || null,
      transaction_id: transactionId || null,
      amount: null,
      response_code: null,
      response_text: null,
      verification_status: transactionId ? 'pending' : 'skipped',
      action: 'received',
      raw_keys: rawKeys,
    });

    if (!subscriptionId) {
      logger.debug({ body: rawKeys }, 'NMI Silent Post: no subscription id - ignoring');
      await updateDiagnosticLog(supabase, diagnosticLogId, {
        action: 'ignored_missing_subscription_id',
        error_message: 'No subscription_id/reference_id in NMI Silent Post body',
      });
      res.status(200).json({ received: true });
      return;
    }

    logger.info({
      subscriptionId,
      transactionId,
    }, 'NMI Silent Post received');

    if (!transactionId) {
      logger.warn({ subscriptionId }, 'NMI Silent Post: post missing transaction id - ignoring');
      await updateDiagnosticLog(supabase, diagnosticLogId, {
        verification_status: 'failed',
        action: 'ignored_missing_transaction_id',
        error_message: 'NMI Silent Post did not include a transaction id',
      });
      res.status(200).json({ received: true });
      return;
    }

    if (!isValidNmiIdentifier(subscriptionId) || !isValidNmiIdentifier(transactionId)) {
      logger.warn({ subscriptionLength: subscriptionId.length, transactionLength: transactionId.length }, 'NMI Silent Post: invalid identifier - ignoring');
      await updateDiagnosticLog(supabase, diagnosticLogId, {
        verification_status: 'failed',
        action: 'ignored_invalid_identifier',
        error_message: 'NMI Silent Post identifiers were outside the accepted format',
      });
      res.status(200).json({ received: true });
      return;
    }

    // Subscription IDs can collide across independent NMI gateways. The legacy
    // shared callback may proceed only when ScaleSafe already has one exact NMI
    // enrollment binding. It must never discover a tenant by trying credentials.
    const { data: candidateRows, error: candidateError } = await supabase
      .from('enrollments')
      .select('id, merchant_id, location_id, contact_id, offer_id, program_name_snapshot, payments_made, payments_total, payment_type, processor_subscription_id, processor_type, billing_completed_at, status')
      .eq('processor_subscription_id', subscriptionId)
      .eq('processor_type', 'nmi')
      .limit(2);
    if (candidateError) {
      throw new Error(`NMI enrollment binding lookup failed: ${candidateError.message}`);
    }
    const candidates = (candidateRows || []).filter(Boolean);

    if (candidates.length === 0) {
      logger.warn({ subscriptionId }, 'NMI Silent Post: unknown subscription - ignoring');
      await updateDiagnosticLog(supabase, diagnosticLogId, {
        matched: false,
        action: 'ignored_unknown_subscription',
        error_message: `No enrollment matched processor_subscription_id ${subscriptionId}`,
      });
      res.status(200).json({ received: true });
      return;
    }

    if (candidates.length !== 1) {
      logger.error({ subscriptionId, candidateCount: candidates.length }, 'NMI Silent Post: ambiguous subscription binding - ignoring');
      await updateDiagnosticLog(supabase, diagnosticLogId, {
        matched: false,
        verification_status: 'skipped',
        action: 'ignored_ambiguous_subscription',
        error_message: 'Multiple NMI enrollments share this subscription id; tenant-bound callback rollout required',
      });
      res.status(200).json({ received: true });
      return;
    }

    const enrollment: any = candidates[0];
    const terminalEnrollment = Boolean(enrollment.billing_completed_at)
      || ['cancelled', 'canceled', 'completed'].includes(String(enrollment.status || '').toLowerCase());
    if (!['installment', 'subscription'].includes(String(enrollment.payment_type || '').toLowerCase()) || terminalEnrollment) {
      logger.warn({ enrollmentId: enrollment.id, subscriptionId }, 'NMI Silent Post: inactive recurring binding - ignoring');
      await updateDiagnosticLog(supabase, diagnosticLogId, {
        merchant_id: enrollment.merchant_id,
        location_id: enrollment.location_id,
        enrollment_id: enrollment.id,
        matched: true,
        verification_status: 'skipped',
        action: 'ignored_inactive_binding',
        error_message: 'Enrollment is not an active recurring payment binding',
      });
      res.status(200).json({ received: true });
      return;
    }

    let installmentFrequency = 'monthly';
    let offerName = enrollment.program_name_snapshot || '';
    let offerNmiProcessorId: string | null = null;
    if (enrollment.offer_id) {
      const { data: offer, error: offerError } = await supabase
        .from('offers_mirror')
        .select('offer_name, installment_frequency, nmi_processor_id')
        .eq('id', enrollment.offer_id)
        .eq('location_id', enrollment.location_id)
        .maybeSingle();
      if (offerError) {
        throw new Error(`NMI enrollment offer lookup failed: ${offerError.message}`);
      }
      if (offer) {
        installmentFrequency = offer.installment_frequency || 'monthly';
        offerName = offer.offer_name || offerName;
        offerNmiProcessorId = offer.nmi_processor_id || null;
      }
    }

    const { data: existing, error: existingError } = await supabase
      .from('payment_events')
      .select('id')
      .eq('merchant_id', enrollment.merchant_id)
      .eq('processor_transaction_id', transactionId)
      .eq('location_id', enrollment.location_id)
      .eq('processor', 'nmi')
      .maybeSingle();
    if (existingError) {
      throw new Error(`NMI duplicate lookup failed: ${existingError.message}`);
    }
    if (existing) {
      logger.debug({ transactionId }, 'NMI Silent Post: transaction already processed - skipping');
      await updateDiagnosticLog(supabase, diagnosticLogId, {
        duplicate: true,
        verification_status: 'skipped',
        action: 'duplicate_transaction',
        payment_event_id: existing.id,
      });
      res.status(200).json({ received: true });
      return;
    }

    const { config: procConfig } = await resolveProcessor(enrollment.merchant_id, enrollment.location_id, {
      processor_override: 'nmi',
      nmi_processor_id: offerNmiProcessorId,
    });

    const processor = createProcessorClient(procConfig);
    const verification = await processor.verifyTransaction(transactionId, {
      subscriptionId,
      source: 'recurring',
      action: 'sale',
    });

    if (!verification.success || verification.transactionId !== transactionId) {
      throw new Error('NMI did not return the exact transaction for the bound subscription');
    }

    const verifiedSource = String(verification.source || '').toLowerCase();
    const verifiedAction = String(verification.action || '').toLowerCase();
    if (verification.subscriptionId && verification.subscriptionId !== subscriptionId) {
      await updateDiagnosticLog(supabase, diagnosticLogId, {
        action: 'ignored_subscription_mismatch',
        verification_status: 'failed',
        error_message: 'Verified NMI transaction did not match the bound subscription id',
      });
      res.status(200).json({ received: true });
      return;
    }
    if (verifiedSource !== 'recurring' || verifiedAction !== 'sale') {
      await updateDiagnosticLog(supabase, diagnosticLogId, {
        action: 'ignored_non_recurring_sale',
        verification_status: 'failed',
        error_message: 'NMI transaction was not a recurring sale',
      });
      res.status(200).json({ received: true });
      return;
    }

    const amountCents = Number.isSafeInteger(verification.amount) && verification.amount > 0
      ? verification.amount
      : 0;
    if (!amountCents) {
      throw new Error('NMI returned an invalid verified amount');
    }
    if (verification.status === 'pending' || verification.status === 'unknown') {
      throw new Error(`NMI transaction is not final: ${verification.status}`);
    }
    if (!['settled', 'failed'].includes(verification.status)) {
      await updateDiagnosticLog(supabase, diagnosticLogId, {
        action: 'ignored_non_sale_result',
        verification_status: 'failed',
        error_message: `NMI recurring sale has unsupported status ${verification.status}`,
      });
      res.status(200).json({ received: true });
      return;
    }
    if (verification.actionSucceeded === null || verification.actionSucceeded === undefined) {
      throw new Error('NMI sale result did not include an authoritative success flag');
    }
    if ((verification.status === 'settled') !== verification.actionSucceeded) {
      await updateDiagnosticLog(supabase, diagnosticLogId, {
        action: 'ignored_inconsistent_provider_result',
        verification_status: 'failed',
        error_message: 'NMI status and sale success flag were inconsistent',
      });
      res.status(200).json({ received: true });
      return;
    }

    await updateDiagnosticLog(supabase, diagnosticLogId, {
      merchant_id: enrollment.merchant_id,
      location_id: enrollment.location_id,
      enrollment_id: enrollment.id,
      matched: true,
      amount: amountCents / 100,
      response_code: verification.responseCode || null,
      response_text: verification.responseText || null,
      verification_status: 'verified',
    });

    if (verification.status === 'settled') {
      const result = await handleRecurringPaymentSuccess({
        enrollment,
        processorType: 'nmi',
        transactionId,
        amountCents,
        offerName,
        installmentFrequency,
        source: 'nmi_silent_post',
      });
      if (!result.duplicate && !result.paymentEventId) {
        throw new Error('Recurring payment handler did not return a committed payment event');
      }

      logger.info({
        enrollmentId: enrollment.id,
        subscriptionId,
        transactionId,
        amountCents,
        newPaymentsMade: result.newPaymentsMade,
        isFinal: result.isFinal,
      }, 'NMI Silent Post: subscription payment processed');

      await updateDiagnosticLog(supabase, diagnosticLogId, {
        verification_status: 'verified',
        action: result.duplicate ? 'duplicate_transaction' : 'processed_success',
        duplicate: result.duplicate,
        error_message: null,
        payment_event_id: result.paymentEventId,
      });
    } else {
      const failed = await handleRecurringPaymentFailure({
        enrollment,
        processorType: 'nmi',
        transactionId,
        amountCents,
        errorMessage: verification.responseText || 'NMI recurring sale failed',
        errorCode: verification.processorResponseCode || verification.responseCode,
        source: 'nmi_silent_post',
        rawPayload: {
          nmi_transaction_id: transactionId,
          nmi_subscription_id: subscriptionId,
          nmi_processor_id: procConfig.nmi_processor_id || null,
          nmi_response_code: verification.responseCode || null,
          nmi_processor_response_code: verification.processorResponseCode || null,
        },
      });

      logger.warn({
        enrollmentId: enrollment.id,
        subscriptionId,
      }, 'NMI Silent Post: subscription payment failed - dunning initiated');

      await updateDiagnosticLog(supabase, diagnosticLogId, {
        action: failed.duplicate ? 'duplicate_transaction' : 'processed_failure',
        duplicate: failed.duplicate,
        error_message: verification.responseText || 'NMI recurring sale failed',
        payment_event_id: failed.paymentEventId,
      });
    }
    res.status(200).json({ received: true });
    return;
  } catch (err: any) {
    logger.error({ err: err.message, stack: err.stack }, 'NMI Silent Post handler error');
    if (diagnosticSupabase) {
      await updateDiagnosticLog(diagnosticSupabase, diagnosticLogId, {
        action: 'handler_error',
        error_message: err.message || 'NMI Silent Post handler error',
      });
    }
    res.status(503).json({ received: false, retry: true });
    return;
  }
}
