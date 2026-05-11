const mockTables: Record<string, any[]> = {
  payment_events: [],
  enrollments: [],
  offers_mirror: [],
};

class MockQuery {
  private rows: any[];

  constructor(private table: string) {
    this.rows = [...(mockTables[table] || [])];
  }

  select() {
    return this;
  }

  eq(column: string, value: any) {
    this.rows = this.rows.filter(row => row[column] === value);
    return this;
  }

  gte(column: string, value: string) {
    this.rows = this.rows.filter(row => String(row[column] || '') >= value);
    return this;
  }

  in(column: string, values: any[]) {
    this.rows = this.rows.filter(row => values.includes(row[column]));
    return this;
  }

  order() {
    return this;
  }

  limit(value: number) {
    this.rows = this.rows.slice(0, value);
    return this;
  }

  then(resolve: any, reject: any) {
    return Promise.resolve({ data: this.rows, error: null }).then(resolve, reject);
  }
}

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({
    from: (table: string) => new MockQuery(table),
  }),
}));

import { paymentReconciliationService } from '../../src/services/payment-reconciliation.service';

describe('paymentReconciliationService', () => {
  beforeEach(() => {
    mockTables.enrollments = [
      {
        id: 'enr_1',
        location_id: 'loc_1',
        contact_id: 'contact_1',
        offer_id: 'offer_1',
        email: 'phil@example.com',
        first_name: 'Philip',
        last_name: 'Korniotes',
        digital_signature: '',
        status: 'enrolled',
        payment_type: 'pif',
        processor_type: 'stripe',
        processor_subscription_id: null,
        payments_made: 1,
        payments_total: null,
        next_billing_date: null,
        billing_completed_at: null,
        completed_at: null,
        cancelled_at: null,
        enrolled_at: '2026-05-08T01:00:00.000Z',
        created_at: '2026-05-08T01:00:00.000Z',
      },
    ];
    mockTables.offers_mirror = [
      {
        id: 'offer_1',
        location_id: 'loc_1',
        offer_name: 'Maui Trip',
        payment_type: 'pif',
        price: 1,
        installment_amount: null,
        installment_frequency: null,
        num_payments: null,
      },
    ];
    mockTables.payment_events = [
      {
        id: 'pay_unlinked',
        location_id: 'loc_1',
        contact_id: 'contact_1',
        enrollment_id: null,
        offer_id: null,
        event_type: 'sale',
        processor: 'nmi',
        processor_transaction_id: 'txn_1',
        processor_subscription_id: null,
        amount: 1,
        failure_reason: null,
        source: 'nmi_silent_post',
        is_recurring: true,
        payment_number: null,
        payments_total: null,
        created_at: '2026-05-09T01:00:00.000Z',
      },
    ];
  });

  it('does not borrow program attribution for unlinked payment issues', async () => {
    const report = await paymentReconciliationService.report('loc_1', { lookbackDays: 3650 });
    const issue = report.issues.find(item => item.type === 'unassigned_payment_event');

    expect(issue).toEqual(expect.objectContaining({
      customerName: 'Philip Korniotes',
      customerEmail: 'phil@example.com',
      enrollmentId: null,
      offerId: null,
      programName: 'Unassigned payment',
      paymentType: 'unknown',
      processor: 'nmi',
    }));
  });
});
