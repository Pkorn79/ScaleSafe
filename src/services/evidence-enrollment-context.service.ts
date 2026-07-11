import crypto from 'crypto';
import { config } from '../config';
import { ConnectorAuthContext } from '../types/evidence-connector.types';
import { evidenceConnectorRepository } from '../repositories/evidence-connector.repository';
import { offerRepository } from '../repositories/offer.repository';
import { merchantService } from './merchant.service';
import { offerService } from './offer.service';
import { decrypt, encrypt } from '../utils/field-encryption';
import { ValidationError } from '../utils/errors';

function clean(value: unknown, label: string, max = 200): string {
  const result = String(value || '').trim();
  if (!result) throw new ValidationError(`${label} is required`);
  if (result.length > max) throw new ValidationError(`${label} is too long`);
  return result;
}

function tokenHash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function automationEnabled(locationId: string): boolean {
  const automation = config.evidenceConnectorAutomation || { enabled: false, locationIds: [] };
  return automation.enabled
    && (automation.locationIds.length === 0 || automation.locationIds.includes(locationId));
}

function requireAutomation(locationId: string): void {
  if (!automationEnabled(locationId)) {
    throw new ValidationError('Automatic evidence enrollment binding is not enabled for this sub-account');
  }
}

function appendContextToken(baseUrl: string, token: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set('evidenceContextToken', token);
  return url.toString();
}

async function enrollmentUrl(offer: any, token: string): Promise<string> {
  const checkoutMode = (offer.checkout_mode || 'full_enrollment') as 'full_enrollment' | 'quick_checkout';
  let funnelBaseUrl = '';
  if (checkoutMode !== 'quick_checkout') {
    const merchant = await merchantService.getFullConfig(offer.location_id);
    funnelBaseUrl = merchant.enrollmentFunnelUrl || '';
    if (!funnelBaseUrl) {
      throw new ValidationError('This offer needs an Enrollment Funnel URL before an evidence enrollment link can be created');
    }
  }
  return appendContextToken(
    offerService.generateEnrollmentLink(offer.id, config.appUrl, checkoutMode, funnelBaseUrl),
    token,
  );
}

