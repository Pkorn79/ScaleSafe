/**
 * merchant.service.ts — Merchant Management Service
 *
 * Handles merchant provisioning, config management, and credential syncing.
 *
 * - provision(): Called on OAuth callback. Creates/updates the merchant record.
 * - getConfig(): Returns the full merchant config for the portal.
 * - syncCredentials(): Re-fetches accept.blue keys from GHL Custom Values.
 * - handleOnboardingSubmission(): Processes the 4-page onboarding funnel data.
 *
 * Replaces Make.com S1 (Merchant Provisioning).
 */

import { GhlClient } from '../clients/ghl.client';
import {
  tokenStore, findByLocationId, upsert, update,
  MerchantRow,
} from '../repositories/merchant.repository';
import {
  CV_AB_API_KEY, CV_AB_TOKENIZATION_KEY, CV_AB_WEBHOOK_SIGNATURE,
  CV_BUSINESS_LEGAL_NAME, CV_SUPPORT_EMAIL, CV_DESCRIPTOR, CV_DBA_BRAND_NAME,
  CV_INDUSTRY, CV_MERCHANT_LOGO_URL,
  CV_MODULE_SESSION_TRACKING, CV_MODULE_MILESTONE_TRACKING,
  CV_MODULE_PULSE_CHECK, CV_MODULE_PAYMENT_TRACKING, CV_MODULE_COURSE_PROGRESS,
  CV_INCENTIVE_ENABLED, CV_INCENTIVE_TIER1_DESC, CV_INCENTIVE_TIER1_THRESHOLD,
  CV_INCENTIVE_TIER2_DESC, CV_INCENTIVE_TIER2_THRESHOLD,
} from '../constants/ghl-custom-values';
import { logger } from '../utils/logger';
import { NotFoundError } from '../utils/errors';

const ghlClient = new GhlClient(tokenStore);

/**
 * Provisions a merchant after OAuth callback.
 * Fetches their Custom Values from GHL and stores them locally.
 * Idempotent — re-installing updates the existing record.
 */
export async function provision(locationId: string): Promise<MerchantRow> {
  logger.info({ locationId }, 'Provisioning merchant...');

  // Fetch custom values from GHL
  let customValues: Record<string, string> = {};
  try {
    const client = await ghlClient.getAuthenticatedClient(locationId);
    const response = await client.get(`/locations/${locationId}/customValues`, {
      headers: { Version: '2021-07-28' },
    });
    const values = response.data?.customValues || [];
    for (const cv of values) {
      if (cv.fieldKey && cv.value) {
        customValues[cv.fieldKey] = cv.value;
      }
    }
  } catch (err) {
    logger.warn({ err, locationId }, 'Could not fetch custom values — merchant may need manual config');
  }

  // Upsert the merchant record with all config from GHL
  const merchant = await upsert({
    location_id: locationId,
    ab_api_key: customValues[CV_AB_API_KEY.key] || null,
    ab_tokenization_key: customValues[CV_AB_TOKENIZATION_KEY.key] || null,
    ab_webhook_secret: customValues[CV_AB_WEBHOOK_SIGNATURE.key] || null,
    business_name: customValues[CV_BUSINESS_LEGAL_NAME.key] || null,
    dba_name: customValues[CV_DBA_BRAND_NAME.key] || null,
    support_email: customValues[CV_SUPPORT_EMAIL.key] || null,
    descriptor: customValues[CV_DESCRIPTOR.key] || null,
    industry: customValues[CV_INDUSTRY.key] || null,
    logo_url: customValues[CV_MERCHANT_LOGO_URL.key] || null,
    module_sessions: customValues[CV_MODULE_SESSION_TRACKING.key] !== 'false',
    module_milestones: customValues[CV_MODULE_MILESTONE_TRACKING.key] !== 'false',
    module_pulse: customValues[CV_MODULE_PULSE_CHECK.key] !== 'false',
    module_payments: customValues[CV_MODULE_PAYMENT_TRACKING.key] !== 'false',
    module_course: customValues[CV_MODULE_COURSE_PROGRESS.key] !== 'false',
    incentive_enabled: customValues[CV_INCENTIVE_ENABLED.key] === 'Yes',
    incentive_tier1_desc: customValues[CV_INCENTIVE_TIER1_DESC.key] || null,
    incentive_tier1_threshold: customValues[CV_INCENTIVE_TIER1_THRESHOLD.key]
      ? parseInt(customValues[CV_INCENTIVE_TIER1_THRESHOLD.key], 10)
      : null,
    incentive_tier2_desc: customValues[CV_INCENTIVE_TIER2_DESC.key] || null,
    incentive_tier2_threshold: customValues[CV_INCENTIVE_TIER2_THRESHOLD.key]
      ? parseInt(customValues[CV_INCENTIVE_TIER2_THRESHOLD.key], 10)
      : null,
    status: 'active',
  });

  logger.info({ locationId, businessName: merchant.business_name }, 'Merchant provisioned');
  return merchant;
}

