const mockSupabaseFrom = jest.fn();
const mockResolveProcessor = jest.fn();
const mockCreateProcessorClient = jest.fn();
const mockHandleRecurringPaymentSuccess = jest.fn();
const mockHandleRecurringPaymentFailure = jest.fn();
const mockDiagnosticCreate = jest.fn();

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({
    from: (...args: any[]) => mockSupabaseFrom(...args),
  }),
}));

jest.mock('../../src/services/processor.factory', () => ({
  resolveProcessor: (...args: any[]) => mockResolveProcessor(...args),
  createProcessorClient: (...args: any[]) => mockCreateProcessorClient(...args),
}));

jest.mock('../../src/services/recurring-payment.service', () => ({
  handleRecurringPaymentSuccess: (...args: any[]) => mockHandleRecurringPaymentSuccess(...args),
  handleRecurringPaymentFailure: (...args: any[]) => mockHandleRecurringPaymentFailure(...args),
}));

jest.mock('../../src/services/nmi-diagnostic-log.service', () => ({
  nmiDiagnosticLogService: {
    create: (...args: any[]) => mockDiagnosticCreate(...args),
  },
}));

jest.mock('../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { nmiRecurringSyncService } from '../../src/services/nmi-recurring-sync.service';

function queryBuilder(response: any) {
  const builder: any = {
    select: jest.fn(() => builder),
    insert: jest.fn(() => builder),
    update: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    in: jest.fn(() => builder),
    not: jest.fn(() => builder),
    lte: jest.fn(() => builder),
    is: jest.fn(() => builder),
    order: jest.fn(() => builder),
    limit: jest.fn(() => builder),
    single: jest.fn().mockResolvedValue(response),
    maybeSingle: jest.fn().mockResolvedValue(response),
    then: (resolve: any, reject: any) => Promise.resolve(response).then(resolve, reject),
    catch: (reject: any) => Promise.resolve(response).catch(reject),
  };
  return builder;
}

const enrollment = {
  id: 'enr_1',
  merchant_id: 'merch_1',
  location_id: 'loc_1',
  contact_id: 'contact_1',
  offer_id: 'offer_1',
  payments_made: 1,
  payments_total: 3,
  payment_type: 'installment',
  processor_subscription_id: '12060786864',
  processor_type: 'nmi',
  billing_completed_at: null,
  enrolled_at: '2026-05-13T22:27:06.000Z',
  created_at: '2026-05-13T22:27:06.000Z',
};

const offer = {
  offer_name: 'Beta Tester 2',
  installment_frequency: 'daily',
  nmi_processor_id: 'nmi_mid_1',
};

function setupSupabase(existingPaymentEvents: any[] = []) {
  mockSupabaseFrom.mockImplementation((table: string) => {
    if (table === 'enrollments') return queryBuilder({ data: enrollment, error: null });
    if (table === 'offers_mirror') return queryBuilder({ data: offer, error: null });
    if (table === 'payment_events') return queryBuilder({ data: existingPaymentEvents, error: null });
    return queryBuilder({ data: [], error: null });
  });
}

describe('nmiRecurringSyncService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupSupabase();
    mockResolveProcessor.mockResolvedValue({ config: { processor_type: 'nmi' } });
    mockCreateProcessorClient.mockReturnValue({
      listSubscriptionTransactions: jest.fn().mockResolvedValue([]),
    });
    mockHandleRecurringPaymentSuccess.mockResolvedValue({
      paymentEventId: 'pe_1',
      isFinal: false,
      newPaymentsMade: 2,
    });
    mockHandleRecurringPaymentFailure.mockResolvedValue({
      paymentEventId: 'pe_failed',
    });
    mockDiagnosticCreate.mockResolvedValue('log_1');
  });

  it('imports approved NMI recurring transactions that ScaleSafe missed', async () => {
    mockCreateProcessorClient.mockReturnValue({
      listSubscriptionTransactions: jest.fn().mockResolvedValue([{
        transactionId: '12061861902',
        status: 'settled',
        amount: 33,
        occurredAt: '20260514035531',
        responseText: 'APPROVAL 327580',
        success: true,
        source: 'recurring',
      }]),
    });

    const result = await nmiRecurringSyncService.syncEnrollment('loc_1', 'enr_1');

    expect(result.imported).toBe(1);
    expect(result.failedRecorded).toBe(0);
    expect(mockResolveProcessor).toHaveBeenCalledWith('merch_1', 'loc_1', {
      processor_override: 'nmi',
      nmi_processor_id: 'nmi_mid_1',
    });
    expect(mockHandleRecurringPaymentSuccess).toHaveBeenCalledWith(expect.objectContaining({
      enrollment: expect.objectContaining({ id: 'enr_1' }),
      processorType: 'nmi',
      transactionId: '12061861902',
      amountCents: 33,
      offerName: 'Beta Tester 2',
      installmentFrequency: 'daily',
      source: 'nmi_history_sync',
    }));
    expect(mockDiagnosticCreate).toHaveBeenCalledWith(expect.objectContaining({
      action: 'history_imported_success',
      transaction_id: '12061861902',
      payment_event_id: 'pe_1',
    }));
  });

  it('does not create a duplicate payment when the NMI transaction already exists', async () => {
    setupSupabase([{ id: 'pe_existing', processor_transaction_id: '12061861902' }]);
    mockCreateProcessorClient.mockReturnValue({
      listSubscriptionTransactions: jest.fn().mockResolvedValue([{
        transactionId: '12061861902',
        status: 'settled',
        amount: 33,
        occurredAt: '20260514035531',
        responseText: 'APPROVAL 327580',
        success: true,
      }]),
    });

    const result = await nmiRecurringSyncService.syncEnrollment('loc_1', 'enr_1');

    expect(result.duplicates).toBe(1);
    expect(result.imported).toBe(0);
    expect(mockHandleRecurringPaymentSuccess).not.toHaveBeenCalled();
    expect(mockDiagnosticCreate).toHaveBeenCalledWith(expect.objectContaining({
      action: 'history_duplicate_transaction',
      duplicate: true,
      payment_event_id: 'pe_existing',
    }));
  });

  it('records failed NMI recurring transactions and triggers the dunning path', async () => {
    mockCreateProcessorClient.mockReturnValue({
      listSubscriptionTransactions: jest.fn().mockResolvedValue([{
        transactionId: '12066364402',
        status: 'failed',
        amount: 33,
        occurredAt: '20260515041657',
        responseText: 'DECLINE',
        success: false,
      }]),
    });

    const result = await nmiRecurringSyncService.syncEnrollment('loc_1', 'enr_1');

    expect(result.failedRecorded).toBe(1);
    expect(result.imported).toBe(0);
    expect(mockHandleRecurringPaymentFailure).toHaveBeenCalledWith(expect.objectContaining({
      enrollment: expect.objectContaining({ id: 'enr_1' }),
      processorType: 'nmi',
      transactionId: '12066364402',
      amountCents: 33,
      errorMessage: 'DECLINE',
      source: 'nmi_history_sync',
    }));
    expect(mockDiagnosticCreate).toHaveBeenCalledWith(expect.objectContaining({
      action: 'history_imported_failure',
      transaction_id: '12066364402',
      payment_event_id: 'pe_failed',
    }));
  });
});
