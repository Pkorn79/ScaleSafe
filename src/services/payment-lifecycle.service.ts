import { getSupabase } from '../clients/supabase.client';
import { ghlApi } from '../clients/ghl.client';
import { resolveProcessor, createProcessorClient } from './processor.factory';
import { triggerService } from './trigger.service';
import { evidenceService } from './evidence.service';
import { merchantRepository } from '../repositories/merchant.repository';
import { logger } from '../utils/logger';
import { EVIDENCE_TYPES } from '../constants/evidence-types';
import { SS_CONTACT_FIELDS } from '../constants/ghl-fields';
import type { DunningParams, SubscriptionParams, CardManagementParams } from '../types/payment-lifecycle.types';
import type { StoredCard } from '../types/processor.types';

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

    // Update payment event with dunning metadata
    await supabase.from('payment_events').update({
      dunning_status: 'active',
      dunning_retry_count: 0,
      dunning_next_retry: nextRetryDate,
      dunning_started_at: new Date().toISOString(),
    }).eq('id', params.paymentEventId);

    // Fire trigger for GHL dunning workflow
    try {
      await triggerService.fireTrigger(params.locationId, 'ss_payment_failed', {
        contact_id: params.contactId,
        amount: params.amountCents / 100,
        failure_reason: params.failureReason,
        attempt_count: params.attemptCount,
        next_retry_date: nextRetryDate || 'none',
        action: 'dunning_start',
        is_soft_decline: isSoftDecline,
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
  async retryPayment(merchantId: string, locationId: string, contactId: string, paymentEventId: string): Promise<{ success: boolean; error?: string }> {
    const supabase = getSupabase();

    // Get the original failed payment event
    const { data: originalEvent } = await supabase
      .from('payment_events')
      .select('*')
      .eq('id', paymentEventId)
      .single();

    if (!originalEvent) {
      return { success: false, error: 'Payment event not found' };
    }

    // Get saved payment method
    const { data: method } = await supabase
      .from('payment_methods')
      .select('*')
      .eq('location_id', locationId)
      .eq('contact_id', contactId)
      .eq('is_default', true)
      .limit(1)
      .maybeSingle();

    if (!method) {
      return { success: false, error: 'No saved payment method found' };
    }

    // Attempt charge
    try {
      const { config: procConfig } = await resolveProcessor(merchantId, locationId);
      const processor = createProcessorClient(procConfig);
      const token = method.nmi_customer_vault_id || method.stripe_payment_method_id || '';
      const customerId = method.nmi_customer_vault_id || method.stripe_customer_id || '';

      const result = await processor.chargeStoredCard(customerId, token, {
        amount: Number(originalEvent.amount) * 100, // convert to cents
        currency: originalEvent.currency || 'usd',
        paymentToken: token,
        description: 'Dunning retry payment',
      });

      if (result.success) {
        // Record successful payment
        await supabase.from('payment_events').insert({
          merchant_id: merchantId,
          location_id: locationId,
          contact_id: contactId,
          event_type: 'sale',
          processor: procConfig.processor_type,
          processor_transaction_id: result.transactionId,
          amount: originalEvent.amount,
          currency: originalEvent.currency || 'usd',
          source: 'dunning_retry',
          is_recurring: true,
        });

        // Resolve dunning
        await supabase.from('payment_events').update({
          dunning_status: 'resolved',
          dunning_resolved_at: new Date().toISOString(),
        }).eq('id', paymentEventId);

        // Log evidence
        await evidenceService.logEvidence(
          EVIDENCE_TYPES.PAYMENT_CONFIRMATION, locationId, contactId, 'dunning_retry',
          { amount: originalEvent.amount, payment_date: new Date().toISOString(), transaction_id: result.transactionId },
        );

        // Fire success trigger
        try {
          await triggerService.fireTrigger(locationId, 'ss_payment_received', {
            contact_id: contactId, amount: originalEvent.amount,
            transaction_id: result.transactionId, action: 'dunning_resolved',
          });
        } catch { /* non-blocking */ }

        // Update GHL contact status back to active
        try {
          const api = await ghlApi(locationId);
          await api.put(`/contacts/${contactId}`, {
            customField: { [SS_CONTACT_FIELDS.ENROLLMENT_STATUS]: 'enrolled' },
          });
        } catch { /* non-blocking */ }

        logger.info({ contactId, paymentEventId, transactionId: result.transactionId }, 'Dunning retry succeeded');
        return { success: true };
      }

      // Retry failed — update retry count
      const retryCount = (originalEvent.dunning_retry_count || 0) + 1;
      const retryDays = [3, 7, 14];
      const nextRetry = retryCount < retryDays.length
        ? new Date(Date.now() + retryDays[retryCount] * 24 * 60 * 60 * 1000).toISOString()
        : null;

      await supabase.from('payment_events').update({
        dunning_retry_count: retryCount,
        dunning_next_retry: nextRetry,
      }).eq('id', paymentEventId);

      if (!nextRetry) {
        await this.escalateDunning(locationId, contactId, paymentEventId);
      }

      return { success: false, error: result.errorMessage || 'Charge declined' };
    } catch (err: any) {
      logger.error({ err: err.message, contactId, paymentEventId }, 'Dunning retry charge failed');
      return { success: false, error: err.message };
    }
  },

  /**
   * Escalate dunning after max retries reached.
   * Fires at-risk trigger, updates contact status to delinquent.
   */
  async escalateDunning(locationId: string, contactId: string, paymentEventId: string): Promise<void> {
    const supabase = getSupabase();

    await supabase.from('payment_events').update({
      dunning_status: 'escalated',
    }).eq('id', paymentEventId);

    // Log evidence of collection attempts
    await evidenceService.logEvidence(
      EVIDENCE_TYPES.FAILED_PAYMENT, locationId, contactId, 'dunning_escalation',
      { action: 'dunning_escalated', reason: 'Max retries reached', timestamp: new Date().toISOString() },
    );

    // Fire at-risk trigger
    try {
      await triggerService.fireTrigger(locationId, 'ss_client_at_risk', {
        contact_id: contactId, risk_reason: 'delinquent_payment',
        action: 'dunning_escalated',
      });
    } catch { /* non-blocking */ }

    // Update GHL contact
    try {
      const api = await ghlApi(locationId);
      await api.put(`/contacts/${contactId}`, {
        customField: { [SS_CONTACT_FIELDS.ENROLLMENT_STATUS]: 'delinquent' },
      });
    } catch { /* non-blocking */ }

    logger.info({ contactId, paymentEventId }, 'Dunning escalated — client marked delinquent');
  },

  // ═══════════════════════════════════════════════════════════════
  // SUBSCRIPTION MANAGEMENT (functions 38-40)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Pause a subscription. Logs evidence, fires trigger, updates GHL.
   */
  async pauseSubscription(params: SubscriptionParams): Promise<void> {
    // Pause via processor if we have a subscription ID
    if (params.processorSubscriptionId) {
      try {
        const { config: procConfig } = await resolveProcessor(params.merchantId, params.locationId);
        const processor = createProcessorClient(procConfig);
        await processor.cancelSubscription(params.processorSubscriptionId);
      } catch (err: any) {
        logger.warn({ err: err.message }, 'Processor subscription pause failed — logging evidence anyway');
      }
    }

    // Log evidence
    await evidenceService.logEvidence(
      EVIDENCE_TYPES.SUBSCRIPTION_CHANGE, params.locationId, params.contactId, 'merchant_action',
      { action: 'pause', change_date: new Date().toISOString(), reason: params.reason },
    );

    // Build enriched trigger payload
    const triggerPayload = await this.buildSubscriptionTriggerPayload(params, 'paused');

    // Fire trigger + update GHL + add note
    try {
      await triggerService.fireTrigger(params.locationId, 'ss_subscription_paused', triggerPayload);
    } catch { /* non-blocking */ }

    try {
      const api = await ghlApi(params.locationId);
      await api.put(`/contacts/${params.contactId}`, {
        customField: { [SS_CONTACT_FIELDS.ENROLLMENT_STATUS]: 'paused' },
      });
      await api.post(`/contacts/${params.contactId}/notes`, {
        body: `Subscription paused: ${params.reason}`,
      });
    } catch { /* non-blocking */ }

    logger.info({ contactId: params.contactId, reason: params.reason }, 'Subscription paused');
  },

  /**
   * Resume a paused subscription. Logs evidence, fires trigger, updates GHL.
   */
  async resumeSubscription(params: SubscriptionParams): Promise<void> {
    // Log evidence (action must match CHECK constraint: pause/resume/cancel/card_update/plan_change)
    await evidenceService.logEvidence(
      EVIDENCE_TYPES.SUBSCRIPTION_CHANGE, params.locationId, params.contactId, 'merchant_action',
      { action: 'resume', change_date: new Date().toISOString(), reason: params.reason },
    );

    // Fire dedicated resume trigger with enriched payload
    try {
      const triggerPayload = await this.buildSubscriptionTriggerPayload(params, 'active');
      await triggerService.fireTrigger(params.locationId, 'ss_subscription_resumed', triggerPayload);
    } catch { /* non-blocking */ }

    // Update GHL contact
    try {
      const api = await ghlApi(params.locationId);
      await api.put(`/contacts/${params.contactId}`, {
        customField: { [SS_CONTACT_FIELDS.ENROLLMENT_STATUS]: 'enrolled' },
      });
    } catch { /* non-blocking */ }

    logger.info({ contactId: params.contactId }, 'Subscription resumed');
  },

  /**
   * Cancel a subscription. Logs both subscription change + cancellation evidence.
   */
  async cancelSubscription(params: SubscriptionParams): Promise<void> {
    // Cancel via processor if we have a subscription ID
    if (params.processorSubscriptionId) {
      try {
        const { config: procConfig } = await resolveProcessor(params.merchantId, params.locationId);
        const processor = createProcessorClient(procConfig);
        await processor.cancelSubscription(params.processorSubscriptionId);
      } catch (err: any) {
        logger.warn({ err: err.message }, 'Processor subscription cancel failed — logging evidence anyway');
      }
    }

    // Log subscription change evidence (action must match CHECK constraint)
    await evidenceService.logEvidence(
      EVIDENCE_TYPES.SUBSCRIPTION_CHANGE, params.locationId, params.contactId, 'merchant_action',
      { action: 'cancel', change_date: new Date().toISOString(), reason: params.reason },
    );

    // Log cancellation evidence (separate — valuable for defense)
    await evidenceService.logEvidence(
      EVIDENCE_TYPES.CANCELLATION, params.locationId, params.contactId, 'merchant_action',
      { cancellation_date: new Date().toISOString(), reason: params.reason, refund_eligibility: 'per_terms', status_at_cancellation: 'cancelled', initiated_by: 'merchant' },
    );

    // Fire trigger with enriched payload
    try {
      const triggerPayload = await this.buildSubscriptionTriggerPayload(params, 'cancelled');
      await triggerService.fireTrigger(params.locationId, 'ss_cancellation_requested', triggerPayload);
    } catch { /* non-blocking */ }

    // Update GHL contact + add note
    try {
      const api = await ghlApi(params.locationId);
      await api.put(`/contacts/${params.contactId}`, {
        customField: { [SS_CONTACT_FIELDS.ENROLLMENT_STATUS]: 'cancelled' },
      });
      await api.post(`/contacts/${params.contactId}/notes`, {
        body: `Subscription cancelled: ${params.reason}`,
      });
    } catch { /* non-blocking */ }

    logger.info({ contactId: params.contactId, reason: params.reason }, 'Subscription cancelled');
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

    return (methods || []).map(m => ({
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

    // Remove from payment_methods table
    await supabase.from('payment_methods').delete().eq('id', cardId);

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
      await triggerService.fireTrigger(locationId, 'ss_payment_received', {
        contact_id: contactId,
        amount: data.amount,
        transaction_id: data.transactionId,
        payments_remaining: data.paymentsRemaining ?? 0,
        running_total: data.runningTotal ?? data.amount,
        action: data.action || 'payment_received',
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
      await triggerService.fireTrigger(locationId, 'ss_payment_failed', {
        contact_id: contactId,
        amount: data.amount,
        failure_reason: data.failureReason,
        attempt_count: data.attemptCount || 1,
        next_retry_date: data.nextRetryDate || 'none',
      });
    } catch (err: any) {
      logger.warn({ err: err.message, contactId }, 'Payment failed notification trigger failed');
    }
  },

  /**
   * Fire GHL trigger for a processed refund.
   */
  async notifyRefundProcessed(locationId: string, contactId: string, data: {
    amount: number; refundType: string; reason: string;
  }): Promise<void> {
    try {
      await triggerService.fireTrigger(locationId, 'ss_refund_processed', {
        contact_id: contactId,
        amount: data.amount,
        refund_type: data.refundType,
        reason: data.reason,
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
  async sendCardUpdateRequest(locationId: string, contactId: string): Promise<{ success: boolean; link: string }> {
    const { config: appConfig } = require('../config');
    const baseUrl = appConfig.appUrl || `https://scalesafe-production.up.railway.app`;
    const link = `${baseUrl}/payment-update?contactId=${encodeURIComponent(contactId)}&locationId=${encodeURIComponent(locationId)}`;

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
        action: 'card_update_requested',
        card_update_link: link,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      logger.warn({ err: err.message, contactId }, 'Card update request trigger failed');
    }

    logger.info({ contactId, locationId, link }, 'Card update request sent');
    return { success: true, link };
  },

  // ═══════════════════════════════════════════════════════════════
  // ENRICHED TRIGGER PAYLOAD BUILDER
  // ═══════════════════════════════════════════════════════════════

  /**
   * Build a rich trigger payload with contact, enrollment, offer, and merchant context.
   * Used by subscription pause/resume/cancel triggers so GHL workflows have
   * all the data they need for email/SMS templates.
   */
  async buildSubscriptionTriggerPayload(
    params: SubscriptionParams,
    status: string,
  ): Promise<Record<string, unknown>> {
    const supabase = getSupabase();

    // Fetch contact info from GHL
    let contact = { first_name: '', last_name: '', email: '', phone: '' };
    try {
      const api = await ghlApi(params.locationId);
      const res = await api.get(`/contacts/${params.contactId}`);
      const c = res.data?.contact || res.data || {};
      contact = {
        first_name: (c.firstName || '').trim(),
        last_name: (c.lastName || '').trim(),
        email: c.email || '',
        phone: c.phone || '',
      };
    } catch { /* non-blocking */ }

    // Fetch enrollment + offer info
    let enrollment: any = {};
    let offer: any = {};
    try {
      const { data: enr } = await supabase
        .from('enrollments')
        .select('id, payment_amount, payment_type, payments_made, payments_total, enrolled_at, offer_id')
        .eq('location_id', params.locationId)
        .eq('contact_id', params.contactId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      enrollment = enr || {};

      if (enrollment.offer_id) {
        const { data: ofr } = await supabase
          .from('offers_mirror')
          .select('id, offer_name, payment_type, price, installment_amount, installment_frequency, num_payments')
          .eq('id', enrollment.offer_id)
          .single();
        offer = ofr || {};
      }
    } catch { /* non-blocking */ }

    // Fetch merchant info
    let merchant = { business_name: '', support_email: '' };
    try {
      const m = await merchantRepository.getByLocationId(params.locationId);
      merchant = { business_name: m.business_name || '', support_email: m.support_email || '' };
    } catch { /* non-blocking */ }

    const paymentsRemaining = (enrollment.payments_total || offer.num_payments || 0) - (enrollment.payments_made || 0);

    return {
      contact_id: params.contactId,
      contact,
      enrollment_id: enrollment.id || '',
      offer: {
        id: offer.id || params.offerId || '',
        name: offer.offer_name || '',
        type: offer.payment_type || enrollment.payment_type || '',
        price: offer.price || 0,
        installment_amount: offer.installment_amount || 0,
        installment_frequency: offer.installment_frequency || '',
      },
      subscription: {
        status,
        reason: params.reason || '',
        payments_made: enrollment.payments_made || 0,
        payments_remaining: paymentsRemaining > 0 ? paymentsRemaining : 0,
        enrolled_at: enrollment.enrolled_at || '',
      },
      merchant,
    };
  },
};
