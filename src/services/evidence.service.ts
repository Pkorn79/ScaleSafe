import { evidenceRepository, EvidenceInsert } from '../repositories/evidence.repository';
import { ghlApi } from '../clients/ghl.client';
import { getSupabase } from '../clients/supabase.client';
import { triggerService } from './trigger.service';
import { logger } from '../utils/logger';
import { EvidenceType, EVIDENCE_TYPES } from '../constants/evidence-types';
import { SS_CONTACT_FIELDS } from '../constants/ghl-fields';
import { buildDefenseEvidenceFields } from '../utils/defense-evidence';
import { commandCenterHealthService } from './command-center-health.service';

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
    commandCenterHealthService.markMerchantDirty(locationId, 'evidence_changed');

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

      const participationEvidenceTypes: EvidenceType[] = [
        EVIDENCE_TYPES.SESSION_DELIVERY,
        EVIDENCE_TYPES.APPOINTMENT,
        EVIDENCE_TYPES.MODULE_COMPLETION,
        EVIDENCE_TYPES.PULSE_CHECKIN,
        EVIDENCE_TYPES.MILESTONE_COMPLETION,
        EVIDENCE_TYPES.SERVICE_ACCESS,
        EVIDENCE_TYPES.EXTERNAL_SESSION,
        EVIDENCE_TYPES.COURSE_COMPLETION,
        EVIDENCE_TYPES.ASSIGNMENT_SUBMISSION,
      ];

      if (wasAtRisk && participationEvidenceTypes.includes(evidenceType)) {
        // Gate the engagement-status write on the merchant's master toggle so re-engagement
        // workflows stay silent for merchants who have engagement tracking disabled.
        const { merchantRepository } = await import('../repositories/merchant.repository');
        const merchant = await merchantRepository.getByLocationId(locationId).catch(() => null);
        if ((merchant as any)?.engagement_enabled ?? true) {
          // Set engagement status back to "Active" — GHL Contact Field Changed trigger drives workflow
          const api = await ghlApi(locationId);
          await api.put(`/contacts/${contactId}`, {
            customField: { [SS_CONTACT_FIELDS.ENGAGEMENT_STATUS]: 'Active' },
          });
          logger.info({ contactId, evidenceType }, 'Client re-engaged — engagement status set to Active');
        }
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
          ...buildDefenseEvidenceFields({
            summary: `Session "${d.session_title || d.topics || 'Untitled'}" ${d.no_show ? 'was marked no-show' : 'was delivered'}${d.duration ? ` for ${d.duration} minutes` : ''}. Topics: ${d.topics || d.topics_covered || 'not specified'}.`,
            title: d.no_show ? 'Session No-Show' : 'Session Delivered',
            proofRole: d.no_show ? 'client_engagement' : 'service_delivery',
            relevance: { tags: ['services_not_provided', 'not_as_described'], priority: d.no_show ? 'medium' : 'high', confidence: 'moderate' },
            metadata: {
              actor: d.no_show ? 'client' : 'merchant',
              service: { serviceDate: String(d.session_date || '') || null, deliverableName: String(d.session_title || d.topics || '') || null },
              source: { system: 'ghl_form', rawEventType: 'SYS2-07' },
            },
          }),
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
          ...buildDefenseEvidenceFields({
            summary: `Module "${d.module_name || 'Untitled'}" recorded as ${d.status || (d.progress === 100 || d.progress_pct === 100 ? 'completed' : 'in progress')} with ${d.progress || d.progress_pct || 100}% progress.`,
            title: `Module: ${d.module_name || 'Untitled'}`,
            proofRole: 'service_delivery',
            relevance: { tags: ['services_not_provided', 'not_as_described'], priority: 'high', confidence: 'moderate' },
            metadata: {
              actor: 'client',
              service: { deliverableName: String(d.module_name || '') || null, serviceDate: String(d.completion_date || '') || null },
              source: { system: 'ghl_form', rawEventType: 'SYS2-08' },
            },
          }),
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
          enrollment_id: d.enrollment_id || d.enrollmentId || null,
          raw_payload: d,
          ...buildDefenseEvidenceFields({
            summary: `Client pulse check-in recorded with sentiment score ${d.satisfaction || d.sentiment || d.sentiment_score || 'n/a'}.${d.feedback_text || d.feedback ? ` Feedback: ${String(d.feedback_text || d.feedback).slice(0, 180)}` : ''}`,
            title: 'Client Pulse Check-In',
            proofRole: 'client_engagement',
            relevance: { tags: ['services_not_provided', 'not_as_described', 'fraud'], priority: 'high', confidence: 'moderate' },
            enrollmentId: String(d.enrollment_id || d.enrollmentId || '') || null,
            metadata: {
              actor: 'client',
              service: { enrollmentId: String(d.enrollment_id || d.enrollmentId || '') || null },
              source: { system: 'ghl_form', rawEventType: 'SYS2-09' },
            },
          }),
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
          ...buildDefenseEvidenceFields({
            summary: `Payment confirmation recorded for $${Number(d.amount || 0).toFixed(2)}${d.payment_number ? ` as payment #${d.payment_number}` : ''}.`,
            title: d.payment_number ? `Payment #${d.payment_number}` : 'Payment Confirmation',
            proofRole: 'payment_history',
            relevance: { tags: ['fraud', 'authorization', 'services_not_provided', 'credit_not_processed'], priority: 'high', confidence: 'strong' },
            metadata: {
              actor: 'processor',
              transaction: {
                transactionId: String(d.transaction_id || '') || null,
                amount: d.amount as any,
                paymentSequence: d.payment_number as any,
              },
              source: { system: 'ghl_form', rawEventType: 'SYS2-10' },
            },
          }),
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
          ...buildDefenseEvidenceFields({
            summary: `Cancellation request recorded. Initiated by ${d.initiated_by || 'merchant'}. Reason: ${d.reason || 'not specified'}. Refund eligibility: ${d.refund_eligibility || 'not specified'}.`,
            title: 'Cancellation Request',
            proofRole: 'cancellation',
            relevance: { tags: ['cancelled_recurring', 'credit_not_processed'], priority: 'critical', confidence: 'strong' },
            metadata: {
              actor: String(d.initiated_by || 'merchant') as any,
              policy: { policyType: 'cancellation' },
              source: { system: 'ghl_form', rawEventType: 'SYS2-11' },
            },
          }),
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
          ...buildDefenseEvidenceFields({
            summary: `${source} session "${d.session_type || 'session'}" completed${d.duration ? ` for ${d.duration} minutes` : ''}. Topics: ${d.topics || d.topics_covered || 'not specified'}.`,
            title: `${source} Session Completed`,
            proofRole: 'service_delivery',
            relevance: { tags: ['services_not_provided', 'not_as_described'], priority: 'high', confidence: 'moderate' },
            sourceRecordId: String(d.id || d.event_id || '') || null,
            metadata: {
              actor: 'client',
              service: { serviceDate: String(d.session_date || '') || null, deliverableName: String(d.session_type || '') || null },
              source: { system: source, recordId: String(d.id || d.event_id || '') || null, rawEventType: 'session_completed' },
            },
          }),
        }),
      },
      no_show: {
        evidenceType: EVIDENCE_TYPES.SESSION_ATTENDANCE,
        mapper: (d) => ({
          session_date: d.session_date,
          status: 'no_show',
          followup_action: d.notes,
          raw_payload: d,
          ...buildDefenseEvidenceFields({
            summary: `No-show recorded for scheduled session on ${d.session_date || 'unknown date'}.${d.notes ? ` Follow-up: ${d.notes}.` : ''}`,
            title: 'Session No-Show',
            proofRole: 'client_engagement',
            relevance: { tags: ['services_not_provided'], priority: 'medium', confidence: 'moderate' },
            metadata: {
              actor: 'client',
              service: { serviceDate: String(d.session_date || '') || null },
              source: { system: source, rawEventType: 'no_show' },
            },
          }),
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
          ...buildDefenseEvidenceFields({
            summary: `External module "${d.module_name || 'Untitled'}" completed on ${d.completion_date || 'unknown date'}.`,
            title: `Module Completed: ${d.module_name || 'Untitled'}`,
            proofRole: 'service_delivery',
            relevance: { tags: ['services_not_provided', 'not_as_described'], priority: 'high', confidence: 'moderate' },
            metadata: {
              actor: 'client',
              service: { deliverableName: String(d.module_name || '') || null, serviceDate: String(d.completion_date || '') || null },
              source: { system: source, rawEventType: 'module_completed' },
            },
          }),
        }),
      },
      module_progress: {
        evidenceType: EVIDENCE_TYPES.MODULE_PROGRESS,
        mapper: (d) => ({
          module_name: d.module_name || d.lesson_name || d.category_name || d.product_name || d.course_name,
          completion_date: d.progress_date || d.started_at || d.event_timestamp || new Date().toISOString(),
          completion_status: d.completion_status || 'in_progress',
          progress_pct: d.progress_pct || d.progress || 0,
          score: d.score,
          time_spent_minutes: d.time_spent,
          notes: d.notes,
          raw_payload: d,
          ...buildDefenseEvidenceFields({
            summary: `Course activity recorded: ${d.module_name || d.lesson_name || d.category_name || d.product_name || d.course_name || 'content'} started or progressed${d.progress_pct || d.progress ? ` (${d.progress_pct || d.progress}% progress)` : ''}.`,
            title: `Course Progress: ${d.module_name || d.lesson_name || d.category_name || d.product_name || d.course_name || 'Content'}`,
            proofRole: 'service_access',
            relevance: { tags: ['services_not_provided', 'not_as_described', 'fraud'], priority: 'medium', confidence: 'moderate' },
            sourceRecordId: String(d.id || d.event_id || '') || null,
            metadata: {
              actor: 'client',
              service: {
                accessConfirmed: true,
                serviceDate: String(d.progress_date || d.started_at || d.event_timestamp || '') || null,
                deliverableName: String(d.module_name || d.lesson_name || d.category_name || d.product_name || d.course_name || '') || null,
              },
              source: { system: source, recordId: String(d.id || d.event_id || '') || null, rawEventType: 'module_progress' },
            },
          }),
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
          ...buildDefenseEvidenceFields({
            summary: `Client milestone signoff recorded for "${d.milestone_name || 'Untitled'}". Approved: ${d.approved ? 'yes' : 'not specified'}.`,
            title: `Milestone Signoff: ${d.milestone_name || 'Untitled'}`,
            proofRole: 'service_delivery',
            relevance: { tags: ['services_not_provided', 'not_as_described'], priority: 'critical', confidence: 'strong' },
            metadata: {
              actor: 'client',
              service: { deliverableName: String(d.milestone_name || '') || null },
              source: { system: source, rawEventType: 'milestone_signed' },
            },
          }),
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
          ...buildDefenseEvidenceFields({
            summary: `Client pulse check-in recorded.${d.going_well ? ` Going well: ${String(d.going_well).slice(0, 140)}.` : ''}${d.concerns ? ` Concerns: ${String(d.concerns).slice(0, 140)}.` : ''}`,
            title: 'Client Pulse Check-In',
            proofRole: 'client_engagement',
            relevance: { tags: ['services_not_provided', 'not_as_described', 'fraud'], priority: 'high', confidence: 'moderate' },
            metadata: {
              actor: 'client',
              source: { system: source, rawEventType: 'pulse_check' },
            },
          }),
        }),
      },
      payment_update: {
        evidenceType: EVIDENCE_TYPES.PAYMENT_CONFIRMATION,
        mapper: (d) => ({
          amount: d.amount,
          payment_date: new Date().toISOString(),
          payment_method: d.payment_method || d.reason,
          raw_payload: d,
          ...buildDefenseEvidenceFields({
            summary: `External payment update recorded${d.amount ? ` for $${Number(d.amount).toFixed(2)}` : ''}. Method/reason: ${d.payment_method || d.reason || 'not specified'}.`,
            title: 'Payment Update',
            proofRole: 'payment_history',
            relevance: { tags: ['credit_not_processed', 'cancelled_recurring'], priority: 'medium', confidence: 'moderate' },
            metadata: {
              actor: 'processor',
              transaction: { amount: d.amount as any, processor: source },
              source: { system: source, rawEventType: 'payment_update' },
            },
          }),
        }),
      },
      service_access: {
        evidenceType: EVIDENCE_TYPES.SERVICE_ACCESS,
        mapper: (d) => ({
          platform: d.platform || source,
          event_type: d.event_type || 'access',
          access_date: d.access_date || new Date().toISOString(),
          duration_seconds: d.duration_seconds || (d.time_spent ? Number(d.time_spent) * 60 : undefined),
          ip_address: d.ip_address,
          device_fingerprint: d.device_fingerprint,
          content_accessed: d.content_accessed,
          raw_payload: d,
          ...buildDefenseEvidenceFields({
            summary: `Client accessed ${d.platform || source}${d.content_accessed ? ` content: ${d.content_accessed}` : ''}${d.time_spent ? ` for ${d.time_spent} minutes` : ''}.`,
            title: 'Service Access',
            proofRole: 'service_access',
            relevance: { tags: ['fraud', 'authorization', 'services_not_provided'], priority: 'critical', confidence: 'strong' },
            sourceRecordId: String(d.id || d.event_id || '') || null,
            metadata: {
              actor: 'client',
              customerIdentity: {
                ipAddress: String(d.ip_address || '') || null,
                deviceFingerprint: String(d.device_fingerprint || '') || null,
              },
              service: {
                accessConfirmed: true,
                serviceDate: String(d.access_date || '') || null,
                deliverableName: String(d.content_accessed || '') || null,
              },
              source: { system: String(d.platform || source), recordId: String(d.id || d.event_id || '') || null, rawEventType: 'service_access' },
            },
          }),
        }),
      },
      course_completed: {
        evidenceType: EVIDENCE_TYPES.COURSE_COMPLETION,
        mapper: (d) => ({
          platform: d.platform || source,
          course_name: d.course_name,
          completed_at: d.completion_date || new Date().toISOString(),
          certificate_url: d.certificate,
          raw_payload: d,
          ...buildDefenseEvidenceFields({
            summary: `Course "${d.course_name || 'Untitled'}" completed on ${d.completion_date || 'record date'}${d.certificate ? ' with certificate on file' : ''}.`,
            title: `Course Completed: ${d.course_name || 'Untitled'}`,
            proofRole: 'service_delivery',
            relevance: { tags: ['services_not_provided', 'not_as_described'], priority: 'high', confidence: 'strong' },
            metadata: {
              actor: 'client',
              service: { deliverableName: String(d.course_name || '') || null, serviceDate: String(d.completion_date || '') || null },
              source: { system: source, rawEventType: 'course_completed' },
            },
          }),
        }),
      },
      assignment_submitted: {
        evidenceType: EVIDENCE_TYPES.ASSIGNMENT_SUBMISSION,
        mapper: (d) => ({
          title: d.title,
          submitted_at: new Date().toISOString(),
          grade: d.grade,
          feedback: d.feedback,
          raw_payload: d,
          ...buildDefenseEvidenceFields({
            summary: `Assignment "${d.title || 'Untitled'}" submitted${d.grade ? ` with grade ${d.grade}` : ''}.`,
            title: `Assignment Submitted: ${d.title || 'Untitled'}`,
            proofRole: 'client_engagement',
            relevance: { tags: ['services_not_provided', 'not_as_described', 'fraud'], priority: 'medium', confidence: 'moderate' },
            metadata: {
              actor: 'client',
              service: { deliverableName: String(d.title || '') || null },
              source: { system: source, rawEventType: 'assignment_submitted' },
            },
          }),
        }),
      },
      custom_event: {
        evidenceType: EVIDENCE_TYPES.CUSTOM_EVENT,
        mapper: (d) => ({
          event_type: d.type || 'custom',
          event_timestamp: new Date().toISOString(),
          description: d.description || d.summary || `${d.type || 'custom'} event from ${source}`,
          metadata: d,
          raw_payload: d,
          ...buildDefenseEvidenceFields({
            summary: String(d.description || d.summary || `${d.type || 'custom'} event from ${source}`),
            title: String(d.title || d.type || 'Custom Event'),
            proofRole: 'other',
            relevance: { tags: ['general'], priority: 'low', confidence: 'weak' },
            sourceRecordId: String(d.id || d.event_id || '') || null,
            metadata: {
              actor: 'third_party',
              source: { system: source, recordId: String(d.id || d.event_id || '') || null, rawEventType: String(d.type || 'custom_event') },
              original: d,
            },
          }),
        }),
      },
    };

    const handler = typeMap[eventType];
    if (!handler) {
      logger.warn({ eventType, source }, 'Unknown external event type, logging as custom');
      await this.logEvidence(EVIDENCE_TYPES.CUSTOM_EVENT, locationId, contactId, source, {
        event_type: eventType,
        event_timestamp: new Date().toISOString(),
        description: data.description || data.summary || `${eventType} event from ${source}`,
        metadata: data,
        raw_payload: data,
        ...buildDefenseEvidenceFields({
          summary: String(data.description || data.summary || `${eventType} event from ${source}`),
          title: String(data.title || eventType),
          proofRole: 'other',
          relevance: { tags: ['general'], priority: 'low', confidence: 'weak' },
          sourceRecordId: String(data.id || data.event_id || '') || null,
          metadata: {
            actor: 'third_party',
            source: { system: source, recordId: String(data.id || data.event_id || '') || null, rawEventType: eventType },
            original: data,
          },
        }),
      });
      return EVIDENCE_TYPES.CUSTOM_EVENT;
    }

    const mappedData = handler.mapper(data);
    await this.logEvidence(handler.evidenceType, locationId, contactId, source, mappedData);
    return handler.evidenceType;
  },

  /**
   * Get evidence timeline for a contact, with optional filters.
   */
  async getTimeline(
    locationId: string,
    contactId: string,
    opts: { limit?: number; offset?: number; type?: string; from?: string; to?: string } = {},
  ) {
    return evidenceRepository.getTimeline(locationId, contactId, opts);
  },

  async linkEvidenceToEnrollment(
    locationId: string,
    contactId: string,
    evidenceTable: string,
    evidenceId: string,
    enrollmentId: string,
  ): Promise<void> {
    await evidenceRepository.linkToEnrollment(locationId, contactId, evidenceTable, evidenceId, enrollmentId);
  },

  /**
   * Calculate contact-level evidence readiness (0-100).
   * This is not an enrollment-specific score or dispute outcome prediction.
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
      (counts[EVIDENCE_TYPES.APPOINTMENT] || 0) +
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
      (counts[EVIDENCE_TYPES.COMMUNICATION] || 0) +
      (counts[EVIDENCE_TYPES.INVOICE] || 0);
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
