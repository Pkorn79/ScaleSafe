import { getSupabase } from '../clients/supabase.client';
import { evidenceRepository } from '../repositories/evidence.repository';
import { merchantRepository } from '../repositories/merchant.repository';
import { logger } from '../utils/logger';

interface RiskAssessment {
  contactId: string;
  locationId: string;
  riskScore: number;
  riskFactors: string[];
  daysInactive: number;
  flagged: boolean;
}

const DEFAULT_THRESHOLDS = {
  missedSessionsToFlag: 2,
  inactiveDaysModules: 14,
  inactiveDaysLogin: 14,
  pulsScoreThreshold: 2,
  paymentFailuresToCompound: 1,
  inactiveDaysComms: 21,
};

type DisengagementThresholds = typeof DEFAULT_THRESHOLDS & Record<string, number>;

function resolveThresholds(merchant: any): DisengagementThresholds {
  return {
    ...DEFAULT_THRESHOLDS,
    ...((merchant?.config?.disengagement_thresholds as Record<string, number> | undefined) || {}),
  };
}

async function scoreClientWithThresholds(
  locationId: string,
  contactId: string,
  thresholds: DisengagementThresholds,
): Promise<RiskAssessment> {
  const supabase = getSupabase();
  const now = Date.now();
  const riskFactors: string[] = [];
  let riskScore = 0;

  // These sources are independent. Loading them together prevents one contact
  // from becoming a long serial chain of database round trips.
  const [
    attendanceResult,
    lastModuleResult,
    lastAccessResult,
    lastPulseResult,
    failedPaymentsResult,
    lastCommResult,
    lastDate,
  ] = await Promise.all([
    supabase
      .from('evidence_attendance')
      .select('status, created_at')
      .eq('location_id', locationId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false })
      .limit(5),
    supabase
      .from('evidence_modules')
      .select('created_at')
      .eq('location_id', locationId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single(),
    supabase
      .from('evidence_service_access')
      .select('created_at')
      .eq('location_id', locationId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single(),
    supabase
      .from('evidence_pulse_checkins')
      .select('satisfaction_score, created_at')
      .eq('location_id', locationId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single(),
    supabase
      .from('evidence_failed_payment')
      .select('created_at')
      .eq('location_id', locationId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false })
      .limit(5),
    supabase
      .from('evidence_communication')
      .select('direction, created_at')
      .eq('location_id', locationId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false })
      .limit(10),
    evidenceRepository.getLastEvidenceDate(locationId, contactId),
  ]);

  const attendance = attendanceResult.data;
  if (attendance) {
    let consecutiveNoShows = 0;
    for (const row of attendance) {
      if (row.status === 'no_show') consecutiveNoShows++;
      else break;
    }
    if (consecutiveNoShows >= thresholds.missedSessionsToFlag) {
      riskScore += 25;
      riskFactors.push(`${consecutiveNoShows} consecutive no-shows`);
    }
  }

  const lastModule = lastModuleResult.data;
  if (lastModule) {
    const daysSince = Math.floor((now - new Date(lastModule.created_at).getTime()) / 86400000);
    if (daysSince > thresholds.inactiveDaysModules) {
      riskScore += 20;
      riskFactors.push(`No module progress for ${daysSince} days`);
    }
  }

  const lastAccess = lastAccessResult.data;
  if (lastAccess) {
    const daysSince = Math.floor((now - new Date(lastAccess.created_at).getTime()) / 86400000);
    if (daysSince > thresholds.inactiveDaysLogin) {
      riskScore += 15;
      riskFactors.push(`No platform access for ${daysSince} days`);
    }
  }

  const lastPulse = lastPulseResult.data;
  if (lastPulse && lastPulse.satisfaction_score <= thresholds.pulsScoreThreshold) {
    riskScore += 15;
    riskFactors.push(`Low satisfaction score: ${lastPulse.satisfaction_score}/5`);
  }

  const failedPayments = failedPaymentsResult.data;
  if (failedPayments && failedPayments.length >= thresholds.paymentFailuresToCompound) {
    const recentFailures = failedPayments.filter(
      (row) => now - new Date(row.created_at).getTime() < 30 * 86400000,
    );
    if (recentFailures.length > 0) {
      riskScore += 15;
      riskFactors.push(`${recentFailures.length} payment failure(s) in last 30 days`);
    }
  }

  const lastComm = lastCommResult.data;
  if (lastComm && lastComm.length > 0) {
    const hasInbound = lastComm.some((row) => row.direction === 'inbound');
    const lastOutbound = lastComm.find((row) => row.direction === 'outbound');
    if (lastOutbound && !hasInbound) {
      const daysSince = Math.floor((now - new Date(lastOutbound.created_at).getTime()) / 86400000);
      if (daysSince > thresholds.inactiveDaysComms) {
        riskScore += 10;
        riskFactors.push(`No communication response for ${daysSince} days`);
      }
    }
  }

  const daysInactive = lastDate
    ? Math.floor((now - new Date(lastDate).getTime()) / 86400000)
    : 999;

  return {
    contactId,
    locationId,
    riskScore: Math.min(100, riskScore),
    riskFactors,
    daysInactive,
    flagged: riskScore >= 40,
  };
}

