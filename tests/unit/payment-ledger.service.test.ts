const mockTables: Record<string, any[]> = {
  payment_events: [],
  enrollments: [],
  offers_mirror: [],
};
const mockMissingColumns: Record<string, string[]> = {};

class MockQuery {
  private rows: any[];
  private count = false;
  private rangeStart: number | null = null;
  private rangeEnd: number | null = null;
  private limitValue: number | null = null;
  private selectError: any = null;
  private selectedColumns: string[] | null = null;

  constructor(private table: string) {
    this.rows = [...(mockTables[table] || [])];
  }

  select(columns?: string, options?: { count?: string }) {
    this.count = options?.count === 'exact';
    this.selectedColumns = columns && columns !== '*'
      ? columns.split(',').map(column => column.trim()).filter(Boolean)
      : null;
    const missing = mockMissingColumns[this.table] || [];
    const selected = columns || '';
    const missingColumn = missing.find(column => selected.includes(column));
    if (missingColumn) {
      this.selectError = {
        code: 'PGRST204',
        message: `Could not find the '${missingColumn}' column of '${this.table}' in the schema cache`,
      };
    }
    return this;
  }

  eq(column: string, value: any) {
    this.rows = this.rows.filter(row => row[column] === value);
    return this;
  }

  in(column: string, values: any[]) {
    this.rows = this.rows.filter(row => values.includes(row[column]));
    return this;
  }

  ilike(column: string, pattern: string) {
    const needle = pattern.replace(/%/g, '').toLowerCase();
    this.rows = this.rows.filter(row => String(row[column] || '').toLowerCase().includes(needle));
    return this;
  }

  or(expression: string) {
    const terms = expression.split(',').map(part => {
      const [column, _op, ...rest] = part.split('.');
      return { column, needle: rest.join('.').replace(/%/g, '').toLowerCase() };
    });
    this.rows = this.rows.filter(row => terms.some(term => String(row[term.column] || '').toLowerCase().includes(term.needle)));
    return this;
  }

  gte(column: string, value: string) {
    this.rows = this.rows.filter(row => String(row[column] || '') >= value);
    return this;
  }

  lte(column: string, value: string) {
    this.rows = this.rows.filter(row => String(row[column] || '') <= value);
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    const asc = options?.ascending === true;
    this.rows = [...this.rows].sort((a, b) => {
      const av = String(a[column] || '');
      const bv = String(b[column] || '');
      return asc ? av.localeCompare(bv) : bv.localeCompare(av);
    });
    return this;
  }

  limit(value: number) {
    this.limitValue = value;
    return this;
  }

  range(start: number, end: number) {
    this.rangeStart = start;
    this.rangeEnd = end;
    return this;
  }

  then(resolve: any, reject: any) {
    if (this.selectError) {
      return Promise.resolve({ data: null, error: this.selectError, count: null }).then(resolve, reject);
    }
    const total = this.rows.length;
    let rows = [...this.rows];
    if (this.rangeStart != null && this.rangeEnd != null) rows = rows.slice(this.rangeStart, this.rangeEnd + 1);
    if (this.limitValue != null) rows = rows.slice(0, this.limitValue);
    if (this.selectedColumns) {
      rows = rows.map(row => Object.fromEntries(
        this.selectedColumns!
          .filter(column => Object.prototype.hasOwnProperty.call(row, column))
          .map(column => [column, row[column]]),
      ));
    }
    return Promise.resolve({ data: rows, error: null, count: this.count ? total : null }).then(resolve, reject);
  }
}

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({
    from: (table: string) => new MockQuery(table),
  }),
}));

import { paymentLedgerService } from '../../src/services/payment-ledger.service';

