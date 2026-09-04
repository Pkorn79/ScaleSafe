const mockResolveProcessor = jest.fn();
const mockCreateProcessorClient = jest.fn();
const mockHandleRecurringPaymentSuccess = jest.fn();
const mockHandleRecurringPaymentFailure = jest.fn();
const mockDiagnosticCreate = jest.fn();
const mockDiagnosticUpdate = jest.fn();
const mockSupabaseFrom = jest.fn();

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
    update: (...args: any[]) => mockDiagnosticUpdate(...args),
  },
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { handleNmiSilentPost } from '../../src/controllers/nmi-silent-post.controller';

interface QueryResult {
  data: any;
  error: any;
}

const enrollment = {
  id: 'enr_1',
  merchant_id: 'merch_1',
  location_id: 'loc_1',
  contact_id: 'contact_1',
  offer_id: 'offer_1',
  program_name_snapshot: 'Snapshot Offer',
  payments_made: 1,
  payments_total: 3,
  payment_type: 'installment',
  processor_subscription_id: 'sub_1',
  processor_config_id: 'config_1',
  processor_type: 'nmi',
  billing_completed_at: null,
  status: 'active',
};

let tableResults: Record<string, QueryResult>;
const buildersByTable: Record<string, any[]> = {};

function queryBuilder(result: QueryResult) {
  const builder: any = {
    select: jest.fn(() => builder),
    insert: jest.fn(() => builder),
    update: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    limit: jest.fn(() => builder),
    maybeSingle: jest.fn(async () => ({
      data: Array.isArray(result.data) ? (result.data[0] ?? null) : result.data,
      error: result.error,
    })),
    single: jest.fn(async () => ({
      data: Array.isArray(result.data) ? (result.data[0] ?? null) : result.data,
      error: result.error,
    })),
    then: (onFulfilled: any, onRejected: any) => Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return builder;
}

function createReqRes(body: Record<string, unknown>) {
  const req = { body } as any;
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  } as any;
  return { req, res };
}

function verifiedSale(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    transactionId: 'txn_1',
    status: 'settled',
    amount: 5000,
    source: 'recurring',
    action: 'sale',
    actionSucceeded: true,
    responseCode: '100',
    responseText: 'APPROVED',
    ...overrides,
  };
}

async function post(body: Record<string, unknown> = {}) {
  const { req, res } = createReqRes({
    subscription_id: 'sub_1',
    transactionid: 'txn_1',
    response: '2',
    amount: '999999.00',
    responsetext: 'ATTACKER CONTROLLED',
    ...body,
  });
  await handleNmiSilentPost(req, res);
  return res;
}

