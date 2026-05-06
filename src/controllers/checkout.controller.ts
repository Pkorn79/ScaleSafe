import { Request, Response } from 'express';
import { getSupabase } from '../clients/supabase.client';
import { resolveProcessor, createProcessorClient } from '../services/processor.factory';
import { paymentProviderService } from '../services/payment-provider.service';
import { offerRepository } from '../repositories/offer.repository';
import { merchantRepository } from '../repositories/merchant.repository';
import { config } from '../config';
import { logger } from '../utils/logger';
import { phase2EnrollmentService } from '../services/phase2Enrollment.service';
import { triggerService } from '../services/trigger.service';
import { ghlApi } from '../clients/ghl.client';

/** Compute next_billing_date from an offer's installment_frequency (matches phase2Enrollment.completeEnrollment). */
function computeNextBillingDate(installmentFrequency: string | null | undefined, from: Date = new Date()): string {
  const next = new Date(from);
  switch (installmentFrequency) {
    case 'daily': next.setDate(next.getDate() + 1); break;
    case 'weekly': next.setDate(next.getDate() + 7); break;
    case 'bi_weekly': next.setDate(next.getDate() + 14); break;
    case 'quarterly': next.setMonth(next.getMonth() + 3); break;
    case 'annual': next.setFullYear(next.getFullYear() + 1); break;
    default: next.setMonth(next.getMonth() + 1); // monthly default
  }
  return next.toISOString().split('T')[0];
}

/** Normalize payment choice from checkout page ('installments' → 'installment', default 'pif') */
function normalizePaymentType(choice?: string): string {
  if (!choice) return 'pif';
  if (choice === 'installments') return 'installment';
  return choice;
}

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

  // Resolve processor using the same logic as charge-time (respects merchant default)
  try {
    const { config: procConfig } = await resolveProcessor(merchant.merchantId, merchant.locationId);

    const response: Record<string, any> = {
      processorType: procConfig.processor_type,
      merchantName: merchantRow?.business_name || '',
    };

    if (procConfig.processor_type === 'nmi') {
      response.nmiTokenizationKey = procConfig.nmi_tokenization_key;
    } else if (procConfig.processor_type === 'stripe') {
      response.stripeAccountId = procConfig.stripe_user_id;
      response.stripePublishableKey = config.stripe.publishableKey;
    }

    res.json(response);
  } catch (err: any) {
    res.status(503).json({ error: err.message || 'No processor configured' });
    return;
  }
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

  // Resolve processor using the same logic as charge-time (respects offer override + merchant default)
  try {
    const offerHint = {
      processor_override: (offer as any).processor_override || null,
      nmi_processor_id: (offer as any).nmi_processor_id || null,
    };
    const { config: procConfig } = await resolveProcessor(merchant.id, offer.location_id, offerHint);

    const response: Record<string, any> = {
      processorType: procConfig.processor_type,
      merchantName: merchant.business_name || '',
      publishableKey: merchant.provider_publishable_key || '',
    };

    if (procConfig.processor_type === 'nmi') {
      response.nmiTokenizationKey = procConfig.nmi_tokenization_key || '';
    } else if (procConfig.processor_type === 'stripe') {
      response.stripePublishableKey = config.stripe.publishableKey || procConfig.stripe_publishable_key || '';
      response.stripeAccountId = procConfig.stripe_user_id || '';
    }

    res.json(response);
  } catch (err: any) {
    res.status(503).json({ error: err.message || 'No processor configured' });
    return;
  }
}

// ─── GET /api/checkout/config-by-product/:ghlProductId ─────────
// Used by the GHL Custom Payment Provider iframe which only has the GHL product ID
// (from postMessage productDetails[0]._id), not the ScaleSafe offer ID.

