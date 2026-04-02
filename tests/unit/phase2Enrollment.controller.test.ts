const mockCaptureConsent = jest.fn();
const mockListByLocation = jest.fn();
const mockGetDetails = jest.fn();

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({}),
}));

jest.mock('../../src/services/consent.service', () => ({
  consentService: {
    captureConsent: (...args: any[]) => mockCaptureConsent(...args),
  },
}));

jest.mock('../../src/repositories/enrollment.repository', () => ({
  enrollmentRepository: {
    listByLocation: (...args: any[]) => mockListByLocation(...args),
  },
}));

jest.mock('../../src/services/phase2Enrollment.service', () => ({
  phase2EnrollmentService: {
    getEnrollmentDetails: (...args: any[]) => mockGetDetails(...args),
  },
}));

import { phase2EnrollmentController } from '../../src/controllers/phase2Enrollment.controller';

function mockReq(overrides: Record<string, any> = {}) {
  return {
    body: {},
    query: {},
    params: {},
    headers: { 'user-agent': 'Mozilla/5.0 Chrome/120' },
    ip: '127.0.0.1',
    tenantContext: { locationId: 'loc_1', companyId: 'co_1', userId: 'u1', email: '', role: 'user' },
    ...overrides,
  } as any;
}

function mockRes() {
  const res = { json: jest.fn(), status: jest.fn().mockReturnThis() } as any;
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Phase 2 Enrollment Controller - captureConsent', () => {
  test('calls consent service and returns result', async () => {
    mockCaptureConsent.mockResolvedValue({ consentToken: 'tok_1', enrollmentId: 'enr_1' });
    const req = mockReq({
      body: { offerId: 'offer_1', contactId: 'contact_1', contactEmail: 'a@b.com', signatureText: 'John' },
    });
    const res = mockRes();
    const next = jest.fn();

    await phase2EnrollmentController.captureConsent(req, res, next);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      consentToken: 'tok_1',
      enrollmentId: 'enr_1',
    });
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects missing offerId', async () => {
    const req = mockReq({ body: { contactId: 'c1' } });
    const res = mockRes();
    const next = jest.fn();

    await phase2EnrollmentController.captureConsent(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0].statusCode).toBe(400);
  });

  test('rejects missing contactId', async () => {
    const req = mockReq({ body: { offerId: 'o1' } });
    const res = mockRes();
    const next = jest.fn();

    await phase2EnrollmentController.captureConsent(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0].statusCode).toBe(400);
  });
});

describe('Phase 2 Enrollment Controller - list', () => {
  test('returns paginated enrollments', async () => {
    mockListByLocation.mockResolvedValue({
      data: [{ id: 'enr_1' }],
      total: 1,
    });
    const req = mockReq({ query: { page: '1', limit: '20' } });
    const res = mockRes();
    const next = jest.fn();

    await phase2EnrollmentController.list(req, res, next);

    expect(mockListByLocation).toHaveBeenCalledWith('loc_1', { status: undefined, page: 1, limit: 20 });
    expect(res.json).toHaveBeenCalledWith({
      enrollments: [{ id: 'enr_1' }],
      total: 1,
      page: 1,
      limit: 20,
    });
  });

  test('filters by status', async () => {
    mockListByLocation.mockResolvedValue({ data: [], total: 0 });
    const req = mockReq({ query: { status: 'enrolled' } });
    const res = mockRes();
    const next = jest.fn();

    await phase2EnrollmentController.list(req, res, next);

    expect(mockListByLocation).toHaveBeenCalledWith('loc_1', expect.objectContaining({ status: 'enrolled' }));
  });

  test('rejects when no tenant context', async () => {
    const req = mockReq({ tenantContext: undefined });
    const res = mockRes();
    const next = jest.fn();

    await phase2EnrollmentController.list(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0].statusCode).toBe(400);
  });
});

describe('Phase 2 Enrollment Controller - detail', () => {
  test('returns enrollment with evidence', async () => {
    mockGetDetails.mockResolvedValue({
      enrollment: { id: 'enr_1' },
      evidence: [],
      paymentEvents: [],
    });
    const req = mockReq({ params: { id: 'enr_1' } });
    const res = mockRes();
    const next = jest.fn();

    await phase2EnrollmentController.detail(req, res, next);

    expect(mockGetDetails).toHaveBeenCalledWith('enr_1', 'loc_1');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ enrollment: { id: 'enr_1' } }));
  });
});
