const mockResolveProcessor = jest.fn();
const mockCreateProcessorClient = jest.fn();
const mockHandleRecurringPaymentSuccess = jest.fn();
const mockHandleRecurringPaymentFailure = jest.fn();
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

import { handleNmiSilentPost } from '../../src/controllers/nmi-silent-post.controller';

function createReqRes(body: Record<string, unknown>) {
  const req = { body } as any;
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  } as any;
  return { req, res };
}

function queryBuilder(data: any) {
  const first = Array.isArray(data) ? (data[0] ?? null) : data;
  const list = Array.isArray(data) ? data : (data ? [data] : []);
  const builder: any = {
    select: jest.fn(() => builder),
    insert: jest.fn(() => builder),
    update: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    limit: jest.fn(() => builder),
    maybeSingle: jest.fn().mockResolvedValue({ data: first }),
    single: jest.fn().mockResolvedValue({ data: first }),
    then: (onF: any, onR: any) => Promise.resolve({ data: list, error: null }).then(onF, onR),
  };
  return builder;
}

describe('NMI Silent Post webhook', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'enrollments') {
        return queryBuilder({
          id: 'enr_1',
          merchant_id: 'merch_1',
          location_id: 'loc_1',
          contact_id: 'contact_1',
          offer_id: 'offer_1',
          payments_made: 1,
          payments_total: 3,
          payment_type: 'installment',
        });
      }
      if (table === 'payment_events') {
        return queryBuilder(null);
      }
      if (table === 'offers_mirror') {
        return queryBuilder({
          offer_name: 'Test Offer',
          installment_frequency: 'monthly',
        });
      }
      return queryBuilder(null);
    });

    mockResolveProcessor.mockResolvedValue({ config: { processor_type: 'nmi' } });
    mockCreateProcessorClient.mockReturnValue({
      verifyTransaction: jest.fn().mockResolvedValue({ success: true, status: 'settled' }),
    });
    mockHandleRecurringPaymentSuccess.mockResolvedValue({ newPaymentsMade: 2, isFinal: false });
    mockHandleRecurringPaymentFailure.mockResolvedValue(undefined);
  });

  it('processes approved posts only after processor verification succeeds', async () => {
    const { req, res } = createReqRes({
      subscription_id: 'sub_1',
      response: '1',
      transactionid: 'txn_1',
      amount: '10.00',
    });

    await handleNmiSilentPost(req, res);

    expect(mockResolveProcessor).toHaveBeenCalledWith('merch_1', 'loc_1', {
      processor_override: 'nmi',
      nmi_processor_id: null,
    });
    expect(mockHandleRecurringPaymentSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        enrollment: expect.objectContaining({ id: 'enr_1' }),
        processorType: 'nmi',
        transactionId: 'txn_1',
        amountCents: 1000,
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('uses NMI reference_id as the recurring subscription id when subscription_id is absent', async () => {
    const { req, res } = createReqRes({
      reference_id: '12034762268',
      response: '1',
      id: '12036110931',
      amount: '0.50',
    });

    await handleNmiSilentPost(req, res);

    const enrollmentBuilder = mockSupabaseFrom.mock.results.find(
      (result) => result.value.eq.mock.calls.some((call: any[]) => call[0] === 'processor_subscription_id'),
    )?.value;

    expect(enrollmentBuilder.eq).toHaveBeenCalledWith('processor_subscription_id', '12034762268');
    expect(mockHandleRecurringPaymentSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        processorType: 'nmi',
        transactionId: '12036110931',
        amountCents: 50,
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('does not process approved posts when processor verification throws', async () => {
    mockCreateProcessorClient.mockReturnValue({
      verifyTransaction: jest.fn().mockRejectedValue(new Error('query api unavailable')),
    });

    const { req, res } = createReqRes({
      subscription_id: 'sub_1',
      response: '1',
      transactionid: 'txn_spoof',
      amount: '10.00',
    });

    await handleNmiSilentPost(req, res);

    expect(mockHandleRecurringPaymentSuccess).not.toHaveBeenCalled();
    expect(mockHandleRecurringPaymentFailure).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it('does not process approved posts when processor verification returns unsuccessful', async () => {
    mockCreateProcessorClient.mockReturnValue({
      verifyTransaction: jest.fn().mockResolvedValue({ success: false, status: 'failed' }),
    });

    const { req, res } = createReqRes({
      subscription_id: 'sub_1',
      response: '1',
      transactionid: 'txn_failed_verify',
      amount: '10.00',
    });

    await handleNmiSilentPost(req, res);

    expect(mockHandleRecurringPaymentSuccess).not.toHaveBeenCalled();
    expect(mockHandleRecurringPaymentFailure).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('does not process approved posts that do not include a transaction id', async () => {
    const { req, res } = createReqRes({
      subscription_id: 'sub_1',
      response: '1',
      amount: '10.00',
    });

    await handleNmiSilentPost(req, res);

    expect(mockResolveProcessor).not.toHaveBeenCalled();
    expect(mockHandleRecurringPaymentSuccess).not.toHaveBeenCalled();
    expect(mockHandleRecurringPaymentFailure).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('NMI Silent Post — tenant scoping and processor-verified values', () => {
  const ENR_A = {
    id: 'enr_a', merchant_id: 'merch_a', location_id: 'loc_a', contact_id: 'c_a',
    offer_id: null, payments_made: 1, payments_total: 3, payment_type: 'installment',
  };
  const ENR_B = {
    id: 'enr_b', merchant_id: 'merch_b', location_id: 'loc_b', contact_id: 'c_b',
    offer_id: null, payments_made: 1, payments_total: 3, payment_type: 'installment',
  };

  function primeEnrollments(rows: any) {
    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'enrollments') return queryBuilder(rows);
      if (table === 'payment_events') return queryBuilder(null);
      if (table === 'offers_mirror') return queryBuilder(null);
      return queryBuilder(null);
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockHandleRecurringPaymentSuccess.mockResolvedValue({ newPaymentsMade: 2, isFinal: false });
    mockHandleRecurringPaymentFailure.mockResolvedValue(undefined);
    mockResolveProcessor.mockImplementation(async (merchantId: string) => ({
      config: { processor_type: 'nmi', merchant_id: merchantId },
    }));
  });

  it('attributes a colliding subscription id to the tenant whose gateway verifies the transaction', async () => {
    // NMI subscription ids are gateway-sequential: two merchants can share
    // '123456'. The post must land on the tenant that can verify the txn.
    primeEnrollments([ENR_A, ENR_B]);
    mockCreateProcessorClient.mockImplementation((cfg: any) => ({
      verifyTransaction: jest.fn().mockResolvedValue(
        cfg.merchant_id === 'merch_b'
          ? { success: true, status: 'settled', amount: 5000, transactionId: 'txn_1' }
          : { success: false, status: 'failed', amount: 0, transactionId: 'txn_1' },
      ),
    }));

    const { req, res } = createReqRes({
      subscription_id: '123456', response: '1', transactionid: 'txn_1', amount: '50.00',
    });
    await handleNmiSilentPost(req, res);

    expect(mockHandleRecurringPaymentSuccess).toHaveBeenCalledTimes(1);
    expect(mockHandleRecurringPaymentSuccess).toHaveBeenCalledWith(expect.objectContaining({
      enrollment: expect.objectContaining({ id: 'enr_b', location_id: 'loc_b' }),
      amountCents: 5000,
    }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('records the processor-verified amount, not the posted amount', async () => {
    primeEnrollments(ENR_A);
    mockCreateProcessorClient.mockReturnValue({
      verifyTransaction: jest.fn().mockResolvedValue({ success: true, status: 'settled', amount: 5000, transactionId: 'txn_1' }),
    });

    const { req, res } = createReqRes({
      subscription_id: 'sub_1', response: '1', transactionid: 'txn_1', amount: '999999.00',
    });
    await handleNmiSilentPost(req, res);

    expect(mockHandleRecurringPaymentSuccess).toHaveBeenCalledWith(expect.objectContaining({
      amountCents: 5000,
    }));
  });

  it('ignores a failure post whose transaction actually settled (forged decline)', async () => {
    primeEnrollments(ENR_A);
    mockCreateProcessorClient.mockReturnValue({
      verifyTransaction: jest.fn().mockResolvedValue({ success: true, status: 'settled', amount: 1000, transactionId: 'txn_ok' }),
    });

    const { req, res } = createReqRes({
      subscription_id: 'sub_1', response: '3', responsetext: 'DECLINED', transactionid: 'txn_ok', amount: '10.00',
    });
    await handleNmiSilentPost(req, res);

    expect(mockHandleRecurringPaymentFailure).not.toHaveBeenCalled();
    expect(mockHandleRecurringPaymentSuccess).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('still initiates dunning for a genuinely failed transaction', async () => {
    primeEnrollments(ENR_A);
    mockCreateProcessorClient.mockReturnValue({
      verifyTransaction: jest.fn().mockResolvedValue({ success: true, status: 'failed', amount: 1000, transactionId: 'txn_bad' }),
    });

    const { req, res } = createReqRes({
      subscription_id: 'sub_1', response: '2', responsetext: 'Declined', transactionid: 'txn_bad', amount: '10.00',
    });
    await handleNmiSilentPost(req, res);

    expect(mockHandleRecurringPaymentFailure).toHaveBeenCalledWith(expect.objectContaining({
      enrollment: expect.objectContaining({ id: 'enr_a' }),
      amountCents: 1000,
    }));
    expect(mockHandleRecurringPaymentSuccess).not.toHaveBeenCalled();
  });

  it('ignores a success post whose transaction did not actually succeed', async () => {
    primeEnrollments(ENR_A);
    mockCreateProcessorClient.mockReturnValue({
      verifyTransaction: jest.fn().mockResolvedValue({ success: true, status: 'failed', amount: 1000, transactionId: 'txn_bad' }),
    });

    const { req, res } = createReqRes({
      subscription_id: 'sub_1', response: '1', transactionid: 'txn_bad', amount: '10.00',
    });
    await handleNmiSilentPost(req, res);

    expect(mockHandleRecurringPaymentSuccess).not.toHaveBeenCalled();
    expect(mockHandleRecurringPaymentFailure).not.toHaveBeenCalled();
  });
});
