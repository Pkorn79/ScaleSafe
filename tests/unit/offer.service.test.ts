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
    await offerService.update('offer-1', {
      trackingId: 'CAMPAIGN-A',
    });

    expect(offerRepository.update).toHaveBeenCalledWith('offer-1', expect.objectContaining({
      tracking_id: 'CAMPAIGN-A',
    }));
  });
});
