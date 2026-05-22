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
      await processNmiOfficialWebhookRequest(req, res);
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

    const { data: enrollment } = await supabase
      .from('enrollments')
      .select('id, merchant_id, location_id, contact_id, offer_id, payments_made, payments_total, payment_type, processor_subscription_id, processor_type, billing_completed_at')
      .eq('processor_subscription_id', subscriptionId)
      .single();

    if (!enrollment) {
      logger.warn({ subscriptionId }, 'NMI Silent Post: unknown subscription - ignoring');
      await updateDiagnosticLog(supabase, diagnosticLogId, {
        matched: false,
        action: 'ignored_unknown_subscription',
        error_message: `No enrollment matched processor_subscription_id ${subscriptionId}`,
      });
      res.status(200).json({ received: true });
      return;
    }

    await updateDiagnosticLog(supabase, diagnosticLogId, {
      merchant_id: enrollment.merchant_id,
      location_id: enrollment.location_id,
      enrollment_id: enrollment.id,
      matched: true,
    });

    if (transactionId) {
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
    }

    if (nmiResponse === '1' && !transactionId) {
      logger.warn({ subscriptionId }, 'NMI Silent Post: approved payment missing transaction id - ignoring');
      await updateDiagnosticLog(supabase, diagnosticLogId, {
        verification_status: 'failed',
        action: 'ignored_missing_transaction_id',
        error_message: 'Approved NMI payment post did not include a transaction id',
      });
      res.status(200).json({ received: true });
      return;
    }

    let installmentFrequency = 'monthly';
    let offerName = '';
    let offerNmiProcessorId: string | null = null;
    if (enrollment.offer_id) {
      const { data: offer } = await supabase
        .from('offers_mirror')
        .select('offer_name, installment_frequency, nmi_processor_id')
        .eq('id', enrollment.offer_id)
        .single();
      if (offer) {
        installmentFrequency = offer.installment_frequency || 'monthly';
        offerName = offer.offer_name || '';
        offerNmiProcessorId = offer.nmi_processor_id || null;
      }
    }

    if (transactionId && nmiResponse === '1') {
      try {
        const { config: procConfig } = await resolveProcessor(enrollment.merchant_id, enrollment.location_id, {
          processor_override: 'nmi',
          nmi_processor_id: offerNmiProcessorId,
        });
        const processor = createProcessorClient(procConfig);
        const verification = await processor.verifyTransaction(transactionId);
        if (!verification.success) {
          logger.warn({ transactionId, subscriptionId }, 'NMI Silent Post: transaction verification failed - ignoring');
          await updateDiagnosticLog(supabase, diagnosticLogId, {
            verification_status: 'failed',
            action: 'ignored_verification_failed',
            error_message: 'NMI transaction verification returned unsuccessful',
          });
          res.status(200).json({ received: true });
          return;
        }
        await updateDiagnosticLog(supabase, diagnosticLogId, {
          verification_status: 'verified',
        });
      } catch (verifyErr: any) {
        logger.warn({ err: verifyErr.message, transactionId, subscriptionId }, 'NMI Silent Post: verification threw - ignoring transaction-bearing post');
        await updateDiagnosticLog(supabase, diagnosticLogId, {
          verification_status: 'error',
          action: 'ignored_verification_error',
          error_message: verifyErr.message || 'NMI verification threw',
        });
        res.status(200).json({ received: true });
        return;
      }
    }

    const amountCents = Math.round(safeAmount * 100);

    if (nmiResponse === '1') {
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
