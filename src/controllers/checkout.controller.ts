import { Request, Response } from 'express';
import { getSupabase } from '../clients/supabase.client';
import { resolveProcessor, createProcessorClient } from '../services/processor.factory';
import { paymentProviderService } from '../services/payment-provider.service';
import { processorConfigService } from '../services/processor-config.service';
import { offerRepository } from '../repositories/offer.repository';
import { merchantRepository } from '../repositories/merchant.repository';
import { config } from '../config';
import { logger } from '../utils/logger';
import { phase2EnrollmentService } from '../services/phase2Enrollment.service';

function getClientIp(req: Request): string {
  return req.headers['x-forwarded-for']?.toString().split(',')[0].trim()
    || req.headers['x-real-ip']?.toString()
    || req.socket.remoteAddress
    || '';
}

// ─── GET /api/checkout/config ────────────────────────────────

export async function getCheckoutConfig(req: Request, res: Response): Promise<void> {
  const publishableKey = req.query.publishableKey as string;
  if (!publishableKey) {
    res.status(400).json({ error: 'Missing publishableKey' });
    return;
  }

  const merchant = await paymentProviderService.getMerchantByPublishableKey(publishableKey);
  if (!merchant) {
    res.status(404).json({ error: 'Merchant not found' });
    return;
  }

  const supabase = getSupabase();
  const { data: merchantRow } = await supabase
    .from('merchants')
    .select('business_name, default_processor')
    .eq('id', merchant.merchantId)
    .single();

  // Get processor config
  const configs = await processorConfigService.listConfigs(merchant.merchantId);
  const activeConfig = configs.find(c => c.is_active && c.is_default) || configs.find(c => c.is_active);

  if (!activeConfig) {
    res.status(503).json({ error: 'No processor configured' });
    return;
  }

  const response: Record<string, any> = {
    processorType: activeConfig.processor_type,
    merchantName: merchantRow?.business_name || '',
  };

  if (activeConfig.processor_type === 'nmi') {
    response.nmiTokenizationKey = activeConfig.nmi_tokenization_key;
  } else if (activeConfig.processor_type === 'stripe') {
    response.stripeAccountId = activeConfig.stripe_user_id;
    response.stripePublishableKey = config.stripe.publishableKey;
  }

  res.json(response);
}

// ─── GET /api/checkout/config-by-offer/:offerId ─────────────

export async function getCheckoutConfigByOffer(req: Request, res: Response): Promise<void> {
  const { offerId } = req.params;
  if (!offerId) {
    res.status(400).json({ error: 'Missing offerId' });
    return;
  }

  const offer = await offerRepository.findById(offerId);
  if (!offer || !offer.active) {
    res.status(404).json({ error: 'Offer not found' });
    return;
  }

  const merchant = await merchantRepository.findByLocationId(offer.location_id);
  if (!merchant) {
    res.status(404).json({ error: 'Merchant not found' });
    return;
  }

  const configs = await processorConfigService.listConfigs(merchant.id);
  const activeConfig = configs.find(c => c.is_active && c.is_default) || configs.find(c => c.is_active);

  if (!activeConfig) {
    res.status(503).json({ error: 'No processor configured' });
    return;
  }

  const response: Record<string, any> = {
    processorType: activeConfig.processor_type,
    merchantName: merchant.business_name || '',
    publishableKey: merchant.provider_publishable_key || '',
  };

  if (activeConfig.processor_type === 'nmi') {
    response.nmiTokenizationKey = activeConfig.nmi_tokenization_key || '';
  } else if (activeConfig.processor_type === 'stripe') {
    response.stripePublishableKey = config.stripe.publishableKey || activeConfig.stripe_publishable_key || '';
    response.stripeAccountId = activeConfig.stripe_user_id || '';
  }

  res.json(response);
}

// ─── POST /api/checkout/process-payment ──────────────────────

