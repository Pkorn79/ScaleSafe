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

const AT_RISK_CACHE_TTL_MS = 5 * 60 * 1000;
const RISK_LOOKBACK_DAYS = 180;
const BULK_EVIDENCE_LIMIT = 20_000;
const atRiskCache = new Map<string, { expiresAt: number; clients: RiskAssessment[] }>();
const atRiskInflight = new Map<string, Promise<RiskAssessment[]>>();

function cacheAtRiskClients(locationId: string, clients: RiskAssessment[]): void {
  atRiskCache.set(locationId, {
    expiresAt: Date.now() + AT_RISK_CACHE_TTL_MS,
    clients,
  });
}

function resolveThresholds(merchant: any): DisengagementThresholds {
  return {
    ...DEFAULT_THRESHOLDS,
    ...((merchant?.config?.disengagement_thresholds as Record<string, number> | undefined) || {}),
  };
}

interface RiskEvidenceRow {
  contact_id: string;
  type: string;
  created_at: string;
  data?: Record<string, any> | null;
}

function scoreClientFromRows(
  locationId: string,
  contactId: string,
  rows: RiskEvidenceRow[],
  thresholds: DisengagementThresholds,
  latestSupplementalDate: string | null,
  now = Date.now(),
): RiskAssessment {
  const riskFactors: string[] = [];
  let riskScore = 0;
  const byType = (type: string) => rows.filter((row) => row.type === type);

  const attendance = byType('attendance').slice(0, 5);
  let consecutiveNoShows = 0;
  for (const row of attendance) {
    if (row.data?.status === 'no_show') consecutiveNoShows += 1;
    else break;
  }
  if (consecutiveNoShows >= thresholds.missedSessionsToFlag) {
    riskScore += 25;
    riskFactors.push(`${consecutiveNoShows} consecutive no-shows`);
  }

  const lastModule = byType('module')[0];
  if (lastModule) {
    const daysSince = Math.floor((now - new Date(lastModule.created_at).getTime()) / 86400000);
    if (daysSince > thresholds.inactiveDaysModules) {
      riskScore += 20;
      riskFactors.push(`No module progress for ${daysSince} days`);
    }
  }

  const lastAccess = byType('service_access')[0];
  if (lastAccess) {
    const daysSince = Math.floor((now - new Date(lastAccess.created_at).getTime()) / 86400000);
    if (daysSince > thresholds.inactiveDaysLogin) {
      riskScore += 15;
      riskFactors.push(`No platform access for ${daysSince} days`);
    }
  }

  const lastPulse = byType('pulse_checkin')[0];
  const pulseScore = Number(lastPulse?.data?.satisfaction_score);
  if (lastPulse && Number.isFinite(pulseScore) && pulseScore <= thresholds.pulsScoreThreshold) {
    riskScore += 15;
    riskFactors.push(`Low satisfaction score: ${pulseScore}/5`);
  }

  const recentFailures = byType('failed_payment').filter(
    (row) => now - new Date(row.created_at).getTime() < 30 * 86400000,
  );
  if (recentFailures.length >= thresholds.paymentFailuresToCompound) {
    riskScore += 15;
    riskFactors.push(`${recentFailures.length} payment failure(s) in last 30 days`);
  }

  const communications = byType('communication').slice(0, 10);
  const hasInbound = communications.some((row) => row.data?.direction === 'inbound');
  const lastOutbound = communications.find((row) => row.data?.direction === 'outbound');
  if (lastOutbound && !hasInbound) {
    const daysSince = Math.floor((now - new Date(lastOutbound.created_at).getTime()) / 86400000);
    if (daysSince > thresholds.inactiveDaysComms) {
      riskScore += 10;
      riskFactors.push(`No communication response for ${daysSince} days`);
    }
  }

  const latestDates = rows.map((row) => row.created_at).filter(Boolean);
  if (latestSupplementalDate) latestDates.push(latestSupplementalDate);
  const latest = latestDates.sort().pop() || null;
  const daysInactive = latest
    ? Math.max(0, Math.floor((now - new Date(latest).getTime()) / 86400000))
    : RISK_LOOKBACK_DAYS + 1;

  return {
    contactId,
    locationId,
    riskScore: Math.min(100, riskScore),
    riskFactors,
    daysInactive,
    flagged: riskScore >= 40,
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
    const cutoff = new Date(Date.now() - RISK_LOOKBACK_DAYS * 86400000).toISOString();
    const [clientsResult, timelineResult, genericResult, appointmentResult, invoiceResult, merchant] = await Promise.all([
      supabase
        .from('client_list_view')
        .select('contact_id, status')
        .eq('location_id', locationId)
        .in('status', ['enrolled', 'active', 'consent_captured', 'device_captured', 'paid_pending_enrollment', 'paused', 'manual_add']),
      supabase
        .from('evidence_timeline')
        .select('contact_id, type, created_at, data')
        .eq('location_id', locationId)
        .gte('created_at', cutoff)
        .order('created_at', { ascending: false })
        .limit(BULK_EVIDENCE_LIMIT),
      supabase
        .from('evidence')
        .select('contact_id, created_at')
        .eq('location_id', locationId)
        .gte('created_at', cutoff)
        .order('created_at', { ascending: false })
        .limit(BULK_EVIDENCE_LIMIT),
      supabase
        .from('evidence_appointments')
        .select('contact_id, created_at')
        .eq('location_id', locationId)
        .gte('created_at', cutoff)
        .order('created_at', { ascending: false })
        .limit(BULK_EVIDENCE_LIMIT),
      supabase
        .from('evidence_invoices')
        .select('contact_id, created_at')
        .eq('location_id', locationId)
        .gte('created_at', cutoff)
        .order('created_at', { ascending: false })
        .limit(BULK_EVIDENCE_LIMIT),
      merchantRepository.getByLocationId(locationId),
    ]);
    for (const result of [clientsResult, timelineResult, genericResult, appointmentResult, invoiceResult]) {
      if (result.error) throw result.error;
    }

    const contactIds = [...new Set(
      (clientsResult.data || []).map((row) => row.contact_id).filter(Boolean),
    )];
    const thresholds = resolveThresholds(merchant);
    const rowsByContact = new Map<string, RiskEvidenceRow[]>();
    for (const row of (timelineResult.data || []) as RiskEvidenceRow[]) {
      if (!row.contact_id) continue;
      const rows = rowsByContact.get(row.contact_id) || [];
      rows.push(row);
      rowsByContact.set(row.contact_id, rows);
    }
    const supplementalLatest = new Map<string, string>();
    for (const row of [
      ...(genericResult.data || []),
      ...(appointmentResult.data || []),
      ...(invoiceResult.data || []),
    ] as Array<{ contact_id?: string; created_at?: string }>) {
      if (!row.contact_id || !row.created_at) continue;
      const current = supplementalLatest.get(row.contact_id);
      if (!current || row.created_at > current) supplementalLatest.set(row.contact_id, row.created_at);
    }
    if ((timelineResult.data || []).length === BULK_EVIDENCE_LIMIT) {
      logger.warn({ locationId, limit: BULK_EVIDENCE_LIMIT }, 'At-risk bulk evidence window reached its safety limit');
    }

    return contactIds.map((contactId) => scoreClientFromRows(
      locationId,
      contactId,
      rowsByContact.get(contactId) || [],
      thresholds,
      supplementalLatest.get(contactId) || null,
    ));
  },

  async getAtRiskClients(locationId: string): Promise<RiskAssessment[]> {
    const cached = atRiskCache.get(locationId);
    if (cached && cached.expiresAt > Date.now()) return cached.clients;

    const existing = atRiskInflight.get(locationId);
    if (existing) return existing;

    const scan = this.scoreAllClients(locationId)
      .then((assessments) => assessments.filter((assessment) => assessment.flagged))
      .then((clients) => {
        cacheAtRiskClients(locationId, clients);
        return clients;
      })
      .finally(() => {
        atRiskInflight.delete(locationId);
      });
    atRiskInflight.set(locationId, scan);
    return scan;
  },

  /** Clear a location's read cache after an explicit operator action or test. */
  invalidateAtRiskCache(locationId: string): void {
    atRiskCache.delete(locationId);
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

    cacheAtRiskClients(locationId, flaggedClients);

    logger.info(
      { locationId, totalChecked: assessments.length, flagged: flaggedClients.length },
      'Disengagement check complete',
    );
    return flaggedClients;
  },
};