export const evidenceEnrollmentContextService = {
  automationEnabled,

  async createEnrollmentLink(auth: ConnectorAuthContext, input: Record<string, any>) {
    const connection = auth.connection;
    requireAutomation(connection.location_id);
    if (connection.connection_type !== 'canonical_api' || connection.setup_status !== 'active') {
      throw new ValidationError('This evidence connection is not activated for enrollment links');
    }

    const requestId = clean(input.request_id ?? input.requestId, 'request_id');
    const externalContactId = clean(input.external_contact_id ?? input.externalContactId, 'external_contact_id');
    const externalEnrollmentId = clean(input.external_enrollment_id ?? input.externalEnrollmentId, 'external_enrollment_id');
    const resourceType = clean(input.resource?.type ?? input.resource_type, 'resource.type', 100);
    const externalResourceId = clean(input.resource?.id ?? input.external_resource_id, 'resource.id');
    const ttlDays = Math.max(1, Math.min(30, Number(input.expires_in_days ?? input.expiresInDays ?? 7) || 7));

    const mapping = await evidenceConnectorRepository.findResourceMapping(connection.id, resourceType, externalResourceId);
    if (!mapping) throw new ValidationError('This external resource is not approved for a ScaleSafe offer');
    const offer = await offerRepository.getById(mapping.offer_id, connection.location_id);
    if (!offer.active) throw new ValidationError('The mapped ScaleSafe offer is inactive');

    const existing = await evidenceConnectorRepository.findEnrollmentContextByRequest(connection.id, requestId);
    if (existing) {
      if (!['pending', 'attached'].includes(existing.status) || new Date(existing.expires_at).getTime() <= Date.now() || !existing.token_encrypted) {
        throw new ValidationError('This enrollment-link request has already expired or been consumed; use a new request_id');
      }
      if (existing.external_contact_id !== externalContactId
        || existing.external_enrollment_id !== externalEnrollmentId
        || existing.external_resource_id !== externalResourceId
        || existing.resource_type !== resourceType) {
        throw new ValidationError('request_id was already used with different enrollment details');
      }
      const token = decrypt(existing.token_encrypted);
      return {
        contextId: existing.id,
        enrollmentUrl: await enrollmentUrl(offer, token),
        expiresAt: existing.expires_at,
        checkoutMode: existing.checkout_mode,
        offer: { id: offer.id, name: offer.offer_name },
        idempotentReplay: true,
      };
    }

    const token = `ss_ctx_${crypto.randomBytes(32).toString('base64url')}`;
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
    const checkoutMode = ((offer as any).checkout_mode || 'full_enrollment') as 'full_enrollment' | 'quick_checkout';
    let context;
    try {
      context = await evidenceConnectorRepository.createEnrollmentContext({
        connection_id: connection.id,
        merchant_id: connection.merchant_id,
        location_id: connection.location_id,
        request_id: requestId,
        external_contact_id: externalContactId,
        external_enrollment_id: externalEnrollmentId,
        resource_type: resourceType,
        external_resource_id: externalResourceId,
        offer_id: offer.id,
        checkout_mode: checkoutMode,
        token_hash: tokenHash(token),
        token_encrypted: encrypt(token),
        status: 'pending',
        expires_at: expiresAt,
        created_by: `api_key:${auth.credential.key_prefix}`,
      });
    } catch (err: any) {
      if (err?.code === '23505') {
        throw new ValidationError('request_id or external_enrollment_id has already been used for this connection');
      }
      throw err;
    }

    await evidenceConnectorRepository.audit(connection.location_id, connection.id, 'enrollment_context.created', 'server_integration', {
      contextId: context.id,
      offerId: offer.id,
      resourceType,
      externalResourceId,
    });
    return {
      contextId: context.id,
      enrollmentUrl: await enrollmentUrl(offer, token),
      expiresAt,
      checkoutMode,
      offer: { id: offer.id, name: offer.offer_name },
      idempotentReplay: false,
    };
  },

  async claimForCheckout(input: {
    token: string;
    offerId: string;
    email?: string;
    deviceEvidence?: Record<string, unknown> | null;
  }) {
    const token = clean(input.token, 'evidenceContextToken', 200);
    const hash = tokenHash(token);
    const storedContext = await evidenceConnectorRepository.findEnrollmentContextByTokenHash(hash);
    if (!storedContext) throw new ValidationError('Evidence enrollment context is invalid');
    requireAutomation(storedContext.location_id);
    if (storedContext.offer_id !== input.offerId) {
      throw new ValidationError('Evidence enrollment context does not match this offer');
    }
    const claimed = await evidenceConnectorRepository.claimEnrollmentContext({
      tokenHash: hash,
      offerId: clean(input.offerId, 'offerId', 80),
      email: String(input.email || '').trim().toLowerCase(),
      deviceEvidence: input.deviceEvidence || null,
    });
    if (!claimed?.enrollment_id || !claimed?.location_id) {
      throw new ValidationError('Evidence enrollment context could not be attached');
    }
    return {
      contextId: claimed.context_id as string,
      enrollmentId: claimed.enrollment_id as string,
      locationId: claimed.location_id as string,
      merchantId: claimed.merchant_id as string,
      offerId: claimed.offer_id as string,
      status: claimed.context_status as string,
    };
  },

  async bindExistingSubject(auth: ConnectorAuthContext, input: Record<string, any>) {
    requireAutomation(auth.connection.location_id);
    const enrollmentRef = clean(input.enrollment_ref ?? input.enrollmentRef, 'enrollment_ref');
    const externalContactId = clean(input.external_contact_id ?? input.externalContactId, 'external_contact_id');
    const externalEnrollmentId = clean(input.external_enrollment_id ?? input.externalEnrollmentId, 'external_enrollment_id');
    const subject = await evidenceConnectorRepository.findSubjectByRef(auth.connection.location_id, enrollmentRef);
    if (!subject) throw new ValidationError('Enrollment reference was not found for this sub-account');
    const existingEnrollmentIdentity = await evidenceConnectorRepository.findSubjectsByIdentity(
      auth.connection.id,
      undefined,
      externalEnrollmentId,
    );
    if (existingEnrollmentIdentity.some((existing: any) => existing.id !== subject.id)) {
      throw new ValidationError('external_enrollment_id is already bound to another ScaleSafe enrollment');
    }

    await evidenceConnectorRepository.persistIdentity({
      connection_id: auth.connection.id,
      subject_id: subject.id,
      location_id: auth.connection.location_id,
      external_contact_id: externalContactId,
      external_enrollment_id: externalEnrollmentId,
      binding_method: 'server_bind',
      verification_metadata: { enrollment_ref: enrollmentRef },
      verified_at: new Date().toISOString(),
    });
    await evidenceConnectorRepository.audit(auth.connection.location_id, auth.connection.id, 'subject.bound', 'server_integration', {
      enrollmentId: subject.enrollment_id,
      offerId: subject.offer_id,
    });
    return {
      enrollmentRef,
      enrollmentId: subject.enrollment_id,
      offerId: subject.offer_id,
      bound: true,
    };
  },
};
