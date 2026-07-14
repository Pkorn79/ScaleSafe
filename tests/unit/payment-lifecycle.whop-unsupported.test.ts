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
const mockMoneyBegin = jest.fn();
const mockMoneyMarkProviderStarted = jest.fn();
const mockMoneyMarkProviderAccepted = jest.fn();
const mockMoneyMarkRecorded = jest.fn();
const mockMoneyMarkUnknown = jest.fn();
const mockProcessorResume = jest.fn();
const mockEnrollmentUpdate = jest.fn();
let enrollmentNextBillingDate: string | null = '2026-07-01';

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

jest.mock('../../src/services/money-operation.service', () => ({
  moneyOperationService: {
    begin: (...args: any[]) => mockMoneyBegin(...args),
    markProviderStarted: (...args: any[]) => mockMoneyMarkProviderStarted(...args),
    markProviderAccepted: (...args: any[]) => mockMoneyMarkProviderAccepted(...args),
    markRecorded: (...args: any[]) => mockMoneyMarkRecorded(...args),
    markUnknown: (...args: any[]) => mockMoneyMarkUnknown(...args),
  },
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
  b.update = jest.fn((updates: Record<string, unknown>) => {
    if (table === 'enrollments') {
      mockEnrollmentUpdate(updates);
      if (Object.prototype.hasOwnProperty.call(updates, 'next_billing_date')) {
        enrollmentNextBillingDate = updates.next_billing_date as string | null;
      }
    }
    return b;
  });
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
          status: 'paused',
          processor_type: 'whop',
          processor_subscription_id: 'mem_123',
          next_billing_date: enrollmentNextBillingDate,
          enrolled_at: '2026-06-01T00:00:00Z',
          first_name: 'Client',
          last_name: 'Example',
          email: 'client@example.com',
        },
        error: null,
      };
    }
    if (table === 'offers_mirror') return {
      data: { offer_name: 'Whop Program', num_payments: 5, installment_amount: 2.2, installment_frequency: 'weekly' },
      error: null,
    };
    if (table === 'payment_methods') return {
      data: { id: 'pm-1', processor_type: 'nmi', nmi_customer_vault_id: 'vault-1' },
      error: null,
    };
    return { data: null, error: null };
  });
  b.single = b.maybeSingle;
  return b;
}

describe('paymentLifecycleService Whop lifecycle support', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    enrollmentNextBillingDate = '2026-07-01';
    mockPauseWhop.mockResolvedValue({ success: true, paymentCollectionPaused: true });
    mockResumeWhop.mockResolvedValue({
      success: true,
      paymentCollectionPaused: false,
      nextPaymentDate: '2026-07-21T00:00:00Z',
    });
    mockCancelWhop.mockResolvedValue({
      success: true,
      status: 'canceled',
      canceledAt: '2026-07-14T00:30:00Z',
    });
    mockTriggerFire.mockResolvedValue(undefined);
    mockLogEvidence.mockResolvedValue(undefined);
    mockGhlPut.mockResolvedValue({});
    mockGhlPost.mockResolvedValue({});
    mockSupabaseFrom.mockImplementation((table: string) => builder(table));
    mockMoneyBegin.mockResolvedValue({ action: 'execute', operation: { id: 'money-op-1' } });
    mockMoneyMarkProviderAccepted.mockResolvedValue(undefined);
    mockMoneyMarkRecorded.mockResolvedValue(undefined);
    mockMoneyMarkUnknown.mockResolvedValue(undefined);
    mockProcessorResume.mockResolvedValue({
      success: true,
      subscriptionId: 'sub-replacement',
      nextPaymentDate: '2026-07-08T00:00:00Z',
    });
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
    expect(mockGhlPut).toHaveBeenCalledWith('/contacts/contact-1', expect.objectContaining({
      customField: expect.objectContaining({
        'contact.ss_enrollment_status': 'paused',
        'contact.offer_name': 'Whop Program',
        'contact.offer_program_name': 'Whop Program',
        'contact.ss_payments_remaining': 4,
        'contact.ss_next_payment_date': '',
      }),
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
      next_billing_date: '2026-07-21',
    }));
    expect(mockEnrollmentUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'enrolled',
      next_billing_date: '2026-07-21',
    }));
    expect(mockGhlPut).toHaveBeenCalledWith('/contacts/contact-1', expect.objectContaining({
      customField: expect.objectContaining({
        'contact.ss_enrollment_status': 'enrolled',
        'contact.offer_name': 'Whop Program',
        'contact.offer_program_name': 'Whop Program',
        'contact.ss_payments_remaining': 4,
        'contact.ss_next_payment_date': 'Jul 21, 2026',
      }),
    }));
  });

  it('suppresses the pause workflow when exact enrollment fields cannot be synced', async () => {
    mockGhlPut.mockRejectedValueOnce(new Error('GHL unavailable'));

    await paymentLifecycleService.pauseSubscription(whopParams);

    expect(mockPauseWhop).toHaveBeenCalledWith('loc-1', 'mem_123');
    expect(mockLogEvidence).toHaveBeenCalled();
    expect(mockTriggerFire).not.toHaveBeenCalledWith('loc-1', 'ss_subscription_paused', expect.anything());
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
    expect(mockEnrollmentUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'cancelled',
      cancelled_at: '2026-07-14T00:30:00Z',
      next_billing_date: null,
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

  it('recovers an accepted NMI resume without creating a second subscription', async () => {
    mockResolveProcessor.mockResolvedValue({ config: { processor_type: 'nmi' } });
    mockCreateProcessorClient.mockReturnValue({ resumeSubscription: mockProcessorResume });
    mockMoneyBegin.mockResolvedValue({
      action: 'blocked',
      operation: {
        id: 'money-op-accepted',
        status: 'provider_accepted',
        response_payload: {
          subscriptionId: 'sub-already-created',
          nextPaymentDate: '2026-07-08T00:00:00Z',
        },
      },
    });

    await paymentLifecycleService.resumeSubscription({
      ...whopParams,
      processorType: 'nmi',
      processorSubscriptionId: 'sub-old',
    });

    expect(mockProcessorResume).not.toHaveBeenCalled();
    expect(mockMoneyMarkProviderAccepted).not.toHaveBeenCalled();
    expect(mockMoneyMarkRecorded).toHaveBeenCalledWith(expect.objectContaining({
      id: 'money-op-accepted',
      processorReference: 'sub-already-created',
    }));
  });
});