/** Returns the full merchant config for the portal. */
export async function getConfig(locationId: string): Promise<MerchantRow> {
  const merchant = await findByLocationId(locationId);
  if (!merchant) throw new NotFoundError('Merchant not found');
  return merchant;
}

/** Updates merchant settings (module toggles, incentive config, etc.). */
export async function updateConfig(
  locationId: string,
  updates: Partial<MerchantRow>
): Promise<MerchantRow> {
  // Prevent updating sensitive fields through this endpoint
  delete (updates as any).ghl_access_token;
  delete (updates as any).ghl_refresh_token;
  delete (updates as any).id;
  delete (updates as any).location_id;

  return update(locationId, updates);
}

/**
 * Re-fetches accept.blue credentials from GHL Custom Values.
 * Used when a merchant updates their AB keys in GHL settings.
 */
export async function syncCredentials(locationId: string): Promise<void> {
  const client = await ghlClient.getAuthenticatedClient(locationId);
  const response = await client.get(`/locations/${locationId}/customValues`, {
    headers: { Version: '2021-07-28' },
  });

  const values = response.data?.customValues || [];
  const customValues: Record<string, string> = {};
  for (const cv of values) {
    if (cv.fieldKey && cv.value) {
      customValues[cv.fieldKey] = cv.value;
    }
  }

  await update(locationId, {
    ab_api_key: customValues[CV_AB_API_KEY.key] || null,
    ab_tokenization_key: customValues[CV_AB_TOKENIZATION_KEY.key] || null,
    ab_webhook_secret: customValues[CV_AB_WEBHOOK_SIGNATURE.key] || null,
  });

  logger.info({ locationId }, 'Merchant credentials synced from GHL');
}

/**
 * Handles the 4-page merchant onboarding funnel submission.
 * Writes the 16 fields to the merchant's GHL Custom Values.
 */
export async function handleOnboardingSubmission(
  locationId: string,
  data: Record<string, unknown>
): Promise<void> {
  const client = await ghlClient.getAuthenticatedClient(locationId);

  // Write business info to GHL custom values
  const customValueUpdates = [
    { key: CV_BUSINESS_LEGAL_NAME.key, value: data.businessLegalName },
    { key: CV_DBA_BRAND_NAME.key, value: data.dbaName },
    { key: CV_SUPPORT_EMAIL.key, value: data.supportEmail },
    { key: CV_DESCRIPTOR.key, value: data.paymentDescriptor },
    { key: CV_INDUSTRY.key, value: data.industry },
  ].filter((cv) => cv.value);

  for (const cv of customValueUpdates) {
    try {
      await client.put(
        `/locations/${locationId}/customValues`,
        { [cv.key]: cv.value },
        { headers: { Version: '2021-07-28' } }
      );
    } catch (err) {
      logger.warn({ err, key: cv.key }, 'Failed to update custom value during onboarding');
    }
  }

  // Update local merchant record
  await update(locationId, {
    business_name: (data.businessLegalName as string) || null,
    dba_name: (data.dbaName as string) || null,
    support_email: (data.supportEmail as string) || null,
    descriptor: (data.paymentDescriptor as string) || null,
    industry: (data.industry as string) || null,
  });

  logger.info({ locationId }, 'Merchant onboarding data saved');
}
