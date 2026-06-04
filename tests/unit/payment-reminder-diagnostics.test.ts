const mockFrom = jest.fn();

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: mockFrom }),
}));

jest.mock('../../src/repositories/idempotency.repository', () => ({
  idempotencyRepository: {
    exists: jest.fn(),
    record: jest.fn(),
  },
}));

jest.mock('../../src/services/trigger.service', () => ({
  triggerService: { fireTrigger: jest.fn() },
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { getPaymentReminderDiagnostics } from '../../src/jobs/payment-reminder-check';

function thenableQuery(result: any) {
  const query: any = {
    select: jest.fn(() => query),
    eq: jest.fn(() => query),
    in: jest.fn(() => query),
    gte: jest.fn(() => query),
    lte: jest.fn(() => query),
    order: jest.fn(() => query),
    limit: jest.fn(() => query),
    then: (resolve: any) => Promise.resolve(result).then(resolve),
  };
  return query;
}

describe('payment reminder diagnostics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-06-03T15:00:00.000Z'));

    mockFrom.mockImplementation((table: string) => {
      if (table === 'enrollments') {
        return thenableQuery({
          data: [
            {
              id: 'enr_ok',
              location_id: 'loc_1',
              contact_id: 'contact_1',
              offer_id: 'offer_1',
              next_billing_date: '2026-06-04',
              payment_type: 'installment',
              processor_type: 'stripe',
              processor_subscription_id: 'sub_1',
              billing_setup_status: 'ok',
              status: 'enrolled',
            },
            {
              id: 'enr_failed',
              location_id: 'loc_1',
              contact_id: 'contact_2',
              offer_id: 'offer_2',
              next_billing_date: '2026-06-04',
              payment_type: 'installment',
              processor_type: 'nmi',
              processor_subscription_id: null,
              billing_setup_status: 'failed',
              status: 'enrolled',
            },
          ],
          error: null,
        });
      }
      if (table === 'trigger_subscriptions') return thenableQuery({ data: [], error: null });
      if (table === 'idempotency_keys') return thenableQuery({ data: [], error: null });
      if (table === 'trigger_delivery_logs') return thenableQuery({ data: [], error: null });
      throw new Error(`Unexpected table: ${table}`);
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('separates eligible reminders from billing-not-ready and trigger-missing counts', async () => {
    const report = await getPaymentReminderDiagnostics('loc_1');
    const next24 = report.windows.find((window) => window.type === 'next_24_hours')!;

    expect(report.status).toBe('needs_setup');
    expect(report.totalDueCount).toBe(2);
    expect(report.totalBillingNotReadyCount).toBe(1);
    expect(next24.eligibleCount).toBe(1);
    expect(next24.billingNotReadyCount).toBe(1);
    expect(next24.missingProcessorSubscriptionCount).toBe(1);
    expect(next24.triggerMissingCount).toBe(1);
  });
});
