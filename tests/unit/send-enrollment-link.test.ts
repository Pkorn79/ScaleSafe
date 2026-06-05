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

import { sendEnrollmentLink } from '../../src/controllers/send-link.controller';

function mockReq(body: any = {}): any {
  return { body, headers: {}, ip: '127.0.0.1' };
}

function mockRes(): any {
  const res: any = {};
  res.json = jest.fn().mockReturnValue(res);
  res.status = jest.fn().mockReturnValue(res);
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
