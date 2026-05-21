const mockFrom = jest.fn();
const mockFireTrigger = jest.fn();
const mockIdempotencyExists = jest.fn();
const mockIdempotencyRecord = jest.fn();

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: mockFrom }),
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

describe('payment reminder check', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-05-11T15:00:00.000Z'));
    mockIdempotencyExists.mockResolvedValue(false);
    mockIdempotencyRecord.mockResolvedValue(undefined);
    mockFireTrigger.mockResolvedValue({ sent: 1, failed: 0 });

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
        };
        const query: any = {};
        query.in = jest.fn(() => query);
        query.eq = jest.fn((_column: string, targetDate: string) => Promise.resolve({
          data: targetDate === '2026-05-12' ? [enrollment] : [],
          error: null,
        }));
        query.gte = jest.fn(() => query);
        query.lte = jest.fn((_column: string, targetDate: string) => Promise.resolve({
          data: targetDate === '2026-05-12' ? [enrollment] : [],
          error: null,
        }));
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
    expect(mockFireTrigger).toHaveBeenCalledWith('loc_1', 'ss_upcoming_payment_reminder', expect.objectContaining({
      event_type: 'upcoming_payment_reminder',
      contact_id: 'contact_1',
      contactId: 'contact_1',
      enrollment_id: 'enr_1',
      offer_id: 'offer_1',
      amount: 50,
      next_billing_date: '2026-05-12',
      next_payment_number: 2,
      payments_total: 2,
      days_until_payment: 1,
      reminder_window: 'next_24_hours',
      offer: expect.objectContaining({ name: 'Maui Trip', installment_amount: 50 }),
      subscription: expect.objectContaining({
        next_billing_date: '2026-05-12',
        next_payment_number: 2,
        payments_remaining: 1,
      }),
    }));
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
});
