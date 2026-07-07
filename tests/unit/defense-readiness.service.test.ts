/**
 * Defense readiness tests: reason-code-specific missing-evidence checks and
 * "don't fight this" red flags. Fighting an indefensible dispute wastes the
 * fee and issuer credibility — these checks hold weak packets for review.
 */

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: jest.fn() }),
}));

import { defenseReadinessService, evaluateReviewState } from '../../src/services/defense-readiness.service';
import type { ExhibitList, ExhibitEntry } from '../../src/services/defense-exhibits.service';

function exhibit(overrides: Partial<ExhibitEntry>): ExhibitEntry {
  return {
    letter: 'A',
    name: 'Exhibit',
    category: 'consent',
    source: 'evidence_consent',
    ref: 'r1',
    occurredAt: '2026-01-15',
    summary: 'summary',
    ...overrides,
  } as ExhibitEntry;
}

function exhibitList(byCategory: Partial<ExhibitList['byCategory']>): ExhibitList {
  const by = {
    consent: [],
    service_delivery: [],
    communication: [],
    payments: [],
    termination: [],
    ...byCategory,
  } as ExhibitList['byCategory'];
  return {
    exhibits: Object.values(by).flat(),
    byCategory: by,
    totals: {
      consent: by.consent.length,
      serviceDelivery: by.service_delivery.length,
      communication: by.communication.length,
      payments: by.payments.length,
      termination: by.termination.length,
    },
    enrollmentPacketPath: null as any,
    sourceErrors: [],
  };
}

function scope(overrides: Record<string, any> = {}): any {
  return {
    paymentEventId: null,
    processorTransactionId: null,
    transactionDate: null,
    processor: null,
    enrollmentId: 'enr_1',
    offerId: null,
    offerName: null,
    enrollmentStart: null,
    enrollmentEnd: null,
    scopeConfidence: 'exact',
    gaps: [],
    ...overrides,
  };
}

describe('defenseReadinessService.assess', () => {
  test('services_not_provided with zero delivery evidence → red flag, recommend accept', () => {
    const result = defenseReadinessService.assess(
      'services_not_provided',
      exhibitList({ consent: [exhibit({})] }),
      scope(),
    );
    expect(result.redFlags.length).toBe(1);
    expect(result.recommendAccept).toBe(true);
    expect(result.redFlags[0]).toContain('No service delivery evidence');
  });

  test('services_not_provided with delivery evidence → clean', () => {
    const result = defenseReadinessService.assess(
      'services_not_provided',
      exhibitList({ service_delivery: [exhibit({ category: 'service_delivery', source: 'evidence_milestones' })] }),
      scope(),
    );
    expect(result.redFlags).toEqual([]);
    expect(result.missingEvidence).toEqual([]);
    expect(result.recommendAccept).toBe(false);
  });

  test('fraud with no consent forensics → red flag', () => {
    const result = defenseReadinessService.assess('fraud', exhibitList({}), scope());
    expect(result.recommendAccept).toBe(true);
    expect(result.redFlags[0]).toContain('consent/enrollment forensics');
  });

  test('canceled_recurring billed AFTER cancellation request → indefensible red flag', () => {
    const cancellation = exhibit({
      category: 'termination',
      source: 'evidence_cancellation',
      occurredAt: '2026-02-01',
    });
    const result = defenseReadinessService.assess(
      'canceled_recurring',
      exhibitList({ consent: [exhibit({})], termination: [cancellation] }),
      scope({ transactionDate: '2026-03-01' }),
    );
    expect(result.recommendAccept).toBe(true);
    expect(result.redFlags[0]).toContain('predates the disputed charge');
    expect(result.redFlags[0]).toContain('indefensible');
  });

  test('canceled_recurring where the charge PRECEDES the cancellation → defensible, no red flag', () => {
    const cancellation = exhibit({
      category: 'termination',
      source: 'evidence_cancellation',
      occurredAt: '2026-03-15',
    });
    const result = defenseReadinessService.assess(
      'canceled_recurring',
      exhibitList({ consent: [exhibit({})], termination: [cancellation] }),
      scope({ transactionDate: '2026-03-01' }),
    );
    expect(result.redFlags).toEqual([]);
    expect(result.recommendAccept).toBe(false);
  });

  test('not_as_described without accepted terms → missing evidence (review, not accept)', () => {
    const result = defenseReadinessService.assess('not_as_described', exhibitList({}), scope());
    expect(result.missingEvidence.length).toBe(1);
    expect(result.recommendAccept).toBe(false);
  });

  test('duplicate_processing without payment records → missing evidence', () => {
    const result = defenseReadinessService.assess('duplicate_processing', exhibitList({}), scope());
    expect(result.missingEvidence[0]).toContain('payment records');
  });

  test('general/unknown category has no code-specific checks', () => {
    const result = defenseReadinessService.assess('general', exhibitList({}), scope());
    expect(result.missingEvidence).toEqual([]);
    expect(result.redFlags).toEqual([]);
  });
});

