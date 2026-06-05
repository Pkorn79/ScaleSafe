import { Request, Response, NextFunction } from 'express';
import { getSupabase } from '../clients/supabase.client';
import { ghlApi } from '../clients/ghl.client';
import { resolveProcessor, createProcessorClient } from '../services/processor.factory';
import { saveOrReusePaymentMethod } from '../services/payment-methods.service';
import { merchantRepository } from '../repositories/merchant.repository';
import { logger } from '../utils/logger';
import {
  legacyPublicActionLinksAllowed,
  PublicActionType,
  verifyPublicActionToken,
} from '../utils/public-action-token';
import { buildDefenseEvidenceFields } from '../utils/defense-evidence';

function getClientIp(req: Request): string {
  return req.headers['x-forwarded-for']?.toString().split(',')[0].trim()
    || req.headers['x-real-ip']?.toString()
    || req.socket.remoteAddress
    || '';
}

interface PublicActionContext {
  contactId: string;
  locationId: string;
  enrollmentId?: string;
  milestoneNumber?: number;
}

function readPublicActionContext(req: Request, action: PublicActionType | PublicActionType[]): PublicActionContext {
  const actionToken = (req.query.actionToken || req.query.token || req.body?.actionToken) as string | undefined;
  if (actionToken) {
    const payload = verifyPublicActionToken(actionToken);
    const allowedActions = Array.isArray(action) ? action : [action];
    if (!allowedActions.includes(payload.action)) {
      throw new Error('Action token cannot be used for this request');
    }
    return {
      contactId: payload.contactId,
      locationId: payload.locationId,
      enrollmentId: payload.enrollmentId,
      milestoneNumber: payload.milestoneNumber,
    };
  }

  if (!legacyPublicActionLinksAllowed()) {
    throw new Error('Valid action token required');
  }

  const contactId = (req.query.contactId || req.body?.contactId) as string | undefined;
  const locationId = (req.query.locationId || req.body?.locationId) as string | undefined;
  const enrollmentId = (req.query.enrollmentId || req.body?.enrollmentId) as string | undefined;
  const rawMilestoneNumber = (req.query.milestoneNumber || req.body?.milestoneNumber) as string | number | undefined;
  const milestoneNumber = rawMilestoneNumber ? parseInt(rawMilestoneNumber.toString(), 10) : undefined;

  if (!contactId || !locationId) {
    throw new Error('Valid action token required');
  }

  return { contactId, locationId, enrollmentId, milestoneNumber };
}

function isPublicActionTokenError(err: unknown): boolean {
  return err instanceof Error && err.message.toLowerCase().includes('action token');
}

