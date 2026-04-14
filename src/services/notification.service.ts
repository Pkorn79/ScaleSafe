import { ghlApi } from '../clients/ghl.client';
import { merchantRepository } from '../repositories/merchant.repository';
import { logger } from '../utils/logger';
import { CUSTOM_TRIGGERS } from '../constants/ghl-fields';

/**
 * Fire GHL custom workflow triggers.
 * GHL workflows listen for these triggers and handle the actual notifications
 * (email, SMS, tasks, tags, pipeline moves). ScaleSafe just fires the event.
 */
export const notificationService = {
  /**
   * Fire a custom workflow trigger for a location.
   * The trigger must have been registered during merchant onboarding.
   */
  async fireTrigger(
    locationId: string,
    triggerName: string,
    contactId: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    try {
      const merchant = await merchantRepository.getByLocationId(locationId);
      const triggerIds = merchant.trigger_ids || {};
      const triggerId = triggerIds[triggerName];

      if (!triggerId) {
        logger.warn({ locationId, triggerName }, 'Custom trigger not registered, skipping');
        return;
      }

      const api = await ghlApi(locationId);
      await api.post(`/contacts/${contactId}/workflow/${triggerId}`, {
        ...data,
        contactId,
        locationId,
      });

      logger.info({ locationId, triggerName, contactId }, 'Custom trigger fired');
    } catch (err) {
      logger.error({ err, locationId, triggerName, contactId }, 'Failed to fire custom trigger');
    }
  },

  // --- Convenience methods for each trigger type ---

  async fireChargebackDetected(
    locationId: string,
    contactId: string,
    data: { amount: number; reasonCode: string; disputeDate: string; processor?: string },
  ): Promise<void> {
    // Doc contract: contact_id, amount, reason_code, dispute_date, processor
    await this.fireTrigger(locationId, CUSTOM_TRIGGERS.CHARGEBACK_DETECTED, contactId, {
      contact_id: contactId,
      amount: data.amount,
      reason_code: data.reasonCode,
      dispute_date: data.disputeDate,
      processor: data.processor || 'stripe',
    });
  },

  async fireDefenseReady(
    locationId: string,
    contactId: string,
    data: { packetUrl: string; evidenceCount: number; readinessScore: number; processor?: string },
  ): Promise<void> {
    // Doc contract: contact_id, packet_url, evidence_count, readiness_score, processor
    await this.fireTrigger(locationId, CUSTOM_TRIGGERS.DEFENSE_READY, contactId, {
      contact_id: contactId,
      packet_url: data.packetUrl,
      evidence_count: data.evidenceCount,
      readiness_score: data.readinessScore,
      processor: data.processor || 'stripe',
    });
  },

  async fireEvidenceMilestone(
    locationId: string,
    contactId: string,
    data: { milestoneType: string; evidenceCount: number; score: number },
  ): Promise<void> {
    await this.fireTrigger(locationId, CUSTOM_TRIGGERS.EVIDENCE_MILESTONE, contactId, {
      milestone_type: data.milestoneType,
      evidence_count: data.evidenceCount,
      score: data.score,
    });
  },

  // fireClientAtRisk — REMOVED. At-risk detection now writes to
  // ss_engagement_status contact field ('At Risk'). GHL's native
  // Contact Field Changed trigger drives the workflow.

  async firePaymentFailed(
    locationId: string,
    contactId: string,
    data: { amount: number; failureReason: string; attemptCount: number },
  ): Promise<void> {
    await this.fireTrigger(locationId, CUSTOM_TRIGGERS.PAYMENT_FAILED, contactId, {
      amount: data.amount,
      failure_reason: data.failureReason,
      attempt_count: data.attemptCount,
    });
  },
};