export async function getCheckoutConfigByProduct(req: Request, res: Response): Promise<void> {
  const { ghlProductId } = req.params;
  if (!ghlProductId) {
    res.status(400).json({ error: 'Missing ghlProductId' });
    return;
  }

  const supabase = getSupabase();
  const { data: offer } = await supabase
    .from('offers_mirror')
    .select('*')
    .eq('ghl_product_id', ghlProductId)
    .eq('active', true)
    .maybeSingle();

  if (!offer) {
    // No matching offer — fall back to merchant default (non-fatal)
    logger.info({ ghlProductId }, 'config-by-product: no offer found for GHL product ID — falling back to merchant default');
    res.status(404).json({ error: 'Offer not found for product' });
    return;
  }

  const merchant = await merchantRepository.findByLocationId(offer.location_id);
  if (!merchant) {
    res.status(404).json({ error: 'Merchant not found' });
    return;
  }

  try {
    const offerHint = {
      processor_override: offer.processor_override || null,
      nmi_processor_id: offer.nmi_processor_id || null,
    };
    const { config: procConfig } = await resolveProcessor(merchant.id, offer.location_id, offerHint);

    logger.info({
      ghlProductId,
      offerId: offer.id,
      offerName: offer.offer_name,
      processorOverride: offer.processor_override,
      resolvedProcessor: procConfig.processor_type,
    }, 'config-by-product: resolved processor for GHL product');

    const response: Record<string, any> = {
      processorType: procConfig.processor_type,
      merchantName: merchant.business_name || '',
    };

    if (procConfig.processor_type === 'nmi') {
      response.nmiTokenizationKey = procConfig.nmi_tokenization_key || '';
    } else if (procConfig.processor_type === 'stripe') {
      response.stripePublishableKey = config.stripe.publishableKey || procConfig.stripe_publishable_key || '';
      response.stripeAccountId = procConfig.stripe_user_id || '';
    }

    res.json(response);
  } catch (err: any) {
    res.status(503).json({ error: err.message || 'No processor configured' });
  }
}

// ─── POST /api/checkout/process-payment ──────────────────────

