const mockSupabaseFrom = jest.fn();

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: (...args: any[]) => mockSupabaseFrom(...args) }),
}));

jest.mock('../../src/services/defense.service', () => ({
  defenseService: {},
}));

import { dashboardController } from '../../src/controllers/dashboard.controller';
import { defenseController } from '../../src/controllers/defense.controller';

function makeBuilder(response: { data?: any; error?: any; count?: number | null }) {
  const builder: any = {
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    in: jest.fn(() => builder),
    not: jest.fn(() => builder),
    or: jest.fn(() => builder),
    order: jest.fn(() => builder),
    range: jest.fn(() => builder),
    then: (resolve: any, reject: any) => Promise.resolve(response).then(resolve, reject),
  };
  return builder;
}

function queueBuilders(builders: Record<string, any[]>) {
  mockSupabaseFrom.mockImplementation((table: string) => {
    const builder = (builders[table] || []).shift();
    if (!builder) throw new Error(`Unexpected Supabase table call: ${table}`);
    return builder;
  });
}

function response() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('client list returns the internal label and frozen customer-facing enrollment name', async () => {
  const clientList = makeBuilder({
    data: [{
      location_id: 'loc_1',
      contact_id: 'contact_1',
      enrollment_id: 'enrollment_1',
      offer_id: 'offer_1',
      first_name: 'Test',
      last_name: 'Client',
      email: 'test@example.com',
      status: 'enrolled',
      payment_type: 'one_time',
      offer_name: 'Current Public Name',
    }],
    count: 1,
    error: null,
  });
  const enrollments = makeBuilder({
    data: [{ id: 'enrollment_1', offer_id: 'offer_1', program_name_snapshot: 'Original Client Program' }],
    error: null,
  });
  const offers = makeBuilder({
    data: [{ id: 'offer_1', offer_name: 'Current Public Name', internal_name: 'CERT Internal Label' }],
    error: null,
  });
  queueBuilders({
    client_list_view: [clientList],
    enrollments: [enrollments],
    offers_mirror: [offers],
  });
  const res = response();

  await dashboardController.clients({
    params: { locationId: 'loc_1' },
    query: { statusGroup: 'active' },
  } as any, res as any, jest.fn());

  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
    clients: [expect.objectContaining({
      offerName: 'Original Client Program',
      offerInternalName: 'CERT Internal Label',
    })],
  }));
  expect(offers.eq).toHaveBeenCalledWith('location_id', 'loc_1');
});

test('defense transaction selector separates internal and frozen public names', async () => {
  const events = makeBuilder({
    data: [{
      id: 'payment_1',
      created_at: '2026-07-15T12:00:00Z',
      amount: 50,
      processor_transaction_id: 'txn_1',
      processor: 'stripe',
      event_type: 'sale',
      enrollment_id: 'enrollment_1',
    }],
    error: null,
  });
  const enrollments = makeBuilder({
    data: [{ id: 'enrollment_1', offer_id: 'offer_1', program_name_snapshot: 'Original Client Program' }],
    error: null,
  });
  const offers = makeBuilder({
    data: [{ id: 'offer_1', offer_name: 'Current Public Name', internal_name: 'CERT Internal Label' }],
    error: null,
  });
  queueBuilders({
    payment_events: [events],
    enrollments: [enrollments],
    offers_mirror: [offers],
  });
  const res = response();

  await defenseController.getTransactions({
    params: { locationId: 'loc_1', contactId: 'contact_1' },
  } as any, res as any, jest.fn());

  expect(res.json).toHaveBeenCalledWith({
    transactions: [expect.objectContaining({
      offerName: 'Original Client Program',
      offerInternalName: 'CERT Internal Label',
    })],
  });
  expect(offers.eq).toHaveBeenCalledWith('location_id', 'loc_1');
});
