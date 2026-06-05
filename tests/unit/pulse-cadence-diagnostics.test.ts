const mockFrom = jest.fn();
const mockMerchant = jest.fn();

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: mockFrom }),
}));

jest.mock('../../src/repositories/merchant.repository', () => ({
  merchantRepository: {
    getByLocationId: (...args: any[]) => mockMerchant(...args),
  },
}));

jest.mock('../../src/services/trigger.service', () => ({
  triggerService: { fireTrigger: jest.fn() },
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { getPulseCadenceDiagnostics } from '../../src/jobs/pulse-cadence-check';

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
      throw new Error(`Unexpected table: ${table}`);
    });
  });

  it('reports due pulse check-ins as ready when the app-event workflow is subscribed', async () => {
    const report = await getPulseCadenceDiagnostics('loc_1');

    expect(report.status).toBe('ready');
    expect(report.dueCount).toBe(1);
    expect(report.formUrlConfigured).toBe(true);
    expect(report.lastSkippedReason).toBeNull();
  });

  it('reports due pulse check-ins as setup-needed when the app-event workflow is not subscribed', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'enrollments') return thenableQuery({ data: [{ id: 'enr_1' }], error: null });
      if (table === 'trigger_subscriptions') return thenableQuery({ data: [], error: null });
      if (table === 'trigger_delivery_logs') return thenableQuery({ data: [], error: null });
      throw new Error(`Unexpected table: ${table}`);
    });

    const report = await getPulseCadenceDiagnostics('loc_1');

    expect(report.status).toBe('needs_setup');
    expect(report.formUrlConfigured).toBe(true);
    expect(report.lastSkippedReason).toBe('ss_app_event_subscription_missing');
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
