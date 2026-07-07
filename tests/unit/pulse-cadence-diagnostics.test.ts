const mockFrom = jest.fn();
const mockMerchant = jest.fn();
const mockGhlPut = jest.fn();
const mockIdempotencyExists = jest.fn();
const mockIdempotencyRecord = jest.fn();

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: mockFrom }),
}));

jest.mock('../../src/clients/ghl.client', () => ({
  ghlApi: jest.fn(async () => ({ put: mockGhlPut })),
}));

jest.mock('../../src/repositories/merchant.repository', () => ({
  merchantRepository: {
    getByLocationId: (...args: any[]) => mockMerchant(...args),
  },
}));

jest.mock('../../src/repositories/idempotency.repository', () => ({
  idempotencyRepository: {
    exists: (...args: any[]) => mockIdempotencyExists(...args),
    record: (...args: any[]) => mockIdempotencyRecord(...args),
  },
}));

jest.mock('../../src/services/trigger.service', () => ({
  triggerService: { fireTrigger: jest.fn() },
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { getPulseCadenceDiagnostics, runPulseCadenceCheck } from '../../src/jobs/pulse-cadence-check';
import { triggerService } from '../../src/services/trigger.service';

const mockFireTrigger = triggerService.fireTrigger as jest.Mock;

function thenableQuery(result: any) {
  const query: any = {
    select: jest.fn(() => query),
    eq: jest.fn(() => query),
    in: jest.fn(() => query),
    lte: jest.fn(() => query),
    order: jest.fn(() => query),
    limit: jest.fn(() => query),
    then: (resolve: any) => Promise.resolve(result).then(resolve),
  };
  return query;
}

function subscriptionQuery(resultForKey: (triggerKey?: string) => any) {
  const filters: Record<string, unknown> = {};
  const query: any = {
    select: jest.fn(() => query),
    eq: jest.fn((field: string, value: unknown) => {
      filters[field] = value;
      return query;
    }),
    then: (resolve: any) => Promise.resolve(resultForKey(filters.trigger_key as string | undefined)).then(resolve),
  };
  return query;
}

function enrollmentQuery(row: Record<string, unknown>) {
  const query: any = {
    select: jest.fn(() => query),
    eq: jest.fn(() => query),
    in: jest.fn(() => query),
    lte: jest.fn(() => query),
    maybeSingle: jest.fn(async () => ({ data: row, error: null })),
    then: (resolve: any) => Promise.resolve({ data: [row], error: null }).then(resolve),
  };
  return query;
}

function updateQuery(onUpdate: (payload: any) => void) {
  const query: any = {
    eq: jest.fn(() => query),
  };
  return {
    update: jest.fn((payload: any) => {
      onUpdate(payload);
      return query;
    }),
  };
}

describe('pulse cadence diagnostics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMerchant.mockResolvedValue({
      module_pulse: true,
      config: {},
      custom_value_ids: {},
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'enrollments') return thenableQuery({ data: [{ id: 'enr_1' }], error: null });
      if (table === 'trigger_subscriptions') return thenableQuery({ data: [{ id: 'sub_1' }], error: null });
      if (table === 'trigger_delivery_logs') return thenableQuery({ data: [], error: null });
      if (table === 'ghl_activity_events') return thenableQuery({ data: [], error: null });
      if (table === 'evidence_pulse_checkins') return thenableQuery({ data: [], error: null });
      throw new Error(`Unexpected table: ${table}`);
    });
  });

  it('reports due pulse check-ins as ready when a pulse workflow is subscribed', async () => {
    const report = await getPulseCadenceDiagnostics('loc_1');

    expect(report.status).toBe('ready');
    expect(report.dueCount).toBe(1);
    expect(report.formUrlConfigured).toBe(true);
    expect(report.activePulseSubscriptions).toBe(1);
    expect(report.lastSkippedReason).toBeNull();
  });

  it('reports due pulse check-ins as setup-needed when no pulse workflow is subscribed', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'enrollments') return thenableQuery({ data: [{ id: 'enr_1' }], error: null });
      if (table === 'trigger_subscriptions') return thenableQuery({ data: [], error: null });
      if (table === 'trigger_delivery_logs') return thenableQuery({ data: [], error: null });
      if (table === 'ghl_activity_events') return thenableQuery({ data: [], error: null });
      if (table === 'evidence_pulse_checkins') return thenableQuery({ data: [], error: null });
      throw new Error(`Unexpected table: ${table}`);
    });

    const report = await getPulseCadenceDiagnostics('loc_1');

    expect(report.status).toBe('needs_setup');
    expect(report.formUrlConfigured).toBe(true);
    expect(report.lastSkippedReason).toBe('pulse_workflow_subscription_missing');
  });

  it('reports due pulse check-ins as setup-needed when pulse is disabled', async () => {
    mockMerchant.mockResolvedValue({
      module_pulse: false,
      config: {},
      custom_value_ids: {},
    });

    const report = await getPulseCadenceDiagnostics('loc_1');

    expect(report.status).toBe('needs_setup');
    expect(report.pulseEnabled).toBe(false);
    expect(report.lastSkippedReason).toBe('pulse_module_disabled');
  });
});

