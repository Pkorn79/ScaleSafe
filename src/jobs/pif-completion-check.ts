import { getSupabase } from '../clients/supabase.client';
import { triggerService } from '../services/trigger.service';
import { evidenceService } from '../services/evidence.service';
import { EVIDENCE_TYPES } from '../constants/evidence-types';
import { SS_CONTACT_FIELDS } from '../constants/ghl-fields';
import { ghlApi } from '../clients/ghl.client';
import { logger } from '../utils/logger';

/**
 * Daily job: check if any PIF (paid-in-full / one_time) enrollments have
 * exceeded their program duration and opted into automatic program completion.
 *
 * PIF clients pay everything on day 1 but remain "enrolled" forever because
 * there's no installment counter to trigger completion. This job uses the
 * offer's program_duration_value + program_duration_unit + auto-complete flag to
 * calculate when the program period ends (enrolled_at + duration) and transitions
 * the enrollment to "completed" when that date has passed.
 *
 * Offers without program_duration_value are skipped — those PIF enrollments
 * stay "enrolled" until manually completed by the merchant.
 */
export async function runPifCompletionCheck(): Promise<{
  total: number;
  completed: number;
  skipped: number;
  failed: number;
}> {
  const supabase = getSupabase();
  const today = new Date();

  // Fetch all PIF enrollments that are still enrolled
  const { data: enrollments, error } = await supabase
    .from('enrollments')
    .select('id, location_id, merchant_id, contact_id, offer_id, enrolled_at, email, next_billing_date')
    .in('payment_type', ['one_time', 'pif'])
    .eq('status', 'enrolled')
    .not('enrolled_at', 'is', null)
    .not('offer_id', 'is', null);

  if (error) {
    logger.error({ err: error.message }, 'PIF completion check query failed');
    throw error;
  }

  if (!enrollments || enrollments.length === 0) {
    logger.info('PIF completion check: no eligible enrollments');
    return { total: 0, completed: 0, skipped: 0, failed: 0 };
  }

  // Batch-fetch all relevant offers for duration info
  const offerIds = [...new Set(enrollments.map(e => e.offer_id).filter(Boolean))];
  const { data: offers, error: offersError } = await supabase
    .from('offers_mirror')
    .select('id, offer_name, program_duration_value, program_duration_unit, auto_complete_on_duration_end')
    .in('id', offerIds);
  if (offersError) {
    logger.error({ err: offersError.message }, 'PIF completion offer query failed');
    throw offersError;
  }

  const offerMap = new Map((offers || []).map(o => [o.id, o]));

  let completed = 0;
  let skipped = 0;
  let failed = 0;

  for (const enr of enrollments) {
    const offer = offerMap.get(enr.offer_id);
    if (!offer?.auto_complete_on_duration_end || !offer?.program_duration_value || enr.next_billing_date) {
      skipped++;
      continue;
    }

    // Calculate program end date
    const enrolledAt = new Date(enr.enrolled_at);
    const endDate = new Date(enrolledAt);

    if (offer.program_duration_unit === 'weeks') {
      endDate.setDate(endDate.getDate() + offer.program_duration_value * 7);
    } else {
      // 'months' (default)
      endDate.setMonth(endDate.getMonth() + offer.program_duration_value);
    }

    if (endDate > today) {
      skipped++;
      continue; // Program hasn't ended yet
    }

    // Program duration has expired — mark as completed
    try {
      const { error: updateError } = await supabase.from('enrollments')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        })
        .eq('id', enr.id)
        .eq('location_id', enr.location_id);
      if (updateError) throw updateError;

      // Log evidence
      try {
        await evidenceService.logEvidence(
          EVIDENCE_TYPES.SUBSCRIPTION_CHANGE,
          enr.location_id,
          enr.contact_id,
          'system',
          {
            action: 'program_duration_expired',
            change_date: new Date().toISOString(),
            initiated_by: 'system',
            previous_status: 'enrolled',
            new_status: 'completed',
            program_duration: `${offer.program_duration_value} ${offer.program_duration_unit}`,
            enrolled_at: enr.enrolled_at,
            program_end_date: endDate.toISOString(),
          },
        );
      } catch {}

      // Fire ss_program_completed trigger
      try {
        await triggerService.fireTrigger(enr.location_id, 'ss_program_completed', {
          contact_id: enr.contact_id,
          offer_id: enr.offer_id || '',
          completed_at: new Date().toISOString(),
          completion_reason: 'program_duration_expired',
        });
      } catch {}

      // Update GHL contact
      try {
        const api = await ghlApi(enr.location_id);
        await api.put(`/contacts/${enr.contact_id}`, {
          customField: { [SS_CONTACT_FIELDS.ENROLLMENT_STATUS]: 'completed' },
        });
      } catch {}

      completed++;
      logger.info({
        enrollmentId: enr.id,
        contactId: enr.contact_id,
        offerName: offer.offer_name,
        enrolledAt: enr.enrolled_at,
        programEndDate: endDate.toISOString(),
      }, 'PIF completion: program duration expired — enrollment completed');
    } catch (err: any) {
      failed++;
      logger.error({ err: err.message, enrollmentId: enr.id }, 'PIF completion: update failed');
    }
  }

  const result = { total: enrollments.length, completed, skipped, failed };
  logger.info(result, 'PIF completion check done');
  return result;
}
