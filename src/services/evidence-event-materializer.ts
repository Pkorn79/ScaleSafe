import { EVIDENCE_TYPES, EvidenceType } from '../constants/evidence-types';
import { CanonicalEvidenceEvent, EvidenceConnectionRecord, ExternalEvidenceEventRecord } from '../types/evidence-connector.types';
import { DefenseProofRole, DefenseReasonCodeTag } from '../types/defense-evidence.types';
import { buildDefenseEvidenceFields } from '../utils/defense-evidence';

export interface EvidenceMaterialization {
  evidenceType: EvidenceType;
  table: string;
  record: Record<string, unknown>;
}

const CLIENT_ACTIVITY_TAGS: DefenseReasonCodeTag[] = ['services_not_provided', 'not_as_described', 'fraud'];
const DELIVERY_TAGS: DefenseReasonCodeTag[] = ['services_not_provided', 'not_as_described'];

function isPositiveAccessEvent(eventType: string): boolean {
  return [
    'service.access_granted',
    'service.login',
    'service.usage',
    'content.viewed',
    'content.downloaded',
    'course.started',
    'course.progressed',
    'course.completed',
  ].includes(eventType);
}

function clean(value: unknown, fallback = '', max = 500): string {
  const text = String(value ?? fallback).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return text.slice(0, max);
}

function actor(event: CanonicalEvidenceEvent): 'client' | 'merchant' | 'third_party' | 'system' | 'unknown' {
  const value = event.actor?.type;
  if (value === 'client' || value === 'merchant' || value === 'system') return value;
  if (value === 'provider') return 'third_party';
  return 'unknown';
}

function evidenceFields(params: {
  event: CanonicalEvidenceEvent;
  intake: ExternalEvidenceEventRecord;
  connection: EvidenceConnectionRecord;
  enrollment: any;
  title: string;
  summary: string;
  proofRole: DefenseProofRole;
  tags: DefenseReasonCodeTag[];
  priority: 'critical' | 'high' | 'medium' | 'low';
}) {
  const authConfidence = params.intake.signature_verified || params.intake.auth_method === 'api_key' ? 'strong' : 'moderate';
  return buildDefenseEvidenceFields({
    summary: params.summary,
    title: params.title,
    proofRole: params.proofRole,
    relevance: { tags: params.tags, priority: params.priority, confidence: authConfidence },
    enrollmentId: params.enrollment.id,
    sourceRecordId: params.event.event_id,
    actor: actor(params.event),
    metadata: {
      actor: actor(params.event),
      customerIdentity: {
        email: params.event.subject.email || params.event.actor?.email || null,
        ipAddress: params.event.actor?.ip_address || null,
        deviceFingerprint: params.event.actor?.device_fingerprint || null,
      },
      service: {
        enrollmentId: params.enrollment.id,
        offerId: params.enrollment.offer_id || null,
        offerName: params.enrollment.offer_name || params.enrollment.offer?.offer_name || null,
        deliverableName: params.event.resource?.name || params.event.activity?.title || null,
        serviceDate: params.event.occurred_at,
        accessConfirmed: isPositiveAccessEvent(params.event.event_type),
      },
      source: {
        system: params.connection.source_label,
        recordId: params.event.event_id,
        rawEventType: params.event.event_type,
      },
      connector: {
        connectionId: params.connection.id,
        connectorEventId: params.intake.id,
        authMethod: params.intake.auth_method,
        signatureVerified: params.intake.signature_verified,
        payloadHash: params.intake.payload_hash,
        occurredAt: params.event.occurred_at,
        receivedAt: params.intake.received_at,
        resolutionMethod: params.intake.resolution_method,
        attachments: Array.isArray(params.event.metadata?.validated_attachments)
          ? params.event.metadata?.validated_attachments
          : [],
      },
    },
  });
}

function common(params: {
  event: CanonicalEvidenceEvent;
  intake: ExternalEvidenceEventRecord;
  connection: EvidenceConnectionRecord;
  enrollment: any;
  title: string;
  summary: string;
  proofRole: DefenseProofRole;
  tags: DefenseReasonCodeTag[];
  priority: 'critical' | 'high' | 'medium' | 'low';
}) {
  return {
    location_id: params.intake.location_id,
    contact_id: params.enrollment.contact_id,
    enrollment_id: params.enrollment.id,
    source: `external:${clean(params.connection.source_label, 'provider', 80)}`,
    connector_event_id: params.intake.id,
    raw_payload: params.event,
    ...evidenceFields(params),
  };
}

