/**
 * Launch-critical route test: POST /api/payments/refund (issueRefund).
 *
 * Money-out path. Locks down the invariants a silent bug here would break:
 *  - input validation (missing fields, non-positive amount)
 *  - tenant scoping (original event looked up with location_id)
 *  - only successful, refundable events can be refunded
 *  - double-refund protection: requested amount cannot exceed remaining refundable balance
 *  - a 'pending' processor refund is ACCEPTED and recorded (fix #11), not treated as failure
 *  - a genuine processor failure does not write a refund ledger row
 */
import { Request, Response } from 'express';

const mockFrom = jest.fn();
jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: mockFrom }),
}));

jest.mock('../../src/middleware/tenantContext', () => ({
  resolveLocationId: () => 'loc-1',
}));

const mockResolveProcessor = jest.fn();
const mockCreateProcessorClient = jest.fn();
jest.mock('../../src/services/processor.factory', () => ({
  resolveProcessor: (...args: any[]) => mockResolveProcessor(...args),
  createProcessorClient: (...args: any[]) => mockCreateProcessorClient(...args),
}));

const mockNotifyRefundProcessed = jest.fn();
jest.mock('../../src/services/payment-lifecycle.service', () => ({
  paymentLifecycleService: {
    notifyRefundProcessed: (...args: any[]) => mockNotifyRefundProcessed(...args),
  },
}));

const mockWhopRefundPayment = jest.fn();
jest.mock('../../src/services/whop.service', () => ({
  whopService: {
    refundPayment: (...args: any[]) => mockWhopRefundPayment(...args),
  },
}));

import { issueRefund } from '../../src/controllers/payment-management.controller';

// Chainable Supabase query stub: every builder method returns the same object,
// which is both awaitable (for `await supabase.from(...).eq(...)`) and exposes
// .single()/.maybeSingle() promises (for the single-row reads + insert().select().single()).
function query(result: { data: any; error?: any }) {
  const c: any = {};
  const res = { data: result.data, error: result.error ?? null };
  c.select = jest.fn(() => c);
  c.eq = jest.fn(() => c);
  c.insert = jest.fn(() => c);
  c.single = jest.fn(() => Promise.resolve(res));
  c.maybeSingle = jest.fn(() => Promise.resolve(res));
  c.then = (resolve: any) => resolve(res); // makes the chain awaitable
  return c;
}

function mockReq(body: any = {}): Request {
  return { body, merchantId: 'merch-1' } as any;
}

function mockRes(): Response {
  const res: any = {};
  res.json = jest.fn().mockReturnValue(res);
  res.status = jest.fn().mockReturnValue(res);
  return res;
}

const next = jest.fn();

const successfulSale = {
  id: 'pe-1',
  event_type: 'sale',
  failure_reason: null,
  processor: 'nmi',
  processor_transaction_id: 'txn-1',
  contact_id: 'contact-1',
  amount: 100,
  enrollment_id: 'enr-1',
  offer_id: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockResolveProcessor.mockResolvedValue({ config: { processor_type: 'nmi' } });
  mockNotifyRefundProcessed.mockResolvedValue(undefined);
  mockWhopRefundPayment.mockResolvedValue({ success: true, refundId: 'ref_whop_1', status: 'refunded', raw: { id: 'ref_whop_1' } });
});

