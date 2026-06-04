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
import { logger } from '../utils/logger';
import { cleanPostgrestLikeTerm, isSafeOrFilterSearchInput } from '../utils/search-input';

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

const REFUNDABLE_EVENT_TYPES = new Set(['sale', 'subscription_payment', 'capture']);

function dollarsToCents(value: number): number {
  return Math.round(Number(value || 0) * 100);
}

function isRefundLinkedToPayment(refund: any, originalEvent: any, paymentEventId: string): boolean {
  const raw = refund?.raw_webhook_payload || {};
  return raw.original_payment_event_id === paymentEventId
    || raw.original_processor_transaction_id === originalEvent.processor_transaction_id
    || refund.processor_transaction_id === originalEvent.processor_transaction_id;
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
      } else if (ev.event_type === 'sale') {
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
        const contactId = c.contactId.toLowerCase();
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

    if (!contactId || !paymentMethodId || !amount) {
      res.status(400).json({ error: 'contactId, paymentMethodId, and amount are required' });
      return;
    }

    if (typeof amount !== 'number' || amount <= 0) {
      res.status(400).json({ error: 'Amount must be a positive number' });
      return;
    }

    const supabase = getSupabase();

    // Look up saved payment method
    const { data: method } = await supabase
      .from('payment_methods')
      .select('*')
      .eq('id', paymentMethodId)
      .eq('location_id', locationId)
      .single();

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
    const result = await processor.chargeStoredCard(customerId, storedPaymentMethodId, {
      amount: Math.round(amount * 100),
      currency: 'usd',
      paymentToken: storedPaymentMethodId,
      description: description || 'One-time charge',
      metadata: { contact_id: contactId, source: 'payment_management' },
    });

    // Log payment event
    await supabase.from('payment_events').insert({
      merchant_id: merchantId,
      location_id: locationId,
      contact_id: contactId,
      event_type: result.success ? 'sale' : 'payment_failed',
      processor: procConfig.processor_type,
      processor_transaction_id: result.transactionId,
      amount,
      currency: 'usd',
      failure_reason: result.errorMessage || null,
      source: 'manual_charge',
      is_recurring: false,
    });

    logger.info({ contactId, amount, success: result.success }, 'Manual charge processed');
    res.json({ success: result.success, chargeId: result.chargeId || result.transactionId, error: result.errorMessage });
  } catch (err) { next(err); }
}

// ─── POST /api/payments/refund ──────────────────────────────────

export async function issueRefund(req: Request, res: Response, next: NextFunction) {
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
      .eq('event_type', 'refund');
    if (priorRefundsError) throw priorRefundsError;

    const priorRefundCents = (priorRefunds || [])
      .filter((refund: any) => isRefundLinkedToPayment(refund, originalEvent, paymentEventId))
      .reduce((sum: number, refund: any) => sum + dollarsToCents(Number(refund.amount || 0)), 0);
    const originalAmountCents = dollarsToCents(Number(originalEvent.amount || 0));
    const requestedAmountCents = dollarsToCents(amount);
    const remainingRefundableCents = originalAmountCents - priorRefundCents;

    if (requestedAmountCents <= 0 || requestedAmountCents > remainingRefundableCents) {
      res.status(400).json({ error: 'Refund amount exceeds remaining refundable balance' });
      return;
    }

    const { config: procConfig } = await resolveProcessor(merchantId, locationId, {
      processor_override: originalEvent.processor || null,
      nmi_processor_id: null,
    });
    const processor = createProcessorClient(procConfig);

    const result = await processor.refund({
      transactionId: originalEvent.processor_transaction_id,
      amount: requestedAmountCents,
    });

    // #11: a 'pending' refund is ACCEPTED by the processor (it will settle), not a failure.
    // Treat only a genuine failure as a hard stop; record pending refunds so the refundable
    // balance reflects them and a re-issue cannot double-refund.
    if (!result.success && result.status !== 'pending') {
      logger.warn({ paymentEventId, amount, reason, error: result.errorMessage }, 'Refund failed');
      res.json({ success: false, error: result.errorMessage || 'Refund failed' });
      return;
    }
    const refundPending = result.status === 'pending';

    const refundTransactionId = result.refundId || originalEvent.processor_transaction_id;
    const refundType = amount < Number(originalEvent.amount) ? 'partial' : 'full';
    let programName = '';
    if (originalEvent.offer_id) {
      const { data: offer } = await supabase
        .from('offers_mirror')
        .select('offer_name')
        .eq('id', originalEvent.offer_id)
        .maybeSingle();
      programName = offer?.offer_name || '';
    }

    // Log refund event
    const { data: refundEvent, error: refundInsertError } = await supabase.from('payment_events').insert({
      merchant_id: merchantId,
      location_id: locationId,
      contact_id: originalEvent.contact_id,
      event_type: 'refund',
      processor: procConfig.processor_type,
      processor_transaction_id: refundTransactionId,
      amount,
      currency: 'usd',
      enrollment_id: originalEvent.enrollment_id || null,
      offer_id: originalEvent.offer_id || null,
      source: 'manual_refund',
      raw_webhook_payload: {
        original_payment_event_id: paymentEventId,
        original_processor_transaction_id: originalEvent.processor_transaction_id,
        reason: reason || null,
      },
      is_recurring: false,
    }).select('id').single();
    if (refundInsertError) throw refundInsertError;

    await paymentLifecycleService.notifyRefundProcessed(locationId, originalEvent.contact_id, {
      amount,
      refundType,
      reason: reason || 'Refund processed',
      transactionId: refundTransactionId,
      enrollmentId: originalEvent.enrollment_id || null,
      offerId: originalEvent.offer_id || null,
      programName,
      processor: procConfig.processor_type,
      subscriptionId: originalEvent.processor_subscription_id || null,
    });

    logger.info({ paymentEventId, amount, reason, pending: refundPending }, 'Refund processed');
    res.json({
      success: true,
      status: refundPending ? 'processing' : 'refunded',
      refundId: refundTransactionId,
      paymentEventId: refundEvent?.id || null,
    });
  } catch (err) { next(err); }
}
