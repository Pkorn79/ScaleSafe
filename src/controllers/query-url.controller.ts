import { Request, Response } from 'express';
import { getSupabase } from '../clients/supabase.client';
import { resolveProcessor, createProcessorClient } from '../services/processor.factory';
import { paymentProviderService } from '../services/payment-provider.service';
import { getCardBrandImageUrl, getCardBrandTitle } from '../utils/card-brands';
import { logger } from '../utils/logger';

interface MerchantRef {
  merchantId: string;
  locationId: string;
}

/** Dollars → cents (GHL sends dollars, ProcessorInterface uses cents) */
function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

/** Cents → dollars (for GHL response snapshots) */
function centsToDollars(cents: number): number {
  return cents / 100;
}

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

// ─── Main handler ────────────────────────────────────────────

export async function handleQueryUrl(req: Request, res: Response): Promise<void> {
  const { type, apiKey } = req.body;

  if (!apiKey || typeof apiKey !== 'string') {
    res.status(401).json({ error: 'Missing or invalid API key' });
    return;
  }

  if (!type || typeof type !== 'string') {
    res.status(400).json({ error: 'Missing or invalid operation type' });
    return;
  }

  const merchant = await paymentProviderService.getMerchantByApiKey(apiKey);
  if (!merchant) {
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }

  try {
    switch (type) {
      case 'verify':
        await handleVerify(req, res, merchant);
        return;
      case 'list_payment_methods':
        await handleListPaymentMethods(req, res, merchant);
        return;
      case 'charge_payment':
        await handleChargePayment(req, res, merchant);
        return;
      case 'create_subscription':
        await handleCreateSubscription(req, res, merchant);
        return;
      case 'cancel_subscription':
        await handleCancelSubscription(req, res, merchant);
        return;
      case 'refund':
        await handleRefund(req, res, merchant);
        return;
      default:
        res.status(400).json({ error: `Unknown operation type: ${type}` });
        return;
    }
  } catch (err: any) {
    logger.error(
      { err: err.message, type, locationId: merchant.locationId },
      'queryUrl handler error',
    );
    res.status(500).json({ success: false, failed: true, message: 'Internal error' });
  }
}

// ─── verify ──────────────────────────────────────────────────

async function handleVerify(req: Request, res: Response, merchant: MerchantRef): Promise<void> {
  const { chargeId } = req.body;

  if (!chargeId) {
    res.json({ failed: true, message: 'Missing chargeId' });
    return;
  }

  // Look up the processor transaction ID from mapping
  const supabase = getSupabase();
  const { data: mapping } = await supabase
    .from('transaction_mappings')
    .select('processor_transaction_id, processor_type')
    .eq('processor_charge_id', chargeId)
    .eq('merchant_id', merchant.merchantId)
    .single();

  if (!mapping) {
    // Try by processor_transaction_id directly (for NMI where chargeId = transactionId)
    const { data: mapping2 } = await supabase
      .from('transaction_mappings')
      .select('processor_transaction_id, processor_type')
      .eq('processor_transaction_id', chargeId)
      .eq('merchant_id', merchant.merchantId)
      .single();

    if (!mapping2) {
      res.json({ failed: true, message: 'Transaction not found' });
      return;
    }

    const { processorType, config } = await resolveProcessor(merchant.merchantId, merchant.locationId);
    const processor = createProcessorClient(config);
    const result = await processor.verifyTransaction(mapping2.processor_transaction_id);

    if (result.status === 'settled') {
      res.json({ success: true });
    } else if (result.status === 'failed' || result.status === 'voided') {
      res.json({ failed: true });
    } else {
      res.json({ success: false });
    }
    return;
  }

  const { processorType, config } = await resolveProcessor(merchant.merchantId, merchant.locationId);
  const processor = createProcessorClient(config);
  const result = await processor.verifyTransaction(mapping.processor_transaction_id);

  if (result.status === 'settled') {
    res.json({ success: true });
  } else if (result.status === 'failed' || result.status === 'voided') {
    res.json({ failed: true });
  } else {
    res.json({ success: false });
  }
}

// ─── list_payment_methods ────────────────────────────────────

