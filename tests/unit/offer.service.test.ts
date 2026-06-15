jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({}),
}));

jest.mock('../../src/clients/ghl.client', () => ({
  ghlApi: jest.fn().mockResolvedValue({
    get: jest.fn().mockResolvedValue({ data: {} }),
    put: jest.fn().mockResolvedValue({ data: {} }),
    post: jest.fn().mockResolvedValue({ data: { product: { id: 'prod-1' }, price: { id: 'price-1' } } }),
  }),
}));

jest.mock('../../src/repositories/offer.repository', () => ({
  offerRepository: {
    create: jest.fn().mockImplementation((data: any) => Promise.resolve({ id: 'offer-1', ...data })),
    getById: jest.fn().mockResolvedValue({ id: 'offer-1', location_id: 'loc-1', price: 6000, num_payments: 6 }),
    update: jest.fn().mockImplementation((_id: string, data: any) => Promise.resolve({ id: 'offer-1', ...data })),
  },
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { compileTcHtml, calcInstallmentAmount, buildRefundText, offerService } from '../../src/services/offer.service';
import { offerRepository } from '../../src/repositories/offer.repository';
import { checkoutCartService } from '../../src/services/checkout-cart.service';

describe('calcInstallmentAmount', () => {
  it('calculates price / numPayments rounded to 2 decimals', () => {
    expect(calcInstallmentAmount(6000, 6)).toBe(1000);
    expect(calcInstallmentAmount(1000, 3)).toBe(333.33);
    expect(calcInstallmentAmount(500, 4)).toBe(125);
  });

  it('returns fallback when price or numPayments missing', () => {
    expect(calcInstallmentAmount(undefined, 6, 99)).toBe(99);
    expect(calcInstallmentAmount(6000, undefined, 99)).toBe(99);
    expect(calcInstallmentAmount(6000, 0, 99)).toBe(99);
  });
});

describe('compileTcHtml', () => {
  it('returns link HTML when tcUrl is provided', () => {
    const html = compileTcHtml([], 'https://example.com/terms');

    expect(html).toContain('https://example.com/terms');
    expect(html).toContain('<a href=');
  });

  it('compiles active clauses into ordered list', () => {
    const html = compileTcHtml([
      { title: 'Purchase Summary', text: 'I confirm that I am purchasing the program...' },
      { title: '', text: '' }, // empty = toggled off
      { title: 'Program Scope', text: 'I confirm that I have reviewed...' },
    ]);

    expect(html).toContain('<ol>');
    expect(html).toContain('I confirm that I am purchasing');
    expect(html).toContain('I confirm that I have reviewed');
  });

  it('skips clauses with empty title/text', () => {
    const html = compileTcHtml([
      { title: 'Active', text: 'Active clause text' },
      { title: '', text: '' },
      { title: '', text: '' },
    ]);

    expect(html).toContain('Active clause text');
    expect((html.match(/<li>/g) || []).length).toBe(1);
  });

  it('returns empty string when no active clauses', () => {
    const html = compileTcHtml([
      { title: '', text: '' },
      { title: '', text: '' },
    ]);
    expect(html).toBe('');
  });

  it('escapes HTML in clause text to prevent XSS', () => {
    const html = compileTcHtml([
      { title: 'Test', text: 'text with <b>html</b> and <script>alert("xss")</script>' },
    ]);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;b&gt;');
    expect(html).toContain('&lt;script&gt;');
  });

  it('handles 11 clause slots (9 standard + 2 custom)', () => {
    const clauses = Array.from({ length: 11 }, (_, i) => ({
      title: `Clause ${i + 1}`,
      text: `Text for clause ${i + 1}`,
    }));
    const html = compileTcHtml(clauses);
    expect((html.match(/<li>/g) || []).length).toBe(11);
  });
});

describe('buildRefundText', () => {
  it('builds "No refunds." for no_refunds', () => {
    expect(buildRefundText('no_refunds')).toBe('No refunds.');
  });

  it('builds full refund text with days', () => {
    expect(buildRefundText('full_refund', 30)).toBe('Full refund within 30 days of purchase.');
  });

  it('builds prorated text', () => {
    expect(buildRefundText('prorated')).toBe('Prorated refund based on services delivered.');
  });

  it('uses custom text for custom type', () => {
    expect(buildRefundText('custom', undefined, 'My custom policy.')).toBe('My custom policy.');
  });
});

describe('offer tracking ID', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('stores optional tracking ID on offer create', async () => {
    await offerService.create({
      locationId: 'loc-1',
      offerName: 'Test Offer',
      trackingId: 'REP-42',
      price: 100,
      paymentType: 'one_time',
    });

    expect(offerRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      tracking_id: 'REP-42',
    }));
  });

  it('stores optional tracking ID on offer update', async () => {
    await offerService.update('offer-1', 'loc-1', {
      trackingId: 'CAMPAIGN-A',
    });

    expect(offerRepository.update).toHaveBeenCalledWith(
      'offer-1',
      expect.objectContaining({
        tracking_id: 'CAMPAIGN-A',
      }),
      'loc-1',
    );
  });

  it('normalizes blank refund policy to null on offer update', async () => {
    await offerService.update('offer-1', 'loc-1', {
      refundPolicyType: '',
    } as any);

    expect(offerRepository.update).toHaveBeenCalledWith(
      'offer-1',
      expect.objectContaining({
        refund_policy_type: null,
      }),
      'loc-1',
    );
  });

  it('retries direct offer update without checkout-channel fields when schema cache is stale', async () => {
    (offerRepository.update as jest.Mock)
      .mockRejectedValueOnce({
        code: 'PGRST204',
        message: "Could not find the 'checkout_type' column of 'offers_mirror' in the schema cache",
      })
      .mockResolvedValueOnce({ id: 'offer-1', checkout_mode: 'quick_checkout' });

    await offerService.update('offer-1', 'loc-1', {
      checkoutType: 'direct',
      checkoutMode: 'quick_checkout',
      trackingId: 'TAG',
    });

    expect(offerRepository.update).toHaveBeenNthCalledWith(
      2,
      'offer-1',
      expect.not.objectContaining({
        checkout_type: expect.anything(),
      }),
      'loc-1',
    );
    expect(offerRepository.update).toHaveBeenNthCalledWith(
      2,
      'offer-1',
      expect.objectContaining({
        checkout_mode: 'quick_checkout',
        tracking_id: 'TAG',
      }),
      'loc-1',
    );
  });
});

