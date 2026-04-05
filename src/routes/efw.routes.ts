import { Router, Request, Response } from 'express';
import { getSupabase } from '../clients/supabase.client';
import { stripeEfwService } from '../services/stripe-efw.service';
import { logger } from '../utils/logger';

const router = Router();

// GET /api/efws/:merchantId — list EFWs
router.get('/:merchantId', async (req: Request, res: Response) => {
  try {
    const { data: efws } = await getSupabase()
      .from('efw_events')
      .select('*')
      .eq('merchant_id', req.params.merchantId)
      .order('created_at', { ascending: false })
      .limit(50);

    res.json({ efws: efws || [] });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Failed to list EFWs');
    res.status(500).json({ error: 'Failed to list EFWs' });
  }
});

// POST /api/efws/:merchantId/:efwId/respond — respond to EFW
router.post('/:merchantId/:efwId/respond', async (req: Request, res: Response) => {
  try {
    const { action } = req.body;

    if (!action || (action !== 'refund' && action !== 'hold')) {
      res.status(400).json({ error: 'action must be "refund" or "hold"' });
      return;
    }

    const result = await stripeEfwService.respondToEfw({
      efwId: req.params.efwId,
      merchantId: req.params.merchantId,
      action,
    });

    res.json(result);
  } catch (err: any) {
    logger.error({ err: err.message }, 'Failed to respond to EFW');
    res.status(500).json({ error: err.message || 'Failed to respond to EFW' });
  }
});

export default router;
