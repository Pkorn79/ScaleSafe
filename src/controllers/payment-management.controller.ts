import { Request, Response, NextFunction } from 'express';
import { getSupabase } from '../clients/supabase.client';
import { ghlApi } from '../clients/ghl.client';
import { resolveLocationId } from '../middleware/tenantContext';
import { resolveProcessor, createProcessorClient } from '../services/processor.factory';
import { paymentLedgerService } from '../services/payment-ledger.service';
import { paymentReconciliationService } from '../services/payment-reconciliation.service';
import { nmiRecurringRepairService } from '../services/nmi-recurring-repair.service';
import { nmiRecurringSyncService } from '../services/nmi-recurring-sync.service';
import { paymentLifecycleService } from '../services/payment-lifecycle.service';
import { collapseVisiblePaymentMethods } from '../services/payment-methods.service';
import { whopService } from '../services/whop.service';
import { triggerService } from '../services/trigger.service';
import { logger } from '../utils/logger';
import { cleanPostgrestLikeTerm, isSafeOrFilterSearchInput } from '../utils/search-input';
import { moneyOperationService } from '../services/money-operation.service';

function getMerchantId(req: Request): string {
  return (req as any).merchantId || '';
}

function cleanCardDisplay(card: {
  card_last_four?: string | null;
  card_brand?: string | null;
  card_exp_month?: number | null;
  card_exp_year?: number | null;
}) {
  const last4 = String(card.card_last_four || '').trim();
  const brand = String(card.card_brand || '').trim();
  const expMonth = Number(card.card_exp_month || 0);
  const expYear = Number(card.card_exp_year || 0);

  return {
    last4: /^\d{4}$/.test(last4) ? last4 : '',
    brand: brand && brand.toLowerCase() !== 'unknown' ? brand : '',
    expMonth: expMonth > 0 ? expMonth : null,
    expYear: expYear > 0 ? expYear : null,
  };
}

function isBankMethod(method: any): boolean {
  return method?.payment_method_kind === 'ach'
    || !!method?.bank_last_four
    || String(method?.card_brand || '').toLowerCase() === 'bank';
}

function processorLabel(processor?: string | null): string {
  const value = String(processor || '').toLowerCase();
  if (value === 'nmi') return 'NMI';
  if (value === 'stripe') return 'Stripe';
  if (value === 'ghl') return 'GHL';
  if (value === 'whop') return 'Whop';
  return processor || 'Unknown';
}

function paymentMethodLabel(method: any) {
  if (isBankMethod(method)) {
    const processor = processorLabel(method.processor_type);
    const last4 = String(method.bank_last_four || method.card_last_four || '').trim();
    const ending = /^\d{4}$/.test(last4) ? ` ending in ${last4}` : '';
    return `${processor} bank account${ending}`.trim();
  }
  const display = cleanCardDisplay(method);
  const processor = processorLabel(method.processor_type);
  const brand = display.brand || 'card on file';
  const ending = display.last4 ? ` ending in ${display.last4}` : '';
  return `${processor} ${brand}${ending}`.trim();
}

function paymentMethodDetail(method: any) {
  if (isBankMethod(method)) {
    const pieces: string[] = [];
    if (method.bank_account_type) pieces.push(String(method.bank_account_type));
    if (method.bank_holder_type) pieces.push(String(method.bank_holder_type));
    if (method.processor_type === 'nmi' && method.nmi_customer_vault_id) pieces.push(`NMI vault ${method.nmi_customer_vault_id}`);
    if (method.processor_type === 'stripe' && method.stripe_payment_method_id) pieces.push(`Stripe PM ${method.stripe_payment_method_id}`);
    else if (method.processor_type === 'stripe' && method.stripe_customer_id) pieces.push(`Stripe customer ${method.stripe_customer_id}`);
    return pieces.join(' - ');
  }
  const display = cleanCardDisplay(method);
  const pieces: string[] = [];
  if (display.expMonth && display.expYear) pieces.push(`exp ${display.expMonth}/${display.expYear}`);
  if (method.processor_type === 'nmi' && method.nmi_customer_vault_id) pieces.push(`NMI vault ${method.nmi_customer_vault_id}`);
  if (method.processor_type === 'stripe' && method.stripe_payment_method_id) pieces.push(`Stripe PM ${method.stripe_payment_method_id}`);
  else if (method.processor_type === 'stripe' && method.stripe_customer_id) pieces.push(`Stripe customer ${method.stripe_customer_id}`);
  return pieces.join(' - ');
}

function formatMoney(value: unknown): string {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? `$${amount.toFixed(2)}` : String(value || '');
}

async function fireManualChargeFailedTrigger(params: {
  locationId: string;
  contactId: string;
  amount: number;
  failureReason?: string | null;
  transactionId?: string | null;
}): Promise<void> {
  try {
    const amountDisplay = formatMoney(params.amount);
    await triggerService.fireTrigger(params.locationId, 'ss_payment_failed', {
      event_type: 'payment_failed',
      location_id: params.locationId,
      locationId: params.locationId,
      contact_id: params.contactId,
      contactId: params.contactId,
      amount: params.amount,
      amount_display: amountDisplay,
      amountDisplay,
      failure_reason: params.failureReason || 'Manual saved-card charge failed',
      failureReason: params.failureReason || 'Manual saved-card charge failed',
      attempt_count: 1,
      attemptCount: 1,
      next_retry_date: 'none',
      nextRetryDate: 'none',
      dunning_stage: 'initial',
      dunningStage: 'initial',
      payment_source: 'manual_charge',
      paymentSource: 'manual_charge',
      transaction_id: params.transactionId || '',
      transactionId: params.transactionId || '',
    });
  } catch (err: any) {
    logger.warn(
      { err: err?.message || String(err), contactId: params.contactId, locationId: params.locationId },
      'Manual saved-card failed-payment trigger failed',
    );
  }
}

const REFUNDABLE_EVENT_TYPES = new Set(['sale', 'payment_success', 'subscription_payment', 'capture']);

function dollarsToCents(value: number): number {
  return Math.round(Number(value || 0) * 100);
}

function isSafePaymentAttemptId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]{8,128}$/.test(value);
}

function isRefundLinkedToPayment(refund: any, originalEvent: any, paymentEventId: string): boolean {
  const raw = refund?.raw_webhook_payload || {};
  return raw.original_payment_event_id === paymentEventId
    || raw.original_processor_transaction_id === originalEvent.processor_transaction_id;
}

function isUniqueViolation(error: any): boolean {
  return error?.code === '23505';
}

