// ─── Mocks ──────────────────────────────────────────────────────

const mockFrom = jest.fn();
jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: mockFrom }),
}));

const mockFindById = jest.fn();
const mockGetById = jest.fn();
jest.mock('../../src/repositories/offer.repository', () => ({
  offerRepository: {
    findById: mockFindById,
    getById: mockGetById,
  },
}));

const mockFindByLocationId = jest.fn();
jest.mock('../../src/repositories/merchant.repository', () => ({
  merchantRepository: {
    findByLocationId: mockFindByLocationId,
  },
}));

jest.mock('../../src/clients/ghl.client', () => ({
  ghlApi: jest.fn(),
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

import { enrollmentService } from '../../src/services/enrollment.service';
import { createPublicActionToken } from '../../src/utils/public-action-token';

// ─── Supabase mock helpers ──────────────────────────────────────

function mockSupabaseChain(returnData: any, returnError: any = null) {
  const chain: any = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue({ data: returnData, error: returnError }),
    single: jest.fn().mockResolvedValue({ data: returnData, error: returnError }),
    then: jest.fn((resolve) => resolve({ data: returnData ? [returnData] : [], error: returnError })),
  };
  return chain;
}

// ─── Tests ──────────────────────────────────────────────────────

describe('Enrollment Funnel Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PUBLIC_ACTION_TOKEN_SECRET = 'test_public_action_secret';
  });

  // ─── captureDevice ──────────────────────────────────────────

  describe('captureDevice', () => {
    const validInput = {
      offerId: 'offer-123',
      email: 'client@example.com',
      ipAddress: '1.2.3.4',
      userAgent: 'Mozilla/5.0',
      deviceFingerprint: 'fp-hash',
      screenResolution: '1920x1080',
      timezone: 'America/New_York',
      browserLanguage: 'en-US',
    };

    it('should create a new enrollment with device evidence', async () => {
      mockFindById.mockResolvedValue({
        id: 'offer-123',
        location_id: 'loc-1',
        active: true,
      });

      // First query: check existing — none found
      const existingChain = mockSupabaseChain(null);
      // Second query: insert
      const insertChain = mockSupabaseChain({ id: 'enroll-new-1' });

      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        return callCount === 1 ? existingChain : insertChain;
      });

      const result = await enrollmentService.captureDevice(validInput);

      expect(result.success).toBe(true);
      expect(result.enrollmentId).toBe('enroll-new-1');
      expect(insertChain.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          location_id: 'loc-1',
          offer_id: 'offer-123',
          email: 'client@example.com',
          status: 'device_captured',
          device_evidence: expect.objectContaining({
            ipAddress: '1.2.3.4',
            userAgent: 'Mozilla/5.0',
            deviceFingerprint: 'fp-hash',
          }),
        }),
      );
    });

    it('should update existing device_captured record for same email+offerId', async () => {
      mockFindById.mockResolvedValue({
        id: 'offer-123',
        location_id: 'loc-1',
        active: true,
      });

      // Existing record found
      const existingChain = mockSupabaseChain({ id: 'enroll-existing' });
      // Update chain
      const updateChain = mockSupabaseChain(null);
      updateChain.eq.mockReturnValue({ data: null, error: null });

      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        return callCount === 1 ? existingChain : updateChain;
      });

      const result = await enrollmentService.captureDevice(validInput);

      expect(result.success).toBe(true);
      expect(result.enrollmentId).toBe('enroll-existing');
    });

    it('should throw for invalid offerId', async () => {
      mockFindById.mockResolvedValue(null);

      await expect(enrollmentService.captureDevice(validInput))
        .rejects.toThrow('Offer not found or inactive');
    });

    it('should throw for inactive offer', async () => {
      mockFindById.mockResolvedValue({ id: 'offer-123', active: false });

      await expect(enrollmentService.captureDevice(validInput))
        .rejects.toThrow('Offer not found or inactive');
    });
  });

  // ─── getPublicOffer ─────────────────────────────────────────

  describe('getPublicOffer', () => {
    it('should return offer details without internal IDs', async () => {
      mockFindById.mockResolvedValue({
        id: 'offer-456',
        location_id: 'loc-1',
        active: true,
        offer_name: 'Coaching Program',
        internal_name: 'CERT Coaching 2026-07',
        program_description: 'A great program',
        price: 5000,
        payment_type: 'installment',
        installment_amount: 500,
        installment_frequency: 'monthly',
        num_payments: 10,
        pif_price: 4500,
        pif_discount_enabled: true,
        delivery_method: '1-on-1 coaching',
        refund_window_text: '30-day guarantee',
        compiled_tc_html: '<p>Terms here</p>',
        ghl_product_id: 'secret-id',
        clause_slot_1_title: 'Refund Policy',
        clause_slot_1_text: 'You may request a refund within 30 days.',
        clause_slot_2_title: null,
        m1_name: 'Discovery',
        m1_delivers: 'Assessment report',
        m1_client_does: 'Complete intake',
        m2_name: null,
      });

      mockFindByLocationId.mockResolvedValue({
        business_name: 'Test Business',
        support_email: 'support@test.com',
      });

      const result = await enrollmentService.getPublicOffer('offer-456');

      expect(result).not.toBeNull();
      expect(result!.offerId).toBe('offer-456');
      expect(result!.programName).toBe('Coaching Program');
      expect(result!.price).toBe(5000);
      expect(result!.milestones).toHaveLength(1);
      expect(result!.milestones[0].name).toBe('Discovery');
      expect(result!.clauses).toHaveLength(1);
      expect(result!.clauses[0].title).toBe('Refund Policy');
      expect(result!.compiledTcHtml).toBe('<p>Terms here</p>');
      expect(result!.merchantName).toBe('Test Business');
      expect(result!.merchantSupportEmail).toBe('support@test.com');

      // Must NOT expose internal IDs
      expect((result as any).ghl_product_id).toBeUndefined();
      expect((result as any).internal_name).toBeUndefined();
      expect((result as any).merchant_id).toBeUndefined();
      expect((result as any).location_id).toBeUndefined();
    });

    it('returns semantic IDs for standard click-wrap clauses', async () => {
      mockFindById.mockResolvedValue({
        id: 'offer-clauses',
        location_id: 'loc-1',
        active: true,
        offer_name: 'Payment Choice Program',
        price: 100,
        payment_type: 'installment',
        clause_slot_1_title: 'Purchase Summary',
        clause_slot_1_text: 'I confirm that I am purchasing the program described for the total amount and payment terms shown above.',
        clause_slot_2_title: 'Installment Billing',
        clause_slot_2_text: 'I authorize the scheduled payments outlined above and understand that this payment plan represents the total program price divided into installments.',
      });
      mockFindByLocationId.mockResolvedValue({ business_name: 'Test Business' });

      const result = await enrollmentService.getPublicOffer('offer-clauses');

      expect(result?.clauses).toEqual([
        expect.objectContaining({ id: 'purchase_summary', title: 'Purchase Summary' }),
        expect.objectContaining({ id: 'installment_billing', title: 'Installment Billing' }),
      ]);
    });

    it('should return null for inactive offer', async () => {
      mockFindById.mockResolvedValue({ id: 'offer-456', active: false });

      const result = await enrollmentService.getPublicOffer('offer-456');
      expect(result).toBeNull();
    });

    it('should return null for non-existent offer', async () => {
      mockFindById.mockResolvedValue(null);

      const result = await enrollmentService.getPublicOffer('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('getPaidEnrollmentContext', () => {
    it('returns safe paid enrollment context for a valid paid enrollment token', async () => {
      const token = createPublicActionToken({
        action: 'paid_enrollment',
        locationId: 'loc-1',
        contactId: 'contact-1',
        enrollmentId: 'enroll-paid-1',
      });

      mockFindById.mockResolvedValue({
        id: 'offer-789',
        location_id: 'loc-1',
        active: true,
        offer_name: 'Paid First Program',
        payment_type: 'installment',
      });

      mockFrom.mockReturnValue(mockSupabaseChain({
        id: 'enroll-paid-1',
        location_id: 'loc-1',
        contact_id: 'contact-1',
        offer_id: 'offer-789',
        email: 'client@example.com',
        first_name: 'Client',
        last_name: 'One',
        status: 'paid_pending_enrollment',
        payment_amount: 100,
        payment_type: 'installment',
        processor_type: 'stripe',
        processor_subscription_id: 'sub_123',
        payments_made: 1,
        payments_total: 2,
      }));

      const result = await enrollmentService.getPaidEnrollmentContext({
        offerId: 'offer-789',
        paidEnrollmentToken: token,
      });

      expect(result).toEqual(expect.objectContaining({
        success: true,
        paidEnrollment: true,
        paymentAlreadyReceived: true,
        enrollmentId: 'enroll-paid-1',
        offerId: 'offer-789',
        offerName: 'Paid First Program',
        contactId: 'contact-1',
        firstName: 'Client',
        lastName: 'One',
        fullName: 'Client One',
        email: 'client@example.com',
        paymentAmount: 100,
        paymentType: 'installment',
        processorSubscriptionId: 'sub_123',
      }));
      expect((result as any).merchant_id).toBeUndefined();
      expect((result as any).processor_config).toBeUndefined();
    });

    it('rejects a paid enrollment token that does not match a paid-pending enrollment', async () => {
      const token = createPublicActionToken({
        action: 'paid_enrollment',
        locationId: 'loc-1',
        contactId: 'contact-1',
        enrollmentId: 'enroll-paid-1',
      });

      mockFrom.mockReturnValue(mockSupabaseChain(null));

      await expect(enrollmentService.getPaidEnrollmentContext({
        offerId: 'offer-789',
        paidEnrollmentToken: token,
      })).rejects.toThrow('Paid enrollment link is invalid or expired');
    });
  });

  // ─── captureFunnelConsent ───────────────────────────────────

  describe('captureFunnelConsent', () => {
    const validConsent = {
      offerId: 'offer-789',
      email: 'client@example.com',
      consentTimestamp: '2026-04-02T14:30:00.000Z',
      ipAddress: '1.2.3.4',
      userAgent: 'Mozilla/5.0',
      deviceFingerprint: 'fp-hash',
      screenResolution: '1920x1080',
      timezone: 'America/New_York',
      browserLanguage: 'en-US',
      tcVersionHash: 'abc123hash',
      digitalSignature: 'John Smith',
      clausesAccepted: ['clause_1', 'clause_2'],
      scrollDepth: 100,
      paymentChoice: 'pif',
    };

    it('should generate consent_token and update existing enrollment', async () => {
      mockFindById.mockResolvedValue({
        id: 'offer-789',
        location_id: 'loc-1',
        active: true,
        price: 100,
      });

      // Existing enrollment found
      const existingChain = mockSupabaseChain({ id: 'enroll-existing' });
      // Update chain
      const updateChain = mockSupabaseChain(null);
      updateChain.eq.mockReturnValue({ data: null, error: null });

      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        return callCount === 1 ? existingChain : updateChain;
      });

      const result = await enrollmentService.captureFunnelConsent(validConsent);

      expect(result.success).toBe(true);
      expect(result.consentToken).toBeDefined();
      expect(result.consentToken).toMatch(/^[0-9a-f-]{36}$/); // UUID format
      expect(result.enrollmentId).toBe('enroll-existing');

      // Verify update was called with forensic fields
      expect(updateChain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'consent_captured',
          consent_token: expect.any(String),
          consent_captured_at: '2026-04-02T14:30:00.000Z',
          consent_ip: '1.2.3.4',
          tc_version_hash: 'abc123hash',
          digital_signature: 'John Smith',
          clauses_accepted: ['clause_1', 'clause_2'],
          scroll_depth: 100,
          payment_type: 'pif',
        }),
      );
    });

    it('should create new enrollment if no prior device capture', async () => {
      mockFindById.mockResolvedValue({
        id: 'offer-789',
        location_id: 'loc-1',
        active: true,
        price: 100,
      });

      // No existing enrollment
      const existingChain = mockSupabaseChain(null);
      // Insert chain
      const insertChain = mockSupabaseChain({ id: 'enroll-new' });

      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        return callCount === 1 ? existingChain : insertChain;
      });

      const result = await enrollmentService.captureFunnelConsent(validConsent);

      expect(result.success).toBe(true);
      expect(result.consentToken).toBeDefined();
      expect(result.enrollmentId).toBe('enroll-new');
    });

    it('should store T&C version hash and scroll depth', async () => {
      mockFindById.mockResolvedValue({
        id: 'offer-789',
        location_id: 'loc-1',
        active: true,
        price: 100,
      });

      const existingChain = mockSupabaseChain({ id: 'enroll-1' });
      const updateChain = mockSupabaseChain(null);
      updateChain.eq.mockReturnValue({ data: null, error: null });

      let callCount = 0;
      mockFrom.mockImplementation(() => {
        callCount++;
        return callCount === 1 ? existingChain : updateChain;
      });

      const input = { ...validConsent, tcVersionHash: 'hash-v2', scrollDepth: 85 };
      await enrollmentService.captureFunnelConsent(input);

      expect(updateChain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          tc_version_hash: 'hash-v2',
          scroll_depth: 85,
        }),
      );
    });

    it('should throw for invalid offer', async () => {
      mockFindById.mockResolvedValue(null);

      await expect(enrollmentService.captureFunnelConsent(validConsent))
        .rejects.toThrow('Offer not found or inactive');
    });

    it('never searches paid-pending enrollments without a paid enrollment token', async () => {
      mockFindById.mockResolvedValue({
        id: 'offer-789',
        location_id: 'loc-1',
        active: true,
        price: 100,
        payment_type: 'pif',
      });
      const lookupChain = mockSupabaseChain(null);
      mockFrom.mockReturnValueOnce(lookupChain);

      await expect(enrollmentService.captureFunnelConsent({
        ...validConsent,
        paymentChoice: 'subscription',
      })).rejects.toThrow('Selected payment option is not available');

      expect(lookupChain.in).toHaveBeenCalledWith('status', ['device_captured', 'pending']);
    });
  });
});

