const mockFrom = jest.fn();
const mockFireTrigger = jest.fn();
const mockIdempotencyExists = jest.fn();
const mockIdempotencyRecord = jest.fn();
const mockGhlPut = jest.fn();
const mockGhlApi = jest.fn();

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: mockFrom }),
}));

jest.mock('../../src/clients/ghl.client', () => ({
  ghlApi: (...args: any[]) => mockGhlApi(...args),
}));

jest.mock('../../src/services/trigger.service', () => ({
  triggerService: { fireTrigger: (...args: any[]) => mockFireTrigger(...args) },
}));

jest.mock('../../src/repositories/idempotency.repository', () => ({
  idempotencyRepository: {
    exists: (...args: any[]) => mockIdempotencyExists(...args),
    record: (...args: any[]) => mockIdempotencyRecord(...args),
  },
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { runPaymentReminderCheck } from '../../src/jobs/payment-reminder-check';

let enrollmentBillingStatus = 'ok';
let enrollmentProcessorType = '';
let enrollmentProcessorSubscriptionId: string | null = null;

describe('payment reminder check', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-05-11T15:00:00.000Z'));
    enrollmentBillingStatus = 'ok';
    enrollmentProcessorType = '';
    enrollmentProcessorSubscriptionId = null;
    mockIdempotencyExists.mockResolvedValue(false);
    mockIdempotencyRecord.mockResolvedValue(undefined);
    mockFireTrigger.mockResolvedValue({ sent: 1, failed: 0 });
    mockGhlPut.mockResolvedValue({ data: {} });
    mockGhlApi.mockResolvedValue({ put: mockGhlPut });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'enrollments') {
        const enrollment = {
          id: 'enr_1',
          location_id: 'loc_1',
          contact_id: 'contact_1',
          offer_id: 'offer_1',
          next_billing_date: '2026-05-12',
          payment_type: 'installment',
          payments_made: 1,
          payments_total: 2,
          billing_setup_status: enrollmentBillingStatus,
          processor_type: enrollmentProcessorType,
          processor_subscription_id: enrollmentProcessorSubscriptionId,
        };
        // Honour the .eq('billing_setup_status', 'ok') filter added in Batch H.
        let billingOk = true;
        const resolveData = (targetDate: string) => ({
          data: targetDate === '2026-05-12' && billingOk ? [enrollment] : [],
          error: null,
        });
        const query: any = {};
        query.in = jest.fn(() => query);
        query.eq = jest.fn((column: string, value: string) => {
          if (column === 'billing_setup_status') {
            billingOk = enrollment.billing_setup_status === value;
            return query;
          }
          return Promise.resolve(resolveData(value));
        });
        query.gte = jest.fn(() => query);
        query.lte = jest.fn((_column: string, targetDate: string) => Promise.resolve(resolveData(targetDate)));
        return {
          select: jest.fn(() => query),
        };
      }

      if (table === 'offers_mirror') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              single: jest.fn().mockResolvedValue({
                data: { offer_name: 'Maui Trip', installment_amount: 50, price: 100 },
                error: null,
              }),
            })),
          })),
        };
      }

      throw new Error(`Unexpected table ${table}`);
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('fires a next-24-hours reminder with workflow payload and records idempotency', async () => {
    const result = await runPaymentReminderCheck();

    expect(result.sent).toBe(1);
    expect(result.skipped).toBe(0);
    expect(mockFireTrigger).toHaveBeenCalledWith('loc_1', 'ss_app_event', expect.objectContaining({
      event_type: 'upcoming_payment_reminder',
      contact_id: 'contact_1',
      contactId: 'contact_1',
      enrollment_id: 'enr_1',
      offer_id: 'offer_1',
      amount: 50,
      amount_display: '$50.00',
      payment_amount_display: '$50.00',
      next_billing_date: '2026-05-12',
      next_payment_date: '2026-05-12',
      next_payment_date_display: 'May 12, 2026',
      next_payment_number: 2,
      payment_number: 2,
      payment_number_display: '2 of 2',
      payments_total: 2,
      total_payments: 2,
      days_until_payment: 1,
      reminder_window: 'next_24_hours',
      support_email: '',
      business_name: '',
      offer: expect.objectContaining({ name: 'Maui Trip', installment_amount: 50, installment_amount_display: '$50.00' }),
      subscription: expect.objectContaining({
        next_billing_date: '2026-05-12',
        next_payment_date: '2026-05-12',
        next_payment_number: 2,
        payment_number_display: '2 of 2',
        payments_remaining: 1,
      }),
    }));
    expect(mockGhlPut).toHaveBeenCalledWith('/contacts/contact_1', {
      customField: expect.objectContaining({
        'contact.offer_program_name': 'Maui Trip',
        'contact.offer_installment_amount': '$50.00',
        'contact.offer_number_of_payments': 2,
        'contact.offer_support_email': '',
        'contact.ss_payment_status': 'Current',
        'contact.ss_last_payment_amount': '$50.00',
        'contact.ss_next_payment_date': 'May 12, 2026',
        'contact.ss_payments_made': 1,
        'contact.ss_payments_remaining': 1,
      }),
    });
    expect(mockIdempotencyRecord).toHaveBeenCalledWith(
      'payment-reminder:loc_1:enr_1:2026-05-12:next_24_hours',
      'payment_reminder',
      'loc_1',
      expect.objectContaining({ days_until_payment: 1, reminder_window: 'next_24_hours', sent: 1, failed: 0 }),
    );
  });

  test('skips an already-recorded reminder window', async () => {
    mockIdempotencyExists.mockResolvedValue(true);

    const result = await runPaymentReminderCheck();

    expect(result.sent).toBe(0);
    expect(result.skipped).toBe(1);
    expect(mockFireTrigger).not.toHaveBeenCalled();
  });

  test('does not remind an enrollment whose processor billing setup did not complete (Batch H)', async () => {
    enrollmentBillingStatus = 'failed';

    const result = await runPaymentReminderCheck();

    expect(result.sent).toBe(0);
    expect(mockFireTrigger).not.toHaveBeenCalled();
  });

  test('does not remind a processor-backed enrollment missing a subscription ID', async () => {
    enrollmentProcessorType = 'stripe';
    enrollmentProcessorSubscriptionId = null;

    const result = await runPaymentReminderCheck();

    expect(result.sent).toBe(0);
    expect(result.skipped).toBe(1);
    expect(mockFireTrigger).not.toHaveBeenCalled();
  });
});
