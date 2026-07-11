import { merchantRepository } from '../repositories/merchant.repository';
import { ghlFulfillmentRepository, GhlFulfillmentCourseRow } from '../repositories/ghl-fulfillment.repository';
import { logger } from '../utils/logger';

export type GhlFulfillmentCapabilityStatus = 'active' | 'ready' | 'testing' | 'needs_setup' | 'not_certified';

export interface GhlFulfillmentCapability {
  key: string;
  label: string;
  status: GhlFulfillmentCapabilityStatus;
  detail: string;
  eventCount: number;
  lastEventAt: string | null;
}

function parseScopes(value: string | null | undefined): Set<string> {
  return new Set(String(value || '').split(/[\s,]+/).map((scope) => scope.trim()).filter(Boolean));
}

function hasAnyScope(scopes: Set<string>, expected: string[]): boolean {
  return expected.some((scope) => scopes.has(scope));
}

function latestDate(rows: Array<{ occurred_at?: string | null; created_at?: string | null }>): string | null {
  return rows
    .map((row) => row.occurred_at || row.created_at || '')
    .filter(Boolean)
    .sort()
    .pop() || null;
}

function capability(
  key: string,
  label: string,
  configured: boolean,
  rows: Array<{ occurred_at?: string | null; created_at?: string | null }>,
  readyDetail: string,
  setupDetail: string,
): GhlFulfillmentCapability {
  if (rows.length > 0) {
    return {
      key,
      label,
      status: 'active',
      detail: `${rows.length} event${rows.length === 1 ? '' : 's'} observed.`,
      eventCount: rows.length,
      lastEventAt: latestDate(rows),
    };
  }
  return {
    key,
    label,
    status: configured ? 'ready' : 'needs_setup',
    detail: configured ? readyDetail : setupDetail,
    eventCount: 0,
    lastEventAt: null,
  };
}

function courseEventType(row: GhlFulfillmentCourseRow): string {
  if (row.table === 'evidence_service_access') return row.payload.event_type || 'Course access';
  if (row.table === 'evidence_course_completion') return 'Course completed';
  if (row.table === 'evidence_assignments') return 'Assignment submitted';
  return row.payload.completion_status === 'completed' ? 'Module completed' : 'Module progress';
}

function courseTitle(row: GhlFulfillmentCourseRow): string {
  return row.payload.course_name
    || row.payload.module_name
    || row.payload.title
    || row.payload.content_accessed
    || 'GHL course activity';
}

