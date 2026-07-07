const mockSupabaseFrom = jest.fn();
const mockGhlPut = jest.fn();
const mockFireTrigger = jest.fn();
const mockFindMerchantByLocationId = jest.fn();

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: (...args: any[]) => mockSupabaseFrom(...args) }),
}));

jest.mock('../../src/clients/ghl.client', () => ({
  ghlApi: jest.fn(async () => ({ put: mockGhlPut })),
}));

jest.mock('../../src/services/trigger.service', () => ({
  triggerService: {
    fireTrigger: (...args: any[]) => mockFireTrigger(...args),
  },
}));

jest.mock('../../src/repositories/merchant.repository', () => ({
  merchantRepository: {
    findByLocationId: (...args: any[]) => mockFindMerchantByLocationId(...args),
  },
}));

import { dashboardController } from '../../src/controllers/dashboard.controller';
import { verifyPublicActionToken } from '../../src/utils/public-action-token';

type BuilderResponse = { data?: any; error?: any };

function makeBuilder(response: BuilderResponse, order: string[] = [], table = 'unknown') {
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
      order.push(`${table}:insert`);
      return response;
    }),
    update: jest.fn((payload: any) => {
      builder.payload = payload;
      order.push(`${table}:update`);
      return builder;
    }),
    then: (resolve: any, reject: any) => Promise.resolve(response).then(resolve, reject),
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

describe('dashboardController.markMilestone', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PUBLIC_ACTION_TOKEN_SECRET = 'unit-test-public-action-secret';
    process.env.APP_URL = 'https://app.scalesafe.test';
    mockFindMerchantByLocationId.mockResolvedValue({
      business_name: 'WholePay',
      support_email: 'support@scalesafe.test',
      config: { enrollment_funnel_url: 'https://wholepay.co' },
    });
  });

  afterEach(() => {
    delete process.env.PUBLIC_ACTION_TOKEN_SECRET;
    delete process.env.APP_URL;
  });

  it('saves the milestone before evidence and still succeeds if evidence insert fails', async () => {
    const order: string[] = [];
    const validationBuilder = makeBuilder({
      data: {
        id: 'enr_1',
        location_id: 'loc_1',
        contact_id: 'contact_1',
        current_milestone: 0,
        offer_id: 'offer_1',
        email: 'client@example.com',
      },
      error: null,
    }, order, 'enrollments');
    const offerBuilder = makeBuilder({
      data: {
        id: 'offer_1',
        offer_name: 'Beta Tester',
        m1_name: 'Setup',
        m1_delivers: 'Configured the account',
        m1_client_does: 'Review the setup',
      },
      error: null,
    }, order, 'offers_mirror');
    const updateBuilder = makeBuilder({ error: null }, order, 'enrollments');
    const nameBuilder = makeBuilder({
      data: { first_name: 'Philip', last_name: 'Korniotes', digital_signature: 'Philip Korniotes' },
      error: null,
    }, order, 'enrollments');
    const evidenceBuilder = makeBuilder({ error: { message: 'insert failed' } }, order, 'evidence_milestones');

    queueBuilders({
      enrollments: [validationBuilder, updateBuilder, nameBuilder],
      offers_mirror: [offerBuilder],
      evidence_milestones: [evidenceBuilder],
    });
    mockFireTrigger.mockResolvedValue({ sent: 1, failed: 0 });

    const req: any = {
      params: {},
      tenantContext: { locationId: 'loc_1' },
      body: { contactId: 'contact_1', enrollmentId: 'enr_1', milestoneNumber: 1 },
    };
    const res: any = mockResponse();
    const next = jest.fn();

    await dashboardController.markMilestone(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(updateBuilder.payload).toEqual({ current_milestone: 1 });
    expect(order.indexOf('enrollments:update')).toBeLessThan(order.indexOf('evidence_milestones:insert'));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      currentMilestone: 1,
      evidenceStatus: 'failed',
      workflowResult: { status: 'sent', sent: 1, failed: 0 },
    }));
  });

  it('validates the exact enrollment and sends enrollment-specific workflow payload', async () => {
    const order: string[] = [];
    const validationBuilder = makeBuilder({
      data: {
        id: 'enr_2',
        location_id: 'loc_1',
        contact_id: 'contact_1',
        current_milestone: 1,
        offer_id: 'offer_1',
        email: 'client@example.com',
      },
      error: null,
    }, order, 'enrollments');
    const offerBuilder = makeBuilder({
      data: {
        id: 'offer_1',
        offer_name: 'Beta Tester',
        m2_name: 'Delivery',
        m2_delivers: 'Delivered the training',
      },
      error: null,
    }, order, 'offers_mirror');
    const updateBuilder = makeBuilder({ error: null }, order, 'enrollments');
    const nameBuilder = makeBuilder({ data: { digital_signature: 'Client Name' }, error: null }, order, 'enrollments');
    const evidenceBuilder = makeBuilder({ error: null }, order, 'evidence_milestones');

    queueBuilders({
      enrollments: [validationBuilder, updateBuilder, nameBuilder],
      offers_mirror: [offerBuilder],
      evidence_milestones: [evidenceBuilder],
    });
    mockFireTrigger.mockResolvedValue({ sent: 1, failed: 0 });

    const req: any = {
      params: {},
      tenantContext: { locationId: 'loc_1' },
      body: { contactId: 'contact_1', enrollmentId: 'enr_2', milestoneNumber: 2 },
    };
    const res: any = mockResponse();
    const next = jest.fn();

    await dashboardController.markMilestone(req, res, next);

    expect(validationBuilder.filters).toEqual(expect.arrayContaining([
      { column: 'id', value: 'enr_2' },
      { column: 'location_id', value: 'loc_1' },
      { column: 'contact_id', value: 'contact_1' },
    ]));
    expect(mockFireTrigger).toHaveBeenCalledWith('loc_1', 'ss_milestone_reached', expect.objectContaining({
      enrollment_id: 'enr_2',
      enrollmentId: 'enr_2',
      milestone_number: 2,
      milestoneNumber: 2,
      milestone_name: 'Delivery',
      milestoneName: 'Delivery',
    }));
    const payload = mockFireTrigger.mock.calls[0][2];
    const url = new URL(payload.signoff_link);
    expect(url.origin).toBe('https://wholepay.co');
    expect(url.pathname).toBe('/milestone-approval-page');
    const token = url.searchParams.get('actionToken') || '';
    expect(verifyPublicActionToken(token, 'milestone_signoff')).toMatchObject({
      contactId: 'contact_1',
      locationId: 'loc_1',
      enrollmentId: 'enr_2',
      milestoneNumber: 2,
    });
    expect(mockGhlPut).toHaveBeenCalledWith('/contacts/contact_1', expect.objectContaining({
      customField: expect.objectContaining({
        'contact.sign_off_link': expect.stringContaining('https://wholepay.co/milestone-approval-page?actionToken='),
        'contact.offer_business_name': 'WholePay',
        'contact.offer_name': 'Beta Tester',
        'contact.offer_program_name': 'Beta Tester',
        'contact.offer_support_email': 'support@scalesafe.test',
        'contact.ss_current_milestone_name': 'Delivery',
      }),
    }));
  });
});
