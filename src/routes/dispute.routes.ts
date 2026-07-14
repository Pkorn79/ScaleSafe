import { Router, Request, Response } from 'express';
import { getSupabase } from '../clients/supabase.client';
import { stripeDisputeService } from '../services/stripe-dispute.service';
import { stripeEfwService } from '../services/stripe-efw.service';
import { merchantRepository } from '../repositories/merchant.repository';
import { ssoAuth } from '../middleware/ssoAuth';
import { requireTenant } from '../middleware/tenantContext';
import { config } from '../config';
import { logger } from '../utils/logger';

const Stripe = require('stripe');

const router = Router();

// All dispute routes require authenticated tenant context.
router.use(ssoAuth, requireTenant);

/**
 * Verify the URL tenant identifier belongs to the SSO-authenticated tenant.
 * Existing UI paths pass locationId, while Stripe services use merchant UUIDs.
 * Returns the verified merchant UUID on success, or sends 403/404 and returns null.
 */
async function requireMatchingMerchant(req: Request, res: Response): Promise<string | null> {
  const locationId = req.tenantContext?.locationId;
  if (!locationId) {
    res.status(401).json({ error: 'AUTHENTICATION_ERROR' });
    return null;
  }
  const merchant = await merchantRepository.findByLocationId(locationId);
  if (!merchant) {
    res.status(404).json({ error: 'Merchant not found for tenant' });
    return null;
  }
  if (merchant.id !== req.params.merchantId && merchant.location_id !== req.params.merchantId) {
    logger.warn(
      { tenantMerchantId: merchant.id, tenantLocationId: merchant.location_id, urlMerchantId: req.params.merchantId, locationId },
      'Dispute route tenant mismatch',
    );
    res.status(403).json({ error: 'Tenant mismatch' });
    return null;
  }
  return merchant.id;
}

// ─── Dispute Endpoints ──────────────────────────────────────────────

// GET /api/disputes/:merchantId — list active disputes
router.get('/:merchantId', async (req: Request, res: Response) => {
  const merchantId = await requireMatchingMerchant(req, res);
  if (!merchantId) return;
  try {
    const supabase = getSupabase();
    // Stripe queue only — NMI/manual dispute rows (created server-side by
    // compileDefense) live in the Defense tab, not here.
    const { data: disputes } = await supabase
      .from('dispute_events')
      .select('*')
      .eq('merchant_id', merchantId)
      .eq('processor', 'stripe')
      .in('status', ['needs_response', 'warning_needs_response', 'under_review', 'warning_under_review'])
      .order('created_at', { ascending: false })
      .limit(50);

    // Attach the defense packet id (if one was prepared) so the UI can link
    // straight to the review/submit flow.
    const rows = disputes || [];
    const disputeIds = rows.map((d: any) => d.id);
    if (disputeIds.length) {
      const { data: packets } = await supabase
        .from('defense_packets')
        .select('id, dispute_event_id')
        .in('dispute_event_id', disputeIds);
      const packetByDispute = new Map((packets || []).map((p: any) => [p.dispute_event_id, p.id]));
      rows.forEach((d: any) => { d.defense_packet_id = packetByDispute.get(d.id) || null; });
    }
    rows.forEach((d: any) => { d.ce3_eligible = stripeDisputeService.getCe3Eligibility(d).eligible; });

    res.json({ disputes: rows });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Failed to list disputes');
    res.status(500).json({ error: 'Failed to list disputes' });
  }
});

// GET /api/disputes/:merchantId/:disputeId — get single dispute with evidence packet
router.get('/:merchantId/:disputeId', async (req: Request, res: Response) => {
  const merchantId = await requireMatchingMerchant(req, res);
  if (!merchantId) return;
  try {
    const { data: dispute } = await getSupabase()
      .from('dispute_events')
      .select('*')
      .eq('merchant_id', merchantId)
      .eq('id', req.params.disputeId)
      .single();

    if (!dispute) {
      res.status(404).json({ error: 'Dispute not found' });
      return;
    }

    const packet = await stripeDisputeService.assembleEvidencePacket(
      dispute.stripe_dispute_id,
      merchantId,
    );

    res.json({ dispute, evidencePacket: packet });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Failed to get dispute');
    res.status(500).json({ error: 'Failed to get dispute' });
  }
});

