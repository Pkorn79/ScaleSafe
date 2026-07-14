import crypto from 'crypto';
import { config } from '../config';
import { evidenceConnectorRepository } from '../repositories/evidence-connector.repository';
import { merchantRepository } from '../repositories/merchant.repository';
import { offerRepository } from '../repositories/offer.repository';
import { EvidenceConnectionType, EvidenceCredentialType, RawWebhookConnectionConfig, RawWebhookMappingConfig } from '../types/evidence-connector.types';
import { encrypt } from '../utils/field-encryption';
import { ValidationError } from '../utils/errors';
import {
  connectorKeyPrefix,
  generateConnectorSecret,
  hashConnectorSecret,
} from '../utils/evidence-connector-security';
import { isSafeMappingPath, mapConfiguredRawWebhook, rawWebhookMappingRules, validateCanonicalEvent } from '../utils/evidence-event-mapper';
import { evidenceConnectorService } from './evidence-connector.service';

function publicId(): string {
  return `evc_${crypto.randomBytes(12).toString('base64url')}`;
}

function validateConnectionType(value: unknown): EvidenceConnectionType {
  if (value === 'canonical_api' || value === 'raw_webhook') return value;
  throw new ValidationError('Connection type must be canonical_api or raw_webhook');
}

function validateCredentialType(connectionType: EvidenceConnectionType, value: unknown): EvidenceCredentialType {
  const fallback: EvidenceCredentialType = connectionType === 'canonical_api' ? 'api_key' : 'url_secret';
  const selected = (value || fallback) as EvidenceCredentialType;
  if (!['api_key', 'hmac', 'url_secret'].includes(selected)) throw new ValidationError('Unsupported connector credential type');
  if (connectionType === 'canonical_api' && selected !== 'api_key') throw new ValidationError('Canonical API connections require a bearer API key');
  return selected;
}

function validateMapper(configValue: unknown): RawWebhookConnectionConfig {
  const input = (configValue || {}) as RawWebhookConnectionConfig | RawWebhookMappingConfig;
  const rules = rawWebhookMappingRules(input);
  if (rules.length === 0 || rules.length > 50) throw new ValidationError('Raw webhook connections require between 1 and 50 mapping rules');
  const pathKeys: Array<keyof RawWebhookMappingConfig> = [
    'matchPath', 'eventIdPath', 'eventTypePath', 'occurredAtPath', 'enrollmentRefPath', 'contactEmailPath',
    'externalContactIdPath', 'externalEnrollmentIdPath', 'resourceTypePath', 'resourceIdPath', 'resourceNamePath',
    'actorTypePath', 'actorExternalIdPath', 'actorNamePath', 'actorEmailPath', 'attachmentUrlPath', 'attachmentFilenamePath',
  ];
  rules.forEach((mapper, index) => {
    if (!mapper.eventIdPath || !mapper.occurredAtPath) throw new ValidationError(`Raw webhook mapping ${index + 1} requires eventIdPath and occurredAtPath`);
    if (!mapper.eventTypePath && !mapper.eventTypeValue) throw new ValidationError(`Raw webhook mapping ${index + 1} requires eventTypePath or eventTypeValue`);
    if ((mapper.matchPath && mapper.matchValue === undefined) || (!mapper.matchPath && mapper.matchValue !== undefined)) {
      throw new ValidationError(`Raw webhook mapping ${index + 1} must provide both matchPath and matchValue`);
    }
    for (const key of pathKeys) {
      if (!isSafeMappingPath(mapper[key] as string | undefined)) throw new ValidationError(`Raw webhook mapping ${index + 1} contains an unsafe ${key}`);
    }
    for (const [key, value] of Object.entries(mapper.activity || {})) {
      if (!['status', 'title', 'description', 'duration_seconds', 'progress_percent', 'result', 'started_at', 'ended_at'].includes(key)
        || !isSafeMappingPath(value)) throw new ValidationError(`Raw webhook mapping ${index + 1} contains an unsafe activity path`);
    }
  });
  return {
    mappings: rules,
    approvedCustomTypes: Array.from(new Set((input.approvedCustomTypes || []).map((value) => String(value).trim()).filter(Boolean))).slice(0, 50),
  };
}

