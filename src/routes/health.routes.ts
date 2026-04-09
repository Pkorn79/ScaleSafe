import { Router, Request, Response } from 'express';
import { getSupabase } from '../clients/supabase.client';
import { ghlApi } from '../clients/ghl.client';
import { merchantRepository } from '../repositories/merchant.repository';
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

export default router;
