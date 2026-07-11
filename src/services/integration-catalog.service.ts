import { evidenceConnectorRepository } from '../repositories/evidence-connector.repository';
import { integrationCatalogRepository } from '../repositories/integration-catalog.repository';
import { INTEGRATION_PROVIDER_MAP, INTEGRATION_PROVIDERS, IntegrationCapability, IntegrationReleaseStatus } from '../integrations/provider-catalog';
import { providerAdapterRegistry } from '../integrations/provider-adapter';
import { ValidationError } from '../utils/errors';
import { evidenceConnectionService } from './evidence-connection.service';
import { zoomIntegrationService } from './zoom-integration.service';
import '../integrations/zoom.adapter';

const RELEASED = new Set<IntegrationReleaseStatus>(['native', 'available', 'beta']);

function derivedProviderKey(connection: any): string {
  if (connection.provider_key) return connection.provider_key;
  if (connection.connection_type === 'canonical_api') return 'custom_api';
  if (connection.connection_type === 'raw_webhook') return 'raw_webhook';
  return 'custom_api';
}

export const integrationCatalogService = {
  async list(locationId: string) {
    const [releaseRows, locationRows, connections] = await Promise.all([
      integrationCatalogRepository.listReleases(),
      integrationCatalogRepository.listLocationReleases(locationId),
      integrationCatalogRepository.listConnections(locationId),
    ]);
    const releases = new Map(releaseRows.map((row) => [row.provider_key, row]));
    const tenantReleases = new Map(locationRows.map((row) => [row.provider_key, row.enabled === true]));
    const byProvider = new Map<string, any[]>();
    for (const connection of connections) {
      const key = derivedProviderKey(connection);
      byProvider.set(key, [...(byProvider.get(key) || []), connection]);
    }

    const providers = INTEGRATION_PROVIDERS.map((definition) => {
      const release = releases.get(definition.key);
      const releaseStatus = (release?.release_status || (definition.wave === 7 ? 'discovery' : 'planned')) as IntegrationReleaseStatus;
      const tenantOverride = tenantReleases.get(definition.key);
      const releasedForTenant = tenantOverride ?? Boolean(release?.enabled_by_default);
      const providerConnections = byProvider.get(definition.key) || [];
      const native = definition.key === 'ghl_native';
      const adapterReady = native || definition.key === 'custom_api' || providerAdapterRegistry.has(definition.key);
      return {
        ...definition,
        releaseStatus,
        releasedForTenant: native || releasedForTenant,
        connectable: !native && RELEASED.has(releaseStatus) && releasedForTenant && adapterReady,
        connected: native || providerConnections.some((connection) => connection.status === 'active' && connection.setup_status === 'active'),
        hasConnection: native || providerConnections.length > 0,
        connections: providerConnections.map((connection) => ({
          id: connection.id,
          name: connection.name,
          status: connection.status,
          setupStatus: connection.setup_status,
          healthStatus: connection.health_status,
          externalAccountName: connection.external_account_name,
          lastEventAt: connection.last_event_at,
          lastSuccessAt: connection.last_success_at,
          error: connection.last_error_message,
        })),
      };
    });
    return { providers };
  },

  async connect(locationId: string, actorLabel: string, providerKey: string, input: Record<string, unknown>) {
    const catalog = await this.list(locationId);
    const provider = catalog.providers.find((candidate) => candidate.key === providerKey);
    if (!provider) throw new ValidationError('Unknown integration provider');
    if (!provider.connectable) throw new ValidationError(`${provider.name} is not enabled for self-service connection yet`);
    if (providerKey === 'zoom') {
      return zoomIntegrationService.begin(locationId, actorLabel, String(input.name || 'Zoom'));
    }
    if (providerKey !== 'custom_api') {
      throw new ValidationError(`${provider.name} requires its certified provider adapter before it can be connected`);
    }
    const name = String(input.name || 'Custom Software').trim().slice(0, 120) || 'Custom Software';
    const result = await evidenceConnectionService.create(locationId, actorLabel, {
      name,
      sourceLabel: name,
      connectionType: 'canonical_api',
      credentialType: 'api_key',
      setupMode: 'developer_api',
      identityStrategy: 'enrollment_context',
      providerKey,
      authMode: 'api_key',
      providerCapabilities: provider.capabilities,
    });
    return result;
  },

  async offerOptions(locationId: string) {
    const rows = await integrationCatalogRepository.listOfferOptions(locationId);
    return rows.map((row) => {
      const connection = Array.isArray(row.connection) ? row.connection[0] : row.connection;
      const providerKey = connection?.provider_key || derivedProviderKey(connection || {});
      const provider = INTEGRATION_PROVIDER_MAP.get(providerKey);
      return {
        mappingId: row.id,
        connectionId: row.connection_id,
        connectionName: connection?.name || provider?.name || 'Evidence connection',
        providerKey,
        providerName: provider?.name || providerKey,
        capabilities: (connection?.provider_capabilities?.length ? connection.provider_capabilities : provider?.capabilities || []) as IntegrationCapability[],
        resourceType: row.resource_type,
        resourceId: row.external_resource_id,
        resourceName: row.external_resource_name || row.external_resource_id,
        mappedOfferId: row.offer_id,
      };
    });
  },

  async setMerchantStatus(locationId: string, connectionId: string, actorLabel: string, enabled: boolean) {
    const connection = await evidenceConnectorRepository.getConnection(locationId, connectionId);
    if (!connection) throw new ValidationError('Evidence connection not found');
    if (connection.provider_key === 'zoom') {
      if (enabled) throw new ValidationError('Reconnect Zoom through the integration catalog');
      return zoomIntegrationService.disable(locationId, connectionId, actorLabel);
    }
    return evidenceConnectionService.setStatus(locationId, connectionId, actorLabel, enabled);
  },

  async setLocationRelease(providerKey: string, locationId: string, actorLabel: string, enabled: boolean) {
    if (!INTEGRATION_PROVIDER_MAP.has(providerKey)) throw new ValidationError('Unknown integration provider');
    const release = await integrationCatalogRepository.setLocationRelease(providerKey, locationId, enabled, actorLabel);
    await evidenceConnectorRepository.audit(locationId, null, 'provider.release_changed', actorLabel, { providerKey, enabled });
    return release;
  },
};
