import { Router, Request, Response } from 'express';
import { getSupabase } from '../clients/supabase.client';
import { ghlApi } from '../clients/ghl.client';
import { merchantRepository } from '../repositories/merchant.repository';
import { evidenceService } from '../services/evidence.service';
import { STORAGE_BUCKETS } from '../services/storage.service';
import { debugLimiter } from '../middleware/rateLimiter';
import { logger } from '../utils/logger';
import crypto from 'crypto';

const router = Router();

function requireDebugToken(req: Request, res: Response, next: () => void): void {
  const expected = process.env.DEBUG_ADMIN_TOKEN || process.env.ADMIN_DEBUG_TOKEN;
  const suppliedHeader = req.headers['x-admin-debug-token'];
  const supplied = Array.isArray(suppliedHeader) ? suppliedHeader[0] : suppliedHeader;
  const auth = req.headers.authorization || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';

  if (!expected) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const expectedBuffer = Buffer.from(expected);
  const suppliedMatches = typeof supplied === 'string'
    && Buffer.byteLength(supplied) === expectedBuffer.length
    && crypto.timingSafeEqual(Buffer.from(supplied), expectedBuffer);
  const bearerMatches = bearer
    && Buffer.byteLength(bearer) === expectedBuffer.length
    && crypto.timingSafeEqual(Buffer.from(bearer), expectedBuffer);

  if (!suppliedMatches && !bearerMatches) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}

function sendDebugError(res: Response, err: any): void {
  logger.error({ err: err?.message, stack: err?.stack }, 'Debug route failed');
  res.status(500).json({ error: err?.message || 'Debug route failed' });
}

router.get('/health', async (_req: Request, res: Response) => {
  const checks: Record<string, string> = { app: 'ok' };

  try {
    const { error } = await getSupabase().from('merchants').select('id').limit(1);
    checks.supabase = error ? `error: ${error.message}` : 'ok';
  } catch {
    checks.supabase = 'unreachable';
  }

  const healthy = Object.values(checks).every((v) => v === 'ok');
  res.status(healthy ? 200 : 503).json({ status: healthy ? 'healthy' : 'degraded', checks });
});

// ─── Debug: enrollment diagnostic ──────────────────────────────
router.use('/api/debug', debugLimiter, requireDebugToken);

