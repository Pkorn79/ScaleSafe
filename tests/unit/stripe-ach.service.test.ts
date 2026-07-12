const mockGetSupabase = jest.fn();
const mockFindOffer = jest.fn();
const mockResolveProcessor = jest.fn();
const mockCreateProcessorClient = jest.fn();
const mockQuoteOffer = jest.fn();

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => mockGetSupabase(),
}));

jest.mock('../../src/repositories/offer.repository', () => ({
  offerRepository: { findById: (...args: any[]) => mockFindOffer(...args) },
}));

jest.mock('../../src/services/processor.factory', () => ({
  resolveProcessor: (...args: any[]) => mockResolveProcessor(...args),
  createProcessorClient: (...args: any[]) => mockCreateProcessorClient(...args),
}));

jest.mock('../../src/services/dual-pricing.service', () => ({
  dualPricingService: { quoteOffer: (...args: any[]) => mockQuoteOffer(...args) },
}));

jest.mock('../../src/services/phase2Enrollment.service', () => ({
  phase2EnrollmentService: { completeEnrollment: jest.fn() },
}));

jest.mock('../../src/services/trigger.service', () => ({
  triggerService: { fireTrigger: jest.fn() },
}));

jest.mock('../../src/services/payment-methods.service', () => ({
  saveOrReusePaymentMethod: jest.fn(),
}));

jest.mock('../../src/services/merchant.service', () => ({
  merchantService: { getFullConfig: jest.fn() },
}));

jest.mock('../../src/services/offer.service', () => ({
  offerService: { generateEnrollmentLink: jest.fn() },
}));

jest.mock('../../src/clients/ghl.client', () => ({
  ghlApi: jest.fn(),
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../src/config', () => ({
  config: { appUrl: 'https://app.scalesafe.com' },
}));

import { setupRecurringAfterSettlement } from '../../src/services/stripe-ach.service';

describe('Stripe ACH recurring settlement setup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindOffer.mockResolvedValue({
      id: 'offer_1',
      offer_name: 'Recurring Offer',
      installment_frequency: 'monthly',
    });
    mockQuoteOffer.mockResolvedValue({ selectedAmountCents: 5000 });
    mockResolveProcessor.mockResolvedValue({ config: { processor_type: 'stripe' } });
  });

  it('creates one subscription for concurrent settlement handlers', async () => {
    const enrollment: any = {
      id: 'enr_1',
      contact_id: 'contact_1',
      payment_type: 'installment',
      payments_total: 3,
      processor_subscription_id: null,
      billing_setup_status: 'pending',
      next_billing_date: '2026-08-12',
    };
    const createSubscription = jest.fn().mockResolvedValue({
      success: true,
      subscriptionId: 'sub_stripe_once',
      status: 'active',
    });
    mockCreateProcessorClient.mockReturnValue({ createSubscription });

    const supabase: any = {
      from: jest.fn((table: string) => {
        let operation: 'select' | 'update' = 'select';
        let updatePayload: any = null;
        const execute = async () => {
          if (table !== 'enrollments') return { data: null, error: null };
          if (operation === 'update') {
            const isClaim = updatePayload.billing_setup_error === 'Recurring billing setup is in progress or requires reconciliation.';
            if (isClaim) {
              if (enrollment.billing_setup_status !== 'pending' || enrollment.processor_subscription_id) {
                return { data: null, error: null };
              }
              enrollment.billing_setup_status = 'needs_reconciliation';
              enrollment.billing_setup_error = updatePayload.billing_setup_error;
              return { data: { id: enrollment.id }, error: null };
            }
            Object.assign(enrollment, updatePayload);
            return { data: null, error: null };
          }
          return { data: { ...enrollment }, error: null };
        };
        const builder: any = {
          select: jest.fn(() => builder),
          update: jest.fn((payload: any) => {
            operation = 'update';
            updatePayload = payload;
            return builder;
          }),
          eq: jest.fn(() => builder),
          in: jest.fn(() => builder),
          is: jest.fn(() => builder),
          maybeSingle: jest.fn(() => execute()),
          then: (resolve: any, reject: any) => execute().then(resolve, reject),
        };
        return builder;
      }),
    };
    mockGetSupabase.mockReturnValue(supabase);

    const params = {
      merchant: { id: 'merchant_1', location_id: 'loc_1' },
      enrollment,
      offerId: 'offer_1',
      paymentType: 'installment',
      paymentIntent: {
        id: 'pi_ach_1',
        payment_method: { id: 'pm_bank_1' },
        customer: 'cus_1',
      },
    };
    const states = await Promise.all([
      setupRecurringAfterSettlement(params),
      setupRecurringAfterSettlement(params),
    ]);

    expect(createSubscription).toHaveBeenCalledTimes(1);
    expect(createSubscription).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: 'stripe-ach-recurring-enr_1-pi_ach_1',
    }));
    expect(enrollment.processor_subscription_id).toBe('sub_stripe_once');
    expect(enrollment.billing_setup_status).toBe('ok');
    expect(states).toEqual(expect.arrayContaining(['ready']));
  });
});
