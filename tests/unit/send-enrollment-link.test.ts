// Mocks

const mockGhlPost = jest.fn();
const mockGhlPut = jest.fn();
const mockGhlGet = jest.fn();
jest.mock('../../src/clients/ghl.client', () => ({
  ghlApi: jest.fn().mockResolvedValue({
    post: mockGhlPost,
    put: mockGhlPut,
    get: mockGhlGet,
  }),
}));

const mockFindById = jest.fn();
jest.mock('../../src/repositories/offer.repository', () => ({
  offerRepository: { findById: mockFindById },
}));

const mockFireTrigger = jest.fn();
jest.mock('../../src/services/trigger.service', () => ({
  triggerService: { fireTrigger: mockFireTrigger },
}));

const mockGetFullConfig = jest.fn();
jest.mock('../../src/services/merchant.service', () => ({
  merchantService: {
    getFullConfig: mockGetFullConfig,
  },
}));

jest.mock('../../src/config', () => ({
  config: {
    ghl: { clientId: '', clientSecret: '', ssoKey: '', apiDomain: '' },
    supabase: { url: 'http://localhost', serviceKey: 'test' },
    appUrl: 'https://scalesafe-production.up.railway.app',
    logLevel: 'silent',
    isDev: true,
    nodeEnv: 'test',
  },
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../src/middleware/tenantContext', () => ({
  resolveLocationId: jest.fn().mockReturnValue('loc-1'),
  requireTenant: jest.fn().mockImplementation((_r: any, _s: any, n: any) => n()),
}));

jest.mock('../../src/middleware/ssoAuth', () => ({
  ssoAuth: jest.fn().mockImplementation((_r: any, _s: any, n: any) => n()),
}));

jest.mock('../../src/services/evidence.service', () => ({
  evidenceService: { logEvidence: jest.fn().mockResolvedValue({ id: 'evidence-1' }) },
}));

import { searchEnrollmentContacts, sendEnrollmentLink } from '../../src/controllers/send-link.controller';
import { ghlApi } from '../../src/clients/ghl.client';

function mockReq(body: any = {}): any {
  return { body, headers: {}, ip: '127.0.0.1' };
}

function mockRes(): any {
  const res: any = {};
  res.json = jest.fn().mockReturnValue(res);
  res.status = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn().mockReturnValue(res);
  return res;
}

// ─── Tests ──────────────────────────────────────────────────────