router.get('/api/debug/enrollment-check/:consentToken', async (req: Request, res: Response) => {
  try {
    const { consentToken } = req.params;
    const supabase = getSupabase();

    // 1. Look up enrollment by consent_token
    const { data: enrollment, error: enrollErr } = await supabase
      .from('enrollments')
      .select('*')
      .eq('consent_token', consentToken)
      .single();

    if (enrollErr || !enrollment) {
      res.json({
        found: false,
        error: enrollErr?.message || 'No enrollment found',
        consentToken,
      });
      return;
    }

    const locationId = enrollment.location_id || '';
    const contactId = enrollment.contact_id || '';

    // 2. Check GHL token validity
    let ghlTokenValid = false;
    let ghlTokenError = '';
    try {
      const api = await ghlApi(locationId);
      await api.get('/contacts/', { params: { locationId, limit: 1 } });
      ghlTokenValid = true;
    } catch (e: any) {
      ghlTokenError = e.message || 'unknown error';
    }

    // 3. Check merchant config for pipelineId
    let pipelineId = '';
    let merchantConfig: any = null;
    try {
      const merchant = await merchantRepository.getByLocationId(locationId);
      merchantConfig = merchant.config || {};
      pipelineId = (merchantConfig as any)?.pipelineId || (merchantConfig as any)?.milestones_pipeline_id || '';
    } catch (e: any) {
      merchantConfig = { error: e.message };
    }

    // 4. Check payment events for this consent token
    const { data: paymentEvents } = await supabase
      .from('payment_events')
      .select('id, event_type, amount, processor, contact_id, created_at')
      .eq('consent_token', consentToken)
      .order('created_at', { ascending: false });

    // 5. GHL diagnostic — test actual API operations
    const ghlDiagnostic: Record<string, any> = {
      ghlApiInit: { success: false, error: '' },
      contactLookup: { success: false, found: false, contactData: null, error: '' },
      upsertTest: { success: false, contactId: '', error: '' },
      pipelineConfig: { pipelineId: pipelineId || null, hasPipeline: !!pipelineId },
    };

    try {
      const api = await ghlApi(locationId);
      ghlDiagnostic.ghlApiInit = { success: true, error: '' };

      // Try duplicate search to see if contact already exists
      const enrollmentEmail = enrollment.email || '';
      if (enrollmentEmail) {
        try {
          const searchRes = await api.get('/contacts/search/duplicate', {
            params: { locationId, email: enrollmentEmail },
          });
          const existingContact = searchRes.data?.contact || null;
          ghlDiagnostic.contactLookup = {
            success: true,
            found: !!existingContact,
            contactData: existingContact ? {
              id: existingContact.id,
              firstName: existingContact.firstName,
              lastName: existingContact.lastName,
              email: existingContact.email,
            } : null,
            error: '',
          };
        } catch (searchErr: any) {
          ghlDiagnostic.contactLookup = {
            success: false,
            found: false,
            contactData: null,
            error: searchErr.message || 'search failed',
            status: searchErr.response?.status,
            responseKeys: searchErr.response?.data ? Object.keys(searchErr.response.data) : [],
          };
        }
      } else {
        ghlDiagnostic.contactLookup = {
          success: false,
          found: false,
          contactData: null,
          error: 'No email on enrollment — cannot search',
        };
      }

      ghlDiagnostic.upsertTest = {
        success: false,
        contactId: '',
        error: 'read-only diagnostic; use POST /api/debug/enrollment-check/:consentToken/repair-contact to upsert/save contact',
      };
    } catch (apiErr: any) {
      ghlDiagnostic.ghlApiInit = {
        success: false,
        error: apiErr.message || 'ghlApi init failed',
        status: apiErr.response?.status,
        responseKeys: apiErr.response?.data ? Object.keys(apiErr.response.data) : [],
      };
    }

    res.json({
      found: true,
      enrollment: {
        id: enrollment.id,
        status: enrollment.status,
        location_id: locationId,
        offer_id: enrollment.offer_id,
        contact_id: contactId || 'NOT SET',
        email: enrollment.email || 'NOT SET',
        digital_signature: !!enrollment.digital_signature,
        created_at: enrollment.created_at,
        updated_at: enrollment.updated_at,
      },
      ghl: {
        tokenValid: ghlTokenValid,
        tokenError: ghlTokenError || undefined,
      },
      ghlDiagnostic,
      merchant: {
        pipelineId: pipelineId || 'NOT SET',
        configKeys: Object.keys(merchantConfig),
      },
      paymentEvents: paymentEvents || [],
    });
  } catch (err: any) {
    logger.error({ err: err.message, stack: err.stack }, 'enrollment-check diagnostic failed');
    sendDebugError(res, err);
  }
});

router.post('/api/debug/enrollment-check/:consentToken/repair-contact', async (req: Request, res: Response) => {
  try {
    const { consentToken } = req.params;
    const supabase = getSupabase();

    const { data: enrollment, error: enrollErr } = await supabase
      .from('enrollments')
      .select('id, location_id, contact_id, email')
      .eq('consent_token', consentToken)
      .single();

    if (enrollErr || !enrollment) {
      res.status(404).json({
        found: false,
        error: enrollErr?.message || 'No enrollment found',
        consentToken,
      });
      return;
    }

    const locationId = enrollment.location_id || '';
    const email = enrollment.email || '';
    if (!locationId || !email) {
      res.status(400).json({ error: 'Enrollment must have location_id and email to repair contact' });
      return;
    }

    const api = await ghlApi(locationId);
    const upsertRes = await api.post('/contacts/upsert', {
      firstName: email.split('@')[0] || 'Client',
      email,
      locationId,
    });
    const contactId = upsertRes.data?.contact?.id || upsertRes.data?.id || '';
    if (!contactId) {
      res.status(502).json({ error: 'GHL upsert returned no contact id' });
      return;
    }

    if (!enrollment.contact_id) {
      await supabase.from('enrollments').update({ contact_id: contactId }).eq('id', enrollment.id);
    }

    res.json({
      _debug: true,
      repaired: !enrollment.contact_id,
      enrollmentId: enrollment.id,
      contactId,
    });
  } catch (err: any) {
    logger.error({ err: err.message, stack: err.stack }, 'enrollment-check repair-contact failed');
    sendDebugError(res, err);
  }
});