describe('runPulseCadenceCheck', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMerchant.mockResolvedValue({
      module_pulse: true,
      business_name: 'ScaleSafe Merchant',
      support_email: 'support@example.com',
    });
    mockGhlPut.mockResolvedValue({ data: {} });
    mockFireTrigger.mockResolvedValue({ sent: 1, failed: 0 });
    mockIdempotencyExists.mockResolvedValue(false);
    mockIdempotencyRecord.mockResolvedValue(undefined);
  });

  it('syncs pulse contact fields and fires the shared app-event payload with durable aliases', async () => {
    const updatePayloads: any[] = [];
    const row = {
      id: 'enr_1',
      location_id: 'loc_1',
      contact_id: 'contact_1',
      offer_id: 'offer_1',
      status: 'enrolled',
      pulse_cadence_enabled: true,
      pulse_frequency_days: 14,
      next_pulse_due_at: '2026-06-29T00:00:00.000Z',
    };
    mockFrom.mockImplementation((table: string) => {
      if (table === 'enrollments') {
        const query: any = {
          ...enrollmentQuery(row),
          ...updateQuery((payload: any) => updatePayloads.push(payload)),
        };
        return query;
      }
      if (table === 'offers_mirror') {
        const query: any = {
          select: jest.fn(() => query),
          eq: jest.fn(() => query),
          maybeSingle: jest.fn(async () => ({
            data: { offer_name: 'Beta Program', pulse_frequency_days: 14 },
            error: null,
          })),
        };
        return query;
      }
      if (table === 'trigger_subscriptions') {
        return subscriptionQuery((triggerKey) => ({
          data: triggerKey === 'ss_app_event' ? [{ id: 'sub_app' }] : [],
          error: null,
        }));
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    await runPulseCadenceCheck();

    expect(mockGhlPut).toHaveBeenCalledWith(
      '/contacts/contact_1',
      expect.objectContaining({
        customField: expect.objectContaining({
          'contact.offer_program_name': 'Beta Program',
          'contact.offer_support_email': 'support@example.com',
          'contact.ss_pulse_check_url': expect.stringContaining('/pulse-check?actionToken='),
          'contact.ss_pulse_due_date': 'Jun 29, 2026',
          'contact.ss_pulse_interval_label': 'every 2 weeks',
        }),
      }),
    );
    expect(mockFireTrigger).toHaveBeenCalledWith(
      'loc_1',
      'ss_app_event',
      expect.objectContaining({
        event_type: 'Pulse Check Due',
        eventType: 'pulse_check_due',
        event_type_key: 'pulse_check_due',
        eventTypeKey: 'pulse_check_due',
        app_event_type: 'pulse_check_due',
        appEventType: 'pulse_check_due',
        event_type_display: 'Pulse Check Due',
        contact_id: 'contact_1',
        enrollment_id: 'enr_1',
        offer_name: 'Beta Program',
        pulse_check_url: expect.stringContaining('/pulse-check?actionToken='),
        pulseCheckUrl: expect.stringContaining('/pulse-check?actionToken='),
        pulse_due_date_display: 'Jun 29, 2026',
        pulse_interval_label: 'every 2 weeks',
        support_email: 'support@example.com',
        business_name: 'ScaleSafe Merchant',
      }),
    );
    expect(updatePayloads).toEqual(expect.arrayContaining([
      expect.objectContaining({
        last_pulse_sent_at: expect.any(String),
        next_pulse_due_at: expect.any(String),
      }),
    ]));
    expect(mockIdempotencyRecord).toHaveBeenCalledWith(
      'pulse-check:loc_1:enr_1:2026-06-29T00:00:00.000Z',
      'pulse_check',
      'loc_1',
      expect.objectContaining({ sent: 1, failed: 0, next_pulse_due_at: '2026-06-29T00:00:00.000Z' }),
    );
  });

  it('does not resend the same due pulse when already recorded', async () => {
    mockIdempotencyExists.mockResolvedValue(true);
    const row = {
      id: 'enr_1',
      location_id: 'loc_1',
      contact_id: 'contact_1',
      offer_id: 'offer_1',
      status: 'enrolled',
      pulse_cadence_enabled: true,
      pulse_frequency_days: 14,
      next_pulse_due_at: '2026-06-29T00:00:00.000Z',
    };
    mockFrom.mockImplementation((table: string) => {
      if (table === 'enrollments') {
        return enrollmentQuery(row);
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    await runPulseCadenceCheck();

    expect(mockFireTrigger).not.toHaveBeenCalled();
    expect(mockIdempotencyRecord).not.toHaveBeenCalled();
  });
});