async function updateRefundClaim(
  supabase: ReturnType<typeof getSupabase>,
  claimId: string | null,
  updates: Record<string, unknown>,
): Promise<void> {
  if (!claimId) return;
  const { error } = await supabase
    .from('payment_refund_claims')
    .update(updates)
    .eq('id', claimId);
  if (error) {
    logger.error({ err: error.message, claimId }, 'Refund claim status update failed');
    throw error;
  }
}

async function markRefundClaimProviderAcceptedIfUnrecorded(
  supabase: ReturnType<typeof getSupabase>,
  claimId: string,
  updates: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase
    .from('payment_refund_claims')
    .update(updates)
    .eq('id', claimId)
    .is('refund_payment_event_id', null);
  if (error) {
    logger.error({ err: error.message, claimId }, 'Refund claim provider-accepted update failed');
    throw error;
  }
}

async function findWhopRefundEventForPayment(
  supabase: ReturnType<typeof getSupabase>,
  locationId: string,
  originalEvent: any,
): Promise<any | null> {
  let query: any = supabase
    .from('payment_events')
    .select('id, processor_transaction_id, raw_webhook_payload')
    .eq('location_id', locationId)
    .eq('processor', 'whop')
    .eq('event_type', 'refund');
  if (originalEvent.contact_id) query = query.eq('contact_id', originalEvent.contact_id);
  const { data, error } = await query.limit(200);
  if (error) throw error;
  return (data || []).find((refund: any) => isRefundLinkedToPayment(refund, originalEvent, originalEvent.id)) || null;
}

async function resolveMerchantId(locationId: string): Promise<string> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from('merchants')
    .select('id')
    .eq('location_id', locationId)
    .single();
  return data?.id || '';
}

// GET /api/payments/customers

export async function searchCustomers(req: Request, res: Response, next: NextFunction) {
  try {
    const locationId = resolveLocationId(req);
    const search = (req.query.search as string || '').trim();
    if (search && !isSafeOrFilterSearchInput(search)) {
      res.status(400).json({ error: 'Invalid search value' });
      return;
    }

    const supabase = getSupabase();
    const loweredSearch = search.toLowerCase();

    const shouldEnrichFromGhl = loweredSearch.length >= 3;

    // Load payment-customer mappings for this tenant.
    let query = supabase
      .from('payment_customer_map')
      .select('contact_id, program_name, customer_id, created_at')
      .eq('location_id', locationId)
      .order('created_at', { ascending: false });

    if (search) {
      const escaped = cleanPostgrestLikeTerm(search);
      query = query.or(`program_name.ilike.%${escaped}%,contact_id.ilike.%${escaped}%,customer_id.ilike.%${escaped}%`);
    }

    query = query.limit(shouldEnrichFromGhl ? 60 : 25);

    const { data: maps, error } = await query;
    if (error) throw error;

    const contactIdSet = new Set<string>((maps || []).map(m => m.contact_id).filter(Boolean));

    if (search) {
      const escaped = cleanPostgrestLikeTerm(search);
      const [matchingEnrollments, matchingPaymentEvents] = await Promise.allSettled([
        supabase
          .from('enrollments')
          .select('contact_id')
          .eq('location_id', locationId)
          .or(`first_name.ilike.%${escaped}%,last_name.ilike.%${escaped}%,email.ilike.%${escaped}%,digital_signature.ilike.%${escaped}%,contact_id.ilike.%${escaped}%`)
          .limit(100),
        supabase
          .from('payment_events')
          .select('contact_id')
          .eq('location_id', locationId)
          .or(`customer_email.ilike.%${escaped}%,contact_id.ilike.%${escaped}%`)
          .limit(100),
      ]);

      if (matchingEnrollments.status === 'fulfilled') {
        for (const row of matchingEnrollments.value.data || []) {
          if (row.contact_id) contactIdSet.add(row.contact_id);
        }
      }
      if (matchingPaymentEvents.status === 'fulfilled') {
        for (const row of matchingPaymentEvents.value.data || []) {
          if (row.contact_id) contactIdSet.add(row.contact_id);
        }
      }
    }

    // Get unique contact IDs from payment records and searchable enrollment/payment profiles.
    let contactIds = [...contactIdSet];

    // Fallback: if no results from payment_customer_map, check payment_events directly
    if (contactIds.length === 0) {
      const { data: fallbackEvents } = await supabase
        .from('payment_events')
        .select('contact_id')
        .eq('location_id', locationId)
        .not('contact_id', 'eq', '')
        .not('contact_id', 'is', null)
        .limit(50);
      contactIds = [...new Set((fallbackEvents || []).map(e => e.contact_id).filter(Boolean))];
    }

    if (contactIds.length === 0) {
      res.json({ customers: [] });
      return;
    }

    // Enrich from enrollments table (always available, no API call)
    const { data: enrollmentProfiles } = await supabase
      .from('enrollments')
      .select('contact_id, email, offer_id, first_name, last_name, digital_signature')
      .eq('location_id', locationId)
      .in('contact_id', contactIds);

    const enrollmentMap: Record<string, { name: string; email: string }> = {};
    for (const ep of (enrollmentProfiles || [])) {
      if (ep.contact_id) {
        // Name priority: first_name/last_name → digital_signature → empty
        let name = '';
        const first = ((ep as any).first_name || '').trim();
        const last = ((ep as any).last_name || '').trim();
        if (first) {
          name = `${first} ${last}`.trim();
        } else if ((ep as any).digital_signature) {
          name = (ep as any).digital_signature;
        }
        // Only overwrite if we have better data
        if (!enrollmentMap[ep.contact_id] || name) {
          enrollmentMap[ep.contact_id] = {
            name: name || enrollmentMap[ep.contact_id]?.name || '',
            email: ep.email || enrollmentMap[ep.contact_id]?.email || '',
          };
        }
      }
    }

    // Also check payment_events for contact emails
    const { data: emailEvents } = await supabase
      .from('payment_events')
      .select('contact_id, customer_email')
      .eq('location_id', locationId)
      .in('contact_id', contactIds)
      .not('customer_email', 'is', null);

    for (const ev of (emailEvents || [])) {
      if (ev.contact_id && (ev as any).customer_email && !enrollmentMap[ev.contact_id]?.email) {
        if (!enrollmentMap[ev.contact_id]) enrollmentMap[ev.contact_id] = { name: '', email: '' };
        enrollmentMap[ev.contact_id].email = (ev as any).customer_email;
      }
    }

    const contactProfiles: Record<string, { name: string; email: string }> = {};
    if (shouldEnrichFromGhl) {
      // Enrich with live GHL profile to support name/email matches.
      try {
        const api = await ghlApi(locationId);
        await Promise.all(contactIds.map(async (cid) => {
          try {
            const response = await api.get(`/contacts/${cid}`);
            const contact = response.data?.contact || response.data || {};
            const first = String(contact.firstName || '').trim();
            const last = String(contact.lastName || '').trim();
            const looksLikeEmail = first.includes('_') || first.includes('@') || first.includes('.');
            // If GHL firstName is email-prefix, prefer enrollment name
            const enrollName = enrollmentMap[cid]?.name || '';
            const fullName = (looksLikeEmail && enrollName) ? enrollName : `${first} ${last}`.trim();

            contactProfiles[cid] = {
              name: fullName || String(contact.name || ''),
              email: String(contact.email || '').trim(),
            };
          } catch {
            contactProfiles[cid] = { name: '', email: '' };
          }
        }));
      } catch {
        // GHL API unavailable: fall through to enrollment data.
      }
    }

    // Aggregate payment totals per contact
    const { data: events } = await supabase
      .from('payment_events')
      .select('contact_id, amount, event_type, created_at')
      .eq('location_id', locationId)
      .in('contact_id', contactIds);

    const totals: Record<string, { charged: number; refunded: number; name: string; email: string; lastPaymentDate: string }> = {};
    for (const cid of contactIds) {
      const map = maps!.find(m => m.contact_id === cid);
      const ghlName = contactProfiles[cid]?.name || '';
      const enrollName = enrollmentMap[cid]?.name || '';
      const ghlEmail = contactProfiles[cid]?.email || '';
      const enrollEmail = enrollmentMap[cid]?.email || '';
      totals[cid] = {
        charged: 0,
        refunded: 0,
        name: ghlName || enrollName || map?.program_name || '',
        email: ghlEmail || enrollEmail || '',
        lastPaymentDate: '',
      };
    }

    for (const ev of (events || [])) {
      if (!totals[ev.contact_id]) continue;
      if (ev.event_type === 'refund') {
        totals[ev.contact_id].refunded += Number(ev.amount) || 0;
      } else if (['sale', 'payment_success', 'subscription_payment', 'capture'].includes(String(ev.event_type || '').toLowerCase())) {
        totals[ev.contact_id].charged += Number(ev.amount) || 0;
      }
      // Track most recent payment date
      if (ev.created_at && (!totals[ev.contact_id].lastPaymentDate || ev.created_at > totals[ev.contact_id].lastPaymentDate)) {
        totals[ev.contact_id].lastPaymentDate = ev.created_at;
      }
    }

    const customers = contactIds.map((cid) => {
      const t = totals[cid];
      const displayName = t.name || (t.email ? t.email.split('@')[0] : '');
      return {
        contactId: cid,
        name: displayName,
        email: t.email,
        totalCharged: t.charged,
        totalRefunded: t.refunded,
        lastPaymentDate: t.lastPaymentDate || null,
        programName: maps!.find(m => m.contact_id === cid)?.program_name || '',
      };
    })
      .filter(c => {
        if (!search) return true;
        const name = c.name.toLowerCase();
        const email = (c.email || '').toLowerCase();
        const contactId = String(c.contactId || '').toLowerCase();
        return name.includes(loweredSearch) || email.includes(loweredSearch) || contactId.includes(loweredSearch);
      })
      .slice(0, 25);

    res.json({ customers });
  } catch (err) { next(err); }
}

