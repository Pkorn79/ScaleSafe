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

const mockExhibitList: ExhibitList = {
  exhibits: [
    {
      letter: 'A',
      name: 'Signed Enrollment Packet',
      category: 'consent',
      source: 'enrollment_packet_pdf',
      ref: 'packets/enrollment.pdf',
      occurredAt: '2026-01-15',
      summary: 'T&C accepted',
    },
  ],
  byCategory: {
    consent: [
      {
        letter: 'A',
        name: 'Signed Enrollment Packet',
        category: 'consent',
        source: 'enrollment_packet_pdf',
        ref: 'packets/enrollment.pdf',
        occurredAt: '2026-01-15',
        summary: 'T&C accepted',
      },
    ],
    service_delivery: [],
    communication: [],
    payments: [],
    termination: [],
  },
  totals: {
    consent: 1,
    serviceDelivery: 0,
    communication: 0,
    payments: 0,
    termination: 0,
  },
  enrollmentPacketPath: 'packets/enrollment.pdf',
};

jest.mock('../../src/services/defense-exhibits.service', () => ({
  defenseExhibitsService: {
    buildExhibitList: jest.fn().mockResolvedValue(mockExhibitList),
  },
}));

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

  test('Unknown reason code defaults to services_not_provided', async () => {
    await defenseService.compileDefense({
      locationId: 'loc_1', contactId: 'c_1',
      reasonCode: '99.99', disputeAmount: 5000,
      disputeDate: '2026-03-20', deadline: '2026-04-10',
    });

    expect(defenseRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ reason_code_category: 'services_not_provided' }),
    );
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

  test('user message includes evidence timeline', () => {
    const msg = defenseService.buildUserMessage(
      { locationId: 'loc_1', contactId: 'c_1', reasonCode: '13.1', disputeAmount: 5000, disputeDate: '2026-03-20', deadline: '2026-04-10' },
      { firstName: 'John', lastName: 'Doe', email: 'john@test.com' },
      { business_name: 'Test Biz' },
      mockExhibitList,
      [{ amount: 500, payment_date: '2026-01-15' }],
      'services_not_provided',
    );

    expect(msg).toContain('13.1');
    expect(msg).toContain('$5000');
    expect(msg).toContain('John');
    expect(msg).toContain('CONSENT EVIDENCE');
    expect(msg).toContain('Exhibit A');
    expect(msg).toContain('PRIOR UNDISPUTED TRANSACTIONS');
    expect(msg).toContain('$500');
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
        evidence_count: 1,
        readiness_score: expect.any(Number),
        processor: 'stripe',
      }),
    );
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
