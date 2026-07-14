const mockRpc = jest.fn();
const mockFrom = jest.fn();
const mockGhlPut = jest.fn();
const mockFireTrigger = jest.fn();

function updateBuilder(onUpdate: jest.Mock) {
  const builder: any = {
    update: jest.fn((payload: any) => {
      onUpdate(payload);
      return builder;
    }),
    eq: jest.fn(() => builder),
    then: (resolve: any, reject: any) => Promise.resolve({ error: null }).then(resolve, reject),
  };
  return builder;
}

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({
    rpc: (...args: any[]) => mockRpc(...args),
    from: (...args: any[]) => mockFrom(...args),
  }),
}));

jest.mock('../../src/clients/ghl.client', () => ({
  ghlApi: jest.fn(async () => ({ put: mockGhlPut })),
}));

jest.mock('../../src/services/trigger.service', () => ({
  triggerService: {
    fireTrigger: (...args: any[]) => mockFireTrigger(...args),
  },
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { triggerDeliveryWorker } from '../../src/services/trigger-delivery-worker';

const baseJob = {
  id: 'job_1',
  location_id: 'loc_1',
  trigger_key: 'ss_milestone_reached',
  idempotency_key: 'milestone:enr_1:1',
  contact_id: 'contact_1',
  payload: { enrollment_id: 'enr_1' },
  contact_field_updates: { 'contact.offer_name': 'Offer One' },
  status: 'processing',
  attempt_count: 1,
  max_attempts: 3,
  available_at: '2026-07-14T00:00:00.000Z',
  lease_owner: 'worker',
  lease_expires_at: '2026-07-14T00:03:00.000Z',
  trigger_result: null,
  error_message: null,
};

beforeEach(() => {
  jest.clearAllMocks();
});

afterAll(() => triggerDeliveryWorker.stop());

test('syncs contact fields and records one successful trigger delivery', async () => {
  const update = jest.fn();
  mockRpc.mockResolvedValue({ data: [baseJob], error: null });
  mockFrom.mockReturnValue(updateBuilder(update));
  mockGhlPut.mockResolvedValue({ status: 200 });
  mockFireTrigger.mockResolvedValue({ sent: 1, failed: 0 });

  await triggerDeliveryWorker.runOnce();

  expect(mockGhlPut).toHaveBeenCalledWith('/contacts/contact_1', {
    customField: { 'contact.offer_name': 'Offer One' },
  });
  expect(mockFireTrigger).toHaveBeenCalledTimes(1);
  expect(update).toHaveBeenCalledWith(expect.objectContaining({
    status: 'succeeded',
    trigger_result: { sent: 1, failed: 0 },
  }));
});

test('retries a failed contact-field sync before touching the trigger provider', async () => {
  const update = jest.fn();
  mockRpc.mockResolvedValue({ data: [baseJob], error: null });
  mockFrom.mockReturnValue(updateBuilder(update));
  mockGhlPut.mockRejectedValue(new Error('GHL unavailable'));

  await triggerDeliveryWorker.runOnce();

  expect(mockFireTrigger).not.toHaveBeenCalled();
  expect(update).toHaveBeenCalledWith(expect.objectContaining({
    status: 'pending',
    error_message: expect.stringContaining('will retry'),
  }));
});

test('marks an ambiguous provider exception unknown instead of replaying it', async () => {
  const update = jest.fn();
  mockRpc.mockResolvedValue({ data: [{ ...baseJob, contact_field_updates: null }], error: null });
  mockFrom.mockReturnValue(updateBuilder(update));
  mockFireTrigger.mockRejectedValue(new Error('socket reset'));

  await triggerDeliveryWorker.runOnce();

  expect(update).toHaveBeenCalledWith(expect.objectContaining({
    status: 'unknown',
    error_message: expect.stringContaining('manual review'),
  }));
});
