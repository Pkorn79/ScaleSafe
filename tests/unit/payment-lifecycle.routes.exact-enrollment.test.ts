import express from 'express';
import request from 'supertest';

const mockSupabaseFrom = jest.fn();
const mockGetMerchant = jest.fn();
const mockPauseSubscription = jest.fn();
const mockResumeSubscription = jest.fn();
const mockCancelSubscription = jest.fn();
const mockSendCardUpdateRequest = jest.fn();

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: (...args: any[]) => mockSupabaseFrom(...args) }),
}));

jest.mock('../../src/repositories/merchant.repository', () => ({
  merchantRepository: {
    getByLocationId: (...args: any[]) => mockGetMerchant(...args),
  },
}));

jest.mock('../../src/services/payment-lifecycle.service', () => ({
  paymentLifecycleService: {
    pauseSubscription: (...args: any[]) => mockPauseSubscription(...args),
    resumeSubscription: (...args: any[]) => mockResumeSubscription(...args),
    cancelSubscription: (...args: any[]) => mockCancelSubscription(...args),
    sendCardUpdateRequest: (...args: any[]) => mockSendCardUpdateRequest(...args),
  },
}));

jest.mock('../../src/middleware/tenantContext', () => ({
  resolveLocationId: jest.fn().mockReturnValue('loc_1'),
  requireTenant: jest.fn().mockImplementation((_req: any, _res: any, next: any) => next()),
}));

jest.mock('../../src/middleware/ssoAuth', () => ({
  ssoAuth: jest.fn().mockImplementation((_req: any, _res: any, next: any) => next()),
}));

import paymentLifecycleRoutes from '../../src/routes/payment-lifecycle.routes';

function makeBuilder(response: { data?: any; error?: any }) {
  const builder: any = {
    filters: [] as Array<{ column: string; value: any }>,
    select: jest.fn(() => builder),
    in: jest.fn((column: string, value: any) => {
      builder.filters.push({ column, value });
      return builder;
    }),
    eq: jest.fn((column: string, value: any) => {
      builder.filters.push({ column, value });
      return builder;
    }),
    maybeSingle: jest.fn(async () => response),
  };
  return builder;
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/payments/lifecycle', paymentLifecycleRoutes);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });
  return app;
}