describe('offerService.cloneOffer (#13/#31)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not copy Whop processor IDs or tracking_id into the clone', async () => {
    (offerRepository.getById as jest.Mock).mockResolvedValueOnce({
      id: 'offer-src', location_id: 'loc-1', offer_name: 'Coaching',
      price: 6000, num_payments: 6, checkout_type: 'whop',
      whop_product_id: 'prod_live', whop_plan_id: 'plan_live', whop_sync_status: 'synced',
      tracking_id: 'trk_123',
    });

    await offerService.cloneOffer('offer-src', 'loc-1');

    expect(offerRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      whop_product_id: null,
      whop_plan_id: null,
      whop_sync_status: null,
      tracking_id: null,
      checkout_type: 'whop', // still a Whop offer — provisions its own product/plan on first sync
      active: false,
    }));
  });

  it('does not insert UI-only checkout add-on fields and copies add-ons to the new offer', async () => {
    const replaceSpy = jest.spyOn(checkoutCartService, 'replaceOfferAddons').mockResolvedValueOnce();
    jest.spyOn(checkoutCartService, 'listAddons').mockResolvedValue([]);
    (offerRepository.getById as jest.Mock).mockResolvedValueOnce({
      id: 'offer-src',
      location_id: 'loc-1',
      offer_name: 'Coaching',
      price: 2000,
      checkout_addons: [{ id: 'addon-1', kind: 'order_bump', title: 'Workbook', price: 25, active: true, sort_order: 0 }],
      checkoutAddons: [{ id: 'addon-1', kind: 'order_bump', title: 'Workbook', price: 25, active: true, sort_order: 0 }],
    });

    await offerService.cloneOffer('offer-src', 'loc-1');

    expect(offerRepository.create).toHaveBeenCalledWith(expect.not.objectContaining({
      checkout_addons: expect.anything(),
      checkoutAddons: expect.anything(),
    }));
    expect(replaceSpy).toHaveBeenCalledWith('loc-1', 'offer-1', [expect.objectContaining({
      kind: 'order_bump',
      title: 'Workbook',
      price: 25,
      active: true,
      sortOrder: 0,
    })]);
  });
});