describe('Send Enrollment Link', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetFullConfig.mockResolvedValue({ enrollmentFunnelUrl: 'https://merchant.example.com' });
  });

  it('should upsert GHL contact, write fields, and fire trigger', async () => {
    mockFindById.mockResolvedValue({
      id: 'offer-1',
      location_id: 'loc-1',
      active: true,
      offer_name: 'Premium Coaching',
      checkout_mode: 'full_enrollment',
    });

    mockGhlPost.mockResolvedValue({ data: { contact: { id: 'contact-123' } } });
    mockGhlPut.mockResolvedValue({ data: {} });
    mockFireTrigger.mockResolvedValue({ sent: 1, failed: 0 });

    const req = mockReq({
      offerId: 'offer-1',
      firstName: 'John',
      lastName: 'Smith',
      email: 'john@example.com',
      sendVia: ['email'],
    });
    const res = mockRes();
    const next = jest.fn();

    await sendEnrollmentLink(req, res, next);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        contactId: 'contact-123',
        enrollmentUrl: expect.stringContaining('offerId=offer-1'),
        sentVia: ['email'],
      }),
    );

    // Verify GHL contact upsert
    expect(mockGhlPost).toHaveBeenCalledWith('/contacts/upsert', expect.objectContaining({
      firstName: 'John',
      email: 'john@example.com',
    }));

    // Verify custom field write
    expect(mockGhlPut).toHaveBeenCalledWith('/contacts/contact-123', expect.objectContaining({
      customField: expect.objectContaining({
        'contact.ss_enrollment_link': expect.stringContaining('offerId=offer-1'),
        'contact.ss_current_offer_name': 'Premium Coaching',
      }),
    }));

    // Verify trigger fired
    expect(mockFireTrigger).toHaveBeenCalledWith('loc-1', 'ss_send_enrollment_link', expect.objectContaining({
      contact_id: 'contact-123',
      offer_id: 'offer-1',
    }));
  });

  it('should require email when sendVia includes email', async () => {
    const req = mockReq({
      offerId: 'offer-1',
      firstName: 'John',
      sendVia: ['email'],
      // no email
    });
    const res = mockRes();
    await sendEnrollmentLink(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('email') }),
    );
  });

  it('should require phone when sendVia includes sms', async () => {
    const req = mockReq({
      offerId: 'offer-1',
      firstName: 'John',
      email: 'john@example.com',
      sendVia: ['sms'],
      // no phone
    });
    const res = mockRes();
    await sendEnrollmentLink(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('phone') }),
    );
  });

  it('should return 404 for inactive offer', async () => {
    mockFindById.mockResolvedValue({ id: 'offer-1', active: false });

    const req = mockReq({
      offerId: 'offer-1',
      firstName: 'John',
      email: 'john@example.com',
      sendVia: ['email'],
    });
    const res = mockRes();
    await sendEnrollmentLink(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('should build correct enrollment URL with offerId', async () => {
    mockFindById.mockResolvedValue({
      id: 'offer-abc',
      location_id: 'loc-1',
      active: true,
      offer_name: 'Test',
      checkout_mode: 'full_enrollment',
    });
    mockGhlPost.mockResolvedValue({ data: { contact: { id: 'c-1' } } });
    mockGhlPut.mockResolvedValue({ data: {} });
    mockFireTrigger.mockResolvedValue({ sent: 1, failed: 0 });

    const req = mockReq({
      offerId: 'offer-abc',
      firstName: 'Jane',
      email: 'jane@test.com',
      sendVia: ['email'],
    });
    const res = mockRes();
    await sendEnrollmentLink(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        enrollmentUrl: 'https://merchant.example.com/welcome?offerId=offer-abc',
      }),
    );
  });

  it('should reject full enrollment sends when no funnel URL is configured', async () => {
    mockGetFullConfig.mockResolvedValue({ enrollmentFunnelUrl: '' });
    mockFindById.mockResolvedValue({
      id: 'offer-full',
      location_id: 'loc-1',
      active: true,
      offer_name: 'Full Enrollment Product',
      checkout_mode: 'full_enrollment',
    });

    const req = mockReq({
      offerId: 'offer-full',
      firstName: 'Jane',
      email: 'jane@test.com',
      sendVia: ['email'],
    });
    const res = mockRes();
    await sendEnrollmentLink(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.stringContaining('Enrollment Funnel URL'),
    }));
    expect(mockGhlPost).not.toHaveBeenCalled();
  });

  it('should use quick-checkout URL for quick_checkout offers', async () => {
    mockFindById.mockResolvedValue({
      id: 'offer-quick',
      location_id: 'loc-1',
      active: true,
      offer_name: 'Quick Product',
      checkout_mode: 'quick_checkout',
    });
    mockGhlPost.mockResolvedValue({ data: { contact: { id: 'c-2' } } });
    mockGhlPut.mockResolvedValue({ data: {} });
    mockFireTrigger.mockResolvedValue({ sent: 1, failed: 0 });

    const req = mockReq({
      offerId: 'offer-quick',
      firstName: 'Jane',
      email: 'jane@test.com',
      sendVia: ['email'],
    });
    const res = mockRes();
    await sendEnrollmentLink(req, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        enrollmentUrl: 'https://scalesafe-production.up.railway.app/quick-checkout?offerId=offer-quick',
      }),
    );
  });

  it('should handle GHL API errors gracefully', async () => {
    mockFindById.mockResolvedValue({
      id: 'offer-1',
      location_id: 'loc-1',
      active: true,
      offer_name: 'Test',
    });
    mockGhlPost.mockRejectedValue(new Error('GHL API timeout'));

    const req = mockReq({
      offerId: 'offer-1',
      firstName: 'John',
      email: 'john@test.com',
      sendVia: ['email'],
    });
    const res = mockRes();
    await sendEnrollmentLink(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('Unable to create contact') }),
    );
  });
});

