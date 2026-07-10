import { CanonicalActorType, CanonicalEvidenceEvent, RawWebhookConnectionConfig, RawWebhookMappingConfig } from '../types/evidence-connector.types';

const SAFE_SEGMENT = /^[A-Za-z0-9_-]+$/;
const BLOCKED_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

export const SUPPORTED_CANONICAL_EVENT_TYPES = new Set([
  'session.scheduled', 'session.attended', 'session.completed', 'session.cancelled', 'session.no_show',
  'appointment.attended', 'appointment.cancelled', 'appointment.no_show',
  'service.access_granted', 'service.login', 'service.usage', 'service.access_revoked',
  'content.viewed', 'content.downloaded',
  'module.started', 'module.progressed', 'module.completed',
  'course.started', 'course.progressed', 'course.completed',
  'milestone.completed', 'milestone.approved', 'milestone.rejected',
  'assignment.submitted', 'assignment.reviewed',
  'deliverable.sent', 'deliverable.viewed', 'deliverable.downloaded', 'deliverable.accepted', 'deliverable.rejected',
  'communication.sent', 'communication.received',
  'support.opened', 'support.responded', 'support.resolved',
  'account.onboarding_completed',
  'pulse.submitted', 'payment.observed',
]);

export function readSafePath(payload: unknown, path: string | undefined): unknown {
  if (!path) return undefined;
  const normalized = path.replace(/\[(\d+)\]/g, '.$1').replace(/^\./, '');
  const segments = normalized.split('.').filter(Boolean);
  if (segments.length === 0 || segments.length > 20) return undefined;
  if (segments.some((segment) => !SAFE_SEGMENT.test(segment) || BLOCKED_SEGMENTS.has(segment))) return undefined;

  let cursor: any = payload;
  for (const segment of segments) {
    if (cursor === null || cursor === undefined || typeof cursor !== 'object') return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

export function isSafeMappingPath(path: string | undefined): boolean {
  if (!path) return true;
  const normalized = path.replace(/\[(\d+)\]/g, '.$1').replace(/^\./, '');
  const segments = normalized.split('.').filter(Boolean);
  return segments.length > 0
    && segments.length <= 20
    && segments.every((segment) => SAFE_SEGMENT.test(segment) && !BLOCKED_SEGMENTS.has(segment));
}

function text(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const result = String(value).trim();
  return result || undefined;
}

function number(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function validDate(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function actorType(value: unknown): CanonicalActorType {
  const normalized = String(value || '').toLowerCase();
  return ['client', 'merchant', 'provider', 'system'].includes(normalized)
    ? normalized as CanonicalActorType
    : 'provider';
}

export function mapRawWebhook(payload: Record<string, unknown>, config: RawWebhookMappingConfig): CanonicalEvidenceEvent {
  const sourceType = text(readSafePath(payload, config.eventTypePath)) || config.eventTypeValue || '';
  const eventType = config.eventTypeMap?.[sourceType] || sourceType;
  const activityPaths = config.activity || {};
  const occurredAt = validDate(readSafePath(payload, config.occurredAtPath));

  return {
    schema_version: '1.0',
    event_id: text(readSafePath(payload, config.eventIdPath)) || '',
    event_type: eventType,
    occurred_at: occurredAt || '',
    subject: {
      enrollment_ref: text(readSafePath(payload, config.enrollmentRefPath)),
      email: text(readSafePath(payload, config.contactEmailPath))?.toLowerCase(),
      external_contact_id: text(readSafePath(payload, config.externalContactIdPath)),
      external_enrollment_id: text(readSafePath(payload, config.externalEnrollmentIdPath)),
    },
    resource: {
      type: text(readSafePath(payload, config.resourceTypePath)) || config.resourceTypeValue,
      id: text(readSafePath(payload, config.resourceIdPath)),
      name: text(readSafePath(payload, config.resourceNamePath)),
    },
    actor: {
      type: actorType(readSafePath(payload, config.actorTypePath) || config.actorTypeValue),
      external_id: text(readSafePath(payload, config.actorExternalIdPath)),
      name: text(readSafePath(payload, config.actorNamePath)),
      email: text(readSafePath(payload, config.actorEmailPath))?.toLowerCase(),
    },
    activity: {
      status: text(readSafePath(payload, activityPaths.status)),
      title: text(readSafePath(payload, activityPaths.title)),
      description: text(readSafePath(payload, activityPaths.description)),
      duration_seconds: number(readSafePath(payload, activityPaths.duration_seconds)),
      progress_percent: number(readSafePath(payload, activityPaths.progress_percent)),
      result: text(readSafePath(payload, activityPaths.result)),
      started_at: validDate(readSafePath(payload, activityPaths.started_at)),
      ended_at: validDate(readSafePath(payload, activityPaths.ended_at)),
    },
    attachments: text(readSafePath(payload, config.attachmentUrlPath)) ? [{
      url: text(readSafePath(payload, config.attachmentUrlPath)),
      filename: text(readSafePath(payload, config.attachmentFilenamePath)),
    }] : [],
    metadata: {},
  };
}

export function rawWebhookMappingRules(config: RawWebhookConnectionConfig | RawWebhookMappingConfig): RawWebhookMappingConfig[] {
  if (Array.isArray((config as RawWebhookConnectionConfig)?.mappings)) {
    return (config as RawWebhookConnectionConfig).mappings;
  }
  return [config as RawWebhookMappingConfig];
}

export function selectRawWebhookMapping(
  payload: Record<string, unknown>,
  config: RawWebhookConnectionConfig | RawWebhookMappingConfig,
): RawWebhookMappingConfig | null {
  const rules = rawWebhookMappingRules(config);
  const exact = rules.find((rule) => rule.matchPath
    && rule.matchValue !== undefined
    && String(readSafePath(payload, rule.matchPath) ?? '') === String(rule.matchValue));
  return exact || rules.find((rule) => !rule.matchPath && rule.matchValue === undefined) || null;
}

export function mapConfiguredRawWebhook(
  payload: Record<string, unknown>,
  config: RawWebhookConnectionConfig | RawWebhookMappingConfig,
): CanonicalEvidenceEvent | null {
  const rule = selectRawWebhookMapping(payload, config);
  return rule ? mapRawWebhook(payload, rule) : null;
}

export function validateCanonicalEvent(event: CanonicalEvidenceEvent, approvedCustomTypes: string[] = []): string[] {
  const errors: string[] = [];
  if (event.schema_version !== '1.0') errors.push('schema_version must be 1.0');
  if (!event.event_id || event.event_id.length > 200) errors.push('event_id is required and must be 200 characters or fewer');
  if (!event.event_type || event.event_type.length > 100) errors.push('event_type is required and must be 100 characters or fewer');
  if (!event.occurred_at || !Number.isFinite(new Date(event.occurred_at).getTime())) errors.push('occurred_at must be a valid timestamp');
  if (!event.subject || !Object.values(event.subject).some(Boolean)) errors.push('subject must include an enrollment or external identity');
  if (event.activity?.duration_seconds !== undefined && event.activity.duration_seconds < 0) errors.push('duration_seconds cannot be negative');
  if (event.activity?.progress_percent !== undefined && (event.activity.progress_percent < 0 || event.activity.progress_percent > 100)) {
    errors.push('progress_percent must be between 0 and 100');
  }
  for (const attachment of event.attachments || []) {
    if (!attachment.url) continue;
    try {
      const url = new URL(attachment.url);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
        errors.push('attachment URLs must be credential-free HTTPS URLs without query strings');
      }
    } catch {
      errors.push('attachment URL is invalid');
    }
  }
  if (!SUPPORTED_CANONICAL_EVENT_TYPES.has(event.event_type) && !approvedCustomTypes.includes(event.event_type)) {
    errors.push('event_type is not supported or approved by this connection');
  }
  return errors;
}
