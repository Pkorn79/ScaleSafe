import { Request, Response } from 'express';
import { getSupabase } from '../clients/supabase.client';
import { resolveProcessor, createProcessorClient } from '../services/processor.factory';
import { handleRecurringPaymentSuccess, handleRecurringPaymentFailure } from '../services/recurring-payment.service';
import { logger } from '../utils/logger';

/**
 * POST /webhooks/nmi/silent-post
 *
 * NMI "Silent Post URL" receives URL-encoded form data when a recurring
 * subscription transaction is processed. Unlike Stripe, NMI does NOT sign
 * its notifications — we verify each transaction by calling verifyTransaction()
 * with the merchant's security key.
 *
 * NMI expects a 200 response. Non-200 triggers retries.
 *
 * Key fields in req.body:
 *   subscription_id — NMI recurring subscription ID
 *   response        — "1" approved, "2" declined, "3" error
 *   transactionid   — NMI transaction ID for this charge
 *   amount          — dollar amount (e.g. "0.50")
 *   responsetext    — human-readable message
 *   type            — transaction type (usually "sale")
 */
export async function handleNmiSilentPost(req: Request, res: Response): Promise<void> {
  // Always return 200 to prevent NMI from retrying
  try {
    const body = req.body || {};
    const subscriptionId = body.subscription_id;
    const nmiResponse = body.response; // "1"=approved, "2"=declined, "3"=error
    const transactionId = body.transactionid;
    const amountStr = body.amount;
    const responseText = body.responsetext || '';

    if (!subscriptionId) {
      logger.debug({ body: Object.keys(body) }, 'NMI Silent Post: no subscription_id — ignoring');
      res.status(200).json({ received: true });
      return;
    }

    logger.info({
      subscriptionId,
      response: nmiResponse,
      transactionId,
      amount: amountStr,
    }, 'NMI Silent Post received');

    const supabase = getSupabase();

    // Look up enrollment by processor_subscription_id
    const { data: enrollment } = await supabase
      .from('enrollments')
      .select('id, merchant_id, location_id, contact_id, offer_id, payments_made, payments_total, payment_type')
      .eq('processor_subscription_id', subscriptionId)
      .single();

    if (!enrollment) {
      logger.warn({ subscriptionId }, 'NMI Silent Post: unknown subscription — ignoring');
      res.status(200).json({ received: true });
      return;
    }

    // Idempotency: check if we already processed this transaction
    if (transactionId) {
      const { data: existing } = await supabase
        .from('payment_events')
        .select('id')
        .eq('processor_transaction_id', transactionId)
        .maybeSingle();
      if (existing) {
        logger.debug({ transactionId }, 'NMI Silent Post: transaction already processed — skipping');
        res.status(200).json({ received: true });
        return;
      }
    }

    // Verify transaction with processor to prevent spoofing
    if (transactionId && nmiResponse === '1') {
      try {
        const { config: procConfig } = await resolveProcessor(enrollment.merchant_id, enrollment.location_id);
        const processor = createProcessorClient(procConfig);
        const verification = await processor.verifyTransaction(transactionId);
        if (!verification.success) {
          logger.warn({ transactionId, subscriptionId }, 'NMI Silent Post: transaction verification failed — ignoring');
          res.status(200).json({ received: true });
          return;
        }
      } catch (verifyErr: any) {
        logger.warn({ err: verifyErr.message, transactionId, subscriptionId }, 'NMI Silent Post: verification threw - ignoring transaction-bearing post');
        res.status(200).json({ received: true });
        return;
      }
    }

    // Resolve offer for installment details
    let installmentFrequency = 'monthly';
    let offerName = '';
    if (enrollment.offer_id) {
      const { data: offer } = await supabase
        .from('offers_mirror')
        .select('offer_name, installment_frequency')
        .eq('id', enrollment.offer_id)
        .single();
      if (offer) {
        installmentFrequency = offer.installment_frequency || 'monthly';
        offerName = offer.offer_name || '';
      }
    }

    const amountCents = Math.round(parseFloat(amountStr || '0') * 100);

    if (nmiResponse === '1') {
      // Approved — process as success
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
    } else {
      // Declined or error — process as failure
      await handleRecurringPaymentFailure({
        enrollment,
        processorType: 'nmi',
        amountCents,
        errorMessage: responseText || `NMI response code: ${nmiResponse}`,
        source: 'nmi_silent_post',
      });

      logger.warn({
        enrollmentId: enrollment.id,
        subscriptionId,
        response: nmiResponse,
        responseText,
      }, 'NMI Silent Post: subscription payment failed — dunning initiated');
    }
  } catch (err: any) {
    logger.error({ err: err.message, stack: err.stack }, 'NMI Silent Post handler error');
  }

  res.status(200).json({ received: true });
}