async function resolveMilestoneEnrollment(
  supabase: any,
  params: { locationId: string; contactId: string; enrollmentId?: string | null },
): Promise<any | null> {
  if (!params.enrollmentId) {
    throw new Error('Enrollment-specific action token required');
  }

  const { data, error } = await supabase
    .from('enrollments')
    .select('id, offer_id, current_milestone')
    .eq('id', params.enrollmentId)
    .eq('location_id', params.locationId)
    .eq('contact_id', params.contactId)
    .in('status', ['enrolled', 'active'])
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function resolvePulseEnrollment(
  supabase: any,
  params: { locationId: string; contactId: string; enrollmentId?: string | null },
): Promise<any | null> {
  if (!params.enrollmentId) {
    throw new Error('Enrollment-specific action token required');
  }

  const { data, error } = await supabase
    .from('enrollments')
    .select('id, offer_id, first_name, last_name, email')
    .eq('id', params.enrollmentId)
    .eq('location_id', params.locationId)
    .eq('contact_id', params.contactId)
    .in('status', ['enrolled', 'active'])
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function resolvePaymentUpdateEnrollment(
  supabase: any,
  params: { locationId: string; contactId: string; enrollmentId?: string | null },
): Promise<any | null> {
  if (!params.enrollmentId) {
    throw new Error('Enrollment-specific action token required');
  }

  const { data, error } = await supabase
    .from('enrollments')
    .select('id, offer_id, processor_type, email, first_name, last_name')
    .eq('id', params.enrollmentId)
    .eq('location_id', params.locationId)
    .eq('contact_id', params.contactId)
    .in('status', ['enrolled', 'active', 'paused', 'past_due', 'delinquent'])
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function resolveProcessorForEnrollment(merchantId: string, locationId: string, enrollment: any) {
  const supabase = getSupabase();
  let processorOverride = enrollment.processor_type || null;
  let nmiProcessorId: string | null = null;

  if (enrollment.offer_id) {
    const { data: offer } = await supabase
      .from('offers_mirror')
      .select('processor_override, nmi_processor_id')
      .eq('id', enrollment.offer_id)
      .eq('location_id', locationId)
      .maybeSingle();
    processorOverride = processorOverride || offer?.processor_override || null;
    nmiProcessorId = offer?.nmi_processor_id || null;
  }

  return resolveProcessor(merchantId, locationId, {
    processor_override: processorOverride,
    nmi_processor_id: nmiProcessorId,
  });
}

/**
 * GET /api/payment-update/config?contactId=X&locationId=Y
 * Public endpoint — called by the payment-update widget to get processor config.
 */
export async function getPaymentUpdateConfig(req: Request, res: Response, next: NextFunction) {
  try {
    const { contactId, locationId, enrollmentId } = readPublicActionContext(req, ['payment_update', 'subscription_cancel']);

    const merchant = await merchantRepository.findByLocationId(locationId);
    if (!merchant) {
      res.status(404).json({ error: 'Merchant not found', processorType: 'none' });
      return;
    }

    // Resolve active processor
    let processorType = 'none';
    let nmiTokenizationKey = '';
    let stripePublishableKey = '';
    let stripeAccountId = '';
    const supabase = getSupabase();
    let enrollment: any | null = null;

    try {
      enrollment = await resolvePaymentUpdateEnrollment(supabase, { locationId, contactId, enrollmentId });
      if (!enrollment) {
        res.status(404).json({ error: 'Enrollment not found or not eligible for payment update', processorType: 'none' });
        return;
      }
      const { config: procConfig } = await resolveProcessorForEnrollment(merchant.id, locationId, enrollment);
      processorType = procConfig.processor_type;
      if (procConfig.processor_type === 'nmi') {
        nmiTokenizationKey = procConfig.nmi_tokenization_key || '';
      } else if (procConfig.processor_type === 'stripe') {
        const { config: appConfig } = require('../config');
        stripePublishableKey = appConfig.stripe?.publishableKey || procConfig.stripe_publishable_key || '';
        stripeAccountId = procConfig.stripe_user_id || '';
      }
      logger.info({ locationId, processorType, hasStripeKey: !!stripePublishableKey, hasStripeAcct: !!stripeAccountId, hasNmiKey: !!nmiTokenizationKey }, 'Payment update config resolved');
    } catch (procErr: any) {
      if (procErr.message === 'Enrollment-specific action token required') {
        res.status(400).json({ error: procErr.message, processorType: 'none' });
        return;
      }
      logger.error({ err: procErr.message, stack: procErr.stack, locationId, merchantId: merchant.id }, 'Payment update: processor resolution failed');
      // Return error details so the widget can display useful info
      res.json({
        processorType: 'none',
        error: procErr.message || 'Processor resolution failed',
        merchantName: merchant.business_name || '',
      });
      return;
    }

    // Get contact name for display
    let contactName = '';
    let contactEmail = '';
    try {
      const api = await ghlApi(locationId);
      const contactRes = await api.get(`/contacts/${contactId}`);
      const contact = contactRes.data?.contact || contactRes.data || {};
      contactName = `${(contact.firstName || '').trim()} ${(contact.lastName || '').trim()}`.trim();
      contactEmail = contact.email || '';
    } catch {
      // Fall back to enrollment data
      if (enrollment) {
        contactName = [enrollment.first_name, enrollment.last_name].filter(Boolean).join(' ');
        contactEmail = enrollment.email || '';
      }
    }

    res.json({
      processorType,
      nmiTokenizationKey,
      stripePublishableKey,
      stripeAccountId,
      merchantName: merchant.business_name || '',
      contactName,
      contactEmail,
    });
  } catch (err) {
    if (isPublicActionTokenError(err)) {
      res.status(401).json({ error: (err as Error).message, processorType: 'none' });
      return;
    }
    next(err);
  }
}

/**
 * POST /api/payment-update/update-method
 * Public endpoint — called by the payment-update widget after card tokenization.
 */
export async function updatePaymentMethod(req: Request, res: Response, next: NextFunction) {
  try {
    const { contactId, locationId, enrollmentId } = readPublicActionContext(req, 'payment_update');
    const { token, processorType } = req.body;
    if (!token || !processorType) {
      res.status(400).json({ success: false, error: 'token and processorType are required' });
      return;
    }

    const merchant = await merchantRepository.findByLocationId(locationId);
    if (!merchant) {
      res.status(404).json({ success: false, error: 'Merchant not found' });
      return;
    }

    const clientIp = getClientIp(req);
    const userAgent = req.headers['user-agent'] || '';
    const supabase = getSupabase();
    let enrollment: any | null;
    try {
      enrollment = await resolvePaymentUpdateEnrollment(supabase, { locationId, contactId, enrollmentId });
    } catch (lookupErr: any) {
      res.status(400).json({ success: false, error: lookupErr.message || 'Enrollment-specific action token required' });
      return;
    }
    if (!enrollment) {
      res.status(404).json({ success: false, error: 'Enrollment not found or not eligible for payment update' });
      return;
    }

    // Get contact info for the processor
    let contactEmail = req.body.contactEmail || '';
    let contactName = req.body.contactName || '';
    if (!contactEmail) {
      if (enrollment) {
        contactEmail = enrollment.email || '';
        contactName = contactName || [enrollment.first_name, enrollment.last_name].filter(Boolean).join(' ');
      }
    }

    // Resolve processor and save the card
    const { config: procConfig } = await resolveProcessorForEnrollment(merchant.id, locationId, enrollment);
    if (processorType !== procConfig.processor_type) {
      res.status(400).json({ success: false, error: 'Payment method processor does not match this enrollment' });
      return;
    }
    const processor = createProcessorClient(procConfig);

    const result = await processor.saveCard({
      paymentToken: token,
      contactId,
      customerEmail: contactEmail,
      customerName: contactName,
    });

    if (!result.success) {
      res.status(400).json({ success: false, error: 'Failed to save payment method' });
      return;
    }

    await saveOrReusePaymentMethod({
      merchantId: merchant.id,
      locationId,
      contactId,
      processorType: procConfig.processor_type,
      customerId: result.customerId,
      paymentMethodId: result.paymentMethodId,
      cardLastFour: result.cardLastFour,
      cardBrand: result.cardBrand,
      cardExpMonth: result.cardExpMonth,
      cardExpYear: result.cardExpYear,
      makeDefault: true,
    });

    // Log evidence
    try {
      await supabase.from('evidence').insert({
        location_id: locationId,
        contact_id: contactId,
        enrollment_id: enrollment.id,
        evidence_type: 'payment_update',
        data: {
          processor_type: procConfig.processor_type,
          card_last_four: result.cardLastFour,
          card_brand: result.cardBrand,
          reason: 'Client-initiated update',
          timestamp: new Date().toISOString(),
        },
        ip_address: clientIp,
        device_info: userAgent,
        ...buildDefenseEvidenceFields({
          summary: `Client updated payment method. New card: ${result.cardBrand || 'card'} ending ${result.cardLastFour || 'unknown'}.`,
          title: 'Client Payment Method Update',
          proofRole: 'billing_update',
          relevance: { tags: ['authorization', 'fraud', 'cancelled_recurring'], priority: 'high', confidence: 'strong' },
          enrollmentId: enrollment.id,
          metadata: {
            actor: 'client',
            customerIdentity: { ipAddress: clientIp, browser: userAgent },
            service: { enrollmentId: enrollment.id, offerId: enrollment.offer_id || null },
            transaction: {
              processor: procConfig.processor_type,
              cardBrand: result.cardBrand,
              cardLastFour: result.cardLastFour,
            },
            source: { system: 'payment_update_widget', rawEventType: 'card_update' },
          },
        }),
      });
    } catch (evErr: any) {
      logger.warn({ err: evErr.message, contactId }, 'Payment update evidence insert failed (non-blocking)');
    }

    // Update GHL contact fields (non-blocking)
    try {
      const api = await ghlApi(locationId);
      await api.put(`/contacts/${contactId}`, {
        customField: {
          'contact.ss_last_evidence_date': new Date().toISOString().split('T')[0],
        },
      });
    } catch {
      // GHL update is nice-to-have
    }

    logger.info({
      contactId, locationId, processorType: procConfig.processor_type,
      last4: result.cardLastFour, brand: result.cardBrand,
    }, 'Payment method updated via widget');

    res.json({
      success: true,
      last4: result.cardLastFour,
      brand: result.cardBrand,
    });
  } catch (err: any) {
    if (isPublicActionTokenError(err)) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    logger.error({ err: err.message, stack: err.stack }, 'Payment method update failed');
    res.status(500).json({ success: false, error: err.message || 'Payment method update failed' });
  }
}

/**
 * POST /api/payment-update/cancel-subscription
 * Public endpoint — called by the client-facing cancellation widget.
 */
export async function cancelSubscriptionPublic(req: Request, res: Response, next: NextFunction) {
  try {
    const { contactId, locationId, enrollmentId } = readPublicActionContext(req, 'subscription_cancel');
    if (!enrollmentId) {
      res.status(400).json({ success: false, error: 'Enrollment-specific action token required' });
      return;
    }

    const { reason } = req.body;
    if (!reason) {
      res.status(400).json({ success: false, error: 'reason is required' });
      return;
    }

    const merchant = await merchantRepository.findByLocationId(locationId);
    if (!merchant) {
      res.status(404).json({ success: false, error: 'Merchant not found' });
      return;
    }

    const supabase = getSupabase();
    const clientIp = req.headers['x-forwarded-for']?.toString().split(',')[0].trim() || req.socket.remoteAddress || '';

    // Verify the token points to an exact enrollment for this contact and location.
    const { data: enrollment } = await supabase
      .from('enrollments')
      .select('id, status, offer_id, processor_type, processor_subscription_id')
      .eq('id', enrollmentId)
      .eq('location_id', locationId)
      .eq('contact_id', contactId)
      .in('status', ['enrolled', 'active', 'paused'])
      .maybeSingle();

    if (!enrollment) {
      res.status(404).json({ success: false, error: 'Enrollment not found or not cancellable' });
      return;
    }

    // Use the lifecycle service to cancel with full evidence logging
    const { paymentLifecycleService } = require('../services/payment-lifecycle.service');
    await paymentLifecycleService.cancelSubscription({
      merchantId: merchant.id,
      locationId,
      contactId,
      enrollmentId: enrollment.id,
      offerId: enrollment.offer_id || '',
      processorType: enrollment.processor_type || undefined,
      processorSubscriptionId: enrollment.processor_subscription_id || undefined,
      reason: `Client-initiated: ${reason}`,
    });

    // Log additional evidence with client IP
    try {
      await supabase.from('evidence').insert({
        location_id: locationId,
        contact_id: contactId,
        enrollment_id: enrollment.id,
        evidence_type: 'cancellation',
        data: {
          reason,
          initiated_by: 'client',
          cancellation_date: new Date().toISOString(),
          ip_address: clientIp,
        },
        ip_address: clientIp,
        ...buildDefenseEvidenceFields({
          summary: `Client submitted subscription cancellation request from IP ${clientIp || 'unknown'}. Reason: ${reason}.`,
          title: 'Client Cancellation Request',
          proofRole: 'cancellation',
          relevance: { tags: ['cancelled_recurring', 'credit_not_processed'], priority: 'critical', confidence: 'strong' },
          enrollmentId: enrollment.id,
          metadata: {
            actor: 'client',
            customerIdentity: { ipAddress: clientIp },
            service: { enrollmentId: enrollment.id, offerId: enrollment.offer_id || null },
            source: { system: 'subscription_cancel_widget', rawEventType: 'client_cancellation' },
          },
        }),
      });
    } catch { /* non-blocking */ }

    logger.info({ contactId, locationId, reason }, 'Client-initiated subscription cancellation');
    res.json({ success: true });
  } catch (err: any) {
    if (isPublicActionTokenError(err)) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    logger.error({ err: err.message, stack: err.stack }, 'Client subscription cancel failed');
    res.status(500).json({ success: false, error: err.message || 'Cancellation failed' });
  }
}

/**
 * GET /api/milestone-signoff/config — milestone details for sign-off widget
 */
export async function getMilestoneConfig(req: Request, res: Response, next: NextFunction) {
  try {
    const { contactId, locationId, enrollmentId, milestoneNumber } = readPublicActionContext(req, 'milestone_signoff');
    if (!milestoneNumber) {
      res.status(400).json({ error: 'milestoneNumber required' });
      return;
    }

    const supabase = getSupabase();
    let enrollment: any | null;
    try {
      enrollment = await resolveMilestoneEnrollment(supabase, { locationId, contactId, enrollmentId });
    } catch (lookupErr: any) {
      res.status(400).json({ error: lookupErr.message || 'Enrollment-specific action token required' });
      return;
    }
    if (!enrollment || !enrollment.offer_id) {
      res.status(404).json({ error: 'Enrollment for this sign-off link was not found' });
      return;
    }

    const { data: offer } = await supabase
      .from('offers_mirror')
      .select('*')
      .eq('id', enrollment.offer_id).single();

    const merchant = await merchantRepository.findByLocationId(locationId);

    res.json({
      milestoneName: (offer as any)?.[`m${milestoneNumber}_name`] || `Milestone ${milestoneNumber}`,
      delivers: (offer as any)?.[`m${milestoneNumber}_delivers`] || '',
      clientDoes: (offer as any)?.[`m${milestoneNumber}_client_does`] || '',
      offerName: offer?.offer_name || '',
      merchantName: merchant?.business_name || '',
      enrollmentId: enrollment.id,
      milestoneNumber,
    });
  } catch (err) {
    if (isPublicActionTokenError(err)) {
      res.status(401).json({ error: (err as Error).message });
      return;
    }
    next(err);
  }
}

/**
 * POST /api/milestone-signoff/submit — client confirms milestone completion
 */
export async function submitMilestoneSignoff(req: Request, res: Response, next: NextFunction) {
  try {
    const actionContext = readPublicActionContext(req, 'milestone_signoff');
    const contactId = actionContext.contactId;
    const locationId = actionContext.locationId;
    const enrollmentId = actionContext.enrollmentId;
    const milestoneNumber = actionContext.milestoneNumber || parseInt(req.body.milestoneNumber, 10);
    const { signature } = req.body;
    if (!milestoneNumber || !signature) {
      res.status(400).json({ success: false, error: 'milestoneNumber and signature required' });
      return;
    }

    const clientIp = req.headers['x-forwarded-for']?.toString().split(',')[0].trim() || req.socket.remoteAddress || '';
    const supabase = getSupabase();

    let enrollment: any | null;
    try {
      enrollment = await resolveMilestoneEnrollment(supabase, { locationId, contactId, enrollmentId });
    } catch (lookupErr: any) {
      res.status(400).json({ success: false, error: lookupErr.message || 'Enrollment-specific action token required' });
      return;
    }
    if (!enrollment) {
      res.status(404).json({ success: false, error: 'Enrollment for this sign-off link was not found' });
      return;
    }

    // Get milestone name
    const { data: offer } = await supabase
      .from('offers_mirror').select('*').eq('id', enrollment.offer_id).single();
    const milestoneName = (offer as any)?.[`m${milestoneNumber}_name`] || `Milestone ${milestoneNumber}`;

    // Resolve enrichment data for defense letter quality
    const milestoneDelivers = (offer as any)?.[`m${milestoneNumber}_delivers`] || '';
    const milestoneClientDoes = (offer as any)?.[`m${milestoneNumber}_client_does`] || '';
    const workSummary = [milestoneDelivers, milestoneClientDoes].filter(Boolean).join('. Client responsibility: ') || null;

    let signoffContactName = '';
    let signoffContactEmail = '';
    try {
      const { data: enrInfo } = await supabase
        .from('enrollments')
        .select('first_name, last_name, digital_signature, email')
        .eq('id', enrollment.id)
        .maybeSingle();
      signoffContactName = [enrInfo?.first_name, enrInfo?.last_name].filter(Boolean).join(' ')
        || enrInfo?.digital_signature || '';
      signoffContactEmail = enrInfo?.email || '';
    } catch {}

    const signedAt = new Date().toISOString();
    const userAgent = req.headers['user-agent'] || '';
    let browserDisplay = 'unknown browser';
    if (userAgent.includes('Chrome')) browserDisplay = 'Chrome';
    else if (userAgent.includes('Firefox')) browserDisplay = 'Firefox';
    else if (userAgent.includes('Safari')) browserDisplay = 'Safari';

    const fmtSignedDate = new Date(signedAt).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });

    // Insert evidence signoff (enriched)
    const { error: signoffInsertError } = await supabase.from('evidence_signoffs').insert({
      location_id: locationId,
      contact_id: contactId,
      enrollment_id: enrollment.id,
      source: 'client_signoff',
      milestone_number: milestoneNumber,
      milestone_name: milestoneName,
      work_summary: workSummary,
      signature_data: signature,
      ip_address: clientIp,
      device_fingerprint: req.body.deviceFingerprint || null,
      browser: browserDisplay,
      signed_at: signedAt,
      contact_name: signoffContactName || null,
      contact_email: signoffContactEmail || null,
      raw_payload: { contactId, locationId, enrollmentId: enrollment.id, milestoneNumber, milestoneDelivers, milestoneClientDoes },
      description: `${signoffContactName || 'Client'} digitally signed off on Milestone ${milestoneNumber} (${milestoneName}) on ${fmtSignedDate} from IP ${clientIp || 'unknown'} (${browserDisplay}).${milestoneDelivers ? ` Work delivered: ${milestoneDelivers}.` : ''}`,
      ...buildDefenseEvidenceFields({
        summary: `${signoffContactName || 'Client'} digitally signed off on Milestone ${milestoneNumber} (${milestoneName}) on ${fmtSignedDate} from IP ${clientIp || 'unknown'} using ${browserDisplay}.${milestoneDelivers ? ` Work delivered: ${milestoneDelivers}.` : ''}`,
        title: `Client Signoff: Milestone ${milestoneNumber}`,
        proofRole: 'service_delivery',
        relevance: { tags: ['services_not_provided', 'not_as_described', 'fraud'], priority: 'critical', confidence: 'strong' },
        enrollmentId: enrollment.id,
        metadata: {
          actor: 'client',
          customerIdentity: {
            name: signoffContactName || null,
            email: signoffContactEmail || null,
            ipAddress: clientIp || null,
            deviceFingerprint: req.body.deviceFingerprint || null,
            browser: browserDisplay,
          },
          service: {
            enrollmentId: enrollment.id,
            offerId: enrollment.offer_id || null,
            deliverableName: milestoneName,
            serviceDate: signedAt,
          },
          source: { system: 'milestone_signoff_widget', rawEventType: 'client_milestone_signoff' },
        },
      }),
    });
    if (signoffInsertError) throw signoffInsertError;

    // Fire trigger — flat doc contract
    const { triggerService } = require('../services/trigger.service');
    const signatureTimestamp = new Date().toISOString();
    await triggerService.fireTrigger(locationId, 'ss_milestone_signedoff', {
      event_type: 'milestone_signedoff',
      location_id: locationId,
      locationId,
      contact_id: contactId,
      contactId,
      enrollment_id: enrollment.id,
      enrollmentId: enrollment.id,
      offer_id: enrollment.offer_id || '',
      offerId: enrollment.offer_id || '',
      milestone_number: milestoneNumber,
      milestoneNumber,
      milestone_name: milestoneName,
      milestoneName,
      signature_timestamp: signatureTimestamp,
      signatureTimestamp,
      ip_address: clientIp,
      ipAddress: clientIp,
    });

    logger.info({ contactId, milestoneNumber, milestoneName }, 'Milestone signed off by client');
    res.json({ success: true });
  } catch (err: any) {
    if (isPublicActionTokenError(err)) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    logger.error({ err: err.message }, 'Milestone signoff failed');
    res.status(500).json({ success: false, error: err.message || 'Sign-off failed' });
  }
}

/**
 * GET /api/pulse-check/config - details for the ScaleSafe pulse check-in widget
 */
export async function getPulseCheckConfig(req: Request, res: Response, next: NextFunction) {
  try {
    const { contactId, locationId, enrollmentId } = readPublicActionContext(req, 'pulse_checkin');
    const supabase = getSupabase();
    let enrollment: any | null;
    try {
      enrollment = await resolvePulseEnrollment(supabase, { locationId, contactId, enrollmentId });
    } catch (lookupErr: any) {
      res.status(400).json({ error: lookupErr.message || 'Enrollment-specific action token required' });
      return;
    }
    if (!enrollment) {
      res.status(404).json({ error: 'Enrollment for this pulse check-in link was not found' });
      return;
    }

    const { data: offer } = enrollment.offer_id
      ? await supabase
        .from('offers_mirror')
        .select('offer_name')
        .eq('id', enrollment.offer_id)
        .eq('location_id', locationId)
        .maybeSingle()
      : { data: null };
    const merchant = await merchantRepository.findByLocationId(locationId);

    res.json({
      contactId,
      locationId,
      enrollmentId: enrollment.id,
      offerId: enrollment.offer_id || '',
      offerName: offer?.offer_name || '',
      merchantName: merchant?.business_name || '',
      clientName: [enrollment.first_name, enrollment.last_name].filter(Boolean).join(' '),
    });
  } catch (err) {
    if (isPublicActionTokenError(err)) {
      res.status(401).json({ error: (err as Error).message });
      return;
    }
    next(err);
  }
}

/**
 * POST /api/pulse-check/submit - client pulse check-in evidence
 */
export async function submitPulseCheckin(req: Request, res: Response, next: NextFunction) {
  try {
    const { contactId, locationId, enrollmentId } = readPublicActionContext(req, 'pulse_checkin');
    const satisfaction = Number(req.body.satisfaction);
    const goingWell = String(req.body.goingWell || '').trim();
    const concerns = String(req.body.concerns || '').trim();
    const followUpNeeded = req.body.followUpNeeded === true || req.body.followUpNeeded === 'true';

    if (!Number.isInteger(satisfaction) || satisfaction < 1 || satisfaction > 5) {
      res.status(400).json({ success: false, error: 'Satisfaction score is required.' });
      return;
    }

    const supabase = getSupabase();
    let enrollment: any | null;
    try {
      enrollment = await resolvePulseEnrollment(supabase, { locationId, contactId, enrollmentId });
    } catch (lookupErr: any) {
      res.status(400).json({ success: false, error: lookupErr.message || 'Enrollment-specific action token required' });
      return;
    }
    if (!enrollment) {
      res.status(404).json({ success: false, error: 'Enrollment for this pulse check-in link was not found' });
      return;
    }

    const checkinAt = new Date().toISOString();
    const feedback = [goingWell ? `Going well: ${goingWell}` : '', concerns ? `Concerns: ${concerns}` : '']
      .filter(Boolean)
      .join('\n');
    const clientName = [enrollment.first_name, enrollment.last_name].filter(Boolean).join(' ');

    const { error } = await supabase.from('evidence_pulse_checkins').insert({
      location_id: locationId,
      contact_id: contactId,
      enrollment_id: enrollment.id,
      source: 'scalesafe_pulse_widget',
      checkin_date: checkinAt.slice(0, 10),
      sentiment_score: satisfaction,
      feedback_text: feedback || null,
      follow_up_needed: followUpNeeded,
      follow_up_action: followUpNeeded ? 'Merchant follow-up requested from pulse check-in' : null,
      contact_name: clientName || null,
      contact_email: enrollment.email || null,
      raw_payload: {
        contactId,
        locationId,
        enrollmentId: enrollment.id,
        offerId: enrollment.offer_id || null,
        satisfaction,
        goingWell,
        concerns,
        followUpNeeded,
        submittedAt: checkinAt,
        ipAddress: getClientIp(req),
      },
      ...buildDefenseEvidenceFields({
        title: 'Client Pulse Check-In',
        summary: `${clientName || 'Client'} submitted a pulse check-in with satisfaction ${satisfaction}/5.${goingWell ? ` Going well: ${goingWell.slice(0, 160)}.` : ''}${concerns ? ` Concerns: ${concerns.slice(0, 160)}.` : ''}`,
        proofRole: 'service_delivery',
        relevance: { tags: ['services_not_provided', 'not_as_described', 'fraud'], priority: followUpNeeded ? 'high' : 'medium', confidence: 'moderate' },
        enrollmentId: enrollment.id,
        metadata: {
          actor: 'client',
          customerIdentity: {
            name: clientName || null,
            email: enrollment.email || null,
            ipAddress: getClientIp(req) || null,
          },
          service: {
            enrollmentId: enrollment.id,
            offerId: enrollment.offer_id || null,
            serviceDate: checkinAt,
          },
          source: { system: 'scalesafe_pulse_widget', rawEventType: 'pulse_checkin_submitted' },
        },
      }),
    });
    if (error) throw error;

    logger.info({ contactId, enrollmentId: enrollment.id, satisfaction, followUpNeeded }, 'Pulse check-in submitted');
    res.json({ success: true });
  } catch (err: any) {
    if (isPublicActionTokenError(err)) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    logger.error({ err: err.message }, 'Pulse check-in failed');
    res.status(500).json({ success: false, error: err.message || 'Pulse check-in failed' });
  }
}
