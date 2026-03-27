import { evidenceRepository, EvidenceInsert } from '../repositories/evidence.repository';
import { ghlApi } from '../clients/ghl.client';
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
    try {
      await this.updateContactEvidenceFields(locationId, contactId);
    } catch (err) {
      logger.warn({ err, contactId, locationId }, 'Failed to update GHL evidence fields');
    }

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
          duration_minutes: d.duration,
          topics: d.topics,
          delivery_method: d.delivery_method,
          notes: d.notes,
          no_show: d.no_show || false,
        }),
      },
      'SYS2-08': {
        type: EVIDENCE_TYPES.MODULE_COMPLETION,
        mapper: (d) => ({
          module_name: d.module_name,
          completed_at: d.completion_date,
          assessment_score: d.score,
          time_spent_minutes: d.time_spent,
          progress_pct: d.progress || 100,
        }),
      },
      'SYS2-09': {
        type: EVIDENCE_TYPES.PULSE_CHECKIN,
        mapper: (d) => ({
          checkin_date: d.checkin_date || new Date().toISOString(),
          satisfaction_score: d.satisfaction || d.sentiment,
          feedback_text: d.feedback_text || d.feedback,
          followup_needed: d.follow_up_flag || false,
        }),
      },
      'SYS2-10': {
        type: EVIDENCE_TYPES.PAYMENT_CONFIRMATION,
        mapper: (d) => ({
          amount: d.amount,
          payment_date: d.payment_date || new Date().toISOString(),
          running_total: d.running_total,
          payments_remaining: d.payments_remaining,
        }),
      },
      'SYS2-11': {
        type: EVIDENCE_TYPES.CANCELLATION,
        mapper: (d) => ({
          cancellation_date: d.cancellation_date || new Date().toISOString(),
          reason: d.reason,
          refund_eligibility: d.refund_eligibility,
          status_at_cancellation: d.status_at_cancellation,
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
          topics: d.topics,
          notes: d.notes,
        }),
      },
      no_show: {
        evidenceType: EVIDENCE_TYPES.SESSION_ATTENDANCE,
        mapper: (d) => ({
          session_date: d.session_date,
          status: 'no_show',
          followup_action: d.notes,
        }),
      },
      module_completed: {
        evidenceType: EVIDENCE_TYPES.MODULE_COMPLETION,
        mapper: (d) => ({
          module_name: d.module_name,
          completed_at: d.completion_date,
          assessment_score: d.score,
          time_spent_minutes: d.time_spent,
          progress_pct: 100,
        }),
      },
      milestone_signed: {
        evidenceType: EVIDENCE_TYPES.MILESTONE_SIGNOFF,
        mapper: (d) => ({
          milestone_name: d.milestone_name,
          work_summary: d.summary,
          approved: d.approved,
          signed_at: new Date().toISOString(),
        }),
      },
      pulse_check: {
        evidenceType: EVIDENCE_TYPES.PULSE_CHECKIN,
        mapper: (d) => ({
          satisfaction_score: d.satisfaction,
          feedback_text: d.going_well ? `${d.going_well} | Concerns: ${d.concerns || 'none'}` : '',
          nps_score: d.nps_score,
          checkin_date: new Date().toISOString(),
        }),
      },
      payment_update: {
        evidenceType: EVIDENCE_TYPES.PAYMENT_CONFIRMATION,
        mapper: (d) => ({
          amount: d.amount,
          payment_date: new Date().toISOString(),
          payment_reason: d.reason,
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
  async updateContactEvidenceFields(locationId: string, contactId: string): Promise<void> {
    const { score } = await this.calculateReadinessScore(locationId, contactId);
    const lastDate = await evidenceRepository.getLastEvidenceDate(locationId, contactId);

    const api = await ghlApi(locationId);
    await api.put(`/contacts/${contactId}`, {
      customField: {
        [SS_CONTACT_FIELDS.EVIDENCE_SCORE]: score,
        [SS_CONTACT_FIELDS.LAST_EVIDENCE_DATE]: lastDate || '',
      },
    });
  },
};
