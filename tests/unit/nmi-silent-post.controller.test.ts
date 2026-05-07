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
  const terminal = {
    single: jest.fn().mockResolvedValue({ data }),
    maybeSingle: jest.fn().mockResolvedValue({ data }),
  };
  const builder: any = {
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    maybeSingle: terminal.maybeSingle,
    single: terminal.single,
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
});
