/**
 * Stripe Defense Layer Routes — Phase S4
 *
 * Endpoints for account health, radar management, descriptor analysis,
 * and pre-dispute prevention checklists.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { ssoAuth } from '../middleware/ssoAuth';
import { requireTenant, resolveLocationId } from '../middleware/tenantContext';
import { stripeHealthService } from '../services/stripe-health.service';
import { stripeRadarService } from '../services/stripe-radar.service';
import { stripeDescriptorService } from '../services/stripe-descriptor.service';
import { stripePreventionService } from '../services/stripe-prevention.service';
import { runDailyHealthCheck } from '../jobs/daily-health-check';
import { ValidationError } from '../utils/errors';
import { getSupabase } from '../clients/supabase.client';

const router = Router();

// All routes require SSO authentication
router.use(ssoAuth, requireTenant);

// ─── Account Health ─────────────────────────────────────────────────

/** GET /api/stripe/health — get latest health snapshot for current merchant */
router.get('/health', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const locationId = resolveLocationId(req);
    if (!locationId) throw new ValidationError('locationId required');

    const { data: merchant } = await getSupabase()
      .from('merchants')
      .select('id')
      .eq('location_id', locationId)
      .single();

    if (!merchant) throw new ValidationError('Merchant not found');

    const snapshot = await stripeHealthService.getLatestSnapshot(merchant.id, locationId);
    res.json({ snapshot: snapshot || null });
  } catch (err) { next(err); }
});

/** GET /api/stripe/health/history — get trend data (last 30 snapshots) */
router.get('/health/history', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const locationId = resolveLocationId(req);
    if (!locationId) throw new ValidationError('locationId required');

    const { data: merchant } = await getSupabase()
      .from('merchants')
      .select('id')
      .eq('location_id', locationId)
      .single();

    if (!merchant) throw new ValidationError('Merchant not found');

    const snapshots = await stripeHealthService.getSnapshotHistory(merchant.id, locationId);
    res.json({ snapshots });
  } catch (err) { next(err); }
});

/** POST /api/stripe/health/compute — trigger health snapshot computation */
router.post('/health/compute', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const locationId = resolveLocationId(req);
    if (!locationId) throw new ValidationError('locationId required');

    const { data: merchant } = await getSupabase()
      .from('merchants')
      .select('id')
      .eq('location_id', locationId)
      .single();

    if (!merchant) throw new ValidationError('Merchant not found');

    const snapshot = await stripeHealthService.computeHealthSnapshot(merchant.id, locationId);
    res.json({ snapshot });
  } catch (err) { next(err); }
});

// ─── Radar Management ───────────────────────────────────────────────

/** GET /api/stripe/radar/blocked-cards — list blocked cards */
router.get('/radar/blocked-cards', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const locationId = resolveLocationId(req);
    if (!locationId) throw new ValidationError('locationId required');

    const { data: merchant } = await getSupabase()
      .from('merchants')
      .select('id, stripe_user_id')
      .eq('location_id', locationId)
      .single();

    if (!merchant?.stripe_user_id) {
      res.json({ blockedCards: [] });
      return;
    }

    const cards = await stripeRadarService.getBlockedCards(merchant.id, locationId, merchant.stripe_user_id);
    res.json({ blockedCards: cards });
  } catch (err) { next(err); }
});

// ─── Descriptor Analysis ────────────────────────────────────────────

/** GET /api/stripe/descriptor/analysis — analyze statement descriptor quality */
router.get('/descriptor/analysis', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const locationId = resolveLocationId(req);
    if (!locationId) throw new ValidationError('locationId required');

    const { data: merchant } = await getSupabase()
      .from('merchants')
      .select('id')
      .eq('location_id', locationId)
      .single();

    if (!merchant) throw new ValidationError('Merchant not found');

    const analysis = await stripeDescriptorService.analyzeDescriptorQuality(merchant.id, locationId);
    res.json(analysis);
  } catch (err) { next(err); }
});

/** POST /api/stripe/descriptor/format — format a descriptor suffix */
router.post('/descriptor/format', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { offerTitle, merchantPrefix } = req.body;
    if (!offerTitle) throw new ValidationError('offerTitle required');

    const suffix = stripeDescriptorService.formatDescriptorSuffix(offerTitle);
    const full = merchantPrefix
      ? stripeDescriptorService.getFullDescriptor(merchantPrefix, offerTitle)
      : undefined;

    res.json({ suffix, fullDescriptor: full });
  } catch (err) { next(err); }
});

// ─── Prevention Checklists ──────────────────────────────────────────

/** GET /api/stripe/prevention — full prevention coverage summary */
router.get('/prevention', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const locationId = resolveLocationId(req);
    if (!locationId) throw new ValidationError('locationId required');

    const { data: merchant } = await getSupabase()
      .from('merchants')
      .select('id')
      .eq('location_id', locationId)
      .single();

    if (!merchant) throw new ValidationError('Merchant not found');

    const coverage = await stripePreventionService.getPreventionCoverage(merchant.id, locationId);
    res.json(coverage);
  } catch (err) { next(err); }
});

/** GET /api/stripe/prevention/ce30 — CE 3.0 readiness check */
router.get('/prevention/ce30', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const locationId = resolveLocationId(req);
    if (!locationId) throw new ValidationError('locationId required');

    const { data: merchant } = await getSupabase()
      .from('merchants')
      .select('id')
      .eq('location_id', locationId)
      .single();

    if (!merchant) throw new ValidationError('Merchant not found');

    const readiness = await stripePreventionService.checkCe30Readiness(merchant.id, locationId);
    res.json(readiness);
  } catch (err) { next(err); }
});

// ─── Admin: Daily Health Check ──────────────────────────────────────

/** POST /api/stripe/admin/run-health-check — trigger daily health computation */
router.post('/admin/run-health-check', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    // Fire and forget — respond immediately
    runDailyHealthCheck().catch(err => {
      console.error('Daily health check failed:', err);
    });
    res.json({ message: 'Health check started' });
  } catch (err) { next(err); }
});

export default router;
