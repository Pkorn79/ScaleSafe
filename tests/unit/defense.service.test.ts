/**
 * Defense service tests.
 * Tests reason code mapping, prompt building, and compilation flow.
 */

import type { ExhibitList } from '../../src/services/defense-exhibits.service';

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: jest.fn().mockReturnValue({ insert: jest.fn().mockReturnValue({ error: null }) }) }),
}));

jest.mock('../../src/clients/ghl.client', () => ({
  ghlApi: jest.fn().mockResolvedValue({
    get: jest.fn().mockResolvedValue({ data: { contact: { firstName: 'John', lastName: 'Doe', email: 'john@test.com' } } }),
    put: jest.fn().mockResolvedValue({ data: {} }),
  }),
}));

jest.mock('../../src/clients/anthropic.client', () => ({
  callClaude: jest.fn().mockResolvedValue({
    text: 'Defense letter content here',
    inputTokens: 1000,
    outputTokens: 2000,
  }),
}));

jest.mock('../../src/repositories/defense.repository', () => ({
  defenseRepository: {
    create: jest.fn().mockResolvedValue({ id: 'def_1', location_id: 'loc_1', contact_id: 'c_1' }),
    getById: jest.fn().mockResolvedValue({ id: 'def_1', status: 'complete', dispute_amount: 5000, location_id: 'loc_1', contact_id: 'c_1', enrollment_id: 'enr_1' }),
    updateStatus: jest.fn().mockResolvedValue(undefined),
    getReasonCodeStrategy: jest.fn().mockResolvedValue(null),
    getDefenseTemplate: jest.fn().mockResolvedValue(null),
    recordOutcome: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../src/repositories/evidence.repository', () => ({
  evidenceRepository: {
    getFullSnapshot: jest.fn().mockResolvedValue([
      { evidence_type: 'consent', event_date: '2026-01-15', summary: 'T&C accepted' },
      { evidence_type: 'session_delivery', event_date: '2026-02-01', summary: 'Session 1 delivered' },
      { evidence_type: 'payment_confirmation', event_date: '2026-02-15', summary: 'Payment received $500' },
    ]),
    getLastEvidenceDate: jest.fn().mockResolvedValue('2026-03-20'),
    getCounts: jest.fn().mockResolvedValue({}),
  },
}));

const consentExhibit = {
  letter: 'A',
  name: 'Signed Enrollment Packet',
  category: 'consent' as const,
  source: 'enrollment_packet_pdf' as const,
  ref: 'packets/enrollment.pdf',
  occurredAt: '2026-01-15',
  summary: 'T&C accepted',
};

const deliveryExhibit = {
  letter: 'B',
  name: 'Milestone 1: Setup',
  category: 'service_delivery' as const,
  source: 'evidence_milestones' as const,
  ref: 'ms_1',
  occurredAt: '2026-02-01',
  summary: 'Milestone 1 completed',
};

const mockExhibitList: ExhibitList = {
  exhibits: [consentExhibit, deliveryExhibit],
  byCategory: {
    consent: [consentExhibit],
    service_delivery: [deliveryExhibit],
    communication: [],
    payments: [],
    termination: [],
  },
  totals: {
    consent: 1,
    serviceDelivery: 1,
    communication: 0,
    payments: 0,
    termination: 0,
  },
  enrollmentPacketPath: 'packets/enrollment.pdf',
};

jest.mock('../../src/services/defense-exhibits.service', () => {
  // Keep the real pure helpers (normalizeEvidencePriorities, buildTimelineRows,
  // sortExhibitsByPriority) — only the DB-backed exhibit builder is mocked.
  const actual = jest.requireActual('../../src/services/defense-exhibits.service');
  return {
    ...actual,
    defenseExhibitsService: {
      buildExhibitList: jest.fn().mockResolvedValue(mockExhibitList),
    },
  };
});

const mockBundleDefensePdf = jest.fn().mockResolvedValue('https://files.test/defense.pdf');
jest.mock('../../src/services/defense-bundle.service', () => ({
  defenseBundleService: {
    bundleDefensePdf: (...args: any[]) => mockBundleDefensePdf(...args),
  },
}));

jest.mock('../../src/repositories/merchant.repository', () => ({
  merchantRepository: {
    getByLocationId: jest.fn().mockResolvedValue({
      location_id: 'loc_1',
      business_name: 'Test Business',
      config: {},
      trigger_ids: {},
    }),
  },
}));

jest.mock('../../src/services/payment.service', () => ({
  paymentService: {
    getUndisputedPayments: jest.fn().mockResolvedValue([
      { amount: 500, payment_date: '2026-01-15' },
      { amount: 500, payment_date: '2026-02-15' },
    ]),
  },
}));

const mockResolveDisputeScope = jest.fn();
jest.mock('../../src/services/dispute-scope.service', () => ({
  disputeScopeService: {
    resolveDisputeScope: (...args: any[]) => mockResolveDisputeScope(...args),
  },
}));

function exactScope(overrides: Record<string, any> = {}) {
  return {
    paymentEventId: null,
    processorTransactionId: null,
    transactionDate: null,
    processor: null,
    enrollmentId: 'enr_1',
    offerId: 'offer_1',
    offerName: 'Test Program',
    enrollmentStart: '2026-01-10',
    enrollmentEnd: null,
    scopeConfidence: 'exact',
    gaps: [],
    ...overrides,
  };
}

const mockFireTrigger = jest.fn().mockResolvedValue({ sent: 1, failed: 0 });
jest.mock('../../src/services/trigger.service', () => ({
  triggerService: {
    fireTrigger: (...args: any[]) => mockFireTrigger(...args),
  },
}));

jest.mock('../../src/services/notification.service', () => ({
  notificationService: {
    fireChargebackDetected: jest.fn(),
    fireDefenseReady: jest.fn(),
  },
}));

import { defenseService } from '../../src/services/defense.service';
import { defenseRepository } from '../../src/repositories/defense.repository';
import { callClaude } from '../../src/clients/anthropic.client';
import { defenseExhibitsService } from '../../src/services/defense-exhibits.service';

beforeEach(() => {
  jest.clearAllMocks();
  mockResolveDisputeScope.mockResolvedValue(exactScope());
});

describe('Defense Service - Reason Code Mapping', () => {
  test('Visa 10.4 maps to fraud category', async () => {
    await defenseService.compileDefense({
      locationId: 'loc_1', contactId: 'c_1',
      reasonCode: '10.4', disputeAmount: 5000,
      disputeDate: '2026-03-20', deadline: '2026-04-10',
    });

    expect(defenseRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ reason_code_category: 'fraud' }),
    );
  });

  test('Visa 13.1 maps to services_not_provided', async () => {
    await defenseService.compileDefense({
      locationId: 'loc_1', contactId: 'c_1',
      reasonCode: '13.1', disputeAmount: 3000,
      disputeDate: '2026-03-20', deadline: '2026-04-10',
    });

    expect(defenseRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ reason_code_category: 'services_not_provided' }),
    );
  });

  test('Visa 13.3 maps to not_as_described', async () => {
    await defenseService.compileDefense({
      locationId: 'loc_1', contactId: 'c_1',
      reasonCode: '13.3', disputeAmount: 7500,
      disputeDate: '2026-03-20', deadline: '2026-04-10',
    });

    expect(defenseRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ reason_code_category: 'not_as_described' }),
    );
  });

  test('MC 4837 maps to fraud', async () => {
    await defenseService.compileDefense({
      locationId: 'loc_1', contactId: 'c_1',
      reasonCode: '4837', disputeAmount: 5000,
      disputeDate: '2026-03-20', deadline: '2026-04-10',
    });

    expect(defenseRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ reason_code_category: 'fraud' }),
    );
  });

  test('Unknown reason code maps to general category, never services_not_provided', async () => {
    await defenseService.compileDefense({
      locationId: 'loc_1', contactId: 'c_1',
      reasonCode: '99.99', disputeAmount: 5000,
      disputeDate: '2026-03-20', deadline: '2026-04-10',
    });

    expect(defenseRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ reason_code_category: 'general' }),
    );
  });

  test('New registry codes resolve: Visa 13.2, MC 4841, Amex C28, Discover AP → canceled_recurring', async () => {
    for (const code of ['13.2', '4841', 'C28', 'AP']) {
      (defenseRepository.create as jest.Mock).mockClear();
      await defenseService.compileDefense({
        locationId: 'loc_1', contactId: 'c_1',
        reasonCode: code, disputeAmount: 5000,
        disputeDate: '2026-03-20', deadline: '2026-04-10',
      });
      expect(defenseRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ reason_code_category: 'canceled_recurring' }),
      );
    }
  });
});

