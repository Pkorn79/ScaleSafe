/**
 * Defense readiness tests: reason-code-specific missing-evidence checks and
 * "don't fight this" red flags. Fighting an indefensible dispute wastes the
 * fee and issuer credibility — these checks hold weak packets for review.
 */

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: jest.fn() }),
}));

import { defenseReadinessService } from '../../src/services/defense-readiness.service';
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
