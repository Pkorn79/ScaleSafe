// ─── Mocks ──────────────────────────────────────────────────────

const mockFrom = jest.fn();
jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: mockFrom }),
}));

const mockFindById = jest.fn();
const mockGetById = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockListByLocation = jest.fn();
jest.mock('../../src/repositories/offer.repository', () => ({
  offerRepository: {
    findById: mockFindById,
    getById: mockGetById,
    create: mockCreate,
    update: mockUpdate,
    listByLocation: mockListByLocation,
    delete: jest.fn(),
  },
}));

jest.mock('../../src/repositories/merchant.repository', () => ({
  merchantRepository: {
    findByLocationId: jest.fn(),
    getByLocationId: jest.fn(),
  },
}));

jest.mock('../../src/clients/ghl.client', () => ({
  ghlApi: jest.fn().mockResolvedValue({
    post: jest.fn().mockResolvedValue({ data: { product: { id: 'prod-1' }, price: { id: 'price-1' } } }),
    put: jest.fn().mockResolvedValue({ data: {} }),
  }),
}));

jest.mock('../../src/config', () => ({
  config: {
    ghl: { clientId: '', clientSecret: '', ssoKey: '', apiDomain: '' },
    supabase: { url: 'http://localhost', serviceKey: 'test' },
    stripe: { secretKey: '', publishableKey: '', clientId: '', webhookSecret: '' },
    appUrl: 'http://localhost:3000',
    logLevel: 'silent',
    isDev: true,
    nodeEnv: 'test',
  },
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../src/services/processor.factory', () => ({
  resolveProcessor: jest.fn(),
  createProcessorClient: jest.fn(),
}));

jest.mock('../../src/middleware/tenantContext', () => ({
  resolveLocationId: jest.fn().mockReturnValue('loc-1'),
  requireTenant: jest.fn().mockImplementation((_req: any, _res: any, next: any) => next()),
}));

jest.mock('../../src/middleware/ssoAuth', () => ({
  ssoAuth: jest.fn().mockImplementation((_req: any, _res: any, next: any) => next()),
}));

import { offerService } from '../../src/services/offer.service';

// ─── Tests ──────────────────────────────────────────────────────

describe('Light Checkout Mode', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should save checkout_mode to offers_mirror on create', async () => {
    mockCreate.mockImplementation((data: any) => Promise.resolve({ id: 'offer-new', ...data }));

    const result = await offerService.create({
      locationId: 'loc-1',
      offerName: 'Quick Product',
      price: 97,
      checkoutMode: 'quick_checkout',
      quickCheckoutConsentText: 'I agree to this charge.',
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        checkout_mode: 'quick_checkout',
        quick_checkout_consent_text: 'I agree to this charge.',
      }),
    );
  });

  it('should default checkout_mode to full_enrollment', async () => {
    mockCreate.mockImplementation((data: any) => Promise.resolve({ id: 'offer-new', ...data }));

    await offerService.create({
      locationId: 'loc-1',
      offerName: 'Default Mode',
      price: 5000,
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        checkout_mode: 'full_enrollment',
      }),
    );
  });

  it('should update checkout_mode fields', async () => {
    mockGetById.mockResolvedValue({
      id: 'offer-1',
      location_id: 'loc-1',
      offer_name: 'Test',
      checkout_mode: 'full_enrollment',
    });
    mockUpdate.mockImplementation((_id: string, updates: any) =>
      Promise.resolve({ id: 'offer-1', ...updates }),
    );

    await offerService.update('offer-1', {
      checkoutMode: 'quick_checkout',
      quickCheckoutShowDescription: false,
    });

    expect(mockUpdate).toHaveBeenCalledWith(
      'offer-1',
      expect.objectContaining({
        checkout_mode: 'quick_checkout',
        quick_checkout_show_description: false,
      }),
    );
  });

  it('should generate quick-checkout link for quick_checkout mode', () => {
    const link = offerService.generateEnrollmentLink('offer-1', 'https://app.scalesafe.com', 'quick_checkout');
    expect(link).toBe('https://app.scalesafe.com/quick-checkout?offerId=offer-1');
  });

  it('should generate enrollment link for full_enrollment mode', () => {
    const link = offerService.generateEnrollmentLink('offer-1', 'https://app.scalesafe.com', 'full_enrollment');
    expect(link).toBe('https://app.scalesafe.com/enrollment?offerId=offer-1');
  });
});