// GET /api/payments/manage/ledger

export async function listPaymentLedger(req: Request, res: Response, next: NextFunction) {
  try {
    const locationId = resolveLocationId(req);
    const search = (req.query.search as string || '').trim();
    if (search && !isSafeOrFilterSearchInput(search)) {
      res.status(400).json({ error: 'Invalid search value' });
      return;
    }

    const result = await paymentLedgerService.list(locationId, {
      search,
      trackingId: (req.query.trackingId as string) || '',
      processor: (req.query.processor as string) || '',
      paymentType: (req.query.paymentType as string) || '',
      eventType: (req.query.eventType as string) || '',
      status: (req.query.status as string) || '',
      from: (req.query.from as string) || '',
      to: (req.query.to as string) || '',
      limit: Number(req.query.limit || 50),
      offset: Number(req.query.offset || 0),
    });

    res.json(result);
  } catch (err: any) {
    logger.error({ err: err?.message, code: err?.code }, 'Payment ledger failed');
    res.status(500).json({
      message: err?.message ? `Unable to load payment ledger: ${err.message}` : 'Unable to load payment ledger',
    });
  }
}

// ─── GET /api/payments/manage/reconciliation ─────────────────────

export async function getPaymentReconciliation(req: Request, res: Response, next: NextFunction) {
  try {
    const locationId = resolveLocationId(req);
    const result = await paymentReconciliationService.report(locationId, {
      lookbackDays: Number(req.query.days || 30),
    });

    res.json(result);
  } catch (err: any) {
    logger.error({ err: err?.message, code: err?.code }, 'Payment reconciliation failed');
    res.status(500).json({
      message: err?.message ? `Unable to load payment reconciliation: ${err.message}` : 'Unable to load payment reconciliation',
    });
  }
}

// ─── GET /api/payments/customer/:contactId ──────────────────────

export async function getNmiRecurringDiagnostics(req: Request, res: Response, next: NextFunction) {
  try {
    const locationId = resolveLocationId(req);
    const result = await nmiRecurringSyncService.diagnostics(locationId);
    res.json(result);
  } catch (err: any) {
    logger.error({ err: err?.message, code: err?.code }, 'NMI recurring diagnostics failed');
    res.status(500).json({
      message: err?.message ? `Unable to load NMI diagnostics: ${err.message}` : 'Unable to load NMI diagnostics',
    });
  }
}

function safeTracePayload(payload: any): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object') return null;
  return {
    event_type: payload.event_type || payload.eventType || payload.event_body?.event_type || null,
    transaction_id: payload.transaction_id || payload.transactionid || payload.event_body?.transaction_id || null,
    subscription_id: payload.subscription_id || payload.subscriptionid || payload.event_body?.subscription_id || null,
    enrollment_id: payload.enrollment_id || payload.event_body?.merchant_defined_fields?.enrollment_id || null,
    source: payload.source || payload.event_body?.source || payload.event_body?.action?.source || null,
    amount: payload.amount || payload.event_body?.amount || payload.event_body?.action?.amount || null,
    keys: Object.keys(payload).sort(),
  };
}

