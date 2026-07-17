import { Request, Response } from 'express';
import { getSupabase } from '../clients/supabase.client';
import { resolveProcessor, createProcessorClient } from '../services/processor.factory';
import { paymentProviderService } from '../services/payment-provider.service';
import { collapseVisiblePaymentMethods } from '../services/payment-methods.service';
import { ProcessorType } from '../types/processor.types';
import { getCardBrandImageUrl, getCardBrandTitle } from '../utils/card-brands';
import { logger } from '../utils/logger';
import { moneyOperationService } from '../services/money-operation.service';
import { assertNewProcessorActivityAllowed } from '../services/marketplace-entitlement.service';

interface MerchantRef {
  merchantId: string;
  locationId: string;
}

function mappedProcessorType(processorType: unknown): ProcessorType | null {
  return processorType === 'nmi' || processorType === 'stripe' ? processorType : null;
}

function resolveMappedProcessor(merchant: MerchantRef, processorType: unknown) {
  return resolveProcessor(merchant.merchantId, merchant.locationId, {
    processor_override: mappedProcessorType(processorType),
    nmi_processor_id: null,
  });
}

/** Dollars → cents (GHL sends dollars, ProcessorInterface uses cents) */
function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

function isSafeProcessorReference(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
}

const REFUND_PAYMENT_EVENT_TYPES = ['payment_success', 'payment_received', 'sale'];
const REFUND_EVENT_TYPES = ['refund', 'refund_processed'];
const QUERY_URL_REFUND_CLAIMED_BY = 'query_url';

interface QueryUrlRefundClaim {
  id: string;
  amount_cents: number;
  status: string;
  processor_refund_id?: string | null;
  refund_payment_event_id?: string | null;
}

/** Cents → dollars (for GHL response snapshots) */
function centsToDollars(cents: number): number {
  return cents / 100;
}

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

function handleExistingOperation(
  operation: Awaited<ReturnType<typeof moneyOperationService.begin>>,
  res: Response,
): boolean {
  if (operation.action === 'replay') {
    res.json(operation.response);
    return true;
  }
  if (operation.action === 'blocked') {
    res.status(409).json({
      success: false,
      failed: true,
      message: 'This payment operation is already processing or requires reconciliation.',
    });
    return true;
  }
  return false;
}

function queryUrlRefundResponse(claim: QueryUrlRefundClaim, message = 'Refund successful') {
  return {
    success: true,
    message,
    id: claim.processor_refund_id || undefined,
    amount: centsToDollars(Number(claim.amount_cents || 0)),
    currency: 'USD',
  };
}

function handleExistingRefundClaim(claim: QueryUrlRefundClaim, res: Response): void {
  if (claim.status === 'recorded' || claim.status === 'succeeded') {
    res.json(queryUrlRefundResponse(claim));
    return;
  }
  if (claim.status === 'provider_accepted') {
    res.json(queryUrlRefundResponse(claim, 'Refund accepted and awaiting local reconciliation'));
    return;
  }
  res.status(409).json({
    success: false,
    message: 'This refund is already processing or requires reconciliation.',
  });
}

async function findQueryUrlRefundClaim(
  supabase: ReturnType<typeof getSupabase>,
  locationId: string,
  requestFingerprint: string,
): Promise<QueryUrlRefundClaim | null> {
  const { data, error } = await supabase
    .from('payment_refund_claims')
    .select('id, amount_cents, status, processor_refund_id, refund_payment_event_id')
    .eq('location_id', locationId)
    .eq('claimed_by', QUERY_URL_REFUND_CLAIMED_BY)
    .eq('request_fingerprint', requestFingerprint)
    .maybeSingle();
  if (error) throw error;
  return data as QueryUrlRefundClaim | null;
}

