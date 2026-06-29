const mockResolveProcessor = jest.fn();
const mockCreateProcessorClient = jest.fn();

jest.mock('../../src/services/processor.factory', () => ({
  resolveProcessor: (...args: any[]) => mockResolveProcessor(...args),
  createProcessorClient: (...args: any[]) => mockCreateProcessorClient(...args),
}));

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: jest.fn(),
}));

jest.mock('../../src/clients/ghl.client', () => ({
  ghlApi: jest.fn(),
}));

jest.mock('../../src/services/trigger.service', () => ({
  triggerService: { fireTrigger: jest.fn() },
}));

jest.mock('../../src/services/evidence.service', () => ({
  evidenceService: { logEvidence: jest.fn() },
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

describe('paymentLifecycleService Whop lifecycle support', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    ['pause', () => paymentLifecycleService.pauseSubscription(whopParams), /cannot be paused from ScaleSafe yet/i],
    ['resume', () => paymentLifecycleService.resumeSubscription(whopParams), /cannot be resumed from ScaleSafe yet/i],
    ['cancel', () => paymentLifecycleService.cancelSubscription(whopParams), /cannot be cancelled from ScaleSafe yet/i],
  ])('rejects Whop %s before creating a generic processor client', async (_action, fn, message) => {
    await expect(fn()).rejects.toThrow(message);
    expect(mockResolveProcessor).not.toHaveBeenCalled();
    expect(mockCreateProcessorClient).not.toHaveBeenCalled();
  });
});
