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

export default router;