async function handleListPaymentMethods(req: Request, res: Response, merchant: MerchantRef): Promise<void> {
  const { contactId } = req.body;

  if (!contactId) {
    res.json([]);
    return;
  }

  const supabase = getSupabase();
  const { data: methods } = await supabase
    .from('payment_methods')
    .select('*')
    .eq('location_id', merchant.locationId)
    .eq('contact_id', contactId);

  if (!methods || methods.length === 0) {
    res.json([]);
    return;
  }

  const result = methods.map((pm: any) => ({
    id: pm.id,
    type: 'card',
    title: getCardBrandTitle(pm.card_brand || 'visa'),
    subTitle: `**** **** **** ${pm.card_last_four || '****'}`,
    expiry: pm.card_exp_month && pm.card_exp_year
      ? `${String(pm.card_exp_month).padStart(2, '0')}/${String(pm.card_exp_year).slice(-2)}`
      : '',
    customerId: pm.nmi_customer_vault_id || pm.stripe_customer_id || '',
    imageUrl: getCardBrandImageUrl(pm.card_brand || 'visa'),
  }));

  res.json(result);
}

// ─── charge_payment ──────────────────────────────────────────

async function handleChargePayment(req: Request, res: Response, merchant: MerchantRef): Promise<void> {
  const { paymentMethodId, contactId, transactionId, chargeDescription, amount, currency } = req.body;

  const amountCents = dollarsToCents(amount);

  // Look up the payment method to get processor details
  const supabase = getSupabase();
  const { data: pm } = await supabase
    .from('payment_methods')
    .select('*')
    .eq('id', paymentMethodId)
    .eq('location_id', merchant.locationId)
    .single();

  if (!pm) {
    res.json({ success: false, failed: true, message: 'Payment method not found' });
    return;
  }

  const customerId = pm.nmi_customer_vault_id || pm.stripe_customer_id || '';

  const { config } = await resolveProcessor(merchant.merchantId, merchant.locationId, {
    processor_override: pm.processor_type as 'nmi' | 'stripe',
    nmi_processor_id: null,
  });
  const processor = createProcessorClient(config);

  const result = await processor.chargeStoredCard(customerId, paymentMethodId, {
    amount: amountCents,
    currency: (currency || 'USD').toLowerCase(),
    paymentToken: '', // not needed for stored card
    description: chargeDescription,
  });

  // Create transaction mapping
  await supabase.from('transaction_mappings').insert({
    merchant_id: merchant.merchantId,
    location_id: merchant.locationId,
    ghl_transaction_id: transactionId,
    processor_transaction_id: result.transactionId,
    processor_charge_id: result.chargeId || result.transactionId,
    processor_type: config.processor_type,
    contact_id: contactId,
  });

  if (result.success) {
    res.json({
      success: true,
      failed: false,
      chargeId: result.chargeId || result.transactionId,
      message: 'Payment successful',
      chargeSnapshot: {
        id: result.chargeId || result.transactionId,
        status: 'succeeded',
        amount: centsToDollars(amountCents),
        chargeId: result.chargeId || result.transactionId,
        chargedAt: nowUnix(),
      },
    });
  } else {
    res.json({
      success: false,
      failed: true,
      message: result.errorMessage || 'Payment failed',
    });
  }
}

// ─── create_subscription ─────────────────────────────────────