async function updateQueryUrlRefundClaim(
  supabase: ReturnType<typeof getSupabase>,
  locationId: string,
  claimId: string,
  updates: Record<string, unknown>,
  providerStartBoundary = false,
): Promise<void> {
  let query: any = supabase
    .from('payment_refund_claims')
    .update(updates)
    .eq('id', claimId)
    .eq('location_id', locationId);
  if (providerStartBoundary) {
    query = query
      .eq('status', 'processing')
      .eq('provider_called', false)
      .select('id')
      .maybeSingle();
  }
  const { data, error } = await query;
  if (error) throw error;
  if (providerStartBoundary && !data) {
    throw new Error('Refund claim is no longer available for processor execution');
  }
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

    const { config } = await resolveMappedProcessor(merchant, mapping2.processor_type);
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

  const { config } = await resolveMappedProcessor(merchant, mapping.processor_type);
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

  const { visible } = collapseVisiblePaymentMethods(methods);
  const result = visible.map((pm: any) => ({
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
  if (!paymentMethodId || !contactId || !isSafeProcessorReference(transactionId)) {
    res.status(400).json({ success: false, failed: true, message: 'paymentMethodId, contactId, and transactionId are required' });
    return;
  }
  if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > 99999999) {
    res.status(400).json({ success: false, failed: true, message: 'Invalid amount' });
    return;
  }

  // Look up the payment method to get processor details
  const supabase = getSupabase();
  const { data: pm } = await supabase
    .from('payment_methods')
    .select('*')
    .eq('id', paymentMethodId)
    .eq('location_id', merchant.locationId)
    .eq('contact_id', contactId)
    .single();

  if (!pm) {
    res.json({ success: false, failed: true, message: 'Payment method not found' });
    return;
  }

  const customerId = pm.nmi_customer_vault_id || pm.stripe_customer_id || '';
  // #10: the processor token must come from the looked-up row, NOT the ScaleSafe DB UUID echoed
  // back by GHL (Stripe rejects a UUID as payment_method). The UUID is only the lookup key.
  const storedToken = pm.stripe_payment_method_id || pm.nmi_customer_vault_id || '';

  const { config } = await resolveProcessor(merchant.merchantId, merchant.locationId, {
    processor_override: pm.processor_type as 'nmi' | 'stripe',
    nmi_processor_id: null,
  });
  await assertNewProcessorActivityAllowed(merchant.locationId, config.processor_type);
  const processor = createProcessorClient(config);

  const operation = await moneyOperationService.begin({
    locationId: merchant.locationId,
    merchantId: merchant.merchantId,
    operationType: 'query_url_charge',
    operationKey: transactionId,
    request: {
      paymentMethodId,
      contactId,
      transactionId,
      amountCents,
      currency: String(currency || 'USD').toLowerCase(),
      processorType: config.processor_type,
    },
  });
  if (handleExistingOperation(operation, res)) return;

  let result;
  try {
    await moneyOperationService.markProviderStarted({
      id: operation.operation.id,
      locationId: merchant.locationId,
      processorType: config.processor_type,
    });
    result = await processor.chargeStoredCard(customerId, storedToken, {
      amount: amountCents,
      currency: (currency || 'USD').toLowerCase(),
      paymentToken: storedToken,
      description: chargeDescription,
      idempotencyKey: `ghl-charge-${transactionId}`,
    });
  } catch (err: any) {
    await moneyOperationService.markUnknown({
      id: operation.operation.id,
      locationId: merchant.locationId,
      processorType: config.processor_type,
      error: err.message || 'Processor result is unknown',
    });
    throw err;
  }

  const response = result.success ? {
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
  } : {
    success: false,
    failed: true,
    message: result.errorMessage || 'Payment failed',
  };

  if (!result.success) {
    await moneyOperationService.markRecorded({
      id: operation.operation.id,
      locationId: merchant.locationId,
      response,
      processorType: config.processor_type,
      processorReference: result.transactionId || null,
      providerCalled: true,
    });
    res.json(response);
    return;
  }

  await moneyOperationService.markProviderAccepted({
    id: operation.operation.id,
    locationId: merchant.locationId,
    processorType: config.processor_type,
    processorReference: result.chargeId || result.transactionId,
    response,
  });

  // Create transaction mapping
  const { error: mappingError } = await supabase.from('transaction_mappings').insert({
    merchant_id: merchant.merchantId,
    location_id: merchant.locationId,
    ghl_transaction_id: transactionId,
    processor_transaction_id: result.transactionId,
    processor_charge_id: result.chargeId || result.transactionId,
    processor_type: config.processor_type,
    contact_id: contactId,
  });
  if (mappingError) throw mappingError;

  await moneyOperationService.markRecorded({
    id: operation.operation.id,
    locationId: merchant.locationId,
    response,
    processorType: config.processor_type,
    processorReference: result.chargeId || result.transactionId,
    providerCalled: true,
  });
  res.json(response);
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
  const operationKey = isSafeProcessorReference(ghlSubId)
    ? ghlSubId
    : isSafeProcessorReference(ghlTxId) ? ghlTxId : '';
  if (!paymentMethodId || !contactId || !operationKey) {
    res.status(400).json({ success: false, failed: true, message: 'paymentMethodId, contactId, and subscriptionId or transactionId are required' });
    return;
  }
  if (!Number.isInteger(recurringCents) || recurringCents <= 0 || recurringCents > 99999999) {
    res.status(400).json({ success: false, failed: true, message: 'Invalid recurring amount' });
    return;
  }

  // Look up payment method
  const supabase = getSupabase();
  const { data: pm } = await supabase
    .from('payment_methods')
    .select('*')
    .eq('id', paymentMethodId)
    .eq('location_id', merchant.locationId)
    .eq('contact_id', contactId)
    .single();

  if (!pm) {
    res.json({ success: false, failed: true, message: 'Payment method not found' });
    return;
  }

  const customerId = pm.nmi_customer_vault_id || pm.stripe_customer_id || '';
  // #10: pass the processor's payment-method token (not the customer id) as paymentMethodId.
  const storedToken = pm.stripe_payment_method_id || pm.nmi_customer_vault_id || '';
  const { config } = await resolveProcessor(merchant.merchantId, merchant.locationId, {
    processor_override: pm.processor_type as 'nmi' | 'stripe',
    nmi_processor_id: null,
  });
  await assertNewProcessorActivityAllowed(merchant.locationId, config.processor_type);
  const processor = createProcessorClient(config);

  const operation = await moneyOperationService.begin({
    locationId: merchant.locationId,
    merchantId: merchant.merchantId,
    operationType: 'query_url_subscription',
    operationKey,
    request: {
      paymentMethodId,
      contactId,
      ghlSubId: ghlSubId || null,
      ghlTxId: ghlTxId || null,
      recurringCents,
      firstChargeCents,
      interval,
      totalCycles,
      startDate: startDate || null,
      processorType: config.processor_type,
    },
  });
  if (handleExistingOperation(operation, res)) return;

  let subResult;
  try {
    await moneyOperationService.markProviderStarted({
      id: operation.operation.id,
      locationId: merchant.locationId,
      processorType: config.processor_type,
    });
    subResult = await processor.createSubscription({
      paymentMethodId: storedToken,
      customerId,
      planAmount: recurringCents,
      interval,
      totalPayments: totalCycles,
      startDate,
      description: productDetails?.[0]?.name,
      idempotencyKey: `ghl-subscription-${operationKey}`,
    });
  } catch (err: any) {
    await moneyOperationService.markUnknown({
      id: operation.operation.id,
      locationId: merchant.locationId,
      processorType: config.processor_type,
      error: err.message || 'Processor result is unknown',
    });
    throw err;
  }

  if (!subResult.success) {
    const failureResponse = { success: false, failed: true, message: subResult.errorMessage || 'Subscription creation failed' };
    await moneyOperationService.markRecorded({
      id: operation.operation.id,
      locationId: merchant.locationId,
      response: failureResponse,
      processorType: config.processor_type,
      processorReference: subResult.subscriptionId || null,
      providerCalled: true,
    });
    res.json(failureResponse);
    return;
  }

  const now = nowUnix();
  const response = {
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
  };
  await moneyOperationService.markProviderAccepted({
    id: operation.operation.id,
    locationId: merchant.locationId,
    processorType: config.processor_type,
    processorReference: subResult.subscriptionId,
    response,
  });

  // Create transaction mapping
  const { error: mappingError } = await supabase.from('transaction_mappings').insert({
    merchant_id: merchant.merchantId,
    location_id: merchant.locationId,
    ghl_transaction_id: ghlTxId,
    ghl_subscription_id: ghlSubId,
    processor_subscription_id: subResult.subscriptionId,
    processor_type: config.processor_type,
    contact_id: contactId,
  });
  if (mappingError) throw mappingError;

  await moneyOperationService.markRecorded({
    id: operation.operation.id,
    locationId: merchant.locationId,
    response,
    processorType: config.processor_type,
    processorReference: subResult.subscriptionId,
    providerCalled: true,
  });
  res.json(response);
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

  const { config } = await resolveMappedProcessor(merchant, mapping.processor_type);
  const processor = createProcessorClient(config);

  await processor.cancelSubscription(mapping.processor_subscription_id);

  res.json({ status: 'canceled' });
}

// ─── refund ──────────────────────────────────────────────────

async function handleRefund(req: Request, res: Response, merchant: MerchantRef): Promise<void> {
  const { amount } = req.body;
  const refundReference = req.body.transactionId || req.body.chargeId;

  if (!isSafeProcessorReference(refundReference)) {
    res.status(400).json({ success: false, message: 'Invalid transaction reference' });
    return;
  }

  const amountWasProvided = amount !== undefined && amount !== null && amount !== '';
  const amountCents = amountWasProvided ? dollarsToCents(Number(amount)) : undefined;
  if (amountCents !== undefined && (!Number.isInteger(amountCents) || amountCents <= 0)) {
    res.status(400).json({ success: false, message: 'Invalid refund amount' });
    return;
  }

  // Look up processor transaction
  const supabase = getSupabase();
  const { data: mapping, error: mappingError } = await supabase
    .from('transaction_mappings')
    .select('processor_transaction_id, processor_type, contact_id')
    .or(`processor_charge_id.eq.${refundReference},processor_transaction_id.eq.${refundReference},ghl_transaction_id.eq.${refundReference}`)
    .eq('merchant_id', merchant.merchantId)
    .single();
  if (mappingError) throw mappingError;

  if (!mapping?.processor_transaction_id) {
    res.json({ success: false, message: 'Transaction not found for refund' });
    return;
  }

  const { data: originalPayment, error: originalPaymentError } = await supabase
    .from('payment_events')
    .select('id, amount')
    .eq('location_id', merchant.locationId)
    .eq('processor_transaction_id', mapping.processor_transaction_id)
    .in('event_type', REFUND_PAYMENT_EVENT_TYPES)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (originalPaymentError) throw originalPaymentError;
  if (!originalPayment) {
    res.status(409).json({
      success: false,
      message: 'The original payment ledger entry is missing; refund requires reconciliation before it can be submitted.',
    });
    return;
  }

  const requestFingerprint = moneyOperationService.fingerprint({
    source: QUERY_URL_REFUND_CLAIMED_BY,
    locationId: merchant.locationId,
    originalPaymentEventId: originalPayment.id,
    processorTransactionId: mapping.processor_transaction_id,
    refundReference,
    amountCents: amountCents === undefined ? 'remaining' : amountCents,
  });
  const existingClaim = await findQueryUrlRefundClaim(supabase, merchant.locationId, requestFingerprint);
  if (existingClaim) {
    handleExistingRefundClaim(existingClaim, res);
    return;
  }

  const { data: priorRefunds, error: priorRefundsError } = await supabase
    .from('payment_events')
    .select('amount')
    .eq('location_id', merchant.locationId)
    .in('event_type', REFUND_EVENT_TYPES)
    .eq('raw_webhook_payload->>original_processor_transaction_id', mapping.processor_transaction_id);
  if (priorRefundsError) throw priorRefundsError;

  const priorRefundCents = (priorRefunds || [])
    .reduce((sum: number, row: any) => sum + dollarsToCents(Math.abs(Number(row.amount || 0))), 0);
  const originalAmountCents = dollarsToCents(Number(originalPayment.amount || 0));
  const requestedAmountCents = amountCents === undefined
    ? originalAmountCents - priorRefundCents
    : amountCents;
  if (
    !Number.isInteger(requestedAmountCents)
    || requestedAmountCents <= 0
    || requestedAmountCents + priorRefundCents > originalAmountCents
  ) {
    res.status(400).json({
      success: false,
      message: 'Refund amount exceeds remaining refundable balance',
    });
    return;
  }

  const { data: insertedClaim, error: claimError } = await supabase
    .from('payment_refund_claims')
    .insert({
      location_id: merchant.locationId,
      original_payment_event_id: originalPayment.id,
      amount_cents: requestedAmountCents,
      status: 'processing',
      processor: mapping.processor_type || null,
      claimed_by: QUERY_URL_REFUND_CLAIMED_BY,
      request_fingerprint: requestFingerprint,
    })
    .select('id, amount_cents, status, processor_refund_id, refund_payment_event_id')
    .single();
  if (claimError) {
    if (claimError.code === '23505') {
      const concurrentClaim = await findQueryUrlRefundClaim(supabase, merchant.locationId, requestFingerprint);
      if (concurrentClaim) {
        handleExistingRefundClaim(concurrentClaim, res);
      } else {
        res.status(409).json({ success: false, message: 'Another refund for this payment is already processing.' });
      }
      return;
    }
    throw claimError;
  }
  if (!insertedClaim?.id) throw new Error('Refund claim could not be created');
  const claim = insertedClaim as QueryUrlRefundClaim;

  let config: Awaited<ReturnType<typeof resolveMappedProcessor>>['config'];
  let result: any;
  let providerStarted = false;
  try {
    ({ config } = await resolveMappedProcessor(merchant, mapping.processor_type));
    const processor = createProcessorClient(config);
    await updateQueryUrlRefundClaim(supabase, merchant.locationId, claim.id, {
      status: 'unknown',
      provider_called: true,
      provider_started_at: new Date().toISOString(),
      error_message: 'Processor refund request started; awaiting confirmed result.',
    }, true);
    providerStarted = true;
    result = await processor.refund({
      transactionId: mapping.processor_transaction_id,
      amount: requestedAmountCents,
      idempotencyKey: `refund:${merchant.locationId}:${claim.id}`,
    });
  } catch (err: any) {
    await updateQueryUrlRefundClaim(supabase, merchant.locationId, claim.id, providerStarted
      ? {
          status: 'unknown',
          error_message: err.message || 'Processor refund result is unknown',
        }
      : {
          status: 'failed',
          request_fingerprint: null,
          error_message: err.message || 'Refund failed before the processor request started',
        });
    throw err;
  }

  if (!result.success && result.status !== 'pending') {
    await updateQueryUrlRefundClaim(supabase, merchant.locationId, claim.id, {
      status: 'failed',
      request_fingerprint: null,
      error_message: result.errorMessage || 'Refund failed',
    });
    logger.warn({
      event: 'refund_failed',
      merchantId: merchant.merchantId,
      refundReference,
      error: result.errorMessage,
    }, 'Refund failed');
    res.json({
      success: false,
      message: result.errorMessage || 'Refund failed',
    });
    return;
  }

  const refundId = result.refundId || `${mapping.processor_transaction_id}:refund:${claim.id}`;
  const refundAmount = centsToDollars(requestedAmountCents);
  const response = {
    success: true,
    message: result.status === 'pending' ? 'Refund accepted and processing' : 'Refund successful',
    id: refundId,
    amount: refundAmount,
    currency: 'USD',
  };
  await updateQueryUrlRefundClaim(supabase, merchant.locationId, claim.id, {
    status: 'provider_accepted',
    provider_called: true,
    processor: config.processor_type,
    processor_refund_id: refundId,
    provider_accepted_at: new Date().toISOString(),
    error_message: null,
  });

  const { data: refundEvent, error: refundEventError } = await supabase
    .from('payment_events')
    .insert({
      merchant_id: merchant.merchantId,
      location_id: merchant.locationId,
      contact_id: mapping.contact_id || '',
      event_type: 'refund',
      processor: config.processor_type,
      processor_transaction_id: refundId,
      amount: refundAmount,
      currency: 'usd',
      source: 'query_url_refund',
      raw_webhook_payload: {
        original_payment_event_id: originalPayment.id,
        original_processor_transaction_id: mapping.processor_transaction_id,
        refund_claim_id: claim.id,
        transaction_id: req.body.transactionId || null,
        charge_id: req.body.chargeId || null,
        requested_amount: amountWasProvided ? Number(amount) : null,
        processor_refund_response: result.raw || null,
      },
      is_recurring: false,
    })
    .select('id')
    .single();

  let recordingIssue: string | undefined;
  if (refundEventError || !refundEvent?.id) {
    recordingIssue = 'Refund was accepted by the processor and is awaiting local reconciliation.';
    logger.error({
      err: refundEventError?.message || 'Refund event ID was not returned',
      claimId: claim.id,
      refundId,
      locationId: merchant.locationId,
    }, 'Query URL refund accepted but ledger insert failed');
  } else {
    try {
      await updateQueryUrlRefundClaim(supabase, merchant.locationId, claim.id, {
        status: 'recorded',
        refund_payment_event_id: refundEvent.id,
        recorded_at: new Date().toISOString(),
        error_message: null,
      });
    } catch (err: any) {
      recordingIssue = 'Refund was recorded and its reconciliation claim is still pending.';
      logger.error({ err: err.message, claimId: claim.id, refundId }, 'Query URL refund claim finalization failed');
    }
  }

  logger.info({
    event: 'refund_processed',
    merchantId: merchant.merchantId,
    locationId: merchant.locationId,
    refundId,
    amount: refundAmount,
    refundReference,
    recordingIssue,
    timestamp: new Date().toISOString(),
  }, 'Refund processed successfully');

  res.json({ ...response, recordingIssue });
}
