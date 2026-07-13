/**
 * Defense service tests.
 * Tests reason code mapping, prompt building, and compilation flow.
 */

import type { ExhibitList } from '../../src/services/defense-exhibits.service';

// Table-level tracking mock: records every insert/update per table so tests can
// assert e.g. that fallback letters land in defense_letter_versions and that
// internal_debug is written to defense_packets.
const mockInsertedRows: Record<string, any[]> = {};
const mockUpdatedRows: Record<string, any[]> = {};
const mockInsertErrors: Record<string, any> = {};
// Per-table single-row results for select().maybeSingle()/single(). Tests that
// need a specific table to return a row set mockSelectResults[table] = row.
const mockSelectResults: Record<string, any> = {};
jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({
    from: (table: string) => ({
      insert: (row: any) => {
        (mockInsertedRows[table] = mockInsertedRows[table] || []).push(row);
        const p: any = Promise.resolve({ data: null, error: mockInsertErrors[table] || null });
        p.select = () => ({ single: () => Promise.resolve({ data: { id: 'row_1' }, error: null }) });
        return p;
      },
      update: (row: any) => {
        (mockUpdatedRows[table] = mockUpdatedRows[table] || []).push(row);
        const p: any = Promise.resolve({ data: null, error: null });
        p.eq = () => {
          const q: any = Promise.resolve({ data: null, error: null });
          q.eq = () => q;
          q.order = () => q;
          q.limit = () => q;
          return q;
        };
        return p;
      },
      select: () => {
        const b: any = {};
        for (const m of ['eq', 'order', 'limit', 'gte', 'lte', 'in']) b[m] = () => b;
        b.maybeSingle = () => Promise.resolve({ data: mockSelectResults[table] ?? null, error: null });
        b.single = () => Promise.resolve({ data: mockSelectResults[table] ?? null, error: null });
        b.then = (resolve: any, reject: any) => Promise.resolve({
          data: mockSelectResults[table] ? [mockSelectResults[table]] : [],
          error: null,
        }).then(resolve, reject);
        return b;
      },
    }),
  }),
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
    model: 'claude-sonnet-5',
    modelAttempts: [{ model: 'claude-sonnet-5', result: 'succeeded' }],
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
  sourceErrors: [],
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

