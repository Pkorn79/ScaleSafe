process.env.PROCESSOR_ENCRYPTION_KEY =
  '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

const mockAxiosCreate = jest.fn();
jest.mock('axios', () => ({
  __esModule: true,
  default: { create: (...a: any[]) => mockAxiosCreate(...a) },
}));

const mockFrom = jest.fn();
jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: mockFrom }),
}));

const mockWhopGetRequired = jest.fn();
const mockDecryptApiKey = jest.fn();
jest.mock('../../src/services/whop-config.service', () => ({
  whopConfigService: {
    getRequired: (...a: any[]) => mockWhopGetRequired(...a),
    decryptApiKey: (...a: any[]) => mockDecryptApiKey(...a),
  },
}));

const mockMerchantGetByLocationId = jest.fn();
jest.mock('../../src/repositories/merchant.repository', () => ({
  merchantRepository: {
    getByLocationId: (...a: any[]) => mockMerchantGetByLocationId(...a),
  },
}));

import { whopApiBaseUrl, whopService } from '../../src/services/whop.service';

function query(result: { data: any; error?: any } = { data: null }) {
  const c: any = {};
  c.from = jest.fn(() => c);
  c.update = jest.fn(() => c);
  c.select = jest.fn(() => c);
  c.eq = jest.fn(() => c);
  c.single = jest.fn(() => Promise.resolve(result));
  return c;
}

describe('whopApiBaseUrl', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.WHOP_API_BASE_URL;
    delete process.env.WHOP_SANDBOX_API_BASE_URL;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('uses Whop production API for production configs', () => {
    expect(whopApiBaseUrl('production')).toBe('https://api.whop.com/api/v5');
  });

  it('uses Whop sandbox API for sandbox configs', () => {
    expect(whopApiBaseUrl('sandbox')).toBe('https://sandbox-api.whop.com/api/v1');
  });

  it('allows sandbox-specific override without changing production', () => {
    process.env.WHOP_SANDBOX_API_BASE_URL = 'https://sandbox-api.whop.com/api/v5/';
    process.env.WHOP_API_BASE_URL = 'https://api.whop.com/api/v5/';

    expect(whopApiBaseUrl('sandbox')).toBe('https://sandbox-api.whop.com/api/v5');
    expect(whopApiBaseUrl('production')).toBe('https://api.whop.com/api/v5');
  });
});

describe('whopService.syncOffer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWhopGetRequired.mockResolvedValue({
      id: 'whop-config-1',
      location_id: 'loc-1',
      company_id: 'biz_123',
      api_key_encrypted: 'encrypted',
      environment: 'sandbox',
    });
    mockDecryptApiKey.mockReturnValue('whop_key');
  });

  it('sends title when creating Whop products and plans', async () => {
    const post = jest.fn()
      .mockResolvedValueOnce({ data: { id: 'prod_123' } })
      .mockResolvedValueOnce({ data: { id: 'plan_123' } });
    const patch = jest.fn();
    mockAxiosCreate.mockReturnValue({ post, patch });

    const updateChain = query({ data: null });
    const readChain = query({
      data: {
        id: 'offer-1',
        location_id: 'loc-1',
        offer_name: 'ScaleSafe Test Plan',
        whop_product_id: 'prod_123',
        whop_plan_id: 'plan_123',
      },
    });
    mockFrom.mockReturnValueOnce(updateChain).mockReturnValueOnce(readChain);

    await whopService.syncOffer('loc-1', {
      id: 'offer-1',
      offer_name: 'ScaleSafe Test Plan',
      program_description: 'Test description',
      payment_type: 'subscription',
      installment_amount: 25,
      price: 25,
      installment_frequency: 'monthly',
      whop_product_id: null,
      whop_plan_id: null,
    } as any);

    expect(post).toHaveBeenNthCalledWith(1, '/products', expect.objectContaining({
      company_id: 'biz_123',
      title: 'ScaleSafe Test Plan',
      name: 'ScaleSafe Test Plan',
    }));
    expect(post).toHaveBeenNthCalledWith(2, '/plans', expect.objectContaining({
      company_id: 'biz_123',
      product_id: 'prod_123',
      plan_type: 'renewal',
      release_method: 'buy_now',
      title: 'ScaleSafe Test Plan',
      nickname: 'ScaleSafe Test Plan',
      initial_price: 25,
      renewal_price: 25,
      billing_period: 30,
    }));
  });
});

describe('whopService.createCheckoutSession', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWhopGetRequired.mockResolvedValue({
      id: 'whop-config-1',
      location_id: 'loc-1',
      company_id: 'biz_123',
      api_key_encrypted: 'encrypted',
      environment: 'sandbox',
    });
    mockDecryptApiKey.mockReturnValue('whop_key');
    mockMerchantGetByLocationId.mockResolvedValue({ id: 'merchant-1' });
  });

  it('creates a Whop checkout configuration for embedded checkout metadata', async () => {
    const post = jest.fn().mockResolvedValue({
      data: {
        id: 'ch_123',
        purchase_url: 'https://whop.com/checkout/plan_123?session=ch_123',
      },
    });
    mockAxiosCreate.mockReturnValue({ post });

    const session = await whopService.createCheckoutSession({
      locationId: 'loc-1',
      offer: {
        id: 'offer-1',
        location_id: 'loc-1',
        offer_name: 'Whop Offer',
        whop_plan_id: 'plan_123',
      } as any,
      enrollmentId: 'enroll-1',
      contactId: 'contact-1',
      contactEmail: 'client@example.com',
      contactName: 'Client Example',
      consentToken: 'consent-1',
      checkoutMode: 'full_enrollment',
    });

    expect(post).toHaveBeenCalledWith('/checkout_configurations', expect.objectContaining({
      plan: expect.objectContaining({
        id: 'plan_123',
        company_id: 'biz_123',
      }),
      mode: 'payment',
      metadata: expect.objectContaining({
        location_id: 'loc-1',
        merchant_id: 'merchant-1',
        offer_id: 'offer-1',
        enrollment_id: 'enroll-1',
        contact_id: 'contact-1',
        consent_token: 'consent-1',
        checkout_mode: 'full_enrollment',
      }),
      allow_promo_codes: false,
    }));
    expect(session).toEqual(expect.objectContaining({
      sessionId: 'ch_123',
      checkoutUrl: 'https://whop.com/checkout/plan_123?session=ch_123',
      planId: 'plan_123',
      environment: 'sandbox',
    }));
  });
});
