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
import { SS_CONTACT_FIELDS, WORKFLOW_PAYMENT_CONTACT_FIELDS } from '../constants/ghl-fields';
import type { DunningParams, SubscriptionParams, CardManagementParams } from '../types/payment-lifecycle.types';
import type { StoredCard } from '../types/processor.types';

function formatMoney(value: unknown): string {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? `$${amount.toFixed(2)}` : String(value || '');
}

function today(): string {
  return new Date().toISOString().split('T')[0];
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

    // Update payment event with dunning metadata
    await supabase.from('payment_events').update({
      dunning_status: 'active',
      dunning_retry_count: 0,
      dunning_next_retry: nextRetryDate,
      dunning_started_at: new Date().toISOString(),
    }).eq('id', params.paymentEventId);

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
      const { config: procConfig } = await resolveProcessor(merchantId, locationId, {
        processor_override: method.processor_type || null,
        nmi_processor_id: null,
      });
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
            payment_kind: 'dunning_recovery',
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

    // Log evidence of collection attempts
    await evidenceService.logEvidence(
      EVIDENCE_TYPES.FAILED_PAYMENT, locationId, contactId, 'dunning_escalation',
      { action: 'dunning_escalated', reason: 'Max retries reached', timestamp: new Date().toISOString() },
    );

    // Update GHL contact — enrollment status only. Engagement is decoupled from dunning.
    try {
      const api = await ghlApi(locationId);
      await api.put(`/contacts/${contactId}`, {
        customField: {
          [SS_CONTACT_FIELDS.ENROLLMENT_STATUS]: 'delinquent',
        },
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
        const { config: procConfig } = await resolveProcessor(params.merchantId, params.locationId, {
          processor_override: params.processorType || null,
          nmi_processor_id: null,
        });
        const processor = createProcessorClient(procConfig);
        await processor.pauseSubscription(params.processorSubscriptionId);
      } catch (err: any) {
        logger.warn({ err: err.message }, 'Processor subscription pause failed — logging evidence anyway');
      }

    }

    // Update enrollment status to 'paused' and clear next_billing_date
    try {
      const supabase = getSupabase();
      let pauseQuery = supabase.from('enrollments')
        .update({ status: 'paused', next_billing_date: null })
        .eq('location_id', params.locationId);
      if (params.enrollmentId) {
        pauseQuery = pauseQuery.eq('id', params.enrollmentId);
      } else {
        pauseQuery = pauseQuery.eq('contact_id', params.contactId).in('status', ['enrolled', 'active']);
      }
      await pauseQuery;
    } catch {}

    // Log evidence (enriched with context for defense letters)
    await evidenceService.logEvidence(
      EVIDENCE_TYPES.SUBSCRIPTION_CHANGE, params.locationId, params.contactId, 'merchant_action',
      { action: 'pause', change_date: new Date().toISOString(), reason: params.reason, initiated_by: 'merchant', previous_status: 'enrolled', new_status: 'paused' },
    );

    // Fire trigger — flat payload
    try {
      let offerName = '';
      let paymentsRemaining = 0;
      try {
        const supabase = getSupabase();
        const { data: enr } = await supabase.from('enrollments')
          .select('offer_id, payments_made, payments_total')
          .eq('location_id', params.locationId).eq('contact_id', params.contactId)
          .order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (enr?.offer_id) {
          const { data: ofr } = await supabase.from('offers_mirror').select('offer_name, num_payments').eq('id', enr.offer_id).single();
          offerName = ofr?.offer_name || '';
          paymentsRemaining = Math.max(0, (enr.payments_total || ofr?.num_payments || 0) - (enr.payments_made || 0));
        }
      } catch {}
      await triggerService.fireTrigger(params.locationId, 'ss_subscription_paused', {
        contact_id: params.contactId,
        offer_name: offerName,
        pause_reason: params.reason,
        pause_resume_date: '',
        payments_remaining: paymentsRemaining,
      });
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
    // Resume via processor if we have a subscription ID
    if (params.processorSubscriptionId) {
      try {
        const supabase = getSupabase();
        const { config: procConfig } = await resolveProcessor(params.merchantId, params.locationId, {
          processor_override: params.processorType || null,
          nmi_processor_id: null,
        });
        const processor = createProcessorClient(procConfig);

        // Fetch enrollment + offer for remaining payments and frequency
        const { data: enr } = await supabase.from('enrollments')
          .select('id, offer_id, payments_made, payments_total')
          .eq('location_id', params.locationId).eq('contact_id', params.contactId)
          .eq('processor_subscription_id', params.processorSubscriptionId)
          .maybeSingle();

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

        // Calculate next billing date
        const nextDate = new Date();
        if (interval === 'daily') nextDate.setDate(nextDate.getDate() + 1);
        else if (interval === 'weekly') nextDate.setDate(nextDate.getDate() + 7);
        else if (interval === 'biweekly') nextDate.setDate(nextDate.getDate() + 14);
        else if (interval === 'quarterly') nextDate.setMonth(nextDate.getMonth() + 3);
        else if (interval === 'annual') nextDate.setFullYear(nextDate.getFullYear() + 1);
        else nextDate.setMonth(nextDate.getMonth() + 1);

        if (remaining > 0 && planAmount > 0 && customerId) {
          const result = await processor.resumeSubscription({
            subscriptionId: params.processorSubscriptionId,
            paymentMethodId,
            customerId,
            planAmount,
            interval,
            remainingPayments: remaining,
            startDate: nextDate.toISOString().split('T')[0],
            description,
          });

          // For NMI, resumeSubscription creates a NEW subscription — update the stored ID
          if (result.success && result.subscriptionId !== params.processorSubscriptionId && enr) {
            await supabase.from('enrollments')
              .update({
                status: 'enrolled',
                processor_subscription_id: result.subscriptionId,
                next_billing_date: nextDate.toISOString().split('T')[0],
              })
              .eq('id', enr.id);
          } else if (enr) {
            // Stripe resume — update status + next_billing_date
            await supabase.from('enrollments')
              .update({ status: 'enrolled', next_billing_date: nextDate.toISOString().split('T')[0] })
              .eq('id', enr.id);
          }
        }
      } catch (err: any) {
        logger.warn({ err: err.message }, 'Processor subscription resume failed — logging evidence anyway');
      }
    } else {
      // No processor subscription — just update enrollment status back to 'enrolled'
      try {
        const supabase = getSupabase();
        await supabase.from('enrollments')
          .update({ status: 'enrolled' })
          .eq('location_id', params.locationId)
          .eq('contact_id', params.contactId)
          .eq('status', 'paused');
      } catch {}
    }

    // Log evidence (enriched with context for defense letters)
    await evidenceService.logEvidence(
      EVIDENCE_TYPES.SUBSCRIPTION_CHANGE, params.locationId, params.contactId, 'merchant_action',
      { action: 'resume', change_date: new Date().toISOString(), reason: params.reason, initiated_by: 'merchant', previous_status: 'paused', new_status: 'enrolled' },
    );

    // Fire trigger — flat doc contract: contact_id, offer_name, next_billing_date, payments_remaining, days_paused
    try {
      let offerName = '';
      let paymentsRemaining = 0;
      let daysPaused = 0;
      try {
        const supabase = getSupabase();
        const { data: enr } = await supabase.from('enrollments')
          .select('offer_id, payments_made, payments_total, updated_at')
          .eq('location_id', params.locationId).eq('contact_id', params.contactId)
          .order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (enr?.offer_id) {
          const { data: ofr } = await supabase.from('offers_mirror').select('offer_name, num_payments').eq('id', enr.offer_id).single();
          offerName = ofr?.offer_name || '';
          paymentsRemaining = Math.max(0, (enr.payments_total || ofr?.num_payments || 0) - (enr.payments_made || 0));
        }
        if (enr?.updated_at) {
          daysPaused = Math.floor((Date.now() - new Date(enr.updated_at).getTime()) / (1000 * 60 * 60 * 24));
        }
      } catch {}
      await triggerService.fireTrigger(params.locationId, 'ss_subscription_resumed', {
        contact_id: params.contactId,
        offer_name: offerName,
        next_billing_date: '',
        payments_remaining: paymentsRemaining,
        days_paused: daysPaused,
      });
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
        const { config: procConfig } = await resolveProcessor(params.merchantId, params.locationId, {
          processor_override: params.processorType || null,
          nmi_processor_id: null,
        });
        const processor = createProcessorClient(procConfig);
        await processor.cancelSubscription(params.processorSubscriptionId);
      } catch (err: any) {
        logger.warn({ err: err.message }, 'Processor subscription cancel failed — logging evidence anyway');
      }

      // Clear processor_subscription_id and mark cancelled
      try {
        const supabase = getSupabase();
        let cancelQuery = supabase.from('enrollments')
          .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), processor_subscription_id: null, next_billing_date: null })
          .eq('location_id', params.locationId);
        if (params.enrollmentId) {
          cancelQuery = cancelQuery.eq('id', params.enrollmentId);
        } else {
          cancelQuery = cancelQuery.eq('contact_id', params.contactId)
            .eq('processor_subscription_id', params.processorSubscriptionId);
        }
        await cancelQuery;
      } catch {}
    } else {
      // No processor subscription — still mark the enrollment as cancelled
      try {
        const supabase = getSupabase();
        let cancelQuery = supabase.from('enrollments')
          .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), next_billing_date: null })
          .eq('location_id', params.locationId);
        if (params.enrollmentId) {
          cancelQuery = cancelQuery.eq('id', params.enrollmentId);
        } else {
          cancelQuery = cancelQuery.eq('contact_id', params.contactId)
            .in('status', ['enrolled', 'active', 'paused']);
        }
        await cancelQuery;
      } catch {}
    }

    // Log subscription change evidence (enriched with context — non-fatal)
    try {
      await evidenceService.logEvidence(
        EVIDENCE_TYPES.SUBSCRIPTION_CHANGE, params.locationId, params.contactId, 'merchant_action',
        { action: 'cancel', change_date: new Date().toISOString(), reason: params.reason, initiated_by: 'merchant', previous_status: 'enrolled', new_status: 'cancelled' },
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
      const { data: enr } = await supabase.from('enrollments')
        .select('id, email, first_name, last_name, digital_signature, payments_made, payments_total, enrolled_at')
        .eq('location_id', params.locationId).eq('contact_id', params.contactId)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
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
        },
      );
    } catch (evErr: any) {
      logger.warn({ err: evErr.message, enrollmentId: params.enrollmentId }, 'Cancellation evidence failed (non-fatal)');
    }

    // Fire trigger — flat doc contract: contact_id, offer_id, reason, refund_eligibility, enrollment_date
    try {
      let enrollmentDate = '';
      try {
        const supabase = getSupabase();
        const { data: enr } = await supabase.from('enrollments')
          .select('enrolled_at').eq('location_id', params.locationId).eq('contact_id', params.contactId)
          .order('created_at', { ascending: false }).limit(1).maybeSingle();
        enrollmentDate = enr?.enrolled_at || '';
      } catch {}
      await triggerService.fireTrigger(params.locationId, 'ss_cancellation_requested', {
        contact_id: params.contactId,
        offer_id: params.offerId,
        reason: params.reason,
        refund_eligibility: 'per_terms',
        enrollment_date: enrollmentDate,
      });
    } catch { /* non-blocking */ }

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
          next_billing_date: null, processor_subscription_id: null,
        }).eq('id', params.enrollmentId);
      } else if (params.processorSubscriptionId) {
        await supabase.from('enrollments').update({
          status: 'completed', completed_at: completedAt,
          next_billing_date: null, processor_subscription_id: null,
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
      { action: 'manual_complete', change_date: completedAt, reason: params.reason, initiated_by: 'merchant', previous_status: 'enrolled', new_status: 'completed' },
    );

    // Fire trigger
    try {
      await triggerService.fireTrigger(params.locationId, 'ss_program_completed', {
        contact_id: params.contactId,
        offer_id: params.offerId,
        completed_at: completedAt,
        completion_reason: params.reason || 'manual_complete',
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
      const api = await ghlApi(locationId);
      await api.put(`/contacts/${contactId}`, {
        customField: {
          [WORKFLOW_PAYMENT_CONTACT_FIELDS.REFUND_AMOUNT]: formatMoney(data.amount),
          [WORKFLOW_PAYMENT_CONTACT_FIELDS.REFUND_DATE]: today(),
        },
      });
      await triggerService.fireTrigger(locationId, 'ss_refund_processed', {
        event_type: 'refund_processed',
        location_id: locationId,
        locationId,
        contact_id: contactId,
        contactId,
        amount: data.amount,
        amount_display: formatMoney(data.amount),
        amountDisplay: formatMoney(data.amount),
        refund_type: data.refundType,
        refundType: data.refundType,
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
  async sendCardUpdateRequest(locationId: string, contactId: string, options: { sendTrigger?: boolean } = {}): Promise<{ success: boolean; link: string }> {
    const { config: appConfig } = require('../config');
    const baseUrl = appConfig.appUrl;
    const actionToken = createPublicActionToken({ action: 'payment_update', contactId, locationId });
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
          amount: 0,
          failure_reason: 'card_update_requested',
          attempt_count: 0,
          next_retry_date: 'none',
        });
      } catch (err: any) {
        logger.warn({ err: err.message, contactId }, 'Card update request trigger failed');
      }
    }

    logger.info({ contactId, locationId, link }, 'Card update request sent');
    return { success: true, link };
  },

  // ═══════════════════════════════════════════════════════════════
  // ENRICHED TRIGGER PAYLOAD BUILDER
  // ═══════════════════════════════════════════════════════════════

};
