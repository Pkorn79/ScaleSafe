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

const mockBegin = jest.fn();
const mockMarkProviderStarted = jest.fn();
const mockMarkProviderAccepted = jest.fn();
const mockMarkRecorded = jest.fn();
const mockMarkUnknown = jest.fn();
jest.mock('../../src/services/money-operation.service', () => ({
  moneyOperationService: {
    fingerprint: jest.fn(() => 'fingerprint'),
    begin: (...args: any[]) => mockBegin(...args),
    markProviderStarted: (...args: any[]) => mockMarkProviderStarted(...args),
    markProviderAccepted: (...args: any[]) => mockMarkProviderAccepted(...args),
    markRecorded: (...args: any[]) => mockMarkRecorded(...args),
    markUnknown: (...args: any[]) => mockMarkUnknown(...args),
  },
}));

const mockFireTrigger = jest.fn();
jest.mock('../../src/services/trigger.service', () => ({
  triggerService: { fireTrigger: (...args: any[]) => mockFireTrigger(...args) },
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { chargeStoredCard } from '../../src/controllers/payment-management.controller';

function query(result: { data: any; error?: any }) {
  const chain: any = {};
  const response = { data: result.data, error: result.error || null };
  for (const method of ['select', 'eq', 'in', 'order', 'limit']) {
    chain[method] = jest.fn().mockReturnValue(chain);
  }
  chain.single = jest.fn().mockResolvedValue(response);
  chain.maybeSingle = jest.fn().mockResolvedValue(response);
  chain.then = (resolve: any) => resolve(response);
  return chain;
}

function req(body: any): Request {
  return { body, merchantId: 'merchant-1' } as any;
}

function response(): Response {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const method = {
  id: 'pm-1',
  contact_id: 'contact-1',
  processor_type: 'stripe',
  stripe_customer_id: 'cus-1',
  stripe_payment_method_id: 'pm-stripe-1',
};

const processor = { chargeStoredCard: jest.fn() };
const next = jest.fn();

function mockTables(options: { method?: any; ledgerError?: any } = {}) {
  const methodQuery = query({ data: options.method === undefined ? method : options.method });
  const paymentInsert = jest.fn((_: any) => query(options.ledgerError
    ? { data: null, error: options.ledgerError }
    : { data: { id: 'payment-event-1' } }));
  mockFrom.mockImplementation((table: string) => {
    if (table === 'payment_methods') return methodQuery;
    if (table === 'payment_events') return { insert: paymentInsert };
    throw new Error(`Unexpected table ${table}`);
  });
  return { methodQuery, paymentInsert };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockResolveProcessor.mockResolvedValue({ config: { processor_type: 'stripe' } });
  mockCreateProcessorClient.mockReturnValue(processor);
  mockBegin.mockResolvedValue({ action: 'execute', operation: { id: 'op_charge_1' } });
  mockMarkProviderStarted.mockResolvedValue(undefined);
  mockMarkProviderAccepted.mockResolvedValue(undefined);
  mockMarkRecorded.mockResolvedValue(undefined);
  mockMarkUnknown.mockResolvedValue(undefined);
  mockFireTrigger.mockResolvedValue(undefined);
});

describe('chargeStoredCard durability', () => {
  it('requires a stable payment attempt ID before reading or charging a saved card', async () => {
    const res = response();
    await chargeStoredCard(req({
      contactId: 'contact-1',
      paymentMethodId: 'pm-1',
      amount: 25,
    }), res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockFrom).not.toHaveBeenCalled();
    expect(processor.chargeStoredCard).not.toHaveBeenCalled();
  });

  it('scopes the saved payment method lookup to the requested contact', async () => {
    const { methodQuery } = mockTables({ method: null });
    const res = response();
    await chargeStoredCard(req({
      contactId: 'contact-other',
      paymentMethodId: 'pm-1',
      amount: 25,
      paymentAttemptId: 'attempt-contact-scope-1',
    }), res, next);

    expect(methodQuery.eq).toHaveBeenCalledWith('location_id', 'loc-1');
    expect(methodQuery.eq).toHaveBeenCalledWith('contact_id', 'contact-other');
    expect(res.status).toHaveBeenCalledWith(404);
    expect(processor.chargeStoredCard).not.toHaveBeenCalled();
  });

  it('uses the durable operation ID at the provider boundary and records a checked ledger result', async () => {
    const { paymentInsert } = mockTables();
    processor.chargeStoredCard.mockResolvedValue({ success: true, transactionId: 'pi-1', chargeId: 'ch-1' });
    const res = response();

    await chargeStoredCard(req({
      contactId: 'contact-1',
      paymentMethodId: 'pm-1',
      amount: 25,
      description: 'Invoice 25',
      paymentAttemptId: 'attempt-stored-card-1',
    }), res, next);

    expect(mockBegin).toHaveBeenCalledWith(expect.objectContaining({
      operationType: 'manual_sale_charge',
      operationKey: 'payment-management:attempt-stored-card-1',
      request: expect.objectContaining({
        contactId: 'contact-1',
        paymentMethodId: 'pm-1',
        amountCents: 2500,
      }),
    }));
    expect(mockMarkProviderStarted).toHaveBeenCalledWith({
      id: 'op_charge_1',
      locationId: 'loc-1',
      processorType: 'stripe',
    });
    expect(processor.chargeStoredCard).toHaveBeenCalledWith('cus-1', 'pm-stripe-1', expect.objectContaining({
      amount: 2500,
      idempotencyKey: 'payment-management-op_charge_1',
    }));
    expect(mockMarkProviderStarted.mock.invocationCallOrder[0])
      .toBeLessThan(processor.chargeStoredCard.mock.invocationCallOrder[0]);
    expect(mockMarkProviderAccepted).toHaveBeenCalledWith(expect.objectContaining({
      id: 'op_charge_1',
      processorReference: 'pi-1',
      reconciliationPayload: expect.objectContaining({ contactId: 'contact-1', chargeId: 'ch-1' }),
    }));
    expect(paymentInsert).toHaveBeenCalledWith(expect.objectContaining({
      contact_id: 'contact-1',
      processor_transaction_id: 'pi-1',
      event_type: 'sale',
    }));
    expect(mockMarkRecorded).toHaveBeenCalledWith(expect.objectContaining({
      id: 'op_charge_1',
      processorReference: 'pi-1',
      response: expect.objectContaining({ paymentEventId: 'payment-event-1' }),
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      chargeId: 'ch-1',
      paymentEventId: 'payment-event-1',
    }));
  });

  it('replays a recorded attempt without charging the processor again', async () => {
    mockTables();
    const replay = { success: true, chargeId: 'pi-existing', paymentEventId: 'pe-existing' };
    mockBegin.mockResolvedValue({ action: 'replay', operation: { id: 'op-existing' }, response: replay });
    const res = response();

    await chargeStoredCard(req({
      contactId: 'contact-1',
      paymentMethodId: 'pm-1',
      amount: 25,
      paymentAttemptId: 'attempt-stored-card-replay',
    }), res, next);

    expect(processor.chargeStoredCard).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(replay);
  });

  it('marks an ambiguous provider exception unknown without writing a payment ledger row', async () => {
    const { paymentInsert } = mockTables();
    processor.chargeStoredCard.mockRejectedValue(new Error('processor timeout'));
    const res = response();

    await chargeStoredCard(req({
      contactId: 'contact-1',
      paymentMethodId: 'pm-1',
      amount: 25,
      paymentAttemptId: 'attempt-stored-card-timeout',
    }), res, next);

    expect(mockMarkUnknown).toHaveBeenCalledWith({
      id: 'op_charge_1',
      locationId: 'loc-1',
      processorType: 'stripe',
      error: 'processor timeout',
    });
    expect(paymentInsert).not.toHaveBeenCalled();
    expect(mockMarkRecorded).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'processor timeout' }));
  });

  it('leaves provider success reconcilable when the local payment ledger insert fails', async () => {
    mockTables({ ledgerError: { message: 'ledger unavailable' } });
    processor.chargeStoredCard.mockResolvedValue({ success: true, transactionId: 'pi-reconcile' });
    const res = response();

    await chargeStoredCard(req({
      contactId: 'contact-1',
      paymentMethodId: 'pm-1',
      amount: 25,
      paymentAttemptId: 'attempt-stored-card-reconcile',
    }), res, next);

    expect(mockMarkProviderAccepted).toHaveBeenCalledWith(expect.objectContaining({
      processorReference: 'pi-reconcile',
    }));
    expect(mockMarkRecorded).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      chargeId: 'pi-reconcile',
      recordingIssue: expect.stringContaining('awaiting local ledger reconciliation'),
    }));
  });
});