function cleanTraceId(value: unknown): string {
  const raw = String(value || '').trim();
  return /^[A-Za-z0-9_.:-]{1,120}$/.test(raw) ? raw : '';
}

function traceMatchesFilters(payload: Record<string, unknown> | null, filters: { subscriptionId: string; transactionId: string; enrollmentId: string }): boolean {
  if (!payload) return false;
  if (filters.subscriptionId && payload.subscription_id === filters.subscriptionId) return true;
  if (filters.transactionId && payload.transaction_id === filters.transactionId) return true;
  if (filters.enrollmentId && payload.enrollment_id === filters.enrollmentId) return true;
  return !filters.subscriptionId && !filters.transactionId && !filters.enrollmentId;
}

function buildNmiTraceSummary(input: {
  logs: any[];
  payments: any[];
  receiptTriggers: any[];
}): { received: boolean; matched: boolean; recorded: boolean; receiptSent: boolean; issue: string } {
  const received = input.logs.length > 0;
  const matched = input.logs.some((log: any) => log.matched === true || Boolean(log.payment_event_id));
  const recorded = input.payments.length > 0 || input.logs.some((log: any) => Boolean(log.payment_event_id));
  const receiptSent = input.receiptTriggers.some((trigger: any) => trigger.status === 'sent' || trigger.status === 'delivered');

  let issue = 'No NMI webhook has been received for this subscription/enrollment yet.';
  if (received && !matched) issue = 'NMI webhook was received, but ScaleSafe did not match it to this enrollment.';
  else if (matched && !recorded) issue = 'NMI webhook matched, but no ScaleSafe payment record was found.';
  else if (recorded && !receiptSent) issue = 'Payment was recorded, but no matching payment receipt trigger was found.';
  else if (recorded && receiptSent) issue = 'Webhook was received, matched, recorded, and the receipt trigger was sent.';

  return { received, matched, recorded, receiptSent, issue };
}

export async function getNmiWebhookTrace(req: Request, res: Response, next: NextFunction) {
  try {
    const locationId = resolveLocationId(req);
    const subscriptionId = cleanTraceId(req.query.subscriptionId);
    const transactionId = cleanTraceId(req.query.transactionId);
    const enrollmentId = cleanTraceId(req.query.enrollmentId);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));
    const supabase = getSupabase();

    let logsQuery: any = supabase
      .from('nmi_silent_post_logs')
      .select('id, created_at, webhook_kind, event_id, event_type, enrollment_id, processor_subscription_id, transaction_id, amount, response_code, response_text, matched, duplicate, verification_status, action, error_message, payment_event_id, signature_verified, raw_keys')
      .eq('location_id', locationId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (subscriptionId) logsQuery = logsQuery.eq('processor_subscription_id', subscriptionId);
    if (transactionId) logsQuery = logsQuery.eq('transaction_id', transactionId);
    if (enrollmentId) logsQuery = logsQuery.eq('enrollment_id', enrollmentId);

    let paymentsQuery: any = supabase
      .from('payment_events')
      .select('id, created_at, contact_id, enrollment_id, event_type, processor, processor_transaction_id, processor_subscription_id, amount, currency, source, payment_number, payments_total, payments_remaining, failure_reason, raw_webhook_payload')
      .eq('location_id', locationId)
      .eq('processor', 'nmi')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (subscriptionId) paymentsQuery = paymentsQuery.eq('processor_subscription_id', subscriptionId);
    if (transactionId) paymentsQuery = paymentsQuery.eq('processor_transaction_id', transactionId);
    if (enrollmentId) paymentsQuery = paymentsQuery.eq('enrollment_id', enrollmentId);

    let enrollmentsQuery: any = supabase
      .from('enrollments')
      .select('id, contact_id, email, offer_id, status, payment_type, processor_type, processor_subscription_id, payments_made, payments_total, next_billing_date, billing_completed_at')
      .eq('location_id', locationId)
      .eq('processor_type', 'nmi')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (subscriptionId) enrollmentsQuery = enrollmentsQuery.eq('processor_subscription_id', subscriptionId);
    if (enrollmentId) enrollmentsQuery = enrollmentsQuery.eq('id', enrollmentId);

    const [{ data: logs, error: logsError }, { data: payments, error: paymentsError }, { data: enrollments, error: enrollmentsError }, { data: triggers, error: triggersError }] = await Promise.all([
      logsQuery,
      paymentsQuery,
      enrollmentsQuery,
      supabase
        .from('trigger_delivery_logs')
        .select('id, created_at, trigger_key, status, http_status, attempt_count, error_message, payload')
        .eq('location_id', locationId)
        .eq('trigger_key', 'ss_payment_received')
        .order('created_at', { ascending: false })
        .limit(100),
    ]);

    if (logsError) throw logsError;
    if (paymentsError) throw paymentsError;
    if (enrollmentsError) throw enrollmentsError;
    if (triggersError) throw triggersError;

    const filters = { subscriptionId, transactionId, enrollmentId, limit };
    const receiptTriggers = (triggers || [])
      .map((row: any) => ({
        id: row.id,
        created_at: row.created_at,
        trigger_key: row.trigger_key,
        status: row.status,
        http_status: row.http_status,
        attempt_count: row.attempt_count,
        error_message: row.error_message,
        payload: safeTracePayload(row.payload),
      }))
      .filter((row: any) => traceMatchesFilters(row.payload, filters));

    const safePayments = (payments || []).map((row: any) => ({
      ...row,
      raw_webhook_payload: safeTracePayload(row.raw_webhook_payload),
    }));

    res.json({
      filters: { subscriptionId, transactionId, enrollmentId, limit },
      summary: buildNmiTraceSummary({
        logs: logs || [],
        payments: safePayments,
        receiptTriggers,
      }),
      logs: logs || [],
      payments: safePayments,
      enrollments: enrollments || [],
      receiptTriggers,
    });
  } catch (err: any) {
    logger.error({ err: err?.message, code: err?.code }, 'NMI webhook trace failed');
    res.status(500).json({
      message: err?.message ? `Unable to load NMI webhook trace: ${err.message}` : 'Unable to load NMI webhook trace',
    });
  }
}

export async function syncNmiRecurringHistory(req: Request, res: Response, next: NextFunction) {
  try {
    const locationId = resolveLocationId(req);
    const enrollmentId = String(req.body?.enrollmentId || '').trim();
    const result = enrollmentId
      ? await nmiRecurringSyncService.syncEnrollment(locationId, enrollmentId)
      : await nmiRecurringSyncService.syncDueEnrollments(locationId);
    res.json(result);
  } catch (err: any) {
    logger.error({ err: err?.message }, 'NMI recurring history sync failed');
    res.status(500).json({ error: err?.message || 'NMI recurring history sync failed' });
  }
}

