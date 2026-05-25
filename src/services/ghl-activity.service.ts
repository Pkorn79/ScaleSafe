import { getSupabase } from '../clients/supabase.client';
import { ghlApi } from '../clients/ghl.client';
import { ActivityMatchRule, ghlActivityRepository } from '../repositories/ghlActivity.repository';
import { offerRepository } from '../repositories/offer.repository';
import { evidenceService } from './evidence.service';
import { EVIDENCE_TYPES } from '../constants/evidence-types';
import { buildDefenseEvidenceFields } from '../utils/defense-evidence';
import { logger } from '../utils/logger';

type SourceObject = 'appointment' | 'invoice' | 'communication' | 'note' | 'task' | 'form' | 'opportunity' | 'unknown';

interface NormalizedGhlActivity {
  locationId: string;
  contactId: string;
  contactEmail: string;
  eventType: string;
  sourceObject: SourceObject;
  sourceRecordId: string;
  sourceParentId: string;
  occurredAt: string;
  title: string;
  status: string;
  calendarId: string;
  assignedUserId: string;
  startTime: string;
  endTime: string;
  amount: number | null;
  amountPaid: number | null;
  currency: string;
  invoiceNumber: string;
  invoiceDueDate: string;
  lineItems: unknown[];
  direction: string;
  channel: string;
  body: string;
  sourceRefs: Record<string, string[]>;
  raw: Record<string, unknown>;
}

function stringValue(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return '';
}

function numberValue(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function pushRef(refs: Record<string, string[]>, key: string, value: unknown): void {
  const v = stringValue(value);
  if (!v) return;
  refs[key] = refs[key] || [];
  if (!refs[key].includes(v)) refs[key].push(v);
}

function collectSourceRefs(body: Record<string, any>, primary: Record<string, any>): Record<string, string[]> {
  const refs: Record<string, string[]> = {};
  pushRef(refs, 'calendar_id', primary.calendarId || primary.calendar_id || body.calendarId || body.calendar_id);
  pushRef(refs, 'product_id', body.productId || body.product_id || primary.productId || primary.product_id);
  pushRef(refs, 'price_id', body.priceId || body.price_id || primary.priceId || primary.price_id);
  pushRef(refs, 'invoice_id', body.invoiceId || body.invoice_id || body._id || primary.invoiceId || primary.invoice_id || primary._id);
  pushRef(refs, 'opportunity_pipeline_id', body.pipelineId || body.pipeline_id || primary.pipelineId || primary.pipeline_id);
  pushRef(refs, 'opportunity_stage_id', body.pipelineStageId || body.pipeline_stage_id || body.stageId || body.stage_id || primary.pipelineStageId || primary.stageId);

  const items = [
    ...arrayValue(body.items),
    ...arrayValue(body.lineItems || body.line_items || body.invoiceItems),
    ...arrayValue(primary.items),
    ...arrayValue(primary.lineItems || primary.line_items || primary.invoiceItems),
  ];

  for (const item of items as any[]) {
    if (!item || typeof item !== 'object') continue;
    pushRef(refs, 'product_id', item.productId || item.product_id || item.product?.id || item.product?._id);
    pushRef(refs, 'price_id', item.priceId || item.price_id || item.price?.id || item.price?._id);
    pushRef(refs, 'invoice_item_name', item.name || item.title || item.description);
  }

  return refs;
}

function eventBody(payload: Record<string, unknown>): Record<string, any> {
  const candidates = [
    payload.event_body,
    payload.eventBody,
    payload.data,
    payload.payload,
    payload.body,
  ];

  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      return candidate as Record<string, any>;
    }
  }

  return payload;
}

function classify(eventType: string, body: Record<string, any>): SourceObject {
  const text = `${eventType} ${body.type || ''} ${body.eventType || ''}`.toLowerCase();
  if (text.includes('appointment') || text.includes('calendar')) return 'appointment';
  if (text.includes('invoice') || body.invoiceId || body.invoice_id || body.invoiceNumber || body._id || body.invoiceItems) return 'invoice';
  if (text.includes('message') || text.includes('conversation') || body.messageId || body.conversationId) return 'communication';
  if (text.includes('note')) return 'note';
  if (text.includes('task')) return 'task';
  if (text.includes('form')) return 'form';
  if (text.includes('opportunity')) return 'opportunity';
  return 'unknown';
}