// ─── Controller Tests ───────────────────────────────────────────

describe('Enrollment Funnel Controller', () => {
  // Import controller (uses mocked dependencies)
  const { enrollmentController } = require('../../src/controllers/enrollment.controller');

  function mockReq(body: any = {}, params: any = {}, query: any = {}): any {
    return {
      body,
      params,
      query,
      headers: { 'user-agent': 'TestAgent' },
      ip: '127.0.0.1',
    };
  }

  function mockRes(): any {
    const res: any = {};
    res.json = jest.fn().mockReturnValue(res);
    res.status = jest.fn().mockReturnValue(res);
    return res;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/enrollment/device-capture', () => {
    it('should return 400 for missing required fields', async () => {
      const req = mockReq({ offerId: 'abc' }); // missing email
      const res = mockRes();
      const next = jest.fn();

      await enrollmentController.deviceCapture(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.stringContaining('required') }),
      );
    });
  });

  describe('GET /api/enrollment/offer/:offerId/public', () => {
    it('should return 404 for non-existent offer', async () => {
      mockFindById.mockResolvedValue(null);

      const req = mockReq({}, { offerId: 'nonexistent' });
      const res = mockRes();
      const next = jest.fn();

      await enrollmentController.getPublicOffer(req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
    });
  });

  describe('POST /api/enrollment/consent', () => {
    it('should return 400 for missing digitalSignature', async () => {
      const req = mockReq({ offerId: 'abc', email: 'a@b.com' }); // missing signature
      const res = mockRes();
      const next = jest.fn();

      await enrollmentController.funnelConsent(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
    });
  });
});
