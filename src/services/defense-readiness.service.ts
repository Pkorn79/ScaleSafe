import type { DisputeScope } from './dispute-scope.service';
import type { ExhibitList } from './defense-exhibits.service';

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
  /** True when at least one red flag suggests accepting rather than fighting. */
  recommendAccept: boolean;
}

export const defenseReadinessService = {
  assess(
    category: string,
    exhibitList: ExhibitList,
    scope: DisputeScope,
  ): ReadinessAssessment {
    const missingEvidence: string[] = [];
    const redFlags: string[] = [];
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

    return {
      missingEvidence,
      redFlags,
      recommendAccept: redFlags.length > 0,
    };
  },
};
