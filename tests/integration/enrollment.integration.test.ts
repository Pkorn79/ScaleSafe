/**
 * Integration test: consent → payment webhook → enrollment complete → trigger fired.
 * Uses in-memory mocks for Supabase but real service orchestration.
 */

import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockGhlPost = jest.fn();

jest.mock('../../src/clients/ghl.client', () => ({
  ghlApi: jest.fn().mockResolvedValue({
    post: mockGhlPost,
    put: jest.fn().mockResolvedValue({ data: {} }),
    get: jest.fn().mockResolvedValue({ data: {} }),
  }),
}));

jest.mock('../../src/services/enrollment-packet.service', () => ({
  enrollmentPacketService: {
    generateAndStore: jest.fn().mockResolvedValue('https://files.test/enrollment.pdf'),
  },
}));

jest.mock('../../src/services/evidence-chain.service', () => ({
  evidenceChainService: {
    verifyChain: jest.fn().mockResolvedValue({ chainStrength: 100, complete: true }),
  },
}));

// In-memory stores
const enrollmentStore: Record<string, any> = {};
const evidenceStore: any[] = [];
const paymentEventStore: any[] = [];
const triggerSubStore: any[] = [];
let idCounter = 0;

function genId() { return `test_${++idCounter}`; }

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({
    from: (table: string) => createMockTable(table),
  }),
}));

function createMockTable(table: string) {
  return {
    insert: (data: any) => ({
      select: () => ({
        single: () => {
          if (table === 'enrollments') {
            const record = { id: genId(), ...data, payments_made: data.payments_made || 0 };
            enrollmentStore[record.id] = record;
            return { data: record, error: null };
          }
          if (table === 'evidence') {
            const record = { id: genId(), ...data };
            evidenceStore.push(record);
            return { data: record, error: null };
          }
          if (table === 'payment_events') {
            const record = { id: genId(), ...data };
            paymentEventStore.push(record);
            return { data: record, error: null };
          }
          if (table === 'trigger_subscriptions') {
            triggerSubStore.push(data);
            return { data, error: null };
          }
          return { data: { id: genId(), ...data }, error: null };
        },
      }),
    }),
    upsert: (data: any, _opts: any) => ({
      select: () => ({
        single: () => {
          if (table === 'trigger_subscriptions') {
            triggerSubStore.push(data);
          }
          return { data, error: null };
        },
      }),
    }),
    select: (..._args: any[]) => ({
      eq: (col: string, val: any) => createEqChain(table, { [col]: val }),
    }),
    update: (updates: any) => ({
      eq: (col: string, val: any) => {
        if (table === 'enrollments' && col === 'id') {
          if (enrollmentStore[val]) {
            Object.assign(enrollmentStore[val], updates);
          }
          return {
            select: () => ({
              single: () => ({ data: enrollmentStore[val], error: null }),
            }),
          };
        }
        return { select: () => ({ single: () => ({ data: null, error: null }) }) };
      },
    }),
  };
}