export async function processPayment(req: Request, res: Response): Promise<void> {
  const {
    publishableKey, paymentToken, amount, currency,
    contactId, contactEmail, contactName,
    orderId, transactionId, subscriptionId,
    offerId, consentToken, saveCard,
    deviceFingerprint, browserInfo,
    productDetails, requestThreeDSecure,
  } = req.body;

  if (!paymentToken || !amount) {
    res.status(400).json({ success: false, error: 'Missing required fields: paymentToken and amount are required' });
    return;
  }

  if (!publishableKey && !offerId) {
    res.status(400).json({ success: false, error: 'Either publishableKey or offerId is required' });
    return;
  }

  if (typeof amount !== 'number' || amount <= 0 || amount > 99999999) {
    res.status(400).json({ success: false, error: 'Invalid amount: must be a positive number in cents (max $999,999.99)' });
    return;
  }

  if (typeof paymentToken !== 'string' || paymentToken.length < 3) {
    res.status(400).json({ success: false, error: 'Invalid payment token' });
    return;
  }

  // Resolve merchant by publishableKey or by offerId
  let merchant: { merchantId: string; locationId: string } | null = null;
  if (publishableKey) {
    merchant = await paymentProviderService.getMerchantByPublishableKey(publishableKey);
  }
  if (!merchant && offerId) {
    const offer = await offerRepository.findById(offerId);
    if (offer) {
      const m = await merchantRepository.findByLocationId(offer.location_id);
      if (m) {
        merchant = { merchantId: m.id, locationId: m.location_id };
      }
    }
  }
  if (!merchant) {
    res.status(401).json({ success: false, error: 'Merchant not found' });
    return;
  }

  const clientIp = getClientIp(req);
  const supabase = getSupabase();

  // Verify consent token if present
  if (consentToken) {
    const { data: enrollment } = await supabase
      .from('enrollments')
      .select('id, status')
      .eq('consent_token', consentToken)
      .single();

    if (!enrollment) {
      res.status(400).json({ success: false, error: 'Consent verification failed. Please complete the enrollment process.' });
      return;
    }
  }

  try {
    const { config: procConfig } = await resolveProcessor(merchant.merchantId, merchant.locationId);
    const processor = createProcessorClient(procConfig);

    const result = await processor.charge({
      amount,
      currency: (currency || 'usd').toLowerCase(),
      paymentToken,
      description: productDetails?.[0]?.name || 'ScaleSafe Payment',
      metadata: {
        scalesafe_offer_id: offerId || '',
        consent_token: consentToken || '',
        ghl_transaction_id: transactionId || '',
        ghl_order_id: orderId || '',
        customer_email: contactEmail || '',
        customer_ip: clientIp,
        terms_accepted: consentToken ? 'true' : '',
        terms_accepted_at: consentToken ? new Date().toISOString() : '',
        ce30_eligible: consentToken ? 'true' : 'false',
        first_name: contactName?.split(' ')[0] || '',
        last_name: contactName?.split(' ').slice(1).join(' ') || '',
        email: contactEmail || '',
        ip_address: clientIp,
      },
      statementDescriptorSuffix: productDetails?.[0]?.name?.substring(0, 22),
      requestThreeDSecure,
    });

    // Save card if requested and payment succeeded
    if (result.success && saveCard && contactEmail) {
      try {
        const saveResult = await processor.saveCard({
          paymentToken,
          contactId: contactId || '',
          customerEmail: contactEmail,
          customerName: contactName,
        });

        // Store in payment_methods
        await supabase.from('payment_methods').insert({
          merchant_id: merchant.merchantId,
          location_id: merchant.locationId,
          contact_id: contactId,
          processor_type: procConfig.processor_type,
          nmi_customer_vault_id: procConfig.processor_type === 'nmi' ? saveResult.customerId : null,
          stripe_customer_id: procConfig.processor_type === 'stripe' ? saveResult.customerId : null,
          stripe_payment_method_id: procConfig.processor_type === 'stripe' ? saveResult.paymentMethodId : null,
          card_last_four: saveResult.cardLastFour,
          card_brand: saveResult.cardBrand,
          card_exp_month: saveResult.cardExpMonth,
          card_exp_year: saveResult.cardExpYear,
          is_default: true,
        });
      } catch (err: any) {
        logger.warn({ err: err.message }, 'Failed to save card — payment still succeeded');
      }
    }

    // Create transaction mapping
    if (transactionId || orderId) {
      await supabase.from('transaction_mappings').insert({
        merchant_id: merchant.merchantId,
        location_id: merchant.locationId,
        ghl_transaction_id: transactionId || null,
        ghl_subscription_id: subscriptionId || null,
        ghl_order_id: orderId || null,
        processor_transaction_id: result.transactionId,
        processor_charge_id: result.chargeId || result.transactionId,
        processor_type: procConfig.processor_type,
        contact_id: contactId,
      });
    }

    // Log payment event
    const enrollmentLookup = consentToken
      ? await supabase.from('enrollments').select('id').eq('consent_token', consentToken).single()
      : null;

    await supabase.from('payment_events').insert({
      merchant_id: merchant.merchantId,
      location_id: merchant.locationId,
      contact_id: contactId || '',
      enrollment_id: enrollmentLookup?.data?.id || null,
      event_type: result.success ? 'sale' : 'payment_failed',
      processor: procConfig.processor_type,
      processor_transaction_id: result.transactionId,
      amount: amount / 100, // store in dollars in DB
      currency: (currency || 'usd').toLowerCase(),
      consent_token: consentToken || null,
      failure_reason: result.errorMessage || null,
      ip_address: clientIp,
      device_info: deviceFingerprint || null,
      browser_info: browserInfo || null,
    });

    // ─── Complete enrollment + create GHL records ──────
    logger.info({ consentToken: consentToken || 'EMPTY', hasConsent: !!consentToken, paymentSuccess: result.success }, 'POST-PAYMENT: checking enrollment completion eligibility');
    if (result.success && consentToken) {
      try {
        const { data: enrollment, error: enrollLookupErr } = await supabase
          .from('enrollments')
          .select('*')
          .eq('consent_token', consentToken)
          .single();

        if (enrollment) {
          const enrollEmail = (enrollment as any).email || '';
          const enrollContactId = (enrollment as any).contact_id || '';
          logger.info({ enrollmentId: enrollment.id, email: enrollEmail, contactId: enrollContactId, status: (enrollment as any).status }, 'POST-PAYMENT: enrollment found');

          // 1. Complete enrollment in Supabase (status, evidence, triggers)
          await phase2EnrollmentService.completeEnrollment({
            enrollmentId: enrollment.id,
            locationId: (enrollment as any).location_id || merchant.locationId,
            contactId: enrollContactId || contactId || '',
            contactEmail: contactEmail || enrollEmail,
            paymentAmount: amount / 100,
            paymentType: req.body.paymentChoice || 'pif',
            transactionId: result.transactionId || result.chargeId || '',
            paymentsTotal: null,
          });

          // GHL contact upsert + custom fields + pipeline opportunity handled by completeEnrollment above.
          // Re-query enrollment to get the contactId that completeEnrollment resolved.
          const { data: updatedEnrollment } = await supabase
            .from('enrollments')
            .select('contact_id')
            .eq('id', enrollment.id)
            .single();
          const resolvedContactId = updatedEnrollment?.contact_id || contactId || '';
          logger.info({ resolvedContactId, enrollmentId: enrollment.id }, 'POST-PAYMENT: contactId after completeEnrollment');

          // Backfill contactId on payment_events that were inserted before GHL upsert
          if (resolvedContactId) {
            await supabase.from('payment_events')
              .update({ contact_id: resolvedContactId })
              .eq('consent_token', consentToken)
              .eq('contact_id', '');
          }

          // Insert payment_customer_map with the resolved contactId
          try {
            await supabase.from('payment_customer_map').insert({
              customer_id: result.chargeId || result.transactionId || '',
              contact_id: resolvedContactId,
              location_id: merchant.locationId,
              offer_id: offerId || (enrollment as any).offer_id || '',
              program_name: productDetails?.[0]?.name || '',
              payment_type: req.body.paymentChoice || 'pif',
              processor: procConfig.processor_type,
            });
          } catch (mapErr: any) {
            logger.warn({ err: mapErr.message }, 'Failed to insert payment_customer_map');
          }
        } else {
          logger.warn({ consentToken, lookupError: enrollLookupErr?.message }, 'POST-PAYMENT: NO enrollment found for consent token');
        }
      } catch (enrollErr: any) {
        logger.error({ err: enrollErr.message, stack: enrollErr.stack, consentToken }, 'POST-PAYMENT: completeEnrollment failed — payment still succeeded');
      }
    }

    // Fallback: insert payment_customer_map for payments WITHOUT consent token
    if (result.success && offerId && !consentToken) {
      try {
        await supabase.from('payment_customer_map').insert({
          customer_id: result.chargeId || result.transactionId || '',
          contact_id: contactId || '',
          location_id: merchant.locationId,
          offer_id: offerId,
          program_name: productDetails?.[0]?.name || '',
          payment_type: req.body.paymentChoice || 'pif',
          processor: procConfig.processor_type,
        });
      } catch (mapErr: any) {
        logger.warn({ err: mapErr.message }, 'Failed to insert payment_customer_map (no consent) — non-blocking');
      }
    }

    // Flag payment without consent (do NOT block — just warn)
    if (result.success && !consentToken && offerId) {
      logger.warn({
        event: 'payment_without_consent',
        merchantId: merchant.merchantId,
        locationId: merchant.locationId,
        contactId: contactId || '',
        offerId,
      }, 'Payment completed without consent token');
    }

    // Structured payment event log
    logger.info({
      event: 'payment_processed',
      merchantId: merchant.merchantId,
      locationId: merchant.locationId,
      processor: procConfig.processor_type,
      amount,
      currency: (currency || 'usd').toLowerCase(),
      success: result.success,
      chargeId: result.chargeId || result.transactionId,
      hasConsent: !!consentToken,
      timestamp: new Date().toISOString(),
    }, result.success ? 'Payment succeeded' : 'Payment failed');

    res.json({
      success: result.success,
      chargeId: result.chargeId || result.transactionId,
      error: result.errorMessage,
      threeDSecureUrl: result.threeDSecureUrl,
    });
  } catch (err: any) {
    logger.error({ err: err.message, stack: err.stack, merchantId: merchant.merchantId }, 'Checkout payment failed');
    res.status(500).json({ success: false, error: err.message || 'Payment processing error' });
  }
}

