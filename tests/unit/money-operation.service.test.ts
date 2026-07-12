const mockFrom = jest.fn();

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: (...args: any[]) => mockFrom(...args) }),
}));

import { moneyOperationService } from '../../src/services/money-operation.service';

function insertBuilder(result: { data: any; error?: any }) {
  const builder: any = {};
  builder.insert = jest.fn(() => builder);
  builder.select = jest.fn(() => builder);
  builder.single = jest.fn().mockResolvedValue({ data: result.data, error: result.error ?? null });
  return builder;
}

function lookupBuilder(result: { data: any; error?: any }) {
  const builder: any = {};
  builder.select = jest.fn(() => builder);
  builder.eq = jest.fn(() => builder);
  builder.maybeSingle = jest.fn().mockResolvedValue({ data: result.data, error: result.error ?? null });
  return builder;
}

function updateBuilder(result: { data: any; error?: any }) {
  const builder: any = {};
  builder.update = jest.fn(() => builder);
  builder.eq = jest.fn(() => builder);
  builder.select = jest.fn(() => builder);
  builder.maybeSingle = jest.fn().mockResolvedValue({ data: result.data, error: result.error ?? null });
  return builder;
}

const baseInput = {
  locationId: 'loc-1',
  merchantId: 'merchant-1',
  operationType: 'query_url_charge' as const,
  operationKey: 'transaction-1',
  request: { amountCents: 1000, contactId: 'contact-1' },
};

describe('moneyOperationService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates a durable operation for the first request', async () => {
    const operation = {
      id: 'op-1',
      location_id: 'loc-1',
      request_fingerprint: moneyOperationService.fingerprint(baseInput.request),
      status: 'processing',
    };
    mockFrom.mockReturnValueOnce(insertBuilder({ data: operation }));

    await expect(moneyOperationService.begin(baseInput)).resolves.toEqual({
      action: 'execute',
      operation,
    });
  });

  it('replays a completed operation with the same canonical request', async () => {
    const existing = {
      id: 'op-1',
      location_id: 'loc-1',
      request_fingerprint: moneyOperationService.fingerprint({ contactId: 'contact-1', amountCents: 1000 }),
      status: 'recorded',
      response_payload: { success: true, transactionId: 'txn-1' },
    };
    mockFrom
      .mockReturnValueOnce(insertBuilder({ data: null, error: { code: '23505' } }))
      .mockReturnValueOnce(lookupBuilder({ data: existing }));

    await expect(moneyOperationService.begin(baseInput)).resolves.toEqual({
      action: 'replay',
      operation: existing,
      response: existing.response_payload,
    });
  });

  it('rejects reuse of an operation key with different money details', async () => {
    const existing = {
      id: 'op-1',
      request_fingerprint: moneyOperationService.fingerprint({ amountCents: 500 }),
      status: 'processing',
    };
    mockFrom
      .mockReturnValueOnce(insertBuilder({ data: null, error: { code: '23505' } }))
      .mockReturnValueOnce(lookupBuilder({ data: existing }));

    await expect(moneyOperationService.begin(baseInput)).rejects.toThrow(
      'operation key was reused with different request details',
    );
  });

  it('blocks an ambiguous provider-accepted operation instead of executing it again', async () => {
    const existing = {
      id: 'op-1',
      request_fingerprint: moneyOperationService.fingerprint(baseInput.request),
      status: 'provider_accepted',
      response_payload: { transactionId: 'txn-1' },
    };
    mockFrom
      .mockReturnValueOnce(insertBuilder({ data: null, error: { code: '23505' } }))
      .mockReturnValueOnce(lookupBuilder({ data: existing }));

    await expect(moneyOperationService.begin(baseInput)).resolves.toEqual({
      action: 'blocked',
      operation: existing,
    });
  });

  it('reclaims a stale pre-provider operation after a process interruption', async () => {
    const existing = {
      id: 'op-1',
      location_id: 'loc-1',
      request_fingerprint: moneyOperationService.fingerprint(baseInput.request),
      status: 'processing',
      provider_called: false,
      claimed_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    };
    const reclaimed = { ...existing, claimed_at: new Date().toISOString() };
    mockFrom
      .mockReturnValueOnce(insertBuilder({ data: null, error: { code: '23505' } }))
      .mockReturnValueOnce(lookupBuilder({ data: existing }))
      .mockReturnValueOnce(updateBuilder({ data: reclaimed }));

    await expect(moneyOperationService.begin(baseInput)).resolves.toEqual({
      action: 'execute',
      operation: reclaimed,
    });
  });

  it('reclaims a failed operation only when no provider call was made', async () => {
    const existing = {
      id: 'op-1',
      location_id: 'loc-1',
      request_fingerprint: moneyOperationService.fingerprint(baseInput.request),
      status: 'failed',
      provider_called: false,
    };
    const retried = { ...existing, status: 'processing' };
    mockFrom
      .mockReturnValueOnce(insertBuilder({ data: null, error: { code: '23505' } }))
      .mockReturnValueOnce(lookupBuilder({ data: existing }))
      .mockReturnValueOnce(updateBuilder({ data: retried }));

    await expect(moneyOperationService.begin(baseInput)).resolves.toEqual({
      action: 'execute',
      operation: retried,
    });
  });

  it('marks the operation ambiguous before the processor call begins', async () => {
    const updated = { id: 'op-1' };
    const builder = updateBuilder({ data: updated });
    mockFrom.mockReturnValueOnce(builder);

    await moneyOperationService.markProviderStarted({
      id: 'op-1',
      locationId: 'loc-1',
      processorType: 'stripe',
    });

    expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({
      status: 'unknown',
      provider_called: true,
      processor_type: 'stripe',
      provider_started_at: expect.any(String),
    }));
  });

  it('fails closed with an actionable error when migration 098 is missing', async () => {
    mockFrom.mockReturnValueOnce(insertBuilder({
      data: null,
      error: { code: '42P01', message: 'relation money_operations does not exist' },
    }));

    await expect(moneyOperationService.begin(baseInput)).rejects.toThrow(
      'Apply migration 098 before processing payments',
    );
  });
});
