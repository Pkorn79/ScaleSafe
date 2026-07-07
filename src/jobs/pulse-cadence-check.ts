import { getSupabase } from '../clients/supabase.client';
import { ghlApi } from '../clients/ghl.client';
import {
  OFFER_CONTACT_FIELDS,
  WORKFLOW_COMPAT_OFFER_CONTACT_FIELDS,
  WORKFLOW_PULSE_CONTACT_FIELDS,
} from '../constants/ghl-fields';
import { idempotencyRepository } from '../repositories/idempotency.repository';
import { merchantRepository } from '../repositories/merchant.repository';
import { triggerService } from '../services/trigger.service';
import { appEventTypeMatches } from '../utils/app-event-type';
import { logger } from '../utils/logger';
import { buildPulseCheckUrl } from '../utils/pulse-check-link';

const DEFAULT_PULSE_FREQUENCY_DAYS = 30;
const PULSE_TRIGGER_KEY = 'ss_app_event';
const DEDICATED_PULSE_TRIGGER_KEY = 'ss_pulse_check_due';

type PulseDeliveryChannel = 'shared_app_event' | 'dedicated_pulse_trigger';

interface PulseEnrollmentRow {
  id: string;
  location_id: string;
  contact_id?: string | null;
  offer_id?: string | null;
  status?: string | null;
  pulse_cadence_enabled?: boolean | null;
  pulse_frequency_days?: number | null;
  next_pulse_due_at?: string | null;
  last_pulse_sent_at?: string | null;
}

export interface PulseSendResult {
  success: boolean;
  status: 'delivered' | 'not_delivered' | 'skipped';
  message: string;
  triggerKey: string;
  deliveryChannel: PulseDeliveryChannel;
  delivery: { sent: number; failed: number };
  advancedSchedule: boolean;
  pulseUrl?: string;
  dueDateDisplay?: string;
  intervalLabel?: string;
  nextPulseDueAt?: string | null;
  expectedNextStep: string;
  skippedReason?: string;
}

export interface PulseCadenceDiagnosticReport {
  pulseEnabled: boolean;
  formUrlConfigured: boolean;
  activePulseSubscriptions: number;
  activeAppEventSubscriptions: number;
  dueCount: number;
  recentPulseEventDeliveredAt: string | null;
  recentPulseOutboundObservedAt: string | null;
  recentPulseSubmittedAt: string | null;
  recentPulseSentAt: string | null;
  recentPulseNoSubscriptionAt: string | null;
  lastSkippedReason: string | null;
  status: 'ready' | 'needs_setup' | 'no_due_pulses';
  message: string;
}

export async function runPulseCadenceCheck(): Promise<void> {
  const supabase = getSupabase();
  const now = new Date();

  const { data: enrollments, error } = await supabase
    .from('enrollments')
    .select('id, location_id, contact_id, offer_id, status, pulse_frequency_days, next_pulse_due_at')
    .eq('pulse_cadence_enabled', true)
    .lte('next_pulse_due_at', now.toISOString())
    .in('status', ['enrolled', 'active']);

  if (error) {
    logger.error({ err: error.message }, 'Pulse cadence query failed');
    return;
  }
  if (!enrollments || enrollments.length === 0) {
    logger.info('No pulse check-ins due');
    return;
  }

  let sent = 0;
  let skipped = 0;

  for (const enrollment of enrollments) {
    try {
      const result = await sendPulseForEnrollment({
        enrollmentId: enrollment.id,
        locationId: enrollment.location_id,
        advanceSchedule: true,
        useIdempotency: true,
        requireDue: true,
        source: 'scheduled',
        now,
      });
      if (result.success) sent++;
      else skipped++;
    } catch (err: any) {
      skipped++;
      logger.warn({ err: err.message, enrollmentId: enrollment.id }, 'Pulse cadence send failed');
    }
  }

  logger.info({ total: enrollments.length, sent, skipped }, 'Pulse cadence check complete');
}