describe('payment lifecycle legacy subscription routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetMerchant.mockResolvedValue({ id: 'merchant_1' });
    mockSendCardUpdateRequest.mockResolvedValue({ success: true, link: 'https://app.test/payment-update?actionToken=token' });
  });

  it('requires an exact enrollment for pause requests', async () => {
    const app = makeApp();

    const res = await request(app)
      .post('/api/payments/lifecycle/subscription/pause')
      .send({ contactId: 'contact_1', reason: 'Pause this' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'enrollmentId required' });
    expect(mockSupabaseFrom).not.toHaveBeenCalled();
    expect(mockPauseSubscription).not.toHaveBeenCalled();
  });

  it('uses the enrollment row to pause the exact program', async () => {
    const app = makeApp();
    const enrollmentBuilder = makeBuilder({
      data: {
        id: 'enr_1',
        contact_id: 'contact_1',
        offer_id: 'offer_1',
        processor_subscription_id: 'sub_1',
        processor_type: 'stripe',
        status: 'enrolled',
      },
      error: null,
    });
    mockSupabaseFrom.mockReturnValue(enrollmentBuilder);

    const res = await request(app)
      .post('/api/payments/lifecycle/subscription/pause')
      .send({ enrollmentId: 'enr_1', contactId: 'contact_1', reason: 'Pause this' });

    expect(res.status).toBe(200);
    expect(enrollmentBuilder.filters).toEqual(expect.arrayContaining([
      { column: 'id', value: 'enr_1' },
      { column: 'location_id', value: 'loc_1' },
      { column: 'contact_id', value: 'contact_1' },
      { column: 'status', value: ['enrolled', 'active'] },
    ]));
    expect(mockPauseSubscription).toHaveBeenCalledWith(expect.objectContaining({
      merchantId: 'merchant_1',
      locationId: 'loc_1',
      contactId: 'contact_1',
      enrollmentId: 'enr_1',
      offerId: 'offer_1',
      processorSubscriptionId: 'sub_1',
      processorType: 'stripe',
      reason: 'Pause this',
    }));
  });

  it('uses the enrollment row to cancel the exact program', async () => {
    const app = makeApp();
    mockSupabaseFrom.mockReturnValue(makeBuilder({
      data: {
        id: 'enr_2',
        contact_id: 'contact_2',
        offer_id: 'offer_2',
        processor_subscription_id: 'sub_2',
        processor_type: 'nmi',
        status: 'active',
      },
      error: null,
    }));

    const res = await request(app)
      .post('/api/payments/lifecycle/subscription/cancel')
      .send({ enrollmentId: 'enr_2', reason: 'Cancel this' });

    expect(res.status).toBe(200);
    expect(mockCancelSubscription).toHaveBeenCalledWith(expect.objectContaining({
      merchantId: 'merchant_1',
      locationId: 'loc_1',
      contactId: 'contact_2',
      enrollmentId: 'enr_2',
      offerId: 'offer_2',
      processorSubscriptionId: 'sub_2',
      processorType: 'nmi',
      reason: 'Cancel this',
    }));
  });

  it('uses the enrollment row to resume the exact program', async () => {
    const app = makeApp();
    mockSupabaseFrom.mockReturnValue(makeBuilder({
      data: {
        id: 'enr_3',
        contact_id: 'contact_3',
        offer_id: 'offer_3',
        processor_subscription_id: null,
        processor_type: 'stripe',
        status: 'paused',
      },
      error: null,
    }));

    const res = await request(app)
      .post('/api/payments/lifecycle/subscription/resume')
      .send({ enrollmentId: 'enr_3' });

    expect(res.status).toBe(200);
    expect(mockResumeSubscription).toHaveBeenCalledWith(expect.objectContaining({
      merchantId: 'merchant_1',
      locationId: 'loc_1',
      contactId: 'contact_3',
      enrollmentId: 'enr_3',
      offerId: 'offer_3',
      processorType: 'stripe',
      reason: 'Merchant-initiated resume',
    }));
  });

  it('requires an exact enrollment for card update links', async () => {
    const app = makeApp();

    const res = await request(app)
      .post('/api/payments/lifecycle/send-card-update')
      .send({ contactId: 'contact_1' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'enrollmentId required' });
    expect(mockSupabaseFrom).not.toHaveBeenCalled();
    expect(mockSendCardUpdateRequest).not.toHaveBeenCalled();
  });

  it('creates card update links for the exact enrollment only', async () => {
    const app = makeApp();
    const enrollmentBuilder = makeBuilder({
      data: {
        id: 'enr_4',
        contact_id: 'contact_4',
        offer_id: 'offer_4',
        processor_subscription_id: 'sub_4',
        processor_type: 'nmi',
        status: 'past_due',
      },
      error: null,
    });
    mockSupabaseFrom.mockReturnValue(enrollmentBuilder);

    const res = await request(app)
      .post('/api/payments/lifecycle/send-card-update')
      .send({ enrollmentId: 'enr_4', contactId: 'contact_4', sendTrigger: false });

    expect(res.status).toBe(200);
    expect(enrollmentBuilder.filters).toEqual(expect.arrayContaining([
      { column: 'id', value: 'enr_4' },
      { column: 'location_id', value: 'loc_1' },
      { column: 'contact_id', value: 'contact_4' },
      { column: 'status', value: ['enrolled', 'active', 'paused', 'past_due', 'delinquent'] },
    ]));
    expect(mockSendCardUpdateRequest).toHaveBeenCalledWith('loc_1', 'contact_4', {
      sendTrigger: false,
      enrollmentId: 'enr_4',
    });
  });
});
