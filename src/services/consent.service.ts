import crypto from 'crypto';
import { enrollmentRepository } from '../repositories/enrollment.repository';
import { phase2EvidenceRepository } from '../repositories/phase2Evidence.repository';
import { offerRepository } from '../repositories/offer.repository';
import { merchantRepository } from '../repositories/merchant.repository';
import { logger } from '../utils/logger';
import { sha256 } from '../utils/crypto';
import { ValidationError } from '../utils/errors';

interface CaptureConsentParams {
  offerId: string;
  locationId: string;
  contactId: string;
  contactEmail: string;
  contactName: string;
  ip: string;
  device: string;
  browser: string;
  tcVersionHash: string;
  signatureText: string;
  consentCheckboxes?: string[];
}

export const consentService = {
  async captureConsent(params: CaptureConsentParams): Promise<{
    consentToken: string;
    enrollmentId: string;
  }> {
    // Validate offer exists and is active
    const offer = await offerRepository.findById(params.offerId);
    if (!offer || !offer.active) {
      throw new ValidationError('Offer not found or inactive');
    }

    // Look up merchant for this location
    const merchant = await merchantRepository.findByLocationId(params.locationId);

    // Generate consent token
    const consentToken = crypto.randomUUID();

    // Create enrollment with consent data
    const enrollment = await enrollmentRepository.create({
      location_id: params.locationId,
      contact_id: params.contactId,
      offer_id: params.offerId,
      merchant_id: merchant?.id || null,
      status: 'consent_captured',
      consent_token: consentToken,
      consent_captured_at: new Date().toISOString(),
      consent_ip: params.ip,
      consent_device: params.device,
      consent_browser: params.browser,
      tc_version_hash: params.tcVersionHash,
    });

    // Log enrollment_consent evidence
    await phase2EvidenceRepository.create({
      location_id: params.locationId,
      contact_id: params.contactId,
      enrollment_id: enrollment.id,
      merchant_id: merchant?.id,
      evidence_type: 'enrollment_consent',
      data: {
        signature_text: params.signatureText,
        tc_version_hash: params.tcVersionHash,
        consent_checkboxes: params.consentCheckboxes || ['terms_accepted', 'refund_policy_accepted'],
        timestamp: new Date().toISOString(),
        contact_email: params.contactEmail,
        contact_name: params.contactName,
        offer_name: offer.offer_name,
      },
      ip_address: params.ip,
      device_info: params.device,
      browser_info: params.browser,
    });

    logger.info(
      { enrollmentId: enrollment.id, consentToken, contactId: params.contactId, offerId: params.offerId, locationId: params.locationId },
      'Consent captured',
    );

    return { consentToken, enrollmentId: enrollment.id };
  },
};