// POST /api/disputes/:merchantId/:disputeId/prepare — build a defense packet
// for this dispute (same gated path as the webhook auto-prepare). Never submits.
router.post('/:merchantId/:disputeId/prepare', async (req: Request, res: Response) => {
  const merchantId = await requireMatchingMerchant(req, res);
  if (!merchantId) return;
  try {
    const supabase = getSupabase();
    const { data: dispute } = await supabase
      .from('dispute_events')
      .select('*')
      .eq('merchant_id', merchantId)
      .eq('id', req.params.disputeId)
      .single();

    if (!dispute?.stripe_dispute_id) {
      res.status(404).json({ error: 'Dispute not found' });
      return;
    }

    const merchant = await merchantRepository.findByLocationId(req.tenantContext!.locationId!);
    const { defenseService } = require('../services/defense.service');
    const defenseId = await defenseService.prepareForStripeDispute({
      merchant,
      stripeDispute: dispute.raw_dispute_object || { id: dispute.stripe_dispute_id },
    });

    if (!defenseId) {
      res.status(422).json({
        error: 'CONTACT_UNRESOLVED',
        message: 'This dispute could not be matched to a ScaleSafe contact, so a defense packet cannot be prepared automatically. Create one from the client\'s profile instead.',
      });
      return;
    }

    res.json({ defensePacketId: defenseId });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Failed to prepare defense packet for dispute');
    res.status(500).json({ error: 'Failed to prepare defense packet' });
  }
});

// POST /api/disputes/:merchantId/:disputeId/submit — DEPRECATED direct vault
// submit. Evidence now only reaches Stripe through a reviewed defense packet's
// Mark Submitted flow (scope + fallback-letter + idempotency gates).
router.post('/:merchantId/:disputeId/submit', async (req: Request, res: Response) => {
  const merchantId = await requireMatchingMerchant(req, res);
  if (!merchantId) return;
  const { data: packet } = await getSupabase()
    .from('defense_packets')
    .select('id')
    .eq('dispute_event_id', req.params.disputeId)
    .eq('location_id', req.tenantContext!.locationId!)
    .limit(1)
    .maybeSingle();
  res.status(409).json({
    error: 'USE_DEFENSE_PACKET_FLOW',
    message: 'Evidence is submitted by reviewing the defense packet and marking it submitted — direct submission is disabled.',
    defensePacketId: packet?.id || null,
  });
});

// POST /api/disputes/:merchantId/:disputeId/accept — accept (don't fight)
router.post('/:merchantId/:disputeId/accept', async (req: Request, res: Response) => {
  const merchantId = await requireMatchingMerchant(req, res);
  if (!merchantId) return;
  try {
    const supabase = getSupabase();

    const { data: dispute } = await supabase
      .from('dispute_events')
      .select('*')
      .eq('merchant_id', merchantId)
      .eq('id', req.params.disputeId)
      .single();

    if (!dispute) {
      res.status(404).json({ error: 'Dispute not found' });
      return;
    }

    const { data: merchant } = await supabase
      .from('merchants')
      .select('stripe_user_id')
      .eq('id', merchantId)
      .single();

    if (!merchant?.stripe_user_id) {
      res.status(400).json({ error: 'Merchant has no Stripe account connected' });
      return;
    }

    const stripe = new Stripe(config.stripe.secretKey);
    await stripe.disputes.close(
      dispute.stripe_dispute_id,
      { stripeAccount: merchant.stripe_user_id },
    );

    await supabase
      .from('dispute_events')
      .update({ outcome: 'accepted' })
      .eq('id', req.params.disputeId)
      .eq('merchant_id', merchantId);

    res.json({ success: true, action: 'accepted' });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Failed to accept dispute');
    res.status(500).json({ error: 'Failed to accept dispute' });
  }
});

export default router;