describe('Search HighLevel contacts', () => {
  beforeEach(() => jest.resetAllMocks());

  function request(query: any = { q: 'alex' }): any {
    return { query, tenantContext: { locationId: 'loc-1' } };
  }

  async function run(req = request()) {
    (ghlApi as jest.Mock).mockResolvedValue({ post: mockGhlPost });
    const res = mockRes();
    const next = jest.fn();
    await searchEnrollmentContacts(req, res, next);
    return { res, next };
  }

  it('searches only the authenticated location and returns minimal contact fields', async () => {
    mockGhlPost.mockResolvedValue({ data: { contacts: [
      { id: 'contact-1', locationId: 'loc-1', firstNameLowerCase: 'alex', lastNameLowerCase: 'smith', email: 'alex@example.com', phone: '+15555550123', customFields: [{ value: 'private' }] },
      { id: 'foreign', locationId: 'loc-2', email: 'foreign@example.com' },
      { id: 'unscoped', email: 'unscoped@example.com' },
    ], total: 3 } });
    const req = request({ q: ' alex ', locationId: 'loc-2', page: '1' });
    const { res } = await run(req);
    expect(ghlApi).toHaveBeenCalledWith('loc-1');
    expect(mockGhlPost).toHaveBeenCalledWith('/contacts/search', { query: 'alex', locationId: 'loc-1', page: 1, pageLimit: 20 });
    expect(res.json).toHaveBeenCalledWith({
      contacts: [{ id: 'contact-1', firstName: 'alex', lastName: 'smith', name: 'alex smith', email: 'alex@example.com', phone: '+15555550123' }],
      page: 1, hasMore: false,
    });
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  it.each(['alex@example.com', '+15555550123'])('passes a name/email/phone search as query: %s', async (q) => {
    mockGhlPost.mockResolvedValue({ data: { contacts: [], total: 0 } });
    await run(request({ q }));
    expect(mockGhlPost).toHaveBeenCalledWith('/contacts/search', expect.objectContaining({ query: q }));
  });

  it('paginates large result sets', async () => {
    mockGhlPost.mockResolvedValue({ data: { contacts: [], total: 60 } });
    const { res } = await run(request({ q: 'alex', page: '2' }));
    expect(res.json).toHaveBeenCalledWith({ contacts: [], page: 2, hasMore: true });
    expect(mockGhlPost).toHaveBeenCalledWith('/contacts/search', expect.objectContaining({ page: 2 }));
  });

  it.each([{ q: '' }, { q: 'a' }, { q: ['alex', 'bob'] }, { q: 'a'.repeat(76) }, { q: 'alex', page: 'bad' }, { q: 'alex', page: '0' }, { q: 'alex', page: '501' }])('rejects invalid search %j', async (query) => {
    const { res } = await run(request(query));
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockGhlPost).not.toHaveBeenCalled();
  });

  it('does not accept a caller-supplied location instead of tenant context', async () => {
    const { res } = await run({ query: { q: 'alex', locationId: 'loc-1' }, params: { locationId: 'loc-1' } } as any);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(ghlApi).not.toHaveBeenCalled();
  });

  it('does not turn a malformed response or upstream error into no matches', async () => {
    mockGhlPost.mockResolvedValueOnce({ data: {} });
    expect((await run()).res.status).toHaveBeenCalledWith(502);
    const failure = new Error('HighLevel unavailable');
    mockGhlPost.mockRejectedValueOnce(failure);
    expect((await run()).next).toHaveBeenCalledWith(failure);
  });
});

describe('Send to a selected HighLevel contact', () => {
  const contact = { id: 'ghl-only', locationId: 'loc-1', firstName: 'Alex', lastName: 'Smith', email: 'alex@example.com', phone: '+15555550123' };

  beforeEach(() => {
    jest.clearAllMocks();
    (ghlApi as jest.Mock).mockResolvedValue({ post: mockGhlPost, put: mockGhlPut, get: mockGhlGet });
    const { resolveLocationId } = require('../../src/middleware/tenantContext');
    resolveLocationId.mockReturnValue('loc-1');
    mockFindById.mockResolvedValue({ id: 'offer-1', location_id: 'loc-1', active: true, offer_name: 'Test program', checkout_mode: 'quick_checkout' });
    mockGetFullConfig.mockResolvedValue({ enrollmentFunnelUrl: '' });
    mockGhlGet.mockResolvedValue({ data: { contact } });
    mockGhlPost.mockResolvedValue({ data: { id: 'message-1' } });
    mockGhlPut.mockResolvedValue({ data: {} });
    mockFireTrigger.mockResolvedValue({ sent: 1, failed: 0 });
  });

  async function run(body: any = {}) {
    const res = mockRes();
    const next = jest.fn();
    await sendEnrollmentLink(mockReq({ offerId: 'offer-1', contactId: 'ghl-only', sendVia: ['email'], ...body }), res, next);
    return { res, next };
  }

  function expectNoSend() {
    expect(mockGhlPut).not.toHaveBeenCalled();
    expect(mockGhlPost).not.toHaveBeenCalled();
    expect(mockFireTrigger).not.toHaveBeenCalled();
  }

  it('uses the exact GHL-only contact without upserting or overwriting identity', async () => {
    const { res } = await run({ email: 'tampered@example.com', firstName: 'Wrong', locationId: 'loc-2' });
    expect(mockGhlGet).toHaveBeenCalledWith('/contacts/ghl-only');
    expect(mockGhlPost).not.toHaveBeenCalledWith('/contacts/upsert', expect.anything());
    expect(mockGhlPut).toHaveBeenCalledWith('/contacts/ghl-only', { customField: expect.any(Object) });
    expect(mockFireTrigger).toHaveBeenCalledWith('loc-1', 'ss_send_enrollment_link', expect.objectContaining({
      contact_id: 'ghl-only', first_name: 'Alex', email: 'alex@example.com', send_welcome: false, enrollment_status: 'link_sent',
    }));
    expect(mockGhlPost).toHaveBeenCalledWith('/conversations/messages', expect.objectContaining({ contactId: 'ghl-only', type: 'Email' }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, contactId: 'ghl-only' }));
  });

  it('supports a phone-only contact and SMS', async () => {
    mockGhlGet.mockResolvedValue({ data: { contact: { ...contact, email: null } } });
    const { res } = await run({ sendVia: ['sms'] });
    expect(mockGhlPost).toHaveBeenCalledWith('/conversations/messages', expect.objectContaining({ type: 'SMS', contactId: contact.id }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it('escapes selected contact names in the email body', async () => {
    mockGhlGet.mockResolvedValue({ data: { contact: { ...contact, firstName: '<a href="https://example.com">Alex</a>' } } });
    await run();
    expect(mockGhlPost).toHaveBeenCalledWith('/conversations/messages', expect.objectContaining({
      html: expect.stringContaining('&lt;a href=&quot;https://example.com&quot;&gt;Alex&lt;/a&gt;'),
    }));
  });

  it.each([{ locationId: 'loc-2' }, { locationId: undefined }, { id: 'different-contact' }])('blocks an unverified or wrong-location contact: %j', async (overrides) => {
    mockGhlGet.mockResolvedValue({ data: { contact: { ...contact, ...overrides } } });
    expect((await run()).res.status).toHaveBeenCalledWith(404);
    expectNoSend();
  });

  it.each([403, 404])('handles a removed/inaccessible contact (%s) without creating a replacement', async (ghlStatus) => {
    mockGhlGet.mockRejectedValue({ ghlStatus });
    expect((await run()).res.status).toHaveBeenCalledWith(404);
    expectNoSend();
  });

  it('fails closed on a lookup timeout', async () => {
    const error = new Error('Timeout');
    mockGhlGet.mockRejectedValue(error);
    expect((await run()).next).toHaveBeenCalledWith(error);
    expectNoSend();
  });

  it('uses freshly retrieved channel details, never stale submitted addresses', async () => {
    mockGhlGet.mockResolvedValue({ data: { contact: { ...contact, email: null } } });
    expect((await run({ email: 'old@example.com' })).res.status).toHaveBeenCalledWith(400);
    expectNoSend();
  });

  it.each(['', '../other', null, ['ghl-only']])('rejects malformed selected contact %j', async (contactId) => {
    expect((await run({ contactId })).res.status).toHaveBeenCalledWith(400);
    expect(mockGhlGet).not.toHaveBeenCalled();
    expectNoSend();
  });

  it('rejects unknown delivery channels', async () => {
    expect((await run({ sendVia: ['fax'] })).res.status).toHaveBeenCalledWith(400);
    expectNoSend();
  });

  it('checks offer ownership before accessing the selected contact', async () => {
    mockFindById.mockResolvedValue(null);
    expect((await run()).res.status).toHaveBeenCalledWith(404);
    expect(mockFindById).toHaveBeenCalledWith('offer-1', 'loc-1');
    expect(mockGhlGet).not.toHaveBeenCalled();
    expectNoSend();
  });
});