function inferEventType(body: Record<string, any>): string {
  const explicit = stringValue(body.type, body.event_type, body.eventType);
  if (explicit) return explicit;

  if (body.invoiceNumber || body.invoiceItems || body.amountDue !== undefined || body.amountPaid !== undefined) {
    const status = String(body.status || '').toLowerCase();
    if (status.includes('partial')) return 'InvoicePartiallyPaid';
    if (status.includes('paid')) return 'InvoicePaid';
    if (status.includes('void')) return 'InvoiceVoid';
    if (status.includes('delete')) return 'InvoiceDelete';
    if (status.includes('sent')) return 'InvoiceSent';
    if (status.includes('draft') || status.includes('created')) return 'InvoiceCreate';
    return 'InvoiceUpdate';
  }

  return '';
}

function normalizeDirection(value: string): 'inbound' | 'outbound' {
  const v = String(value || '').toLowerCase();
  if (v.includes('inbound') || v === '1' || v === 'incoming') return 'inbound';
  return 'outbound';
}

function normalizeChannel(value: string): 'email' | 'sms' | 'call' | 'voicemail' | 'chat' | 'other' {
  const v = String(value || '').toLowerCase();
  if (v.includes('email')) return 'email';
  if (v.includes('sms') || v.includes('text')) return 'sms';
  if (v.includes('call')) return 'call';
  if (v.includes('voicemail')) return 'voicemail';
  if (v.includes('chat') || v.includes('message')) return 'chat';
  return 'other';
}

function normalizeAppointmentStatus(eventType: string, rawStatus: string): string {
  const text = `${eventType} ${rawStatus}`.toLowerCase();
  if (text.includes('no_show') || text.includes('noshow') || text.includes('no-show')) return 'no_show';
  if (text.includes('cancel')) return 'cancelled';
  if (text.includes('reschedule')) return 'rescheduled';
  if (text.includes('complete') || text.includes('showed') || text.includes('attended')) return 'completed';
  if (text.includes('delete')) return 'deleted';
  if (text.includes('update')) return rawStatus || 'updated';
  return rawStatus || 'scheduled';
}

