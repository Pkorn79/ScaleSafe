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
      initial_price: 0,
      renewal_price: 25,
      billing_period: 30,
    }));
  });

  it('omits renewal fields when syncing a one-time Whop plan', async () => {
    const post = jest.fn()
      .mockResolvedValueOnce({ data: { id: 'prod_123' } })
      .mockResolvedValueOnce({ data: { id: 'plan_pif_123' } });
    const patch = jest.fn();
    mockAxiosCreate.mockReturnValue({ post, patch });

    const updateChain = query({ data: null });
    const readChain = query({
      data: {
        id: 'offer-1',
        location_id: 'loc-1',
        offer_name: 'ScaleSafe PIF',
        whop_product_id: 'prod_123',
        whop_plan_id: 'plan_pif_123',
      },
    });
    mockFrom.mockReturnValueOnce(updateChain).mockReturnValueOnce(readChain);

    await whopService.syncOffer('loc-1', {
      id: 'offer-1',
      offer_name: 'ScaleSafe PIF',
      program_description: 'Test description',
      payment_type: 'pif',
      price: 10,
      pif_discount_enabled: false,
      whop_product_id: null,
      whop_plan_id: null,
    } as any);

    expect(post).toHaveBeenNthCalledWith(2, '/plans', expect.not.objectContaining({
      renewal_price: expect.anything(),
    }));
    expect(post).toHaveBeenNthCalledWith(2, '/plans', expect.not.objectContaining({
      billing_period: expect.anything(),
    }));
    expect(post).toHaveBeenNthCalledWith(2, '/plans', expect.objectContaining({
      company_id: 'biz_123',
      product_id: 'prod_123',
      plan_type: 'one_time',
      initial_price: 10,
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
      plan_id: 'plan_123',
      mode: 'payment',
      currency: 'usd',
      metadata: expect.objectContaining({
        location_id: 'loc-1',
        merchant_id: 'merchant-1',
        offer_id: 'offer-1',
        enrollment_id: 'enroll-1',
        contact_id: 'contact-1',
        contact_email: 'client@example.com',
        contact_name: 'Client Example',
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

  it('creates a checkout-specific renewal plan when one-time add-ons change due today', async () => {
    const post = jest.fn()
      .mockResolvedValueOnce({ data: { id: 'plan_dynamic_123' } })
      .mockResolvedValueOnce({
        data: {
          id: 'ch_123',
          purchase_url: 'https://whop.com/checkout/plan_dynamic_123?session=ch_123',
        },
      });
    mockAxiosCreate.mockReturnValue({ post });

    await whopService.createCheckoutSession({
      locationId: 'loc-1',
      offer: {
        id: 'offer-1',
        location_id: 'loc-1',
        offer_name: 'Whop Offer',
        payment_type: 'installments',
        installment_frequency: 'weekly',
        num_payments: 5,
        whop_product_id: 'prod_123',
        whop_plan_id: 'plan_123',
      } as any,
      enrollmentId: 'enroll-1',
      contactId: 'contact-1',
      contactEmail: 'client@example.com',
      contactName: 'Client Example',
      consentToken: 'consent-1',
      checkoutMode: 'full_enrollment',
      quote: {
        selectedAmount: 3.2,
        selectedAmountCents: 320,
        addonAmountCents: 100,
        futureRecurringSelectedAmountCents: 220,
        lineItems: [
          { kind: 'base_offer', title: 'Whop Offer', amount: 2.2 },
          { kind: 'pre_payment_upsell', title: 'Upgrade', amount: 1 },
        ],
      } as any,
    });

    expect(post).toHaveBeenNthCalledWith(1, '/plans', expect.objectContaining({
      company_id: 'biz_123',
      product_id: 'prod_123',
      plan_type: 'renewal',
      initial_price: 1,
      renewal_price: 2.2,
      billing_period: 7,
      split_pay_required_payments: 5,
    }));
    expect(post).toHaveBeenNthCalledWith(2, '/checkout_configurations', expect.objectContaining({
      plan_id: 'plan_dynamic_123',
      metadata: expect.objectContaining({
        due_today_amount: 3.2,
        payment_choice: 'installment',
        one_time_addon_amount: 1,
        future_recurring_amount: 2.2,
        line_items: JSON.stringify([
          { kind: 'base_offer', title: 'Whop Offer', amount: 2.2 },
          { kind: 'pre_payment_upsell', title: 'Upgrade', amount: 1 },
        ]),
      }),
    }));
  });

  it('rejects checkout-specific Whop add-ons below the Whop plan minimum before calling Whop', async () => {
    const post = jest.fn();
    mockAxiosCreate.mockReturnValue({ post });

    await expect(whopService.createCheckoutSession({
      locationId: 'loc-1',
      offer: {
        id: 'offer-1',
        location_id: 'loc-1',
        offer_name: 'Whop Offer',
        payment_type: 'installments',
        installment_frequency: 'weekly',
        num_payments: 5,
        whop_product_id: 'prod_123',
        whop_plan_id: 'plan_123',
      } as any,
      enrollmentId: 'enroll-1',
      contactId: 'contact-1',
      contactEmail: 'client@example.com',
      contactName: 'Client Example',
      consentToken: 'consent-1',
      checkoutMode: 'full_enrollment',
      quote: {
        selectedAmount: 2.24,
        selectedAmountCents: 224,
        addonAmountCents: 4,
        futureRecurringSelectedAmountCents: 220,
        lineItems: [],
      } as any,
    })).rejects.toThrow('Selected one-time Whop add-ons must be at least $1.00');

    expect(post).not.toHaveBeenCalled();
  });

  it('uses the synced Whop renewal plan when there are no one-time add-ons', async () => {
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
        payment_type: 'installments',
        installment_frequency: 'weekly',
        num_payments: 5,
        whop_product_id: 'prod_123',
        whop_plan_id: 'plan_123',
      } as any,
      enrollmentId: 'enroll-1',
      contactId: 'contact-1',
      contactEmail: 'client@example.com',
      contactName: 'Client Example',
      consentToken: 'consent-1',
      checkoutMode: 'full_enrollment',
      quote: {
        selectedAmount: 2.2,
        selectedAmountCents: 220,
        addonAmountCents: 0,
        futureRecurringSelectedAmountCents: 220,
        lineItems: [
          { kind: 'base_offer', title: 'Whop Offer', amount: 2.2 },
        ],
      } as any,
    });

    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/checkout_configurations', expect.objectContaining({
      plan_id: 'plan_123',
    }));
    expect(session).toEqual(expect.objectContaining({
      sessionId: 'ch_123',
      planId: 'plan_123',
    }));
  });

  it('creates a one-time checkout plan when PIF is selected on an installment Whop offer', async () => {
    const post = jest.fn()
      .mockResolvedValueOnce({ data: { id: 'plan_pif_123' } })
      .mockResolvedValueOnce({
        data: {
          id: 'ch_pif_123',
          purchase_url: 'https://whop.com/checkout/plan_pif_123?session=ch_pif_123',
        },
      });
    mockAxiosCreate.mockReturnValue({ post });

    const session = await whopService.createCheckoutSession({
      locationId: 'loc-1',
      offer: {
        id: 'offer-1',
        location_id: 'loc-1',
        offer_name: 'Whop Offer',
        payment_type: 'installments',
        installment_frequency: 'monthly',
        num_payments: 2,
        whop_product_id: 'prod_123',
        whop_plan_id: 'plan_recurring_123',
      } as any,
      enrollmentId: 'enroll-1',
      contactId: 'contact-1',
      contactEmail: 'client@example.com',
      contactName: 'Client Example',
      consentToken: '',
      checkoutMode: 'quick_checkout',
      quote: {
        paymentChoice: 'pif',
        selectedAmount: 12,
        selectedAmountCents: 1200,
        addonAmountCents: 200,
        futureRecurringSelectedAmountCents: 0,
        lineItems: [
          { kind: 'base_offer', title: 'Whop Offer', amount: 10 },
          { kind: 'order_bump', title: 'Bump', amount: 2 },
        ],
      } as any,
    });

    expect(post).toHaveBeenNthCalledWith(1, '/plans', expect.objectContaining({
      company_id: 'biz_123',
      product_id: 'prod_123',
      plan_type: 'one_time',
      initial_price: 12,
      metadata: expect.objectContaining({
        payment_choice: 'pif',
      }),
    }));
    expect(post).toHaveBeenNthCalledWith(1, '/plans', expect.not.objectContaining({
      renewal_price: expect.anything(),
    }));
    expect(post).toHaveBeenNthCalledWith(1, '/plans', expect.not.objectContaining({
      billing_period: expect.anything(),
    }));
    expect(post).toHaveBeenNthCalledWith(2, '/checkout_configurations', expect.objectContaining({
      plan_id: 'plan_pif_123',
      metadata: expect.objectContaining({
        payment_choice: 'pif',
        future_recurring_amount: 0,
      }),
    }));
    expect(session).toEqual(expect.objectContaining({
      sessionId: 'ch_pif_123',
      planId: 'plan_pif_123',
    }));
  });
});

