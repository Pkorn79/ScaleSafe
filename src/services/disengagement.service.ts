import { getSupabase } from '../clients/supabase.client';
import { evidenceRepository } from '../repositories/evidence.repository';
import { merchantRepository } from '../repositories/merchant.repository';
import { logger } from '../utils/logger';
import { EVIDENCE_TYPES } from '../constants/evidence-types';

interface RiskAssessment {
  contactId: string;
  locationId: string;
  riskScore: number;          // 0-100, higher = more at risk
  riskFactors: string[];
  daysInactive: number;
  flagged: boolean;
}

// Default thresholds — overridable per merchant via config
const DEFAULT_THRESHOLDS = {
  missedSessionsToFlag: 2,
  inactiveDaysModules: 14,
  inactiveDaysLogin: 14,
  pulsScoreThreshold: 2,     // score below this is negative
  paymentFailuresToCompound: 1,
  inactiveDaysComms: 21,
};

export const disengagementService = {
  /**
   * Score a single client's engagement risk (0-100).
   * Higher score = higher risk of disengagement/chargeback.
   */
  async scoreClient(locationId: string, contactId: string): Promise<RiskAssessment> {
    const supabase = getSupabase();
    const now = Date.now();
    const riskFactors: string[] = [];
    let riskScore = 0;

    // Load merchant thresholds
    const merchant = await merchantRepository.getByLocationId(locationId);
    const thresholds = { ...DEFAULT_THRESHOLDS, ...(merchant.config.disengagement_thresholds as any || {}) };

    // 1. Missed sessions: 2+ consecutive no-shows (+25 risk)
    const { data: attendance } = await supabase
      .from('evidence_attendance')
      .select('status, created_at')
      .eq('location_id', locationId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false })
      .limit(5);

    if (attendance) {
      let consecutiveNoShows = 0;
      for (const a of attendance) {
        if (a.status === 'no_show') consecutiveNoShows++;
        else break;
      }
      if (consecutiveNoShows >= thresholds.missedSessionsToFlag) {
        riskScore += 25;
        riskFactors.push(`${consecutiveNoShows} consecutive no-shows`);
      }
    }

    // 2. No module progress for X days (+20 risk)
    const { data: lastModule } = await supabase
      .from('evidence_modules')
      .select('created_at')
      .eq('location_id', locationId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (lastModule) {
      const daysSince = Math.floor((now - new Date(lastModule.created_at).getTime()) / 86400000);
      if (daysSince > thresholds.inactiveDaysModules) {
        riskScore += 20;
        riskFactors.push(`No module progress for ${daysSince} days`);
      }
    }

    // 3. No login/service access for X days (+15 risk)
    const { data: lastAccess } = await supabase
      .from('evidence_service_access')
      .select('created_at')
      .eq('location_id', locationId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (lastAccess) {
      const daysSince = Math.floor((now - new Date(lastAccess.created_at).getTime()) / 86400000);
      if (daysSince > thresholds.inactiveDaysLogin) {
        riskScore += 15;
        riskFactors.push(`No platform access for ${daysSince} days`);
      }
    }

    // 4. Negative pulse check (+15 risk)
    const { data: lastPulse } = await supabase
      .from('evidence_pulse_checkins')
      .select('satisfaction_score, created_at')
      .eq('location_id', locationId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (lastPulse && lastPulse.satisfaction_score <= thresholds.pulsScoreThreshold) {
      riskScore += 15;
      riskFactors.push(`Low satisfaction score: ${lastPulse.satisfaction_score}/5`);
    }

    // 5. Payment failures compound risk (+15)
    const { data: failedPayments } = await supabase
      .from('evidence_failed_payment')
      .select('created_at')
      .eq('location_id', locationId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false })
      .limit(5);

    if (failedPayments && failedPayments.length >= thresholds.paymentFailuresToCompound) {
      const recentFailures = failedPayments.filter(
        (f) => now - new Date(f.created_at).getTime() < 30 * 86400000,
      );
      if (recentFailures.length > 0) {
        riskScore += 15;
        riskFactors.push(`${recentFailures.length} payment failure(s) in last 30 days`);
      }
    }

    // 6. No communication response (+10)
    const { data: lastComm } = await supabase
      .from('evidence_communication')
      .select('direction, created_at')
      .eq('location_id', locationId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false })
      .limit(10);

    if (lastComm && lastComm.length > 0) {
      const hasInbound = lastComm.some((c) => c.direction === 'inbound');
      const lastOutbound = lastComm.find((c) => c.direction === 'outbound');
      if (lastOutbound && !hasInbound) {
        const daysSince = Math.floor((now - new Date(lastOutbound.created_at).getTime()) / 86400000);
        if (daysSince > thresholds.inactiveDaysComms) {
          riskScore += 10;
          riskFactors.push(`No communication response for ${daysSince} days`);
        }
      }
    }

    // Calculate days inactive (from any evidence)
    const lastDate = await evidenceRepository.getLastEvidenceDate(locationId, contactId);
    const daysInactive = lastDate
      ? Math.floor((now - new Date(lastDate).getTime()) / 86400000)
      : 999;

    const flagged = riskScore >= 40;

    return {
      contactId,
      locationId,
      riskScore: Math.min(100, riskScore),
      riskFactors,
      daysInactive,
      flagged,
    };
  },

  /**
   * Run disengagement check across all active clients for a merchant.
   * Returns list of newly flagged at-risk clients.
   * Risk scoring runs unconditionally so the dashboard can still display risk;
   * the GHL engagement-status write is gated on `merchants.engagement_enabled`.
   */
  async checkAllClients(locationId: string): Promise<RiskAssessment[]> {
    const supabase = getSupabase();

    // Get all distinct contact_ids with evidence for this location
    const { data: contacts, error } = await supabase
      .from('evidence_timeline')
      .select('contact_id')
      .eq('location_id', locationId);

    if (error) throw error;

    const uniqueContactIds = [...new Set((contacts || []).map((c) => c.contact_id))];
    const flaggedClients: RiskAssessment[] = [];

    const merchant = await merchantRepository.getByLocationId(locationId);
    const engagementEnabled = (merchant as any).engagement_enabled ?? true;

    for (const contactId of uniqueContactIds) {
      try {
        const assessment = await this.scoreClient(locationId, contactId);
        if (assessment.flagged) {
          flaggedClients.push(assessment);
          if (engagementEnabled) {
            // Set engagement status to "At Risk" — GHL Contact Field Changed trigger drives the workflow
            try {
              const { ghlApi: getApi } = require('../clients/ghl.client');
              const { SS_CONTACT_FIELDS: fields } = require('../constants/ghl-fields');
              const api = await getApi(locationId);
              await api.put(`/contacts/${contactId}`, {
                customField: { [fields.ENGAGEMENT_STATUS]: 'At Risk' },
              });
            } catch { /* non-blocking */ }

            // #29: record a custom_event so the re-engagement detector (evidence.service) can
            // later recognise this contact was flagged At Risk by the scorer and fire the
            // "Client Re-Engaged" workflow on their return. Previously only payment-failure
            // dunning was detectable; scorer-only At Risk clients never auto-cleared.
            try {
              const { phase2EvidenceRepository } = require('../repositories/phase2Evidence.repository');
              await phase2EvidenceRepository.create({
                location_id: locationId,
                contact_id: contactId,
                evidence_type: 'custom_event',
                data: { event_type: 'disengagement_flagged', flagged_at: new Date().toISOString() },
              });
            } catch { /* non-blocking */ }
          }
        }
      } catch (err) {
        logger.warn({ err, contactId, locationId }, 'Error scoring client engagement');
      }
    }

    logger.info(
      { locationId, totalChecked: uniqueContactIds.length, flagged: flaggedClients.length },
      'Disengagement check complete',
    );

    return flaggedClients;
  },
};