function normalizePayload(payload: Record<string, unknown>): NormalizedGhlActivity {
  const body = eventBody(payload);
  const nestedAppointment = (body.appointment || body.calendarEvent || body.event || {}) as Record<string, any>;
  const nestedInvoice = (body.invoice || {}) as Record<string, any>;
  const nestedMessage = (body.message || {}) as Record<string, any>;
  const primary = Object.keys(nestedAppointment).length ? nestedAppointment
    : Object.keys(nestedInvoice).length ? nestedInvoice
      : Object.keys(nestedMessage).length ? nestedMessage
        : body;

  const eventType = stringValue(payload.type, payload.event_type, payload.eventType, inferEventType(body));
  const sourceObject = classify(eventType, body);

  const sourceRecordId = stringValue(
    payload.id,
    payload._id,
    payload.event_id,
    body._id,
    body.id,
    body.appointmentId,
    body.appointment_id,
    body.calendarEventId,
    body.invoiceId,
    body.invoice_id,
    body.messageId,
    body.message_id,
    body.emailMessageId,
    primary.id,
    primary._id,
  );
  const sourceRefs = collectSourceRefs(body, primary);

  return {
    locationId: stringValue(payload.locationId, payload.location_id, body.locationId, body.location_id, body.location?.id),
    contactId: stringValue(payload.contactId, payload.contact_id, body.contactId, body.contact_id, body.contact?.id, body.contactDetails?.id, primary.contactId, primary.contact_id, primary.contactDetails?.id),
    contactEmail: stringValue(payload.contactEmail, payload.contact_email, body.contactEmail, body.contact_email, body.email, body.contact?.email, body.contactDetails?.email, primary.email, primary.contactDetails?.email),
    eventType: eventType || 'unknown',
    sourceObject,
    sourceRecordId,
    sourceParentId: stringValue(body.conversationId, body.conversation_id, body.orderId, body.order_id, body.parentId, body.parent_id, body.threadId, body.emailMessageId),
    occurredAt: stringValue(payload.timestamp, payload.createdAt, payload.created_at, body.timestamp, body.dateAdded, body.createdAt, body.created_at, body.updatedAt, body.issueDate, primary.startTime, primary.start_time) || new Date().toISOString(),
    title: stringValue(primary.title, primary.name, primary.appointmentTitle, primary.appointment_title, body.title, body.name, nestedInvoice.title, nestedMessage.subject),
    status: stringValue(primary.status, body.status, primary.appointmentStatus, body.appointmentStatus, body.invoiceStatus, body.invoice_status),
    calendarId: stringValue(primary.calendarId, primary.calendar_id, body.calendarId, body.calendar_id),
    assignedUserId: stringValue(primary.assignedUserId, primary.assigned_user_id, primary.userId, body.assignedUserId, body.userId),
    startTime: stringValue(primary.startTime, primary.start_time, primary.startDate, primary.start_date, body.startTime, body.start_time),
    endTime: stringValue(primary.endTime, primary.end_time, primary.endDate, primary.end_date, body.endTime, body.end_time),
    amount: numberValue(primary.amount, primary.total, primary.amountDue, body.amount, body.total, body.amountDue, nestedInvoice.amount, nestedInvoice.total),
    amountPaid: numberValue(primary.amountPaid, primary.amount_paid, body.amountPaid, body.amount_paid, nestedInvoice.amountPaid, nestedInvoice.amount_paid),
    currency: stringValue(primary.currency, body.currency, nestedInvoice.currency) || 'USD',
    invoiceNumber: stringValue(primary.invoiceNumber, primary.invoice_number, body.invoiceNumber, body.invoice_number),
    invoiceDueDate: stringValue(primary.dueDate, primary.due_date, body.dueDate, body.due_date),
    lineItems: arrayValue(primary.lineItems || primary.line_items || primary.invoiceItems || body.lineItems || body.line_items || body.invoiceItems),
    direction: stringValue(body.direction, primary.direction, nestedMessage.direction),
    channel: stringValue(body.messageType, body.message_type, body.channel, primary.type, primary.messageType, nestedMessage.type),
    body: stringValue(body.plainText, body.body, body.text, body.message, primary.plainText, primary.body, primary.text, nestedMessage.body, nestedMessage.text),
    sourceRefs,
    raw: payload,
  };
}

function ruleMatchesActivity(rule: ActivityMatchRule, activity: NormalizedGhlActivity): boolean {
  if (!rule.is_active) return false;
  const values = activity.sourceRefs[rule.source_key] || [];
  if (!values.includes(rule.source_value)) return false;
  const titleLower = activity.title.toLowerCase();
  if (rule.staff_user_id && rule.staff_user_id !== activity.assignedUserId) return false;
  if (rule.title_keyword && !titleLower.includes(rule.title_keyword.toLowerCase())) return false;
  return true;
}