export const disengagementService = {
  /** Score a single client's engagement risk without side effects. */
  async scoreClient(locationId: string, contactId: string): Promise<RiskAssessment> {
    const merchant = await merchantRepository.getByLocationId(locationId);
    return scoreClientWithThresholds(locationId, contactId, resolveThresholds(merchant));
  },

  /** Score all evidence-bearing clients without changing GHL or evidence. */
  async scoreAllClients(locationId: string): Promise<RiskAssessment[]> {
    const supabase = getSupabase();
    const [contactsResult, merchant] = await Promise.all([
      supabase
        .from('evidence_timeline')
        .select('contact_id')
        .eq('location_id', locationId),
      merchantRepository.getByLocationId(locationId),
    ]);
    if (contactsResult.error) throw contactsResult.error;

    const contactIds = [...new Set(
      (contactsResult.data || []).map((row) => row.contact_id).filter(Boolean),
    )];
    const thresholds = resolveThresholds(merchant);
    const assessments: RiskAssessment[] = [];

    // Bound concurrency so larger locations cannot exhaust the database pool.
    for (let i = 0; i < contactIds.length; i += 10) {
      const batch = contactIds.slice(i, i + 10);
      assessments.push(...await Promise.all(
        batch.map((contactId) => scoreClientWithThresholds(locationId, contactId, thresholds)),
      ));
    }

    return assessments;
  },

  async getAtRiskClients(locationId: string): Promise<RiskAssessment[]> {
    const assessments = await this.scoreAllClients(locationId);
    return assessments.filter((assessment) => assessment.flagged);
  },

  /**
   * Run the explicit side-effecting disengagement check for a merchant.
   * Dashboard reads deliberately do not use this method.
   */
  async checkAllClients(locationId: string): Promise<RiskAssessment[]> {
    const [assessments, merchant] = await Promise.all([
      this.scoreAllClients(locationId),
      merchantRepository.getByLocationId(locationId),
    ]);
    const flaggedClients = assessments.filter((assessment) => assessment.flagged);
    const engagementEnabled = (merchant as any).engagement_enabled ?? true;

    if (engagementEnabled) {
      for (const assessment of flaggedClients) {
        const contactId = assessment.contactId;
        try {
          const { ghlApi: getApi } = require('../clients/ghl.client');
          const { SS_CONTACT_FIELDS: fields } = require('../constants/ghl-fields');
          const api = await getApi(locationId);
          await api.put(`/contacts/${contactId}`, {
            customField: { [fields.ENGAGEMENT_STATUS]: 'At Risk' },
          });
        } catch (err) {
          logger.warn({ err, contactId, locationId }, 'Unable to update at-risk contact field');
        }

        try {
          const { phase2EvidenceRepository } = require('../repositories/phase2Evidence.repository');
          await phase2EvidenceRepository.create({
            location_id: locationId,
            contact_id: contactId,
            evidence_type: 'custom_event',
            data: { event_type: 'disengagement_flagged', flagged_at: new Date().toISOString() },
          });
        } catch (err) {
          logger.warn({ err, contactId, locationId }, 'Unable to record at-risk evidence event');
        }
      }
    }

    logger.info(
      { locationId, totalChecked: assessments.length, flagged: flaggedClients.length },
      'Disengagement check complete',
    );
    return flaggedClients;
  },
};
