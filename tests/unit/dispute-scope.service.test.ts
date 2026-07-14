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

  test('an unverified explicit enrollment never remains exact or enters evidence scope', async () => {
    const scope = await disputeScopeService.resolveDisputeScope({
      locationId: 'loc_1', contactId: 'c_1', enrollmentId: 'enr_other_tenant', offerId: 'offer_other',
    });

    expect(scope.scopeConfidence).toBe('contact_only');
    expect(scope.enrollmentId).toBeNull();
    expect(scope.offerId).toBeNull();
    expect(scope.gaps.join(' ')).toContain('could not be verified');
  });

  test('payment event metadata is retained when the matching enrollment is also supplied', async () => {
    tableData['payment_events'] = {
      id: 'pe_both', enrollment_id: 'enr_both', offer_id: 'offer_both',
      processor: 'stripe', processor_transaction_id: 'pi_exact', created_at: '2026-07-13T17:19:57Z',
    };
    tableData['enrollments'] = { id: 'enr_both', offer_id: 'offer_both', enrolled_at: '2026-07-13T17:19:58Z' };
    tableData['offers_mirror'] = { offer_name: 'Exact Program' };

    const scope = await disputeScopeService.resolveDisputeScope({
      locationId: 'loc_1', contactId: 'c_1', paymentEventId: 'pe_both', enrollmentId: 'enr_both',
    });

    expect(scope.scopeConfidence).toBe('exact');
    expect(scope.enrollmentId).toBe('enr_both');
    expect(scope.processor).toBe('stripe');
    expect(scope.processorTransactionId).toBe('pi_exact');
    expect(scope.transactionDate).toBe('2026-07-13T17:19:57Z');
  });

  test('mismatched selected transaction and enrollment fail closed', async () => {
    tableData['payment_events'] = {
      id: 'pe_mismatch', contact_id: 'c_1', enrollment_id: 'enr_actual', offer_id: 'offer_actual',
      processor: 'stripe', processor_transaction_id: 'pi_mismatch', created_at: '2026-07-13T17:19:57Z',
    };

    const scope = await disputeScopeService.resolveDisputeScope({
      locationId: 'loc_1', contactId: 'c_1', paymentEventId: 'pe_mismatch', enrollmentId: 'enr_other',
    });

    expect(scope.scopeConfidence).toBe('contact_only');
    expect(scope.enrollmentId).toBeNull();
    expect(scope.processorTransactionId).toBe('pi_mismatch');
    expect(scope.gaps.join(' ')).toContain('do not match');
  });

  test('payment event without contact_id is accepted through its verified enrollment', async () => {
    tableData['payment_events'] = {
      id: 'pe_enrollment_linked', contact_id: null, enrollment_id: 'enr_linked', offer_id: 'offer_linked',
      processor: 'whop', processor_transaction_id: 'pay_linked', created_at: '2026-07-13T17:19:57Z',
    };
    tableData['enrollments'] = { id: 'enr_linked', offer_id: 'offer_linked', enrolled_at: '2026-07-13T17:19:58Z' };

    const scope = await disputeScopeService.resolveDisputeScope({
      locationId: 'loc_1', contactId: 'c_1', paymentEventId: 'pe_enrollment_linked',
    });

    expect(scope.scopeConfidence).toBe('exact');
    expect(scope.enrollmentId).toBe('enr_linked');
    expect(scope.processorTransactionId).toBe('pay_linked');
  });

  test('transaction and selected enrollment with conflicting offers fail closed', async () => {
    tableData['payment_events'] = {
      id: 'pe_offer_mismatch', contact_id: 'c_1', enrollment_id: null, offer_id: 'offer_actual',
      processor: 'stripe', processor_transaction_id: 'pi_offer_mismatch', created_at: '2026-07-13T17:19:57Z',
    };
    tableData['enrollments'] = { id: 'enr_selected', offer_id: 'offer_other', enrolled_at: '2026-07-13T17:19:58Z' };

    const scope = await disputeScopeService.resolveDisputeScope({
      locationId: 'loc_1', contactId: 'c_1', paymentEventId: 'pe_offer_mismatch', enrollmentId: 'enr_selected',
    });

    expect(scope.scopeConfidence).toBe('contact_only');
    expect(scope.enrollmentId).toBeNull();
    expect(scope.gaps.join(' ')).toContain('different offers');
  });

  test('payment event owned by another contact is rejected even inside the same location', async () => {
    tableData['payment_events'] = {
      id: 'pe_other_contact', contact_id: 'c_other', enrollment_id: 'enr_other', offer_id: 'offer_other',
      processor: 'stripe', processor_transaction_id: 'pi_other', created_at: '2026-07-13T17:19:57Z',
    };

    const scope = await disputeScopeService.resolveDisputeScope({
      locationId: 'loc_1', contactId: 'c_1', paymentEventId: 'pe_other_contact',
    });

    expect(scope.scopeConfidence).toBe('contact_only');
    expect(scope.processorTransactionId).toBeNull();
    expect(scope.gaps.join(' ')).toContain('could not be found for this contact');
  });
});
