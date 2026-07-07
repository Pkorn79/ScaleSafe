const mockSupabaseFrom = jest.fn();
const mockFireTrigger = jest.fn();
const mockGhlPut = jest.fn();
const mockFindMerchantByLocationId = jest.fn();

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: (...args: any[]) => mockSupabaseFrom(...args) }),
}));

jest.mock('../../src/services/trigger.service', () => ({
  triggerService: {
    fireTrigger: (...args: any[]) => mockFireTrigger(...args),
  },
}));

jest.mock('../../src/clients/ghl.client', () => ({
  ghlApi: jest.fn(async () => ({ put: mockGhlPut })),
}));

jest.mock('../../src/repositories/merchant.repository', () => ({
  merchantRepository: {
    findByLocationId: (...args: any[]) => mockFindMerchantByLocationId(...args),
  },
}));

import { submitMilestoneSignoff } from '../../src/controllers/payment-update.controller';
import { createPublicActionToken } from '../../src/utils/public-action-token';

type BuilderResponse = { data?: any; error?: any };

function makeBuilder(response: BuilderResponse, table = 'unknown') {
  const builder: any = {
    filters: [] as Array<{ column: string; value: any }>,
    payload: null as any,
    select: jest.fn(() => builder),
    order: jest.fn(() => builder),
    limit: jest.fn(() => builder),
    in: jest.fn(() => builder),
    eq: jest.fn((column: string, value: any) => {
      builder.filters.push({ column, value });
      return builder;
    }),
    maybeSingle: jest.fn(async () => response),
    single: jest.fn(async () => response),
    insert: jest.fn(async (payload: any) => {
      builder.payload = payload;
      return response;
    }),
    update: jest.fn(() => builder),
    then: (resolve: any, reject: any) => Promise.resolve(response).then(resolve, reject),
    table,
  };
  return builder;
}

function queueBuilders(builders: Record<string, any[]>) {
  mockSupabaseFrom.mockImplementation((table: string) => {
    const queue = builders[table] || [];
    const builder = queue.shift();
    if (!builder) throw new Error(`Unexpected Supabase table call: ${table}`);
    return builder;
  });
}

function mockResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

describe('submitMilestoneSignoff', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PUBLIC_ACTION_TOKEN_SECRET = 'unit-test-public-action-secret';
    mockFindMerchantByLocationId.mockResolvedValue({
      business_name: 'WholePay',
      support_email: 'support@scalesafe.test',
    });
  });

  afterEach(() => {
    delete process.env.PUBLIC_ACTION_TOKEN_SECRET;
  });

  it('uses the enrollment id from the milestone signoff token', async () => {
    const token = createPublicActionToken({
      action: 'milestone_signoff',
      locationId: 'loc_1',
      contactId: 'contact_1',
      enrollmentId: 'enr_exact',
      milestoneNumber: 2,
    });
    const enrollmentBuilder = makeBuilder({
      data: { id: 'enr_exact', offer_id: 'offer_1', current_milestone: 2 },
      error: null,
    }, 'enrollments');
    const offerBuilder = makeBuilder({
      data: {
        id: 'offer_1',
        offer_name: 'Beta Tester',
        m2_name: 'Delivery',
        m2_delivers: 'Delivered the training',
      },
      error: null,
    }, 'offers_mirror');
    const enrollmentInfoBuilder = makeBuilder({
      data: { first_name: 'Philip', last_name: 'Korniotes', email: 'client@example.com' },
      error: null,
    }, 'enrollments');
    const signoffBuilder = makeBuilder({ error: null }, 'evidence_signoffs');

    queueBuilders({
      enrollments: [enrollmentBuilder, enrollmentInfoBuilder],
      offers_mirror: [offerBuilder],
      evidence_signoffs: [signoffBuilder],
    });
    mockFireTrigger.mockResolvedValue({ sent: 1, failed: 0 });

    const req: any = {
      query: { actionToken: token },
      body: { signature: 'Philip Korniotes' },
      headers: { 'user-agent': 'Chrome', 'x-forwarded-for': '1.2.3.4' },
      socket: { remoteAddress: '5.6.7.8' },
    };
    const res: any = mockResponse();
    const next = jest.fn();

    await submitMilestoneSignoff(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(enrollmentBuilder.filters).toEqual(expect.arrayContaining([
      { column: 'id', value: 'enr_exact' },
      { column: 'location_id', value: 'loc_1' },
      { column: 'contact_id', value: 'contact_1' },
    ]));
    expect(signoffBuilder.payload).toEqual(expect.objectContaining({
      enrollment_id: 'enr_exact',
      milestone_number: 2,
      milestone_name: 'Delivery',
    }));
    expect(signoffBuilder.payload.raw_payload).toEqual(expect.objectContaining({
      enrollmentId: 'enr_exact',
    }));
    expect(mockFireTrigger).toHaveBeenCalledWith('loc_1', 'ss_milestone_signedoff', expect.objectContaining({
      enrollment_id: 'enr_exact',
      enrollmentId: 'enr_exact',
      offer_id: 'offer_1',
      offer_name: 'Beta Tester',
      program_name: 'Beta Tester',
      milestone_number: 2,
      milestoneNumber: 2,
      milestone_name: 'Delivery',
      support_email: 'support@scalesafe.test',
      business_name: 'WholePay',
    }));
    expect(mockGhlPut).toHaveBeenCalledWith('/contacts/contact_1', expect.objectContaining({
      customField: expect.objectContaining({
        'contact.offer_business_name': 'WholePay',
        'contact.offer_name': 'Beta Tester',
        'contact.offer_program_name': 'Beta Tester',
        'contact.offer_support_email': 'support@scalesafe.test',
        'contact.ss_current_milestone_name': 'Delivery',
      }),
    }));
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('rejects milestone signoff tokens that are not enrollment-specific', async () => {
    const token = createPublicActionToken({
      action: 'milestone_signoff',
      locationId: 'loc_1',
      contactId: 'contact_1',
      milestoneNumber: 2,
    });

    const req: any = {
      query: { actionToken: token },
      body: { signature: 'Philip Korniotes' },
      headers: { 'user-agent': 'Chrome' },
      socket: { remoteAddress: '5.6.7.8' },
    };
    const res: any = mockResponse();
    const next = jest.fn();

    await submitMilestoneSignoff(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockSupabaseFrom).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Enrollment-specific action token required',
    });
  });
});