async function handleCreateSubscription(req: Request, res: Response, merchant: MerchantRef): Promise<void> {
  const {
    contactId, paymentMethodId, subscriptionId: ghlSubId,
    transactionId: ghlTxId, startDate, amount, recurringAmount, productDetails,
  } = req.body;

  // Parse interval and total cycles from productDetails
  let interval: 'weekly' | 'biweekly' | 'monthly' = 'monthly';
  let totalCycles = 0;

  if (productDetails?.[0]?.prices?.[0]?.recurring) {
    const recurring = productDetails[0].prices[0].recurring;
    if (recurring.interval === 'week') {
      interval = recurring.intervalCount === 2 ? 'biweekly' : 'weekly';
    } else {
      interval = 'monthly';
    }
    totalCycles = productDetails[0].prices[0].totalCycles || 0;
  }

  const recurringCents = dollarsToCents(parseFloat(recurringAmount) || amount);
  const firstChargeCents = dollarsToCents(amount);

  // Look up payment method
  const supabase = getSupabase();
  const { data: pm } = await supabase
    .from('payment_methods')
    .select('*')
    .eq('id', paymentMethodId)
    .eq('location_id', merchant.locationId)
    .single();

  if (!pm) {
    res.json({ success: false, failed: true, message: 'Payment method not found' });
    return;
  }

  const customerId = pm.nmi_customer_vault_id || pm.stripe_customer_id || '';
  const { config } = await resolveProcessor(merchant.merchantId, merchant.locationId, {
    processor_override: pm.processor_type as 'nmi' | 'stripe',
    nmi_processor_id: null,
  });
  const processor = createProcessorClient(config);

  const subResult = await processor.createSubscription({
    paymentMethodId: customerId,
    customerId,
    planAmount: recurringCents,
    interval,
    totalPayments: totalCycles,
    startDate,
    description: productDetails?.[0]?.name,
  });

  if (!subResult.success) {
    res.json({ success: false, failed: true, message: subResult.errorMessage || 'Subscription creation failed' });
    return;
  }

  // Create transaction mapping
  await supabase.from('transaction_mappings').insert({
    merchant_id: merchant.merchantId,
    location_id: merchant.locationId,
    ghl_transaction_id: ghlTxId,
    ghl_subscription_id: ghlSubId,
    processor_subscription_id: subResult.subscriptionId,
    processor_type: config.processor_type,
    contact_id: contactId,
  });

  const now = nowUnix();
  res.json({
    success: true,
    failed: false,
    message: 'Subscription created',
    transaction: {
      chargeId: subResult.subscriptionId,
      chargeSnapshot: {
        status: 'succeeded',
        id: subResult.subscriptionId,
        amount: centsToDollars(firstChargeCents),
        chargeId: subResult.subscriptionId,
        currency: 'USD',
        createdAt: now,
        chargedAt: now,
      },
    },
    subscription: {
      subscriptionId: subResult.subscriptionId,
      subscriptionSnapshot: {
        status: 'active',
        id: subResult.subscriptionId,
        trialEnd: null,
        createdAt: now,
        nextCharge: subResult.nextPaymentDate
          ? Math.floor(new Date(subResult.nextPaymentDate).getTime() / 1000)
          : undefined,
      },
    },
  });
}

// ─── cancel_subscription ─────────────────────────────────────

async function handleCancelSubscription(req: Request, res: Response, merchant: MerchantRef): Promise<void> {
  const { subscriptionId } = req.body;

  // Look up processor subscription ID
  const supabase = getSupabase();
  const { data: mapping } = await supabase
    .from('transaction_mappings')
    .select('processor_subscription_id, processor_type')
    .eq('ghl_subscription_id', subscriptionId)
    .eq('merchant_id', merchant.merchantId)
    .single();

  if (!mapping?.processor_subscription_id) {
    res.json({ status: 'canceled' }); // Already cancelled or not found
    return;
  }

  const { config } = await resolveProcessor(merchant.merchantId, merchant.locationId);
  const processor = createProcessorClient(config);

  await processor.cancelSubscription(mapping.processor_subscription_id);

  res.json({ status: 'canceled' });
}

// ─── refund ──────────────────────────────────────────────────

async function handleRefund(req: Request, res: Response, merchant: MerchantRef): Promise<void> {
  const { amount, chargeId } = req.body;

  const amountCents = amount ? dollarsToCents(amount) : undefined;

  // Look up processor transaction
  const supabase = getSupabase();
  const { data: mapping } = await supabase
    .from('transaction_mappings')
    .select('processor_transaction_id, processor_type')
    .or(`processor_charge_id.eq.${chargeId},processor_transaction_id.eq.${chargeId}`)
    .eq('merchant_id', merchant.merchantId)
    .single();

  if (!mapping) {
    res.json({ success: false, message: 'Transaction not found for refund' });
    return;
  }

  const { config } = await resolveProcessor(merchant.merchantId, merchant.locationId);
  const processor = createProcessorClient(config);

  const result = await processor.refund({
    transactionId: mapping.processor_transaction_id,
    amount: amountCents,
  });

  if (result.success) {
    logger.info({
      event: 'refund_processed',
      merchantId: merchant.merchantId,
      locationId: merchant.locationId,
      refundId: result.refundId,
      amount: amount || 0,
      chargeId,
      timestamp: new Date().toISOString(),
    }, 'Refund processed successfully');

    res.json({
      success: true,
      message: 'Refund successful',
      id: result.refundId,
      amount: amount || 0,
      currency: 'USD',
    });
  } else {
    logger.warn({
      event: 'refund_failed',
      merchantId: merchant.merchantId,
      chargeId,
      error: result.errorMessage,
    }, 'Refund failed');

    res.json({
      success: false,
      message: result.errorMessage || 'Refund failed',
    });
  }
}