export async function repairNmiRecurringPayment(req: Request, res: Response, next: NextFunction) {
  try {
    const locationId = resolveLocationId(req);
    const merchantId = getMerchantId(req) || await resolveMerchantId(locationId);
    const subscriptionId = String(req.body?.subscriptionId || req.body?.referenceId || '').trim();
    const transactionId = String(req.body?.transactionId || '').trim();

    if (!subscriptionId || !transactionId) {
      res.status(400).json({ error: 'subscriptionId and transactionId are required' });
      return;
    }

    const result = await nmiRecurringRepairService.repairMissedPayment({
      locationId,
      merchantId,
      subscriptionId,
      transactionId,
    });

    res.json(result);
  } catch (err: any) {
    logger.error({ err: err?.message }, 'NMI recurring repair failed');
    res.status(500).json({ error: err?.message || 'NMI recurring repair failed' });
  }
}

export async function getPaymentHistory(req: Request, res: Response, next: NextFunction) {
  try {
    const locationId = resolveLocationId(req);
    const { contactId } = req.params;
    const result = await paymentLedgerService.list(locationId, {
      contactId,
      limit: 200,
      offset: 0,
    });

    const payments = result.payments.map(payment => ({
      ...payment,
      status: payment.status === 'failed' ? 'failed' : 'success',
      transactionId: payment.processorTransactionId,
      dunningStatus: payment.dunningStatus || null,
      dunningRetryCount: payment.dunningRetryCount || 0,
      dunningNextRetry: payment.dunningNextRetry || null,
    }));

    res.json({
      payments,
      totalCharged: result.summary.totalCharged,
      totalRefunded: result.summary.totalRefunded,
    });
  } catch (err) { next(err); }
}

// ─── GET /api/payments/customer/:contactId/methods ──────────────