// ─── Debug: clients-data (mirrors evidenceHealth) ─────────────
router.get('/api/debug/clients-data/:locationId', async (req: Request, res: Response) => {
  try {
    const locationId = req.params.locationId;
    const supabase = getSupabase();

    const [{ data: evidenceContacts }, { data: enrolledContacts }] = await Promise.all([
      supabase.from('evidence_timeline').select('contact_id').eq('location_id', locationId),
      supabase
        .from('enrollments')
        .select('id, contact_id, email, status, created_at')
        .eq('location_id', locationId)
        .in('status', ['enrolled', 'consent_captured', 'completed']),
    ]);

    const evidenceIds = (evidenceContacts || []).map(c => c.contact_id).filter(Boolean);

    const enrollmentEntries = (enrolledContacts || []).map(e => ({
      contactId: e.contact_id || `enrollment:${e.id}`,
      hasRealContactId: !!e.contact_id,
      email: (e as any).email || '',
      clientName: '',
      status: e.status,
      createdAt: e.created_at,
    }));

    const allContactIds = [
      ...evidenceIds,
      ...enrollmentEntries.map(e => e.contactId),
    ];
    const uniqueIds = [...new Set(allContactIds)].filter(Boolean);

    const enrollmentLookup = new Map(enrollmentEntries.map(e => [e.contactId, e]));

    const clientScores = [];
    for (const cid of uniqueIds.slice(0, 50)) {
      if (cid.startsWith('enrollment:')) {
        const entry = enrollmentLookup.get(cid)!;
        clientScores.push({
          contactId: cid,
          displayName: entry.email || 'Unknown',
          score: 15,
          breakdown: {
            consent: { points: 15, max: 20 },
            payments: { points: 0, max: 15 },
            delivery: { points: 0, max: 25 },
            engagement: { points: 0, max: 20 },
            recency: { points: 0, max: 10 },
          },
        });
      } else {
        const { score, breakdown } = await evidenceService.calculateReadinessScore(locationId, cid);
        const entry = enrollmentLookup.get(cid);
        clientScores.push({
          contactId: cid,
          displayName: entry?.email || '',
          score,
          breakdown,
        });
      }
    }

    clientScores.sort((a, b) => a.score - b.score);

    res.json({
      _debug: true,
      _source: 'evidenceHealth mirror',
      _rawCounts: {
        evidenceContacts: (evidenceContacts || []).length,
        enrolledContacts: (enrolledContacts || []).length,
        enrollmentEntries: enrollmentEntries.length,
      },
      totalClients: uniqueIds.length,
      scores: clientScores,
      averageScore: clientScores.length > 0
        ? Math.round(clientScores.reduce((s, c) => s + c.score, 0) / clientScores.length)
        : 0,
    });
  } catch (err: any) {
    logger.error({ err: err.message, stack: err.stack }, 'debug clients-data failed');
    sendDebugError(res, err);
  }
});

