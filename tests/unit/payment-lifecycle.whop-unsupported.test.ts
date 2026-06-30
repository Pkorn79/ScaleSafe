const mockResolveProcessor = jest.fn();
const mockCreateProcessorClient = jest.fn();
const mockPauseWhop = jest.fn();
const mockResumeWhop = jest.fn();
const mockCancelWhop = jest.fn();
const mockSupabaseFrom = jest.fn();
const mockGhlPut = jest.fn();
const mockGhlPost = jest.fn();
const mockTriggerFire = jest.fn();
const mockLogEvidence = jest.fn();

jest.mock('../../src/services/processor.factory', () => ({
  resolveProcessor: (...args: any[]) => mockResolveProcessor(...args),
  createProcessorClient: (...args: any[]) => mockCreateProcessorClient(...args),
}));

jest.mock('../../src/services/whop.service', () => ({
  whopService: {
    pauseMembership: (...args: any[]) => mockPauseWhop(...args),
    resumeMembership: (...args: any[]) => mockResumeWhop(...args),
    cancelMembership: (...args: any[]) => mockCancelWhop(...args),
  },
}));

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: (...args: any[]) => mockSupabaseFrom(...args) }),
}));

jest.mock('../../src/clients/ghl.client', () => ({
  ghlApi: jest.fn(() => Promise.resolve({ put: mockGhlPut, post: mockGhlPost })),
}));

jest.mock('../../src/services/trigger.service', () => ({
  triggerService: { fireTrigger: (...args: any[]) => mockTriggerFire(...args) },
}));

jest.mock('../../src/services/evidence.service', () => ({
  evidenceService: { logEvidence: (...args: any[]) => mockLogEvidence(...args) },
}));

jest.mock('../../src/repositories/merchant.repository', () => ({
  merchantRepository: { getByLocationId: jest.fn() },
}));

jest.mock('../../src/services/payment-methods.service', () => ({
  collapseVisiblePaymentMethods: jest.fn(),
  archivePaymentMethod: jest.fn(),
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { paymentLifecycleService } from '../../src/services/payment-lifecycle.service';

const whopParams = {
  merchantId: 'merchant-1',
  locationId: 'loc-1',
  contactId: 'contact-1',
  offerId: 'offer-1',
  enrollmentId: 'enr-1',
  processorSubscriptionId: 'mem_123',
  processorType: 'whop' as any,
  reason: 'merchant action',
};

function builder(table: string) {
  const b: any = {};
  b.update = jest.fn(() => b);
  b.select = jest.fn(() => b);
  b.eq = jest.fn(() => b);
  b.neq = jest.fn(() => b);
  b.in = jest.fn(() => b);
  b.order = jest.fn(() => b);
  b.limit = jest.fn(() => b);
  b.maybeSingle = jest.fn(async () => {
    if (table === 'enrollments') {
      return {
        data: {
          id: 'enr-1',
          offer_id: 'offer-1',
          payments_made: 1,
          payments_total: 5,
          processor_type: 'whop',
          processor_subscription_id: 'mem_123',
          next_billing_date: '2026-07-01',
          enrolled_at: '2026-06-01T00:00:00Z',
          first_name: 'Client',
          last_name: 'Example',
          email: 'client@example.com',
        },
        error: null,
      };
    }
    if (table === 'offers_mirror') return { data: { offer_name: 'Whop Program', num_payments: 5 }, error: null };
    return { data: null, error: null };
  });
  b.single = b.maybeSingle;
  return b;
}

describe('paymentLifecycleService Whop lifecycle support', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPauseWhop.mockResolvedValue({ success: true });
    mockResumeWhop.mockResolvedValue({ success: true });
    mockCancelWhop.mockResolvedValue({ success: true });
    mockTriggerFire.mockResolvedValue(undefined);
    mockLogEvidence.mockResolvedValue(undefined);
    mockGhlPut.mockResolvedValue({});
    mockGhlPost.mockResolvedValue({});
    mockSupabaseFrom.mockImplementation((table: string) => builder(table));
  });

  it('pauses Whop membership through Whop without creating a generic processor client', async () => {
    await paymentLifecycleService.pauseSubscription(whopParams);

    expect(mockPauseWhop).toHaveBeenCalledWith('loc-1', 'mem_123');
    expect(mockResolveProcessor).not.toHaveBeenCalled();
    expect(mockCreateProcessorClient).not.toHaveBeenCalled();
    expect(mockLogEvidence).toHaveBeenCalled();
    expect(mockTriggerFire).toHaveBeenCalledWith('loc-1', 'ss_subscription_paused', expect.objectContaining({
      processor: 'whop',
      subscription_id: 'mem_123',
    }));
  });

  it('resumes Whop membership through Whop without creating a generic processor client', async () => {
    await paymentLifecycleService.resumeSubscription(whopParams);

    expect(mockResumeWhop).toHaveBeenCalledWith('loc-1', 'mem_123');
    expect(mockResolveProcessor).not.toHaveBeenCalled();
    expect(mockCreateProcessorClient).not.toHaveBeenCalled();
    expect(mockTriggerFire).toHaveBeenCalledWith('loc-1', 'ss_subscription_resumed', expect.objectContaining({
      processor: 'whop',
      subscription_id: 'mem_123',
    }));
  });

  it('cancels Whop membership through Whop without creating a generic processor client', async () => {
    await paymentLifecycleService.cancelSubscription(whopParams);

    expect(mockCancelWhop).toHaveBeenCalledWith('loc-1', 'mem_123');
    expect(mockResolveProcessor).not.toHaveBeenCalled();
    expect(mockCreateProcessorClient).not.toHaveBeenCalled();
    expect(mockTriggerFire).toHaveBeenCalledWith('loc-1', 'ss_cancellation_requested', expect.objectContaining({
      processor: 'whop',
      subscription_id: 'mem_123',
    }));
  });

  it('rejects Whop lifecycle action when the membership id is missing', async () => {
    await expect(paymentLifecycleService.pauseSubscription({
      ...whopParams,
      processorSubscriptionId: '',
    })).rejects.toThrow(/missing Whop membership ID/i);

    expect(mockPauseWhop).not.toHaveBeenCalled();
    expect(mockResolveProcessor).not.toHaveBeenCalled();
  });
});