export async function getPaymentMethods(req: Request, res: Response, next: NextFunction) {
  try {
    const locationId = resolveLocationId(req);
    const { contactId } = req.params;
    const supabase = getSupabase();

    const { data: methods, error } = await supabase
      .from('payment_methods')
      .select('*')
      .eq('location_id', locationId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const { visible, hiddenCount } = collapseVisiblePaymentMethods(methods || []);
    const result = visible.map(m => {
      const display = cleanCardDisplay(m);
      return {
        id: m.id,
        ...display,
        isDefault: m.is_default,
        processorType: m.processor_type,
        processorLabel: processorLabel(m.processor_type),
        paymentMethodKind: m.payment_method_kind || (isBankMethod(m) ? 'ach' : 'card'),
        bankLastFour: m.bank_last_four || null,
        bankAccountType: m.bank_account_type || null,
        bankHolderType: m.bank_holder_type || null,
        displayLabel: paymentMethodLabel(m),
        detailLabel: paymentMethodDetail(m),
        processorReference: m.nmi_customer_vault_id || m.stripe_payment_method_id || m.stripe_customer_id || '',
        customerId: m.nmi_customer_vault_id || m.stripe_customer_id,
        paymentMethodId: m.stripe_payment_method_id,
        hiddenDuplicateCount: m.hidden_duplicate_count || 0,
      };
    });

    res.json({ methods: result, hiddenMethodCount: hiddenCount });
  } catch (err) { next(err); }
}

// ─── POST /api/payments/charge ──────────────────────────────────

export async function chargeStoredCard(req: Request, res: Response, next: NextFunction) {
  try {
    const locationId = resolveLocationId(req);
    const merchantId = getMerchantId(req) || await resolveMerchantId(locationId);
    const { contactId, paymentMethodId, amount, description } = req.body;
    const paymentAttemptId = req.body.paymentAttemptId || req.body.idempotencyKey;

    if (!contactId || !paymentMethodId || amount === undefined || amount === null) {
      res.status(400).json({ error: 'contactId, paymentMethodId, and amount are required' });
      return;
    }

    const amountCents = dollarsToCents(amount);
    if (typeof amount !== 'number' || !Number.isInteger(amountCents) || amountCents <= 0 || amountCents > 99999999) {
      res.status(400).json({ error: 'Amount must be a positive number' });
      return;
    }
    if (!isSafePaymentAttemptId(paymentAttemptId)) {
      res.status(400).json({ error: 'A stable paymentAttemptId is required for this charge' });
      return;
    }

    const supabase = getSupabase();

    // Look up saved payment method
    const { data: method, error: methodError } = await supabase
      .from('payment_methods')
      .select('*')
      .eq('id', paymentMethodId)
      .eq('location_id', locationId)
      .eq('contact_id', contactId)
      .maybeSingle();
    if (methodError) throw methodError;

    if (!method) {
      res.status(404).json({ error: 'Payment method not found' });
      return;
    }

    const { config: procConfig } = await resolveProcessor(merchantId, locationId, {
      processor_override: method.processor_type || null,
      nmi_processor_id: null,
    });
    const processor = createProcessorClient(procConfig);

    // #9: charge the saved card via chargeStoredCard (customerId + paymentMethodId), not
    // charge() with a vault id in paymentToken; the latter fails on both NMI and Stripe.
    const customerId = method.nmi_customer_vault_id || method.stripe_customer_id || '';
    const storedPaymentMethodId = method.stripe_payment_method_id || method.nmi_customer_vault_id || '';
    if (!customerId || !storedPaymentMethodId) {
      res.status(400).json({ error: 'Saved payment method is missing its processor reference' });
      return;
    }

    const operation = await moneyOperationService.begin({
      locationId,
      merchantId,
      operationType: 'manual_sale_charge',
      operationKey: `payment-management:${paymentAttemptId}`,
      request: {
        paymentAttemptId,
        contactId,
        paymentMethodId,
        amountCents,
        currency: 'usd',
        paymentMethod: 'card',
        description: description || 'One-time charge',
        processorType: procConfig.processor_type,
        source: 'payment_management',
      },
    });
    if (operation.action === 'replay') {
      res.json(operation.response);
      return;
    }
    if (operation.action === 'blocked') {
      res.status(409).json({
        success: false,
        error: 'This charge is already processing or requires reconciliation.',
      });
      return;
    }

    let result: any;
    let providerStarted = false;
    try {
      await moneyOperationService.markProviderStarted({
        id: operation.operation.id,
        locationId,
        processorType: procConfig.processor_type,
      });
      providerStarted = true;
      result = await processor.chargeStoredCard(customerId, storedPaymentMethodId, {
        amount: amountCents,
        currency: 'usd',
        paymentToken: storedPaymentMethodId,
        description: description || 'One-time charge',
        metadata: {
          contact_id: contactId,
          source: 'payment_management',
          money_operation_id: operation.operation.id,
        },
        idempotencyKey: `payment-management-${operation.operation.id}`,
      });
    } catch (err: any) {
      const message = err?.message || 'Saved payment method charge failed';
      logger.warn(
        { err: message, contactId, locationId, processor: procConfig.processor_type },
        'Manual saved-card charge result is unknown',
      );
      if (providerStarted) {
        await moneyOperationService.markUnknown({
          id: operation.operation.id,
          locationId,
          processorType: procConfig.processor_type,
          error: message,
        });
      }
      throw err;
    }

    const processorReference = result.transactionId || result.chargeId || null;
    const clientChargeId = result.chargeId || result.transactionId || null;
    const response = result.success
      ? { success: true, chargeId: clientChargeId }
      : { success: false, chargeId: clientChargeId, error: result.errorMessage || 'Saved payment method charge failed' };

    if (!result.success) {
      const { error: failureLedgerError } = await supabase.from('payment_events').insert({
        merchant_id: merchantId,
        location_id: locationId,
        contact_id: contactId,
        event_type: 'payment_failed',
        processor: procConfig.processor_type,
        processor_transaction_id: processorReference,
        amount,
        currency: 'usd',
        payment_status: 'failed',
        failure_reason: result.errorMessage || 'Saved payment method charge failed',
        source: 'manual_charge',
        is_recurring: false,
        raw_webhook_payload: { money_operation_id: operation.operation.id },
      });
      const failureResponse = failureLedgerError
        ? { ...response, recordingIssue: 'The failed charge could not be written to the payment ledger.' }
        : response;
      if (failureLedgerError) {
        logger.error({ err: failureLedgerError.message, operationId: operation.operation.id }, 'Failed saved-card charge ledger insert failed');
      }
      await moneyOperationService.markRecorded({
        id: operation.operation.id,
        locationId,
        response: failureResponse,
        processorType: procConfig.processor_type,
        processorReference,
        providerCalled: true,
      });
      await fireManualChargeFailedTrigger({
        locationId,
        contactId,
        amount,
        failureReason: result.errorMessage || 'Saved payment method charge failed',
        transactionId: processorReference,
      });
      logger.info({ contactId, amount, success: false }, 'Manual charge processed');
      res.json(failureResponse);
      return;
    }

    if (!processorReference) {
      await moneyOperationService.markUnknown({
        id: operation.operation.id,
        locationId,
        processorType: procConfig.processor_type,
        error: 'Processor approved the charge without returning a transaction reference',
      });
      res.status(502).json({
        success: false,
        error: 'Charge was submitted, but its processor reference is missing. Contact support before retrying.',
      });
      return;
    }

    try {
      await moneyOperationService.markProviderAccepted({
        id: operation.operation.id,
        locationId,
        processorType: procConfig.processor_type,
        processorReference,
        response,
        reconciliationPayload: {
          contactId,
          chargeId: clientChargeId,
          status: 'succeeded',
          clientResponse: response,
        },
      });
    } catch (acceptError: any) {
      logger.error({ err: acceptError.message, operationId: operation.operation.id, processorReference }, 'Saved-card charge accepted but durable acceptance update failed');
      res.status(202).json({
        ...response,
        recordingIssue: 'Charge succeeded, but its local reconciliation record could not be updated. Contact support before retrying.',
      });
      return;
    }

    let { data: paymentEvent, error: paymentEventError } = await supabase.from('payment_events').insert({
      merchant_id: merchantId,
      location_id: locationId,
      contact_id: contactId,
      event_type: 'sale',
      processor: procConfig.processor_type,
      processor_transaction_id: processorReference,
      amount,
      currency: 'usd',
      payment_status: 'succeeded',
      failure_reason: null,
      source: 'manual_charge',
      is_recurring: false,
      payment_method_type: 'card',
      selected_payment_method: 'card',
      raw_webhook_payload: { money_operation_id: operation.operation.id },
    }).select('id').single();

    if (paymentEventError?.code === '23505') {
      const existing = await supabase
        .from('payment_events')
        .select('id')
        .eq('location_id', locationId)
        .eq('processor', procConfig.processor_type)
        .eq('processor_transaction_id', processorReference)
        .maybeSingle();
      paymentEvent = existing.data;
      paymentEventError = existing.error || (existing.data ? null : paymentEventError);
    }

    let recordingIssue: string | undefined;
    if (paymentEventError || !paymentEvent?.id) {
      recordingIssue = 'Charge succeeded and is awaiting local ledger reconciliation.';
      logger.error({
        err: paymentEventError?.message || 'Payment event ID was not returned',
        operationId: operation.operation.id,
        processorReference,
      }, 'Saved-card charge accepted but payment ledger insert failed');
    } else {
      try {
        await moneyOperationService.markRecorded({
          id: operation.operation.id,
          locationId,
          response: { ...response, paymentEventId: paymentEvent.id },
          processorType: procConfig.processor_type,
          processorReference,
          providerCalled: true,
        });
      } catch (recordError: any) {
        recordingIssue = 'Charge was recorded in the payment ledger and its reconciliation status is still pending.';
        logger.error({ err: recordError.message, operationId: operation.operation.id, processorReference }, 'Saved-card money operation finalization failed');
      }
    }

    logger.info({ contactId, amount, success: true, recordingIssue }, 'Manual charge processed');
    res.json({ ...response, paymentEventId: paymentEvent?.id || null, recordingIssue });
  } catch (err) { next(err); }
}

// ─── POST /api/payments/refund ──────────────────────────────────

export async function issueRefund(req: Request, res: Response, next: NextFunction) {
  let refundClaim: {
    supabase: ReturnType<typeof getSupabase>;
    id: string;
    processorMayHaveAccepted: boolean;
  } | null = null;
  try {
    const locationId = resolveLocationId(req);
    const merchantId = getMerchantId(req) || await resolveMerchantId(locationId);
    const { paymentEventId, amount, reason } = req.body;

    if (!paymentEventId || !amount) {
      res.status(400).json({ error: 'paymentEventId and amount are required' });
      return;
    }

    if (typeof amount !== 'number' || amount <= 0) {
      res.status(400).json({ error: 'Amount must be a positive number' });
      return;
    }

    const supabase = getSupabase();

    // Look up original payment event
    const { data: originalEvent } = await supabase
      .from('payment_events')
      .select('*')
      .eq('id', paymentEventId)
      .eq('location_id', locationId)
      .single();

    if (!originalEvent) {
      res.status(404).json({ error: 'Payment event not found' });
      return;
    }

    if (!REFUNDABLE_EVENT_TYPES.has(String(originalEvent.event_type || '').toLowerCase()) || originalEvent.failure_reason) {
      res.status(400).json({ error: 'Only successful payment events can be refunded' });
      return;
    }

    if (!originalEvent.processor_transaction_id) {
      res.status(400).json({ error: 'Payment event is missing a processor transaction ID' });
      return;
    }

    const { data: priorRefunds, error: priorRefundsError } = await supabase
      .from('payment_events')
      .select('id, amount, processor_transaction_id, raw_webhook_payload')
      .eq('location_id', locationId)
      .eq('contact_id', originalEvent.contact_id)
      .in('event_type', ['refund', 'void']);
    if (priorRefundsError) throw priorRefundsError;

    const priorRefundCents = (priorRefunds || [])
      .filter((refund: any) => isRefundLinkedToPayment(refund, originalEvent, paymentEventId))
      .reduce((sum: number, refund: any) => sum + dollarsToCents(Math.abs(Number(refund.amount || 0))), 0);
    const recordedClaimIds = new Set(
      (priorRefunds || [])
        .map((refund: any) => String(refund?.raw_webhook_payload?.refund_claim_id || ''))
        .filter(Boolean),
    );
    const { data: reservedClaims, error: reservedClaimsError } = await supabase
      .from('payment_refund_claims')
      .select('id, amount_cents, status, refund_payment_event_id')
      .eq('location_id', locationId)
      .eq('original_payment_event_id', paymentEventId)
      .in('status', ['processing', 'provider_accepted', 'unknown', 'recorded', 'succeeded']);
    if (reservedClaimsError) throw reservedClaimsError;
    const reservedClaimCents = (reservedClaims || [])
      .filter((claim: any) => !claim.refund_payment_event_id && !recordedClaimIds.has(String(claim.id)))
      .reduce((sum: number, claim: any) => sum + Number(claim.amount_cents || 0), 0);
    const originalAmountCents = dollarsToCents(Number(originalEvent.amount || 0));
    const requestedAmountCents = dollarsToCents(amount);
    const remainingRefundableCents = originalAmountCents - priorRefundCents - reservedClaimCents;

    if (requestedAmountCents <= 0 || requestedAmountCents > remainingRefundableCents) {
      res.status(400).json({ error: 'Refund amount exceeds remaining refundable balance' });
      return;
    }

    const { data: claim, error: claimError } = await supabase
      .from('payment_refund_claims')
      .insert({
        location_id: locationId,
        original_payment_event_id: paymentEventId,
        amount_cents: requestedAmountCents,
        status: 'processing',
        processor: originalEvent.processor || null,
        claimed_by: getMerchantId(req) || merchantId || null,
        request_fingerprint: moneyOperationService.fingerprint({
          locationId,
          paymentEventId,
          amountCents: requestedAmountCents,
          reason: reason || '',
        }),
      })
      .select('id')
      .single();

    if (claimError) {
      if (isUniqueViolation(claimError)) {
        res.status(409).json({ error: 'A refund for this payment is already processing. Please wait before trying again.' });
        return;
      }
      throw claimError;
    }
    if (!claim?.id) {
      throw new Error('Refund claim could not be created');
    }
    refundClaim = { supabase, id: claim.id, processorMayHaveAccepted: false };
    const refundIdempotencyKey = `refund:${locationId}:${claim.id}`;

    const originalProcessor = String(originalEvent.processor || '').toLowerCase();
    let processorType = originalProcessor;
    let result: any;
    try {
      if (originalProcessor === 'whop') {
        if (!String(originalEvent.processor_transaction_id || '').startsWith('pay_')) {
          refundClaim.processorMayHaveAccepted = false;
          await updateRefundClaim(supabase, refundClaim.id, {
            status: 'failed',
            error_message: 'Whop payment is missing a refundable Whop payment ID',
          });
          refundClaim = null;
          res.status(400).json({ error: 'This Whop payment is missing a refundable Whop payment ID. Refund directly in Whop; ScaleSafe will record the refund webhook.' });
          return;
        }
        await updateRefundClaim(supabase, refundClaim.id, {
          status: 'unknown',
          provider_called: true,
          provider_started_at: new Date().toISOString(),
          error_message: 'Whop refund request started; awaiting confirmed result.',
        });
        refundClaim.processorMayHaveAccepted = true;
        result = await whopService.refundPayment(locationId, {
          paymentId: originalEvent.processor_transaction_id,
          partialAmount: requestedAmountCents < originalAmountCents ? amount : undefined,
        });
        processorType = 'whop';
      } else {
        const { config: procConfig } = await resolveProcessor(merchantId, locationId, {
          processor_override: originalEvent.processor || null,
          nmi_processor_id: null,
        });
        processorType = procConfig.processor_type;
        const processor = createProcessorClient(procConfig);

        await updateRefundClaim(supabase, refundClaim.id, {
          status: 'unknown',
          provider_called: true,
          provider_started_at: new Date().toISOString(),
          error_message: `${processorType.toUpperCase()} refund request started; awaiting confirmed result.`,
        });
        refundClaim.processorMayHaveAccepted = true;
        result = await processor.refund({
          transactionId: originalEvent.processor_transaction_id,
          amount: requestedAmountCents,
          idempotencyKey: refundIdempotencyKey,
        });
      }
    } catch (processorError: any) {
      if (refundClaim) {
        await updateRefundClaim(supabase, refundClaim.id, {
          status: 'unknown',
          error_message: processorError.message || 'Processor refund result is unknown',
        });
      }
      throw processorError;
    }

    // #11: a 'pending' refund is ACCEPTED by the processor (it will settle), not a failure.
    // Treat only a genuine failure as a hard stop; record pending refunds so the refundable
    // balance reflects them and a re-issue cannot double-refund.
    if (!result.success && result.status !== 'pending') {
      refundClaim.processorMayHaveAccepted = false;
      await updateRefundClaim(supabase, refundClaim.id, {
        status: 'failed',
        error_message: result.errorMessage || 'Refund failed',
      });
      logger.warn({ paymentEventId, amount, reason, error: result.errorMessage }, 'Refund failed');
      res.json({ success: false, error: result.errorMessage || 'Refund failed' });
      refundClaim = null;
      return;
    }
    const refundPending = result.status === 'pending';

    if (processorType === 'whop') {
      const canonicalRefundId = typeof result.refundId === 'string' && /^rf_[A-Za-z0-9]+$/.test(result.refundId)
        ? result.refundId
        : null;

      await markRefundClaimProviderAcceptedIfUnrecorded(supabase, refundClaim.id, {
        status: 'provider_accepted',
        provider_called: true,
        processor_refund_id: canonicalRefundId,
        provider_accepted_at: new Date().toISOString(),
        error_message: null,
      });

      // Whop's refund endpoint returns the updated pay_... object. The signed
      // refund.created webhook supplies the canonical rf_... refund record.
      const confirmedRefund = await findWhopRefundEventForPayment(supabase, locationId, originalEvent);
      if (confirmedRefund?.id) {
        await updateRefundClaim(supabase, refundClaim.id, {
          status: 'recorded',
          processor_refund_id: confirmedRefund.processor_transaction_id || canonicalRefundId,
          refund_payment_event_id: confirmedRefund.id,
          recorded_at: new Date().toISOString(),
          error_message: null,
        });
      }

      const confirmationPending = !confirmedRefund?.id;
      logger.info({
        paymentEventId,
        amount,
        reason,
        confirmationPending,
        refundEventId: confirmedRefund?.id || null,
      }, 'Whop refund accepted');
      refundClaim = null;
      res.json({
        success: true,
        status: confirmationPending ? 'processing' : 'refunded',
        refundId: confirmedRefund?.processor_transaction_id || canonicalRefundId,
        paymentEventId: confirmedRefund?.id || null,
        confirmationPending,
        message: confirmationPending
          ? 'Refund accepted by Whop and awaiting signed confirmation.'
          : undefined,
      });
      return;
    }

    const refundTransactionId = result.refundId || `${originalEvent.processor_transaction_id}:refund:${refundClaim.id}`;
    await updateRefundClaim(supabase, refundClaim.id, {
      status: 'provider_accepted',
      provider_called: true,
      processor_refund_id: refundTransactionId,
      provider_accepted_at: new Date().toISOString(),
      error_message: null,
    });
    const refundType = amount < Number(originalEvent.amount) ? 'partial' : 'full';
    let programName = '';
    if (originalEvent.offer_id) {
      const { data: offer, error: offerError } = await supabase
        .from('offers_mirror')
        .select('offer_name')
        .eq('id', originalEvent.offer_id)
        .maybeSingle();
      if (offerError) {
        logger.warn({ err: offerError, paymentEventId, offerId: originalEvent.offer_id }, 'Refund processed but offer lookup failed');
      }
      programName = offer?.offer_name || '';
    }

    let refundEventId: string | null = null;
    let recordingIssue: string | null = null;
    let notificationIssue: string | null = null;

    // Once the processor accepts a refund, local bookkeeping must not turn the
    // merchant-facing result into a generic failure. Surface post-refund issues
    // explicitly so support can reconcile without hiding the processor outcome.
    const { data: refundEvent, error: refundInsertError } = await supabase.from('payment_events').insert({
      merchant_id: merchantId,
      location_id: locationId,
      contact_id: originalEvent.contact_id,
      event_type: 'refund',
      processor: processorType,
      processor_transaction_id: refundTransactionId,
      amount,
      currency: 'usd',
      enrollment_id: originalEvent.enrollment_id || null,
      offer_id: originalEvent.offer_id || null,
      source: 'manual_refund',
      raw_webhook_payload: {
        original_payment_event_id: paymentEventId,
        original_processor_transaction_id: originalEvent.processor_transaction_id,
        refund_claim_id: refundClaim.id,
        reason: reason || null,
        processor_refund_response: result.raw || null,
      },
      is_recurring: false,
    }).select('id').single();
    if (refundInsertError) {
      recordingIssue = 'Refund was accepted by the processor, but ScaleSafe could not record the refund event. Contact support to reconcile this payment.';
      logger.error({ err: refundInsertError, paymentEventId, refundTransactionId, processor: processorType }, 'Refund accepted but refund event insert failed');
    } else {
      refundEventId = refundEvent?.id || null;
      try {
        await updateRefundClaim(supabase, refundClaim.id, {
          status: 'recorded',
          refund_payment_event_id: refundEventId,
          recorded_at: new Date().toISOString(),
          error_message: null,
        });
      } catch (claimRecordError: any) {
        recordingIssue = 'Refund was recorded, but ScaleSafe could not finalize its reconciliation claim. Contact support before attempting another refund.';
        logger.error({ err: claimRecordError, paymentEventId, refundTransactionId }, 'Refund event recorded but refund claim finalization failed');
      }
      try {
        await paymentLifecycleService.notifyRefundProcessed(locationId, originalEvent.contact_id, {
          amount,
          refundType,
          reason: reason || 'Refund processed',
          transactionId: refundTransactionId,
          enrollmentId: originalEvent.enrollment_id || null,
          offerId: originalEvent.offer_id || null,
          programName,
          processor: processorType,
          subscriptionId: originalEvent.processor_subscription_id || null,
        });
      } catch (notifyErr: any) {
        notificationIssue = 'Refund was recorded, but the refund workflow notification did not send. Review trigger delivery logs.';
        logger.error({ err: notifyErr, paymentEventId, refundTransactionId, processor: processorType }, 'Refund recorded but refund notification failed');
      }
    }

    logger.info({ paymentEventId, amount, reason, pending: refundPending, recordingIssue, notificationIssue }, 'Refund processed');
    res.json({
      success: true,
      status: refundPending ? 'processing' : 'refunded',
      refundId: refundTransactionId,
      paymentEventId: refundEventId,
      recordingIssue,
      notificationIssue,
      message: recordingIssue || notificationIssue || undefined,
    });
  } catch (err: any) {
    if (refundClaim) {
      try {
        await updateRefundClaim(refundClaim.supabase, refundClaim.id, refundClaim.processorMayHaveAccepted
          ? {
              status: 'unknown',
              error_message: err?.message || 'Refund result requires reconciliation',
            }
          : {
              status: 'failed',
              error_message: err?.message || 'Refund request failed before processor confirmation',
            });
      } catch (claimError: any) {
        logger.error({ err: claimError.message, claimId: refundClaim.id }, 'Refund failure claim could not be updated');
      }
    }
    next(err);
  }
}