function createEqChain(table: string, filters: Record<string, any>): any {
  const chain: any = {};
  chain.eq = (col: string, val: any) => {
    filters[col] = val;
    return createEqChain(table, filters);
  };
  chain.in = (col: string, vals: any[]) => {
    filters[`${col}_in`] = vals;
    return createEqChain(table, filters);
  };
  chain.order = () => createEqChain(table, filters);
  chain.limit = () => createEqChain(table, filters);
  chain.range = () => {
    // For list queries
    if (table === 'enrollments') {
      const results = Object.values(enrollmentStore).filter((e: any) => {
        if (filters.location_id && e.location_id !== filters.location_id) return false;
        if (filters.status && e.status !== filters.status) return false;
        return true;
      });
      return { data: results, error: null, count: results.length };
    }
    return { data: [], error: null, count: 0 };
  };
  chain.single = () => {
    if (table === 'enrollments') {
      if (filters.consent_token) {
        const match = Object.values(enrollmentStore).find((e: any) => e.consent_token === filters.consent_token);
        return { data: match || null, error: match ? null : { code: 'PGRST116' } };
      }
      if (filters.id) {
        return { data: enrollmentStore[filters.id] || null, error: enrollmentStore[filters.id] ? null : { code: 'PGRST116' } };
      }
      const match = Object.values(enrollmentStore).find((e: any) => {
        if (filters.contact_id && e.contact_id !== filters.contact_id) return false;
        if (filters.offer_id && e.offer_id !== filters.offer_id) return false;
        if (filters.location_id && e.location_id !== filters.location_id) return false;
        if (filters.status && e.status !== filters.status) return false;
        return true;
      });
      return { data: match || null, error: match ? null : { code: 'PGRST116' } };
    }
    if (table === 'evidence') {
      const results = evidenceStore.filter((e: any) => {
        if (filters.enrollment_id && e.enrollment_id !== filters.enrollment_id) return false;
        return true;
      });
      return { data: results[0] || null, error: results[0] ? null : { code: 'PGRST116' } };
    }
    if (table === 'payment_events') {
      if (filters.processor && filters.processor_transaction_id) {
        const match = paymentEventStore.find(
          (pe: any) => pe.processor === filters.processor && pe.processor_transaction_id === filters.processor_transaction_id,
        );
        return { data: match || null, error: match ? null : { code: 'PGRST116' } };
      }
      const results = paymentEventStore.filter((pe: any) => {
        if (filters.enrollment_id && pe.enrollment_id !== filters.enrollment_id) return false;
        return true;
      });
      return { data: results[0] || null, error: results[0] ? null : { code: 'PGRST116' } };
    }
    if (table === 'trigger_subscriptions') {
      return { data: null, error: { code: 'PGRST116' } };
    }
    return { data: null, error: { code: 'PGRST116' } };
  };
  // For evidence findByEnrollment (returns array)
  if (table === 'evidence') {
    chain.single = undefined;
    const origOrder = chain.order;
    chain.order = () => {
      const results = evidenceStore.filter((e: any) => {
        if (filters.enrollment_id && e.enrollment_id !== filters.enrollment_id) return false;
        if (filters.evidence_type && e.evidence_type !== filters.evidence_type) return false;
        return true;
      });
      return { data: results, error: null };
    };
  }
  // For payment_events findByEnrollment (returns array)
  if (table === 'payment_events' && !filters.processor_transaction_id) {
    const origSingle = chain.single;
    chain.order = () => {
      const results = paymentEventStore.filter((pe: any) => {
        if (filters.enrollment_id && pe.enrollment_id !== filters.enrollment_id) return false;
        return true;
      });
      return { data: results, error: null };
    };
  }
  // trigger_subscriptions for fireTrigger
  if (table === 'trigger_subscriptions') {
    chain.single = undefined;
    chain.eq = (col: string, val: any) => {
      filters[col] = val;
      if (col === 'is_active') {
        const results = triggerSubStore.filter((s: any) => {
          if (filters.location_id && s.location_id !== filters.location_id) return false;
          if (filters.trigger_key && s.trigger_key !== filters.trigger_key) return false;
          return s.is_active === val;
        });
        return { data: results, error: null };
      }
      return createEqChain(table, filters);
    };
  }
  return chain;
}

jest.mock('../../src/repositories/offer.repository', () => ({
  offerRepository: {
    findById: jest.fn().mockResolvedValue({
      id: 'offer_1',
      offer_name: 'Test Program',
      active: true,
      location_id: 'loc_1',
      ghl_product_id: 'prod_ghl_1',
    }),
    getById: jest.fn().mockResolvedValue({
      id: 'offer_1',
      offer_name: 'Test Program',
      active: true,
      location_id: 'loc_1',
      ghl_product_id: 'prod_ghl_1',
    }),
    listByLocation: jest.fn().mockResolvedValue([{
      id: 'offer_1',
      offer_name: 'Test Program',
      ghl_product_id: 'prod_ghl_1',
    }]),
  },
}));

jest.mock('../../src/repositories/merchant.repository', () => ({
  merchantRepository: {
    findByLocationId: jest.fn().mockResolvedValue({ id: 'merchant_1' }),
    getByLocationId: jest.fn().mockResolvedValue({ id: 'merchant_1', business_name: 'Test Merchant', config: {} }),
  },
}));

import { consentService } from '../../src/services/consent.service';
import { phase2EnrollmentService } from '../../src/services/phase2Enrollment.service';
import { triggerRepository } from '../../src/repositories/trigger.repository';

beforeEach(() => {
  jest.clearAllMocks();
  idCounter = 0;
  for (const key of Object.keys(enrollmentStore)) delete enrollmentStore[key];
  evidenceStore.length = 0;
  paymentEventStore.length = 0;
  triggerSubStore.length = 0;
  mockedAxios.post.mockResolvedValue({ status: 200, data: {} });
  mockGhlPost.mockResolvedValue({ status: 200, data: {} });
});

