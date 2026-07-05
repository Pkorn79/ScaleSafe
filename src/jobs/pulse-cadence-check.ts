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

export interface PulseCadenceDiagnosticReport {
  pulseEnabled: boolean;
  formUrlConfigured: boolean;
  activeAppEventSubscriptions: number;
  dueCount: number;
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
      const pulseEventId = [
        'pulse-check',
        enrollment.location_id,
        enrollment.id,
        enrollment.next_pulse_due_at || '',
      ].join(':');
      if (await idempotencyRepository.exists(pulseEventId, 'pulse_check', enrollment.location_id)) {
        skipped++;
        logger.info({ locationId: enrollment.location_id, enrollmentId: enrollment.id }, 'Pulse cadence check skipped by idempotency');
        continue;
      }

      const merchant = await merchantRepository.getByLocationId(enrollment.location_id);
      if (merchant.module_pulse === false) {
        skipped++;
        logger.warn({ locationId: enrollment.location_id, enrollmentId: enrollment.id }, 'Pulse due but pulse module is disabled');
        continue;
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
      const dueDateDisplay = formatDateLabel(enrollment.next_pulse_due_at);
      const sentAt = now.toISOString();
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
        sentAt,
        supportEmail,
        businessName,
      });

      const triggerResult = await triggerService.fireTrigger(enrollment.location_id, 'ss_app_event', {
        event_type: 'Pulse Check Due',
        eventType: 'pulse_check_due',
        event_type_key: 'pulse_check_due',
        eventTypeKey: 'pulse_check_due',
        app_event_type: 'pulse_check_due',
        appEventType: 'pulse_check_due',
        event_type_display: 'Pulse Check Due',
        eventTypeDisplay: 'Pulse Check Due',
        location_id: enrollment.location_id,
        locationId: enrollment.location_id,
        contact_id: enrollment.contact_id,
        contactId: enrollment.contact_id,
        enrollment_id: enrollment.id,
        enrollmentId: enrollment.id,
        offer_id: enrollment.offer_id,
        offerId: enrollment.offer_id,
        offer_name: offer?.offer_name || '',
        offerName: offer?.offer_name || '',
        form_url: pulseUrl,
        formUrl: pulseUrl,
        pulse_check_url: pulseUrl,
        pulseCheckUrl: pulseUrl,
        checkin_url: pulseUrl,
        checkinUrl: pulseUrl,
        action_url: pulseUrl,
        actionUrl: pulseUrl,
        pulse_frequency_days: frequencyDays,
        pulseFrequencyDays: frequencyDays,
        pulse_interval_label: intervalLabel,
        pulseIntervalLabel: intervalLabel,
        pulse_due_at: enrollment.next_pulse_due_at,
        pulseDueAt: enrollment.next_pulse_due_at,
        pulse_due_date_display: dueDateDisplay,
        pulseDueDateDisplay: dueDateDisplay,
        due_date_display: dueDateDisplay,
        dueDateDisplay: dueDateDisplay,
        sent_at: sentAt,
        sentAt,
        support_email: supportEmail,
        supportEmail,
        merchant_support_email: supportEmail,
        merchantSupportEmail: supportEmail,
        business_name: businessName,
        businessName,
        merchant_business_name: businessName,
        merchantBusinessName: businessName,
        offer: {
          name: offer?.offer_name || '',
          pulse_check_url: pulseUrl,
          pulse_interval_label: intervalLabel,
        },
        merchant: {
          business_name: businessName,
          support_email: supportEmail,
        },
        pulse: {
          check_url: pulseUrl,
          due_at: enrollment.next_pulse_due_at,
          due_date_display: dueDateDisplay,
          interval_label: intervalLabel,
          frequency_days: frequencyDays,
        },
      });

      if (triggerResult.sent === 0) {
        skipped++;
        logger.warn({ locationId: enrollment.location_id, enrollmentId: enrollment.id, failed: triggerResult.failed }, 'Pulse app-event trigger had no successful deliveries');
        continue;
      }

      const { error: updateError } = await supabase
        .from('enrollments')
        .update({
          last_pulse_sent_at: now.toISOString(),
          next_pulse_due_at: nextDue.toISOString(),
        })
        .eq('id', enrollment.id);

      if (updateError) throw updateError;
      await idempotencyRepository.record(pulseEventId, 'pulse_check', enrollment.location_id, {
        sent: triggerResult.sent,
        failed: triggerResult.failed,
        next_pulse_due_at: enrollment.next_pulse_due_at,
      });
      sent++;
    } catch (err: any) {
      skipped++;
      logger.warn({ err: err.message, enrollmentId: enrollment.id }, 'Pulse cadence send failed');
    }
  }

  logger.info({ total: enrollments.length, sent, skipped }, 'Pulse cadence check complete');
}

export async function getPulseCadenceDiagnostics(locationId: string): Promise<PulseCadenceDiagnosticReport> {
  const supabase = getSupabase();
  const now = new Date();
  const merchant = await merchantRepository.getByLocationId(locationId);

  const [dueRes, subscriptionRes, logsRes] = await Promise.all([
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
      .eq('trigger_key', 'ss_app_event')
      .eq('is_active', true),
    supabase
      .from('trigger_delivery_logs')
      .select('status, payload, created_at')
      .eq('location_id', locationId)
      .eq('trigger_key', 'ss_app_event')
      .order('created_at', { ascending: false })
      .limit(200),
  ]);

  if (dueRes.error) throw dueRes.error;
  if (subscriptionRes.error) throw subscriptionRes.error;
  if (logsRes.error) throw logsRes.error;

  const dueCount = (dueRes.data || []).length;
  const activeAppEventSubscriptions = (subscriptionRes.data || []).length;
  const pulseLogs = (logsRes.data || []).filter((log: any) => appEventTypeMatches(log.payload, 'pulse_check_due'));
  const recentPulseSentAt = pulseLogs.find((log: any) => log.status === 'sent')?.created_at || null;
  const recentPulseNoSubscriptionAt = pulseLogs.find((log: any) => log.status === 'no_subscription')?.created_at || null;
  const pulseEnabled = merchant.module_pulse !== false;
  const formUrlConfigured = true;
  const lastSkippedReason = dueCount > 0 && !pulseEnabled
    ? 'pulse_module_disabled'
    : dueCount > 0 && activeAppEventSubscriptions === 0
      ? 'ss_app_event_subscription_missing'
      : null;
  const status = dueCount === 0
    ? 'no_due_pulses'
    : !pulseEnabled || activeAppEventSubscriptions === 0
      ? 'needs_setup'
      : 'ready';
  const message = dueCount === 0
    ? 'No pulse check-ins are currently due.'
    : !pulseEnabled
      ? 'Pulse is disabled for this merchant.'
      : activeAppEventSubscriptions === 0
        ? 'Pulse check-ins are due, but the ScaleSafe App Event workflow is not subscribed.'
        : `${dueCount} pulse check-in(s) are due and ready to send.`;

  return {
    pulseEnabled,
    formUrlConfigured,
    activeAppEventSubscriptions,
    dueCount,
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