// ─── Debug: payments-data (mirrors searchCustomers) ───────────
router.get('/api/debug/payments-data/:locationId', async (req: Request, res: Response) => {
  try {
    const locationId = req.params.locationId;
    const supabase = getSupabase();

    // Load payment-customer mappings
    const { data: maps, error } = await supabase
      .from('payment_customer_map')
      .select('contact_id, program_name, customer_id, created_at')
      .eq('location_id', locationId)
      .order('created_at', { ascending: false })
      .limit(25);

    if (error) throw error;

    const contactIds = [...new Set((maps || []).map(m => m.contact_id))];
    if (contactIds.length === 0) {
      res.json({ _debug: true, customers: [], _rawMaps: maps || [] });
      return;
    }

    // Enrich from enrollments
    const { data: enrollmentProfiles } = await supabase
      .from('enrollments')
      .select('contact_id, email, offer_id')
      .eq('location_id', locationId)
      .in('contact_id', contactIds);

    const enrollmentMap: Record<string, { name: string; email: string }> = {};
    for (const ep of (enrollmentProfiles || [])) {
      if (ep.contact_id) {
        enrollmentMap[ep.contact_id] = {
          name: '',
          email: ep.email || '',
        };
      }
    }

    // Payment totals
    const { data: events } = await supabase
      .from('payment_events')
      .select('contact_id, amount, event_type, created_at')
      .eq('location_id', locationId)
      .in('contact_id', contactIds);

    const totals: Record<string, { charged: number; refunded: number; name: string; email: string; lastPaymentDate: string }> = {};
    for (const cid of contactIds) {
      const map = maps!.find(m => m.contact_id === cid);
      totals[cid] = {
        charged: 0,
        refunded: 0,
        name: enrollmentMap[cid]?.name || map?.program_name || '',
        email: enrollmentMap[cid]?.email || '',
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
      if (ev.created_at && (!totals[ev.contact_id].lastPaymentDate || ev.created_at > totals[ev.contact_id].lastPaymentDate)) {
        totals[ev.contact_id].lastPaymentDate = ev.created_at;
      }
    }

    const customers = contactIds.map(cid => {
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
    });

    res.json({
      _debug: true,
      _rawCounts: {
        maps: (maps || []).length,
        contactIds: contactIds.length,
        enrollmentProfiles: (enrollmentProfiles || []).length,
        paymentEvents: (events || []).length,
      },
      customers,
    });
  } catch (err: any) {
    logger.error({ err: err.message, stack: err.stack }, 'debug payments-data failed');
    sendDebugError(res, err);
  }
});

// ─── Debug: raw enrollments ───────────────────────────────────
router.get('/api/debug/enrollments/:locationId', async (req: Request, res: Response) => {
  try {
    const locationId = req.params.locationId;
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from('enrollments')
      .select('*')
      .eq('location_id', locationId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) throw error;

    res.json({
      _debug: true,
      count: (data || []).length,
      enrollments: data || [],
    });
  } catch (err: any) {
    logger.error({ err: err.message, stack: err.stack }, 'debug enrollments failed');
    sendDebugError(res, err);
  }
});

// ─── Debug: backfill all enrollments missing contactId + fix evidence records ───────
router.post('/api/debug/backfill-contacts/:locationId', async (req: Request, res: Response) => {
  try {
    const locationId = req.params.locationId;
    const supabase = getSupabase();

    // Phase 1: Fix enrollments with null contact_id
    const { data: broken } = await supabase
      .from('enrollments')
      .select('id, email, contact_id')
      .eq('location_id', locationId)
      .eq('status', 'enrolled')
      .is('contact_id', null);

    const api = await ghlApi(locationId);
    const results: any[] = [];

    for (const enrollment of (broken || [])) {
      const email = enrollment.email || '';
      if (!email) {
        results.push({ id: enrollment.id, status: 'skipped', reason: 'no email' });
        continue;
      }

      try {
        const upsertRes = await api.post('/contacts/upsert', {
          firstName: email.split('@')[0] || 'Client',
          email,
          locationId,
        });
        const newContactId = upsertRes.data.contact?.id || upsertRes.data.id || '';
        if (newContactId) {
          await supabase.from('enrollments')
            .update({ contact_id: newContactId })
            .eq('id', enrollment.id);
          results.push({ id: enrollment.id, email, status: 'fixed', contactId: newContactId });
        } else {
          results.push({ id: enrollment.id, email, status: 'failed', reason: 'upsert returned no id' });
        }
      } catch (err: any) {
        results.push({ id: enrollment.id, email, status: 'error', reason: err.message });
      }
    }

    // Phase 2: Backfill evidence records with empty contact_id using enrollment_id lookup
    let evidenceFixed = 0;
    try {
      const { data: emptyEvidence } = await supabase
        .from('evidence')
        .select('id, enrollment_id')
        .eq('location_id', locationId)
        .eq('contact_id', '');

      for (const ev of (emptyEvidence || [])) {
        if (!ev.enrollment_id) continue;
        const { data: enr } = await supabase
          .from('enrollments')
          .select('contact_id')
          .eq('id', ev.enrollment_id)
          .single();
        if (enr?.contact_id) {
          await supabase.from('evidence')
            .update({ contact_id: enr.contact_id })
            .eq('id', ev.id);
          evidenceFixed++;
        }
      }
    } catch (e: any) {
      logger.warn({ err: e.message }, 'Evidence backfill partial failure');
    }

    // Phase 3: Backfill payment_events and payment_customer_map with empty contact_id
    let paymentEventsFixed = 0;
    let paymentMapsFixed = 0;
    try {
      const { data: emptyPE } = await supabase
        .from('payment_events')
        .select('id, enrollment_id')
        .eq('location_id', locationId)
        .eq('contact_id', '');

      for (const pe of (emptyPE || [])) {
        if (!pe.enrollment_id) continue;
        const { data: enr } = await supabase
          .from('enrollments')
          .select('contact_id')
          .eq('id', pe.enrollment_id)
          .single();
        if (enr?.contact_id) {
          await supabase.from('payment_events')
            .update({ contact_id: enr.contact_id })
            .eq('id', pe.id);
          paymentEventsFixed++;
        }
      }

      // Fix payment_customer_map with empty contact_id
      const { data: emptyMaps } = await supabase
        .from('payment_customer_map')
        .select('id, offer_id')
        .eq('location_id', locationId)
        .eq('contact_id', '');

      for (const m of (emptyMaps || [])) {
        // Find any enrollment for this offer that has a contact_id
        if (!m.offer_id) continue;
        const { data: enr } = await supabase
          .from('enrollments')
          .select('contact_id')
          .eq('location_id', locationId)
          .eq('offer_id', m.offer_id)
          .not('contact_id', 'is', null)
          .limit(1)
          .single();
        if (enr?.contact_id) {
          await supabase.from('payment_customer_map')
            .update({ contact_id: enr.contact_id })
            .eq('id', m.id);
          paymentMapsFixed++;
        }
      }
    } catch (e: any) {
      logger.warn({ err: e.message }, 'Payment backfill partial failure');
    }

    // Phase 4: Create missing consent + enrollment_payment evidence from enrollment records
    let consentCreated = 0;
    let paymentEvidenceCreated = 0;
    try {
      const { data: enrolled } = await supabase
        .from('enrollments')
        .select('id, contact_id, location_id, digital_signature, clauses_accepted, scroll_depth, consent_ip, consent_device, consent_captured_at, payment_amount, payment_type, payment_transaction_id, payments_total')
        .eq('location_id', locationId)
        .in('status', ['enrolled', 'consent_captured', 'completed'])
        .not('contact_id', 'is', null);

      for (const enr of (enrolled || [])) {
        if (!enr.contact_id) continue;

        // Check if consent evidence already exists for this enrollment
        const { data: existingConsent } = await supabase
          .from('evidence')
          .select('id')
          .eq('enrollment_id', enr.id)
          .eq('evidence_type', 'consent')
          .limit(1);

        if (!existingConsent || existingConsent.length === 0) {
          if (enr.digital_signature || enr.clauses_accepted) {
            try {
              await supabase.from('evidence').insert({
                location_id: enr.location_id,
                contact_id: enr.contact_id,
                enrollment_id: enr.id,
                evidence_type: 'consent',
                data: {
                  digital_signature: enr.digital_signature,
                  clauses_accepted: enr.clauses_accepted,
                  scroll_depth: enr.scroll_depth,
                  ip_address: enr.consent_ip,
                  consent_captured_at: enr.consent_captured_at,
                },
                ip_address: enr.consent_ip,
                device_info: enr.consent_device,
              });
              consentCreated++;
            } catch { /* duplicate or constraint error — skip */ }
          }
        }

        // Check if enrollment_payment evidence already exists
        const { data: existingPayment } = await supabase
          .from('evidence')
          .select('id')
          .eq('enrollment_id', enr.id)
          .eq('evidence_type', 'enrollment_payment')
          .limit(1);

        if (!existingPayment || existingPayment.length === 0) {
          if (enr.payment_amount) {
            try {
              await supabase.from('evidence').insert({
                location_id: enr.location_id,
                contact_id: enr.contact_id,
                enrollment_id: enr.id,
                evidence_type: 'enrollment_payment',
                data: {
                  amount: enr.payment_amount,
                  payment_type: enr.payment_type,
                  transaction_id: enr.payment_transaction_id,
                  payments_total: enr.payments_total,
                  timestamp: enr.consent_captured_at || new Date().toISOString(),
                },
              });
              paymentEvidenceCreated++;
            } catch { /* duplicate or constraint error — skip */ }
          }
        }
      }
    } catch (e: any) {
      logger.warn({ err: e.message }, 'Enrollment-to-evidence backfill partial failure');
    }

    // Phase 5: Backfill first_name/last_name from digital_signature on old enrollments
    let namesBackfilled = 0;
    try {
      const { data: nameless } = await supabase
        .from('enrollments')
        .select('id, contact_id, digital_signature')
        .eq('location_id', locationId)
        .is('first_name', null)
        .not('digital_signature', 'is', null)
        .not('digital_signature', 'eq', '');

      for (const enr of (nameless || [])) {
        const sig = (enr.digital_signature as string).trim();
        if (!sig) continue;
        const parts = sig.split(/\s+/);
        const firstName = parts[0] || '';
        const lastName = parts.slice(1).join(' ') || '';
        await supabase.from('enrollments')
          .update({ first_name: firstName, last_name: lastName })
          .eq('id', enr.id);

        // Re-upsert GHL contact with correct name if we have a contactId
        if (enr.contact_id) {
          try {
            await api.put(`/contacts/${enr.contact_id}`, {
              firstName,
              lastName,
            });
          } catch { /* GHL update failed — name saved to DB at least */ }
        }
        namesBackfilled++;
      }
    } catch (e: any) {
      logger.warn({ err: e.message }, 'Name backfill partial failure');
    }

    res.json({
      _debug: true,
      enrollments: { totalBroken: (broken || []).length, results },
      evidence: { fixed: evidenceFixed },
      paymentEvents: { fixed: paymentEventsFixed },
      paymentCustomerMap: { fixed: paymentMapsFixed },
      evidenceFromEnrollments: { consentCreated, paymentEvidenceCreated },
      namesBackfilled,
    });
  } catch (err: any) {
    logger.error({ err: err.message, stack: err.stack }, 'debug backfill-contacts failed');
    sendDebugError(res, err);
  }
});

// ─── Debug: evidence table diagnostic ──────────────────────
router.get('/api/debug/evidence-check/:locationId', async (req: Request, res: Response) => {
  try {
    const locationId = req.params.locationId;
    const contactId = req.query.contactId as string || '';
    const supabase = getSupabase();

    // 1. Count evidence_timeline rows for this location
    const { data: timelineRows, error: tlError } = await supabase
      .from('evidence_timeline')
      .select('contact_id, type, created_at')
      .eq('location_id', locationId)
      .order('created_at', { ascending: false })
      .limit(20);

    // 2. Count evidence table rows for this location
    let evidenceRows: any[] = [];
    let evidenceError: string | null = null;
    try {
      const { data, error } = await supabase
        .from('evidence')
        .select('id, contact_id, evidence_type, created_at, enrollment_id')
        .eq('location_id', locationId)
        .order('created_at', { ascending: false })
        .limit(20);
      evidenceRows = data || [];
      if (error) evidenceError = error.message;
    } catch (e: any) {
      evidenceError = e.message;
    }

    // 3. If specific contactId provided, get counts for them
    let contactCounts: any = null;
    if (contactId) {
      const { getCounts, getLastEvidenceDate } = require('../repositories/evidence.repository').evidenceRepository;
      try {
        const counts = await getCounts(locationId, contactId);
        const lastDate = await getLastEvidenceDate(locationId, contactId);
        contactCounts = { counts, lastDate };
      } catch (e: any) {
        contactCounts = { error: e.message };
      }
    }

    res.json({
      _debug: true,
      evidence_timeline: {
        count: (timelineRows || []).length,
        error: tlError?.message || null,
        rows: timelineRows || [],
      },
      evidence_table: {
        count: evidenceRows.length,
        error: evidenceError,
        rows: evidenceRows,
      },
      contactCounts,
    });
  } catch (err: any) {
    sendDebugError(res, err);
  }
});

// ─── Debug: test PDF storage upload ─────────────────────────
router.post('/api/debug/test-pdf-storage', async (_req: Request, res: Response) => {
  try {
    const supabase = getSupabase();

    // 1. Check bucket exists and its config
    const { data: buckets } = await supabase.storage.listBuckets();
    const privateBucket = buckets?.find((b: any) => b.name === STORAGE_BUCKETS.privateFiles);
    const publicBucket = buckets?.find((b: any) => b.name === STORAGE_BUCKETS.publicAssets);
    const legacyBucket = buckets?.find((b: any) => b.name === STORAGE_BUCKETS.legacyFiles);

    // 2. Try uploading a tiny test PDF
    const testPdf = Buffer.from('%PDF-1.0\ntest');
    const testPath = `test/pdf-upload-test-${Date.now()}.pdf`;
    const { error: uploadErr } = await supabase.storage
      .from(STORAGE_BUCKETS.privateFiles)
      .upload(testPath, testPdf, { contentType: 'application/pdf', upsert: true });

    // 3. Clean up test file
    if (!uploadErr) {
      await supabase.storage.from(STORAGE_BUCKETS.privateFiles).remove([testPath]);
    }

    // 4. Check if any enrollments have packet_pdf_path set
    const { data: withPacket } = await supabase
      .from('enrollments')
      .select('id, packet_pdf_path')
      .not('packet_pdf_path', 'is', null)
      .limit(5);

    res.json({
      _debug: true,
      buckets: {
        privateFiles: privateBucket ? { name: privateBucket.name, public: privateBucket.public, fileSizeLimit: (privateBucket as any).file_size_limit, allowedMimeTypes: (privateBucket as any).allowed_mime_types } : 'NOT FOUND',
        publicAssets: publicBucket ? { name: publicBucket.name, public: publicBucket.public, fileSizeLimit: (publicBucket as any).file_size_limit, allowedMimeTypes: (publicBucket as any).allowed_mime_types } : 'NOT FOUND',
        legacyFiles: legacyBucket ? { name: legacyBucket.name, public: legacyBucket.public, fileSizeLimit: (legacyBucket as any).file_size_limit, allowedMimeTypes: (legacyBucket as any).allowed_mime_types } : 'NOT FOUND',
      },
      pdfUploadTest: uploadErr ? { error: uploadErr.message, statusCode: (uploadErr as any).statusCode } : 'SUCCESS',
      enrollmentsWithPacket: withPacket || [],
    });
  } catch (err: any) {
    sendDebugError(res, err);
  }
});

export default router;
