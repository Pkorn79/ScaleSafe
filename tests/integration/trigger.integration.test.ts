import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

jest.mock('../../src/clients/ghl.client', () => ({
  ghlApi: jest.fn(() => Promise.resolve({ post: mockedAxios.post })),
}));

// Mock Supabase with in-memory store for integration testing
const subscriptionStore: Record<string, { is_active: boolean; subscription_url: string; trigger_key: string; location_id: string }[]> = {};

function storeKey(locationId: string, triggerKey: string) {
  return `${locationId}:${triggerKey}`;
}

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({
    from: (table: string) => {
      if (table === 'trigger_delivery_logs') {
        return {
          insert: () => ({ error: null }),
        };
      }
      if (table !== 'trigger_subscriptions') throw new Error(`Unexpected table: ${table}`);
      return {
        upsert: (data: any, _opts: any) => ({
          select: () => ({
            single: () => {
              const key = storeKey(data.location_id, data.trigger_key);
              if (!subscriptionStore[key]) subscriptionStore[key] = [];
              const existing = subscriptionStore[key].find(
                (s) => s.subscription_url === data.subscription_url,
              );
              if (existing) {
                existing.is_active = data.is_active;
              } else {
                subscriptionStore[key].push({ ...data });
              }
              return { data, error: null };
            },
          }),
        }),
        update: (updates: any) => ({
          eq: (col1: string, val1: string) => ({
            eq: (col2: string, val2: string) => ({
              eq: (col3: string, val3: string) => {
                const key = storeKey(val1, val2);
                const subs = subscriptionStore[key] || [];
                const match = subs.find((s) => s.subscription_url === val3);
                if (match) match.is_active = updates.is_active;
                return { error: null };
              },
            }),
          }),
        }),
        select: () => ({
          eq: (col1: string, val1: string) => ({
            eq: (col2: string, val2: string) => ({
              eq: (col3: string, val3: boolean) => {
                const key = storeKey(val1, val2);
                const subs = (subscriptionStore[key] || []).filter((s) => s.is_active === val3);
                return { data: subs, error: null };
              },
            }),
          }),
        }),
      };
    },
  }),
}));

import { triggerRepository } from '../../src/repositories/trigger.repository';
import { triggerService } from '../../src/services/trigger.service';

beforeEach(() => {
  jest.clearAllMocks();
  // Clear the in-memory store
  for (const key of Object.keys(subscriptionStore)) {
    delete subscriptionStore[key];
  }
});

describe('Trigger Integration — subscribe → fire → verify POST', () => {
  test('full lifecycle: subscribe, fire trigger, verify POST to subscription URL', async () => {
    // Step 1: Subscribe
    await triggerRepository.upsertSubscription(
      'loc_1',
      'ss_payment_received',
      'https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/loc_1/workflow-abc',
    );

    // Step 2: Fire the trigger
    mockedAxios.post.mockResolvedValue({ status: 200, data: {} });

    const payload = {
      contact_id: 'contact_123',
      offer_name: '12-Week Program',
      amount: 2997.0,
      payment_type: 'pif',
    };

    const result = await triggerService.fireTrigger('loc_1', 'ss_payment_received', payload);

    // Step 3: Verify
    expect(result).toEqual({ sent: 1, failed: 0 });
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/loc_1/workflow-abc',
      expect.objectContaining({
        ...payload,
        contactId: 'contact_123',
        event_type: 'payment_received',
        location_id: 'loc_1',
        locationId: 'loc_1',
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

  test('unsubscribe prevents trigger delivery', async () => {
    // Subscribe
    await triggerRepository.upsertSubscription(
      'loc_1',
      'ss_payment_received',
      'https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/loc_1/workflow-abc',
    );

    // Unsubscribe
    await triggerRepository.deactivateSubscription(
      'loc_1',
      'ss_payment_received',
      'https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/loc_1/workflow-abc',
    );

    // Fire — should not POST
    const result = await triggerService.fireTrigger('loc_1', 'ss_payment_received', {
      contact_id: 'c1',
    });

    expect(result).toEqual({ sent: 0, failed: 0 });
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  test('multiple subscriptions for same trigger all receive the payload', async () => {
    await triggerRepository.upsertSubscription(
      'loc_1',
      'enrollment_complete',
      'https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/loc_1/wf1',
    );
    await triggerRepository.upsertSubscription(
      'loc_1',
      'enrollment_complete',
      'https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/loc_1/wf2',
    );

    mockedAxios.post.mockResolvedValue({ status: 200, data: {} });

    const payload = { contact_id: 'c1', offer_name: 'Program A' };
    const result = await triggerService.fireTrigger('loc_1', 'enrollment_complete', payload);

    expect(result).toEqual({ sent: 2, failed: 0 });
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
  });

  test('trigger for different location does not fire cross-tenant', async () => {
    await triggerRepository.upsertSubscription(
      'loc_1',
      'ss_payment_received',
      'https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/loc_1/wf1',
    );

    // Fire for loc_2 — should find no subscriptions
    const result = await triggerService.fireTrigger('loc_2', 'ss_payment_received', {
      contact_id: 'c1',
    });

    expect(result).toEqual({ sent: 0, failed: 0 });
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });
});