export async function sendPulseForEnrollment(params: {
  enrollmentId: string;
  locationId?: string;
  advanceSchedule?: boolean;
  useIdempotency?: boolean;
  requireDue?: boolean;
  source?: 'scheduled' | 'manual_test';
  now?: Date;
}): Promise<PulseSendResult> {
  const supabase = getSupabase();
  const now = params.now || new Date();
  const { data: enrollment, error: enrollmentError } = await enrollmentQuery(
    supabase,
    params.enrollmentId,
    params.locationId,
  );
  if (enrollmentError) throw enrollmentError;
  if (!enrollment) {
    return skippedPulseResult('enrollment_not_found', 'Enrollment not found for this location.');
  }

  const status = String(enrollment.status || '').toLowerCase();
  if (!['enrolled', 'active'].includes(status)) {
    return skippedPulseResult('enrollment_not_active', `Pulse not sent because enrollment status is ${status || 'unknown'}.`);
  }
  if (enrollment.pulse_cadence_enabled === false) {
    return skippedPulseResult('pulse_disabled_for_enrollment', 'Pulse cadence is disabled for this enrollment.');
  }
  if (params.requireDue && enrollment.next_pulse_due_at && new Date(enrollment.next_pulse_due_at).getTime() > now.getTime()) {
    return skippedPulseResult('pulse_not_due', 'Pulse check is not due yet.');
  }

  const pulseEventId = [
    'pulse-check',
    enrollment.location_id,
    enrollment.id,
    enrollment.next_pulse_due_at || '',
  ].join(':');
  if (params.useIdempotency && await idempotencyRepository.exists(pulseEventId, 'pulse_check', enrollment.location_id)) {
    logger.info({ locationId: enrollment.location_id, enrollmentId: enrollment.id }, 'Pulse cadence check skipped by idempotency');
    return skippedPulseResult('already_delivered_for_due_date', 'Pulse event was already delivered for this due date.');
  }

  const merchant = await merchantRepository.getByLocationId(enrollment.location_id);
  if (merchant.module_pulse === false) {
    logger.warn({ locationId: enrollment.location_id, enrollmentId: enrollment.id }, 'Pulse due but pulse module is disabled');
    return skippedPulseResult('pulse_module_disabled', 'Pulse module is disabled for this merchant.');
  }

  const { data: offer } = enrollment.offer_id
    ? await supabase
      .from('offers_mirror')
      .select('offer_name, pulse_frequency_days')
      .eq('id', enrollment.offer_id)
      .maybeSingle()
    : { data: null };

  const frequencyDays = normalizeFrequency(enrollment.pulse_frequency_days);
  const nextDue = new Date(now);
  nextDue.setDate(nextDue.getDate() + frequencyDays);
  const dueDateDisplay = formatDateLabel(enrollment.next_pulse_due_at || now.toISOString());
  const deliveredAt = now.toISOString();
  const intervalLabel = formatPulseIntervalLabel(frequencyDays);
  const pulseUrl = buildPulseCheckUrl({
    locationId: enrollment.location_id,
    contactId: enrollment.contact_id,
    enrollmentId: enrollment.id,
  });
  const supportEmail = (merchant as any).support_email || (merchant as any).email || '';
  const businessName = (merchant as any).dba_name || merchant.business_name || '';

  await syncPulseContactFields({
    locationId: enrollment.location_id,
    contactId: enrollment.contact_id,
    offerName: offer?.offer_name || '',
    pulseUrl,
    dueDateDisplay,
    intervalLabel,
    sentAt: deliveredAt,
    supportEmail,
    businessName,
  });
  await repairPulseSubscriptionAliases(enrollment.location_id);

  const [activeAppEventSubscriptions, activeDedicatedPulseSubscriptions] = await Promise.all([
    activeSubscriptionCount(enrollment.location_id, PULSE_TRIGGER_KEY),
    activeSubscriptionCount(enrollment.location_id, DEDICATED_PULSE_TRIGGER_KEY),
  ]);
  const triggerKey = activeAppEventSubscriptions > 0 ? PULSE_TRIGGER_KEY : DEDICATED_PULSE_TRIGGER_KEY;
  const deliveryChannel: PulseDeliveryChannel = activeAppEventSubscriptions > 0 ? 'shared_app_event' : 'dedicated_pulse_trigger';
  const payload = buildPulsePayload({
    enrollment,
    offerName: offer?.offer_name || '',
    pulseUrl,
    frequencyDays,
    intervalLabel,
    dueDateDisplay,
    deliveredAt,
    supportEmail,
    businessName,
    source: params.source || 'manual_test',
    deliveryChannel,
  });

  const triggerResult = await triggerService.fireTrigger(enrollment.location_id, triggerKey, payload);
  const delivered = triggerResult.sent > 0;
  if (!delivered) {
    logger.warn(
      {
        locationId: enrollment.location_id,
        enrollmentId: enrollment.id,
        triggerKey,
        failed: triggerResult.failed,
        activeAppEventSubscriptions,
        activeDedicatedPulseSubscriptions,
      },
      'Pulse trigger had no successful deliveries',
    );
    return {
      success: false,
      status: 'not_delivered',
      message: activeAppEventSubscriptions === 0 && activeDedicatedPulseSubscriptions === 0
        ? 'No active pulse workflow subscription accepted the event.'
        : 'Pulse event was not delivered to any workflow.',
      triggerKey,
      deliveryChannel,
      delivery: triggerResult,
      advancedSchedule: false,
      pulseUrl,
      dueDateDisplay,
      intervalLabel,
      nextPulseDueAt: enrollment.next_pulse_due_at || null,
      expectedNextStep: 'Check that the GHL workflow is subscribed to ScaleSafe App Event and filtered to Event Type = Pulse Check Due.',
    };
  }

  let advancedSchedule = false;
  if (params.advanceSchedule) {
    const { error: updateError } = await supabase
      .from('enrollments')
      .update({
        last_pulse_sent_at: deliveredAt,
        next_pulse_due_at: nextDue.toISOString(),
      })
      .eq('id', enrollment.id);
    if (updateError) throw updateError;
    advancedSchedule = true;
  }

  if (params.useIdempotency) {
    await idempotencyRepository.record(pulseEventId, 'pulse_check', enrollment.location_id, {
      sent: triggerResult.sent,
      failed: triggerResult.failed,
      trigger_key: triggerKey,
      delivery_channel: deliveryChannel,
      next_pulse_due_at: enrollment.next_pulse_due_at,
    });
  }

  return {
    success: true,
    status: 'delivered',
    message: params.advanceSchedule
      ? 'Pulse app event delivered to GHL and schedule advanced.'
      : 'Pulse test event delivered to GHL. Schedule was not advanced.',
    triggerKey,
    deliveryChannel,
    delivery: triggerResult,
    advancedSchedule,
    pulseUrl,
    dueDateDisplay,
    intervalLabel,
    nextPulseDueAt: advancedSchedule ? nextDue.toISOString() : enrollment.next_pulse_due_at || null,
    expectedNextStep: 'Confirm GHL workflow history, outbound email activity, email receipt, and pulse submission evidence.',
  };
}

