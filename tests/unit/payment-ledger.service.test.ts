const mockTables: Record<string, any[]> = {
  payment_events: [],
  payment_refund_claims: [],
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
        line_items: [
          { kind: 'base_offer', title: 'Maui Trip', amount: 0.5 },
          { kind: 'order_bump', title: 'VIP onboarding', amount: 1 },
        ],
        created_at: '2026-05-08T01:00:00.000Z',
      },
    ];
    mockTables.payment_refund_claims = [];
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
      refundable: true,
      refundableAmount: 0.5,
      lineItems: [
        { kind: 'base_offer', title: 'Maui Trip', amount: 0.5 },
        { kind: 'order_bump', title: 'VIP onboarding', amount: 1 },
      ],
    }));
    expect(result.summary.totalCharged).toBe(0.5);
  });

  it('hides refund controls when the full payment amount has already been refunded', async () => {
    mockTables.payment_events.push({
      id: 'refund_1',
      location_id: 'loc_1',
      contact_id: 'contact_1',
      enrollment_id: 'enr_1',
      offer_id: 'offer_1',
      event_type: 'refund',
      processor: 'stripe',
      processor_transaction_id: 're_1',
      amount: 0.5,
      currency: 'usd',
      raw_webhook_payload: { original_payment_event_id: 'pay_1' },
      created_at: '2026-05-08T02:00:00.000Z',
    });

    const result = await paymentLedgerService.list('loc_1');
    const original = result.payments.find(payment => payment.id === 'pay_1');

    expect(original).toEqual(expect.objectContaining({
      refundable: false,
      refundableAmount: 0,
    }));
  });

  it('reports only the remaining amount after a partial refund', async () => {
    mockTables.payment_events.push({
      id: 'refund_partial',
      location_id: 'loc_1',
      contact_id: 'contact_1',
      enrollment_id: 'enr_1',
      offer_id: 'offer_1',
      event_type: 'refund',
      processor: 'stripe',
      processor_transaction_id: 're_partial',
      amount: 0.2,
      currency: 'usd',
      raw_webhook_payload: { original_payment_event_id: 'pay_1' },
      created_at: '2026-05-08T02:00:00.000Z',
    });

    const result = await paymentLedgerService.list('loc_1');
    const original = result.payments.find(payment => payment.id === 'pay_1');

    expect(original).toEqual(expect.objectContaining({
      refundable: true,
      refundableAmount: 0.3,
    }));
  });

  it('reserves processor-accepted refunds that do not have a ledger row yet', async () => {
    mockTables.payment_refund_claims = [{
      id: 'claim_1',
      location_id: 'loc_1',
      original_payment_event_id: 'pay_1',
      amount_cents: 50,
      status: 'provider_accepted',
      refund_payment_event_id: null,
    }];

    const result = await paymentLedgerService.list('loc_1');
    const original = result.payments.find(payment => payment.id === 'pay_1');

    expect(original).toEqual(expect.objectContaining({
      refundable: false,
      refundableAmount: 0,
    }));
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

  it('rejects search terms that could break PostgREST or filters', async () => {
    await expect(paymentLedgerService.list('loc_1', { search: 'phil@example.com),id.eq.pay_1' }))
      .rejects.toThrow('Invalid search value');
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
        payment_type: 'manual_sale',
        source: 'quick_manual_sale',
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
      paymentType: 'manual',
      paymentTypeLabel: 'Manual',
      processorSubscriptionId: null,
    }));
  });

  it('includes enrollment-linked payments in a client history even when contact_id is missing', async () => {
    mockTables.payment_events = [
      {
        id: 'pay_missing_contact',
        location_id: 'loc_1',
        contact_id: '',
        enrollment_id: 'enr_1',
        offer_id: null,
        event_type: 'sale',
        processor: 'nmi',
        processor_transaction_id: 'txn_missing_contact',
        processor_subscription_id: 'sub_1',
        amount: 0.2,
        currency: 'usd',
        payment_number: 1,
        payments_total: 4,
        failure_reason: null,
        source: 'quick_manual_sale',
        is_recurring: false,
        customer_email: null,
        dunning_status: null,
        dunning_retry_count: 0,
        dunning_next_retry: null,
        line_items: [],
        created_at: '2026-06-26T17:00:00.000Z',
      },
    ];

    const result = await paymentLedgerService.list('loc_1', { contactId: 'contact_1' });

    expect(result.payments).toHaveLength(1);
    expect(result.payments[0]).toEqual(expect.objectContaining({
      enrollmentId: 'enr_1',
      contactId: 'contact_1',
      programName: 'Maui Trip',
      amount: 0.2,
      processorTransactionId: 'txn_missing_contact',
    }));
  });
});
