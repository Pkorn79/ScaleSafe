/**
 * merchant.controller.ts — Merchant API Request Handler
 *
 * Handles merchant settings, credential sync, and onboarding.
 * All routes require SSO authentication.
 */

import { Request, Response, NextFunction } from 'express';
import * as merchantService from '../services/merchant.service';

/** Get merchant config for the current location. */
export async function getConfig(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const locationId = (req as any).tenantContext?.locationId;
    const config = await merchantService.getConfig(locationId);

    // Strip sensitive fields before sending to the frontend
    const safeConfig = { ...config } as any;
    delete safeConfig.ghl_access_token;
    delete safeConfig.ghl_refresh_token;
    delete safeConfig.ab_api_key;

    res.json(safeConfig);
  } catch (error) {
    next(error);
  }
}

/** Update merchant settings. */
export async function updateConfig(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const locationId = (req as any).tenantContext?.locationId;
    const updated = await merchantService.updateConfig(locationId, req.body);
    res.json(updated);
  } catch (error) {
    next(error);
  }
}

/** Re-fetch accept.blue credentials from GHL Custom Values. */
export async function syncCredentials(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const locationId = (req as any).tenantContext?.locationId;
    await merchantService.syncCredentials(locationId);
    res.json({ success: true, message: 'Credentials synced from GHL' });
  } catch (error) {
    next(error);
  }
}

/** Handle merchant onboarding funnel submission. */
export async function handleOnboarding(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const locationId = (req as any).tenantContext?.locationId;
    await merchantService.handleOnboardingSubmission(locationId, req.body);
    res.json({ success: true, message: 'Onboarding data saved' });
  } catch (error) {
    next(error);
  }
}