describe('Clone Offer', () => {
  beforeEach(() => jest.clearAllMocks());

  it('should create a copy with new ID and "(Copy)" suffix', async () => {
    mockGetById.mockResolvedValue({
      id: 'offer-orig',
      location_id: 'loc-1',
      offer_name: 'Premium Coaching',
      price: 5000,
      payment_type: 'installments',
      active: true,
      ghl_product_id: 'ghl-prod-1',
      ghl_price_ids: { recurring: 'price-1' },
      ghl_custom_object_id: 'co-1',
      checkout_mode: 'full_enrollment',
    });
    mockCreate.mockImplementation((data: any) => Promise.resolve({ id: 'offer-clone', ...data }));

    const clone = await offerService.cloneOffer('offer-orig', 'loc-1');

    expect(clone.offer_name).toBe('Premium Coaching (Copy)');
    expect(clone.id).toBe('offer-clone');
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        offer_name: 'Premium Coaching (Copy)',
        price: 5000,
        active: false,
        ghl_product_id: null,
        ghl_custom_object_id: null,
      }),
    );
  });

  it('should NOT copy GHL product/price IDs', async () => {
    mockGetById.mockResolvedValue({
      id: 'offer-orig',
      location_id: 'loc-1',
      offer_name: 'Test',
      ghl_product_id: 'ghl-prod-1',
      ghl_price_ids: { one_time: 'price-1' },
      ghl_custom_object_id: 'co-1',
    });
    mockCreate.mockImplementation((data: any) => Promise.resolve({ id: 'offer-clone', ...data }));

    await offerService.cloneOffer('offer-orig', 'loc-1');

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        ghl_product_id: null,
        ghl_price_ids: {},
        ghl_custom_object_id: null,
      }),
    );
  });

  it('should set cloned offer as inactive', async () => {
    mockGetById.mockResolvedValue({
      id: 'offer-orig',
      location_id: 'loc-1',
      offer_name: 'Active Offer',
      active: true,
    });
    mockCreate.mockImplementation((data: any) => Promise.resolve({ id: 'offer-clone', ...data }));

    const clone = await offerService.cloneOffer('offer-orig', 'loc-1');

    expect(clone.active).toBe(false);
  });

  it('should throw for wrong location_id', async () => {
    mockGetById.mockResolvedValue({
      id: 'offer-orig',
      location_id: 'loc-other',
      offer_name: 'Test',
    });

    await expect(offerService.cloneOffer('offer-orig', 'loc-1'))
      .rejects.toThrow('Offer not found');
  });
});

describe('Payment Management Controller', () => {
  const {
    getPaymentHistory,
    getPaymentMethods,
    chargeStoredCard,
    issueRefund,
  } = require('../../src/controllers/payment-management.controller');

  function mockReq(body: any = {}, params: any = {}, query: any = {}): any {
    return { body, params, query, headers: {}, ip: '127.0.0.1', merchantId: 'merch-1' };
  }

  function mockRes(): any {
    const res: any = {};
    res.json = jest.fn().mockReturnValue(res);
    res.status = jest.fn().mockReturnValue(res);
    return res;
  }

  function mockChain(data: any, error: any = null) {
    return {
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data, error }),
      maybeSingle: jest.fn().mockResolvedValue({ data, error }),
    };
  }

  beforeEach(() => jest.clearAllMocks());

  it('should return payment history for a customer', async () => {
    const chain = mockChain([
      { id: '1', created_at: '2026-04-01', amount: 500, event_type: 'sale', processor: 'nmi', processor_transaction_id: 'tx-1' },
      { id: '2', created_at: '2026-03-01', amount: 500, event_type: 'sale', processor: 'nmi', processor_transaction_id: 'tx-2' },
    ]);
    // Override: order returns the chain which then has implicit data
    chain.order.mockReturnValue({ data: chain.select.mock ? chain : [
      { id: '1', created_at: '2026-04-01', amount: 500, event_type: 'sale', processor: 'nmi', processor_transaction_id: 'tx-1' },
    ], error: null });

    mockFrom.mockReturnValue(chain);

    const req = mockReq({}, { contactId: 'contact-1' });
    const res = mockRes();
    const next = jest.fn();

    await getPaymentHistory(req, res, next);

    // Should call from('payment_events')
    expect(mockFrom).toHaveBeenCalledWith('payment_events');
  });

  it('should return 400 for charge without required fields', async () => {
    const req = mockReq({ contactId: 'c1' }); // missing paymentMethodId and amount
    const res = mockRes();
    const next = jest.fn();

    await chargeStoredCard(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('should return 400 for refund without required fields', async () => {
    const req = mockReq({ paymentEventId: 'e1' }); // missing amount
    const res = mockRes();
    const next = jest.fn();

    await issueRefund(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('should return 400 for refund with negative amount', async () => {
    const req = mockReq({ paymentEventId: 'e1', amount: -50 });
    const res = mockRes();
    const next = jest.fn();

    await issueRefund(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});