export async function getPulseCadenceDiagnostics(locationId: string): Promise<PulseCadenceDiagnosticReport> {
  const supabase = getSupabase();
  const now = new Date();
  const merchant = await merchantRepository.getByLocationId(locationId);
  await repairPulseSubscriptionAliases(locationId);

  const [dueRes, pulseSubscriptionRes, appEventSubscriptionRes, logsRes, activityRes, submissionRes] = await Promise.all([
    supabase
      .from('enrollments')
      .select('id')
      .eq('location_id', locationId)
      .eq('pulse_cadence_enabled', true)
      .lte('next_pulse_due_at', now.toISOString())
      .in('status', ['enrolled', 'active']),
    supabase
      .from('trigger_subscriptions')
      .select('id')
      .eq('location_id', locationId)
      .eq('trigger_key', DEDICATED_PULSE_TRIGGER_KEY)
      .eq('is_active', true),
    supabase
      .from('trigger_subscriptions')
      .select('id')
      .eq('location_id', locationId)
      .eq('trigger_key', 'ss_app_event')
      .eq('is_active', true),
    supabase
      .from('trigger_delivery_logs')
      .select('trigger_key, status, payload, created_at')
      .eq('location_id', locationId)
      .in('trigger_key', [PULSE_TRIGGER_KEY, DEDICATED_PULSE_TRIGGER_KEY])
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('ghl_activity_events')
      .select('created_at, occurred_at, source_object, event_type, normalized, raw_payload')
      .eq('location_id', locationId)
      .eq('source_object', 'communication')
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('evidence_pulse_checkins')
      .select('created_at')
      .eq('location_id', locationId)
      .order('created_at', { ascending: false })
      .limit(1),
  ]);

  if (dueRes.error) throw dueRes.error;
  if (pulseSubscriptionRes.error) throw pulseSubscriptionRes.error;
  if (appEventSubscriptionRes.error) throw appEventSubscriptionRes.error;
  if (logsRes.error) throw logsRes.error;
  if (activityRes.error && !isMissingTableError(activityRes.error)) throw activityRes.error;
  if (submissionRes.error) throw submissionRes.error;

  const dueCount = (dueRes.data || []).length;
  const activePulseSubscriptions = (pulseSubscriptionRes.data || []).length;
  const activeAppEventSubscriptions = (appEventSubscriptionRes.data || []).length;
  const pulseLogs = (logsRes.data || []).filter((log: any) => isPulseDeliveryLog(log));
  const recentPulseEventDeliveredAt = pulseLogs.find((log: any) => log.status === 'sent')?.created_at || null;
  const recentPulseOutboundObservedAt = ((activityRes.data || []) as any[])
    .find((row: any) => communicationLooksLikePulse(row))?.created_at || null;
  const recentPulseSubmittedAt = (submissionRes.data || [])[0]?.created_at || null;
  const recentPulseSentAt = recentPulseEventDeliveredAt;
  const recentPulseNoSubscriptionAt = pulseLogs.find((log: any) => log.status === 'no_subscription')?.created_at || null;
  const pulseEnabled = merchant.module_pulse !== false;
  const formUrlConfigured = true;
  const lastSkippedReason = dueCount > 0 && !pulseEnabled
    ? 'pulse_module_disabled'
    : dueCount > 0 && activePulseSubscriptions === 0 && activeAppEventSubscriptions === 0
      ? 'pulse_workflow_subscription_missing'
      : null;
  const status = dueCount === 0
    ? 'no_due_pulses'
    : !pulseEnabled || (activePulseSubscriptions === 0 && activeAppEventSubscriptions === 0)
      ? 'needs_setup'
      : 'ready';
  const message = dueCount === 0
    ? 'No pulse check-ins are currently due.'
    : !pulseEnabled
      ? 'Pulse is disabled for this merchant.'
      : activePulseSubscriptions === 0 && activeAppEventSubscriptions === 0
        ? 'Pulse check-ins are due, but no ScaleSafe App Event workflow is subscribed for Pulse Check Due.'
        : activeAppEventSubscriptions > 0
          ? `${dueCount} pulse check-in(s) are due and ready to deliver through the ScaleSafe App Event trigger.`
          : `${dueCount} pulse check-in(s) are due and ready to deliver through the future dedicated Pulse Check Due trigger.`;

  return {
    pulseEnabled,
    formUrlConfigured,
    activePulseSubscriptions,
    activeAppEventSubscriptions,
    dueCount,
    recentPulseEventDeliveredAt,
    recentPulseOutboundObservedAt,
    recentPulseSubmittedAt,
    recentPulseSentAt,
    recentPulseNoSubscriptionAt,
    lastSkippedReason,
    status,
    message,
  };
}

