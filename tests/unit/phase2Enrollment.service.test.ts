const mockEnrollmentGetById = jest.fn();
const mockEnrollmentUpdateStatus = jest.fn();
const mockEnrollmentIncrementPayments = jest.fn();
const mockEvidenceCreate = jest.fn();
const mockPaymentEventCreate = jest.fn();
const mockPaymentEventFindByEnrollment = jest.fn();
const mockEvidenceFindByEnrollment = jest.fn();
const mockOfferGetById = jest.fn();
const mockFireTrigger = jest.fn();

function flushBackgroundTasks(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({}),
}));

jest.mock('../../src/repositories/enrollment.repository', () => ({
  enrollmentRepository: {
    getById: (...args: any[]) => mockEnrollmentGetById(...args),
    updateStatus: (...args: any[]) => mockEnrollmentUpdateStatus(...args),
    incrementPaymentsMade: (...args: any[]) => mockEnrollmentIncrementPayments(...args),
  },
}));

jest.mock('../../src/repositories/phase2Evidence.repository', () => ({
  phase2EvidenceRepository: {
    create: (...args: any[]) => mockEvidenceCreate(...args),
    findByEnrollment: (...args: any[]) => mockEvidenceFindByEnrollment(...args),
  },
}));

jest.mock('../../src/repositories/paymentEvent.repository', () => ({
  paymentEventRepository: {
    create: (...args: any[]) => mockPaymentEventCreate(...args),
    findByEnrollment: (...args: any[]) => mockPaymentEventFindByEnrollment(...args),
  },
}));

jest.mock('../../src/repositories/offer.repository', () => ({
  offerRepository: {
    getById: (...args: any[]) => mockOfferGetById(...args),
  },
}));

jest.mock('../../src/services/trigger.service', () => ({
  triggerService: {
    fireTrigger: (...args: any[]) => mockFireTrigger(...args),
  },
}));

import { phase2EnrollmentService } from '../../src/services/phase2Enrollment.service';

beforeEach(() => {
  jest.clearAllMocks();

  mockEnrollmentGetById.mockResolvedValue({
    id: 'enr_1',
    location_id: 'loc_1',
    contact_id: 'contact_1',
    offer_id: 'offer_1',
    status: 'consent_captured',
    payments_made: 0,
    payments_total: 6,
  });
  mockEnrollmentUpdateStatus.mockResolvedValue({ id: 'enr_1', status: 'enrolled' });
  mockEnrollmentIncrementPayments.mockResolvedValue(undefined);
  mockEvidenceCreate.mockResolvedValue({ id: 'ev_1' });
  mockPaymentEventCreate.mockResolvedValue({ id: 'pe_1' });
  mockOfferGetById.mockResolvedValue({ id: 'offer_1', offer_name: 'Test Program' });
  mockFireTrigger.mockResolvedValue({ sent: 1, failed: 0 });
  mockEvidenceFindByEnrollment.mockResolvedValue([]);
  mockPaymentEventFindByEnrollment.mockResolvedValue([]);
});

describe('Phase 2 Enrollment Service - completeEnrollment', () => {
  const params = {
    enrollmentId: 'enr_1',
    locationId: 'loc_1',
    contactId: 'contact_1',
    paymentAmount: 2997,
    paymentType: 'pif',
    transactionId: 'txn_123',
    paymentsTotal: null,
  };

  test('updates enrollment to enrolled status', async () => {
    await phase2EnrollmentService.completeEnrollment(params);

    expect(mockEnrollmentUpdateStatus).toHaveBeenCalledWith(
      'enr_1',
      'enrolled',
      expect.objectContaining({
        payment_amount: 2997,
        payment_type: 'pif',
        payment_transaction_id: 'txn_123',
        payments_made: 1,
      }),
      'loc_1',
    );
  });

  test('logs enrollment_payment evidence', async () => {
    await phase2EnrollmentService.completeEnrollment(params);

    expect(mockEvidenceCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        evidence_type: 'enrollment_payment',
        enrollment_id: 'enr_1',
        data: expect.objectContaining({
          amount: 2997,
          payment_type: 'pif',
          transaction_id: 'txn_123',
        }),
      }),
    );
  });

  test('creates payment_event record', async () => {
    await phase2EnrollmentService.completeEnrollment(params);

    expect(mockPaymentEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'payment_success',
        processor: 'ghl',
        processor_transaction_id: 'txn_123',
        amount: 2997,
        payment_number: 1,
      }),
    );
  });

  test('fires enrollment_complete trigger with bump defaults', async () => {
    await phase2EnrollmentService.completeEnrollment(params);
    await flushBackgroundTasks();

    expect(mockFireTrigger).toHaveBeenCalledWith(
      'loc_1',
      'enrollment_complete',
      expect.objectContaining({
        contact_id: 'contact_1',
        offer_name: 'Test Program',
        amount: 2997,
        bump_1_accepted: false,
        bump_2_accepted: false,
      }),
    );
  });
});

