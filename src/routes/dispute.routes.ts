import { Router, Request, Response } from 'express';
import { getSupabase } from '../clients/supabase.client';
import { stripeDisputeService } from '../services/stripe-dispute.service';
import { stripeEfwService } from '../services/stripe-efw.service';
import { config } from '../config';
import { logger } from '../utils/logger';

const Stripe = require('stripe');

const router = Router();

// ─── Dispute Endpoints ──────────────────────────────────────────────

// GET /api/disputes/:merchantId — list active disputes
router.get('/:merchantId', async (req: Request, res: Response) => {
  try {
    const { data: disputes } = await getSupabase()
      .from('dispute_events')
      .select('*')
      .eq('merchant_id', req.params.merchantId)
      .order('created_at', { ascending: false })
      .limit(50);

    res.json({ disputes: disputes || [] });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Failed to list disputes');
    res.status(500).json({ error: 'Failed to list disputes' });
  }
});

// GET /api/disputes/:merchantId/:disputeId — get single dispute with evidence packet
router.get('/:merchantId/:disputeId', async (req: Request, res: Response) => {
  try {
    const { data: dispute } = await getSupabase()
      .from('dispute_events')
      .select('*')
      .eq('merchant_id', req.params.merchantId)
      .eq('id', req.params.disputeId)
      .single();

    if (!dispute) {
      res.status(404).json({ error: 'Dispute not found' });
      return;
    }

    const packet = await stripeDisputeService.assembleEvidencePacket(
      dispute.stripe_dispute_id,
      req.params.merchantId,
    );

    res.json({ dispute, evidencePacket: packet });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Failed to get dispute');
    res.status(500).json({ error: 'Failed to get dispute' });
  }
});

// POST /api/disputes/:merchantId/:disputeId/submit — submit evidence
router.post('/:merchantId/:disputeId/submit', async (req: Request, res: Response) => {
  try {
    const { autoSubmit } = req.body;
    const supabase = getSupabase();

    const { data: dispute } = await supabase
      .from('dispute_events')
      .select('*')
      .eq('merchant_id', req.params.merchantId)
      .eq('id', req.params.disputeId)
      .single();

    if (!dispute) {
      res.status(404).json({ error: 'Dispute not found' });
      return;
    }

    const packet = await stripeDisputeService.assembleEvidencePacket(
      dispute.stripe_dispute_id,
      req.params.merchantId,
    );

    const result = await stripeDisputeService.submitEvidence({
      stripeDisputeId: dispute.stripe_dispute_id,
      merchantId: req.params.merchantId,
      evidence: packet.evidence,
      autoSubmit: autoSubmit !== false,
    });

    res.json(result);
  } catch (err: any) {
    logger.error({ err: err.message }, 'Failed to submit evidence');
    res.status(500).json({ error: 'Failed to submit evidence' });
  }
});

// POST /api/disputes/:merchantId/:disputeId/accept — accept (don't fight)
router.post('/:merchantId/:disputeId/accept', async (req: Request, res: Response) => {
  try {
    const supabase = getSupabase();

    const { data: dispute } = await supabase
      .from('dispute_events')
      .select('*')
      .eq('merchant_id', req.params.merchantId)
      .eq('id', req.params.disputeId)
      .single();

    if (!dispute) {
      res.status(404).json({ error: 'Dispute not found' });
      return;
    }

    const { data: merchant } = await supabase
      .from('merchants')
      .select('stripe_user_id')
      .eq('id', req.params.merchantId)
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
      .eq('merchant_id', req.params.merchantId);

    res.json({ success: true, action: 'accepted' });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Failed to accept dispute');
    res.status(500).json({ error: 'Failed to accept dispute' });
  }
});

export default router;
