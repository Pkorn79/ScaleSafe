import crypto from 'crypto';
import { evidenceConnectorRepository } from '../repositories/evidence-connector.repository';
import { CanonicalEvidenceEvent, EvidenceConnectionRecord, ExternalEvidenceEventRecord } from '../types/evidence-connector.types';
import { logger } from '../utils/logger';
import { materializeExternalEvidence } from './evidence-event-materializer';
import { evidenceService } from './evidence.service';
import { externalEvidenceAttachmentService } from './external-evidence-attachment.service';

const workerId = `connector_${process.pid}_${crypto.randomBytes(6).toString('hex')}`;
const retryDelaysMs = [5 * 60_000, 60 * 60_000, 6 * 60 * 60_000];
let running = false;
let timer: NodeJS.Timeout | null = null;

interface Resolution {
  subject: any;
  method: string;
}

async function resourceOfferId(connection: EvidenceConnectionRecord, event: CanonicalEvidenceEvent): Promise<string | null> {
  if (!event.resource?.type || !event.resource?.id) return null;
  const mapping = await evidenceConnectorRepository.findResourceMapping(connection.id, event.resource.type, event.resource.id);
  return mapping?.offer_id || null;
}

function normalizedLabel(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function enrollmentEligibleAt(subject: any, occurredAt: string): boolean {
  const enrollment = subject?.enrollment || subject;
  if (!enrollment?.id) return false;
  const occurred = new Date(occurredAt).getTime();
  if (!Number.isFinite(occurred)) return false;
  const enrolledAt = enrollment.enrolled_at ? new Date(enrollment.enrolled_at).getTime() : 0;
  if (Number.isFinite(enrolledAt) && enrolledAt > 0 && occurred < enrolledAt) return false;
  const cancelledAt = enrollment.cancelled_at ? new Date(enrollment.cancelled_at).getTime() : 0;
  if (Number.isFinite(cancelledAt) && cancelledAt > 0 && occurred > cancelledAt) return false;
  const completedAt = enrollment.completed_at ? new Date(enrollment.completed_at).getTime() : 0;
  if (Number.isFinite(completedAt) && completedAt > 0 && occurred > completedAt) return false;
  return !['pending', 'consent_captured', 'paid_pending_enrollment'].includes(String(enrollment.status || ''));
}

function uniqueSubjects(rows: any[]): any[] {
  return Array.from(new Map(rows.filter(Boolean).map((row) => [row.id, row])).values());
}

async function resolveUnmappedZoomSubject(connection: EvidenceConnectionRecord, event: CanonicalEvidenceEvent): Promise<Resolution> {
  const normalizedEmail = String(event.subject.email || event.actor?.email || '').trim().toLowerCase();
  if (!normalizedEmail) throw resolutionError('ZOOM_PARTICIPANT_EMAIL_MISSING', false);

  let identityMatches: any[] = [];
  if (event.subject.external_contact_id) {
    identityMatches = await evidenceConnectorRepository.findSubjectsByIdentity(
      connection.id,
      event.subject.external_contact_id,
      undefined,
    );
  }
  const emailMatches = await evidenceConnectorRepository.findSubjectsByEmail(connection.location_id, normalizedEmail);
  const eligible = uniqueSubjects([...identityMatches, ...emailMatches])
    .filter((subject) => enrollmentEligibleAt(subject, event.occurred_at));

  if (eligible.length === 1) return { subject: eligible[0], method: 'zoom_exact_email_unique_enrollment' };
  if (!eligible.length) throw resolutionError('ZOOM_ENROLLMENT_NOT_READY', true);

  const meetingName = normalizedLabel(event.resource?.name);
  if (meetingName) {
    const topicMatches = eligible.filter((subject) => normalizedLabel(subject.offer?.offer_name) === meetingName);
    if (topicMatches.length === 1) return { subject: topicMatches[0], method: 'zoom_email_and_exact_offer_name' };
  }

  const liveVirtual = eligible.filter((subject) => /zoom|meet|virtual/i.test(String(subject.offer?.delivery_method || '')));
  if (liveVirtual.length === 1) return { subject: liveVirtual[0], method: 'zoom_email_and_unique_live_virtual_enrollment' };
  throw resolutionError('AMBIGUOUS_ZOOM_ENROLLMENT', false);
}

export async function resolveConnectorSubject(connection: EvidenceConnectionRecord, event: CanonicalEvidenceEvent): Promise<Resolution> {
  if (event.subject.enrollment_ref) {
    const subject = await evidenceConnectorRepository.findSubjectByRef(connection.location_id, event.subject.enrollment_ref);
    if (!subject) throw resolutionError('ENROLLMENT_REF_NOT_FOUND', false);
    return { subject, method: 'enrollment_ref' };
  }

  if (event.subject.external_enrollment_id) {
    const matches = await evidenceConnectorRepository.findSubjectsByIdentity(
      connection.id,
      undefined,
      event.subject.external_enrollment_id,
    );
    if (matches.length === 1) return { subject: matches[0], method: 'external_enrollment_identity' };
    if (matches.length > 1) throw resolutionError('AMBIGUOUS_EXTERNAL_ENROLLMENT', false);
  }

  const offerId = await resourceOfferId(connection, event);
  if (!offerId && connection.provider_key === 'zoom') {
    return resolveUnmappedZoomSubject(connection, event);
  }
  if (!offerId) throw resolutionError('RESOURCE_NOT_MAPPED', false);

  if (event.subject.external_contact_id) {
    const matches = await evidenceConnectorRepository.findSubjectsByIdentity(
      connection.id,
      event.subject.external_contact_id,
      undefined,
    );
    const offerMatches = matches.filter((subject: any) => subject.offer_id === offerId);
    if (offerMatches.length === 1) return { subject: offerMatches[0], method: 'external_contact_and_resource' };
    if (offerMatches.length > 1) throw resolutionError('AMBIGUOUS_EXTERNAL_CONTACT', false);
  }

  const normalizedEmail = String(event.subject.email || event.actor?.email || '').trim().toLowerCase();
  if (!normalizedEmail) throw resolutionError('SUBJECT_IDENTITY_MISSING', false);
  const matches = await evidenceConnectorRepository.findSubjectsByEmailAndOffer(connection.location_id, normalizedEmail, offerId);
  if (matches.length === 1) return { subject: matches[0], method: 'exact_email_and_offer' };
  if (matches.length > 1) throw resolutionError('AMBIGUOUS_EMAIL_AND_OFFER', false);
  throw resolutionError('ENROLLMENT_NOT_READY', true);
}

function resolutionError(code: string, retryable: boolean): Error & { code: string; retryable: boolean } {
  return Object.assign(new Error(code.replace(/_/g, ' ').toLowerCase()), { code, retryable });
}

export function connectorCanProcess(connection: EvidenceConnectionRecord, isTest: boolean): boolean {
  const setupActive = connection.connection_type === 'legacy_external' || connection.setup_status === 'active';
  if (isTest) return ['draft', 'testing', 'active'].includes(connection.setup_status || '');
  return connection.status === 'active' && setupActive;
}

async function persistIdentity(
  connection: EvidenceConnectionRecord,
  subject: any,
  event: CanonicalEvidenceEvent,
  resolutionMethod: string,
  intake: ExternalEvidenceEventRecord,
): Promise<void> {
  if (!event.subject.external_contact_id && !event.subject.external_enrollment_id) return;
  await evidenceConnectorRepository.persistIdentity({
    connection_id: connection.id,
    subject_id: subject.id,
    location_id: connection.location_id,
    external_contact_id: event.subject.external_contact_id || null,
    external_enrollment_id: event.subject.external_enrollment_id || null,
    binding_method: resolutionMethod,
    verification_metadata: {
      auth_method: intake.auth_method,
      signature_verified: intake.signature_verified,
      resource_type: event.resource?.type || null,
      external_resource_id: event.resource?.id || null,
    },
    verified_at: new Date().toISOString(),
  });
}

async function retryOrQuarantine(event: ExternalEvidenceEventRecord, err: any): Promise<void> {
  const retryable = err?.retryable === true && event.attempts <= retryDelaysMs.length;
  if (retryable) {
    const delay = retryDelaysMs[Math.max(0, event.attempts - 1)];
    await evidenceConnectorRepository.updateEvent(event.id, {
      status: 'retrying',
      next_attempt_at: new Date(Date.now() + delay).toISOString(),
      lease_owner: null,
      lease_expires_at: null,
      error_code: err.code || 'PROCESSING_FAILED',
      error_message: String(err.message || err).slice(0, 1000),
      updated_at: new Date().toISOString(),
    });
    return;
  }
  await evidenceConnectorRepository.updateEvent(event.id, {
    status: 'quarantined',
    next_attempt_at: null,
    lease_owner: null,
    lease_expires_at: null,
    error_code: err.code || 'PROCESSING_FAILED',
    error_message: String(err.message || err).slice(0, 1000),
    updated_at: new Date().toISOString(),
  });
  await evidenceConnectorRepository.updateConnectionHealth(event.connection_id, false, String(err.message || err).slice(0, 500));
}

async function processEvent(event: ExternalEvidenceEventRecord): Promise<void> {
  try {
    const connection = await evidenceConnectorRepository.getConnection(event.location_id, event.connection_id);
    if (!connection) throw resolutionError('CONNECTION_DISABLED', false);
    if (!connectorCanProcess(connection, event.is_test)) {
      throw resolutionError('CONNECTION_DISABLED', false);
    }
    const canonical = event.normalized_payload as CanonicalEvidenceEvent | null;
    if (!canonical) throw resolutionError('NORMALIZED_PAYLOAD_MISSING', false);

    const resolution = await resolveConnectorSubject(connection, canonical);
    const enrollment = resolution.subject.enrollment || resolution.subject;
    const resolvedEvent: ExternalEvidenceEventRecord = {
      ...event,
      resolution_method: resolution.method,
      subject_id: resolution.subject.id,
      enrollment_id: enrollment.id,
      contact_id: enrollment.contact_id,
      offer_id: enrollment.offer_id,
    };

    await persistIdentity(connection, resolution.subject, canonical, resolution.method, event);

    if (event.is_test) {
      await evidenceConnectorRepository.updateEvent(event.id, {
        status: 'published',
        subject_id: resolution.subject.id,
        enrollment_id: enrollment.id,
        contact_id: enrollment.contact_id,
        offer_id: enrollment.offer_id,
        resolution_method: resolution.method,
        lease_owner: null,
        lease_expires_at: null,
        error_code: null,
        error_message: null,
        published_at: new Date().toISOString(),
      });
      await evidenceConnectorRepository.updateConnectionHealth(connection.id, true);
      return;
    }

    let attachmentWarning: string | null = null;
    let eventForEvidence = canonical;
    try {
      const attachments = await externalEvidenceAttachmentService.processEventAttachments(connection, event.id, enrollment.id, canonical);
      eventForEvidence = {
        ...canonical,
        metadata: { ...(canonical.metadata || {}), validated_attachments: attachments },
      };
      await evidenceConnectorRepository.updateEvent(event.id, { normalized_payload: eventForEvidence });
    } catch (attachmentErr: any) {
      attachmentWarning = String(attachmentErr.message || attachmentErr).slice(0, 500);
      logger.warn({ err: attachmentWarning, connectorEventId: event.id }, 'External evidence attachment rejected');
    }

    const materialization = materializeExternalEvidence({
      event: eventForEvidence,
      intake: resolvedEvent,
      connection,
      subject: resolution.subject,
    });

    let evidenceId = await evidenceConnectorRepository.findEvidenceByConnectorEvent(materialization.table, event.id);
    if (!evidenceId) {
      await evidenceService.logEvidence(
        materialization.evidenceType,
        event.location_id,
        enrollment.contact_id,
        String(materialization.record.source),
        materialization.record,
      );
      evidenceId = await evidenceConnectorRepository.findEvidenceByConnectorEvent(materialization.table, event.id);
    }
    if (!evidenceId) throw new Error('Evidence row was written but could not be verified');

    await evidenceConnectorRepository.updateEvent(event.id, {
      status: 'published',
      subject_id: resolution.subject.id,
      enrollment_id: enrollment.id,
      contact_id: enrollment.contact_id,
      offer_id: enrollment.offer_id,
      resolution_method: resolution.method,
      evidence_type: materialization.evidenceType,
      evidence_table: materialization.table,
      evidence_record_id: evidenceId,
      lease_owner: null,
      lease_expires_at: null,
      error_code: attachmentWarning ? 'ATTACHMENT_REJECTED' : null,
      error_message: attachmentWarning,
      published_at: new Date().toISOString(),
    });
    if (attachmentWarning) await evidenceConnectorRepository.updateConnectionWarning(connection.id, attachmentWarning);
    else await evidenceConnectorRepository.updateConnectionHealth(connection.id, true);
  } catch (err: any) {
    logger.warn({ err: err.message, code: err.code, connectorEventId: event.id }, 'External evidence event processing failed');
    await retryOrQuarantine(event, err);
  }
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const events = await evidenceConnectorRepository.claimEvents(workerId, 20);
    await Promise.all(events.map((event) => processEvent(event)));
  } catch (err: any) {
    logger.error({ err: err.message }, 'External evidence worker tick failed');
  } finally {
    running = false;
  }
}

let lastContextCleanupAt = 0;

async function cleanupExpiredContexts(): Promise<void> {
  if (Date.now() - lastContextCleanupAt < 60 * 60 * 1000) return;
  lastContextCleanupAt = Date.now();
  try {
    const expired = await evidenceConnectorRepository.expireEnrollmentContexts();
    if (expired > 0) logger.info({ expired }, 'Expired evidence enrollment contexts cleaned up');
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Evidence enrollment context cleanup failed');
  }
}

export const evidenceConnectorWorker = {
  start(): void {
    if (timer) return;
    timer = setInterval(() => {
      void tick();
      void cleanupExpiredContexts();
    }, 5000);
    timer.unref();
    setTimeout(() => {
      void tick();
      void cleanupExpiredContexts();
    }, 1000).unref();
  },
  async runOnce(): Promise<void> {
    await tick();
  },
  stop(): void {
    if (timer) clearInterval(timer);
    timer = null;
  },
};
