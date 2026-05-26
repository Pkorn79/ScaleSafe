const mockSupabaseFrom = jest.fn();
const mockFindMerchant = jest.fn();
const mockResolveProcessor = jest.fn();
const mockGhlApi = jest.fn();

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: (...args: any[]) => mockSupabaseFrom(...args) }),
}));

jest.mock('../../src/repositories/merchant.repository', () => ({
  merchantRepository: {
    findByLocationId: (...args: any[]) => mockFindMerchant(...args),
  },
}));

jest.mock('../../src/services/processor.factory', () => ({
  resolveProcessor: (...args: any[]) => mockResolveProcessor(...args),
  createProcessorClient: jest.fn(),
}));

jest.mock('../../src/clients/ghl.client', () => ({
  ghlApi: (...args: any[]) => mockGhlApi(...args),
}));

import { getPaymentUpdateConfig } from '../../src/controllers/payment-update.controller';
import { createPublicActionToken } from '../../src/utils/public-action-token';

function makeBuilder(response: { data?: any; error?: any }) {
  const builder: any = {
    filters: [] as Array<{ column: string; value: any }>,
    select: jest.fn(() => builder),
    eq: jest.fn((column: string, value: any) => {
      builder.filters.push({ column, value });
      return builder;
    }),
    in: jest.fn((column: string, value: any) => {
      builder.filters.push({ column, value });
      return builder;
    }),
    maybeSingle: jest.fn(async () => response),
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

describe('payment update exact enrollment tokens', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PUBLIC_ACTION_TOKEN_SECRET = 'unit-test-public-action-secret';
    mockFindMerchant.mockResolvedValue({ id: 'merchant_1', business_name: 'Merchant' });
    mockResolveProcessor.mockResolvedValue({
      config: {
        processor_type: 'nmi',
        nmi_tokenization_key: 'tok_123',
      },
    });
    mockGhlApi.mockResolvedValue({
      get: jest.fn().mockRejectedValue(new Error('GHL unavailable')),
    });
  });

  afterEach(() => {
    delete process.env.PUBLIC_ACTION_TOKEN_SECRET;
  });

  it('rejects payment update tokens that are not enrollment-specific', async () => {
    const token = createPublicActionToken({
      action: 'payment_update',
      locationId: 'loc_1',
      contactId: 'contact_1',
    });

    const req: any = { query: { actionToken: token }, body: {}, headers: {}, socket: {} };
    const res: any = mockResponse();
    const next = jest.fn();

    await getPaymentUpdateConfig(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockSupabaseFrom).not.toHaveBeenCalled();
    expect(mockResolveProcessor).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Enrollment-specific action token required',
      processorType: 'none',
    });
  });

  it('resolves the processor from the enrollment named in the token', async () => {
    const token = createPublicActionToken({
      action: 'payment_update',
      locationId: 'loc_1',
      contactId: 'contact_1',
      enrollmentId: 'enr_exact',
    });
    const enrollmentBuilder = makeBuilder({
      data: {
        id: 'enr_exact',
        offer_id: 'offer_1',
        processor_type: 'nmi',
        email: 'client@example.com',
        first_name: 'Philip',
        last_name: 'Korniotes',
      },
      error: null,
    });
    const offerBuilder = makeBuilder({
      data: {
        processor_override: 'nmi',
        nmi_processor_id: 'processor_1',
      },
      error: null,
    });

    queueBuilders({
      enrollments: [enrollmentBuilder],
      offers_mirror: [offerBuilder],
    });

    const req: any = { query: { actionToken: token }, body: {}, headers: {}, socket: {} };
    const res: any = mockResponse();
    const next = jest.fn();

    await getPaymentUpdateConfig(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(enrollmentBuilder.filters).toEqual(expect.arrayContaining([
      { column: 'id', value: 'enr_exact' },
      { column: 'location_id', value: 'loc_1' },
      { column: 'contact_id', value: 'contact_1' },
      { column: 'status', value: ['enrolled', 'active', 'paused', 'past_due', 'delinquent'] },
    ]));
    expect(mockResolveProcessor).toHaveBeenCalledWith('merchant_1', 'loc_1', {
      processor_override: 'nmi',
      nmi_processor_id: 'processor_1',
    });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      processorType: 'nmi',
      nmiTokenizationKey: 'tok_123',
      contactName: 'Philip Korniotes',
      contactEmail: 'client@example.com',
    }));
  });
});
