import { getSupabase } from '../clients/supabase.client';
import { merchantRepository } from '../repositories/merchant.repository';
import { merchantService } from '../services/merchant.service';
import { triggerService } from '../services/trigger.service';
import { logger } from '../utils/logger';

const DEFAULT_PULSE_FREQUENCY_DAYS = 30;

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