jest.mock('../../src/repositories/offer.repository', () => ({
  offerRepository: { findById: jest.fn() },
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

const mockDefenseSubmissionBegin = jest.fn().mockResolvedValue({
  action: 'execute',
  claim: { id: 'claim_1', status: 'processing', provider_called: false },
});
const mockDefenseProviderStarted = jest.fn().mockResolvedValue(undefined);
const mockDefenseProviderAccepted = jest.fn().mockResolvedValue(undefined);
const mockDefenseSubmissionUnknown = jest.fn().mockResolvedValue(undefined);
const mockDefenseSubmissionFailed = jest.fn().mockResolvedValue(undefined);
const mockDefenseSubmissionFinalize = jest.fn().mockImplementation(async () => {
  (mockUpdatedRows['defense_packets'] = mockUpdatedRows['defense_packets'] || [])
    .push({ lifecycle_status: 'submitted' });
});
jest.mock('../../src/services/defense-submission.service', () => ({
  defenseSubmissionService: {
    begin: (...args: any[]) => mockDefenseSubmissionBegin(...args),
    markProviderStarted: (...args: any[]) => mockDefenseProviderStarted(...args),
    markProviderAccepted: (...args: any[]) => mockDefenseProviderAccepted(...args),
    markUnknown: (...args: any[]) => mockDefenseSubmissionUnknown(...args),
    markFailedBeforeProvider: (...args: any[]) => mockDefenseSubmissionFailed(...args),
    finalizeAccepted: (...args: any[]) => mockDefenseSubmissionFinalize(...args),
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

const mockUploadDefensePacketFile = jest.fn();
const mockStripeSubmitEvidence = jest.fn();
const mockAssembleEvidencePacket = jest.fn();
jest.mock('../../src/services/stripe-dispute.service', () => ({
  stripeDisputeService: {
    uploadDefensePacketFile: (...args: any[]) => mockUploadDefensePacketFile(...args),
    submitEvidence: (...args: any[]) => mockStripeSubmitEvidence(...args),
    assembleEvidencePacket: (...args: any[]) => mockAssembleEvidencePacket(...args),
    // Mirror the real reader: eligibility comes off raw_dispute_object
    getCe3Eligibility: (de: any) => ({
      eligible: !!de?.raw_dispute_object?.enhanced_eligibility_types?.includes?.('visa_compelling_evidence_3'),
      status: de?.raw_dispute_object?.evidence_details?.enhanced_eligibility?.visa_compelling_evidence_3?.status || null,
      requiredActions: [],
    }),
  },
}));

const mockBuildCe3Evidence = jest.fn();
jest.mock('../../src/services/stripe-ce3.service', () => ({
  stripeCe3Service: {
    buildCe3Evidence: (...args: any[]) => mockBuildCe3Evidence(...args),
  },
}));

const mockDownloadPrivateFile = jest.fn();
jest.mock('../../src/services/storage.service', () => ({
  storageService: {
    downloadPrivateFileWithLegacy: (...args: any[]) => mockDownloadPrivateFile(...args),
    createPrivateSignedUrl: jest.fn().mockResolvedValue('https://signed.test/url'),
  },
}));

import { defenseService, type OfferContext } from '../../src/services/defense.service';
import { defenseRepository } from '../../src/repositories/defense.repository';
import { callClaude } from '../../src/clients/anthropic.client';
import { defenseExhibitsService } from '../../src/services/defense-exhibits.service';
import { offerRepository } from '../../src/repositories/offer.repository';

const offerRow = {
  offer_name: 'Test Program',
  program_description: 'A 6-week coaching program with weekly sessions and platform access.',
  delivery_method: 'Self-Paced / On-Demand',
  price: 1.0,
  payment_type: 'installment',
  installment_amount: 0.5,
  installment_frequency: 'daily',
  num_payments: 2,
  refund_window_text: 'Full refund within 30 days of purchase.',
  m1_name: 'Merchant Setup',
  m1_delivers: 'Access to the platform',
  m1_client_does: 'Enter your settings information',
};

function offerCtx(overrides: Partial<OfferContext> = {}): OfferContext {
  return {
    offerName: 'Test Program',
    description: 'A 6-week coaching program with weekly sessions and platform access.',
    deliveryMethod: 'Self-Paced / On-Demand',
    priceText: '$1.00 total (2 daily payments of $0.50)',
    refundPolicy: 'Full refund within 30 days of purchase.',
    milestones: [{ name: 'Merchant Setup', delivers: 'Access to the platform', clientDoes: 'Enter your settings information' }],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDefenseSubmissionBegin.mockResolvedValue({
    action: 'execute',
    claim: { id: 'claim_1', status: 'processing', provider_called: false },
  });
  mockDefenseProviderStarted.mockResolvedValue(undefined);
  mockDefenseProviderAccepted.mockResolvedValue(undefined);
  mockDefenseSubmissionUnknown.mockResolvedValue(undefined);
  mockDefenseSubmissionFailed.mockResolvedValue(undefined);
  mockDefenseSubmissionFinalize.mockImplementation(async () => {
    (mockUpdatedRows['defense_packets'] = mockUpdatedRows['defense_packets'] || [])
      .push({ lifecycle_status: 'submitted' });
  });
  mockBundleDefensePdf.mockResolvedValue('https://files.test/defense.pdf');
  mockResolveDisputeScope.mockResolvedValue(exactScope());
  (offerRepository.findById as jest.Mock).mockResolvedValue(offerRow);
  mockUploadDefensePacketFile.mockResolvedValue('file_123');
  mockStripeSubmitEvidence.mockResolvedValue({ submitted: true });
  mockAssembleEvidencePacket.mockResolvedValue({ evidence: { receipt: 'file_receipt' } });
  mockDownloadPrivateFile.mockResolvedValue({ buffer: Buffer.from('%PDF-1.4 test'), bucket: 'private' });
  for (const k of Object.keys(mockInsertedRows)) delete mockInsertedRows[k];
  for (const k of Object.keys(mockUpdatedRows)) delete mockUpdatedRows[k];
  for (const k of Object.keys(mockInsertErrors)) delete mockInsertErrors[k];
  for (const k of Object.keys(mockSelectResults)) delete mockSelectResults[k];
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

describe('Defense Service - Merchant voice & letter structure', () => {
  test('system prompt mandates first-person merchant voice and bans tool attribution', () => {
    const prompt = defenseService.buildSystemPrompt('services_not_provided', null, null);
    expect(prompt).toContain('Write in the first person as the merchant');
    expect(prompt).toContain('NEVER mention ScaleSafe');
    expect(prompt).not.toContain('third person');
  });

  test('system prompt requires transaction identification and a Request section', () => {
    const prompt = defenseService.buildSystemPrompt('services_not_provided', null, null);
    expect(prompt).toContain('processor transaction ID');
    expect(prompt).toContain('Request — a short section');
  });

  test('user message carries disputed transaction date and processor transaction ID', () => {
    const msg = defenseService.buildUserMessage(
      { locationId: 'loc_1', contactId: 'c_1', reasonCode: '4855', disputeAmount: 0.5, disputeDate: '2026-07-02', deadline: '2026-07-22' },
      { firstName: 'John', lastName: 'Doe' },
      { business_name: 'Test Biz' },
      mockExhibitList,
      [],
      'services_not_provided',
      exactScope({ transactionDate: '2026-05-06T21:06:53Z', processorTransactionId: '12034706166' }) as any,
    );
    expect(msg).toContain('Disputed Transaction Date: 2026-05-06');
    expect(msg).toContain('Processor Transaction ID: 12034706166');
  });

  test('fallback letter is first-person, makes a request, and never mentions ScaleSafe or review state', () => {
    const letter = defenseService.buildStructuredFallbackLetter(
      { locationId: 'loc_1', contactId: 'c_1', reasonCode: '4855', disputeAmount: 100, disputeDate: '2026-03-20', deadline: '2026-04-10' },
      exactScope({ transactionDate: '2026-01-15T08:00:00Z', processorTransactionId: 'txn_99' }) as any,
      mockExhibitList,
      [],
      { business_name: 'Test Biz' },
      { firstName: 'John', lastName: 'Doe' },
      'Dispute Resolution Department',
    );
    expect(letter).toContain('We received this chargeback');
    expect(letter).toContain('REQUEST');
    expect(letter).toContain('we request that this chargeback be declined');
    expect(letter).toContain('dated 2026-01-15');
    expect(letter).not.toContain('ScaleSafe');
    expect(letter).not.toContain('review before submission');
  });
});

describe('Defense Service - What was sold (offer context)', () => {
  test('system prompt instructs offer-context usage per dispute type and evidence variety', () => {
    const prompt = defenseService.buildSystemPrompt('services_not_provided', null, null);
    expect(prompt).toContain('OFFER CONTEXT — USE IT');
    expect(prompt).toContain('What the client purchased');
    expect(prompt).toContain('provisioning access to the promised materials IS delivery');
    expect(prompt).toContain('EVIDENCE VARIETY');
    expect(prompt).toContain('pulse check-in responses');
    expect(prompt).toContain('Never invent or imply evidence types');
  });

  test('user message carries the WHAT WAS SOLD block when an offer is resolved', () => {
    const msg = defenseService.buildUserMessage(
      { locationId: 'loc_1', contactId: 'c_1', reasonCode: '4855', disputeAmount: 0.5, disputeDate: '2026-07-02', deadline: '2026-07-22' },
      { firstName: 'John' },
      { business_name: 'Test Biz' },
      mockExhibitList,
      [],
      'services_not_provided',
      exactScope() as any,
      offerCtx(),
    );
    expect(msg).toContain('WHAT WAS SOLD');
    expect(msg).toContain('What it is: A 6-week coaching program');
    expect(msg).toContain('Delivery method: Self-Paced / On-Demand');
    expect(msg).toContain('Price: $1.00 total (2 daily payments of $0.50)');
    expect(msg).toContain('Refund policy the client accepted: Full refund within 30 days');
    expect(msg).toContain('1. Merchant Setup — Deliverables: Access to the platform — Client responsibility: Enter your settings information');
  });

  test('user message omits the block when no offer is resolved', () => {
    const msg = defenseService.buildUserMessage(
      { locationId: 'loc_1', contactId: 'c_1', reasonCode: '4855', disputeAmount: 0.5, disputeDate: '2026-07-02', deadline: '2026-07-22' },
      { firstName: 'John' },
      { business_name: 'Test Biz' },
      mockExhibitList,
      [],
      'services_not_provided',
      exactScope() as any,
      null,
    );
    expect(msg).not.toContain('WHAT WAS SOLD');
  });

  test('runCompilation loads the offer and feeds it into the AI prompt', async () => {
    await defenseService.runCompilation('def_1', {
      locationId: 'loc_1', contactId: 'c_1',
      reasonCode: '4855', disputeAmount: 0.5,
      disputeDate: '2026-07-02', deadline: '2026-07-22',
      enrollmentId: 'enr_1',
    }, 'services_not_provided');

    expect(offerRepository.findById).toHaveBeenCalledWith('offer_1', 'loc_1');
    const userMessage = (callClaude as jest.Mock).mock.calls[0][1];
    expect(userMessage).toContain('WHAT WAS SOLD');
    expect(userMessage).toContain('A 6-week coaching program');
    expect(userMessage).toContain('2 daily payments of $0.50');
    expect(userMessage).toContain('Merchant Setup — Deliverables: Access to the platform');
  });

  test('compilation still completes when the offer cannot be loaded', async () => {
    (offerRepository.findById as jest.Mock).mockRejectedValueOnce(new Error('offer table drift'));

    await defenseService.runCompilation('def_1', {
      locationId: 'loc_1', contactId: 'c_1',
      reasonCode: '13.1', disputeAmount: 5000,
      disputeDate: '2026-03-20', deadline: '2026-04-10',
      enrollmentId: 'enr_1',
    }, 'services_not_provided');

    const userMessage = (callClaude as jest.Mock).mock.calls[0][1];
    expect(userMessage).not.toContain('WHAT WAS SOLD');
    expect(defenseRepository.updateStatus).toHaveBeenCalledWith(
      'def_1', 'complete', expect.any(Object),
    );
  });

  test('fallback letter describes the program when offer context is available', () => {
    const letter = defenseService.buildStructuredFallbackLetter(
      { locationId: 'loc_1', contactId: 'c_1', reasonCode: '4855', disputeAmount: 0.5, disputeDate: '2026-07-02', deadline: '2026-07-22' },
      exactScope() as any,
      mockExhibitList,
      [],
      { business_name: 'Test Biz' },
      { firstName: 'John' },
      'Sponsor Bank — Chargeback Department',
      offerCtx(),
    );
    expect(letter).toContain('The program: A 6-week coaching program');
    expect(letter).toContain('Delivery method: Self-Paced / On-Demand');
    expect(letter).toContain('Program price: $1.00 total (2 daily payments of $0.50)');
  });
});

describe('Defense Service - updateDeadline', () => {
  test('updates the deadline for a pre-submission packet', async () => {
    (defenseRepository.getById as jest.Mock).mockResolvedValueOnce({
      id: 'def_1', location_id: 'loc_1', lifecycle_status: 'pending_submission',
    });

    await defenseService.updateDeadline('def_1', '2026-07-22', 'loc_1');

    const updates = mockUpdatedRows['defense_packets'] || [];
    expect(updates).toContainEqual({ response_deadline: '2026-07-22' });
  });

  test('rejects a deadline change after submission', async () => {
    (defenseRepository.getById as jest.Mock).mockResolvedValueOnce({
      id: 'def_1', location_id: 'loc_1', lifecycle_status: 'submitted',
    });

    await expect(defenseService.updateDeadline('def_1', '2026-07-22', 'loc_1'))
      .rejects.toThrow(/after submission/);
  });

  test('rejects malformed dates', async () => {
    (defenseRepository.getById as jest.Mock).mockResolvedValueOnce({
      id: 'def_1', location_id: 'loc_1', lifecycle_status: 'pending_submission',
    });

    await expect(defenseService.updateDeadline('def_1', 'July 22', 'loc_1'))
      .rejects.toThrow(/YYYY-MM-DD/);
  });
});

describe('Defense Service - Regeneration review state', () => {
  function regenPacket(overrides: Record<string, any> = {}) {
    return {
      id: 'def_1', status: 'needs_review', location_id: 'loc_1', contact_id: 'c_1',
      enrollment_id: 'enr_1', reason_code_category: 'services_not_provided',
      chargeback_reason_code: '4855', chargeback_amount: 0.5, chargeback_date: '2026-07-02',
      response_deadline: '2026-08-16', case_number: '123',
      lifecycle_status: 'pending_submission',
      error_message: 'AI draft was unavailable; a structured fallback letter was generated.',
      ...overrides,
    };
  }

  test('successful regeneration clears a stale fallback needs_review and does not fire ready', async () => {
    (defenseRepository.getById as jest.Mock).mockResolvedValueOnce(regenPacket());

    await defenseService.regenerateLetter('def_1');

    expect(defenseRepository.updateStatus).toHaveBeenCalledWith(
      'def_1', 'complete',
      expect.objectContaining({
        error_message: null,
        enrollment_id: 'enr_1',
        evidence_snapshot: expect.objectContaining({ exhibits: mockExhibitList.exhibits }),
        evidence_count: mockExhibitList.exhibits.length,
      }),
    );
    expect(mockFireTrigger).not.toHaveBeenCalledWith('loc_1', 'ss_defense_ready', expect.anything());
  });

  test('regeneration keeps needs_review when genuine reasons persist (source errors)', async () => {
    (defenseRepository.getById as jest.Mock).mockResolvedValueOnce(regenPacket());
    (defenseExhibitsService.buildExhibitList as jest.Mock).mockResolvedValueOnce({
      ...mockExhibitList,
      sourceErrors: [{ source: 'evidence_milestones', message: 'column does not exist' }],
    });

    await defenseService.regenerateLetter('def_1');

    expect(defenseRepository.updateStatus).toHaveBeenCalledWith(
      'def_1', 'needs_review',
      expect.objectContaining({ error_message: expect.stringContaining('evidence sources') }),
    );
    // The stale fallback reason must NOT survive the regeneration
    const call = (defenseRepository.updateStatus as jest.Mock).mock.calls.find((c) => c[1] === 'needs_review');
    expect(call[2].error_message).not.toContain('AI draft was unavailable');
    expect(mockFireTrigger).not.toHaveBeenCalledWith('loc_1', 'ss_defense_ready', expect.anything());
  });

  test('compile holds packet for review when a refund predates the dispute (strategy flag)', async () => {
    const refundList: ExhibitList = {
      ...mockExhibitList,
      byCategory: {
        ...mockExhibitList.byCategory,
        termination: [{
          letter: 'C', name: 'Refund (full)', category: 'termination' as const,
          source: 'evidence_refund_activity' as const, ref: 'ref_1',
          occurredAt: '2026-06-03', summary: 'Refund of $0.50 issued June 3, 2026.',
        }],
      },
    };
    (defenseExhibitsService.buildExhibitList as jest.Mock).mockResolvedValueOnce(refundList);

    await defenseService.runCompilation('def_1', {
      locationId: 'loc_1', contactId: 'c_1',
      reasonCode: '4855', disputeAmount: 0.5,
      disputeDate: '2026-07-02', deadline: '2026-07-22',
      enrollmentId: 'enr_1',
    }, 'services_not_provided');

    expect(defenseRepository.updateStatus).toHaveBeenCalledWith(
      'def_1', 'needs_review',
      expect.objectContaining({ error_message: expect.stringContaining('credit already issued') }),
    );
    expect(mockFireTrigger).not.toHaveBeenCalledWith('loc_1', 'ss_defense_ready', expect.anything());
  });

  test('regeneration invalidates the stale PDF and remains needs_review when rebundling fails', async () => {
    (defenseRepository.getById as jest.Mock).mockResolvedValueOnce(regenPacket({
      pdf_storage_path: 'defense-packets/loc_1/def_1-v1.pdf',
      pdf_url: 'https://old.example/packet.pdf',
    }));
    mockBundleDefensePdf.mockRejectedValueOnce(new Error('signed packet unavailable'));

    await expect(defenseService.regenerateLetter('def_1')).rejects.toThrow(/could not be rebuilt/i);
    expect(defenseRepository.updateStatus).toHaveBeenCalledWith(
      'def_1',
      'needs_review',
      expect.objectContaining({ pdf_storage_path: null, pdf_url: null }),
    );
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
    // Exactly once — never duplicated
    const readyCalls = mockFireTrigger.mock.calls.filter((c) => c[1] === 'ss_defense_ready');
    expect(readyCalls).toHaveLength(1);
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

  test('fallback letters get a defense_letter_versions row (generated_by system)', async () => {
    (callClaude as jest.Mock).mockRejectedValueOnce(Object.assign(new Error('model_not_found'), {
      response: { status: 404 },
      modelAttempts: [{ model: 'claude-sonnet-5', result: 'failed', status: 404, reason: 'not_found_error' }],
    }));

    await defenseService.runCompilation('def_1', {
      locationId: 'loc_1', contactId: 'c_1',
      reasonCode: '4855', disputeAmount: 5000,
      disputeDate: '2026-03-20', deadline: '2026-04-10',
      enrollmentId: 'enr_1',
    }, 'services_not_provided');

    const versions = mockInsertedRows['defense_letter_versions'] || [];
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      defense_packet_id: 'def_1',
      version_number: 1,
      generated_by: 'system',
      model_used: 'fallback',
    });
    expect(versions[0].letter_text).toContain('TRANSACTION AND PROGRAM');
  });

  test('AI failure internals are preserved in internal_debug; merchant-facing text stays clean', async () => {
    (callClaude as jest.Mock).mockRejectedValueOnce(Object.assign(new Error('model_not_found'), {
      response: { status: 404 },
      modelAttempts: [{ model: 'claude-sonnet-5', result: 'failed', status: 404, reason: 'not_found_error' }],
    }));

    await defenseService.runCompilation('def_1', {
      locationId: 'loc_1', contactId: 'c_1',
      reasonCode: '4855', disputeAmount: 5000,
      disputeDate: '2026-03-20', deadline: '2026-04-10',
      enrollmentId: 'enr_1',
    }, 'services_not_provided');

    const debugUpdates = (mockUpdatedRows['defense_packets'] || []).filter((u) => u.internal_debug);
    expect(debugUpdates).toHaveLength(1);
    expect(debugUpdates[0].internal_debug.ai_failure).toMatchObject({ message: 'model_not_found', status: 404 });
    expect(debugUpdates[0].internal_debug.model_attempts).toEqual([
      expect.objectContaining({ model: 'claude-sonnet-5', result: 'failed' }),
    ]);

    const statusCall = (defenseRepository.updateStatus as jest.Mock).mock.calls.find(
      (c) => c[1] === 'needs_review' && c[2]?.error_message,
    );
    expect(statusCall[2].error_message).toContain('AI draft was unavailable');
    expect(statusCall[2].error_message).not.toContain('model_not_found');
  });

  test('successful AI letters are versioned with generated_by ai and the real model', async () => {
    await defenseService.runCompilation('def_1', {
      locationId: 'loc_1', contactId: 'c_1',
      reasonCode: '13.1', disputeAmount: 5000,
      disputeDate: '2026-03-20', deadline: '2026-04-10',
      enrollmentId: 'enr_1',
    }, 'services_not_provided');

    const versions = mockInsertedRows['defense_letter_versions'] || [];
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ generated_by: 'ai', model_used: 'claude-sonnet-5' });
  });

  test('a version-1 insert conflict reuses the locked stored letter for every downstream write', async () => {
    (callClaude as jest.Mock).mockResolvedValueOnce({
      text: 'A different letter generated by the retry',
      inputTokens: 900,
      outputTokens: 800,
      model: 'claude-sonnet-5',
    });
    mockInsertErrors['defense_letter_versions'] = { code: '23505', message: 'duplicate key value violates unique constraint' };
    mockSelectResults['defense_letter_versions'] = {
      version_number: 1,
      letter_text: 'The original locked version one letter',
      generated_by: 'ai',
      model_used: 'claude-sonnet-4',
      prompt_tokens_used: 111,
      response_tokens_used: 222,
    };

    await defenseService.runCompilation('def_1', {
      locationId: 'loc_1', contactId: 'c_1',
      reasonCode: '13.1', disputeAmount: 5000,
      disputeDate: '2026-03-20', deadline: '2026-04-10',
      enrollmentId: 'enr_1',
    }, 'services_not_provided');

    expect(defenseRepository.updateStatus).toHaveBeenCalledWith(
      'def_1',
      'processing',
      expect.objectContaining({
        defense_letter_text: 'The original locked version one letter',
        prompt_tokens_used: 111,
        response_tokens_used: 222,
      }),
    );
    expect(defenseRepository.updateStatus).not.toHaveBeenCalledWith(
      'def_1',
      expect.any(String),
      expect.objectContaining({ defense_letter_text: 'A different letter generated by the retry' }),
    );
    expect(mockBundleDefensePdf).toHaveBeenCalledTimes(1);
  });

  test('a version-1 insert failure stops safely when the locked row cannot be recovered', async () => {
    mockInsertErrors['defense_letter_versions'] = { code: '23505', message: 'duplicate key value violates unique constraint' };

    await defenseService.runCompilation('def_1', {
      locationId: 'loc_1', contactId: 'c_1',
      reasonCode: '13.1', disputeAmount: 5000,
      disputeDate: '2026-03-20', deadline: '2026-04-10',
      enrollmentId: 'enr_1',
    }, 'services_not_provided');

    expect(defenseRepository.updateStatus).toHaveBeenCalledWith(
      'def_1',
      'failed',
      expect.objectContaining({ error_message: expect.stringContaining('could not be locked') }),
    );
    expect(mockBundleDefensePdf).not.toHaveBeenCalled();
  });

  test('an exhibit source query failure forces needs_review and suppresses ss_defense_ready', async () => {
    (defenseExhibitsService.buildExhibitList as jest.Mock).mockResolvedValueOnce({
      ...mockExhibitList,
      sourceErrors: [{ source: 'evidence_milestones', message: 'column evidence_milestones.enrollment_id does not exist' }],
    });

    await defenseService.runCompilation('def_1', {
      locationId: 'loc_1', contactId: 'c_1',
      reasonCode: '13.1', disputeAmount: 5000,
      disputeDate: '2026-03-20', deadline: '2026-04-10',
      enrollmentId: 'enr_1',
    }, 'services_not_provided');

    expect(defenseRepository.updateStatus).toHaveBeenCalledWith(
      'def_1', 'needs_review',
      expect.objectContaining({ error_message: expect.stringContaining('evidence sources') }),
    );
    expect(mockFireTrigger).not.toHaveBeenCalledWith('loc_1', 'ss_defense_ready', expect.anything());

    // The raw schema error is preserved internally, not shown to the merchant
    const debugUpdates = (mockUpdatedRows['defense_packets'] || []).filter((u) => u.internal_debug);
    expect(debugUpdates).toHaveLength(1);
    expect(debugUpdates[0].internal_debug.exhibit_source_errors[0].message).toContain('enrollment_id does not exist');
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

describe('Defense Service - markSubmitted Stripe push', () => {
  const { merchantRepository } = require('../../src/repositories/merchant.repository');

  function stripePacket(overrides: Record<string, any> = {}) {
    return {
      id: 'def_1',
      location_id: 'loc_1',
      contact_id: 'c_1',
      lifecycle_status: 'pending_submission',
      dispute_event_id: 'de_1',
      enrollment_id: 'enr_1',
      offer_id: 'offer_1',
      defense_letter_text: 'We got this chargeback and here is why we are disputing it.',
      pdf_storage_path: 'defense-packets/loc_1/def_1-v1.pdf',
      ...overrides,
    };
  }

  beforeEach(() => {
    (merchantRepository.getByLocationId as jest.Mock).mockResolvedValue({
      id: 'merch_1',
      location_id: 'loc_1',
      business_name: 'Test Business',
      stripe_user_id: 'acct_1',
      config: {},
      trigger_ids: {},
    });
    (defenseRepository.getById as jest.Mock).mockResolvedValue(stripePacket());
    mockSelectResults['dispute_events'] = { id: 'de_1', stripe_dispute_id: 'dp_1', evidence_submitted: false };
    mockSelectResults['defense_letter_versions'] = { id: 'ver_1', version_number: 1, generated_by: 'ai' };
    mockSelectResults['enrollments'] = { consent_captured_at: '2026-01-15T10:00:00Z', created_at: '2026-01-15T09:00:00Z', offer_id: 'offer_1' };
  });

  test('happy path: uploads the packet PDF, overlays packet evidence, submits, then marks submitted', async () => {
    await defenseService.markSubmitted('def_1', 'loc_1');

    expect(mockUploadDefensePacketFile).toHaveBeenCalledWith(expect.objectContaining({
      merchantStripeAccountId: 'acct_1',
      filename: expect.stringContaining('def_1'),
    }));

    expect(mockStripeSubmitEvidence).toHaveBeenCalledTimes(1);
    const submitArgs = mockStripeSubmitEvidence.mock.calls[0][0];
    expect(submitArgs).toMatchObject({
      stripeDisputeId: 'dp_1',
      merchantId: 'merch_1',
      autoSubmit: true,
      submissionMode: 'manual',
    });
    // Vault baseline survives, packet fields overlay it
    expect(submitArgs.evidence.receipt).toBe('file_receipt');
    expect(submitArgs.evidence.uncategorized_text).toContain('here is why we are disputing it');
    expect(submitArgs.evidence.uncategorized_file).toBe('file_123');
    expect(submitArgs.evidence.product_description).toContain('Test Program');
    expect(submitArgs.evidence.customer_email_address).toBe('john@test.com');
    expect(submitArgs.evidence.customer_name).toBe('John Doe');
    expect(submitArgs.evidence.service_date).toBe('2026-01-15');

    // Bookkeeping row for the uploaded file
    expect(mockInsertedRows['dispute_evidence_files']).toEqual([
      expect.objectContaining({ dispute_event_id: 'de_1', merchant_id: 'merch_1', stripe_file_id: 'file_123' }),
    ]);

    // Local lifecycle only flips after the Stripe push succeeded
    expect(mockUpdatedRows['defense_packets']).toEqual([
      expect.objectContaining({ lifecycle_status: 'submitted' }),
    ]);
  });

  test('refuses contact-wide packets (no enrollment_id) — nothing reaches Stripe', async () => {
    (defenseRepository.getById as jest.Mock).mockResolvedValue(stripePacket({ enrollment_id: null }));

    await expect(defenseService.markSubmitted('def_1', 'loc_1')).rejects.toThrow(/not linked to a specific program/i);
    expect(mockStripeSubmitEvidence).not.toHaveBeenCalled();
    expect(mockUploadDefensePacketFile).not.toHaveBeenCalled();
    expect(mockUpdatedRows['defense_packets']).toBeUndefined();
  });

  test('refuses to submit the automatic fallback letter', async () => {
    mockSelectResults['defense_letter_versions'] = { id: 'ver_1', version_number: 1, generated_by: 'system' };

    await expect(defenseService.markSubmitted('def_1', 'loc_1')).rejects.toThrow(/fallback draft/i);
    expect(mockStripeSubmitEvidence).not.toHaveBeenCalled();
    expect(mockUpdatedRows['defense_packets']).toBeUndefined();
  });

  test('idempotent: refuses when evidence was already submitted for the dispute', async () => {
    mockSelectResults['dispute_events'] = { id: 'de_1', stripe_dispute_id: 'dp_1', evidence_submitted: true };

    await expect(defenseService.markSubmitted('def_1', 'loc_1')).rejects.toThrow(/already been submitted/i);
    expect(mockStripeSubmitEvidence).not.toHaveBeenCalled();
  });

  test('refuses a stale PDF whose version does not match the latest letter', async () => {
    mockSelectResults['defense_letter_versions'] = { id: 'ver_2', version_number: 2, generated_by: 'ai' };

    await expect(defenseService.markSubmitted('def_1', 'loc_1')).rejects.toThrow(/PDF is not current/i);
    expect(mockDefenseSubmissionBegin).not.toHaveBeenCalled();
    expect(mockStripeSubmitEvidence).not.toHaveBeenCalled();
  });

  test('a concurrent or ambiguous durable claim blocks a second Stripe submission', async () => {
    mockDefenseSubmissionBegin.mockResolvedValue({
      action: 'blocked',
      claim: { id: 'claim_1', status: 'unknown', provider_called: true },
    });

    await expect(defenseService.markSubmitted('def_1', 'loc_1')).rejects.toThrow(/unknown provider result/i);
    expect(mockStripeSubmitEvidence).not.toHaveBeenCalled();
  });

  test('a Stripe submission failure aborts markSubmitted — the packet stays pending', async () => {
    mockStripeSubmitEvidence.mockRejectedValue(new Error('Stripe API down'));

    await expect(defenseService.markSubmitted('def_1', 'loc_1')).rejects.toThrow('Stripe API down');
    expect(mockUpdatedRows['defense_packets']).toBeUndefined();
  });

  test('provider success plus local finalization failure stays provider_accepted for reconciliation', async () => {
    mockDefenseSubmissionFinalize.mockRejectedValue(new Error('database unavailable'));

    await expect(defenseService.markSubmitted('def_1', 'loc_1')).rejects.toThrow('database unavailable');
    expect(mockStripeSubmitEvidence).toHaveBeenCalledTimes(1);
    expect(mockDefenseProviderAccepted).toHaveBeenCalledTimes(1);
    expect(mockDefenseSubmissionUnknown).not.toHaveBeenCalled();
    expect(mockDefenseSubmissionFailed).not.toHaveBeenCalled();
  });

  test('vault assembly failure is non-fatal — packet-scoped evidence still submits', async () => {
    mockAssembleEvidencePacket.mockRejectedValue(new Error('vault empty'));

    await defenseService.markSubmitted('def_1', 'loc_1');

    const submitArgs = mockStripeSubmitEvidence.mock.calls[0][0];
    expect(submitArgs.evidence.receipt).toBeUndefined();
    expect(submitArgs.evidence.uncategorized_text).toContain('disputing it');
    expect(mockUpdatedRows['defense_packets']).toEqual([
      expect.objectContaining({ lifecycle_status: 'submitted' }),
    ]);
  });

  test('CE 3.0-eligible disputes get enhanced_evidence attached alongside standard evidence', async () => {
    mockSelectResults['dispute_events'] = {
      id: 'de_1',
      stripe_dispute_id: 'dp_1',
      evidence_submitted: false,
      raw_dispute_object: { enhanced_eligibility_types: ['visa_compelling_evidence_3'] },
    };
    const ce3Payload = {
      disputed_transaction: { customer_email_address: 'a@b.com', customer_purchase_ip: '1.2.3.4', merchandise_or_services: 'services', product_description: 'Program' },
      prior_undisputed_transactions: [
        { charge: 'ch_1', customer_email_address: 'a@b.com', customer_purchase_ip: '1.2.3.4', product_description: 'Program' },
        { charge: 'ch_2', customer_email_address: 'a@b.com', customer_purchase_ip: '1.2.3.4', product_description: 'Program' },
      ],
    };
    mockBuildCe3Evidence.mockResolvedValue({ evidence: ce3Payload, reasons: [] });

    await defenseService.markSubmitted('def_1', 'loc_1');

    const submitArgs = mockStripeSubmitEvidence.mock.calls[0][0];
    expect(submitArgs.evidence.enhanced_evidence).toEqual({ visa_compelling_evidence_3: ce3Payload });
    // Standard fallback evidence stays populated
    expect(submitArgs.evidence.uncategorized_text).toContain('disputing it');
    expect(submitArgs.evidence.uncategorized_file).toBe('file_123');
  });

  test('CE 3.0 assembly failure is non-fatal: standard evidence submits, reasons recorded', async () => {
    mockSelectResults['dispute_events'] = {
      id: 'de_1',
      stripe_dispute_id: 'dp_1',
      evidence_submitted: false,
      raw_dispute_object: { enhanced_eligibility_types: ['visa_compelling_evidence_3'] },
    };
    mockBuildCe3Evidence.mockResolvedValue({ evidence: null, reasons: ['Only 1 prior transaction(s) share enough identity elements'] });

    await defenseService.markSubmitted('def_1', 'loc_1');

    const submitArgs = mockStripeSubmitEvidence.mock.calls[0][0];
    expect(submitArgs.evidence.enhanced_evidence).toBeUndefined();
    expect(mockUpdatedRows['defense_packets']).toEqual(expect.arrayContaining([
      expect.objectContaining({ internal_debug: expect.objectContaining({ ce3_skipped_reasons: expect.any(Array) }) }),
      expect.objectContaining({ lifecycle_status: 'submitted' }),
    ]));
  });

  test('non-CE3 disputes never invoke the matching engine', async () => {
    await defenseService.markSubmitted('def_1', 'loc_1');

    expect(mockBuildCe3Evidence).not.toHaveBeenCalled();
    expect(mockStripeSubmitEvidence.mock.calls[0][0].evidence.enhanced_evidence).toBeUndefined();
  });

  test('a PDF upload failure is non-fatal: evidence still submits, error recorded on the packet', async () => {
    mockUploadDefensePacketFile.mockRejectedValue(Object.assign(new Error('Invalid request (check your POST parameters)'), { type: 'StripeInvalidRequestError' }));

    await defenseService.markSubmitted('def_1', 'loc_1');

    const submitArgs = mockStripeSubmitEvidence.mock.calls[0][0];
    expect(submitArgs.evidence.uncategorized_file).toBeUndefined();
    expect(submitArgs.evidence.uncategorized_text).toContain('disputing it');
    // The failure is recorded for the merchant/debugging, and the packet still submits
    expect(mockUpdatedRows['defense_packets']).toEqual(expect.arrayContaining([
      expect.objectContaining({ internal_debug: expect.objectContaining({ pdf_attach_error: expect.stringContaining('upload to Stripe failed') }) }),
      expect.objectContaining({ lifecycle_status: 'submitted' }),
    ]));
  });

  test('non-file values are stripped from file-only Stripe evidence fields before submission', async () => {
    mockAssembleEvidencePacket.mockResolvedValue({
      evidence: {
        receipt: 'file_receipt',                       // valid file id — kept
        refund_policy: 'No refunds after start.',      // TEXT in a file field — dropped
        customer_communication: 'supabase/comms.pdf',  // non-Stripe ref — dropped
      },
    });

    await defenseService.markSubmitted('def_1', 'loc_1');

    const submitArgs = mockStripeSubmitEvidence.mock.calls[0][0];
    expect(submitArgs.evidence.receipt).toBe('file_receipt');
    expect(submitArgs.evidence.refund_policy).toBeUndefined();
    expect(submitArgs.evidence.customer_communication).toBeUndefined();
    // Our uploaded packet PDF survives the sanitizer
    expect(submitArgs.evidence.uncategorized_file).toBe('file_123');
  });

  test('non-Stripe (NMI) packets skip the Stripe push entirely and still mark submitted', async () => {
    mockSelectResults['dispute_events'] = { id: 'de_1', stripe_dispute_id: null, evidence_submitted: false };

    await defenseService.markSubmitted('def_1', 'loc_1');

    expect(mockStripeSubmitEvidence).not.toHaveBeenCalled();
    expect(mockUploadDefensePacketFile).not.toHaveBeenCalled();
    expect(mockUpdatedRows['defense_packets']).toEqual([
      expect.objectContaining({ lifecycle_status: 'submitted' }),
    ]);
  });
});

describe('Defense Service - prepareForStripeDispute (webhook auto-prepare)', () => {
  const merchant = { id: 'merch_1', location_id: 'loc_1', stripe_user_id: 'acct_1' };
  const stripeDispute = {
    id: 'dp_1',
    payment_intent: 'pi_1',
    reason: 'fraudulent',
    amount: 5000,
    created: 1751500800,
    payment_method_details: { card: { network_reason_code: '10.4' } },
    evidence_details: { due_by: 1753228800 },
  };
  let compileSpy: jest.SpyInstance;

  beforeEach(() => {
    compileSpy = jest.spyOn(defenseService, 'compileDefense').mockResolvedValue('def_new');
    mockSelectResults['dispute_events'] = { id: 'de_1', stripe_dispute_id: 'dp_1', amount: 50, evidence_due_by: '2026-07-23T00:00:00Z' };
    mockSelectResults['payment_events'] = { id: 'pe_1', contact_id: 'c_1', enrollment_id: 'enr_1' };
    mockSelectResults['enrollments'] = { offer_id: 'offer_1' };
  });

  afterEach(() => {
    compileSpy.mockRestore();
  });

  test('compiles a packet scoped to the exact disputed transaction, preferring the network reason code', async () => {
    const result = await defenseService.prepareForStripeDispute({ merchant, stripeDispute });

    expect(result).toBe('def_new');
    expect(compileSpy).toHaveBeenCalledWith(expect.objectContaining({
      locationId: 'loc_1',
      contactId: 'c_1',
      offerId: 'offer_1',
      reasonCode: '10.4',
      disputeAmount: 50,
      caseNumber: 'dp_1',
      disputeEventId: 'de_1',
      processor: 'stripe',
      paymentEventId: 'pe_1',
      enrollmentId: 'enr_1',
    }));
    // Queue enrichment: dispute row learns its contact + payment event
    expect(mockUpdatedRows['dispute_events']).toEqual([
      expect.objectContaining({ contact_id: 'c_1', payment_event_id: 'pe_1' }),
    ]);
  });

  test('never guesses: no payment_events match means no packet (returns null)', async () => {
    delete mockSelectResults['payment_events'];

    const result = await defenseService.prepareForStripeDispute({ merchant, stripeDispute });

    expect(result).toBeNull();
    expect(compileSpy).not.toHaveBeenCalled();
    expect(mockUpdatedRows['dispute_events']).toBeUndefined();
  });

  test('idempotent: an existing packet for the dispute short-circuits', async () => {
    mockSelectResults['defense_packets'] = { id: 'def_existing' };

    const result = await defenseService.prepareForStripeDispute({ merchant, stripeDispute });

    expect(result).toBe('def_existing');
    expect(compileSpy).not.toHaveBeenCalled();
  });

  test('falls back to the Stripe reason string when no network code is present', async () => {
    const dispute = { ...stripeDispute, payment_method_details: undefined };

    await defenseService.prepareForStripeDispute({ merchant, stripeDispute: dispute });

    expect(compileSpy).toHaveBeenCalledWith(expect.objectContaining({ reasonCode: 'fraudulent' }));
  });
});