describe('Defense Service - Prompt Building', () => {
  test('system prompt includes category-specific strategy', () => {
    const prompt = defenseService.buildSystemPrompt('fraud', null, null);
    expect(prompt).toContain('fraud');
    expect(prompt).toContain('IP');
    expect(prompt).toContain('device fingerprint');
  });

  test('system prompt includes Prior Undisputed Transactions instruction', () => {
    const prompt = defenseService.buildSystemPrompt('services_not_provided', null, null);
    expect(prompt).toContain('Prior Undisputed Transactions');
  });

  test('user message includes evidence and prior payments for fraud disputes', () => {
    const msg = defenseService.buildUserMessage(
      { locationId: 'loc_1', contactId: 'c_1', reasonCode: '10.4', disputeAmount: 5000, disputeDate: '2026-03-20', deadline: '2026-04-10' },
      { firstName: 'John', lastName: 'Doe', email: 'john@test.com' },
      { business_name: 'Test Biz' },
      mockExhibitList,
      [{ amount: 500, payment_date: '2026-01-15' }],
      'fraud',
    );

    expect(msg).toContain('10.4');
    expect(msg).toContain('$5000');
    expect(msg).toContain('John');
    expect(msg).toContain('CONSENT EVIDENCE');
    expect(msg).toContain('Exhibit A');
    expect(msg).toContain('PRIOR UNDISPUTED TRANSACTIONS');
    expect(msg).toContain('$500');
  });

  test('prior payments are OMITTED for non-fraud/non-recurring dispute types', () => {
    const msg = defenseService.buildUserMessage(
      { locationId: 'loc_1', contactId: 'c_1', reasonCode: '13.1', disputeAmount: 5000, disputeDate: '2026-03-20', deadline: '2026-04-10' },
      { firstName: 'John', lastName: 'Doe', email: 'john@test.com' },
      { business_name: 'Test Biz' },
      mockExhibitList,
      [{ amount: 500, payment_date: '2026-01-15' }],
      'services_not_provided',
    );

    expect(msg).not.toContain('PRIOR UNDISPUTED TRANSACTIONS (');
    expect(msg).toContain('Do NOT include a "Prior Undisputed Transactions" section');
  });

  test('user message includes a chronological transaction timeline with markers', () => {
    const msg = defenseService.buildUserMessage(
      { locationId: 'loc_1', contactId: 'c_1', reasonCode: '13.1', disputeAmount: 5000, disputeDate: '2026-03-20', deadline: '2026-04-10' },
      { firstName: 'John', lastName: 'Doe', email: 'john@test.com' },
      { business_name: 'Test Biz' },
      mockExhibitList,
      [],
      'services_not_provided',
      exactScope({ transactionDate: '2026-01-15T08:00:00Z' }) as any,
    );

    expect(msg).toContain('TRANSACTION TIMELINE');
    expect(msg).toContain('** Disputed charge **');
    expect(msg).toContain('** Chargeback filed by cardholder **');
    expect(msg).toContain('(Exhibit B)');
  });
});

