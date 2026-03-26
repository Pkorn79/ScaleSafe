/**
 * auth.routes.ts — Authentication Routes
 *
 * Handles two auth flows:
 * 1. /authorize-handler — GHL OAuth callback. When a merchant installs ScaleSafe
 *    from the GHL Marketplace, GHL redirects here with an authorization code.
 *    We exchange it for tokens and provision the merchant.
 * 2. /decrypt-sso — Decrypts SSO data for embedded GHL pages.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { GhlClient } from '../clients/ghl.client';
import { tokenStore } from '../repositories/merchant.repository';
import { decryptSSOData } from '../utils/crypto';
import { config } from '../config';
import { BadRequestError } from '../utils/errors';
import { logger } from '../utils/logger';
import * as merchantService from '../services/merchant.service';

const router = Router();
const ghlClient = new GhlClient(tokenStore);

/**
 * GHL OAuth callback.
 * GHL sends users here after they authorize the app.
 * We exchange the code for tokens, provision the merchant, then redirect back to GHL.
 */
router.get('/authorize-handler', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code } = req.query;
    if (!code || typeof code !== 'string') {
      throw new BadRequestError('Missing authorization code');
    }

    const tokenData = await ghlClient.handleAuthorization(code);
    logger.info(
      { locationId: tokenData.locationId, companyId: tokenData.companyId },
      'Merchant authorized successfully'
    );

    // Provision the merchant (fetch Custom Values, create/update merchants record)
    const locationId = tokenData.locationId || tokenData.companyId;
    if (locationId) {
      try {
        await merchantService.provision(locationId);
      } catch (err) {
        logger.error({ err, locationId }, 'Merchant provisioning failed — tokens saved, config pending');
      }
    }

    // Redirect merchant back to GHL after successful install
    res.redirect('https://app.gohighlevel.com/');
  } catch (error) {
    next(error);
  }
});

/**
 * SSO decryption endpoint.
 * GHL embedded pages send the encrypted SSO key here to get user context.
 */
router.post('/decrypt-sso', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { key } = req.body || {};
    if (!key) {
      throw new BadRequestError('Missing SSO key');
    }

    const data = decryptSSOData(key, config.ghl.ssoKey);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

export default router;