describe('whopService lifecycle methods', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWhopGetRequired.mockResolvedValue({
      id: 'whop-config-1',
      location_id: 'loc-1',
      company_id: 'biz_123',
      api_key_encrypted: 'encrypted',
      environment: 'production',
    });
    mockDecryptApiKey.mockReturnValue('whop_key');
  });

  it('refunds a full Whop payment without partial_amount', async () => {
    const post = jest.fn().mockResolvedValue({ data: { id: 'ref_123', status: 'succeeded' } });
    mockAxiosCreate.mockReturnValue({ post });

    const result = await whopService.refundPayment('loc-1', { paymentId: 'pay_123' });

    expect(post).toHaveBeenCalledWith('/payments/pay_123/refund', {});
    expect(result).toEqual(expect.objectContaining({ success: true, refundId: 'ref_123' }));
  });

  it('refunds a partial Whop payment with partial_amount', async () => {
    const post = jest.fn().mockResolvedValue({ data: { id: 'ref_123', status: 'succeeded' } });
    mockAxiosCreate.mockReturnValue({ post });

    await whopService.refundPayment('loc-1', { paymentId: 'pay_123', partialAmount: 3.2 });

    expect(post).toHaveBeenCalledWith('/payments/pay_123/refund', { partial_amount: 3.2 });
  });

  it('pauses, resumes, and cancels Whop memberships with the membership endpoint', async () => {
    const post = jest.fn().mockResolvedValue({ data: { id: 'mem_123' } });
    mockAxiosCreate.mockReturnValue({ post });

    await whopService.pauseMembership('loc-1', 'mem_123');
    await whopService.resumeMembership('loc-1', 'mem_123');
    await whopService.cancelMembership('loc-1', 'mem_123');

    expect(post).toHaveBeenNthCalledWith(1, '/memberships/mem_123/pause');
    expect(post).toHaveBeenNthCalledWith(2, '/memberships/mem_123/resume');
    expect(post).toHaveBeenNthCalledWith(3, '/memberships/mem_123/cancel', { cancellation_mode: 'immediate' });
  });

  it('rejects lifecycle calls without Whop-formatted IDs', async () => {
    const post = jest.fn();
    mockAxiosCreate.mockReturnValue({ post });

    await expect(whopService.refundPayment('loc-1', { paymentId: 'txn_123' })).rejects.toThrow(/Whop payment ID/i);
    await expect(whopService.pauseMembership('loc-1', 'sub_123')).rejects.toThrow(/Whop membership ID/i);
    expect(post).not.toHaveBeenCalled();
  });
});
