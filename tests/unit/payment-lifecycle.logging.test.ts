const mockLoggerInfo = jest.fn();

jest.mock('../../src/utils/logger', () => ({
  logger: {
    info: (...args: unknown[]) => mockLoggerInfo(...args),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: jest.fn(),
}));

jest.mock('../../src/clients/ghl.client', () => ({
  ghlApi: jest.fn(),
}));

jest.mock('../../src/services/processor.factory', () => ({
  resolveProcessor: jest.fn(),
  createProcessorClient: jest.fn(),
}));

jest.mock('../../src/services/trigger.service', () => ({
  triggerService: {
    fireTrigger: jest.fn(),
  },
}));

jest.mock('../../src/services/evidence.service', () => ({
  evidenceService: {
    logEvidence: jest.fn(),
  },
}));

jest.mock('../../src/repositories/merchant.repository', () => ({
  merchantRepository: {
    getByLocationId: jest.fn(),
  },
}));

jest.mock('../../src/services/payment-methods.service', () => ({
  collapseVisiblePaymentMethods: jest.fn(),
  archivePaymentMethod: jest.fn(),
}));

import { paymentLifecycleService } from '../../src/services/payment-lifecycle.service';

describe('payment lifecycle logging', () => {
  beforeEach(() => {
    mockLoggerInfo.mockClear();
  });

  it('does not log signed card update links or action tokens', async () => {
    const result = await paymentLifecycleService.sendCardUpdateRequest(
      'loc_1',
      'contact_1',
      { sendTrigger: false, enrollmentId: 'enr_1' },
    );

    expect(result.link).toContain('/payment-update?actionToken=');

    const logPayloads = mockLoggerInfo.mock.calls.map((call) => JSON.stringify(call));
    expect(logPayloads.join('\n')).not.toContain('actionToken=');
    expect(logPayloads.join('\n')).not.toContain(result.link);
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: 'contact_1', locationId: 'loc_1', linkGenerated: true }),
      'Card update request sent',
    );
  });
});
