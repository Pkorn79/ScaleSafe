import { evidenceConnectorRepository } from '../repositories/evidence-connector.repository';
import {
  CanonicalEvidenceEvent,
  ConnectorAuthContext,
  EvidenceConnectionRecord,
  RawWebhookConnectionConfig,
  RawWebhookMappingConfig,
} from '../types/evidence-connector.types';
import { ValidationError } from '../utils/errors';
import { hashPayload, redactConnectorPayload } from '../utils/evidence-connector-security';
import { mapConfiguredRawWebhook, validateCanonicalEvent } from '../utils/evidence-event-mapper';

const LEGACY_EVENT_MAP: Record<string, string> = {
  session_completed: 'session.completed',
  no_show: 'session.no_show',
  module_completed: 'module.completed',
  module_progress: 'module.progressed',
  milestone_signed: 'milestone.approved',
  pulse_check: 'pulse.submitted',
  payment_update: 'payment.observed',
  service_access: 'service.usage',
  course_completed: 'course.completed',
  assignment_submitted: 'assignment.submitted',
};

function serializePayload(payload: unknown, rawBody?: Buffer): Buffer {
  return rawBody?.length ? rawBody : Buffer.from(JSON.stringify(payload || {}), 'utf8');
}

function approvedCustomTypes(connection: EvidenceConnectionRecord): string[] {
  return Array.isArray((connection.mapping_config as RawWebhookConnectionConfig)?.approvedCustomTypes)
    ? (connection.mapping_config as RawWebhookConnectionConfig).approvedCustomTypes || []
    : [];
}

export const evidenceConnectorService = {
  async ingestCanonical(auth: ConnectorAuthContext, payload: Record<string, unknown>, rawBody?: Buffer, isTest = false) {
    const event = normalizeCanonical(payload);
    const errors = validateCanonicalEvent(event, approvedCustomTypes(auth.connection));
    if (errors.length > 0) throw new ValidationError(errors.join('; '));
    return this.store(auth, payload, event, rawBody, isTest);
  },

  async ingestRaw(auth: ConnectorAuthContext, payload: Record<string, unknown>, rawBody?: Buffer, isTest = false) {
    const event = mapConfiguredRawWebhook(
      payload,
      auth.connection.mapping_config as RawWebhookConnectionConfig | RawWebhookMappingConfig,
    );
    if (!event) {
      const stored = await evidenceConnectorRepository.insertEvent({
        connection_id: auth.connection.id,
        merchant_id: auth.connection.merchant_id,
        location_id: auth.connection.location_id,
        source_event_id: `unmatched_${hashPayload(serializePayload(payload, rawBody)).slice(0, 32)}`,
        schema_version: '1.0',
        event_type: 'unmapped',
        occurred_at: new Date().toISOString(),
        status: 'rejected',
        auth_method: auth.authMethod,
        signature_verified: auth.signatureVerified,
        is_test: isTest,
        raw_payload: redactConnectorPayload(payload),
        normalized_payload: null,
        payload_hash: hashPayload(serializePayload(payload, rawBody)),
        error_code: 'NO_MAPPING_MATCH',
        error_message: 'No configured raw webhook mapping matched this payload',
      });
      await evidenceConnectorRepository.updateConnectionHealth(auth.connection.id, false, 'No configured raw webhook mapping matched the payload');
      return { accepted: true, duplicate: stored.duplicate, event: stored.event, processingStatus: 'rejected' };
    }
    const errors = validateCanonicalEvent(event, approvedCustomTypes(auth.connection));
    if (errors.length > 0) {
      const sourceEventId = event.event_id || `rejected_${hashPayload(serializePayload(payload, rawBody)).slice(0, 32)}`;
      const occurredAt = event.occurred_at || new Date().toISOString();
      const stored = await evidenceConnectorRepository.insertEvent({
        connection_id: auth.connection.id,
        merchant_id: auth.connection.merchant_id,
        location_id: auth.connection.location_id,
        source_event_id: sourceEventId,
        schema_version: '1.0',
        event_type: event.event_type || 'unmapped',
        occurred_at: occurredAt,
        status: 'rejected',
        auth_method: auth.authMethod,
        signature_verified: auth.signatureVerified,
        is_test: isTest,
        raw_payload: redactConnectorPayload(payload),
        normalized_payload: event,
        payload_hash: hashPayload(serializePayload(payload, rawBody)),
        error_code: 'INVALID_MAPPING_OUTPUT',
        error_message: errors.join('; '),
      });
      await evidenceConnectorRepository.updateConnectionHealth(auth.connection.id, false, errors.join('; '));
      return { accepted: true, duplicate: stored.duplicate, event: stored.event, processingStatus: 'rejected' };
    }
    return this.store(auth, payload, event, rawBody, isTest);
  },

  async store(
    auth: ConnectorAuthContext,
    originalPayload: Record<string, unknown>,
    event: CanonicalEvidenceEvent,
    rawBody?: Buffer,
    isTest = false,
  ) {
    const stored = await evidenceConnectorRepository.insertEvent({
      connection_id: auth.connection.id,
      merchant_id: auth.connection.merchant_id,
      location_id: auth.connection.location_id,
      source_event_id: event.event_id,
      schema_version: event.schema_version,
      event_type: event.event_type,
      occurred_at: event.occurred_at,
      status: auth.signatureVerified ? 'verified' : 'received',
      auth_method: auth.authMethod,
      signature_verified: auth.signatureVerified,
      is_test: isTest,
      raw_payload: redactConnectorPayload(originalPayload),
      normalized_payload: { ...event, is_test: isTest },
      payload_hash: hashPayload(serializePayload(originalPayload, rawBody)),
    });
    if (!stored.duplicate) {
      await evidenceConnectorRepository.updateConnection(auth.connection.location_id, auth.connection.id, {
        last_event_at: new Date().toISOString(),
      });
    }
    return {
      accepted: true,
      duplicate: stored.duplicate,
      event: stored.event,
      processingStatus: stored.duplicate ? 'duplicate' : 'accepted',
    };
  },

  async ingestLegacy(params: {
    connection: EvidenceConnectionRecord;
    auth: ConnectorAuthContext;
    payload: Record<string, any>;
    rawBody?: Buffer;
  }) {
    const body = params.payload;
    const data = body.data || {};
    const legacyType = String(body.event_type || '').trim();
    const eventType = LEGACY_EVENT_MAP[legacyType] || `custom.${legacyType || 'legacy'}`;
    const occurredAt = data.occurred_at || data.event_timestamp || data.session_date || data.completion_date || new Date().toISOString();
    const event: CanonicalEvidenceEvent = {
      schema_version: '1.0',
      event_id: String(data.event_id || data.id || `legacy_${hashPayload(serializePayload(body, params.rawBody)).slice(0, 32)}`),
      event_type: eventType,
      occurred_at: new Date(occurredAt).toISOString(),
      subject: {
        enrollment_ref: data.enrollment_ref,
        external_contact_id: data.external_contact_id,
        external_enrollment_id: data.external_enrollment_id,
        email: String(body.contact_email || data.contact_email || '').trim().toLowerCase() || undefined,
      },
      resource: {
        type: String(data.resource_type || data.session_type || data.platform || 'legacy'),
        id: String(data.resource_id || data.course_id || data.session_id || '').trim() || undefined,
        name: String(data.resource_name || data.module_name || data.course_name || data.milestone_name || data.title || '').trim() || undefined,
      },
      actor: { type: 'provider', external_id: data.external_contact_id },
      activity: {
        status: String(data.status || legacyType).trim(),
        title: data.title || data.module_name || data.course_name || data.milestone_name,
        description: data.description || data.summary || data.notes || data.going_well,
        duration_seconds: data.duration_seconds || (data.duration ? Number(data.duration) * 60 : undefined),
        progress_percent: data.progress_pct || data.progress,
        result: data.result || data.grade || data.approved,
      },
      metadata: {
        satisfaction: data.satisfaction || data.sentiment,
        follow_up_needed: data.follow_up_needed,
        amount: data.amount,
        currency: data.currency,
        payment_method: data.payment_method,
        legacy_event_type: legacyType,
      },
      attachments: [],
    };
    const custom = eventType.startsWith('custom.') ? [eventType] : [];
    const errors = validateCanonicalEvent(event, custom);
    if (errors.length > 0) throw new ValidationError(errors.join('; '));
    return this.store(params.auth, body, event, params.rawBody, false);
  },
};