describe('Enrollment Integration — full lifecycle', () => {
  test('consent → payment → enrollment complete → trigger fired', async () => {
    // Subscribe a trigger
    await triggerRepository.upsertSubscription(
      'loc_1',
      'enrollment_complete',
      'https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/loc_1/wf_enrollment',
    );

    // Step 1: Capture consent
    const consent = await consentService.captureConsent({
      offerId: 'offer_1',
      locationId: 'loc_1',
      contactId: 'contact_1',
      contactEmail: 'john@test.com',
      contactName: 'John Smith',
      ip: '1.2.3.4',
      device: 'desktop',
      browser: 'Chrome',
      tcVersionHash: 'hash_abc',
      signatureText: 'John Smith',
    });

    expect(consent.consentToken).toBeDefined();
    expect(consent.enrollmentId).toBeDefined();

    // Verify enrollment was created with consent_captured
    const enrollmentId = consent.enrollmentId;
    expect(enrollmentStore[enrollmentId].status).toBe('consent_captured');

    // Verify consent evidence was logged
    const consentEvidence = evidenceStore.find(e => e.evidence_type === 'enrollment_consent');
    expect(consentEvidence).toBeDefined();
    expect(consentEvidence.data.signature_text).toBe('John Smith');

    // Step 2: Complete enrollment (simulating what the webhook handler does)
    await phase2EnrollmentService.completeEnrollment({
      enrollmentId,
      locationId: 'loc_1',
      contactId: 'contact_1',
      paymentAmount: 2997,
      paymentType: 'pif',
      transactionId: 'txn_123',
      paymentsTotal: null,
    });
    await new Promise(resolve => setImmediate(resolve));

    // Verify enrollment updated to enrolled
    expect(enrollmentStore[enrollmentId].status).toBe('enrolled');
    expect(enrollmentStore[enrollmentId].payment_amount).toBe(2997);

    // Verify payment evidence logged
    const paymentEvidence = evidenceStore.find(e => e.evidence_type === 'enrollment_payment');
    expect(paymentEvidence).toBeDefined();

    // Verify payment_event created
    expect(paymentEventStore.length).toBeGreaterThan(0);
    expect(paymentEventStore[0].event_type).toBe('payment_success');
    expect(paymentEventStore[0].processor).toBe('ghl');

    // Verify trigger was fired
    expect(mockGhlPost).toHaveBeenCalledWith(
      'https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/loc_1/wf_enrollment',
      expect.objectContaining({
        contact_id: 'contact_1',
        offer_name: 'Test Program',
        amount: 2997,
        bump_1_accepted: false,
      }),
      expect.any(Object),
    );
  });

  test('recurring payment fires ss_payment_received trigger', async () => {
    // Setup: create an enrolled enrollment
    await triggerRepository.upsertSubscription(
      'loc_1',
      'ss_payment_received',
      'https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/loc_1/wf_payment',
    );

    const consent = await consentService.captureConsent({
      offerId: 'offer_1',
      locationId: 'loc_1',
      contactId: 'contact_2',
      contactEmail: 'jane@test.com',
      contactName: 'Jane Doe',
      ip: '5.6.7.8',
      device: 'mobile',
      browser: 'Safari',
      tcVersionHash: 'hash_def',
      signatureText: 'Jane Doe',
    });

    // Complete initial enrollment
    await phase2EnrollmentService.completeEnrollment({
      enrollmentId: consent.enrollmentId,
      locationId: 'loc_1',
      contactId: 'contact_2',
      paymentAmount: 500,
      paymentType: 'installment',
      transactionId: 'txn_first',
      paymentsTotal: 6,
    });

    // Clear axios mock to isolate recurring payment trigger
    mockedAxios.post.mockClear();
    mockedAxios.post.mockResolvedValue({ status: 200, data: {} });
    mockGhlPost.mockClear();
    mockGhlPost.mockResolvedValue({ status: 200, data: {} });

    // Recurring payment
    await phase2EnrollmentService.handleRecurringPayment({
      locationId: 'loc_1',
      contactId: 'contact_2',
      enrollmentId: consent.enrollmentId,
      amount: 500,
      transactionId: 'txn_recurring_2',
      paymentNumber: 2,
      paymentsRemaining: 4,
    });
    await new Promise(resolve => setImmediate(resolve));

    // Verify ss_payment_received trigger fired
    expect(mockGhlPost).toHaveBeenCalledWith(
      'https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/loc_1/wf_payment',
      expect.objectContaining({
        contact_id: 'contact_2',
        amount: 500,
      }),
      expect.any(Object),
    );

    // Verify payment evidence logged
    const recurringEvidence = evidenceStore.filter(e => e.evidence_type === 'payment_received');
    expect(recurringEvidence.length).toBeGreaterThan(0);
  });

  test('getEnrollmentDetails returns enrollment with evidence and payments', async () => {
    const consent = await consentService.captureConsent({
      offerId: 'offer_1',
      locationId: 'loc_1',
      contactId: 'contact_3',
      contactEmail: 'bob@test.com',
      contactName: 'Bob',
      ip: '9.10.11.12',
      device: 'desktop',
      browser: 'Firefox',
      tcVersionHash: 'hash_ghi',
      signatureText: 'Bob',
    });

    await phase2EnrollmentService.completeEnrollment({
      enrollmentId: consent.enrollmentId,
      locationId: 'loc_1',
      contactId: 'contact_3',
      paymentAmount: 1000,
      paymentType: 'pif',
      transactionId: 'txn_bob',
      paymentsTotal: null,
    });

    const details = await phase2EnrollmentService.getEnrollmentDetails(
      consent.enrollmentId, 'loc_1',
    );

    expect(details.enrollment.id).toBe(consent.enrollmentId);
    expect(details.evidence.length).toBeGreaterThan(0);
    expect(details.paymentEvents.length).toBeGreaterThan(0);
  });
});
