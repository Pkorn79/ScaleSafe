import { Request, Response, NextFunction } from 'express';
import { getSupabase } from '../clients/supabase.client';
import { ghlApi } from '../clients/ghl.client';
import { resolveLocationId } from '../middleware/tenantContext';
import { resolveProcessor, createProcessorClient } from '../services/processor.factory';
import { paymentLedgerService } from '../services/payment-ledger.service';
import { logger } from '../utils/logger';

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

function processorLabel(processor?: string | null): string {
  if (processor === 'nmi') return 'NMI';
  if (processor === 'stripe') return 'Stripe';
  if (processor === 'ghl') return 'GHL';
  return processor || 'Unknown';
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

// ─── GET /api/payments/customers ────────────────────────────────

export async function searchCustomers(req: Request, res: Response, next: NextFunction) {
  try {
    const locationId = resolveLocationId(req);
    const search = (req.query.search as string || '').trim();
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
      const escaped = search.replace(/,/g, '');
      query = query.or(`program_name.ilike.%${escaped}%,contact_id.ilike.%${escaped}%,customer_id.ilike.%${escaped}%`);
    }

    query = query.limit(shouldEnrichFromGhl ? 60 : 25);

    const { data: maps, error } = await query;
    if (error) throw error;

    // Get unique contact IDs from payment_customer_map
    let contactIds = [...new Set((maps || []).map(m => m.contact_id).filter(Boolean))];

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
        // GHL API unavailable — fall through to enrollment data
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

    // Deduplicate by email — multiple contactIds can map to the same person
    const byEmail = new Map<string, { contactId: string; name: string; email: string; totalCharged: number; totalRefunded: number; lastPaymentDate: string | null; programName: string }>();
    for (const cid of contactIds) {
      const t = totals[cid];
      const displayName = t.name || (t.email ? t.email.split('@')[0] : '');
      const email = (t.email || '').toLowerCase();
      const key = email || cid; // group by email, fall back to contactId if no email

      const existing = byEmail.get(key);
      if (existing) {
        existing.totalCharged += t.charged;
        existing.totalRefunded += t.refunded;
        if (t.lastPaymentDate && (!existing.lastPaymentDate || t.lastPaymentDate > existing.lastPaymentDate)) {
          existing.lastPaymentDate = t.lastPaymentDate;
        }
        if (!existing.name && displayName) existing.name = displayName;
        if (!existing.programName) existing.programName = maps!.find(m => m.contact_id === cid)?.program_name || '';
      } else {
        byEmail.set(key, {
          contactId: cid,
          name: displayName,
          email: t.email,
          totalCharged: t.charged,
          totalRefunded: t.refunded,
          lastPaymentDate: t.lastPaymentDate || null,
          programName: maps!.find(m => m.contact_id === cid)?.program_name || '',
        });
      }
    }

    const customers = [...byEmail.values()]
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

// ─── GET /api/payments/manage/ledger ────────────────────────────

export async function listPaymentLedger(req: Request, res: Response, next: NextFunction) {
  try {
    const locationId = resolveLocationId(req);
    const result = await paymentLedgerService.list(locationId, {
      search: (req.query.search as string) || '',
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

// ─── GET /api/payments/customer/:contactId ──────────────────────

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

    const result = (methods || []).map(m => {
      const display = cleanCardDisplay(m);
      return {
        id: m.id,
        ...display,
        isDefault: m.is_default,
        processorType: m.processor_type,
        processorLabel: processorLabel(m.processor_type),
        customerId: m.nmi_customer_vault_id || m.stripe_customer_id,
        paymentMethodId: m.stripe_payment_method_id,
      };
    });

    res.json({ methods: result });
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

    const token = method.nmi_customer_vault_id || method.stripe_payment_method_id || '';
    const result = await processor.charge({
      amount: Math.round(amount * 100),
      currency: 'usd',
      paymentToken: token,
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

    if (amount > Number(originalEvent.amount)) {
      res.status(400).json({ error: 'Refund amount cannot exceed original charge amount' });
      return;
    }

    const { config: procConfig } = await resolveProcessor(merchantId, locationId, {
      processor_override: originalEvent.processor || null,
      nmi_processor_id: null,
    });
    const processor = createProcessorClient(procConfig);

    const result = await processor.refund({
      transactionId: originalEvent.processor_transaction_id,
      amount: Math.round(amount * 100),
    });

    // Log refund event
    await supabase.from('payment_events').insert({
      merchant_id: merchantId,
      location_id: locationId,
      contact_id: originalEvent.contact_id,
      event_type: 'refund',
      processor: procConfig.processor_type,
      processor_transaction_id: result.refundId || originalEvent.processor_transaction_id,
      amount,
      currency: 'usd',
      enrollment_id: originalEvent.enrollment_id || null,
      offer_id: originalEvent.offer_id || null,
      source: 'manual_refund',
      is_recurring: false,
    });

    logger.info({ paymentEventId, amount, reason }, 'Refund processed');
    res.json({ success: result.success, error: result.errorMessage });
  } catch (err) { next(err); }
}
