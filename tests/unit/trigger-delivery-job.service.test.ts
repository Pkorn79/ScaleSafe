const mockFrom = jest.fn();

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: (...args: any[]) => mockFrom(...args) }),
}));

import { triggerDeliveryJobService } from '../../src/services/trigger-delivery-job.service';

const existingJob = {
  id: 'job_1',
  location_id: 'loc_1',
  trigger_key: 'ss_milestone_reached',
  idempotency_key: 'milestone:enr_1:1',
  contact_id: 'contact_1',
  payload: {},
  contact_field_updates: null,
  status: 'pending',
  attempt_count: 0,
  max_attempts: 3,
  available_at: '2026-07-14T00:00:00.000Z',
  lease_owner: null,
  lease_expires_at: null,
  trigger_result: null,
  error_message: null,
};

function insertQuery(result: { data: any; error: any }, capture: jest.Mock) {
  const builder: any = {
    insert: jest.fn((payload: any) => {
      capture(payload);
      return builder;
    }),
    select: jest.fn(() => builder),
    single: jest.fn(async () => result),
  };
  return builder;
}

function selectQuery(result: { data: any; error: any }) {
  const builder: any = {
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    maybeSingle: jest.fn(async () => result),
  };
  return builder;
}

beforeEach(() => jest.clearAllMocks());

test('stores a deterministic idempotency identity in the queued trigger payload', async () => {
  const capture = jest.fn();
  mockFrom.mockReturnValue(insertQuery({ data: existingJob, error: null }, capture));

  const result = await triggerDeliveryJobService.enqueue({
    locationId: 'loc_1',
    triggerKey: 'ss_milestone_reached',
    idempotencyKey: 'milestone:enr_1:1',
    contactId: 'contact_1',
    payload: { enrollment_id: 'enr_1' },
  });

  expect(result).toEqual({ job: existingJob, created: true });
  expect(capture).toHaveBeenCalledWith(expect.objectContaining({
    location_id: 'loc_1',
    idempotency_key: 'milestone:enr_1:1',
    payload: expect.objectContaining({
      enrollment_id: 'enr_1',
      idempotency_key: 'milestone:enr_1:1',
      idempotencyKey: 'milestone:enr_1:1',
    }),
  }));
});

test('returns the existing tenant job after a unique-key race', async () => {
  const capture = jest.fn();
  mockFrom
    .mockReturnValueOnce(insertQuery({ data: null, error: { code: '23505', message: 'duplicate' } }, capture))
    .mockReturnValueOnce(selectQuery({ data: existingJob, error: null }));

  const result = await triggerDeliveryJobService.enqueue({
    locationId: 'loc_1',
    triggerKey: 'ss_milestone_reached',
    idempotencyKey: 'milestone:enr_1:1',
    payload: {},
  });

  expect(result).toEqual({ job: existingJob, created: false });
  expect(mockFrom).toHaveBeenCalledTimes(2);
});
