import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const mockLoggerWarn = jest.fn();

jest.mock('../../src/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: mockLoggerWarn,
  },
}));

jest.mock('../../src/clients/ghl.client', () => ({
  ghlApi: jest.fn(),
}));

const mockInsert = jest.fn().mockResolvedValue({ error: null });
const mockFrom = jest.fn(() => ({ insert: mockInsert }));

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: mockFrom }),
}));

jest.mock('../../src/repositories/trigger.repository', () => ({
  triggerRepository: {
    getActiveSubscriptions: jest.fn(),
    deactivateSubscription: jest.fn(),
  },
}));

import { triggerService } from '../../src/services/trigger.service';
import { triggerRepository } from '../../src/repositories/trigger.repository';
import { ghlApi } from '../../src/clients/ghl.client';

const mockGetActive = triggerRepository.getActiveSubscriptions as jest.MockedFunction<
  typeof triggerRepository.getActiveSubscriptions
>;
const mockDeactivate = triggerRepository.deactivateSubscription as jest.MockedFunction<
  typeof triggerRepository.deactivateSubscription
>;
const mockGhlApi = ghlApi as jest.MockedFunction<typeof ghlApi>;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mockInsert.mockResolvedValue({ error: null });
  mockFrom.mockReturnValue({ insert: mockInsert });
  mockGhlApi.mockResolvedValue({ post: mockedAxios.post } as any);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('Trigger Service - fireTrigger', () => {
  test('returns 0/0 when no subscriptions exist', async () => {
    mockGetActive.mockResolvedValue([]);

    const result = await triggerService.fireTrigger('loc_1', 'ss_payment_received', {
      contact_id: 'c1',
    });

    expect(result).toEqual({ sent: 0, failed: 0 });
    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(mockFrom).toHaveBeenCalledWith('trigger_delivery_logs');
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      location_id: 'loc_1',
      trigger_key: 'ss_payment_received',
      subscription_url: 'no_subscription',
      status: 'no_subscription',
      attempt_count: 0,
      payload: expect.objectContaining({
        contact_id: 'c1',
        contactId: 'c1',
      }),
    }));
  });

  test('posts payload to all active subscriptions', async () => {
    mockGetActive.mockResolvedValue([
      {
        id: 'sub1',
        location_id: 'loc_1',
        trigger_key: 'ss_payment_received',
        subscription_url: 'https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/loc_1/wf1',
        is_active: true,
        created_at: '',
        updated_at: '',
      },
      {
        id: 'sub2',
        location_id: 'loc_1',
        trigger_key: 'ss_payment_received',
        subscription_url: 'https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/loc_1/wf2',
        is_active: true,
        created_at: '',
        updated_at: '',
      },
    ]);
    mockedAxios.post.mockResolvedValue({ status: 200, data: {} });

    const payload = { contact_id: 'c1', amount: 500 };
    const result = await triggerService.fireTrigger('loc_1', 'ss_payment_received', payload);

    expect(result).toEqual({ sent: 2, failed: 0 });
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    expect(mockGhlApi).toHaveBeenCalledWith('loc_1');
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/loc_1/wf1',
      expect.objectContaining({
        ...payload,
        event_type: 'payment_received',
        location_id: 'loc_1',
        locationId: 'loc_1',
        contactId: 'c1',
      }),
      expect.objectContaining({
        timeout: 10000,
        headers: expect.objectContaining({
          'Idempotency-Key': expect.any(String),
          'X-ScaleSafe-Trigger-Key': expect.any(String),
        }),
      }),
    );
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/loc_1/wf2',
      expect.objectContaining({
        ...payload,
        event_type: 'payment_received',
        location_id: 'loc_1',
        locationId: 'loc_1',
        contactId: 'c1',
      }),
      expect.objectContaining({
        timeout: 10000,
        headers: expect.objectContaining({
          'Idempotency-Key': expect.any(String),
          'X-ScaleSafe-Trigger-Key': expect.any(String),
        }),
      }),
    );
  });

  test('uses GHL auth client for marketplace trigger execution URLs and normalizes aliases', async () => {
    mockGetActive.mockResolvedValue([
      {
        id: 'sub1',
        location_id: 'loc_1',
        trigger_key: 'enrollment_complete',
        subscription_url: 'https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/loc_1/abc',
        is_active: true,
        created_at: '',
        updated_at: '',
      },
    ]);
    mockedAxios.post.mockResolvedValue({ status: 200, data: {} });

    const result = await triggerService.fireTrigger('loc_1', 'enrollment_complete', {
      contact_id: 'c1',
    });

    expect(result).toEqual({ sent: 1, failed: 0 });
    expect(mockGhlApi).toHaveBeenCalledWith('loc_1');
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/loc_1/abc',
      expect.objectContaining({
        event_type: 'enrollment_complete',
        location_id: 'loc_1',
        locationId: 'loc_1',
        contact_id: 'c1',
        contactId: 'c1',
      }),
      expect.objectContaining({
        timeout: 10000,
        headers: expect.objectContaining({
          'Idempotency-Key': expect.any(String),
          'X-ScaleSafe-Trigger-Key': expect.any(String),
        }),
      }),
    );
  });

  test('preserves distinct display and raw app-event type values', async () => {
    mockGetActive.mockResolvedValue([
      {
        id: 'sub1',
        location_id: 'loc_1',
        trigger_key: 'ss_app_event',
        subscription_url: 'https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/loc_1/app',
        is_active: true,
        created_at: '',
        updated_at: '',
      },
    ]);
    mockedAxios.post.mockResolvedValue({ status: 200, data: {} });

    await triggerService.fireTrigger('loc_1', 'ss_app_event', {
      event_type: 'Pulse Check Due',
      eventType: 'pulse_check_due',
      event_type_key: 'pulse_check_due',
      contact_id: 'c1',
      enrollment_id: 'enr_1',
    });

    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/loc_1/app',
      expect.objectContaining({
        event_type: 'Pulse Check Due',
        eventType: 'pulse_check_due',
        event_type_key: 'pulse_check_due',
        contact_id: 'c1',
        contactId: 'c1',
        enrollment_id: 'enr_1',
        enrollmentId: 'enr_1',
      }),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Idempotency-Key': expect.any(String),
        }),
      }),
    );
  });

  test('retries on failure and eventually marks as failed', async () => {
    mockGetActive.mockResolvedValue([
      {
        id: 'sub1',
        location_id: 'loc_1',
        trigger_key: 'ss_payment_received',
        subscription_url: 'https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/loc_1/wf1',
        is_active: true,
        created_at: '',
        updated_at: '',
      },
    ]);
    mockedAxios.post.mockRejectedValue(new Error('Connection refused'));

    // Run with real timers for this test since retries use setTimeout
    jest.useRealTimers();

    // Mock setTimeout to speed up retries
    const originalSetTimeout = global.setTimeout;
    global.setTimeout = ((fn: Function) => originalSetTimeout(fn, 0)) as any;

    const result = await triggerService.fireTrigger('loc_1', 'ss_payment_received', {
      contact_id: 'c1',
    });

    global.setTimeout = originalSetTimeout;

    expect(result).toEqual({ sent: 0, failed: 1 });
    // 1 initial + 3 retries = 4 attempts
    expect(mockedAxios.post).toHaveBeenCalledTimes(4);
  });

  test('skips unsupported subscription URLs without posting payload', async () => {
    mockGetActive.mockResolvedValue([
      {
        id: 'sub1',
        location_id: 'loc_1',
        trigger_key: 'ss_payment_received',
        subscription_url: 'https://example.com/steal-trigger-payloads',
        is_active: true,
        created_at: '',
        updated_at: '',
      },
    ]);

    const result = await triggerService.fireTrigger('loc_1', 'ss_payment_received', {
      contact_id: 'c1',
    });

    expect(result).toEqual({ sent: 0, failed: 1 });
    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      location_id: 'loc_1',
      trigger_key: 'ss_payment_received',
      subscription_url: 'https://example.com/steal-trigger-payloads',
      status: 'failed',
      attempt_count: 0,
      error_message: 'Unsupported trigger subscription URL',
    }));
  });

  test('deactivates stale GHL marketplace trigger subscription when GHL reports it inactive', async () => {
    mockGetActive.mockResolvedValue([
      {
        id: 'sub1',
        location_id: 'loc_1',
        trigger_key: 'enrollment_complete',
        subscription_url: 'https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/loc_1/stale',
        is_active: true,
        created_at: '',
        updated_at: '',
      },
    ]);
    mockedAxios.post.mockRejectedValue(
      new Error('GHL API error: Trigger with id: stale is inactive. Skipping execution'),
    );

    const result = await triggerService.fireTrigger('loc_1', 'enrollment_complete', {
      contact_id: 'c1',
    });

    expect(result).toEqual({ sent: 0, failed: 1 });
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(mockDeactivate).toHaveBeenCalledWith(
      'loc_1',
      'enrollment_complete',
      'https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/loc_1/stale',
    );
  });

  test('keeps the trusted location and overwrites caller-supplied tenant and delivery keys', async () => {
    mockGetActive.mockResolvedValue([
      {
        id: 'sub1',
        location_id: 'loc_1',
        trigger_key: 'ss_app_event',
        subscription_url: 'https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/loc_1/app',
        is_active: true,
        created_at: '',
        updated_at: '',
      },
    ]);
    mockedAxios.post.mockResolvedValue({ status: 200, data: {} });

    await triggerService.fireTrigger('loc_1', 'ss_app_event', {
      location_id: 'loc_attacker',
      locationId: 'loc_attacker_2',
      trigger_delivery_key: 'attacker-key',
      triggerDeliveryKey: 'attacker-key-2',
      event_type: 'pulse_check_due',
      contact_id: 'contact_1',
      enrollment_id: 'enr_1',
      pulse_due_at: '2026-07-12T12:00:00.000Z',
    });

    const postedPayload = mockedAxios.post.mock.calls[0][1] as Record<string, unknown>;
    const deliveryKey = String(postedPayload.trigger_delivery_key);
    expect(postedPayload).toEqual(expect.objectContaining({
      location_id: 'loc_1',
      locationId: 'loc_1',
      triggerDeliveryKey: deliveryKey,
    }));
    expect(deliveryKey).toMatch(/^[a-f0-9]{64}$/);
    expect(deliveryKey).not.toBe('attacker-key');
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      location_id: 'loc_1',
      payload: expect.objectContaining({
        location_id: 'loc_1',
        locationId: 'loc_1',
        trigger_delivery_key: deliveryKey,
        triggerDeliveryKey: deliveryKey,
      }),
    }));
  });

  test('uses a stable key for the same event and a different key for the next pulse occurrence', async () => {
    mockGetActive.mockResolvedValue([
      {
        id: 'sub1',
        location_id: 'loc_1',
        trigger_key: 'ss_app_event',
        subscription_url: 'https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/loc_1/app',
        is_active: true,
        created_at: '',
        updated_at: '',
      },
    ]);
    mockedAxios.post.mockResolvedValue({ status: 200, data: {} });

    await triggerService.fireTrigger('loc_1', 'ss_app_event', {
      event_type: 'pulse_check_due',
      contact_id: 'contact_1',
      enrollment_id: 'enr_1',
      pulse_due_at: '2026-07-12T12:00:00.000Z',
      sent_at: '2026-07-12T12:01:00.000Z',
      form_url: 'https://dashboard.scalesafe.app/pulse-check?token=first',
      pulse: { interval_label: 'daily', frequency_days: 1 },
    });
    await triggerService.fireTrigger('loc_1', 'ss_app_event', {
      pulse: { frequency_days: 1, interval_label: 'daily' },
      form_url: 'https://dashboard.scalesafe.app/pulse-check?token=rotated',
      sent_at: '2026-07-12T12:02:00.000Z',
      pulse_due_at: '2026-07-12T12:00:00.000Z',
      enrollment_id: 'enr_1',
      contact_id: 'contact_1',
      event_type: 'pulse_check_due',
    });
    await triggerService.fireTrigger('loc_1', 'ss_app_event', {
      event_type: 'pulse_check_due',
      contact_id: 'contact_1',
      enrollment_id: 'enr_1',
      pulse_due_at: '2026-07-13T12:00:00.000Z',
      pulse: { interval_label: 'daily', frequency_days: 1 },
    });
    await triggerService.fireTrigger('loc_1', 'ss_app_event', {
      event_type: 'pulse_check_due',
      contact_id: 'contact_1',
      enrollment_id: 'enr_1',
      pulse_due_at: '2026-07-13T12:00:00.000Z',
      sent_at: '2026-07-12T12:03:00.000Z',
      manual_test: true,
    });
    await triggerService.fireTrigger('loc_1', 'ss_app_event', {
      event_type: 'pulse_check_due',
      contact_id: 'contact_1',
      enrollment_id: 'enr_1',
      pulse_due_at: '2026-07-13T12:00:00.000Z',
      sent_at: '2026-07-12T12:04:00.000Z',
      manual_test: true,
    });

    const keys = mockedAxios.post.mock.calls.map((call) => (
      call[1] as Record<string, unknown>
    ).trigger_delivery_key);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
    expect(keys[3]).not.toBe(keys[4]);
  });

  test('does not retry an ambiguous connection reset that may have reached GHL', async () => {
    mockGetActive.mockResolvedValue([
      {
        id: 'sub1',
        location_id: 'loc_1',
        trigger_key: 'enrollment_complete',
        subscription_url: 'https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/loc_1/wf1',
        is_active: true,
        created_at: '',
        updated_at: '',
      },
    ]);
    const error: any = new Error('socket closed after request write');
    error.code = 'ECONNRESET';
    mockedAxios.post.mockRejectedValue(error);

    const result = await triggerService.fireTrigger('loc_1', 'enrollment_complete', {
      contact_id: 'contact_1',
      enrollment_id: 'enr_1',
    });

    expect(result).toEqual({ sent: 0, failed: 1 });
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      attempt_count: 1,
      error_message: expect.stringContaining('Ambiguous trigger delivery failure; not retried automatically.'),
    }));
  });

  test('surfaces transient subscription lookup failures instead of recording no subscription', async () => {
    const error = new Error('Supabase timeout');
    mockGetActive.mockRejectedValue(error);

    await expect(triggerService.fireTrigger('loc_1', 'ss_app_event', {
      contact_id: 'contact_1',
      enrollment_id: 'enr_1',
      event_type: 'pulse_check_due',
    })).rejects.toBe(error);

    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  test('warns when the delivery audit log cannot be persisted', async () => {
    mockGetActive.mockResolvedValue([
      {
        id: 'sub1',
        location_id: 'loc_1',
        trigger_key: 'enrollment_complete',
        subscription_url: 'https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/loc_1/wf1',
        is_active: true,
        created_at: '',
        updated_at: '',
      },
    ]);
    mockedAxios.post.mockResolvedValue({ status: 200, data: {} });
    mockInsert.mockResolvedValueOnce({ error: { message: 'audit table unavailable' } });

    await expect(triggerService.fireTrigger('loc_1', 'enrollment_complete', {
      contact_id: 'contact_1',
      enrollment_id: 'enr_1',
    })).resolves.toEqual({ sent: 1, failed: 0 });

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        err: 'audit table unavailable',
        triggerKey: 'enrollment_complete',
        deliveryKey: expect.any(String),
      }),
      'Trigger delivery log insert failed',
    );
  });
});