function normalizeFrequency(days: unknown): number {
  const parsed = Number(days || DEFAULT_PULSE_FREQUENCY_DAYS);
  if (!Number.isFinite(parsed)) return DEFAULT_PULSE_FREQUENCY_DAYS;
  return Math.min(365, Math.max(1, Math.round(parsed)));
}

function formatDateLabel(date: string | null | undefined): string {
  if (!date) return '';
  const parsed = new Date(`${String(date).slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return String(date);
  return parsed.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatPulseIntervalLabel(days: number): string {
  if (days === 1) return 'daily';
  if (days === 7) return 'weekly';
  if (days === 14) return 'every 2 weeks';
  if (days >= 28 && days <= 31) return 'monthly';
  if (days >= 89 && days <= 92) return 'quarterly';
  if (days === 365) return 'yearly';
  return `every ${days} days`;
}

function enrollmentQuery(supabase: any, enrollmentId: string, locationId?: string) {
  let query = supabase
    .from('enrollments')
    .select('id, location_id, contact_id, offer_id, status, pulse_cadence_enabled, pulse_frequency_days, next_pulse_due_at, last_pulse_sent_at')
    .eq('id', enrollmentId);
  if (locationId) query = query.eq('location_id', locationId);
  return query.maybeSingle();
}

function skippedPulseResult(reason: string, message: string): PulseSendResult {
  return {
    success: false,
    status: 'skipped',
    message,
    triggerKey: PULSE_TRIGGER_KEY,
    deliveryChannel: 'shared_app_event',
    delivery: { sent: 0, failed: 0 },
    advancedSchedule: false,
    expectedNextStep: 'Resolve the skipped reason, then run a pulse test again.',
    skippedReason: reason,
  };
}

async function activeSubscriptionCount(locationId: string, triggerKey: string): Promise<number> {
  const { data, error } = await getSupabase()
    .from('trigger_subscriptions')
    .select('id')
    .eq('location_id', locationId)
    .eq('trigger_key', triggerKey)
    .eq('is_active', true);

  if (error) {
    if (isMissingTableError(error)) return 0;
    throw error;
  }
  return (data || []).length;
}

async function repairPulseSubscriptionAliases(locationId: string): Promise<void> {
  try {
    const { error } = await getSupabase()
      .from('trigger_subscriptions')
      .update({ trigger_key: PULSE_TRIGGER_KEY })
      .eq('location_id', locationId)
      .eq('trigger_key', DEDICATED_PULSE_TRIGGER_KEY)
      .eq('is_active', true);

    if (error && !isMissingTableError(error)) throw error;
  } catch (err: any) {
    logger.warn(
      {
        err: err?.message || String(err),
        locationId,
      },
      'Pulse subscription alias repair skipped',
    );
  }
}

function buildPulsePayload(params: {
  enrollment: PulseEnrollmentRow;
  offerName: string;
  pulseUrl: string;
  frequencyDays: number;
  intervalLabel: string;
  dueDateDisplay: string;
  deliveredAt: string;
  supportEmail: string;
  businessName: string;
  source: string;
  deliveryChannel: PulseDeliveryChannel;
}): Record<string, unknown> {
  return {
    event_type: 'pulse_check_due',
    eventType: 'pulse_check_due',
    event_type_key: 'pulse_check_due',
    eventTypeKey: 'pulse_check_due',
    app_event_type: 'pulse_check_due',
    appEventType: 'pulse_check_due',
    event_type_display: 'Pulse Check Due',
    eventTypeDisplay: 'Pulse Check Due',
    location_id: params.enrollment.location_id,
    locationId: params.enrollment.location_id,
    contact_id: params.enrollment.contact_id,
    contactId: params.enrollment.contact_id,
    enrollment_id: params.enrollment.id,
    enrollmentId: params.enrollment.id,
    offer_id: params.enrollment.offer_id,
    offerId: params.enrollment.offer_id,
    offer_name: params.offerName,
    offerName: params.offerName,
    program_name: params.offerName,
    programName: params.offerName,
    form_url: params.pulseUrl,
    formUrl: params.pulseUrl,
    pulse_check_url: params.pulseUrl,
    pulseCheckUrl: params.pulseUrl,
    pulse_url: params.pulseUrl,
    pulseUrl: params.pulseUrl,
    pulse_link: params.pulseUrl,
    pulseLink: params.pulseUrl,
    pulse_check_link: params.pulseUrl,
    pulseCheckLink: params.pulseUrl,
    checkin_url: params.pulseUrl,
    checkinUrl: params.pulseUrl,
    check_in_url: params.pulseUrl,
    checkInUrl: params.pulseUrl,
    check_in_link: params.pulseUrl,
    checkInLink: params.pulseUrl,
    action_url: params.pulseUrl,
    actionUrl: params.pulseUrl,
    link: params.pulseUrl,
    url: params.pulseUrl,
    pulse_frequency_days: params.frequencyDays,
    pulseFrequencyDays: params.frequencyDays,
    pulse_interval_label: params.intervalLabel,
    pulseIntervalLabel: params.intervalLabel,
    pulse_due_at: params.enrollment.next_pulse_due_at,
    pulseDueAt: params.enrollment.next_pulse_due_at,
    pulse_due_date_display: params.dueDateDisplay,
    pulseDueDateDisplay: params.dueDateDisplay,
    due_date_display: params.dueDateDisplay,
    dueDateDisplay: params.dueDateDisplay,
    sent_at: params.deliveredAt,
    sentAt: params.deliveredAt,
    event_delivered_at: params.deliveredAt,
    eventDeliveredAt: params.deliveredAt,
    support_email: params.supportEmail,
    supportEmail: params.supportEmail,
    merchant_support_email: params.supportEmail,
    merchantSupportEmail: params.supportEmail,
    business_name: params.businessName,
    businessName: params.businessName,
    merchant_business_name: params.businessName,
    merchantBusinessName: params.businessName,
    delivery_channel: params.deliveryChannel,
    deliveryChannel: params.deliveryChannel,
    source: params.source,
    manual_test: params.source === 'manual_test',
    manualTest: params.source === 'manual_test',
    offer: {
      name: params.offerName,
      pulse_check_url: params.pulseUrl,
      pulse_interval_label: params.intervalLabel,
    },
    merchant: {
      business_name: params.businessName,
      support_email: params.supportEmail,
    },
    pulse: {
      check_url: params.pulseUrl,
      due_at: params.enrollment.next_pulse_due_at,
      due_date_display: params.dueDateDisplay,
      interval_label: params.intervalLabel,
      frequency_days: params.frequencyDays,
    },
  };
}

function isPulseDeliveryLog(log: any): boolean {
  if (log?.trigger_key === DEDICATED_PULSE_TRIGGER_KEY) return true;
  return log?.trigger_key === PULSE_TRIGGER_KEY && appEventTypeMatches(log.payload, 'pulse_check_due');
}

function communicationLooksLikePulse(row: any): boolean {
  const raw = row?.raw_payload || {};
  const normalized = row?.normalized || {};
  const text = [
    normalized.title,
    normalized.subject,
    normalized.body,
    normalized.body_preview,
    normalized.message_preview,
    raw.subject,
    raw.body,
    raw.message,
    raw.text,
    raw.email?.subject,
    raw.email?.body,
  ].filter(Boolean).join(' ').toLowerCase();
  return text.includes('pulse') || text.includes('quick check in') || text.includes('checking in on your progress');
}

function isMissingTableError(error: any): boolean {
  return error?.code === '42P01'
    || error?.code === 'PGRST205'
    || String(error?.message || '').toLowerCase().includes('schema cache');
}

async function syncPulseContactFields(params: {
  locationId: string;
  contactId?: string | null;
  offerName: string;
  pulseUrl: string;
  dueDateDisplay: string;
  intervalLabel: string;
  sentAt: string;
  supportEmail: string;
  businessName: string;
}): Promise<void> {
  if (!params.locationId || !params.contactId) return;

  const customField: Record<string, unknown> = {
    [OFFER_CONTACT_FIELDS.BUSINESS_NAME]: params.businessName,
    [OFFER_CONTACT_FIELDS.OFFER_NAME]: params.offerName,
    [WORKFLOW_COMPAT_OFFER_CONTACT_FIELDS.PROGRAM_NAME]: params.offerName,
    [WORKFLOW_COMPAT_OFFER_CONTACT_FIELDS.SUPPORT_EMAIL]: params.supportEmail,
    [WORKFLOW_PULSE_CONTACT_FIELDS.CHECK_URL]: params.pulseUrl,
    [WORKFLOW_PULSE_CONTACT_FIELDS.DUE_DATE]: params.dueDateDisplay,
    [WORKFLOW_PULSE_CONTACT_FIELDS.INTERVAL_LABEL]: params.intervalLabel,
    [WORKFLOW_PULSE_CONTACT_FIELDS.LAST_SENT_AT]: params.sentAt,
  };

  try {
    const api = await ghlApi(params.locationId);
    await api.put(`/contacts/${params.contactId}`, { customField });
  } catch (err: any) {
    logger.warn(
      {
        err: err?.message || String(err),
        locationId: params.locationId,
        contactId: params.contactId,
      },
      'Failed to sync pulse contact fields; continuing with trigger delivery',
    );
  }
}
