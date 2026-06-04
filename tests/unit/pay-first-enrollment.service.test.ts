import { payFirstEnrollmentService } from '../../src/services/pay-first-enrollment.service';
import { getSupabase } from '../../src/clients/supabase.client';
import { offerRepository } from '../../src/repositories/offer.repository';
import { phase2EvidenceRepository } from '../../src/repositories/phase2Evidence.repository';
import { triggerService } from '../../src/services/trigger.service';
import { createProcessorClient } from '../../src/services/processor.factory';

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: jest.fn(),
}));

jest.mock('../../src/repositories/offer.repository', () => ({
  offerRepository: {
    findById: jest.fn(),
  },
}));

jest.mock('../../src/repositories/phase2Evidence.repository', () => ({
  phase2EvidenceRepository: {
    create: jest.fn(),
  },
}));

jest.mock('../../src/services/trigger.service', () => ({
  triggerService: {
    fireTrigger: jest.fn(),
  },
}));

jest.mock('../../src/services/processor.factory', () => ({
  resolveProcessor: jest.fn(),
  createProcessorClient: jest.fn(),
}));

jest.mock('../../src/services/payment-methods.service', () => ({
  findSavedCardForProcessor: jest.fn(),
  saveOrReusePaymentMethod: jest.fn(),
}));

jest.mock('../../src/clients/ghl.client', () => ({
  ghlApi: jest.fn(),
}));

jest.mock('../../src/services/merchant.service', () => ({
  merchantService: {
    getFullConfig: jest.fn(),
  },
}));

jest.mock('../../src/services/offer.service', () => ({
  offerService: {
    generateEnrollmentLink: jest.fn(() => 'https://dashboard.scalesafe.app/enrollment?offerId=offer_1'),
  },
}));

const mockGetSupabase = getSupabase as jest.Mock;
const mockFindOffer = offerRepository.findById as jest.Mock;
const mockEvidenceCreate = phase2EvidenceRepository.create as jest.Mock;
const mockFireTrigger = triggerService.fireTrigger as jest.Mock;
const mockCreateProcessorClient = createProcessorClient as jest.Mock;

function queryResult(result: any) {
  const chain: any = {
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    maybeSingle: jest.fn(async () => result),
    update: jest.fn(() => chain),
    insert: jest.fn(() => chain),
    single: jest.fn(async () => result),
  };
  return chain;
}

describe('payFirstEnrollmentService.finalizePaidPendingEnrollment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindOffer.mockResolvedValue({
      id: 'offer_1',
      offer_name: 'ScaleSafe Beta',
      payment_type: 'installment',
      installment_amount: 100,
      installment_frequency: 'weekly',
      num_payments: 2,
    });
    mockEvidenceCreate.mockResolvedValue({});
    mockFireTrigger.mockResolvedValue({});
  });

  it('does not create a second processor subscription when manual sale already saved one', async () => {
    const createSubscription = jest.fn();
    mockCreateProcessorClient.mockReturnValue({ createSubscription });

    const enrollment = {
      id: 'enr_1',
      location_id: 'loc_1',
      merchant_id: 'merch_1',
      contact_id: 'contact_1',
      offer_id: 'offer_1',
      email: 'client@example.com',
      first_name: 'Client',
      last_name: 'One',
      status: 'paid_pending_enrollment',
      payment_amount: 100,
      payment_type: 'installment',
      payments_made: 1,
      payments_total: 2,
      processor_type: 'stripe',
      processor_subscription_id: 'sub_existing_123',
    };

    const updateChain: any = {};
    updateChain.eq = jest.fn(() => updateChain);
    const enrollments = {
      select: jest.fn(() => ({
        eq: jest.fn(function eq(this: any) { return this; }),
        maybeSingle: jest.fn(async () => ({ data: enrollment, error: null })),
      })),
      update: jest.fn(() => updateChain),
    };
    const supabase = {
      from: jest.fn((table: string) => {
        if (table === 'enrollments') return enrollments;
        return queryResult({ data: null, error: null });
      }),
    };
    mockGetSupabase.mockReturnValue(supabase);

    const result = await payFirstEnrollmentService.finalizePaidPendingEnrollment({
      enrollmentId: 'enr_1',
      locationId: 'loc_1',
      consentTimestamp: '2026-06-04T12:00:00.000Z',
      ipAddress: '127.0.0.1',
      userAgent: 'jest',
      deviceFingerprint: 'fp_1',
      screenResolution: '1440x900',
      timezone: 'America/Chicago',
      browserLanguage: 'en-US',
      tcVersionHash: 'hash_1',
      digitalSignature: 'Client One',
      clausesAccepted: ['terms'],
      scrollDepth: 100,
    });

    expect(result?.success).toBe(true);
    expect(result?.processorSubscriptionId).toBe('sub_existing_123');
    expect(createSubscription).not.toHaveBeenCalled();
    expect(mockFireTrigger).toHaveBeenCalledWith(
      'loc_1',
      'enrollment_complete',
      expect.objectContaining({
        send_receipt: false,
        send_welcome: true,
        payment_already_received: true,
        processor_subscription_id: 'sub_existing_123',
      }),
    );
  });
});