describe('Phase 2 Enrollment Service - handleRecurringPayment', () => {
  test('creates payment event, increments, logs evidence, fires trigger', async () => {
    await phase2EnrollmentService.handleRecurringPayment({
      locationId: 'loc_1',
      contactId: 'contact_1',
      enrollmentId: 'enr_1',
      amount: 500,
      transactionId: 'txn_456',
      paymentNumber: 2,
      paymentsRemaining: 4,
    });

    expect(mockPaymentEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'payment_success',
        amount: 500,
        payment_number: 2,
        payments_remaining: 4,
      }),
    );
    expect(mockEnrollmentIncrementPayments).toHaveBeenCalledWith('enr_1', 'loc_1');
    expect(mockEvidenceCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        evidence_type: 'payment_received',
      }),
    );
    expect(mockFireTrigger).toHaveBeenCalledWith(
      'loc_1',
      'ss_payment_received',
      expect.objectContaining({ contact_id: 'contact_1', amount: 500 }),
    );
  });
});

describe('Phase 2 Enrollment Service - handleFailedPayment', () => {
  test('creates payment event and fires trigger', async () => {
    await phase2EnrollmentService.handleFailedPayment({
      locationId: 'loc_1',
      contactId: 'contact_1',
      enrollmentId: 'enr_1',
      amount: 500,
      failureReason: 'insufficient_funds',
      attemptCount: 2,
    });

    expect(mockPaymentEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'payment_failed',
        failure_reason: 'insufficient_funds',
        attempt_count: 2,
      }),
    );
    expect(mockFireTrigger).toHaveBeenCalledWith(
      'loc_1',
      'ss_payment_failed',
      expect.objectContaining({
        contact_id: 'contact_1',
        failure_reason: 'insufficient_funds',
      }),
    );
  });
});

describe('Phase 2 Enrollment Service - handleRefund', () => {
  test('creates payment event and fires trigger', async () => {
    await phase2EnrollmentService.handleRefund({
      locationId: 'loc_1',
      contactId: 'contact_1',
      enrollmentId: 'enr_1',
      amount: 2997,
      reason: 'customer_request',
    });

    expect(mockPaymentEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'refund',
        amount: 2997,
      }),
    );
    expect(mockFireTrigger).toHaveBeenCalledWith(
      'loc_1',
      'ss_refund_processed',
      expect.objectContaining({
        contact_id: 'contact_1',
        amount: 2997,
        reason: 'customer_request',
      }),
    );
  });
});

describe('Phase 2 Enrollment Service - getEnrollmentDetails', () => {
  test('returns enrollment with evidence and payment events', async () => {
    const result = await phase2EnrollmentService.getEnrollmentDetails('enr_1', 'loc_1');

    expect(result.enrollment.id).toBe('enr_1');
    expect(Array.isArray(result.evidence)).toBe(true);
    expect(Array.isArray(result.paymentEvents)).toBe(true);
  });

  test('throws when enrollment belongs to different location', async () => {
    mockEnrollmentGetById.mockResolvedValue({
      id: 'enr_1',
      location_id: 'loc_OTHER',
    });

    await expect(
      phase2EnrollmentService.getEnrollmentDetails('enr_1', 'loc_1'),
    ).rejects.toThrow('not found');
  });
});