describe('paymentLedgerService', () => {
  beforeEach(() => {
    mockMissingColumns.payment_events = [];
    mockMissingColumns.enrollments = [];
    mockTables.payment_events = [
      {
        id: 'pay_1',
        location_id: 'loc_1',
        contact_id: 'contact_1',
        enrollment_id: 'enr_1',
        offer_id: null,
        event_type: 'sale',
        processor: 'stripe',
        processor_transaction_id: 'pi_1',
        processor_subscription_id: 'sub_1',
        amount: 0.5,
        currency: 'usd',
        payment_number: 2,
        payments_total: 2,
        failure_reason: null,
        source: 'stripe_webhook',
        is_recurring: true,
        customer_email: null,
        dunning_status: null,
        dunning_retry_count: 0,
        dunning_next_retry: null,
        created_at: '2026-05-08T01:00:00.000Z',
      },
    ];
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
        payment_type: 'installment',
        payment_amount: 0.5,
        processor_type: 'stripe',
        processor_subscription_id: 'sub_1',
        payments_made: 2,
        payments_total: 2,
        billing_completed_at: '2026-05-08T01:00:00.000Z',
        status: 'enrolled',
        created_at: '2026-05-07T01:00:00.000Z',
      },
    ];
    mockTables.offers_mirror = [
      {
        id: 'offer_1',
        location_id: 'loc_1',
        offer_name: 'Maui Trip',
        tracking_id: 'REP-PHIL',
        payment_type: 'installments',
        price: 1,
        installment_amount: 0.5,
        installment_frequency: 'daily',
        num_payments: 2,
      },
    ];
  });

  it('returns enriched payment rows with program, processor, and final installment context', async () => {
    const result = await paymentLedgerService.list('loc_1');

    expect(result.payments).toHaveLength(1);
    expect(result.payments[0]).toEqual(expect.objectContaining({
      customerName: 'Philip Korniotes',
      customerEmail: 'phil@example.com',
      programName: 'Maui Trip',
      offerTrackingId: 'REP-PHIL',
      processor: 'stripe',
      paymentType: 'installment',
      paymentTypeLabel: 'Installment',
      paymentNumber: 2,
      paymentsRemaining: 0,
      status: 'paid',
    }));
    expect(result.summary.totalCharged).toBe(0.5);
  });

  it('uses enrollment prefiltering for payment type searches', async () => {
    const installment = await paymentLedgerService.list('loc_1', { paymentType: 'installment' });
    const subscription = await paymentLedgerService.list('loc_1', { paymentType: 'subscription' });

    expect(installment.payments).toHaveLength(1);
    expect(subscription.payments).toHaveLength(0);
  });

  it('filters payment rows by offer tracking ID', async () => {
    const matching = await paymentLedgerService.list('loc_1', { trackingId: 'REP-PHIL' });
    const missing = await paymentLedgerService.list('loc_1', { trackingId: 'REP-OTHER' });

    expect(matching.payments).toHaveLength(1);
    expect(matching.payments[0]).toEqual(expect.objectContaining({
      programName: 'Maui Trip',
      offerTrackingId: 'REP-PHIL',
    }));
    expect(missing.payments).toHaveLength(0);
  });

  it('falls back to base payment columns when optional ledger columns are not deployed yet', async () => {
    mockMissingColumns.payment_events = ['customer_email'];

    const result = await paymentLedgerService.list('loc_1');

    expect(result.payments).toHaveLength(1);
    expect(result.payments[0]).toEqual(expect.objectContaining({
      processor: 'stripe',
      programName: 'Maui Trip',
      status: 'paid',
      paymentNumber: 2,
      paymentsRemaining: 0,
    }));
  });

  it('does not borrow program attribution from a contact enrollment when a payment is unlinked', async () => {
    mockTables.payment_events = [
      {
        id: 'pay_unlinked',
        location_id: 'loc_1',
        contact_id: 'contact_1',
        enrollment_id: null,
        offer_id: null,
        event_type: 'sale',
        processor: 'nmi',
        processor_transaction_id: 'txn_unlinked',
        processor_subscription_id: null,
        amount: 1,
        currency: 'usd',
        payment_number: null,
        payments_total: null,
        failure_reason: null,
        source: 'nmi_silent_post',
        is_recurring: true,
        customer_email: 'phil@example.com',
        dunning_status: null,
        dunning_retry_count: 0,
        dunning_next_retry: null,
        created_at: '2026-05-09T01:00:00.000Z',
      },
    ];

    const result = await paymentLedgerService.list('loc_1');

    expect(result.payments).toHaveLength(1);
    expect(result.payments[0]).toEqual(expect.objectContaining({
      customerName: 'Philip Korniotes',
      customerEmail: 'phil@example.com',
      enrollmentId: null,
      offerId: null,
      programName: 'Unassigned payment',
      paymentType: 'unknown',
      processorSubscriptionId: null,
    }));
  });
});
