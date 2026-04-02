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

import { compileOfferTcHtml, calcInstallmentAmount, buildRefundText } from '../../src/services/offer.service';

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

describe('compileOfferTcHtml', () => {
  it('returns link HTML when merchant has own T&C', () => {
    const html = compileOfferTcHtml({
      locationId: 'loc-1',
      offerName: 'Test',
      merchantTcHasOwn: true,
      merchantTcDocumentUrl: 'https://example.com/terms',
    });

    expect(html).toContain('https://example.com/terms');
    expect(html).toContain('<a href=');
  });

  it('merges merchant defaults with per-offer overrides', () => {
    const html = compileOfferTcHtml({
      locationId: 'loc-1',
      offerName: 'Test',
      merchantTcClauseToggles: {
        purchase_summary: true,
        program_scope: false,
      },
      tcClauseOverrides: {
        program_scope: true,  // override: turn ON
        purchase_summary: false, // override: turn OFF
      },
    });

    // purchase_summary OFF via override
    expect(html).not.toContain('purchasing the program');
    // program_scope ON via override
    expect(html).toContain('reviewed the program description');
  });

  it('uses merchant custom clauses when no per-offer override', () => {
    const html = compileOfferTcHtml({
      locationId: 'loc-1',
      offerName: 'Test',
      merchantCustomClause1Title: 'NDA',
      merchantCustomClause1Text: 'Keep it secret.',
    });

    expect(html).toContain('<strong>NDA:</strong>');
    expect(html).toContain('Keep it secret.');
  });

  it('per-offer custom clauses override merchant defaults', () => {
    const html = compileOfferTcHtml({
      locationId: 'loc-1',
      offerName: 'Test',
      merchantCustomClause1Title: 'NDA',
      merchantCustomClause1Text: 'Merchant version.',
      customClause1Title: 'Liability',
      customClause1Text: 'Offer-specific version.',
    });

    expect(html).toContain('Liability');
    expect(html).toContain('Offer-specific version.');
    expect(html).not.toContain('NDA');
  });

  it('returns empty string when nothing enabled', () => {
    const html = compileOfferTcHtml({
      locationId: 'loc-1',
      offerName: 'Test',
    });
    expect(html).toBe('');
  });

  it('escapes HTML to prevent XSS', () => {
    const html = compileOfferTcHtml({
      locationId: 'loc-1',
      offerName: 'Test',
      customClause1Title: '<script>bad</script>',
      customClause1Text: 'text',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
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
