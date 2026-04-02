jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({}),
}));

jest.mock('../../src/repositories/trigger.repository', () => ({
  triggerRepository: {
    upsertSubscription: jest.fn().mockResolvedValue({
      id: 'sub1',
      location_id: 'loc_1',
      trigger_key: 'enrollment_complete',
      subscription_url: 'https://hooks.ghl.com/wf1',
      is_active: true,
    }),
    deactivateSubscription: jest.fn().mockResolvedValue(undefined),
  },
}));

import { triggerController } from '../../src/controllers/trigger.controller';
import { triggerRepository } from '../../src/repositories/trigger.repository';

function mockReqRes(body: Record<string, unknown>) {
  const req = { body } as any;
  const res = { json: jest.fn(), status: jest.fn().mockReturnThis() } as any;
  const next = jest.fn();
  return { req, res, next };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Trigger Controller - handleSubscription', () => {
  test('subscribe creates a subscription', async () => {
    const { req, res, next } = mockReqRes({
      type: 'subscribe',
      locationId: 'loc_1',
      triggerKey: 'enrollment_complete',
      subscriptionUrl: 'https://hooks.ghl.com/wf1',
    });

    await triggerController.handleSubscription(req, res, next);

    expect(triggerRepository.upsertSubscription).toHaveBeenCalledWith(
      'loc_1',
      'enrollment_complete',
      'https://hooks.ghl.com/wf1',
    );
    expect(res.json).toHaveBeenCalledWith({ success: true });
    expect(next).not.toHaveBeenCalled();
  });

  test('unsubscribe deactivates a subscription', async () => {
    const { req, res, next } = mockReqRes({
      type: 'unsubscribe',
      locationId: 'loc_1',
      triggerKey: 'enrollment_complete',
      subscriptionUrl: 'https://hooks.ghl.com/wf1',
    });

    await triggerController.handleSubscription(req, res, next);

    expect(triggerRepository.deactivateSubscription).toHaveBeenCalledWith(
      'loc_1',
      'enrollment_complete',
      'https://hooks.ghl.com/wf1',
    );
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  test('rejects invalid trigger key', async () => {
    const { req, res, next } = mockReqRes({
      type: 'subscribe',
      locationId: 'loc_1',
      triggerKey: 'bogus_key',
      subscriptionUrl: 'https://hooks.ghl.com/wf1',
    });

    await triggerController.handleSubscription(req, res, next);

    expect(next).toHaveBeenCalled();
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(400);
    expect(err.message).toContain('Invalid trigger key');
  });

  test('rejects missing required fields', async () => {
    const { req, res, next } = mockReqRes({
      type: 'subscribe',
      locationId: 'loc_1',
    });

    await triggerController.handleSubscription(req, res, next);

    expect(next).toHaveBeenCalled();
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(400);
  });

  test('rejects invalid subscription type', async () => {
    const { req, res, next } = mockReqRes({
      type: 'update',
      locationId: 'loc_1',
      triggerKey: 'enrollment_complete',
      subscriptionUrl: 'https://hooks.ghl.com/wf1',
    });

    await triggerController.handleSubscription(req, res, next);

    expect(next).toHaveBeenCalled();
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(400);
    expect(err.message).toContain('Invalid subscription type');
  });
});
