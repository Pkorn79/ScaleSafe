import { Request, Response, NextFunction } from 'express';
import { getSupabase } from '../clients/supabase.client';
import { ghlApi } from '../clients/ghl.client';
import { resolveLocationId } from '../middleware/tenantContext';
import { resolveProcessor, createProcessorClient } from '../services/processor.factory';
import { logger } from '../utils/logger';

function getMerchantId(req: Request): string {
  return (req as any).merchantId || '';
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
      .select('contact_id, contact_email')
      .eq('location_id', locationId)
      .in('contact_id', contactIds)
      .not('contact_email', 'is', null);

    for (const ev of (emailEvents || [])) {
      if (ev.contact_id && (ev as any).contact_email && !enrollmentMap[ev.contact_id]?.email) {
        if (!enrollmentMap[ev.contact_id]) enrollmentMap[ev.contact_id] = { name: '', email: '' };
        enrollmentMap[ev.contact_id].email = (ev as any).contact_email;
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

// ─── GET /api/payments/customer/:contactId ──────────────────────

export async function getPaymentHistory(req: Request, res: Response, next: NextFunction) {
  try {
    const locationId = resolveLocationId(req);
    const { contactId } = req.params;
    const supabase = getSupabase();

    const { data: events, error } = await supabase
      .from('payment_events')
      .select('*')
      .eq('location_id', locationId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    let totalCharged = 0;
    let totalRefunded = 0;

    const payments = (events || []).map(ev => {
      const amount = Number(ev.amount) || 0;
      if (ev.event_type === 'refund') totalRefunded += amount;
      else if (ev.event_type === 'sale') totalCharged += amount;

      return {
        id: ev.id,
        date: ev.created_at,
        amount,
        type: ev.event_type,
        status: ev.failure_reason ? 'failed' : 'success',
        processor: ev.processor,
        last4: ev.device_info || '',
        description: ev.event_type === 'refund' ? 'Refund' : 'Payment',
        transactionId: ev.processor_transaction_id,
        refundable: ev.event_type === 'sale' && !ev.failure_reason,
      };
    });

    res.json({ payments, totalCharged, totalRefunded });
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

    const result = (methods || []).map(m => ({
      id: m.id,
      last4: m.card_last_four,
      brand: m.card_brand,
      expMonth: m.card_exp_month,
      expYear: m.card_exp_year,
      isDefault: m.is_default,
      processorType: m.processor_type,
      customerId: m.nmi_customer_vault_id || m.stripe_customer_id,
      paymentMethodId: m.stripe_payment_method_id,
    }));

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

    const { config: procConfig } = await resolveProcessor(merchantId, locationId);
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

    const { config: procConfig } = await resolveProcessor(merchantId, locationId);
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
    });

    logger.info({ paymentEventId, amount, reason }, 'Refund processed');
    res.json({ success: result.success, error: result.errorMessage });
  } catch (err) { next(err); }
}