function formatDuration(seconds: number | undefined): string {
  if (!seconds || seconds <= 0) return '';
  const minutes = Math.round(seconds / 60);
  return ` for ${minutes} minute${minutes === 1 ? '' : 's'}`;
}

export function materializeExternalEvidence(params: {
  event: CanonicalEvidenceEvent;
  intake: ExternalEvidenceEventRecord;
  connection: EvidenceConnectionRecord;
  subject: any;
}): EvidenceMaterialization {
  const { event, intake, connection, subject } = params;
  const enrollment = subject.enrollment || subject;
  const resource = clean(event.resource?.name || event.activity?.title || event.resource?.type || 'service activity', '', 200);
  const provider = clean(connection.source_label, 'External provider', 100);
  const status = clean(event.activity?.status || event.event_type.split('.').pop(), 'recorded', 60);
  const base = { event, intake, connection, enrollment };

  if (event.event_type.startsWith('session.')) {
    if (event.event_type === 'session.no_show') {
      const summary = `${provider} reported that the client did not attend ${resource} on ${event.occurred_at}.`;
      return {
        evidenceType: EVIDENCE_TYPES.SESSION_ATTENDANCE,
        table: 'evidence_attendance',
        record: {
          ...common({ ...base, title: `Session No-Show: ${resource}`, summary, proofRole: 'client_engagement', tags: ['services_not_provided'], priority: 'medium' }),
          session_date: event.occurred_at,
          status: 'no_show',
          notes: clean(event.activity?.description, '', 1000) || null,
        },
      };
    }
    const delivered = event.event_type === 'session.completed' || event.event_type === 'session.attended';
    const summary = `${provider} reported that the client ${status} ${resource} on ${event.occurred_at}${formatDuration(event.activity?.duration_seconds)}.`;
    return {
      evidenceType: EVIDENCE_TYPES.EXTERNAL_SESSION,
      table: 'evidence_external_sessions',
      record: {
        ...common({
          ...base,
          title: `Session ${capitalize(status)}: ${resource}`,
          summary,
          proofRole: delivered ? 'service_delivery' : 'client_engagement',
          tags: delivered ? DELIVERY_TAGS : ['general'],
          priority: delivered ? 'high' : 'low',
        }),
        platform: provider,
        session_date: event.occurred_at,
        duration_minutes: event.activity?.duration_seconds ? Math.round(event.activity.duration_seconds / 60) : null,
        session_type: clean(event.resource?.type, 'session', 100),
        notes: clean(event.activity?.description, '', 1000) || null,
      },
    };
  }

  if (event.event_type.startsWith('appointment.')) {
    const normalizedStatus = event.event_type.endsWith('no_show') ? 'no_show' : event.event_type.endsWith('cancelled') ? 'cancelled' : 'attended';
    const attended = normalizedStatus === 'attended';
    const noShow = normalizedStatus === 'no_show';
    const summary = `${provider} reported appointment status "${normalizedStatus}" for ${resource} on ${event.occurred_at}.`;
    return {
      evidenceType: EVIDENCE_TYPES.SESSION_ATTENDANCE,
      table: 'evidence_attendance',
      record: {
        ...common({
          ...base,
          title: `Appointment ${capitalize(normalizedStatus)}: ${resource}`,
          summary,
          proofRole: attended ? 'service_delivery' : 'client_engagement',
          tags: attended ? DELIVERY_TAGS : noShow ? ['services_not_provided'] : ['general'],
          priority: attended ? 'high' : noShow ? 'medium' : 'low',
        }),
        session_date: event.occurred_at,
        status: normalizedStatus,
        notes: clean(event.activity?.description, '', 1000) || null,
      },
    };
  }

  if (event.event_type.startsWith('module.')) {
    const completionStatus = event.event_type.endsWith('completed') ? 'completed' : event.event_type.endsWith('started') ? 'started' : 'in_progress';
    const summary = `${provider} reported ${resource} as ${completionStatus.replace('_', ' ')} on ${event.occurred_at}${event.activity?.progress_percent !== undefined ? ` at ${event.activity.progress_percent}% progress` : ''}.`;
    return {
      evidenceType: event.event_type.endsWith('completed') ? EVIDENCE_TYPES.MODULE_COMPLETION : EVIDENCE_TYPES.MODULE_PROGRESS,
      table: 'evidence_modules',
      record: {
        ...common({ ...base, title: `Module ${capitalize(completionStatus)}: ${resource}`, summary, proofRole: 'service_delivery', tags: DELIVERY_TAGS, priority: event.event_type.endsWith('completed') ? 'high' : 'medium' }),
        module_name: resource,
        completion_date: event.occurred_at,
        completion_status: completionStatus,
        progress_pct: event.activity?.progress_percent ?? (completionStatus === 'completed' ? 100 : 0),
        time_spent_minutes: event.activity?.duration_seconds ? Math.round(event.activity.duration_seconds / 60) : null,
        notes: clean(event.activity?.description, '', 1000) || null,
      },
    };
  }

  if (event.event_type === 'course.completed') {
    const summary = `${provider} reported that the client completed ${resource} on ${event.occurred_at}.`;
    return {
      evidenceType: EVIDENCE_TYPES.COURSE_COMPLETION,
      table: 'evidence_course_completion',
      record: {
        ...common({ ...base, title: `Course Completed: ${resource}`, summary, proofRole: 'service_delivery', tags: DELIVERY_TAGS, priority: 'high' }),
        platform: provider,
        course_name: resource,
        completed_at: event.occurred_at,
      },
    };
  }

  if (event.event_type.startsWith('service.') || event.event_type.startsWith('content.') || event.event_type.startsWith('course.')) {
    const positiveAccess = isPositiveAccessEvent(event.event_type);
    const summary = `${provider} reported client activity "${event.event_type}" for ${resource} on ${event.occurred_at}${formatDuration(event.activity?.duration_seconds)}.`;
    return {
      evidenceType: EVIDENCE_TYPES.SERVICE_ACCESS,
      table: 'evidence_service_access',
      record: {
        ...common({
          ...base,
          title: `Service Activity: ${resource}`,
          summary,
          proofRole: positiveAccess ? 'service_access' : 'system_event',
          tags: positiveAccess ? CLIENT_ACTIVITY_TAGS : ['general'],
          priority: positiveAccess ? 'high' : 'low',
        }),
        platform: provider,
        event_type: event.event_type,
        access_date: event.occurred_at,
        duration_seconds: event.activity?.duration_seconds || null,
        ip_address: event.actor?.ip_address || null,
        device_fingerprint: event.actor?.device_fingerprint || null,
        content_accessed: resource,
      },
    };
  }

  if (event.event_type.startsWith('milestone.')) {
    const result = event.event_type.split('.')[1] || status;
    const summary = `${provider} reported milestone "${resource}" as ${result} on ${event.occurred_at}.`;
    return {
      evidenceType: EVIDENCE_TYPES.MILESTONE_COMPLETION,
      table: 'evidence_milestones',
      record: {
        ...common({ ...base, title: `Milestone ${capitalize(result)}: ${resource}`, summary, proofRole: 'service_delivery', tags: DELIVERY_TAGS, priority: result === 'approved' ? 'critical' : 'high' }),
        milestone_name: resource,
        completed_at: event.occurred_at,
        description: clean(event.activity?.description || result, result, 1000),
        notes: event.activity?.result ? clean(event.activity.result, '', 1000) : null,
      },
    };
  }

  if (event.event_type.startsWith('assignment.')) {
    const result = event.event_type.split('.')[1] || status;
    const summary = `${provider} reported assignment "${resource}" as ${result} on ${event.occurred_at}.`;
    return {
      evidenceType: EVIDENCE_TYPES.ASSIGNMENT_SUBMISSION,
      table: 'evidence_assignments',
      record: {
        ...common({ ...base, title: `Assignment ${capitalize(result)}: ${resource}`, summary, proofRole: 'client_engagement', tags: CLIENT_ACTIVITY_TAGS, priority: 'medium' }),
        title: resource,
        submitted_at: event.occurred_at,
        grade: clean(event.activity?.result, '', 100) || null,
        feedback: clean(event.activity?.description, '', 1000) || null,
      },
    };
  }

  if (event.event_type.startsWith('deliverable.')) {
    const result = event.event_type.split('.')[1] || status;
    const summary = `${provider} reported deliverable "${resource}" as ${result} on ${event.occurred_at}.`;
    return {
      evidenceType: EVIDENCE_TYPES.RESOURCE_DELIVERY,
      table: 'evidence_resource_delivery',
      record: {
        ...common({ ...base, title: `Deliverable ${capitalize(result)}: ${resource}`, summary, proofRole: 'service_delivery', tags: DELIVERY_TAGS, priority: result === 'accepted' ? 'critical' : 'high' }),
        resource_type: clean(event.resource?.type, 'deliverable', 100),
        title: resource,
        delivered_at: event.occurred_at,
        access_confirmed: ['viewed', 'downloaded', 'accepted'].includes(result),
        delivery_method: provider,
      },
    };
  }

  if (event.event_type.startsWith('communication.') || event.event_type.startsWith('support.')) {
    const inbound = event.event_type.endsWith('received') || event.actor?.type === 'client';
    const summary = `${provider} recorded ${inbound ? 'inbound' : 'outbound'} ${event.event_type.startsWith('support.') ? 'support activity' : 'communication'} on ${event.occurred_at}: ${clean(event.activity?.description || resource, resource, 300)}.`;
    return {
      evidenceType: EVIDENCE_TYPES.COMMUNICATION,
      table: 'evidence_communication',
      record: {
        ...common({ ...base, title: `${inbound ? 'Client' : 'Merchant'} Communication: ${resource}`, summary, proofRole: 'communication', tags: DELIVERY_TAGS, priority: inbound ? 'high' : 'medium' }),
        comm_type: 'other',
        direction: inbound ? 'inbound' : 'outbound',
        comm_date: event.occurred_at,
        subject: resource,
        summary: clean(event.activity?.description, resource, 1000),
        body_preview: clean(event.activity?.description, '', 1000) || null,
      },
    };
  }

  if (event.event_type === 'account.onboarding_completed') {
    const summary = `${provider} reported completion of onboarding activity “${resource}” on ${event.occurred_at}.`;
    return {
      evidenceType: EVIDENCE_TYPES.SERVICE_ACCESS,
      table: 'evidence_service_access',
      record: {
        ...common({ ...base, title: `Onboarding Completed: ${resource}`, summary, proofRole: 'service_delivery', tags: DELIVERY_TAGS, priority: 'high' }),
        platform: provider,
        event_type: event.event_type,
        access_date: event.occurred_at,
        content_accessed: resource,
      },
    };
  }

  if (event.event_type === 'pulse.submitted') {
    const score = Number(event.metadata?.satisfaction ?? event.activity?.result);
    const normalizedScore = Number.isFinite(score) ? Math.max(1, Math.min(Math.round(score), 5)) : null;
    const summary = `${provider} reported a client pulse check-in on ${event.occurred_at}${normalizedScore ? ` with satisfaction ${normalizedScore}/5` : ''}.`;
    return {
      evidenceType: EVIDENCE_TYPES.PULSE_CHECKIN,
      table: 'evidence_pulse_checkins',
      record: {
        ...common({ ...base, title: 'Client Pulse Check-In', summary, proofRole: 'client_engagement', tags: CLIENT_ACTIVITY_TAGS, priority: 'high' }),
        checkin_date: event.occurred_at,
        sentiment_score: normalizedScore,
        feedback_text: clean(event.activity?.description, '', 2000) || null,
        follow_up_needed: event.metadata?.follow_up_needed === true,
      },
    };
  }

  if (event.event_type === 'payment.observed') {
    const amount = Number(event.metadata?.amount);
    const summary = `${provider} reported supplemental payment activity on ${event.occurred_at}${Number.isFinite(amount) ? ` for $${amount.toFixed(2)}` : ''}. This record does not alter ScaleSafe payment state.`;
    return {
      evidenceType: EVIDENCE_TYPES.PAYMENT_CONFIRMATION,
      table: 'evidence_payment_confirmation',
      record: {
        ...common({ ...base, title: 'External Payment Activity', summary, proofRole: 'payment_history', tags: ['credit_not_processed', 'cancelled_recurring'], priority: 'medium' }),
        amount: Number.isFinite(amount) ? amount : null,
        currency: clean(event.metadata?.currency, 'USD', 8),
        payment_date: event.occurred_at,
        payment_method: clean(event.metadata?.payment_method, provider, 100),
      },
    };
  }

  const summary = `${provider} reported approved custom activity "${event.event_type}" for ${resource} on ${event.occurred_at}.`;
  return {
    evidenceType: EVIDENCE_TYPES.CUSTOM_EVENT,
    table: 'evidence_custom_events',
    record: {
      ...common({ ...base, title: `External Activity: ${resource}`, summary, proofRole: 'other', tags: ['general'], priority: 'low' }),
      event_type: event.event_type,
      event_timestamp: event.occurred_at,
      description: clean(event.activity?.description, summary, 1000),
      metadata: { approved_for_defense: true, result: event.activity?.result || null },
    },
  };
}

function capitalize(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
