/**
 * health.routes.ts — Health Check Endpoints
 *
 * Provides /health (basic liveness) and /ready (readiness with dependency checks).
 * Used by hosting platforms (Render, Railway) to know when the app is ready for traffic.
 */

import { Router, Request, Response } from 'express';
import { getSupabaseClient } from '../clients/supabase.client';

const router = Router();

/** Basic liveness check — returns 200 if the server is running. */
router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/** Readiness check — verifies Supabase connectivity before accepting traffic. */
router.get('/ready', async (_req: Request, res: Response) => {
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from('merchants').select('id').limit(1);

    if (error) {
      res.status(503).json({
        status: 'not ready',
        supabase: 'error',
        error: error.message,
      });
      return;
    }

    res.json({
      status: 'ready',
      supabase: 'connected',
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(503).json({
      status: 'not ready',
      error: err.message,
    });
  }
});

export default router;
