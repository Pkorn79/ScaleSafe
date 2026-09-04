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

  // Always return 200 to prevent NMI from retrying forever.
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
    const nmiResponse = readBodyValue('response', 'response_code');
    const transactionId = readBodyValue('transactionid', 'transaction_id', 'transactionId', 'id');
    const amountStr = readBodyValue('amount');
    const responseText = readBodyValue('responsetext', 'response_text', 'responseText');
    const amountValue = Number.parseFloat(amountStr || '0');
    const safeAmount = Number.isFinite(amountValue) ? amountValue : 0;
    const rawKeys = Object.keys(body).sort();
    const supabase = getSupabase();
    diagnosticSupabase = supabase;

    diagnosticLogId = await createDiagnosticLog(supabase, {
      processor_subscription_id: subscriptionId || null,
      transaction_id: transactionId || null,
      amount: safeAmount || null,
      response_code: nmiResponse || null,
      response_text: responseText || null,
      verification_status: transactionId && nmiResponse === '1' ? 'pending' : 'skipped',
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
      response: nmiResponse,
      transactionId,
      amount: amountStr,
    }, 'NMI Silent Post received');

    if (!transactionId) {
      logger.warn({ subscriptionId, response: nmiResponse }, 'NMI Silent Post: post missing transaction id - ignoring');
      await updateDiagnosticLog(supabase, diagnosticLogId, {
        verification_status: 'failed',
        action: 'ignored_missing_transaction_id',
        error_message: 'NMI Silent Post did not include a transaction id',
      });
      res.status(200).json({ received: true });
      return;
    }

    // NMI subscription ids are gateway-sequential and can collide across
    // merchants (see nmi-recurring-sync #18). A candidate only claims the post
    // when the transaction verifies under its own gateway credentials, so
    // verification doubles as tenant disambiguation.
    const { data: candidateRows } = await supabase
      .from('enrollments')
      .select('id, merchant_id, location_id, contact_id, offer_id, program_name_snapshot, payments_made, payments_total, payment_type, processor_subscription_id, processor_type, billing_completed_at')
      .eq('processor_subscription_id', subscriptionId)
      .limit(5);
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

    let enrollment: any = null;
    let verification: any = null;
    let installmentFrequency = 'monthly';
    let offerName = '';
    let lastVerifyOutcome = {
      status: 'failed',
      action: 'ignored_verification_failed',
      message: 'NMI transaction verification returned unsuccessful',
    };

    for (const candidate of candidates) {
      let candidateFrequency = 'monthly';
      let candidateOfferName = '';
      let offerNmiProcessorId: string | null = null;
      if (candidate.offer_id) {
        const { data: offer } = await supabase
          .from('offers_mirror')
          .select('offer_name, installment_frequency, nmi_processor_id')
          .eq('id', candidate.offer_id)
          .eq('location_id', candidate.location_id)
          .single();
        if (offer) {
          candidateFrequency = offer.installment_frequency || 'monthly';
          candidateOfferName = offer.offer_name || '';
          offerNmiProcessorId = offer.nmi_processor_id || null;
        }
      }

      try {
        const { config: procConfig } = await resolveProcessor(candidate.merchant_id, candidate.location_id, {
          processor_override: 'nmi',
          nmi_processor_id: offerNmiProcessorId,
        });
        const processor = createProcessorClient(procConfig);
        const result = await processor.verifyTransaction(transactionId);
        if (!result.success) {
          lastVerifyOutcome = {
            status: 'failed',
            action: 'ignored_verification_failed',
            message: 'NMI transaction verification returned unsuccessful',
          };
          continue;
        }
        if (result.subscriptionId && result.subscriptionId !== subscriptionId) {
          lastVerifyOutcome = {
            status: 'failed',
            action: 'ignored_subscription_mismatch',
            message: 'Verified NMI transaction did not belong to the posted subscription id',
          };
          continue;
        }
        enrollment = candidate;
        verification = result;
        installmentFrequency = candidateFrequency;
        offerName = candidateOfferName;
        break;
      } catch (verifyErr: any) {
        logger.warn(
          { err: verifyErr.message, transactionId, subscriptionId, candidateLocation: candidate.location_id },
          'NMI Silent Post: verification threw for candidate',
        );
        lastVerifyOutcome = {
          status: 'error',
          action: 'ignored_verification_error',
          message: verifyErr.message || 'NMI verification threw',
        };
      }
    }

    if (!enrollment || !verification) {
      logger.warn({ transactionId, subscriptionId, candidates: candidates.length }, 'NMI Silent Post: no candidate verified the transaction - ignoring');
      await updateDiagnosticLog(supabase, diagnosticLogId, {
        verification_status: lastVerifyOutcome.status,
        action: lastVerifyOutcome.action,
        error_message: lastVerifyOutcome.message,
      });
      res.status(200).json({ received: true });
      return;
    }

    await updateDiagnosticLog(supabase, diagnosticLogId, {
      merchant_id: enrollment.merchant_id,
      location_id: enrollment.location_id,
      enrollment_id: enrollment.id,
      matched: true,
      verification_status: 'verified',
    });

    const { data: existing } = await supabase
      .from('payment_events')
      .select('id')
      .eq('processor_transaction_id', transactionId)
      .eq('location_id', enrollment.location_id)
      .maybeSingle();
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

    // Processor truth for money values: the verified amount (already cents)
    // wins over the attacker-controllable posted amount.
    const amountCents = Number.isFinite(verification.amount) && verification.amount > 0
      ? Math.round(verification.amount)
      : Math.round(safeAmount * 100);
    const verifiedSucceeded = verification.status === 'settled' || verification.status === 'pending';

    if (nmiResponse === '1') {
      if (!verifiedSucceeded) {
        logger.warn({ transactionId, subscriptionId, verifiedStatus: verification.status }, 'NMI Silent Post: approved post but verified transaction did not succeed - ignoring');
        await updateDiagnosticLog(supabase, diagnosticLogId, {
          action: 'ignored_success_condition_mismatch',
          error_message: `Post claimed approval but NMI reports the transaction as ${verification.status}`,
        });
        res.status(200).json({ received: true });
        return;
      }
      const result = await handleRecurringPaymentSuccess({
        enrollment,
        processorType: 'nmi',
        transactionId: transactionId || `nmi_sp_${Date.now()}`,
        amountCents,
        offerName,
        installmentFrequency,
        source: 'nmi_silent_post',
      });

      logger.info({
        enrollmentId: enrollment.id,
        subscriptionId,
        transactionId,
        amountCents,
        newPaymentsMade: result.newPaymentsMade,
        isFinal: result.isFinal,
      }, 'NMI Silent Post: subscription payment processed');

      await updateDiagnosticLog(supabase, diagnosticLogId, {
        verification_status: transactionId ? 'verified' : 'skipped',
        action: result.paymentEventId ? 'processed_success' : 'processed_success_payment_event_missing',
        error_message: result.paymentEventId ? null : 'Recurring payment handler did not return a payment_event id',
        payment_event_id: result.paymentEventId,
      });
    } else {
      if (verifiedSucceeded) {
        logger.warn({ transactionId, subscriptionId, verifiedStatus: verification.status }, 'NMI Silent Post: failure post but verified transaction succeeded - ignoring forged decline');
        await updateDiagnosticLog(supabase, diagnosticLogId, {
          action: 'ignored_failure_condition_mismatch',
          error_message: `Post claimed failure but NMI reports the transaction as ${verification.status}`,
        });
        res.status(200).json({ received: true });
        return;
      }
      const failed = await handleRecurringPaymentFailure({
        enrollment,
        processorType: 'nmi',
        transactionId: transactionId || null,
        amountCents,
        errorMessage: responseText || `NMI response code: ${nmiResponse}`,
        source: 'nmi_silent_post',
      }) || { paymentEventId: null };

      logger.warn({
        enrollmentId: enrollment.id,
        subscriptionId,
        response: nmiResponse,
        responseText,
      }, 'NMI Silent Post: subscription payment failed - dunning initiated');

      await updateDiagnosticLog(supabase, diagnosticLogId, {
        action: failed.paymentEventId ? 'processed_failure' : 'processed_failure_payment_event_missing',
        error_message: failed.paymentEventId ? (responseText || `NMI response code: ${nmiResponse}`) : 'Failed payment handler did not return a payment_event id',
        payment_event_id: failed.paymentEventId,
      });
    }
  } catch (err: any) {
    logger.error({ err: err.message, stack: err.stack }, 'NMI Silent Post handler error');
    if (diagnosticSupabase) {
      await updateDiagnosticLog(diagnosticSupabase, diagnosticLogId, {
        action: 'handler_error',
        error_message: err.message || 'NMI Silent Post handler error',
      });
    }
  }

  res.status(200).json({ received: true });
}
