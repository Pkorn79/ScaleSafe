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