describe('refund-before-dispute strategy flag', () => {
  const delivery = exhibit({ category: 'service_delivery', source: 'evidence_milestones' });

  test('refund RECORD predating the dispute → credit-already-issued strategy flag (not recommendAccept)', () => {
    const result = defenseReadinessService.assess(
      'services_not_provided',
      exhibitList({
        service_delivery: [delivery],
        termination: [exhibit({ category: 'termination', source: 'evidence_refund_activity', occurredAt: '2026-06-03' })],
      }),
      scope(),
      { amount: 0.5, date: '2026-07-02' },
    );
    expect(result.strategyFlags).toHaveLength(1);
    expect(result.strategyFlags[0]).toContain('credit already issued');
    expect(result.strategyFlags[0]).toContain('$0.50');
    expect(result.recommendAccept).toBe(false);
  });

  test('refund record AFTER the dispute date → no flag', () => {
    const result = defenseReadinessService.assess(
      'services_not_provided',
      exhibitList({
        service_delivery: [delivery],
        termination: [exhibit({ category: 'termination', source: 'evidence_refund_activity', occurredAt: '2026-07-10' })],
      }),
      scope(),
      { amount: 0.5, date: '2026-07-02' },
    );
    expect(result.strategyFlags).toEqual([]);
  });

  test('refund COMMUNICATION (no processor record) predating the dispute → verify-with-processor flag', () => {
    const result = defenseReadinessService.assess(
      'services_not_provided',
      exhibitList({
        service_delivery: [delivery],
        communication: [exhibit({
          category: 'communication', source: 'evidence_communication',
          name: 'Communication: To client (Email)',
          summary: 'Outbound Email. Refund communication: This confirms that a refund has been processed. Refund amount: $0.50',
          occurredAt: '2026-06-03',
        })],
      }),
      scope(),
      { amount: 0.5, date: '2026-07-02' },
    );
    expect(result.strategyFlags).toHaveLength(1);
    expect(result.strategyFlags[0]).toContain('Verify with your processor');
    expect(result.strategyFlags[0]).toContain('merchant email alone is weak proof');
  });

  test('no dispute date supplied → no refund check runs', () => {
    const result = defenseReadinessService.assess(
      'services_not_provided',
      exhibitList({
        service_delivery: [delivery],
        termination: [exhibit({ category: 'termination', source: 'evidence_refund_activity', occurredAt: '2026-06-03' })],
      }),
      scope(),
    );
    expect(result.strategyFlags).toEqual([]);
  });
});

describe('evaluateReviewState', () => {
  const cleanReadiness = { missingEvidence: [], redFlags: [], strategyFlags: [], recommendAccept: false };

  test('clean state → complete-eligible with no reasons', () => {
    const { needsReview, reviewReasons } = evaluateReviewState({
      usedFallback: false, scope: scope(), unknownReasonCode: false,
      readiness: cleanReadiness, sourceErrors: [], reasonCode: '4855',
    });
    expect(needsReview).toBe(false);
    expect(reviewReasons).toEqual([]);
  });

  test('strategy flags force needs_review and appear in reasons', () => {
    const { needsReview, reviewReasons } = evaluateReviewState({
      usedFallback: false, scope: scope(), unknownReasonCode: false,
      readiness: { ...cleanReadiness, strategyFlags: ['A refund record predates this dispute.'] },
      sourceErrors: [], reasonCode: '4855',
    });
    expect(needsReview).toBe(true);
    expect(reviewReasons.join(' ')).toContain('refund record predates');
  });

  test('fallback reason appears only when usedFallback', () => {
    const withFallback = evaluateReviewState({
      usedFallback: true, scope: scope(), unknownReasonCode: false,
      readiness: cleanReadiness, sourceErrors: [], reasonCode: '4855',
    });
    expect(withFallback.needsReview).toBe(true);
    expect(withFallback.reviewReasons.join(' ')).toContain('AI draft was unavailable');

    const without = evaluateReviewState({
      usedFallback: false, scope: scope(), unknownReasonCode: false,
      readiness: cleanReadiness, sourceErrors: [], reasonCode: '4855',
    });
    expect(without.reviewReasons.join(' ')).not.toContain('AI draft was unavailable');
  });
});