function normalizeCanonical(payload: Record<string, any>): CanonicalEvidenceEvent {
  const event: CanonicalEvidenceEvent = {
    schema_version: payload.schema_version,
    event_id: String(payload.event_id || '').trim(),
    event_type: String(payload.event_type || '').trim(),
    occurred_at: String(payload.occurred_at || '').trim(),
    subject: {
      enrollment_ref: text(payload.subject?.enrollment_ref),
      external_contact_id: text(payload.subject?.external_contact_id),
      external_enrollment_id: text(payload.subject?.external_enrollment_id),
      email: text(payload.subject?.email)?.toLowerCase(),
    },
    resource: payload.resource && typeof payload.resource === 'object' ? {
      type: text(payload.resource.type),
      id: text(payload.resource.id),
      name: text(payload.resource.name),
    } : undefined,
    actor: payload.actor && typeof payload.actor === 'object' ? {
      type: payload.actor.type,
      external_id: text(payload.actor.external_id),
      name: text(payload.actor.name),
      email: text(payload.actor.email)?.toLowerCase(),
      ip_address: text(payload.actor.ip_address),
      device_fingerprint: text(payload.actor.device_fingerprint),
    } : undefined,
    activity: payload.activity && typeof payload.activity === 'object' ? {
      status: text(payload.activity.status),
      title: text(payload.activity.title),
      description: text(payload.activity.description),
      duration_seconds: finite(payload.activity.duration_seconds),
      progress_percent: finite(payload.activity.progress_percent),
      result: text(payload.activity.result),
      started_at: text(payload.activity.started_at),
      ended_at: text(payload.activity.ended_at),
    } : undefined,
    attachments: Array.isArray(payload.attachments)
      ? payload.attachments.slice(0, 20).filter((item: unknown) => item && typeof item === 'object').map((item: any) => ({
        attachment_id: text(item.attachment_id),
        url: text(item.url),
        filename: text(item.filename)?.slice(0, 200),
        label: text(item.label)?.slice(0, 200),
      }))
      : [],
    metadata: payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
      ? redactConnectorPayload(payload.metadata) as Record<string, unknown>
      : {},
  };
  return event;
}

function text(value: unknown): string | undefined {
  const result = String(value ?? '').trim();
  return result || undefined;
}

function finite(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