describe('issueRefund', () => {
  it('400s when paymentEventId or amount is missing', async () => {
    const res = mockRes();
    await issueRefund(mockReq({ amount: 10 }), res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('400s when amount is not a positive number', async () => {
    const res = mockRes();
    await issueRefund(mockReq({ paymentEventId: 'pe-1', amount: -5 }), res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('404s when the original payment event is not found for this location', async () => {
    mockFrom.mockReturnValueOnce(query({ data: null }));
    const res = mockRes();
    await issueRefund(mockReq({ paymentEventId: 'pe-1', amount: 10 }), res, next);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('400s when the event type is not refundable', async () => {
    mockFrom.mockReturnValueOnce(query({ data: { ...successfulSale, event_type: 'refund' } }));
    const res = mockRes();
    await issueRefund(mockReq({ paymentEventId: 'pe-1', amount: 10 }), res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('processes a Whop refund through the Whop refund API without using the generic processor factory', async () => {
    mockFrom
      .mockReturnValueOnce(query({ data: { ...successfulSale, processor: 'whop', processor_transaction_id: 'pay_123' } }))
      .mockReturnValueOnce(query({ data: [] }))
      .mockReturnValueOnce(query({ data: { id: 'refund-event-whop' } }));
    const res = mockRes();
    await issueRefund(mockReq({ paymentEventId: 'pe-1', amount: 10 }), res, next);

    expect(mockWhopRefundPayment).toHaveBeenCalledWith('loc-1', {
      paymentId: 'pay_123',
      partialAmount: 10,
    });
    expect(mockResolveProcessor).not.toHaveBeenCalled();
    expect(mockNotifyRefundProcessed).toHaveBeenCalledWith('loc-1', 'contact-1', expect.objectContaining({
      amount: 10,
      processor: 'whop',
      transactionId: 'ref_whop_1',
    }));
    expect((res.json as jest.Mock).mock.calls[0][0]).toEqual(expect.objectContaining({
      success: true,
      refundId: 'ref_whop_1',
    }));
  });

  it('returns success with a recording issue when Whop accepts a refund but ScaleSafe cannot insert the refund event', async () => {
    mockFrom
      .mockReturnValueOnce(query({ data: { ...successfulSale, processor: 'whop', processor_transaction_id: 'pay_123' } }))
      .mockReturnValueOnce(query({ data: [] }))
      .mockReturnValueOnce(query({ data: null, error: { message: 'insert failed' } }));
    const res = mockRes();
    await issueRefund(mockReq({ paymentEventId: 'pe-1', amount: 10 }), res, next);

    expect(mockWhopRefundPayment).toHaveBeenCalledWith('loc-1', expect.objectContaining({ paymentId: 'pay_123' }));
    expect(mockNotifyRefundProcessed).not.toHaveBeenCalled();
    expect((res.json as jest.Mock).mock.calls[0][0]).toEqual(expect.objectContaining({
      success: true,
      refundId: 'ref_whop_1',
      paymentEventId: null,
      recordingIssue: expect.stringContaining('could not record the refund event'),
    }));
  });

  it('blocks Whop refunds when the payment event lacks a Whop payment id', async () => {
    mockFrom
      .mockReturnValueOnce(query({ data: { ...successfulSale, processor: 'whop', processor_transaction_id: 'checkout_123' } }))
      .mockReturnValueOnce(query({ data: [] }));
    const res = mockRes();
    await issueRefund(mockReq({ paymentEventId: 'pe-1', amount: 10 }), res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect((res.json as jest.Mock).mock.calls[0][0].error).toContain('missing a refundable Whop payment ID');
    expect(mockWhopRefundPayment).not.toHaveBeenCalled();
  });

  it('blocks a refund that exceeds the remaining refundable balance (double-refund protection)', async () => {
    const priorRefund = {
      id: 'ref-prior',
      amount: 100,
      processor_transaction_id: 'txn-1',
      raw_webhook_payload: { original_payment_event_id: 'pe-1' },
    };
    mockFrom
      .mockReturnValueOnce(query({ data: successfulSale })) // original event
      .mockReturnValueOnce(query({ data: [priorRefund] })); // prior refunds (full amount already refunded)
    const res = mockRes();
    await issueRefund(mockReq({ paymentEventId: 'pe-1', amount: 50 }), res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    // no insert should have happened (only the two reads)
    expect(mockFrom).toHaveBeenCalledTimes(2);
  });

  it('processes a valid full refund and records the refund ledger row', async () => {
    mockCreateProcessorClient.mockReturnValue({
      refund: jest.fn().mockResolvedValue({ success: true, status: 'refunded', refundId: 'rfnd-1' }),
    });
    mockFrom
      .mockReturnValueOnce(query({ data: successfulSale })) // original event
      .mockReturnValueOnce(query({ data: [] })) // no prior refunds
      .mockReturnValueOnce(query({ data: { id: 'refund-event-1' } })); // insert().select().single()
    const res = mockRes();
    await issueRefund(mockReq({ paymentEventId: 'pe-1', amount: 100, reason: 'duplicate' }), res, next);

    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.status).toBe('refunded');
    expect(body.refundId).toBe('rfnd-1');
    expect(mockNotifyRefundProcessed).toHaveBeenCalled();
  });

  it('treats a pending processor refund as accepted and reports status=processing (fix #11)', async () => {
    mockCreateProcessorClient.mockReturnValue({
      refund: jest.fn().mockResolvedValue({ success: false, status: 'pending', refundId: 'rfnd-2' }),
    });
    mockFrom
      .mockReturnValueOnce(query({ data: successfulSale }))
      .mockReturnValueOnce(query({ data: [] }))
      .mockReturnValueOnce(query({ data: { id: 'refund-event-2' } }));
    const res = mockRes();
    await issueRefund(mockReq({ paymentEventId: 'pe-1', amount: 100 }), res, next);

    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.status).toBe('processing');
  });

  it('does not record a refund row when the processor genuinely fails', async () => {
    const insertChain = query({ data: { id: 'should-not-insert' } });
    mockCreateProcessorClient.mockReturnValue({
      refund: jest.fn().mockResolvedValue({ success: false, status: 'failed', errorMessage: 'declined' }),
    });
    mockFrom
      .mockReturnValueOnce(query({ data: successfulSale }))
      .mockReturnValueOnce(query({ data: [] }))
      .mockReturnValueOnce(insertChain);
    const res = mockRes();
    await issueRefund(mockReq({ paymentEventId: 'pe-1', amount: 100 }), res, next);

    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.success).toBe(false);
    expect(insertChain.insert).not.toHaveBeenCalled();
    expect(mockNotifyRefundProcessed).not.toHaveBeenCalled();
  });
});
