import type { DisputeScope } from './dispute-scope.service';
import type { ExhibitList, ExhibitSourceError } from './defense-exhibits.service';

/**
 * Defense Readiness — reason-code-specific missing-evidence checks and
 * "don't fight this" red flags, run before a packet is finalized.
 *
 * Not every chargeback is winnable. A packet that fights a dispute the
 * evidence can't support (or that the merchant is plainly at fault for)
 * wastes the fee, burns issuer credibility, and still counts against the
 * dispute ratio. This module flags those cases so the packet is held for
 * review with an honest recommendation instead of shipping confident prose.
 */

export interface ReadinessAssessment {
  /** Evidence the reason code needs that is absent — packet held for review. */
  missingEvidence: string[];
  /** Facts that make the dispute likely indefensible — recommend accepting. */
  redFlags: string[];
  /** Facts that change HOW to fight (not whether) — e.g. a refund issued before
   *  the dispute means "credit already issued", not a delivery argument. Packet
   *  held for review so the merchant chooses the right strategy. */
  strategyFlags: string[];
  /** True when at least one red flag suggests accepting rather than fighting. */
  recommendAccept: boolean;
}

/** Optional dispute facts for cross-category checks (refund-before-dispute). */
export interface DisputeFacts {
  amount?: number | null;
  /** ISO date the chargeback was filed. */
  date?: string | null;
}

export const defenseReadinessService = {
  assess(
    category: string,
    exhibitList: ExhibitList,
    scope: DisputeScope,
    dispute?: DisputeFacts,
  ): ReadinessAssessment {
    const missingEvidence: string[] = [];
    const redFlags: string[] = [];
    const strategyFlags: string[] = [];
    const by = exhibitList.byCategory;

    switch (category) {
      case 'fraud':
      case 'authorization':
        if (by.consent.length === 0) {
          redFlags.push(
            'No consent/enrollment forensics on file (IP address, device, timestamp, signature). '
            + 'Fraud and authorization disputes turn on exactly this evidence — without it the response is unlikely to succeed. '
            + 'Consider accepting unless consent records can be located.',
          );
        }
        break;

      case 'services_not_provided':
        if (by.service_delivery.length === 0) {
          redFlags.push(
            'No service delivery evidence on file (sessions, milestones, module completions, access logs). '
            + 'A "services not provided" dispute cannot be rebutted without delivery proof — '
            + 'consider accepting, or capture the missing delivery evidence before submitting.',
          );
        }
        break;

      case 'not_as_described':
      case 'misrepresentation':
        if (by.consent.length === 0) {
          missingEvidence.push(
            'No accepted terms/consent record on file. This dispute type is rebutted by comparing '
            + 'what the cardholder agreed to against what was delivered — without the accepted terms the argument has no anchor.',
          );
        }
        break;

      case 'credit_not_processed':
        if (by.consent.length === 0) {
          missingEvidence.push(
            'No accepted terms on file — the refund policy the cardholder agreed to is the core of this defense.',
          );
        }
        break;

      case 'canceled_recurring':
      case 'canceled_services': {
        if (by.consent.length === 0) {
          missingEvidence.push(
            'No accepted terms on file — express consent to the billing arrangement and the cancellation policy are required for this dispute type.',
          );
        }
        // Billed after a received cancellation request is the canonical
        // indefensible case. Compare the earliest cancellation record against
        // the disputed charge date when both are known.
        const cancellations = by.termination.filter(
          (ex) => ex.source === 'evidence_cancellation' && ex.occurredAt,
        );
        if (cancellations.length && scope.transactionDate) {
          const chargeTime = new Date(scope.transactionDate).getTime();
          const earliest = cancellations
            .map((ex) => new Date(ex.occurredAt as string).getTime())
            .filter((t) => Number.isFinite(t))
            .sort((a, b) => a - b)[0];
          if (earliest !== undefined && earliest < chargeTime) {
            redFlags.push(
              `A cancellation record dated ${new Date(earliest).toISOString().slice(0, 10)} predates the disputed charge `
              + `(${new Date(chargeTime).toISOString().slice(0, 10)}). Billing after a received cancellation request is `
              + 'generally indefensible — strongly consider refunding/accepting this dispute instead of fighting it.',
            );
          }
        }
        break;
      }

      case 'duplicate_processing':
        if (by.payments.length === 0) {
          missingEvidence.push(
            'No payment records on file to distinguish the disputed charges — duplicate-processing disputes are decided on transaction records alone.',
          );
        }
        break;

      default:
        // Unknown/general category: no code-specific checks; the unknown-code
        // path already forces needs_review.
        break;
    }

    // ── Cross-category: refund issued BEFORE the dispute was filed ──
    // If the merchant refunded (especially the disputed amount) before the
    // chargeback existed, the right response is "credit already issued / no
    // second recovery", NOT a delivery argument — and the claim needs a
    // processor refund record, not a merchant email
    // (docs/CHARGEBACK_DEFENSE_OPTIMIZATION_RESEARCH.md: refund claimed
    // without the transaction record is a known killer).
    if (dispute?.date) {
      const disputeTime = new Date(dispute.date).getTime();
      if (Number.isFinite(disputeTime)) {
        const before = (occurredAt: string | null) => {
          if (!occurredAt) return false;
          const t = new Date(occurredAt).getTime();
          return Number.isFinite(t) && t < disputeTime;
        };
        const amountText = dispute.amount != null ? ` of the disputed $${Number(dispute.amount).toFixed(2)}` : '';
        const refundRecords = by.termination.filter(
          (ex) => ex.source === 'evidence_refund_activity' && before(ex.occurredAt),
        );
        const refundComms = by.communication.filter(
          (ex) => before(ex.occurredAt) && /refund/i.test(`${ex.name} ${ex.summary}`),
        );
        if (refundRecords.length) {
          strategyFlags.push(
            `A refund record predates this dispute (${refundRecords[0].occurredAt?.slice(0, 10)}). If the refund covers`
            + `${amountText || ' the disputed amount'}, respond as "credit already issued" with the processor refund record attached — `
            + 'not as a service-delivery argument — and request that no second recovery of the same funds occur.',
          );
        } else if (refundComms.length) {
          strategyFlags.push(
            `A refund communication predates this dispute (${refundComms[0].occurredAt?.slice(0, 10)}). Verify with your processor `
            + `whether a refund${amountText} was actually processed. If it was, respond as "credit already issued" and attach the `
            + 'processor refund record — a merchant email alone is weak proof of a refund.',
          );
        }
      }
    }

    return {
      missingEvidence,
      redFlags,
      strategyFlags,
      recommendAccept: redFlags.length > 0,
    };
  },
};

