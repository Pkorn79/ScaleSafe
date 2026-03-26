import { Router, Request, Response, NextFunction } from 'express';
import { exchangeCodeForTokens } from '../clients/ghl.client';
import { merchantRepository } from '../repositories/merchant.repository';
import { logger } from '../utils/logger';
import { ValidationError } from '../utils/errors';

const router = Router();

/**
 * GET /auth/callback
 * GHL OAuth callback — exchanges authorization code for tokens and provisions the merchant.
 */
router.get('/auth/callback', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const code = req.query.code as string;
    if (!code) throw new ValidationError('Missing authorization code');

    logger.info('OAuth callback received, exchanging code for tokens');

    const tokens = await exchangeCodeForTokens(code);

    // GHL includes locationId in the callback — extract from the decoded token or query
    // For marketplace apps, the location info comes in the token response
    // We'll store the merchant once we have the location context
    // TODO: Extract locationId from token response and call merchant provisioning

    logger.info('OAuth token exchange successful');

    res.json({ success: true, message: 'ScaleSafe installed successfully' });
  } catch (err) {
    next(err);
  }
});

export default router;
