import { EVIDENCE_TYPES, EvidenceType } from '../constants/evidence-types';

export type AttendanceOutcome = 'attended' | 'no_show' | 'cancelled' | 'rescheduled' | null;

function explicitBoolean(value: unknown): boolean | null {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  if (typeof value !== 'string') return null;
  switch (value.trim().toLowerCase()) {
    case 'true': case 'yes': case '1': return true;
    case 'false': case 'no': case '0': return false;
    default: return null;
  }
}

/** Missing, conflicting, and unrecognized answers are not proof of attendance. */
export function attendanceOutcome(data: Record<string, unknown>): AttendanceOutcome {
  const rawStatus = data.attendance_status ?? data.appointment_status ?? data.status;
  if (rawStatus != null && typeof rawStatus !== 'string') return null;
  const status = typeof rawStatus === 'string' ? rawStatus.trim().toLowerCase().replace(/[ -]/g, '_') : '';
  const noShow = explicitBoolean(data.no_show);
  let outcome: AttendanceOutcome = null;
  if (['attended', 'present', 'showed', 'completed'].includes(status)) outcome = 'attended';
  else if (['no_show', 'noshow', 'absent'].includes(status)) outcome = 'no_show';
  else if (['cancelled', 'canceled', 'deleted'].includes(status)) outcome = 'cancelled';
  else if (status === 'rescheduled') outcome = 'rescheduled';

  if (status) {
    if ((outcome === 'attended' && noShow === true) || (outcome === 'no_show' && noShow === false)) return null;
    return outcome;
  }
  return noShow === true ? 'no_show' : noShow === false ? 'attended' : null;
}

export function isParticipationEvidence(type: EvidenceType, data: Record<string, unknown>): boolean {
  const sessionTypes: readonly EvidenceType[] = [
    EVIDENCE_TYPES.SESSION_DELIVERY, EVIDENCE_TYPES.SESSION_ATTENDANCE, EVIDENCE_TYPES.APPOINTMENT,
  ];
  if (sessionTypes.includes(type)) {
    return attendanceOutcome(data) === 'attended';
  }
  if (type === EVIDENCE_TYPES.EXTERNAL_SESSION) {
    // Legacy completed sessions and canonical connectors carry the event's proof role.
    if (data.status != null || data.attendance_status != null || data.no_show != null) {
      return attendanceOutcome(data) === 'attended';
    }
    return data.proof_role === 'service_delivery';
  }
  const participationTypes: readonly EvidenceType[] = [
    EVIDENCE_TYPES.MODULE_COMPLETION, EVIDENCE_TYPES.PULSE_CHECKIN,
    EVIDENCE_TYPES.MILESTONE_COMPLETION, EVIDENCE_TYPES.SERVICE_ACCESS,
    EVIDENCE_TYPES.COURSE_COMPLETION, EVIDENCE_TYPES.ASSIGNMENT_SUBMISSION,
  ];
  return participationTypes.includes(type);
}
