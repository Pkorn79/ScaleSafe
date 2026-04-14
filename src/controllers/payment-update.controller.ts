import { Request, Response, NextFunction } from 'express';
import { getSupabase } from '../clients/supabase.client';
import { ghlApi } from '../clients/ghl.client';
import { resolveProcessor, createProcessorClient } from '../services/processor.factory';
import { merchantRepository } from '../repositories/merchant.repository';
import { logger } from '../utils/logger';

function getClientIp(req: Request): string {
  return req.headers['x-forwarded-for']?.toString().split(',')[0].trim()
    || req.headers['x-real-ip']?.toString()
    || req.socket.remoteAddress
    || '';
}

/**
 * GET /api/payment-update/config?contactId=X&locationId=Y
 * Public endpoint — called by the payment-update widget to get processor config.
 */
export async function getPaymentUpdateConfig(req: Request, res: Response, next: NextFunction) {
  try {
    const contactId = req.query.contactId as string;
    const locationId = req.query.locationId as string;
    if (!contactId || !locationId) {
      res.status(400).json({ error: 'contactId and locationId are required' });
      return;
    }

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

    try {
      const { config: procConfig } = await resolveProcessor(merchant.id, locationId);
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
      const supabase = getSupabase();
      const { data: enrollment } = await supabase
        .from('enrollments')
        .select('email, first_name, last_name')
        .eq('location_id', locationId)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
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
  } catch (err) { next(err); }
}

/**
 * POST /api/payment-update/update-method
 * Public endpoint — called by the payment-update widget after card tokenization.
 */
export async function updatePaymentMethod(req: Request, res: Response, next: NextFunction) {
  try {
    const { contactId, locationId, token, processorType } = req.body;
    if (!contactId || !locationId || !token || !processorType) {
      res.status(400).json({ success: false, error: 'contactId, locationId, token, and processorType are required' });
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

    // Get contact info for the processor
    let contactEmail = req.body.contactEmail || '';
    let contactName = req.body.contactName || '';
    if (!contactEmail) {
      const { data: enrollment } = await supabase
        .from('enrollments')
        .select('email, first_name, last_name')
        .eq('location_id', locationId)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (enrollment) {
        contactEmail = enrollment.email || '';
        contactName = contactName || [enrollment.first_name, enrollment.last_name].filter(Boolean).join(' ');
      }
    }

    // Resolve processor and save the card
    const { config: procConfig } = await resolveProcessor(merchant.id, locationId);
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

    // Mark previous methods as non-default
    await supabase
      .from('payment_methods')
      .update({ is_default: false })
      .eq('location_id', locationId)
      .eq('contact_id', contactId);

    // Store new payment method
    await supabase.from('payment_methods').insert({
      merchant_id: merchant.id,
      location_id: locationId,
      contact_id: contactId,
      processor_type: procConfig.processor_type,
      nmi_customer_vault_id: procConfig.processor_type === 'nmi' ? result.customerId : null,
      stripe_customer_id: procConfig.processor_type === 'stripe' ? result.customerId : null,
      stripe_payment_method_id: procConfig.processor_type === 'stripe' ? result.paymentMethodId : null,
      card_last_four: result.cardLastFour,
      card_brand: result.cardBrand,
      card_exp_month: result.cardExpMonth,
      card_exp_year: result.cardExpYear,
      is_default: true,
    });

    // Log evidence
    try {
      await supabase.from('evidence').insert({
        location_id: locationId,
        contact_id: contactId,
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
    const { contactId, locationId, reason } = req.body;
    if (!contactId || !locationId || !reason) {
      res.status(400).json({ success: false, error: 'contactId, locationId, and reason are required' });
      return;
    }

    const merchant = await merchantRepository.findByLocationId(locationId);
    if (!merchant) {
      res.status(404).json({ success: false, error: 'Merchant not found' });
      return;
    }

    const supabase = getSupabase();
    const clientIp = req.headers['x-forwarded-for']?.toString().split(',')[0].trim() || req.socket.remoteAddress || '';

    // Verify contact belongs to this location (via enrollment)
    const { data: enrollment } = await supabase
      .from('enrollments')
      .select('id, status, offer_id')
      .eq('location_id', locationId)
      .eq('contact_id', contactId)
      .in('status', ['enrolled', 'active'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!enrollment) {
      res.status(404).json({ success: false, error: 'No active enrollment found' });
      return;
    }

    // Use the lifecycle service to cancel with full evidence logging
    const { paymentLifecycleService } = require('../services/payment-lifecycle.service');
    await paymentLifecycleService.cancelSubscription({
      merchantId: merchant.id,
      locationId,
      contactId,
      offerId: enrollment.offer_id || '',
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
      });
    } catch { /* non-blocking */ }

    logger.info({ contactId, locationId, reason }, 'Client-initiated subscription cancellation');
    res.json({ success: true });
  } catch (err: any) {
    logger.error({ err: err.message, stack: err.stack }, 'Client subscription cancel failed');
    res.status(500).json({ success: false, error: err.message || 'Cancellation failed' });
  }
}

/**
 * GET /api/milestone-signoff/config — milestone details for sign-off widget
 */
export async function getMilestoneConfig(req: Request, res: Response, next: NextFunction) {
  try {
    const contactId = req.query.contactId as string;
    const locationId = req.query.locationId as string;
    const milestoneNumber = parseInt(req.query.milestoneNumber as string);
    if (!contactId || !locationId || !milestoneNumber) {
      res.status(400).json({ error: 'contactId, locationId, milestoneNumber required' });
      return;
    }

    const supabase = getSupabase();
    const { data: enrollment } = await supabase
      .from('enrollments').select('id, offer_id, current_milestone')
      .eq('location_id', locationId).eq('contact_id', contactId).in('status', ['enrolled', 'active'])
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!enrollment || !enrollment.offer_id) {
      res.status(404).json({ error: 'No active enrollment found' });
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
      milestoneNumber,
    });
  } catch (err) { next(err); }
}

/**
 * POST /api/milestone-signoff/submit — client confirms milestone completion
 */
export async function submitMilestoneSignoff(req: Request, res: Response, next: NextFunction) {
  try {
    const { contactId, locationId, milestoneNumber, signature } = req.body;
    if (!contactId || !locationId || !milestoneNumber || !signature) {
      res.status(400).json({ success: false, error: 'contactId, locationId, milestoneNumber, signature required' });
      return;
    }

    const clientIp = req.headers['x-forwarded-for']?.toString().split(',')[0].trim() || req.socket.remoteAddress || '';
    const supabase = getSupabase();

    // Verify enrollment
    const { data: enrollment } = await supabase
      .from('enrollments').select('id, offer_id')
      .eq('location_id', locationId).eq('contact_id', contactId).in('status', ['enrolled', 'active'])
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!enrollment) {
      res.status(404).json({ success: false, error: 'No active enrollment' });
      return;
    }

    // Get milestone name
    const { data: offer } = await supabase
      .from('offers_mirror').select('*').eq('id', enrollment.offer_id).single();
    const milestoneName = (offer as any)?.[`m${milestoneNumber}_name`] || `Milestone ${milestoneNumber}`;

    // Insert evidence signoff
    await supabase.from('evidence_signoffs').insert({
      location_id: locationId, contact_id: contactId, source: 'client_signoff',
      milestone_number: milestoneNumber, milestone_name: milestoneName,
      signature_data: signature, ip_address: clientIp,
      signed_at: new Date().toISOString(),
    });

    // Fire trigger — flat doc contract
    const { triggerService } = require('../services/trigger.service');
    await triggerService.fireTrigger(locationId, 'ss_milestone_signedoff', {
      contact_id: contactId,
      milestone_number: milestoneNumber,
      milestone_name: milestoneName,
      signature_timestamp: new Date().toISOString(),
      ip_address: clientIp,
    });

    logger.info({ contactId, milestoneNumber, milestoneName }, 'Milestone signed off by client');
    res.json({ success: true });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Milestone signoff failed');
    res.status(500).json({ success: false, error: err.message || 'Sign-off failed' });
  }
}
