import { evidenceRepository, EvidenceInsert } from '../repositories/evidence.repository';
import { ghlApi } from '../clients/ghl.client';
import { triggerService } from './trigger.service';
import { logger } from '../utils/logger';
import { EvidenceType, EVIDENCE_TYPES } from '../constants/evidence-types';
import { SS_CONTACT_FIELDS } from '../constants/ghl-fields';

export const evidenceService = {
  /**
   * Log a piece of evidence. This is the universal entry point.
   * Inserts into the correct table and updates GHL contact fields.
   */
  async logEvidence(
    evidenceType: EvidenceType,
    locationId: string,
    contactId: string,
    source: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const record: EvidenceInsert = {
      location_id: locationId,
      contact_id: contactId,
      source,
      ...data,
    };

    await evidenceRepository.insert(evidenceType, record);

    // Update GHL contact: last evidence date + evidence score
    let newScore = 0;
    try {
      const result = await this.calculateReadinessScore(locationId, contactId);
      newScore = result.score;
      const lastDate = await evidenceRepository.getLastEvidenceDate(locationId, contactId);
      const api = await ghlApi(locationId);
      await api.put(`/contacts/${contactId}`, {
        customField: {
          [SS_CONTACT_FIELDS.EVIDENCE_SCORE]: newScore,
          [SS_CONTACT_FIELDS.LAST_EVIDENCE_DATE]: lastDate || '',
        },
      });
    } catch (err) {
      logger.warn({ err, contactId, locationId }, 'Failed to update GHL evidence fields');
    }

    // Check for re-engagement: if contact was at-risk and just logged evidence, they're back
    try {
      const { getSupabase } = await import('../clients/supabase.client');
      const { data: atRiskEvent } = await getSupabase()
        .from('payment_events')
        .select('id, dunning_status')
        .eq('location_id', locationId)
        .eq('contact_id', contactId)
        .in('dunning_status', ['active', 'escalated'])
        .limit(1)
        .maybeSingle();

      // Also check if disengagement recently flagged this contact (via evidence of at-risk trigger)
      const { data: atRiskEvidence } = await getSupabase()
        .from('evidence')
        .select('id, data')
        .eq('location_id', locationId)
        .eq('contact_id', contactId)
        .eq('evidence_type', 'custom_event')
        .order('created_at', { ascending: false })
        .limit(5);

      const wasAtRisk = !!atRiskEvent || (atRiskEvidence || []).some(
        (e: any) => e.data?.event_type === 'disengagement_flagged' || e.data?.action === 'dunning_escalated'
      );

      if (wasAtRisk && ['session_delivery', 'module_completion', 'pulse_checkin', 'payment_confirmation', 'enrollment_payment', 'milestone_completion'].includes(evidenceType)) {
        // Set engagement status back to "Active" — GHL Contact Field Changed trigger drives workflow
        const api = await ghlApi(locationId);
        await api.put(`/contacts/${contactId}`, {
          customField: { [SS_CONTACT_FIELDS.ENGAGEMENT_STATUS]: 'Active' },
        });
        logger.info({ contactId, evidenceType }, 'Client re-engaged — engagement status set to Active');
      }
    } catch { /* re-engagement detection is non-blocking */ }

    // Check evidence milestone thresholds
    try {
      await this.checkEvidenceMilestone(locationId, contactId, newScore);
    } catch { /* non-blocking */ }

    logger.info({ evidenceType, contactId, locationId, source }, 'Evidence logged');
  },

  /**
   * Handle GHL form submission webhook → log as evidence.
   */
  async handleFormSubmission(
    formId: string,
    locationId: string,
    contactId: string,
    formData: Record<string, unknown>,
  ): Promise<EvidenceType | null> {
    const formMap: Record<string, { type: EvidenceType; mapper: (d: Record<string, unknown>) => Record<string, unknown> }> = {
      'SYS2-07': {
        type: EVIDENCE_TYPES.SESSION_DELIVERY,
        mapper: (d) => ({
          session_date: d.session_date,
          session_type: d.session_type || d.delivery_method,
          session_title: d.session_title || d.topics,
          duration_minutes: d.duration,
          delivery_method: d.delivery_method,
          topics_covered: d.topics || d.topics_covered,
          attendance_status: d.no_show ? 'no_show' : 'attended',
          facilitator: d.facilitator,
          no_show: d.no_show || false,
          notes: d.notes,
          raw_payload: d,
        }),
      },
      'SYS2-08': {
        type: EVIDENCE_TYPES.MODULE_COMPLETION,
        mapper: (d) => ({
          module_name: d.module_name,
          completion_date: d.completion_date,
          completion_status: d.status || (d.progress === 100 || d.progress_pct === 100 ? 'completed' : 'in_progress'),
          progress_pct: d.progress || d.progress_pct || 100,
          score: d.score || d.assessment_score,
          time_spent_minutes: d.time_spent,
          notes: d.notes,
          raw_payload: d,
        }),
      },
      'SYS2-09': {
        type: EVIDENCE_TYPES.PULSE_CHECKIN,
        mapper: (d) => ({
          checkin_date: d.checkin_date || new Date().toISOString(),
          sentiment_score: d.satisfaction || d.sentiment || d.sentiment_score,
          feedback_text: d.feedback_text || d.feedback,
          follow_up_needed: d.follow_up_flag || d.followup_needed || false,
          follow_up_action: d.follow_up_action,
          raw_payload: d,
        }),
      },
      'SYS2-10': {
        type: EVIDENCE_TYPES.PAYMENT_CONFIRMATION,
        mapper: (d) => ({
          ghl_transaction_id: d.transaction_id,
          amount: d.amount,
          payment_date: d.payment_date || new Date().toISOString(),
          payment_number: d.payment_number,
          running_total: d.running_total,
          payments_remaining: d.payments_remaining,
          payment_method: d.payment_method,
          raw_payload: d,
        }),
      },
      'SYS2-11': {
        type: EVIDENCE_TYPES.CANCELLATION,
        mapper: (d) => ({
          cancellation_date: d.cancellation_date || new Date().toISOString(),
          reason: d.reason,
          refund_eligibility: d.refund_eligibility,
          status_at_cancellation: d.status_at_cancellation,
          initiated_by: d.initiated_by || 'merchant',
          notes: d.notes,
          raw_payload: d,
        }),
      },
    };

    const handler = formMap[formId];
    if (!handler) {
      logger.warn({ formId }, 'Unknown form ID, skipping');
      return null;
    }

    const mappedData = handler.mapper(formData);
    await this.logEvidence(handler.type, locationId, contactId, `ghl_form_${formId}`, mappedData);

    // Fire workflow triggers (non-blocking)
    try {
      if (formId === 'SYS2-07') {
        await triggerService.fireTrigger(locationId, 'ss_session_logged', {
          contact_id: contactId,
          session_date: mappedData.session_date,
          duration: mappedData.duration_minutes,
          topics: mappedData.topics_covered,
          no_show_flag: mappedData.no_show,
        });
        if (mappedData.no_show) {
          await triggerService.fireTrigger(locationId, 'ss_session_noshow', {
            contact_id: contactId,
            scheduled_date: mappedData.session_date,
            follow_up_action: 'auto_reschedule_sent',
          });
        }
      } else if (formId === 'SYS2-08') {
        await triggerService.fireTrigger(locationId, 'ss_module_completed', {
          contact_id: contactId,
          module_name: mappedData.module_name,
          progress_pct: mappedData.progress_pct,
          completion_date: mappedData.completion_date,
        });
      } else if (formId === 'SYS2-11') {
        await triggerService.fireTrigger(locationId, 'ss_cancellation_requested', {
          contact_id: contactId,
          offer_id: '',
          reason: mappedData.reason,
          refund_eligibility: mappedData.refund_eligibility,
          enrollment_date: '',
        });
      }
    } catch (triggerErr: any) {
      logger.warn({ err: triggerErr.message, formId, contactId }, 'Trigger fire failed after form evidence — non-blocking');
    }

    return handler.type;
  },

  /**
   * Handle external platform webhook → log as evidence.
   */
  async handleExternalEvent(
    eventType: string,
    locationId: string,
    contactId: string,
    source: string,
    data: Record<string, unknown>,
  ): Promise<EvidenceType | null> {
    const typeMap: Record<string, { evidenceType: EvidenceType; mapper: (d: Record<string, unknown>) => Record<string, unknown> }> = {
      session_completed: {
        evidenceType: EVIDENCE_TYPES.EXTERNAL_SESSION,
        mapper: (d) => ({
          platform: source,
          session_date: d.session_date,
          duration_minutes: d.duration,
          session_type: d.session_type,
          recording_url: d.recording_url,
          topics_covered: d.topics || d.topics_covered,
          notes: d.notes,
          raw_payload: d,
        }),
      },
      no_show: {
        evidenceType: EVIDENCE_TYPES.SESSION_ATTENDANCE,
        mapper: (d) => ({
          session_date: d.session_date,
          status: 'no_show',
          followup_action: d.notes,
          raw_payload: d,
        }),
      },
      module_completed: {
        evidenceType: EVIDENCE_TYPES.MODULE_COMPLETION,
        mapper: (d) => ({
          module_name: d.module_name,
          completion_date: d.completion_date,
          completion_status: 'completed',
          progress_pct: 100,
          score: d.score,
          time_spent_minutes: d.time_spent,
          raw_payload: d,
        }),
      },
      milestone_signed: {
        evidenceType: EVIDENCE_TYPES.MILESTONE_SIGNOFF,
        mapper: (d) => ({
          milestone_name: d.milestone_name,
          work_summary: d.summary,
          approved: d.approved,
          signed_at: new Date().toISOString(),
          raw_payload: d,
        }),
      },
      pulse_check: {
        evidenceType: EVIDENCE_TYPES.PULSE_CHECKIN,
        mapper: (d) => ({
          checkin_date: new Date().toISOString(),
          sentiment_score: d.satisfaction || d.sentiment,
          feedback_text: d.going_well ? `${d.going_well} | Concerns: ${d.concerns || 'none'}` : '',
          follow_up_needed: d.follow_up_needed || false,
          raw_payload: d,
        }),
      },
      payment_update: {
        evidenceType: EVIDENCE_TYPES.PAYMENT_CONFIRMATION,
        mapper: (d) => ({
          amount: d.amount,
          payment_date: new Date().toISOString(),
          payment_method: d.payment_method || d.reason,
          raw_payload: d,
        }),
      },
      service_access: {
        evidenceType: EVIDENCE_TYPES.SERVICE_ACCESS,
        mapper: (d) => ({
          platform: d.platform || source,
          login_timestamp: d.access_date || new Date().toISOString(),
          content_accessed: d.content_accessed,
          time_spent_minutes: d.time_spent,
          completion_status: d.completion_status,
        }),
      },
      course_completed: {
        evidenceType: EVIDENCE_TYPES.COURSE_COMPLETION,
        mapper: (d) => ({
          platform: d.platform || source,
          course_name: d.course_name,
          completed_at: d.completion_date || new Date().toISOString(),
          certificate_url: d.certificate,
        }),
      },
      assignment_submitted: {
        evidenceType: EVIDENCE_TYPES.ASSIGNMENT_SUBMISSION,
        mapper: (d) => ({
          title: d.title,
          submitted_at: new Date().toISOString(),
          grade: d.grade,
        }),
      },
      custom_event: {
        evidenceType: EVIDENCE_TYPES.CUSTOM_EVENT,
        mapper: (d) => ({
          event_type: d.type || 'custom',
          event_timestamp: new Date().toISOString(),
          metadata: d,
        }),
      },
    };

    const handler = typeMap[eventType];
    if (!handler) {
      logger.warn({ eventType, source }, 'Unknown external event type, logging as custom');
      await this.logEvidence(EVIDENCE_TYPES.CUSTOM_EVENT, locationId, contactId, source, {
        event_type: eventType,
        event_timestamp: new Date().toISOString(),
        metadata: data,
      });
      return EVIDENCE_TYPES.CUSTOM_EVENT;
    }

    const mappedData = handler.mapper(data);
    await this.logEvidence(handler.evidenceType, locationId, contactId, source, mappedData);
    return handler.evidenceType;
  },

  /**
   * Get full evidence timeline for a contact.
   */
  async getTimeline(locationId: string, contactId: string) {
    return evidenceRepository.getTimeline(locationId, contactId);
  },

  /**
   * Calculate Defense Readiness Score (0-100).
   */
  async calculateReadinessScore(locationId: string, contactId: string): Promise<{
    score: number;
    breakdown: Record<string, { points: number; max: number; detail: string }>;
  }> {
    const counts = await evidenceRepository.getCounts(locationId, contactId) || {};
    const lastDate = await evidenceRepository.getLastEvidenceDate(locationId, contactId);

    const breakdown: Record<string, { points: number; max: number; detail: string }> = {};

    // Enrollment consent quality: 0-20
    const consentCount = counts[EVIDENCE_TYPES.CONSENT] || 0;
    const consentPoints = consentCount > 0 ? 20 : 0;
    breakdown.consent = { points: consentPoints, max: 20, detail: `${consentCount} consent record(s)` };

    // Payment history: 0-15
    const paymentCount = (counts[EVIDENCE_TYPES.ENROLLMENT_PAYMENT] || 0) + (counts[EVIDENCE_TYPES.PAYMENT_CONFIRMATION] || 0);
    const paymentPoints = Math.min(15, paymentCount * 3);
    breakdown.payments = { points: paymentPoints, max: 15, detail: `${paymentCount} payment(s)` };

    // Service delivery proof: 0-25
    const deliveryCount =
      (counts[EVIDENCE_TYPES.SESSION_DELIVERY] || 0) +
      (counts[EVIDENCE_TYPES.MODULE_COMPLETION] || 0) +
      (counts[EVIDENCE_TYPES.MILESTONE_COMPLETION] || 0) +
      (counts[EVIDENCE_TYPES.EXTERNAL_SESSION] || 0) +
      (counts[EVIDENCE_TYPES.COURSE_COMPLETION] || 0);
    const deliveryPoints = Math.min(25, deliveryCount * 2.5);
    breakdown.delivery = { points: Math.round(deliveryPoints), max: 25, detail: `${deliveryCount} delivery record(s)` };

    // Client engagement: 0-20
    const engagementCount =
      (counts[EVIDENCE_TYPES.PULSE_CHECKIN] || 0) +
      (counts[EVIDENCE_TYPES.MILESTONE_SIGNOFF] || 0) +
      (counts[EVIDENCE_TYPES.COMMUNICATION] || 0);
    const engagementPoints = Math.min(20, engagementCount * 4);
    breakdown.engagement = { points: engagementPoints, max: 20, detail: `${engagementCount} engagement record(s)` };

    // Re-engagement documentation: 0-10
    const reengagementCount = counts[EVIDENCE_TYPES.SESSION_ATTENDANCE] || 0;
    const reengagementPoints = Math.min(10, reengagementCount * 5);
    breakdown.reengagement = { points: reengagementPoints, max: 10, detail: `${reengagementCount} attendance record(s)` };

    // Recency: 0-10
    let recencyPoints = 0;
    if (lastDate) {
      const daysSince = Math.floor((Date.now() - new Date(lastDate).getTime()) / (1000 * 60 * 60 * 24));
      if (daysSince <= 7) recencyPoints = 10;
      else if (daysSince <= 14) recencyPoints = 8;
      else if (daysSince <= 30) recencyPoints = 5;
      else if (daysSince <= 60) recencyPoints = 2;
      breakdown.recency = { points: recencyPoints, max: 10, detail: `Last evidence ${daysSince} day(s) ago` };
    } else {
      breakdown.recency = { points: 0, max: 10, detail: 'No evidence recorded' };
    }

    const score = consentPoints + paymentPoints + Math.round(deliveryPoints) + engagementPoints + reengagementPoints + recencyPoints;

    return { score: Math.min(100, score), breakdown };
  },

  /**
   * Update the 2 evidence-related contact fields in GHL.
   */
  /**
   * Check if evidence readiness score crossed a milestone threshold.
   * Fires ss_evidence_milestone when score crosses 25, 50, 75, or 90.
   */
  async checkEvidenceMilestone(locationId: string, contactId: string, currentScore: number): Promise<void> {
    const thresholds = [25, 50, 75, 90];
    const { getSupabase } = await import('../clients/supabase.client');

    // Get the previously stored score from GHL (approximation: check evidence table for last milestone)
    const { data: lastMilestone } = await getSupabase()
      .from('evidence')
      .select('data')
      .eq('location_id', locationId)
      .eq('contact_id', contactId)
      .eq('evidence_type', 'custom_event')
      .order('created_at', { ascending: false })
      .limit(20);

    const firedMilestones = new Set(
      (lastMilestone || [])
        .filter((e: any) => e.data?.event_type === 'evidence_milestone')
        .map((e: any) => e.data?.milestone_threshold)
    );

    for (const threshold of thresholds) {
      if (currentScore >= threshold && !firedMilestones.has(threshold)) {
        // New milestone crossed — fire trigger and log
        const counts = await evidenceRepository.getCounts(locationId, contactId);
        const totalEvidence = Object.values(counts).reduce((a, b) => a + b, 0);

        const { triggerService: ts } = await import('./trigger.service');
        await ts.fireTrigger(locationId, 'ss_evidence_milestone', {
          contact_id: contactId,
          milestone_type: `score_${threshold}`,
          evidence_count: totalEvidence,
          readiness_score: currentScore,
        });

        // Log the milestone as evidence so we don't fire it again
        const { phase2EvidenceRepository } = await import('../repositories/phase2Evidence.repository');
        await phase2EvidenceRepository.create({
          location_id: locationId,
          contact_id: contactId,
          evidence_type: 'custom_event',
          data: {
            event_type: 'evidence_milestone',
            milestone_threshold: threshold,
            readiness_score: currentScore,
            evidence_count: totalEvidence,
            timestamp: new Date().toISOString(),
          },
        });

        logger.info({ contactId, threshold, currentScore, totalEvidence }, 'Evidence milestone reached');
        break; // Only fire one milestone per evidence log
      }
    }
  },
};