// ─── POST /api/checkout/save-card ────────────────────────────

export async function saveCard(req: Request, res: Response): Promise<void> {
  const { publishableKey, paymentToken, contactId, contactEmail, contactName } = req.body;

  if (!publishableKey || !paymentToken || !contactEmail) {
    res.status(400).json({ success: false, error: 'Missing required fields: publishableKey, paymentToken, and contactEmail are required' });
    return;
  }

  if (typeof contactEmail !== 'string' || !contactEmail.includes('@')) {
    res.status(400).json({ success: false, error: 'Invalid email address' });
    return;
  }

  const merchant = await paymentProviderService.getMerchantByPublishableKey(publishableKey);
  if (!merchant) {
    res.status(401).json({ success: false, error: 'Invalid publishable key' });
    return;
  }

  try {
    const { config: procConfig } = await resolveProcessor(merchant.merchantId, merchant.locationId);
    const processor = createProcessorClient(procConfig);

    const result = await processor.saveCard({
      paymentToken,
      contactId: contactId || '',
      customerEmail: contactEmail,
      customerName: contactName,
    });

    // Store in payment_methods
    const supabase = getSupabase();
    await supabase.from('payment_methods').insert({
      merchant_id: merchant.merchantId,
      location_id: merchant.locationId,
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

    res.json({
      success: true,
      paymentMethodId: result.paymentMethodId,
    });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Save card failed');
    res.status(500).json({ success: false, error: 'Failed to save card' });
  }
}