describe('Defense Service - Compilation Flow', () => {
  test('compileDefense returns defenseId immediately', async () => {
    const id = await defenseService.compileDefense({
      locationId: 'loc_1', contactId: 'c_1',
      reasonCode: '13.1', disputeAmount: 5000,
      disputeDate: '2026-03-20', deadline: '2026-04-10',
    });

    expect(id).toBe('def_1');
  });

  test('compileDefense fires chargeback detected through triggerService', async () => {
    await defenseService.compileDefense({
      locationId: 'loc_1', contactId: 'c_1',
      reasonCode: '13.1', disputeAmount: 5000,
      disputeDate: '2026-03-20', deadline: '2026-04-10',
      processor: 'nmi',
    });

    expect(mockFireTrigger).toHaveBeenCalledWith(
      'loc_1',
      'ss_chargeback_detected',
      expect.objectContaining({
        contact_id: 'c_1',
        amount: 5000,
        reason_code: '13.1',
        dispute_date: '2026-03-20',
        processor: 'nmi',
      }),
    );
  });

  test('runCompilation calls Claude API', async () => {
    await defenseService.runCompilation('def_1', {
      locationId: 'loc_1', contactId: 'c_1',
      reasonCode: '13.1', disputeAmount: 5000,
      disputeDate: '2026-03-20', deadline: '2026-04-10',
    }, 'services_not_provided');

    expect(callClaude).toHaveBeenCalledTimes(1);
    expect(defenseRepository.updateStatus).toHaveBeenCalledWith(
      'def_1', 'complete',
      expect.objectContaining({ defense_letter_text: 'Defense letter content here' }),
    );
  });

  test('runCompilation scopes exhibits and PDF bundle to enrollmentId', async () => {
    await defenseService.runCompilation('def_1', {
      locationId: 'loc_1',
      contactId: 'c_1',
      reasonCode: '13.1',
      disputeAmount: 5000,
      disputeDate: '2026-03-20',
      deadline: '2026-04-10',
      enrollmentId: 'enr_1',
    }, 'services_not_provided');

    expect(defenseExhibitsService.buildExhibitList).toHaveBeenCalledWith(
      'loc_1',
      'c_1',
      expect.objectContaining({ enrollmentId: 'enr_1', scopeConfidence: 'exact' }),
    );
    expect(mockBundleDefensePdf).toHaveBeenCalledWith(
      'def_1',
      'loc_1',
      'c_1',
      expect.objectContaining({ enrollmentId: 'enr_1', scopeConfidence: 'exact' }),
    );
  });

  test('runCompilation fires defense ready through triggerService', async () => {
    await defenseService.runCompilation('def_1', {
      locationId: 'loc_1', contactId: 'c_1',
      reasonCode: '13.1', disputeAmount: 5000,
      disputeDate: '2026-03-20', deadline: '2026-04-10',
      processor: 'stripe',
    }, 'services_not_provided');

    expect(mockFireTrigger).toHaveBeenCalledWith(
      'loc_1',
      'ss_defense_ready',
      expect.objectContaining({
        contact_id: 'c_1',
        evidence_count: 2,
        readiness_score: expect.any(Number),
        processor: 'stripe',
      }),
    );
  });

  test('unknown reason code forces needs_review and suppresses ss_defense_ready', async () => {
    await defenseService.runCompilation('def_1', {
      locationId: 'loc_1', contactId: 'c_1',
      reasonCode: 'ZZ99', disputeAmount: 5000,
      disputeDate: '2026-03-20', deadline: '2026-04-10',
      enrollmentId: 'enr_1',
    }, 'general');

    expect(defenseRepository.updateStatus).toHaveBeenCalledWith(
      'def_1', 'needs_review',
      expect.objectContaining({
        error_message: expect.stringContaining('not recognized'),
      }),
    );
    expect(mockFireTrigger).not.toHaveBeenCalledWith('loc_1', 'ss_defense_ready', expect.anything());
  });

  test('services_not_provided with zero delivery evidence is red-flagged, not marked ready', async () => {
    const noDelivery: ExhibitList = {
      ...mockExhibitList,
      exhibits: [consentExhibit],
      byCategory: { ...mockExhibitList.byCategory, service_delivery: [] },
      totals: { ...mockExhibitList.totals, serviceDelivery: 0 },
    };
    (defenseExhibitsService.buildExhibitList as jest.Mock).mockResolvedValueOnce(noDelivery);

    await defenseService.runCompilation('def_1', {
      locationId: 'loc_1', contactId: 'c_1',
      reasonCode: '13.1', disputeAmount: 5000,
      disputeDate: '2026-03-20', deadline: '2026-04-10',
      enrollmentId: 'enr_1',
    }, 'services_not_provided');

    expect(defenseRepository.updateStatus).toHaveBeenCalledWith(
      'def_1', 'needs_review',
      expect.objectContaining({
        error_message: expect.stringContaining('consider accepting'),
      }),
    );
    expect(mockFireTrigger).not.toHaveBeenCalledWith('loc_1', 'ss_defense_ready', expect.anything());
  });
});

