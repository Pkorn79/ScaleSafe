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

// Debug endpoint — create storage bucket (remove after bucket is confirmed working)
router.get('/api/debug/create-bucket', async (_req: Request, res: Response) => {
  const supabase = getSupabase();
  const results: Record<string, any> = {};

  // Step 1: List existing buckets
  try {
    const { data, error } = await supabase.storage.listBuckets();
    results.listBuckets = { data: data?.map((b: any) => b.name), error: error?.message || null };
  } catch (err: any) {
    results.listBuckets = { error: err.message };
  }

  // Step 2: Try getBucket
  try {
    const { data, error } = await supabase.storage.getBucket('scalesafe-files');
    results.getBucket = { exists: !!data, error: error?.message || null };
  } catch (err: any) {
    results.getBucket = { error: err.message };
  }

  // Step 3: Try createBucket if not found
  if (!results.getBucket?.exists) {
    try {
      const { data, error } = await supabase.storage.createBucket('scalesafe-files', {
        public: true,
        fileSizeLimit: 5242880,
        allowedMimeTypes: ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'],
      });
      results.createBucket = { data, error: error?.message || null };
    } catch (err: any) {
      results.createBucket = { error: err.message };
    }

    // Step 4: Verify it exists now
    try {
      const { data, error } = await supabase.storage.getBucket('scalesafe-files');
      results.verifyAfterCreate = { exists: !!data, error: error?.message || null };
    } catch (err: any) {
      results.verifyAfterCreate = { error: err.message };
    }
  }

  res.json(results);
});

export default router;
