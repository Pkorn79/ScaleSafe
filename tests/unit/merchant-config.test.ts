const mockGetByLocationId = jest.fn();
const mockUpdate = jest.fn();
const mockGhlGet = jest.fn();
const mockGhlPut = jest.fn();

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({}),
}));

jest.mock('../../src/repositories/merchant.repository', () => ({
  merchantRepository: {
    getByLocationId: (...args: any[]) => mockGetByLocationId(...args),
    update: (...args: any[]) => mockUpdate(...args),
    getConfig: jest.fn().mockResolvedValue({}),
  },
}));

jest.mock('../../src/clients/ghl.client', () => ({
  ghlApi: jest.fn().mockResolvedValue({
    get: (...args: any[]) => mockGhlGet(...args),
    put: (...args: any[]) => mockGhlPut(...args),
    post: jest.fn().mockResolvedValue({ data: {} }),
  }),
}));

jest.mock('../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { merchantService } from '../../src/services/merchant.service';
import * as CV from '../../src/constants/ghl-custom-value-ids';

const baseMerchant = {
  id: 'merchant-1',
  location_id: 'loc-123',
  company_id: null,
  ghl_access_token: 'token',
  ghl_refresh_token: 'refresh',
  ghl_token_expires_at: null,
  ghl_scopes: null,
  business_name: 'Test Biz',
  dba_name: 'Test Brand',
  support_email: 'test@biz.com',
  descriptor: 'TEST BIZ',
  logo_url: null,
  industry: 'Coaching',
  onboarding_complete: false,
  tc_clause_toggles: {},
  custom_value_ids: {
    BUSINESS_NAME: CV.CV_BUSINESS_NAME,
    DBA_BRAND_NAME: CV.CV_DBA_BRAND_NAME,
    SUPPORT_EMAIL: CV.CV_SUPPORT_EMAIL,
    DESCRIPTOR: CV.CV_DESCRIPTOR,
    BUSINESS_WEBSITE: CV.CV_BUSINESS_WEBSITE,
    BUSINESS_CITY: CV.CV_BUSINESS_CITY,
    BUSINESS_STATE: CV.CV_BUSINESS_STATE,
    INDUSTRY_NICHE: CV.CV_INDUSTRY_NICHE,
    PRIMARY_SERVICE_TYPE: CV.CV_PRIMARY_SERVICE_TYPE,
    LOGO_URL: CV.CV_LOGO_URL,
    SHORT_DESCRIPTION: CV.CV_SHORT_DESCRIPTION,
    TC_HAS_OWN: CV.CV_TC_HAS_OWN,
    TC_DOCUMENT_URL: CV.CV_TC_DOCUMENT_URL,
    MODULE_SESSIONS: CV.CV_MODULE_SESSIONS,
    MODULE_MILESTONES: CV.CV_MODULE_MILESTONES,
    MODULE_PULSE: CV.CV_MODULE_PULSE,
    MODULE_PAYMENTS: CV.CV_MODULE_PAYMENTS,
    MODULE_COURSE: CV.CV_MODULE_COURSE,
  },
  config: {},
  module_sessions: true,
  module_milestones: true,
  module_pulse: false,
  module_payments: true,
  module_course: false,
  snapshot_status: 'installed',
  snapshot_attempts: 1,
  trigger_ids: {},
  status: 'active',
  installed_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

// GHL custom values returned by GET /locations/:id/customValues
// The id field is what we use for PUT requests
const ghlCustomValues = [
  { id: CV.CV_BUSINESS_NAME, fieldKey: 'custom_values.merchant_business_name', value: 'Test Biz' },
  { id: CV.CV_SUPPORT_EMAIL, fieldKey: 'custom_values.merchant_support_email', value: 'test@biz.com' },
  { id: CV.CV_TC_HAS_OWN, fieldKey: 'custom_values.tc_has_own', value: 'false' },
  { id: CV.CV_TC_DOCUMENT_URL, fieldKey: 'custom_values.tc_document_url', value: '' },
  { id: CV.CV_MODULE_SESSIONS, fieldKey: 'custom_values.module_session_tracking', value: 'Enabled' },
  { id: CV.CV_DBA_BRAND_NAME, fieldKey: 'custom_values.dba__brand_name', value: '' },
  { id: CV.CV_DESCRIPTOR, fieldKey: 'custom_values.merchant_descriptor', value: 'TEST BIZ' },
  { id: CV.CV_BUSINESS_WEBSITE, fieldKey: 'custom_values.business_website', value: 'testbiz.com' },
  { id: CV.CV_BUSINESS_CITY, fieldKey: 'custom_values.business_city', value: 'LA' },
  { id: CV.CV_BUSINESS_STATE, fieldKey: 'custom_values.business_state', value: 'CA' },
  { id: CV.CV_INDUSTRY_NICHE, fieldKey: 'custom_values.industry__niche', value: 'Coaching' },
  { id: CV.CV_PRIMARY_SERVICE_TYPE, fieldKey: 'custom_values.primary_service_type', value: 'Coaching' },
  { id: CV.CV_LOGO_URL, fieldKey: 'custom_values.ss_merchant_logo_url', value: '' },
  { id: CV.CV_SHORT_DESCRIPTION, fieldKey: 'custom_values.short_business_description', value: '' },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockGetByLocationId.mockResolvedValue({ ...baseMerchant });
  mockUpdate.mockImplementation((_locationId: string, updates: any) =>
    Promise.resolve({ ...baseMerchant, ...updates })
  );
  mockGhlGet.mockResolvedValue({
    data: { customValues: ghlCustomValues },
  });
  mockGhlPut.mockResolvedValue({ data: {} });
});

// ─── getFullConfig ───────────────────────────────────────────────────

describe('merchantService.getFullConfig', () => {
  it('returns combined Supabase + GHL custom values', async () => {
    const config = await merchantService.getFullConfig('loc-123');

    expect(config.locationId).toBe('loc-123');
    expect(config.businessName).toBe('Test Biz');
    expect(config.supportEmail).toBe('test@biz.com');
    expect(config.descriptor).toBe('TEST BIZ');
    expect(config.businessWebsite).toBe('testbiz.com');
    expect(config.businessCity).toBe('LA');
    expect(config.businessState).toBe('CA');
    expect(config.status).toBe('active');
    expect(config.onboardingComplete).toBe(false);
    expect(config.modules.sessions).toBe(true);
    expect(config.modules.pulse).toBe(false);
  });

  it('defaults recommended clauses to ON', async () => {
    const config = await merchantService.getFullConfig('loc-123');

    expect(config.standardClauses.purchase_summary).toBe(true);
    expect(config.standardClauses.cardholder_auth).toBe(true);
    expect(config.standardClauses.program_scope).toBe(false);
    expect(config.standardClauses.no_guaranteed_results).toBe(false);
  });

  it('respects stored clause toggles from tc_clause_toggles', async () => {
    mockGetByLocationId.mockResolvedValue({
      ...baseMerchant,
      tc_clause_toggles: {
        purchase_summary: false,
        program_scope: true,
      },
    });

    const config = await merchantService.getFullConfig('loc-123');

    expect(config.standardClauses.purchase_summary).toBe(false);
    expect(config.standardClauses.program_scope).toBe(true);
    expect(config.standardClauses.cardholder_auth).toBe(true); // still default
  });

  it('uses Supabase values when GHL is unavailable', async () => {
    mockGhlGet.mockRejectedValue(new Error('GHL down'));

    const config = await merchantService.getFullConfig('loc-123');

    expect(config.businessName).toBe('Test Biz');
    expect(config.supportEmail).toBe('test@biz.com');
  });
});

// ─── updateFullConfig ────────────────────────────────────────────────

describe('merchantService.updateFullConfig', () => {
  it('writes to Supabase and syncs to GHL with exact IDs', async () => {
    await merchantService.updateFullConfig('loc-123', {
      businessName: 'Updated Biz',
      supportEmail: 'new@biz.com',
      businessWebsite: 'newbiz.com',
    });

    // Supabase update
    expect(mockUpdate).toHaveBeenCalledWith('loc-123', expect.objectContaining({
      business_name: 'Updated Biz',
      support_email: 'new@biz.com',
      onboarding_complete: true,
    }));

    // GHL custom value syncs using exact IDs
    const putCalls = mockGhlPut.mock.calls.map((c: any[]) => c[0]);
    expect(putCalls).toContain(`/locations/loc-123/customValues/${CV.CV_BUSINESS_NAME}`);
    expect(putCalls).toContain(`/locations/loc-123/customValues/${CV.CV_SUPPORT_EMAIL}`);
    expect(putCalls).toContain(`/locations/loc-123/customValues/${CV.CV_BUSINESS_WEBSITE}`);
  });

  it('sets onboarding_complete when business name + email present', async () => {
    await merchantService.updateFullConfig('loc-123', {
      businessName: 'Has Name',
      supportEmail: 'has@email.com',
    });

    expect(mockUpdate).toHaveBeenCalledWith('loc-123', expect.objectContaining({
      onboarding_complete: true,
    }));
  });

  it('does not set onboarding_complete if missing required fields', async () => {
    mockGetByLocationId.mockResolvedValue({
      ...baseMerchant,
      business_name: null,
      support_email: null,
    });

    await merchantService.updateFullConfig('loc-123', {
      businessWebsite: 'testbiz.com',
    });

    expect(mockUpdate).toHaveBeenCalledWith('loc-123', expect.not.objectContaining({
      onboarding_complete: true,
    }));
  });

  it('stores clause toggles in tc_clause_toggles column', async () => {
    await merchantService.updateFullConfig('loc-123', {
      standardClauses: {
        purchase_summary: true,
        program_scope: true,
        refund_cancellation: false,
      },
    });

    expect(mockUpdate).toHaveBeenCalledWith('loc-123', expect.objectContaining({
      tc_clause_toggles: expect.objectContaining({
        purchase_summary: true,
        program_scope: true,
        refund_cancellation: false,
      }),
    }));
  });

  it('syncs module toggles to GHL as Enabled/Disabled', async () => {
    await merchantService.updateFullConfig('loc-123', {
      modules: { sessions: false, pulse: true },
    });

    const sessionCall = mockGhlPut.mock.calls.find(
      (c: any[]) => c[0] === `/locations/loc-123/customValues/${CV.CV_MODULE_SESSIONS}`
    );
    expect(sessionCall).toBeDefined();
    expect(sessionCall![1]).toEqual(expect.objectContaining({ value: 'Disabled' }));

    const pulseCall = mockGhlPut.mock.calls.find(
      (c: any[]) => c[0] === `/locations/loc-123/customValues/${CV.CV_MODULE_PULSE}`
    );
    expect(pulseCall).toBeDefined();
    expect(pulseCall![1]).toEqual(expect.objectContaining({ value: 'Enabled' }));
  });

  it('keeps compiled T&C HTML out of location-level GHL custom values', async () => {
    await merchantService.updateFullConfig('loc-123', {
      standardClauses: { purchase_summary: true },
    });

    const htmlCall = mockGhlPut.mock.calls.find((c: any[]) =>
      String(c[0]).includes('compiled_terms_html')
    );
    expect(htmlCall).toBeUndefined();
  });
});

// ─── compileTcHtml ───────────────────────────────────────────────────

describe('merchantService.compileTcHtml', () => {
  it('returns link HTML when merchant has own T&C', () => {
    const html = merchantService.compileTcHtml({
      tcHasOwn: true,
      tcDocumentUrl: 'https://example.com/terms',
      standardClauses: {},
      customClause1Title: '', customClause1Text: '',
      customClause2Title: '', customClause2Text: '',
    });

    expect(html).toContain('https://example.com/terms');
    expect(html).toContain('<a href=');
  });

  it('compiles selected standard clauses into ordered list', () => {
    const html = merchantService.compileTcHtml({
      tcHasOwn: false,
      tcDocumentUrl: '',
      standardClauses: {
        purchase_summary: true,
        cardholder_auth: true,
        program_scope: false,
      },
      customClause1Title: '', customClause1Text: '',
      customClause2Title: '', customClause2Text: '',
    });

    expect(html).toContain('<ol>');
    expect(html).toContain('purchasing the program');
    expect(html).toContain('authorized user');
    expect(html).not.toContain('reviewed the program description');
  });

  it('includes custom clauses with bold titles', () => {
    const html = merchantService.compileTcHtml({
      tcHasOwn: false,
      tcDocumentUrl: '',
      standardClauses: { purchase_summary: true },
      customClause1Title: 'NDA',
      customClause1Text: 'You agree not to share.',
      customClause2Title: '', customClause2Text: '',
    });

    expect(html).toContain('<strong>NDA:</strong>');
    expect(html).toContain('You agree not to share.');
  });

  it('returns empty string when no clauses selected', () => {
    const html = merchantService.compileTcHtml({
      tcHasOwn: false,
      tcDocumentUrl: '',
      standardClauses: {},
      customClause1Title: '', customClause1Text: '',
      customClause2Title: '', customClause2Text: '',
    });

    expect(html).toBe('');
  });

  it('escapes HTML in clause text to prevent XSS', () => {
    const html = merchantService.compileTcHtml({
      tcHasOwn: false,
      tcDocumentUrl: '',
      standardClauses: {},
      customClause1Title: '<script>alert("xss")</script>',
      customClause1Text: 'Clean text',
      customClause2Title: '', customClause2Text: '',
    });

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

// ─── readGhlCustomValues ─────────────────────────────────────────────

describe('merchantService.readGhlCustomValues', () => {
  it('builds id→value map from GHL response', async () => {
    const map = await merchantService.readGhlCustomValues('loc-123');

    expect(map[CV.CV_BUSINESS_NAME]).toBe('Test Biz');
    expect(map[CV.CV_TC_HAS_OWN]).toBe('false');
    expect(map[CV.CV_BUSINESS_WEBSITE]).toBe('testbiz.com');
  });
});