async function createCredential(connectionId: string, type: EvidenceCredentialType) {
  const prefix = type === 'api_key' ? 'ss_ev' : type === 'hmac' ? 'ss_hmac' : 'ss_hook';
  const secret = generateConnectorSecret(prefix);
  await evidenceConnectorRepository.createCredential({
    connection_id: connectionId,
    credential_type: type,
    key_prefix: connectorKeyPrefix(secret),
    secret_hash: hashConnectorSecret(secret),
    secret_encrypted: type === 'hmac' ? encrypt(secret) : null,
    status: 'active',
  });
  return secret;
}

function endpoints(publicConnectionId: string, type: EvidenceCredentialType, secret?: string) {
  const base = config.appUrl.replace(/\/$/, '');
  return {
    canonicalUrl: `${base}/api/v1/evidence/events`,
    webhookUrl: type === 'url_secret' && secret
      ? `${base}/webhooks/connectors/${publicConnectionId}/${secret}`
      : `${base}/webhooks/connectors/${publicConnectionId}`,
  };
}

export const evidenceConnectionService = {
  async ensureLegacy(locationId: string, sourceInput: string) {
    const sourceLabel = String(sourceInput || 'legacy').trim().slice(0, 120) || 'legacy';
    const existing = await evidenceConnectorRepository.getConnectionByTypeAndSource(locationId, 'legacy_external', sourceLabel);
    if (existing) return existing;
    const merchant = await merchantRepository.getByLocationId(locationId);
    return evidenceConnectorRepository.createConnection({
      merchant_id: merchant.id,
      location_id: locationId,
      public_id: publicId(),
      name: `Legacy External - ${sourceLabel}`.slice(0, 120),
      source_label: sourceLabel,
      connection_type: 'legacy_external',
      mapping_config: {},
      status: 'active',
      health_status: 'ready',
      created_by: 'legacy_compatibility',
    });
  },

  async list(locationId: string) {
    const rows = await evidenceConnectorRepository.listConnections(locationId);
    return Promise.all(rows.map(async (connection) => {
      const events = await evidenceConnectorRepository.connectionEventSummary(locationId, connection.id);
      const published = events.filter((event: any) => event.status === 'published');
      const programs = new Map<string, string>();
      for (const event of published) {
        const offer = Array.isArray(event.offer) ? event.offer[0] : event.offer;
        if (event.offer_id) programs.set(event.offer_id, offer?.offer_name || 'Program');
      }
      const active = connection.status === 'active' && connection.setup_status === 'active';
      const webhookObserved = Boolean(connection.last_event_at);
      const evidenceObserved = published.length > 0;
      const effectiveHealth = active
        && !['warning', 'error'].includes(connection.health_status)
        && (!webhookObserved || !evidenceObserved)
        ? 'ready'
        : connection.health_status;
      const inactiveMessage = connection.status !== 'active'
        ? 'Connection is disabled.'
        : connection.setup_status !== 'active'
          ? 'Connection setup is not active.'
          : null;
      const proofMessage = active && !webhookObserved
        ? 'Account connected. Waiting for a completed participant session to verify webhook and evidence delivery.'
        : active && !evidenceObserved
          ? 'Webhook activity observed. Waiting for an event that can be matched and published as evidence.'
          : null;
      return {
        id: connection.id,
        name: connection.name,
        source: connection.source_label,
        providerKey: connection.provider_key,
        connectionType: connection.connection_type,
        status: connection.status,
        setupStatus: connection.setup_status,
        healthStatus: effectiveHealth,
        authorizationStatus: connection.external_account_id ? 'connected' : 'not_connected',
        webhookStatus: webhookObserved ? 'observed' : 'awaiting_test',
        evidenceStatus: evidenceObserved ? 'published' : 'awaiting_evidence',
        lastEvidenceAt: published[0]?.published_at || null,
        lastEventAt: connection.last_event_at,
        publishedCount: published.length,
        affectedPrograms: Array.from(programs.entries()).map(([offerId, offerName]) => ({ offerId, offerName })),
        needsAttention: !active
          || connection.setup_status === 'needs_attention'
          || connection.health_status === 'warning'
          || connection.health_status === 'error',
        statusMessage: connection.last_error_message || inactiveMessage || proofMessage,
      };
    }));
  },

  async create(locationId: string, actorLabel: string, input: Record<string, any>) {
    const merchant = await merchantRepository.getByLocationId(locationId);
    const connectionType = validateConnectionType(input.connectionType);
    const credentialType = validateCredentialType(connectionType, input.credentialType);
    const name = String(input.name || '').trim();
    const sourceLabel = String(input.sourceLabel || name).trim();
    if (!name || !sourceLabel) throw new ValidationError('Connection name and source label are required');
    if (name.length > 120 || sourceLabel.length > 120) throw new ValidationError('Connection name and source label must be 120 characters or fewer');

    const mapper = connectionType === 'raw_webhook' ? validateMapper(input.mappingConfig) : {};
    const connection = await evidenceConnectorRepository.createConnection({
      merchant_id: merchant.id,
      location_id: locationId,
      public_id: publicId(),
      name,
      source_label: sourceLabel,
      connection_type: connectionType,
      mapping_config: mapper,
      allowed_attachment_domains: sanitizeDomains(input.allowedAttachmentDomains),
      rate_limit_per_minute: clampRateLimit(input.rateLimitPerMinute),
      status: 'disabled',
      health_status: 'disabled',
      setup_status: 'draft',
      setup_mode: input.setupMode || 'operator_managed',
      identity_strategy: input.identityStrategy || 'enrollment_context',
      provider_key: input.providerKey || null,
      auth_mode: input.authMode || null,
      provider_capabilities: Array.isArray(input.providerCapabilities) ? input.providerCapabilities : [],
      configured_by: actorLabel,
      created_by: actorLabel,
    });

    try {
      const secret = await createCredential(connection.id, credentialType);
      await this.replaceMappings(locationId, connection.id, input.resourceMappings || []);
      await evidenceConnectorRepository.audit(locationId, connection.id, 'connection.created', actorLabel, {
        connectionType,
        credentialType,
      });
      return {
        connection,
        credential: { type: credentialType, secret, displayedOnce: true },
        endpoints: endpoints(connection.public_id, credentialType, secret),
      };
    } catch (err) {
      await evidenceConnectorRepository.deleteConnection(locationId, connection.id).catch(() => undefined);
      throw err;
    }
  },

  async update(locationId: string, id: string, actorLabel: string, input: Record<string, any>) {
    const connection = await evidenceConnectorRepository.getConnection(locationId, id);
    if (!connection) throw new ValidationError('Evidence connection not found');
    const updates: Record<string, unknown> = {};
    if (input.name !== undefined) updates.name = String(input.name).trim();
    if (input.sourceLabel !== undefined) updates.source_label = String(input.sourceLabel).trim();
    if (input.mappingConfig !== undefined) {
      if (connection.connection_type !== 'raw_webhook') throw new ValidationError('Only raw webhook connections use mapping configuration');
      updates.mapping_config = validateMapper(input.mappingConfig);
    }
    if (input.allowedAttachmentDomains !== undefined) updates.allowed_attachment_domains = sanitizeDomains(input.allowedAttachmentDomains);
    if (input.rateLimitPerMinute !== undefined) updates.rate_limit_per_minute = clampRateLimit(input.rateLimitPerMinute);
    if (input.identityStrategy !== undefined) {
      const strategy = String(input.identityStrategy);
      if (!['enrollment_context', 'external_enrollment', 'external_contact_resource', 'email_resource_bootstrap'].includes(strategy)) {
        throw new ValidationError('Unsupported connector identity strategy');
      }
      updates.identity_strategy = strategy;
    }
    updates.setup_status = 'testing';
    updates.status = 'disabled';
    updates.health_status = 'ready';
    updates.configured_by = actorLabel;
    const updated = await evidenceConnectorRepository.updateConnection(locationId, id, updates);
    if (input.resourceMappings !== undefined) await this.replaceMappings(locationId, id, input.resourceMappings);
    await evidenceConnectorRepository.audit(locationId, id, 'connection.updated', actorLabel, { fields: Object.keys(updates) });
    return updated;
  },

  async replaceMappings(locationId: string, connectionId: string, rawMappings: Array<Record<string, any>>) {
    const rows: Record<string, unknown>[] = [];
    for (const mapping of rawMappings) {
      const offerId = String(mapping.offerId || '').trim();
      const resourceType = String(mapping.resourceType || '').trim();
      const externalResourceId = String(mapping.externalResourceId || '').trim();
      if (!offerId || !resourceType || !externalResourceId) throw new ValidationError('Each resource mapping requires offerId, resourceType, and externalResourceId');
      await offerRepository.getById(offerId, locationId);
      rows.push({
        connection_id: connectionId,
        location_id: locationId,
        offer_id: offerId,
        resource_type: resourceType,
        external_resource_id: externalResourceId,
        external_resource_name: String(mapping.externalResourceName || '').trim() || null,
        approval_status: mapping.approvalStatus === 'approved' ? 'approved' : 'proposed',
        proposed_match_confidence: Number.isFinite(Number(mapping.proposedMatchConfidence))
          ? Math.max(0, Math.min(1, Number(mapping.proposedMatchConfidence)))
          : null,
        approved_by: mapping.approvalStatus === 'approved' ? String(mapping.approvedBy || 'hq_operator') : null,
        approved_at: mapping.approvalStatus === 'approved' ? new Date().toISOString() : null,
        provider_metadata: mapping.providerMetadata && typeof mapping.providerMetadata === 'object'
          ? mapping.providerMetadata
          : {},
      });
    }
    await evidenceConnectorRepository.replaceResourceMappings(locationId, connectionId, rows);
  },

  async rotate(locationId: string, id: string, actorLabel: string, graceHours = 24) {
    const connection = await evidenceConnectorRepository.getConnection(locationId, id);
    if (!connection) throw new ValidationError('Evidence connection not found');
    const credentials = await evidenceConnectorRepository.listActiveCredentials(id);
    const credentialType = credentials[0]?.credential_type || (connection.connection_type === 'canonical_api' ? 'api_key' : 'url_secret');
    const hours = Math.max(0, Math.min(Number(graceHours) || 24, 168));
    await evidenceConnectorRepository.expireCredentials(id, new Date(Date.now() + hours * 60 * 60 * 1000).toISOString());
    const secret = await createCredential(id, credentialType);
    await evidenceConnectorRepository.audit(locationId, id, 'credential.rotated', actorLabel, { credentialType, graceHours: hours });
    return {
      credential: { type: credentialType, secret, displayedOnce: true, previousExpiresInHours: hours },
      endpoints: endpoints(connection.public_id, credentialType, secret),
    };
  },

  async setStatus(locationId: string, id: string, actorLabel: string, enabled: boolean) {
    if (enabled) return this.activate(locationId, id, actorLabel);
    const updated = await evidenceConnectorRepository.updateConnection(locationId, id, {
      status: 'disabled',
      setup_status: 'disabled',
      health_status: 'disabled',
    });
    await evidenceConnectorRepository.audit(locationId, id, enabled ? 'connection.enabled' : 'connection.disabled', actorLabel);
    return updated;
  },

  async activate(locationId: string, id: string, actorLabel: string) {
    const connection = await evidenceConnectorRepository.getConnection(locationId, id);
    if (!connection) throw new ValidationError('Evidence connection not found');
    const credentialCount = await evidenceConnectorRepository.credentialCount(id);
    if (credentialCount < 1) throw new ValidationError('Install or generate a connection credential before activation');
    const successfulTests = await evidenceConnectorRepository.successfulTestCount(locationId, id);
    if (successfulTests < 1) throw new ValidationError('Run a successful tenant and enrollment resolution test before activation');
    const mappings = await evidenceConnectorRepository.listResourceMappings(locationId, id);
    if (!mappings.some((mapping: any) => mapping.approval_status === 'approved')) {
      throw new ValidationError('Approve at least one external resource to ScaleSafe offer mapping before activation');
    }
    if (connection.connection_type === 'raw_webhook') validateMapper(connection.mapping_config);
    const updated = await evidenceConnectorRepository.updateConnection(locationId, id, {
      status: 'active',
      setup_status: 'active',
      health_status: 'ready',
      activated_at: new Date().toISOString(),
      configured_by: actorLabel,
      last_error_message: null,
    });
    await evidenceConnectorRepository.audit(locationId, id, 'connection.activated', actorLabel, {
      approvedMappings: mappings.filter((mapping: any) => mapping.approval_status === 'approved').length,
    });
    return updated;
  },

  async replay(locationId: string, id: string, actorLabel: string) {
    const connection = await evidenceConnectorRepository.getConnection(locationId, id);
    if (!connection) throw new ValidationError('Evidence connection not found');
    const replayed = await evidenceConnectorRepository.replayEligibleEvents(locationId, id);
    await evidenceConnectorRepository.audit(locationId, id, 'events.replayed', actorLabel, { replayed });
    return { replayed };
  },

  async suggestMappings(locationId: string, id: string, resources: Array<Record<string, any>>) {
    const connection = await evidenceConnectorRepository.getConnection(locationId, id);
    if (!connection) throw new ValidationError('Evidence connection not found');
    const offers = (await offerRepository.listByLocation(locationId)).filter((offer) => offer.active);
    const normalized = (value: unknown) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    return resources.slice(0, 100).map((resource) => {
      const resourceType = String(resource.resourceType || resource.type || '').trim();
      const externalResourceId = String(resource.externalResourceId || resource.id || '').trim();
      const externalResourceName = String(resource.externalResourceName || resource.name || '').trim();
      const exactIdentifier = offers.find((offer) => offer.id === externalResourceId || offer.tracking_id === externalResourceId);
      const nameMatch = offers.find((offer) => normalized(offer.offer_name) === normalized(externalResourceName));
      const match = exactIdentifier || nameMatch || null;
      return {
        resourceType,
        externalResourceId,
        externalResourceName,
        suggestedOfferId: match?.id || null,
        suggestedOfferName: match?.offer_name || null,
        confidence: exactIdentifier ? 1 : nameMatch ? 0.95 : 0,
        reason: exactIdentifier ? 'exact_identifier' : nameMatch ? 'normalized_name' : 'no_exact_match',
        requiresOperatorApproval: true,
      };
    });
  },

  async preview(locationId: string, id: string, payload: Record<string, unknown>) {
    const connection = await evidenceConnectorRepository.getConnection(locationId, id);
    if (!connection) throw new ValidationError('Evidence connection not found');
    if (connection.connection_type !== 'raw_webhook') throw new ValidationError('Preview is available for raw webhook connections');
    const event = mapConfiguredRawWebhook(payload, connection.mapping_config as RawWebhookConnectionConfig | RawWebhookMappingConfig);
    if (!event) return { valid: false, errors: ['No configured mapping matched this sample payload'], normalizedEvent: null, createsEvidence: false };
    const errors = validateCanonicalEvent(event, (connection.mapping_config as RawWebhookMappingConfig).approvedCustomTypes || []);
    return { valid: errors.length === 0, errors, normalizedEvent: event, createsEvidence: false };
  },

  async sendTest(locationId: string, id: string, enrollmentId: string, actorLabel: string, eventType = 'service.login') {
    const connection = await evidenceConnectorRepository.getConnection(locationId, id);
    if (!connection) throw new ValidationError('Evidence connection not found');
    const subject = await evidenceConnectorRepository.getSubjectByEnrollment(locationId, enrollmentId);
    if (!subject) throw new ValidationError('Choose a valid enrollment for the test');
    const credentials = await evidenceConnectorRepository.listActiveCredentials(connection.id);
    if (!credentials[0]) throw new ValidationError('Connection has no active credential');
    const event = {
      schema_version: '1.0' as const,
      event_id: `test_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      event_type: String(eventType || 'service.login'),
      occurred_at: new Date().toISOString(),
      subject: { enrollment_ref: subject.enrollment_ref },
      resource: { type: 'test', id: 'test_resource', name: 'Connector Test Activity' },
      actor: { type: 'client' as const },
      activity: { status: 'completed', description: 'Synthetic validation event. This does not become evidence.' },
      attachments: [],
      metadata: {},
    };
    const result = await evidenceConnectorService.ingestCanonical({
      connection,
      credential: credentials[0],
      authMethod: credentials[0].credential_type,
      signatureVerified: credentials[0].credential_type === 'hmac',
    }, event, undefined, true);
    await evidenceConnectorRepository.audit(locationId, connection.id, 'connection.test_sent', actorLabel, {
      enrollmentId: subject.enrollment_id,
      offerId: subject.offer_id,
    });
    return {
      event: result.event,
      target: {
        enrollmentId: subject.enrollment_id,
        contactId: subject.contact_id,
        email: subject.normalized_email || subject.enrollment?.email || '',
        offerId: subject.offer_id,
        offerName: subject.offer?.offer_name || subject.enrollment?.offer_name || '',
        matchMethod: 'enrollment_ref',
      },
    };
  },
};

function sanitizeDomains(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => String(item || '').trim().toLowerCase()).filter((item) => /^[a-z0-9.-]+$/.test(item)))).slice(0, 50);
}

function clampRateLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 300;
  return Math.max(1, Math.min(Math.round(parsed), 10000));
}
