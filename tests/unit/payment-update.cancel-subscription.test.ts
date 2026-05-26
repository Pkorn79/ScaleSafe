const mockSupabaseFrom = jest.fn();
const mockFindMerchant = jest.fn();
const mockCancelSubscription = jest.fn();

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: (...args: any[]) => mockSupabaseFrom(...args) }),
}));

jest.mock('../../src/repositories/merchant.repository', () => ({
  merchantRepository: {
    findByLocationId: (...args: any[]) => mockFindMerchant(...args),
  },
}));

jest.mock('../../src/services/payment-lifecycle.service', () => ({
  paymentLifecycleService: {
    cancelSubscription: (...args: any[]) => mockCancelSubscription(...args),
  },
}));

import { cancelSubscriptionPublic } from '../../src/controllers/payment-update.controller';
import { createPublicActionToken } from '../../src/utils/public-action-token';

type BuilderResponse = { data?: any; error?: any };

function makeBuilder(response: BuilderResponse, table = 'unknown') {
  const builder: any = {
    filters: [] as Array<{ column: string; value: any }>,
    payload: null as any,
    select: jest.fn(() => builder),
    order: jest.fn(() => builder),
    limit: jest.fn(() => builder),
    in: jest.fn((column: string, value: any) => {
      builder.filters.push({ column, value });
      return builder;
    }),
    eq: jest.fn((column: string, value: any) => {
      builder.filters.push({ column, value });
      return builder;
    }),
    maybeSingle: jest.fn(async () => response),
    insert: jest.fn(async (payload: any) => {
      builder.payload = payload;
      return response;
    }),
    table,
  };
  return builder;
}

function queueBuilders(builders: Record<string, any[]>) {
  mockSupabaseFrom.mockImplementation((table: string) => {
    const queue = builders[table] || [];
    const builder = queue.shift();
    if (!builder) throw new Error(`Unexpected Supabase table call: ${table}`);
    return builder;
  });
}

function mockResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

describe('cancelSubscriptionPublic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PUBLIC_ACTION_TOKEN_SECRET = 'unit-test-public-action-secret';
    mockFindMerchant.mockResolvedValue({ id: 'merchant_1' });
    mockCancelSubscription.mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete process.env.PUBLIC_ACTION_TOKEN_SECRET;
  });

  it('cancels only the enrollment named in the action token', async () => {
    const token = createPublicActionToken({
      action: 'subscription_cancel',
      locationId: 'loc_1',
      contactId: 'contact_1',
      enrollmentId: 'enr_exact',
    });
    const enrollmentBuilder = makeBuilder({
      data: {
        id: 'enr_exact',
        offer_id: 'offer_1',
        processor_type: 'nmi',
        processor_subscription_id: 'sub_123',
      },
      error: null,
    }, 'enrollments');
    const evidenceBuilder = makeBuilder({ error: null }, 'evidence');

    queueBuilders({
      enrollments: [enrollmentBuilder],
      evidence: [evidenceBuilder],
    });

    const req: any = {
      query: { actionToken: token },
      body: { reason: 'No longer need this program' },
      headers: { 'x-forwarded-for': '1.2.3.4' },
      socket: { remoteAddress: '5.6.7.8' },
    };
    const res: any = mockResponse();
    const next = jest.fn();

    await cancelSubscriptionPublic(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(enrollmentBuilder.filters).toEqual(expect.arrayContaining([
      { column: 'id', value: 'enr_exact' },
      { column: 'location_id', value: 'loc_1' },
      { column: 'contact_id', value: 'contact_1' },
      { column: 'status', value: ['enrolled', 'active', 'paused'] },
    ]));
    expect(mockCancelSubscription).toHaveBeenCalledWith(expect.objectContaining({
      merchantId: 'merchant_1',
      locationId: 'loc_1',
      contactId: 'contact_1',
      enrollmentId: 'enr_exact',
      offerId: 'offer_1',
      processorType: 'nmi',
      processorSubscriptionId: 'sub_123',
      reason: 'Client-initiated: No longer need this program',
    }));
    expect(evidenceBuilder.payload).toEqual(expect.objectContaining({
      location_id: 'loc_1',
      contact_id: 'contact_1',
      enrollment_id: 'enr_exact',
      evidence_type: 'cancellation',
    }));
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('rejects cancellation tokens that are not enrollment-specific', async () => {
    const token = createPublicActionToken({
      action: 'subscription_cancel',
      locationId: 'loc_1',
      contactId: 'contact_1',
    });

    const req: any = {
      query: { actionToken: token },
      body: { reason: 'Cancel' },
      headers: {},
      socket: {},
    };
    const res: any = mockResponse();
    const next = jest.fn();

    await cancelSubscriptionPublic(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockFindMerchant).not.toHaveBeenCalled();
    expect(mockSupabaseFrom).not.toHaveBeenCalled();
    expect(mockCancelSubscription).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Enrollment-specific action token required',
    });
  });
});
