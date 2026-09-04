import { getSupabase } from '../clients/supabase.client';
import { resolveProcessor, createProcessorClient } from './processor.factory';
import { handleRecurringPaymentSuccess } from './recurring-payment.service';
import { logger } from '../utils/logger';

interface RepairMissedNmiPaymentParams {
  locationId: string;
  merchantId: string;
  subscriptionId: string;
  transactionId: string;
}

export const nmiRecurringRepairService = {
  async repairMissedPayment(params: RepairMissedNmiPaymentParams): Promise<{
    repaired: boolean;
    duplicate: boolean;
    enrollmentId: string;
    transactionId: string;
    amount: number;
    paymentEventId: string | null;
    newPaymentsMade: number;
    isFinal: boolean;
  }> {
    const subscriptionId = String(params.subscriptionId || '').trim();
    const transactionId = String(params.transactionId || '').trim();
    if (!subscriptionId || !transactionId) {
      throw new Error('subscriptionId and transactionId are required');
    }

    const supabase = getSupabase();
    const { data: enrollment, error: enrollmentError } = await supabase
      .from('enrollments')
      .select('id, merchant_id, location_id, contact_id, offer_id, program_name_snapshot, payments_made, payments_total, payment_type, processor_subscription_id, processor_config_id, processor_type, billing_completed_at')
      .eq('location_id', params.locationId)
      .eq('processor_subscription_id', subscriptionId)
      .single();

    if (enrollmentError || !enrollment) {
      throw new Error(`No ScaleSafe enrollment found for NMI subscription ${subscriptionId}`);
    }
    if (!enrollment.processor_config_id) {
      throw new Error('Enrollment has no immutable NMI processor configuration binding');
    }

    const { data: existing } = await supabase
      .from('payment_events')
      .select('id')
      .eq('location_id', params.locationId)
      .eq('processor', 'nmi')
      .eq('processor_config_id', enrollment.processor_config_id)
      .eq('processor_transaction_id', transactionId)
      .limit(1)
      .maybeSingle();

    if (existing?.id) {
      return {
        repaired: false,
        duplicate: true,
        enrollmentId: enrollment.id,
        transactionId,
        amount: 0,
        paymentEventId: existing.id,
        newPaymentsMade: enrollment.payments_made || 0,
        isFinal: false,
      };
    }

    let offerName = '';
    let installmentFrequency = 'monthly';
    if (enrollment.offer_id) {
      const { data: offer } = await supabase
        .from('offers_mirror')
        .select('offer_name, installment_frequency')
        .eq('id', enrollment.offer_id)
        .single();
      offerName = offer?.offer_name || '';
      installmentFrequency = offer?.installment_frequency || 'monthly';
    }

    const { config } = await resolveProcessor(enrollment.merchant_id || params.merchantId, params.locationId, {
      processor_override: 'nmi',
      processor_config_id: enrollment.processor_config_id,
      nmi_processor_id: null,
    });
    const processor = createProcessorClient(config);
    const verification = await processor.verifyTransaction(transactionId);
    const approved = verification.status === 'settled'
      || (verification.status === 'pending'
        && String(verification.providerStatus || '').toLowerCase() === 'pendingsettlement');
    if (!verification.success
      || verification.actionSucceeded !== true
      || !approved
      || verification.amount <= 0
      || (verification.processorId && verification.processorId !== config.nmi_processor_id)
      || (verification.subscriptionId && verification.subscriptionId !== subscriptionId)) {
      throw new Error(`NMI transaction ${transactionId} could not be verified`);
    }

    const result = await handleRecurringPaymentSuccess({
      enrollment,
      processorType: 'nmi',
      transactionId,
      amountCents: verification.amount,
      offerName,
      installmentFrequency,
      source: 'nmi_repair',
      processorConfigId: config.id,
      rawPayload: {
        nmi_transaction_id: transactionId,
        nmi_subscription_id: subscriptionId,
        nmi_processor_id: config.nmi_processor_id || null,
        nmi_processor_config_id: config.id,
        nmi_provider_status: verification.providerStatus || null,
        nmi_occurred_at: verification.occurredAt || null,
      },
    });

    try {
      await supabase.from('nmi_silent_post_logs').insert({
        merchant_id: enrollment.merchant_id || params.merchantId,
        location_id: params.locationId,
        enrollment_id: enrollment.id,
        processor_subscription_id: subscriptionId,
        transaction_id: transactionId,
        amount: verification.amount / 100,
        response_code: 'manual_repair',
        response_text: 'Manually verified against NMI and repaired in ScaleSafe',
        matched: true,
        duplicate: false,
        verification_status: 'verified',
        action: 'manual_repair_processed',
      });
    } catch (err: any) {
      logger.debug({ err: err.message, transactionId }, 'NMI repair diagnostic insert skipped');
    }

    return {
      repaired: true,
      duplicate: false,
      enrollmentId: enrollment.id,
      transactionId,
      amount: verification.amount / 100,
      paymentEventId: result.paymentEventId,
      newPaymentsMade: result.newPaymentsMade,
      isFinal: result.isFinal,
    };
  },
};