export async function processPayment(req: Request, res: Response): Promise<void> {
  const {
    publishableKey, paymentToken, amount, currency,
    contactId, contactEmail, contactName,
    orderId, transactionId, subscriptionId,
    offerId, ghlProductId, consentToken, saveCard,
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
    // Resolve offer hint for per-offer processor override
    let offerHint: { processor_override: 'nmi' | 'stripe' | null; nmi_processor_id: string | null } | undefined;
    if (offerId) {
      const ofr = await offerRepository.findById(offerId);
      if (ofr?.processor_override) {
        offerHint = { processor_override: ofr.processor_override as 'nmi' | 'stripe', nmi_processor_id: ofr.nmi_processor_id || null };
      }
    } else if (ghlProductId) {
      const { data: ofr } = await supabase.from('offers_mirror')
        .select('processor_override, nmi_processor_id')
        .eq('ghl_product_id', ghlProductId)
        .eq('location_id', merchant.locationId)
        .eq('active', true)
        .maybeSingle();
      if (ofr?.processor_override) {
        offerHint = { processor_override: ofr.processor_override as 'nmi' | 'stripe', nmi_processor_id: ofr.nmi_processor_id || null };
      }
    }

    const { config: procConfig } = await resolveProcessor(merchant.merchantId, merchant.locationId, offerHint);
    const processor = createProcessorClient(procConfig);

    logger.info({
      offerId: offerId || null,
      ghlProductId: ghlProductId || null,
      processorOverride: offerHint?.processor_override || null,
      resolvedProcessor: procConfig.processor_type,
    }, 'processPayment: processor resolved');

    // Determine recurring status BEFORE charge — NMI needs to vault atomically during charge
    // Vault during charge for BOTH processors:
    // - NMI: tokens are single-use, must vault atomically (customer_vault=add_customer)
    // - Stripe: setup_future_usage='off_session' saves card for recurring
    const isRecurringPaymentType = ['installments', 'installment', 'subscription']
      .includes(String(req.body.paymentChoice || '').toLowerCase());
    const shouldVaultDuringCharge = !!contactEmail
      && (saveCard === true || isRecurringPaymentType);

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
      shouldVault: shouldVaultDuringCharge,
      customerEmail: shouldVaultDuringCharge ? contactEmail : undefined,
      customerName: shouldVaultDuringCharge ? contactName : undefined,
    });

    const shouldSaveCard = result.success && !!contactEmail
      && (saveCard === true || isRecurringPaymentType);

    // Card persistence is deferred until AFTER the consent-token / quick-pay
    // contactId resolution blocks below — on the consent-token funnel path,
    // the bare `contactId` from req.body is empty until phase2EnrollmentService
    // (or the GHL upsert fallback) resolves it. We track the resolved value in
    // `finalContactId` and run the save-card block once at the end.
    let finalContactId = contactId || '';
    let finalEnrollmentId = '';

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
          finalEnrollmentId = enrollment.id;
          logger.info({ enrollmentId: enrollment.id, email: enrollEmail, contactId: enrollContactId, status: (enrollment as any).status, paymentChoice: req.body.paymentChoice }, 'POST-PAYMENT: enrollment found');

          // Resolve payment type and installment count
          const resolvedPaymentType = normalizePaymentType(req.body.paymentChoice);
          let paymentsTotal: number | null = null;
          if (resolvedPaymentType === 'installment' && (enrollment as any).offer_id) {
            const { data: offerRow } = await supabase
              .from('offers_mirror').select('num_payments').eq('id', (enrollment as any).offer_id).single();
            paymentsTotal = offerRow?.num_payments || null;
          }

          // 1. Complete enrollment in Supabase (status, evidence, triggers)
          await phase2EnrollmentService.completeEnrollment({
            enrollmentId: enrollment.id,
            locationId: (enrollment as any).location_id || merchant.locationId,
            contactId: enrollContactId || contactId || '',
            contactEmail: contactEmail || enrollEmail,
            paymentAmount: amount / 100,
            paymentType: resolvedPaymentType,
            transactionId: result.transactionId || result.chargeId || '',
            paymentsTotal,
          });

          // Re-query enrollment to get the contactId that completeEnrollment resolved.
          const { data: updatedEnrollment } = await supabase
            .from('enrollments')
            .select('contact_id')
            .eq('id', enrollment.id)
            .single();
          let resolvedContactId = updatedEnrollment?.contact_id || contactId || '';

          // FALLBACK: If completeEnrollment didn't save a contactId, do it here directly
          if (!resolvedContactId) {
            const clientEmail = contactEmail || enrollEmail;
            if (clientEmail) {
              try {
                const locId = (enrollment as any).location_id || merchant.locationId;
                const api = await ghlApi(locId);
                // Name priority: enrollment first_name → digital_signature → contactName → email prefix
                let fallbackFirstName = (enrollment as any).first_name || '';
                let fallbackLastName = (enrollment as any).last_name || '';
                if (!fallbackFirstName && (enrollment as any).digital_signature) {
                  const sigParts = ((enrollment as any).digital_signature as string).trim().split(/\s+/);
                  fallbackFirstName = sigParts[0] || '';
                  fallbackLastName = sigParts.slice(1).join(' ') || '';
                }
                if (!fallbackFirstName) {
                  fallbackFirstName = contactName || clientEmail.split('@')[0] || 'Client';
                }
                const upsertRes = await api.post('/contacts/upsert', {
                  firstName: fallbackFirstName,
                  lastName: fallbackLastName,
                  email: clientEmail,
                  locationId: locId,
                });
                resolvedContactId = upsertRes.data.contact?.id || upsertRes.data.id || '';
                logger.info({ resolvedContactId, clientEmail }, 'POST-PAYMENT FALLBACK: GHL contact upserted');
                if (resolvedContactId) {
                  await supabase.from('enrollments')
                    .update({ contact_id: resolvedContactId })
                    .eq('id', enrollment.id);
                }
              } catch (fallbackErr: any) {
                logger.error({ err: fallbackErr.message, stack: fallbackErr.stack }, 'POST-PAYMENT FALLBACK: GHL upsert failed');
              }
            }
          }
          logger.info({ resolvedContactId, enrollmentId: enrollment.id }, 'POST-PAYMENT: final contactId');
          if (resolvedContactId) finalContactId = resolvedContactId;

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
              payment_type: normalizePaymentType(req.body.paymentChoice),
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

    // For payments WITHOUT consent token: upsert GHL contact from customer fields
    if (result.success && !consentToken) {
      const quickPayEmail = contactEmail || req.body.contactEmail || '';
      const quickPayName = contactName || req.body.contactName || '';
      const quickPayPhone = req.body.contactPhone || '';
      let resolvedQuickPayContact = contactId || '';
      if (quickPayEmail && !resolvedQuickPayContact) {
        try {
          const api = await ghlApi(merchant.locationId);
          const nameParts = quickPayName.split(' ');
          const upsertRes = await api.post('/contacts/upsert', {
            firstName: nameParts[0] || quickPayEmail.split('@')[0] || 'Client',
            lastName: nameParts.slice(1).join(' ') || '',
            email: quickPayEmail,
            phone: quickPayPhone,
            locationId: merchant.locationId,
          });
          resolvedQuickPayContact = upsertRes.data.contact?.id || upsertRes.data.id || '';
          if (resolvedQuickPayContact) finalContactId = resolvedQuickPayContact;
          logger.info({ contactId: resolvedQuickPayContact, quickPayEmail }, 'Quick Pay: GHL contact upserted');

          // Set engagement status baseline for new contacts (gated on merchant toggle).
          if (resolvedQuickPayContact) {
            try {
              const merchantRow = await merchantRepository.findByLocationId(merchant.locationId);
              if ((merchantRow as any)?.engagement_enabled ?? true) {
                await api.put(`/contacts/${resolvedQuickPayContact}`, {
                  customField: { 'contact.ss_engagement_status': 'Active' },
                });
              }
            } catch {}
          }

          // Backfill payment_events with resolved contactId
          if (resolvedQuickPayContact) {
            await supabase.from('payment_events')
              .update({ contact_id: resolvedQuickPayContact })
              .eq('processor_transaction_id', result.transactionId)
              .eq('contact_id', '');
          }
        } catch (upsertErr: any) {
          logger.warn({ err: upsertErr.message }, 'Quick Pay: GHL contact upsert failed — payment still succeeded');
        }
      }

      // ─── Quick Pay enrollment + receipt ──────────────────────────
      // For installment/subscription Quick Pay offers, create a synthetic enrollment
      // row so the existing recurring-billing cron and payment-reminder cron pick it up.
      // Both crons key off the enrollments table; no other wiring needed.
      let quickPayEnrollmentId: string | null = null;
      let quickPayPaymentKind: 'one_off' | 'installment' | 'subscription' = 'one_off';
      let quickPayPaymentsTotal: number | null = null;
      let quickPayPaymentsRemaining = 0;

      if (offerId) {
        try {
          const offer = await offerRepository.findById(offerId);
          const offerPaymentType = (offer as any)?.payment_type || 'one_time';
          if (offerPaymentType === 'installment' || offerPaymentType === 'installments' || offerPaymentType === 'subscription') {
            quickPayPaymentKind = offerPaymentType === 'subscription' ? 'subscription' : 'installment';
            quickPayPaymentsTotal = offerPaymentType === 'subscription' ? null : ((offer as any)?.num_payments || null);
            quickPayPaymentsRemaining = quickPayPaymentsTotal ? Math.max(0, quickPayPaymentsTotal - 1) : 0;

            if (resolvedQuickPayContact) {
              // Idempotency: skip if an enrollment already exists for this transaction.
              const { data: existingEnr } = await supabase
                .from('enrollments')
                .select('id')
                .eq('payment_transaction_id', result.transactionId)
                .maybeSingle();

              if (existingEnr?.id) {
                quickPayEnrollmentId = existingEnr.id;
              } else {
                const nextBilling = computeNextBillingDate((offer as any)?.installment_frequency);
                const enrolledAt = new Date().toISOString();
                const { data: insertedEnr, error: enrInsertErr } = await supabase
                  .from('enrollments')
                  .insert({
                    location_id: merchant.locationId,
                    merchant_id: merchant.merchantId,
                    contact_id: resolvedQuickPayContact,
                    offer_id: offerId,
                    email: quickPayEmail || null,
                    status: 'enrolled',
                    payment_amount: amount / 100,
                    payment_type: quickPayPaymentKind,
                    payment_transaction_id: result.transactionId,
                    payments_made: 1,
                    payments_total: quickPayPaymentsTotal,
                    next_billing_date: nextBilling,
                    enrolled_at: enrolledAt,
                  } as any)
                  .select('id')
                  .single();
                if (enrInsertErr) {
                  logger.warn({ err: enrInsertErr.message, offerId, contactId: resolvedQuickPayContact }, 'Quick Pay: enrollment insert failed — recurring billing will not run');
                } else {
                  quickPayEnrollmentId = insertedEnr?.id || null;
                  // Backfill enrollment_id on the payment_events row inserted earlier.
                  if (quickPayEnrollmentId) {
                    await supabase.from('payment_events')
                      .update({ enrollment_id: quickPayEnrollmentId })
                      .eq('processor_transaction_id', result.transactionId);
                  }
                  logger.info({ enrollmentId: quickPayEnrollmentId, contactId: resolvedQuickPayContact, offerId, paymentKind: quickPayPaymentKind, nextBilling }, 'Quick Pay: synthetic enrollment created for recurring billing');
                }
              }
            } else {
              logger.warn({ offerId }, 'Quick Pay: installment/subscription offer but no resolvable contactId — skipping enrollment creation');
            }
          }
        } catch (offerErr: any) {
          logger.warn({ err: offerErr.message, offerId }, 'Quick Pay: offer lookup failed — defaulting to one-off receipt');
        }
      }

      // Insert payment_customer_map
      if (offerId) {
        try {
          await supabase.from('payment_customer_map').insert({
            customer_id: result.chargeId || result.transactionId || '',
            contact_id: resolvedQuickPayContact || '',
            location_id: merchant.locationId,
            offer_id: offerId,
            program_name: productDetails?.[0]?.name || '',
            payment_type: normalizePaymentType(req.body.paymentChoice),
            processor: procConfig.processor_type,
          });
        } catch (mapErr: any) {
          logger.warn({ err: mapErr.message }, 'Failed to insert payment_customer_map — non-blocking');
        }
      }

      // Fire Quick Pay receipt — ss_payment_received with payment_kind so the
      // PMG Recurring Payment Receipt workflow can branch on one-off vs installment copy.
      if (resolvedQuickPayContact) {
        try {
          await triggerService.fireTrigger(merchant.locationId, 'ss_payment_received', {
            contact_id: resolvedQuickPayContact,
            amount: amount / 100,
            transaction_id: result.transactionId,
            payments_remaining: quickPayPaymentsRemaining,
            running_total: amount / 100,
            payment_kind: quickPayPaymentKind,
          });
        } catch (trigErr: any) {
          logger.warn({ err: trigErr.message, contactId: resolvedQuickPayContact }, 'Quick Pay: ss_payment_received trigger fire failed (non-fatal)');
        }
      }
    }

    // ─── Persist card to payment_methods (recurring-billing prerequisite) ──
    // Runs AFTER both contactId resolution branches above so we always have
    // a real contactId to attach to the payment_methods row. Without this row
    // (with is_default=true), the daily recurring-billing job has nothing to
    // charge for installment / subscription enrollments.
    if (shouldSaveCard) {
      if (!finalContactId) {
        logger.warn({ contactEmail }, 'CARD-SAVE: skipped — could not resolve contactId for recurring payment');
      } else {
        try {
          let saveResult: { success: boolean; paymentMethodId: string; customerId: string; cardLastFour: string; cardBrand: string; cardExpMonth: number; cardExpYear: number };

          if (result.vaultedCustomerId) {
            // Atomic vault succeeded during charge — no separate saveCard needed
            // NMI: customerId = vaultId, paymentMethodId = vaultId (same value)
            // Stripe: customerId = cus_xxx, paymentMethodId = pm_xxx (the original token)
            saveResult = {
              success: true,
              paymentMethodId: procConfig.processor_type === 'stripe' ? paymentToken : result.vaultedCustomerId,
              customerId: result.vaultedCustomerId,
              cardLastFour: result.vaultedCardLastFour || '****',
              cardBrand: result.vaultedCardBrand || 'unknown',
              cardExpMonth: result.vaultedCardExpMonth || 0,
              cardExpYear: result.vaultedCardExpYear || 0,
            };
            logger.info({ customerId: result.vaultedCustomerId, processor: procConfig.processor_type, contactId: finalContactId }, 'CARD-SAVE: using vault from atomic charge');
          } else {
            // Fallback — separate saveCard call
            saveResult = await processor.saveCard({
              paymentToken,
              contactId: finalContactId,
              customerEmail: contactEmail,
              customerName: contactName,
            });
          }

          // Demote any existing defaults for this contact (one is_default=true at a time)
          await supabase.from('payment_methods')
            .update({ is_default: false })
            .eq('location_id', merchant.locationId)
            .eq('contact_id', finalContactId)
            .eq('is_default', true);

          await supabase.from('payment_methods').insert({
            merchant_id: merchant.merchantId,
            location_id: merchant.locationId,
            contact_id: finalContactId,
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

          logger.info({
            contactId: finalContactId,
            processor: procConfig.processor_type,
            paymentChoice: req.body.paymentChoice,
            recurring: isRecurringPaymentType,
            cardLastFour: saveResult.cardLastFour,
            cardBrand: saveResult.cardBrand,
            cardExpMonth: saveResult.cardExpMonth,
            cardExpYear: saveResult.cardExpYear,
          }, 'CARD-SAVE: payment method persisted for recurring billing');

          // ─── Create processor-level subscription (fire-and-forget) ──
          // Runs in background after response is sent. The subscription doesn't
          // need to exist before the checkout confirmation — the cron fallback
          // handles billing if subscription creation is delayed or fails.
          if (isRecurringPaymentType && finalEnrollmentId) {
            const bgSaveResult = { ...saveResult };
            const bgEnrId = finalEnrollmentId;
            const bgContactId = finalContactId;
            const bgProcType = procConfig.processor_type;
            Promise.resolve().then(async () => {
              try {
                const bgSupabase = getSupabase();
                const { data: enrForSub } = await bgSupabase
                  .from('enrollments')
                  .select('id, offer_id, payments_total, next_billing_date')
                  .eq('id', bgEnrId)
                  .single();

                if (enrForSub?.offer_id && enrForSub.next_billing_date) {
                  const { data: subOffer } = await bgSupabase
                    .from('offers_mirror')
                    .select('offer_name, installment_amount, installment_frequency')
                    .eq('id', enrForSub.offer_id)
                    .single();

                  if (subOffer?.installment_amount) {
                    const subAmountCents = Math.round(Number(subOffer.installment_amount) * 100);
                    const freq = (subOffer.installment_frequency || 'monthly').toLowerCase();
                    const subInterval: 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'annual' =
                      freq === 'daily' ? 'daily' :
                      freq === 'weekly' ? 'weekly' :
                      freq === 'bi_weekly' || freq === 'biweekly' ? 'biweekly' :
                      freq === 'quarterly' ? 'quarterly' :
                      freq === 'annual' ? 'annual' : 'monthly';

                    const remainingPayments = (enrForSub.payments_total || 0) - 1;

                    if (remainingPayments > 0) {
                      const subResult = await processor.createSubscription({
                        paymentMethodId: bgSaveResult.paymentMethodId || bgSaveResult.customerId,
                        customerId: bgSaveResult.customerId,
                        planAmount: subAmountCents,
                        interval: subInterval,
                        totalPayments: remainingPayments,
                        startDate: enrForSub.next_billing_date,
                        description: subOffer.offer_name || 'ScaleSafe Installment',
                        metadata: {
                          enrollment_id: bgEnrId,
                          offer_id: enrForSub.offer_id,
                          contact_id: bgContactId,
                        },
                      });

                      if (subResult.success && subResult.subscriptionId) {
                        await bgSupabase.from('enrollments')
                          .update({ processor_subscription_id: subResult.subscriptionId })
                          .eq('id', bgEnrId);
                        logger.info({
                          enrollmentId: bgEnrId,
                          subscriptionId: subResult.subscriptionId,
                          processor: bgProcType,
                          interval: subInterval,
                          remainingPayments,
                        }, 'BG-SUBSCRIPTION: processor-level recurring schedule created');
                      } else {
                        logger.warn({
                          enrollmentId: bgEnrId,
                          error: subResult.errorMessage,
                        }, 'BG-SUBSCRIPTION: processor createSubscription failed — cron will handle billing');
                      }
                    }
                  }
                }
              } catch (subErr: any) {
                logger.warn({
                  err: subErr.message,
                  enrollmentId: bgEnrId,
                }, 'BG-SUBSCRIPTION: failed to create processor subscription — cron will handle billing');
              }
            }).catch(() => {});
          }
        } catch (err: any) {
          logger.warn({
            err: err.message,
            contactId: finalContactId,
            paymentChoice: req.body.paymentChoice,
          }, 'CARD-SAVE: failed — payment still succeeded but recurring billing will not run');
        }
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