describe('Defense Service - Scope resolution & needs_review gating', () => {
  test('resolves enrollment from paymentEventId and scopes exhibits to it', async () => {
    mockResolveDisputeScope.mockResolvedValueOnce(
      exactScope({ paymentEventId: 'pe_1', enrollmentId: 'enr_from_pe', processorTransactionId: 'txn_99' }),
    );

    await defenseService.runCompilation('def_1', {
      locationId: 'loc_1', contactId: 'c_1',
      reasonCode: '13.1', disputeAmount: 5000,
      disputeDate: '2026-03-20', deadline: '2026-04-10',
      paymentEventId: 'pe_1',
    }, 'services_not_provided');

    expect(mockResolveDisputeScope).toHaveBeenCalledWith(
      expect.objectContaining({ locationId: 'loc_1', contactId: 'c_1', paymentEventId: 'pe_1' }),
    );
    expect(defenseExhibitsService.buildExhibitList).toHaveBeenCalledWith(
      'loc_1', 'c_1',
      expect.objectContaining({ enrollmentId: 'enr_from_pe', scopeConfidence: 'exact' }),
    );
  });

  test('contact_only scope marks needs_review and does NOT fire ss_defense_ready', async () => {
    mockResolveDisputeScope.mockResolvedValueOnce(
      exactScope({ enrollmentId: null, offerId: null, offerName: null, scopeConfidence: 'contact_only', gaps: ['No program linked.'] }),
    );

    await defenseService.runCompilation('def_1', {
      locationId: 'loc_1', contactId: 'c_1',
      reasonCode: '13.1', disputeAmount: 5000,
      disputeDate: '2026-03-20', deadline: '2026-04-10',
    }, 'services_not_provided');

    expect(defenseRepository.updateStatus).toHaveBeenCalledWith(
      'def_1', 'needs_review', expect.any(Object),
    );
    expect(defenseRepository.updateStatus).not.toHaveBeenCalledWith('def_1', 'complete', expect.anything());
    expect(mockFireTrigger).not.toHaveBeenCalledWith('loc_1', 'ss_defense_ready', expect.anything());
  });

  test('AI failure produces a structured fallback letter, marks needs_review, and does not fire ready', async () => {
    (callClaude as jest.Mock).mockRejectedValueOnce(new Error('Anthropic overloaded'));

    await defenseService.runCompilation('def_1', {
      locationId: 'loc_1', contactId: 'c_1',
      reasonCode: '4855', disputeAmount: 5000,
      disputeDate: '2026-03-20', deadline: '2026-04-10',
      enrollmentId: 'enr_1',
    }, 'services_not_provided');

    // needs_review, not complete
    expect(defenseRepository.updateStatus).toHaveBeenCalledWith(
      'def_1', 'needs_review', expect.any(Object),
    );
    expect(mockFireTrigger).not.toHaveBeenCalledWith('loc_1', 'ss_defense_ready', expect.anything());

    // The fallback letter is structured — NOT the generic "found X evidence records" paragraph.
    const call = (defenseRepository.updateStatus as jest.Mock).mock.calls.find(
      (c) => c[1] === 'needs_review' && c[2]?.defense_letter_text,
    );
    expect(call).toBeTruthy();
    const letter: string = call[2].defense_letter_text;
    expect(letter).toContain('TRANSACTION AND PROGRAM');
    expect(letter).toContain('EVIDENCE GAPS');
    expect(letter).toContain('EXHIBIT INDEX');
    expect(letter).not.toMatch(/found \d+ evidence records/i);
  });

  test('structured fallback letter builder includes all required sections', () => {
    const letter = defenseService.buildStructuredFallbackLetter(
      { locationId: 'loc_1', contactId: 'c_1', reasonCode: '4855', disputeAmount: 100, disputeDate: '2026-03-20', deadline: '2026-04-10' },
      exactScope({ gaps: ['A gap to review.'] }) as any,
      mockExhibitList,
      [{ amount: 500, payment_date: '2026-01-15' }],
      { business_name: 'Test Biz' },
      { firstName: 'John', lastName: 'Doe' },
      'Dispute Resolution Department',
    );

    expect(letter).toContain('TRANSACTION AND PROGRAM');
    expect(letter).toContain('AUTHORIZATION / CONSENT EVIDENCE');
    expect(letter).toContain('SERVICE DELIVERY EVIDENCE');
    expect(letter).toContain('PAYMENT / REFUND / CANCELLATION CONTEXT');
    expect(letter).toContain('PRIOR PAYMENT / RELATIONSHIP CONTEXT');
    expect(letter).toContain('EVIDENCE GAPS');
    expect(letter).toContain('EXHIBIT INDEX');
    expect(letter).toContain('A gap to review.');
  });
});
