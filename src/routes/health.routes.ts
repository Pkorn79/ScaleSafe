import { Router, Request, Response } from 'express';
import { getSupabase } from '../clients/supabase.client';

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

// Temporary — backfill contact_id on enrollments that have email but no contact_id
router.get('/api/debug/backfill-contacts', async (_req: Request, res: Response) => {
  const supabase = getSupabase();
  const results: any[] = [];

  try {
    // Find enrollments with email but no contact_id
    const { data: enrollments } = await supabase
      .from('enrollments')
      .select('id, email, location_id, consent_token')
      .is('contact_id', null)
      .not('email', 'is', null);

    if (!enrollments || enrollments.length === 0) {
      res.json({ message: 'No enrollments to backfill', count: 0 });
      return;
    }

    const { ghlApi } = await import('../clients/ghl.client');

    for (const enrollment of enrollments) {
      try {
        const api = await ghlApi(enrollment.location_id);
        const upsertRes = await api.post('/contacts/upsert', {
          firstName: enrollment.email.split('@')[0] || 'Client',
          email: enrollment.email,
          locationId: enrollment.location_id,
        });
        const contactId = upsertRes.data.contact?.id || upsertRes.data.id || '';

        if (contactId) {
          await supabase.from('enrollments').update({ contact_id: contactId }).eq('id', enrollment.id);
          if (enrollment.consent_token) {
            await supabase.from('payment_events').update({ contact_id: contactId }).eq('consent_token', enrollment.consent_token);
            await supabase.from('payment_customer_map').update({ contact_id: contactId }).eq('location_id', enrollment.location_id).eq('contact_id', '');
          }
          results.push({ email: enrollment.email, contactId, status: 'ok' });
        } else {
          results.push({ email: enrollment.email, status: 'no_contact_id_returned' });
        }
      } catch (err: any) {
        results.push({ email: enrollment.email, status: 'error', error: err.message });
      }
    }

    res.json({ backfilled: results.length, results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Temporary debug — check what data exists (remove after debugging)
router.get('/api/debug/data-check', async (_req: Request, res: Response) => {
  const supabase = getSupabase();
  const results: Record<string, any> = {};

  try {
    const { data: enrollments, count: eCount } = await supabase
      .from('enrollments')
      .select('id, status, contact_id, email, offer_id, consent_token, location_id, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .limit(5);
    results.enrollments = { count: eCount, recent: enrollments };
  } catch (e: any) { results.enrollments = { error: e.message }; }

  try {
    const { data: paymentEvents, count: peCount } = await supabase
      .from('payment_events')
      .select('id, event_type, contact_id, amount, processor, consent_token, location_id, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .limit(5);
    results.payment_events = { count: peCount, recent: paymentEvents };
  } catch (e: any) { results.payment_events = { error: e.message }; }

  try {
    const { data: customerMap, count: cmCount } = await supabase
      .from('payment_customer_map')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .limit(5);
    results.payment_customer_map = { count: cmCount, recent: customerMap };
  } catch (e: any) { results.payment_customer_map = { error: e.message }; }

  try {
    const { data: merchants } = await supabase
      .from('merchants')
      .select('id, location_id, business_name, stripe_connected, status')
      .limit(3);
    results.merchants = merchants;
  } catch (e: any) { results.merchants = { error: e.message }; }

  res.json(results);
});

export default router;
