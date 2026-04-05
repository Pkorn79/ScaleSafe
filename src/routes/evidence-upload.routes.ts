import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { stripeEvidenceVaultService } from '../services/stripe-evidence-vault.service';
import { evidenceChainService } from '../services/evidence-chain.service';
import { ssoAuth } from '../middleware/ssoAuth';
import { merchantRepository } from '../repositories/merchant.repository';
import { getSupabase } from '../clients/supabase.client';
import { ValidationError } from '../utils/errors';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024 } });

// POST /api/evidence/upload-contract
router.post('/upload-contract', ssoAuth, upload.single('file'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const locationId = (req as any).locationId;
    const { clientContactId, offerId } = req.body;

    if (!req.file || !clientContactId || !offerId) throw new ValidationError('Missing file, clientContactId, or offerId');

    const merchant = await merchantRepository.getByLocationId(locationId);

    const fileId = await stripeEvidenceVaultService.uploadContractFile({
      merchantId: merchant.id,
      stripeUserId: merchant.stripe_user_id || '',
      clientContactId,
      offerId,
      fileBuffer: req.file.buffer,
      fileName: req.file.originalname,
    });

    res.json({ success: true, fileId });
  } catch (err) {
    next(err);
  }
});

// POST /api/evidence/log-session
router.post('/log-session', ssoAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const locationId = (req as any).locationId;
    const { clientContactId, offerId, sessionDate, sessionType, sessionNotes, durationMinutes } = req.body;

    if (!clientContactId || !offerId || !sessionDate || !sessionNotes) {
      throw new ValidationError('Missing required session fields');
    }

    const merchant = await merchantRepository.getByLocationId(locationId);

    const fileId = await stripeEvidenceVaultService.uploadSessionLog({
      merchantId: merchant.id,
      stripeUserId: merchant.stripe_user_id || '',
      clientContactId,
      offerId,
      sessionDate,
      sessionType: sessionType || 'session',
      sessionNotes,
      durationMinutes: durationMinutes ? parseInt(durationMinutes, 10) : undefined,
    });

    res.json({ success: true, fileId });
  } catch (err) {
    next(err);
  }
});

// POST /api/evidence/upload-communication
router.post('/upload-communication', ssoAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const locationId = (req as any).locationId;
    const { clientContactId, offerId, communicationType, messages } = req.body;

    if (!clientContactId || !offerId || !messages?.length) {
      throw new ValidationError('Missing required fields');
    }

    const merchant = await merchantRepository.getByLocationId(locationId);

    const fileId = await stripeEvidenceVaultService.uploadCommunicationTrail({
      merchantId: merchant.id,
      stripeUserId: merchant.stripe_user_id || '',
      clientContactId,
      offerId,
      communicationType: communicationType || 'email',
      messages,
    });

    res.json({ success: true, fileId });
  } catch (err) {
    next(err);
  }
});

// GET /api/evidence/status
router.get('/status', ssoAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const locationId = (req as any).locationId;
    const merchant = await merchantRepository.getByLocationId(locationId);

    const { data: entries } = await getSupabase()
      .from('stripe_evidence_vault')
      .select('evidence_score')
      .eq('merchant_id', merchant.id);

    if (!entries?.length) {
      res.json({ totalTransactions: 0, avgScore: 0, distribution: {} });
      return;
    }

    const totalTransactions = entries.length;
    const avgScore = Math.round(entries.reduce((sum: number, e: any) => sum + e.evidence_score, 0) / totalTransactions);

    res.json({
      totalTransactions,
      avgScore,
      avgScorePercent: `${avgScore}%`,
      distribution: {
        complete: entries.filter((e: any) => e.evidence_score >= 80).length,
        partial: entries.filter((e: any) => e.evidence_score >= 40 && e.evidence_score < 80).length,
        minimal: entries.filter((e: any) => e.evidence_score > 0 && e.evidence_score < 40).length,
        none: entries.filter((e: any) => e.evidence_score === 0).length,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/evidence/chain/:paymentEventId
router.get('/chain/:paymentEventId', ssoAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await evidenceChainService.verifyChain(req.params.paymentEventId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