describe('NMI legacy Silent Post containment', () => {
  let verifyTransaction: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    tableResults = {
      enrollments: { data: [enrollment], error: null },
      offers_mirror: {
        data: { offer_name: 'Test Offer', installment_frequency: 'monthly', nmi_processor_id: null },
        error: null,
      },
      payment_events: { data: null, error: null },
    };
    for (const key of Object.keys(buildersByTable)) delete buildersByTable[key];
    mockSupabaseFrom.mockImplementation((table: string) => {
      const builder = queryBuilder(tableResults[table] || { data: null, error: null });
      (buildersByTable[table] ||= []).push(builder);
      return builder;
    });
    mockDiagnosticCreate.mockResolvedValue('diag_1');
    mockDiagnosticUpdate.mockResolvedValue(undefined);
    mockResolveProcessor.mockResolvedValue({
      config: { id: 'config_1', processor_type: 'nmi', nmi_processor_id: null },
    });
    verifyTransaction = jest.fn().mockImplementation(async (transactionId: string) => (
      verifiedSale({ transactionId })
    ));
    mockCreateProcessorClient.mockReturnValue({
      verifyTransaction,
      listSubscriptionTransactions: jest.fn().mockResolvedValue([{
        transactionId: 'txn_1', status: 'failed', amount: 5000, success: false,
      }]),
    });
    mockHandleRecurringPaymentSuccess.mockResolvedValue({
      paymentEventId: 'pe_1', newPaymentsMade: 2, isFinal: false, duplicate: false,
    });
    mockHandleRecurringPaymentFailure.mockResolvedValue({ paymentEventId: 'pe_failed', duplicate: false });
  });

  it('uses one exact NMI binding and only provider-verified sale facts', async () => {
    const res = await post();

    expect(buildersByTable.enrollments[0].eq).toHaveBeenCalledWith('processor_subscription_id', 'sub_1');
    expect(buildersByTable.enrollments[0].eq).toHaveBeenCalledWith('processor_type', 'nmi');
    expect(buildersByTable.enrollments[0].limit).toHaveBeenCalledWith(2);
    expect(verifyTransaction).toHaveBeenCalledWith('txn_1', {
      subscriptionId: 'sub_1', source: 'recurring', action: 'sale',
    });
    expect(mockHandleRecurringPaymentSuccess).toHaveBeenCalledWith(expect.objectContaining({
      enrollment: expect.objectContaining({ id: 'enr_1', location_id: 'loc_1' }),
      transactionId: 'txn_1',
      amountCents: 5000,
      processorConfigId: 'config_1',
    }));
    expect(mockHandleRecurringPaymentFailure).not.toHaveBeenCalled();
    expect(mockDiagnosticUpdate).toHaveBeenCalledWith('diag_1', expect.objectContaining({
      amount: 50,
      response_code: '100',
      response_text: 'APPROVED',
    }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('accepts reference_id as the exact stored subscription identifier', async () => {
    const res = await post({ subscription_id: '', reference_id: 'sub_1' });

    expect(verifyTransaction).toHaveBeenCalledWith('txn_1', expect.objectContaining({ subscriptionId: 'sub_1' }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('does not try tenant credentials when a subscription binding is ambiguous', async () => {
    tableResults.enrollments.data = [
      enrollment,
      { ...enrollment, id: 'enr_2', merchant_id: 'merch_2', location_id: 'loc_2' },
    ];

    const res = await post();

    expect(mockResolveProcessor).not.toHaveBeenCalled();
    expect(mockCreateProcessorClient).not.toHaveBeenCalled();
    expect(verifyTransaction).not.toHaveBeenCalled();
    expect(mockHandleRecurringPaymentSuccess).not.toHaveBeenCalled();
    expect(mockDiagnosticUpdate).toHaveBeenCalledWith('diag_1', expect.objectContaining({
      action: 'ignored_ambiguous_subscription',
    }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('does not call NMI when no exact binding exists', async () => {
    tableResults.enrollments.data = [];

    const res = await post();

    expect(mockResolveProcessor).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('rejects oversized identifiers before any database or provider lookup', async () => {
    const res = await post({ transactionid: 'x'.repeat(129) });

    expect(mockSupabaseFrom).not.toHaveBeenCalled();
    expect(mockResolveProcessor).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns retryable non-2xx when the binding lookup fails', async () => {
    tableResults.enrollments = { data: null, error: { message: 'database unavailable' } };

    const res = await post();

    expect(mockResolveProcessor).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ received: false, retry: true });
  });

  it('returns retryable non-2xx when NMI verification fails temporarily', async () => {
    verifyTransaction.mockRejectedValue(new Error('query API timeout'));

    const res = await post();

    expect(mockHandleRecurringPaymentSuccess).not.toHaveBeenCalled();
    expect(mockHandleRecurringPaymentFailure).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it.each(['pending', 'unknown'])('rejects a provider %s status without recording payment state', async (status) => {
    verifyTransaction.mockResolvedValue(verifiedSale({ status }));

    const res = await post();

    expect(mockHandleRecurringPaymentSuccess).not.toHaveBeenCalled();
    expect(mockHandleRecurringPaymentFailure).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it.each([
    [{ action: 'auth' }, 'ignored_non_recurring_sale'],
    [{ source: 'api' }, 'ignored_non_recurring_sale'],
    [{ subscriptionId: 'different_sub' }, 'ignored_subscription_mismatch'],
    [{ status: 'voided', actionSucceeded: true }, 'ignored_non_sale_result'],
  ])('rejects a provider result outside the recurring sale boundary', async (overrides, action) => {
    verifyTransaction.mockResolvedValue(verifiedSale(overrides));

    const res = await post();

    expect(mockHandleRecurringPaymentSuccess).not.toHaveBeenCalled();
    expect(mockHandleRecurringPaymentFailure).not.toHaveBeenCalled();
    expect(mockDiagnosticUpdate).toHaveBeenCalledWith('diag_1', expect.objectContaining({ action }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('uses provider failure facts and ignores a forged approved callback', async () => {
    verifyTransaction.mockResolvedValue(verifiedSale({
      status: 'failed',
      amount: 2300,
      actionSucceeded: false,
      responseCode: '200',
      processorResponseCode: '05',
      responseText: 'DECLINED',
    }));

    const res = await post({ response: '1', amount: '1.00', responsetext: 'APPROVED' });

    expect(mockHandleRecurringPaymentFailure).toHaveBeenCalledWith(expect.objectContaining({
      transactionId: 'txn_1',
      amountCents: 2300,
      errorMessage: 'DECLINED',
      errorCode: '05',
      processorConfigId: 'config_1',
    }));
    expect(mockHandleRecurringPaymentSuccess).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns retryable non-2xx for an invalid provider amount', async () => {
    verifyTransaction.mockResolvedValue(verifiedSale({ amount: 0 }));

    const res = await post();

    expect(mockHandleRecurringPaymentSuccess).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('handles an existing transaction deterministically before calling NMI', async () => {
    tableResults.payment_events.data = { id: 'pe_existing' };

    const res = await post();

    expect(buildersByTable.payment_events[0].eq).toHaveBeenCalledWith('processor', 'nmi');
    expect(buildersByTable.payment_events[0].eq).toHaveBeenCalledWith('merchant_id', 'merch_1');
    expect(verifyTransaction).not.toHaveBeenCalled();
    expect(mockHandleRecurringPaymentSuccess).not.toHaveBeenCalled();
    expect(mockDiagnosticUpdate).toHaveBeenCalledWith('diag_1', expect.objectContaining({
      duplicate: true,
      payment_event_id: 'pe_existing',
    }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns retryable non-2xx when duplicate detection fails', async () => {
    tableResults.payment_events.error = { message: 'database timeout' };

    const res = await post();

    expect(verifyTransaction).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('does not process terminal enrollment bindings', async () => {
    tableResults.enrollments.data = [{ ...enrollment, status: 'completed' }];

    const res = await post();

    expect(mockResolveProcessor).not.toHaveBeenCalled();
    expect(verifyTransaction).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns retryable non-2xx when the payment handler cannot commit', async () => {
    mockHandleRecurringPaymentSuccess.mockRejectedValue(new Error('record_recurring_payment unavailable'));

    const res = await post();

    expect(res.status).toHaveBeenCalledWith(503);
  });
});
