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

jest.mock('../../src/services/merchant.service', () => ({
  merchantService: {
    readGhlCustomValues: jest.fn().mockResolvedValue({}),
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

  it('reports due pulse check-ins as setup-needed when the pulse form URL is missing', async () => {
    const report = await getPulseCadenceDiagnostics('loc_1');

    expect(report.status).toBe('needs_setup');
    expect(report.dueCount).toBe(1);
    expect(report.formUrlConfigured).toBe(false);
    expect(report.lastSkippedReason).toBe('pulse_form_url_missing');
  });
});
