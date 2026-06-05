import { getSupabase } from '../clients/supabase.client';
import { merchantRepository } from '../repositories/merchant.repository';
import { merchantService } from '../services/merchant.service';
import { triggerService } from '../services/trigger.service';
import { logger } from '../utils/logger';

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
      const merchant = await merchantRepository.getByLocationId(enrollment.location_id);
      if (merchant.module_pulse === false) {
        skipped++;
        logger.warn({ locationId: enrollment.location_id, enrollmentId: enrollment.id }, 'Pulse due but pulse module is disabled');
        continue;
      }
      const pulseConfig = await resolvePulseConfig(enrollment.location_id, merchant);
      if (!pulseConfig.formUrl) {
        skipped++;
        logger.warn({ locationId: enrollment.location_id, enrollmentId: enrollment.id }, 'Pulse due but pulse form URL is not configured');
        continue;
      }

      const { data: offer } = enrollment.offer_id
        ? await supabase
          .from('offers_mirror')
          .select('offer_name')
          .eq('id', enrollment.offer_id)
          .maybeSingle()
        : { data: null };

      const frequencyDays = normalizeFrequency(enrollment.pulse_frequency_days);
      const nextDue = new Date(now);
      nextDue.setDate(nextDue.getDate() + frequencyDays);

      const triggerResult = await triggerService.fireTrigger(enrollment.location_id, 'ss_app_event', {
        event_type: 'pulse_check_due',
        eventType: 'pulse_check_due',
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
        form_url: pulseConfig.formUrl,
        formUrl: pulseConfig.formUrl,
        pulse_frequency_days: frequencyDays,
        pulseFrequencyDays: frequencyDays,
        pulse_due_at: enrollment.next_pulse_due_at,
        pulseDueAt: enrollment.next_pulse_due_at,
        sent_at: now.toISOString(),
        sentAt: now.toISOString(),
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
  const pulseConfig = await resolvePulseConfig(locationId, merchant);

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
  const pulseLogs = (logsRes.data || []).filter((log: any) => log.payload?.event_type === 'pulse_check_due');
  const recentPulseSentAt = pulseLogs.find((log: any) => log.status === 'sent')?.created_at || null;
  const recentPulseNoSubscriptionAt = pulseLogs.find((log: any) => log.status === 'no_subscription')?.created_at || null;
  const pulseEnabled = merchant.module_pulse !== false;
  const formUrlConfigured = Boolean(pulseConfig.formUrl);
  const lastSkippedReason = dueCount > 0 && !pulseEnabled
    ? 'pulse_module_disabled'
    : dueCount > 0 && !formUrlConfigured
    ? 'pulse_form_url_missing'
    : dueCount > 0 && activeAppEventSubscriptions === 0
      ? 'ss_app_event_subscription_missing'
      : null;
  const status = dueCount === 0
    ? 'no_due_pulses'
    : !pulseEnabled || !formUrlConfigured || activeAppEventSubscriptions === 0
      ? 'needs_setup'
      : 'ready';
  const message = dueCount === 0
    ? 'No pulse check-ins are currently due.'
    : !pulseEnabled
      ? 'Pulse is disabled for this merchant.'
      : !formUrlConfigured
        ? 'Pulse check-ins are due, but the pulse form URL is not configured.'
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

async function resolvePulseConfig(
  locationId: string,
  merchant: { config?: Record<string, unknown>; custom_value_ids?: Record<string, string> },
): Promise<{ workflowWebhookUrl: string; formUrl: string }> {
  const config = merchant.config || {};
  const workflowWebhookUrl = String(config.pulse_workflow_webhook_url || process.env.PULSE_WORKFLOW_WEBHOOK_URL || '');
  let formUrl = String(config.pulse_form_url || process.env.PULSE_FORM_URL || '');

  const cvIds = merchant.custom_value_ids || {};
  if (!formUrl && cvIds.PULSE_FORM_URL) {
    const values = await merchantService.readGhlCustomValues(locationId);
    formUrl ||= values[cvIds.PULSE_FORM_URL] || '';
  }

  return { workflowWebhookUrl, formUrl };
}

function normalizeFrequency(days: unknown): number {
  const parsed = Number(days || DEFAULT_PULSE_FREQUENCY_DAYS);
  if (!Number.isFinite(parsed)) return DEFAULT_PULSE_FREQUENCY_DAYS;
  return Math.min(365, Math.max(1, Math.round(parsed)));
}