/**
 * Single source of truth for whether a packet is presentable as `complete` and
 * what the merchant-facing review reasons are. Used by initial compilation AND
 * successful regeneration (which must clear stale reasons like "AI draft was
 * unavailable" while preserving reasons that still apply).
 */
export function evaluateReviewState(opts: {
  usedFallback: boolean;
  scope: DisputeScope;
  unknownReasonCode: boolean;
  readiness: ReadinessAssessment;
  sourceErrors: ExhibitSourceError[];
  reasonCode: string;
}): { needsReview: boolean; reviewReasons: string[] } {
  const { usedFallback, scope, unknownReasonCode, readiness, sourceErrors, reasonCode } = opts;
  const needsReview = usedFallback
    || scope.scopeConfidence === 'contact_only'
    || unknownReasonCode
    || readiness.redFlags.length > 0
    || readiness.strategyFlags.length > 0
    || readiness.missingEvidence.length > 0
    || sourceErrors.length > 0;

  const reviewReasons: string[] = [];
  if (readiness.recommendAccept) reviewReasons.push('RECOMMENDATION: consider accepting this dispute rather than fighting it.');
  if (readiness.redFlags.length) reviewReasons.push(...readiness.redFlags);
  if (readiness.strategyFlags.length) reviewReasons.push(...readiness.strategyFlags);
  if (readiness.missingEvidence.length) reviewReasons.push(...readiness.missingEvidence);
  if (usedFallback) reviewReasons.push('AI draft was unavailable; a structured fallback letter was generated.');
  if (scope.scopeConfidence === 'contact_only') reviewReasons.push('The disputed transaction could not be tied to a specific program; evidence is contact-wide.');
  if (unknownReasonCode) reviewReasons.push(`Reason code "${reasonCode}" is not recognized; the letter uses a generic strategy and must be reviewed against the network's actual requirements for this code.`);
  if (sourceErrors.length) reviewReasons.push('Some evidence sources could not be read while assembling this packet, so the exhibit list may be incomplete.');
  if (scope.gaps.length) reviewReasons.push(...scope.gaps);

  return { needsReview, reviewReasons };
}
