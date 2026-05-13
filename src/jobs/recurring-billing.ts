import { getSupabase } from '../clients/supabase.client';
import { resolveProcessor, createProcessorClient } from '../services/processor.factory';
import { handleRecurringPaymentSuccess, handleRecurringPaymentFailure } from '../services/recurring-payment.service';
import { findSavedCardForProcessor } from '../services/payment-methods.service';
import { logger } from '../utils/logger';

function normalizeProcessor(value: unknown): 'nmi' | 'stripe' | null {
  const raw = String(value || '').toLowerCase();
  return raw === 'nmi' || raw === 'stripe' ? raw : null;
}

function recurringAmountDollars(enrollment: any, offer: any): number {
  const paymentType = String(enrollment.payment_type || '').toLowerCase();
  const amount = paymentType === 'subscription'
    ? Number(offer.price || offer.installment_amount || 0)
    : Number(offer.installment_amount || offer.price || 0);
  return Number.isFinite(amount) ? amount : 0;
}

/**
 * Fallback recurring billing.
 *
 * Processor-native subscriptions should normally bill and post back through
 * Stripe webhooks or NMI Silent Post. This job only charges enrollments that
 * do not have a processor_subscription_id. It must never borrow the contact's
 * global default card from a different processor.
 */
export async function runRecurringBilling(): Promise<void> {
  const supabase = getSupabase();
  const today = new Date().toISOString().split('T')[0];

  let due: any[] = [];
  try {
    const { data, error } = await supabase
      .from('enrollments')
      .select('id, location_id, merchant_id, contact_id, offer_id, payment_type, payments_made, payments_total, next_billing_date, status, email, processor_type, processor_subscription_id')
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
      const paymentType = String(enr.payment_type || '').toLowerCase();
      if (paymentType !== 'subscription' && enr.payments_total != null
        && (enr.payments_made || 0) >= enr.payments_total) {
        logger.info({ enrollmentId: enr.id }, 'Recurring billing: installment already paid off - skipping');
        skipped++;
        continue;
      }

      const { data: offer } = await supabase
        .from('offers_mirror')
        .select('id, offer_name, price, payment_type, installment_amount, installment_frequency, processor_override, nmi_processor_id')
        .eq('id', enr.offer_id)
        .single();

      if (!offer) {
        logger.warn({ enrollmentId: enr.id, offerId: enr.offer_id }, 'Recurring billing: offer missing - skipping');
        skipped++;
        continue;
      }

      const targetProcessor = normalizeProcessor(enr.processor_type) || normalizeProcessor(offer.processor_override);
      if (!targetProcessor) {
        logger.warn({ enrollmentId: enr.id, contactId: enr.contact_id }, 'Recurring billing: no trusted processor_type - skipping');
        skipped++;
        continue;
      }

      const pm = await findSavedCardForProcessor(enr.location_id, enr.contact_id, targetProcessor);
      if (!pm) {
        logger.warn({ enrollmentId: enr.id, contactId: enr.contact_id, processor: targetProcessor }, 'Recurring billing: no matching processor card - skipping');
        skipped++;
        continue;
      }

      const amountDollars = recurringAmountDollars(enr, offer);
      if (amountDollars <= 0) {
        logger.warn({ enrollmentId: enr.id, offerId: enr.offer_id, paymentType }, 'Recurring billing: recurring amount missing - skipping');
        skipped++;
        continue;
      }

      const amountCents = Math.round(amountDollars * 100);
      const { config: procConfig } = await resolveProcessor(enr.merchant_id, enr.location_id, {
        processor_override: targetProcessor,
        nmi_processor_id: targetProcessor === 'nmi' ? (offer.nmi_processor_id || null) : null,
      });
      const processor = createProcessorClient(procConfig);

      const customerId = pm.nmi_customer_vault_id || pm.stripe_customer_id || '';
      const paymentMethodToken = pm.stripe_payment_method_id || pm.nmi_customer_vault_id || '';
      const nextPaymentNumber = (enr.payments_made || 0) + 1;

      const result = await processor.chargeStoredCard(customerId, paymentMethodToken, {
        amount: amountCents,
        currency: 'usd',
        paymentToken: paymentMethodToken,
        description: `${offer.offer_name} - ${paymentType === 'subscription' ? 'subscription' : `installment ${nextPaymentNumber}${enr.payments_total ? `/${enr.payments_total}` : ''}`}`,
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
        }, 'Recurring billing: charge failed - dunning initiated');
      }
    } catch (err: any) {
      logger.error({ err: err.message, stack: err.stack, enrollmentId: enr.id }, 'Recurring billing: iteration threw');
      failed++;
    }
  }

  logger.info({ today, total: due.length, charged, failed, skipped }, 'Recurring billing batch complete');
}