async function findEnrollmentForOffer(activity: NormalizedGhlActivity, offerId: string): Promise<any | null> {
  const { data } = await getSupabase()
    .from('enrollments')
    .select('*')
    .eq('location_id', activity.locationId)
    .eq('contact_id', activity.contactId)
    .eq('offer_id', offerId)
    .in('status', ['paid_pending_enrollment', 'consent_captured', 'enrolled', 'active', 'at_risk', 'completed'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data || null;
}

async function findMappedEnrollment(activity: NormalizedGhlActivity): Promise<{ enrollment: any | null; offerId: string | null; reason: string; confidence: string; linkedEnrollmentIds: string[]; linkedOfferIds: string[] }> {
  const supabase = getSupabase();
  const explicitEnrollmentId = stringValue(
    (activity.raw as any).enrollment_id,
    (activity.raw as any).enrollmentId,
    (eventBody(activity.raw) as any).enrollment_id,
    (eventBody(activity.raw) as any).enrollmentId,
    (eventBody(activity.raw) as any).metadata?.enrollment_id,
    (eventBody(activity.raw) as any).metadata?.enrollmentId,
  );

  if (explicitEnrollmentId) {
    const { data } = await supabase
      .from('enrollments')
      .select('*')
      .eq('location_id', activity.locationId)
      .eq('id', explicitEnrollmentId)
      .maybeSingle();
    if (data) return { enrollment: data, offerId: data.offer_id || null, reason: 'explicit_enrollment_id', confidence: 'strong', linkedEnrollmentIds: [data.id], linkedOfferIds: data.offer_id ? [data.offer_id] : [] };
  }

  if (!activity.contactId) return { enrollment: null, offerId: null, reason: 'missing_contact_id', confidence: 'none', linkedEnrollmentIds: [], linkedOfferIds: [] };

  const rules = await ghlActivityRepository.listMatchRules(activity.locationId);
  const rule = rules.find((candidate) => ruleMatchesActivity(candidate, activity) && candidate.offer_id);
  if (rule?.offer_id) {
    const enrollment = await findEnrollmentForOffer(activity, rule.offer_id);
    if (enrollment) {
      return {
        enrollment,
        offerId: rule.offer_id,
        reason: `${rule.rule_type}_${rule.source_key}_rule`,
        confidence: 'strong',
        linkedEnrollmentIds: [enrollment.id],
        linkedOfferIds: [rule.offer_id],
      };
    }
    return {
      enrollment: null,
      offerId: rule.offer_id,
      reason: `${rule.rule_type}_${rule.source_key}_rule_no_enrollment`,
      confidence: 'client_offer',
      linkedEnrollmentIds: [],
      linkedOfferIds: [rule.offer_id],
    };
  }

  if (activity.sourceObject === 'appointment' && activity.calendarId) {
    const mappings = await ghlActivityRepository.listAppointmentMappings(activity.locationId);
    const titleLower = activity.title.toLowerCase();
    const mapping = mappings.find((m) => {
      if (!m.is_active || m.calendar_id !== activity.calendarId || !m.offer_id) return false;
      if (m.staff_user_id && m.staff_user_id !== activity.assignedUserId) return false;
      if (m.title_keyword && !titleLower.includes(m.title_keyword.toLowerCase())) return false;
      return true;
    });

    if (mapping?.offer_id) {
      const { data } = await supabase
        .from('enrollments')
        .select('*')
        .eq('location_id', activity.locationId)
        .eq('contact_id', activity.contactId)
        .eq('offer_id', mapping.offer_id)
        .in('status', ['enrolled', 'active', 'at_risk', 'completed'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) return { enrollment: data, offerId: mapping.offer_id, reason: 'legacy_calendar_offer_mapping', confidence: 'strong', linkedEnrollmentIds: [data.id], linkedOfferIds: [mapping.offer_id] };
      return { enrollment: null, offerId: mapping.offer_id, reason: 'legacy_calendar_mapping_no_enrollment', confidence: 'client_offer', linkedEnrollmentIds: [], linkedOfferIds: [mapping.offer_id] };
    }
  }

  return { enrollment: null, offerId: null, reason: 'client_level_unmatched_to_enrollment', confidence: 'client', linkedEnrollmentIds: [], linkedOfferIds: [] };
}

function appointmentSummary(activity: NormalizedGhlActivity, offerName?: string): string {
  const status = normalizeAppointmentStatus(activity.eventType, activity.status);
  const title = activity.title || 'appointment';
  const when = activity.startTime || activity.occurredAt;
  const program = offerName ? ` for ${offerName}` : '';
  if (status === 'completed') return `GHL appointment "${title}" was completed${program} on ${when}.`;
  if (status === 'no_show') return `Client no-show was recorded for GHL appointment "${title}"${program} on ${when}.`;
  if (status === 'cancelled') return `GHL appointment "${title}" was cancelled${program} for ${when}.`;
  if (status === 'rescheduled') return `GHL appointment "${title}" was rescheduled${program}; scheduled time ${when}.`;
  return `GHL appointment "${title}" was ${status}${program}; scheduled time ${when}.`;
}

function invoiceSummary(activity: NormalizedGhlActivity, offerName?: string): string {
  const amount = activity.amount != null ? `$${activity.amount.toFixed(2)} ${activity.currency}` : 'amount not provided';
  const program = offerName ? ` for ${offerName}` : '';
  const invoice = activity.invoiceNumber || activity.sourceRecordId || 'unknown invoice';
  const status = activity.status || activity.eventType;
  return `GHL invoice ${invoice}${program} recorded as ${status}. Amount: ${amount}.`;
}

export const ghlActivityService = {
  normalizePayload,

  async handleWebhook(payload: Record<string, unknown>): Promise<{ status: string; eventType: string; sourceObject: string; actionTaken: string }> {
    const activity = normalizePayload(payload);
    if (!activity.locationId || !activity.eventType) {
      throw new Error('GHL activity webhook missing locationId or event type');
    }

    const match = await findMappedEnrollment(activity);
    const normalized = {
      ...activity,
      raw: undefined,
      matchReason: match.reason,
    } as Record<string, unknown>;

    const { row, inserted } = await ghlActivityRepository.createEventIfNew({
      location_id: activity.locationId,
      contact_id: activity.contactId || null,
      contact_email: activity.contactEmail || null,
      source_contact_id: activity.contactId || null,
      enrollment_id: match.enrollment?.id || null,
      offer_id: match.offerId || null,
      linked_enrollment_ids: match.linkedEnrollmentIds,
      linked_offer_ids: match.linkedOfferIds,
      match_confidence: match.confidence,
      source_object: activity.sourceObject,
      event_type: activity.eventType,
      source_record_id: activity.sourceRecordId || null,
      source_parent_id: activity.sourceParentId || null,
      occurred_at: activity.occurredAt,
      status: match.enrollment ? 'matched' : activity.contactId ? 'client_level' : 'unmatched',
      match_reason: match.reason,
      action_taken: 'logged_activity',
      normalized,
      raw_payload: payload,
    });

    if (!inserted) return { status: 'duplicate', eventType: activity.eventType, sourceObject: activity.sourceObject, actionTaken: row.action_taken || 'duplicate' };

    let actionTaken = 'logged_activity';
    try {
      if (match.enrollment?.id) {
        await ghlActivityRepository.linkActivityToEnrollment({
          locationId: activity.locationId,
          activityEventId: row.id,
          enrollmentId: match.enrollment.id,
          offerId: match.offerId,
          reason: match.reason,
        });
      }

      if (activity.sourceObject === 'appointment' && activity.contactId) {
        const offer = match.offerId ? await offerRepository.findById(match.offerId, activity.locationId).catch(() => null) : null;
        const status = normalizeAppointmentStatus(activity.eventType, activity.status);
        const summary = appointmentSummary(activity, offer?.offer_name);

        await evidenceService.logEvidence(EVIDENCE_TYPES.APPOINTMENT, activity.locationId, activity.contactId, 'ghl_calendar', {
          enrollment_id: match.enrollment?.id || null,
          offer_id: match.offerId,
          appointment_id: activity.sourceRecordId,
          calendar_id: activity.calendarId,
          appointment_title: activity.title || 'GHL appointment',
          appointment_status: status,
          appointment_event_type: activity.eventType,
          start_time: activity.startTime || null,
          end_time: activity.endTime || null,
          assigned_user_id: activity.assignedUserId || null,
          delivery_role: row.normalized?.deliveryRole || null,
          notes: activity.body || null,
          description: summary,
          raw_payload: payload,
          ...buildDefenseEvidenceFields({
            summary,
            title: `GHL Appointment: ${activity.title || status}`,
            proofRole: status === 'completed' ? 'service_delivery' : 'client_engagement',
            relevance: { tags: ['services_not_provided', 'not_as_described', 'fraud'], priority: status === 'completed' ? 'high' : 'medium', confidence: 'moderate' },
            enrollmentId: match.enrollment?.id || null,
            sourceRecordId: activity.sourceRecordId || null,
            metadata: {
              actor: status === 'no_show' ? 'client' : 'merchant',
              service: { enrollmentId: match.enrollment?.id || null, offerId: match.offerId, serviceDate: activity.startTime || activity.occurredAt, deliverableName: activity.title || 'GHL appointment' },
              source: { system: 'ghl_calendar', recordId: activity.sourceRecordId || null, rawEventType: activity.eventType },
            },
          }),
        });
        actionTaken = 'appointment_evidence_created';
      } else if (activity.sourceObject === 'invoice' && activity.contactId) {
        const offer = match.offerId ? await offerRepository.findById(match.offerId, activity.locationId).catch(() => null) : null;
        const summary = invoiceSummary(activity, offer?.offer_name);
        const isPaid = activity.eventType.toLowerCase().includes('paid') || String(activity.status).toLowerCase().includes('paid');

        await evidenceService.logEvidence(EVIDENCE_TYPES.INVOICE, activity.locationId, activity.contactId, 'ghl_invoice', {
          enrollment_id: match.enrollment?.id || null,
          offer_id: match.offerId,
          invoice_id: activity.sourceRecordId,
          invoice_number: activity.invoiceNumber || null,
          invoice_status: activity.status || null,
          invoice_event_type: activity.eventType,
          amount: activity.amount,
          amount_paid: activity.amountPaid,
          currency: activity.currency,
          due_date: activity.invoiceDueDate || null,
          sent_at: activity.eventType.toLowerCase().includes('sent') ? activity.occurredAt : null,
          paid_at: isPaid ? activity.occurredAt : null,
          voided_at: activity.eventType.toLowerCase().includes('void') ? activity.occurredAt : null,
          line_items: activity.lineItems,
          description: summary,
          raw_payload: payload,
          ...buildDefenseEvidenceFields({
            summary,
            title: `GHL Invoice: ${activity.invoiceNumber || activity.sourceRecordId || activity.status || activity.eventType}`,
            proofRole: isPaid ? 'payment_history' : 'policy_disclosure',
            relevance: { tags: ['credit_not_processed', 'services_not_provided', 'not_as_described', 'fraud'], priority: isPaid ? 'high' : 'medium', confidence: 'moderate' },
            enrollmentId: match.enrollment?.id || null,
            sourceRecordId: activity.sourceRecordId || null,
            metadata: {
              actor: isPaid ? 'processor' : 'merchant',
              transaction: { amount: activity.amount, currency: activity.currency },
              source: { system: 'ghl_invoice', recordId: activity.sourceRecordId || null, rawEventType: activity.eventType },
            },
          }),
        });
        actionTaken = 'invoice_evidence_created';
      } else if (activity.sourceObject === 'communication' && activity.contactId) {
        await evidenceService.logEvidence(EVIDENCE_TYPES.COMMUNICATION, activity.locationId, activity.contactId, 'ghl_webhook', {
          comm_type: normalizeChannel(activity.channel),
          direction: normalizeDirection(activity.direction),
          comm_date: activity.occurredAt,
          subject: activity.title || null,
          summary: activity.body.slice(0, 500),
          body_preview: activity.body.slice(0, 200),
          ghl_conversation_id: activity.sourceParentId || null,
          ghl_message_id: activity.sourceRecordId || null,
          enrollment_id: match.enrollment?.id || null,
          raw_payload: payload,
          ...buildDefenseEvidenceFields({
            summary: `${normalizeDirection(activity.direction) === 'inbound' ? 'Client' : 'Merchant'} ${normalizeChannel(activity.channel)} message recorded.${activity.body ? ` Excerpt: ${activity.body.slice(0, 180)}` : ''}`,
            title: `${normalizeDirection(activity.direction) === 'inbound' ? 'Client' : 'Merchant'} Communication`,
            proofRole: 'communication',
            relevance: { tags: ['services_not_provided', 'not_as_described', 'credit_not_processed', 'cancelled_recurring', 'fraud'], priority: normalizeDirection(activity.direction) === 'inbound' ? 'high' : 'medium', confidence: 'moderate' },
            enrollmentId: match.enrollment?.id || null,
            sourceRecordId: activity.sourceRecordId || null,
            metadata: {
              actor: normalizeDirection(activity.direction) === 'inbound' ? 'client' : 'merchant',
              communication: { channel: normalizeChannel(activity.channel), direction: normalizeDirection(activity.direction), excerpt: activity.body.slice(0, 300) },
              source: { system: 'ghl_webhook', recordId: activity.sourceRecordId || null, rawEventType: activity.eventType },
            },
          }),
        });
        actionTaken = 'communication_evidence_created';
      }
    } catch (err: any) {
      await getSupabase()
        .from('ghl_activity_events')
        .update({ status: 'failed', error_message: err.message, action_taken: actionTaken, updated_at: new Date().toISOString() })
        .eq('id', row.id);
      throw err;
    }

    await getSupabase()
      .from('ghl_activity_events')
      .update({ action_taken: actionTaken, updated_at: new Date().toISOString() })
      .eq('id', row.id);

    return { status: match.enrollment ? 'matched' : activity.contactId ? 'client_level' : 'unmatched', eventType: activity.eventType, sourceObject: activity.sourceObject, actionTaken };
  },

  async getSetup(locationId: string) {
    const [mappings, rules, offers, unmatched, calendars] = await Promise.all([
      ghlActivityRepository.listAppointmentMappings(locationId),
      ghlActivityRepository.listMatchRules(locationId),
      offerRepository.listByLocation(locationId),
      ghlActivityRepository.listUnmatched(locationId, 25),
      this.listCalendars(locationId),
    ]);

    return {
      mappings,
      rules,
      offers: offers.map((offer) => ({ id: offer.id, name: offer.offer_name, active: offer.active })),
      calendars,
      unmatched,
    };
  },

  async listCalendars(locationId: string): Promise<Array<{ id: string; name: string }>> {
    try {
      const api = await ghlApi(locationId);
      const res = await api.get('/calendars/', { params: { locationId } });
      const calendars = res.data?.calendars || res.data?.items || (Array.isArray(res.data) ? res.data : []);
      return (calendars || [])
        .map((calendar: any) => ({
          id: String(calendar.id || calendar.calendarId || ''),
          name: String(calendar.name || calendar.title || calendar.id || 'Calendar'),
        }))
        .filter((calendar: { id: string }) => calendar.id);
    } catch (err: any) {
      logger.warn({ err: err.message, locationId }, 'Failed to list GHL calendars for activity setup');
      return [];
    }
  },

  async saveAppointmentMapping(locationId: string, payload: Record<string, unknown>) {
    const calendarId = stringValue(payload.calendar_id, payload.calendarId);
    if (!calendarId) throw new Error('calendar_id required');
    return ghlActivityRepository.upsertAppointmentMapping(locationId, {
      id: stringValue(payload.id) || undefined,
      calendar_id: calendarId,
      offer_id: stringValue(payload.offer_id, payload.offerId) || null,
      staff_user_id: stringValue(payload.staff_user_id, payload.staffUserId) || null,
      title_keyword: stringValue(payload.title_keyword, payload.titleKeyword) || null,
      appointment_type: stringValue(payload.appointment_type, payload.appointmentType) || null,
      delivery_role: stringValue(payload.delivery_role, payload.deliveryRole) || null,
      is_active: payload.is_active === undefined ? true : payload.is_active === true,
    });
  },

  async saveMatchRule(locationId: string, payload: Record<string, unknown>) {
    const ruleType = stringValue(payload.rule_type, payload.ruleType);
    const sourceKey = stringValue(payload.source_key, payload.sourceKey);
    const sourceValue = stringValue(payload.source_value, payload.sourceValue);
    if (!ruleType || !sourceKey || !sourceValue) throw new Error('rule_type, source_key, and source_value required');
    return ghlActivityRepository.upsertMatchRule(locationId, {
      id: stringValue(payload.id) || undefined,
      rule_type: ruleType,
      source_key: sourceKey,
      source_value: sourceValue,
      offer_id: stringValue(payload.offer_id, payload.offerId) || null,
      staff_user_id: stringValue(payload.staff_user_id, payload.staffUserId) || null,
      title_keyword: stringValue(payload.title_keyword, payload.titleKeyword) || null,
      pipeline_id: stringValue(payload.pipeline_id, payload.pipelineId) || null,
      pipeline_stage_id: stringValue(payload.pipeline_stage_id, payload.pipelineStageId) || null,
      label: stringValue(payload.label) || null,
      is_active: payload.is_active === undefined ? true : payload.is_active === true,
    });
  },

  async deactivateMatchRule(locationId: string, id: string) {
    await ghlActivityRepository.deactivateMatchRule(locationId, id);
  },

  async deactivateAppointmentMapping(locationId: string, id: string) {
    await ghlActivityRepository.deactivateAppointmentMapping(locationId, id);
  },
};
