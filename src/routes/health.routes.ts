import { Router, Request, Response } from 'express';
import { getSupabase } from '../clients/supabase.client';
import { ghlApi } from '../clients/ghl.client';
import { merchantRepository } from '../repositories/merchant.repository';
import { evidenceService } from '../services/evidence.service';
import { logger } from '../utils/logger';

const router = Router();

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
            responseData: searchErr.response?.data,
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

      // Test actual upsert (creates or finds the contact)
      try {
        const email = enrollment.email;
        if (email) {
          const upsertRes = await api.post('/contacts/upsert', {
            firstName: email.split('@')[0] || 'TestClient',
            email: email,
            locationId: locationId,
          });
          const cid = upsertRes.data?.contact?.id || upsertRes.data?.id || '';
          ghlDiagnostic.upsertTest = { success: true, contactId: cid, error: '' };

          // If we got a contactId, update the enrollment record
          if (cid && !enrollment.contact_id) {
            await supabase.from('enrollments').update({ contact_id: cid }).eq('id', enrollment.id);
            ghlDiagnostic.upsertTest.contactId += ' (saved to enrollment)';
          }
        } else {
          ghlDiagnostic.upsertTest = { success: false, contactId: '', error: 'no email on enrollment' };
        }
      } catch (upsertErr: any) {
        ghlDiagnostic.upsertTest = {
          success: false,
          contactId: '',
          error: upsertErr.message || 'upsert failed',
          status: (upsertErr as any).response?.status,
          responseData: (upsertErr as any).response?.data,
        };
      }
    } catch (apiErr: any) {
      ghlDiagnostic.ghlApiInit = {
        success: false,
        error: apiErr.message || 'ghlApi init failed',
        status: apiErr.response?.status,
        responseData: apiErr.response?.data,
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message, stack: err.stack });
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
    res.status(500).json({ error: err.message, stack: err.stack });
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
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

// ─── Debug: backfill all enrollments missing contactId ───────
router.get('/api/debug/backfill-contacts/:locationId', async (req: Request, res: Response) => {
  try {
    const locationId = req.params.locationId;
    const supabase = getSupabase();

    const { data: broken } = await supabase
      .from('enrollments')
      .select('id, email, contact_id')
      .eq('location_id', locationId)
      .eq('status', 'enrolled')
      .is('contact_id', null);

    if (!broken || broken.length === 0) {
      res.json({ _debug: true, message: 'No enrollments need backfill', count: 0 });
      return;
    }

    const api = await ghlApi(locationId);
    const results: any[] = [];

    for (const enrollment of broken) {
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
          await supabase.from('payment_events')
            .update({ contact_id: newContactId })
            .eq('enrollment_id', enrollment.id)
            .eq('contact_id', '');
          await supabase.from('payment_customer_map')
            .update({ contact_id: newContactId })
            .eq('location_id', locationId)
            .eq('contact_id', '');
          results.push({ id: enrollment.id, email, status: 'fixed', contactId: newContactId });
        } else {
          results.push({ id: enrollment.id, email, status: 'failed', reason: 'upsert returned no id' });
        }
      } catch (err: any) {
        results.push({ id: enrollment.id, email, status: 'error', reason: err.message });
      }
    }

    res.json({ _debug: true, totalBroken: broken.length, results });
  } catch (err: any) {
    logger.error({ err: err.message, stack: err.stack }, 'debug backfill-contacts failed');
    res.status(500).json({ error: err.message, stack: err.stack });
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
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

export default router;
