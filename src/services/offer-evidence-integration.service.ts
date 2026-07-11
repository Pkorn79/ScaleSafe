import { INTEGRATION_PROVIDER_MAP, IntegrationCapability } from '../integrations/provider-catalog';
import { evidenceConnectorRepository } from '../repositories/evidence-connector.repository';
import { integrationCatalogRepository } from '../repositories/integration-catalog.repository';
import { offerRepository } from '../repositories/offer.repository';
import { ValidationError } from '../utils/errors';

export type OfferAccessMode = 'none' | 'evidence_only' | 'scalesafe_checkout_managed_access'
  | 'scalesafe_consent_provider_checkout' | 'provider_checkout_import';

function requiredCapabilities(mode: OfferAccessMode): IntegrationCapability[] {
  if (mode === 'scalesafe_checkout_managed_access') return ['access_management'];
  if (mode === 'scalesafe_consent_provider_checkout') return ['native_purchases'];
  if (mode === 'provider_checkout_import') return ['native_purchases'];
  return ['evidence'];
}

export const offerEvidenceIntegrationService = {
  async get(locationId: string, offerId: string) {
    await offerRepository.getById(offerId, locationId);
    return integrationCatalogRepository.getPrimaryOfferIntegration(locationId, offerId);
  },

  async save(locationId: string, offerId: string, actorLabel: string, input: Record<string, any>) {
    await offerRepository.getById(offerId, locationId);
    const mode = String(input.accessMode || 'none') as OfferAccessMode;
    if (mode === 'none') {
      await integrationCatalogRepository.clearPrimaryOfferIntegration(locationId, offerId);
      return { accessMode: 'none' };
    }
    if (!['evidence_only', 'scalesafe_checkout_managed_access', 'scalesafe_consent_provider_checkout', 'provider_checkout_import'].includes(mode)) {
      throw new ValidationError('Unsupported delivery integration mode');
    }
    const connectionId = String(input.connectionId || '').trim();
    const resourceType = String(input.resourceType || '').trim();
    const resourceId = String(input.resourceId || '').trim();
    if (!connectionId || !resourceType || !resourceId) throw new ValidationError('Choose a connected platform resource');
    const connection = await evidenceConnectorRepository.getConnection(locationId, connectionId);
    if (!connection || connection.status !== 'active' || connection.setup_status !== 'active') {
      throw new ValidationError('The selected evidence connection is not active');
    }
    const providerKey = connection.provider_key
      || (connection.connection_type === 'canonical_api' ? 'custom_api' : 'raw_webhook');
    const provider = INTEGRATION_PROVIDER_MAP.get(providerKey);
    const capabilities = new Set<IntegrationCapability>((connection.provider_capabilities?.length
      ? connection.provider_capabilities
      : provider?.capabilities || []) as IntegrationCapability[]);
    for (const capability of requiredCapabilities(mode)) {
      if (!capabilities.has(capability)) throw new ValidationError(`${provider?.name || providerKey} does not support ${mode.replace(/_/g, ' ')}`);
    }
    const mapping = await evidenceConnectorRepository.findResourceMapping(connectionId, resourceType, resourceId);
    if (!mapping || mapping.offer_id !== offerId || mapping.approval_status !== 'approved') {
      throw new ValidationError('The selected platform resource is not approved for this offer');
    }
    return integrationCatalogRepository.savePrimaryOfferIntegration({
      p_location_id: locationId,
      p_offer_id: offerId,
      p_connection_id: connectionId,
      p_provider_key: providerKey,
      p_resource_type: resourceType,
      p_resource_id: resourceId,
      p_resource_name: String(input.resourceName || mapping.external_resource_name || resourceId).trim(),
      p_access_mode: mode,
      p_grace_period_days: Math.max(0, Math.min(90, Math.round(Number(input.gracePeriodDays ?? 7) || 0))),
      p_revoke_on_cancellation: input.revokeOnCancellation === true,
      p_revoke_on_full_refund: input.revokeOnFullRefund === true,
      p_revoke_on_dunning_exhausted: input.revokeOnDunningExhausted === true,
      p_configured_by: actorLabel,
    });
  },
};