export const ghlFulfillmentService = {
  async getHealth(locationId: string) {
    const merchant = await merchantRepository.getByLocationId(locationId);
    const scopes = parseScopes(merchant.ghl_scopes);

    let activities: any[] = [];
    let courseRows: GhlFulfillmentCourseRow[] = [];
    const queryErrors: string[] = [];
    try {
      activities = await ghlFulfillmentRepository.listActivityEvents(locationId, 150);
    } catch (err: any) {
      queryErrors.push('GHL activity diagnostics could not be loaded.');
      logger.warn({ err: err.message, locationId }, 'Could not load GHL fulfillment activity diagnostics');
    }
    try {
      courseRows = await ghlFulfillmentRepository.listCourseEvidence(locationId, 30);
    } catch (err: any) {
      queryErrors.push('GHL course diagnostics could not be loaded.');
      logger.warn({ err: err.message, locationId }, 'Could not load GHL course diagnostics');
    }

    const appointments = activities.filter((row) => row.source_object === 'appointment');
    const communications = activities.filter((row) => row.source_object === 'communication');
    const invoices = activities.filter((row) => row.source_object === 'invoice');
    const failed = activities.filter((row) => row.status === 'failed');
    const unresolved = activities.filter((row) => row.status === 'unmatched' || row.status === 'client_level');
    const matched = activities.filter((row) => row.status === 'matched');

    const appointmentAuthorized = hasAnyScope(scopes, ['calendars/events.readonly']);
    const communicationsAuthorized = hasAnyScope(scopes, [
      'conversations.readonly',
      'conversations/message.readonly',
      'conversations/message.write',
    ]);
    const invoicesAuthorized = hasAnyScope(scopes, ['invoices.readonly']);
    const courseBridgeConfigured = Boolean(merchant.module_course && merchant.webhook_secret);

    const capabilities: GhlFulfillmentCapability[] = [
      capability(
        'appointments',
        'Calendars and appointments',
        appointmentAuthorized,
        appointments,
        'Authorized. ScaleSafe is waiting for the first appointment webhook.',
        'Enable calendars/events.readonly and the appointment create, update, and delete webhooks.',
      ),
      capability(
        'communications',
        'Email, SMS, and conversations',
        communicationsAuthorized,
        communications,
        'Authorized. ScaleSafe is waiting for the first conversation event.',
        'Conversation access is not authorized for this installation.',
      ),
      capability(
        'invoices',
        'Invoices',
        invoicesAuthorized,
        invoices,
        'Authorized. ScaleSafe is waiting for the first invoice event.',
        'Invoice evidence is optional and is not authorized for this installation.',
      ),
      {
        key: 'course_progress',
        label: 'Course access and progress',
        status: courseRows.length > 0 ? 'active' : courseBridgeConfigured ? 'testing' : 'needs_setup',
        detail: courseRows.length > 0
          ? `${courseRows.length} course event${courseRows.length === 1 ? '' : 's'} observed.`
          : courseBridgeConfigured
            ? 'The ScaleSafe course bridge is configured but has not been certified with a live course event.'
            : 'Enable the course module and configure the ScaleSafe course workflow bridge.',
        eventCount: courseRows.length,
        lastEventAt: latestDate(courseRows),
      },
      {
        key: 'assessments',
        label: 'Quizzes and assignments',
        status: 'not_certified',
        detail: 'GHL supports these activities, but ScaleSafe has not certified their event contract yet.',
        eventCount: courseRows.filter((row) => row.table === 'evidence_assignments').length,
        lastEventAt: latestDate(courseRows.filter((row) => row.table === 'evidence_assignments')),
      },
      {
        key: 'certificates_community',
        label: 'Certificates and community activity',
        status: 'not_certified',
        detail: 'Planned for the next GHL Fulfillment certification pass.',
        eventCount: 0,
        lastEventAt: null,
      },
    ];

    const healthStatus = queryErrors.length || failed.length || unresolved.length || !appointmentAuthorized ? 'warning' : 'ready';
    const statusMessage = queryErrors[0]
      || (failed.length ? `${failed.length} GHL event${failed.length === 1 ? '' : 's'} failed processing.` : null)
      || (!appointmentAuthorized ? 'Calendar event access is not authorized.' : null)
      || (unresolved.length ? `${unresolved.length} recent event${unresolved.length === 1 ? '' : 's'} could not be tied to one program.` : null);

    const nativeEvents = activities.map((row) => ({
      id: row.id,
      eventType: row.event_type,
      source: row.source_object,
      occurredAt: row.occurred_at || row.created_at,
      receivedAt: row.created_at,
      status: row.status,
      enrollmentId: row.enrollment_id || null,
      offerId: row.offer_id || null,
      matchMethod: row.match_reason || null,
      title: row.normalized?.title || row.normalized?.appointment_title || row.source_object,
      error: row.error_message || null,
    }));
    const courseEvents = courseRows.map((row) => ({
      id: `${row.table}:${row.id}`,
      eventType: courseEventType(row),
      source: 'course',
      occurredAt: row.payload.event_timestamp || row.payload.completed_at || row.payload.completion_date || row.created_at,
      receivedAt: row.created_at,
      status: row.enrollment_id ? 'matched' : 'client_level',
      enrollmentId: row.enrollment_id,
      offerId: row.offer_id,
      matchMethod: row.enrollment_id ? 'enrollment_link' : null,
      title: courseTitle(row),
      error: null,
    }));
    const recentEvents = [...nativeEvents, ...courseEvents]
      .sort((a, b) => new Date(b.receivedAt || 0).getTime() - new Date(a.receivedAt || 0).getTime())
      .slice(0, 50);

    return {
      id: 'ghl_native',
      name: 'GHL Fulfillment',
      providerKey: 'ghl_native',
      healthStatus,
      needsAttention: healthStatus === 'warning' || unresolved.length > 0,
      statusMessage,
      lastEventAt: latestDate([...activities, ...courseRows]),
      eventCount: activities.length + courseRows.length,
      matchedCount: matched.length + courseRows.filter((row) => row.enrollment_id).length,
      unresolvedCount: unresolved.length + courseRows.filter((row) => !row.enrollment_id).length,
      failedCount: failed.length,
      capabilities,
      recentEvents,
    };
  },
};
