/**
 * Dispute scope resolution tests.
 * Verifies the transaction→enrollment scoping that replaced the empty-enrollmentId
 * contact-wide dump.
 */

// Per-table query results, settable per test.
let tableData: Record<string, any> = {};

function makeQuery(table: string) {
  const q: any = {
    _table: table,
    select: () => q,
    eq: () => q,
    order: () => q,
    limit: () => q,
    maybeSingle: async () => ({ data: tableData[table] ?? null, error: null }),
    then: (resolve: any) => resolve({ data: tableData[`${table}[]`] ?? [], error: null }),
  };
  return q;
}

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: (table: string) => makeQuery(table) }),
}));

import { disputeScopeService } from '../../src/services/dispute-scope.service';

beforeEach(() => {
  tableData = {};
});

describe('resolveDisputeScope', () => {
  test('explicit verified enrollmentId → exact scope', async () => {
    tableData['enrollments'] = { id: 'enr_1', offer_id: 'offer_1', enrolled_at: '2026-01-10' };
    tableData['offers_mirror'] = { offer_name: 'Program One' };

    const scope = await disputeScopeService.resolveDisputeScope({
      locationId: 'loc_1', contactId: 'c_1', enrollmentId: 'enr_1',
    });

    expect(scope.scopeConfidence).toBe('exact');
    expect(scope.enrollmentId).toBe('enr_1');
    expect(scope.offerId).toBe('offer_1');
    expect(scope.offerName).toBe('Program One');
  });

  test('paymentEventId linked to an enrollment → exact scope from the transaction', async () => {
    tableData['payment_events'] = {
      id: 'pe_1', enrollment_id: 'enr_9', offer_id: 'offer_9',
      processor: 'stripe', processor_transaction_id: 'txn_9', created_at: '2026-02-01',
    };
    tableData['enrollments'] = { id: 'enr_9', offer_id: 'offer_9', enrolled_at: '2026-01-20' };
    tableData['offers_mirror'] = { offer_name: 'Program Nine' };

    const scope = await disputeScopeService.resolveDisputeScope({
      locationId: 'loc_1', contactId: 'c_1', paymentEventId: 'pe_1',
    });

    expect(scope.scopeConfidence).toBe('exact');
    expect(scope.enrollmentId).toBe('enr_9');
    expect(scope.paymentEventId).toBe('pe_1');
    expect(scope.processorTransactionId).toBe('txn_9');
  });

  test('paymentEventId with no enrollment and no inference → contact_only with gaps', async () => {
    tableData['payment_events'] = {
      id: 'pe_2', enrollment_id: null, offer_id: null,
      processor: 'nmi', processor_transaction_id: 'txn_2', processor_subscription_id: null, created_at: '2026-02-01',
    };

    const scope = await disputeScopeService.resolveDisputeScope({
      locationId: 'loc_1', contactId: 'c_1', paymentEventId: 'pe_2',
    });

    expect(scope.scopeConfidence).toBe('contact_only');
    expect(scope.gaps.length).toBeGreaterThan(0);
  });

  test('no anchor at all → contact_only with a gap', async () => {
    const scope = await disputeScopeService.resolveDisputeScope({
      locationId: 'loc_1', contactId: 'c_1',
    });

    expect(scope.scopeConfidence).toBe('contact_only');
    expect(scope.enrollmentId).toBeNull();
    expect(scope.gaps.length).toBeGreaterThan(0);
  });
});
