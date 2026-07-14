import type { ExhibitList } from './defense-exhibits.service';

interface OfferMilestoneContext {
  milestones?: Array<{ name?: string; delivers?: string }>;
}

export interface DefenseClaimGuardResult {
  safe: boolean;
  violations: string[];
}

function claimsDeliveredService(letter: string): boolean {
  return [
    /\bservices? (?:were|was|have been|has been) (?:delivered|provided|fulfilled)\b/i,
    /\bwe (?:delivered|provided|fulfilled) (?:the )?(?:services?|program|work)\b/i,
    /\bour records (?:show|demonstrate|confirm)[^.\n]{0,120}\b(?:service|program|work)[^.\n]{0,40}\b(?:delivered|provided|fulfilled)\b/i,
    /\bservice delivery (?:was|is) (?:shown|demonstrated|established|confirmed)\b/i,
  ].some((pattern) => pattern.test(letter));
}

function overstatesAppointment(letter: string, offer?: OfferMilestoneContext | null): boolean {
  const hasCompoundPromise = (offer?.milestones || []).some((milestone) => {
    const delivers = String(milestone.delivers || '');
    return /\b(?:and|plus)\b|[,;]|written|document|plan|report|file|deliverable/i.test(delivers);
  });
  if (!hasCompoundPromise) return false;

  return [
    /\b(?:appointment|session)\b[^.!?\n]{0,220}\b(?:satisf(?:y|ies|ied)|fulfill(?:s|ed)?|complete(?:s|d)?|prove[sd]?)\b[^.!?\n]{0,220}\b(?:milestone|deliverable|written|plan|report)\b/i,
    /\b(?:milestone|deliverable|written|plan|report)\b[^.!?\n]{0,220}\b(?:satisf(?:y|ies|ied)|fulfill(?:s|ed)?|complete(?:s|d)?|prove[sd]?)\b[^.!?\n]{0,220}\b(?:appointment|session)\b/i,
  ].some((pattern) => pattern.test(letter));
}

export function evaluateDefenseDraftClaims(
  letter: string,
  exhibitList: ExhibitList,
  offer?: OfferMilestoneContext | null,
): DefenseClaimGuardResult {
  const violations: string[] = [];
  if (exhibitList.byCategory.service_delivery.length === 0 && claimsDeliveredService(letter)) {
    violations.push('The generated draft asserted service delivery even though no service-delivery exhibit exists.');
  }

  const deliverySources = new Set(exhibitList.byCategory.service_delivery.map((exhibit) => exhibit.source));
  if (deliverySources.size === 1 && deliverySources.has('evidence_appointments') && overstatesAppointment(letter, offer)) {
    violations.push('The generated draft expanded appointment attendance into proof of a compound milestone or separate deliverable.');
  }

  return { safe: violations.length === 0, violations };
}
