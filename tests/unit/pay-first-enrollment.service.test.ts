import { payFirstEnrollmentService } from '../../src/services/pay-first-enrollment.service';
import { getSupabase } from '../../src/clients/supabase.client';
import { offerRepository } from '../../src/repositories/offer.repository';
import { paymentEventRepository } from '../../src/repositories/paymentEvent.repository';
import { phase2EvidenceRepository } from '../../src/repositories/phase2Evidence.repository';
import { triggerService } from '../../src/services/trigger.service';
import { createProcessorClient, resolveProcessor } from '../../src/services/processor.factory';
import { merchantRepository } from '../../src/repositories/merchant.repository';
import { ghlApi } from '../../src/clients/ghl.client';
import { findSavedCardForProcessor, saveOrReusePaymentMethod } from '../../src/services/payment-methods.service';
import { dualPricingService } from '../../src/services/dual-pricing.service';
import { merchantService } from '../../src/services/merchant.service';

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

jest.mock('../../src/repositories/paymentEvent.repository', () => ({
  paymentEventRepository: {
    createOrReuseByTransaction: jest.fn(),
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

jest.mock('../../src/services/dual-pricing.service', () => ({
  dualPricingService: {
    quoteOffer: jest.fn(),
  },
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
const mockPaymentEventCreateOrReuse = paymentEventRepository.createOrReuseByTransaction as jest.Mock;
const mockEvidenceCreate = phase2EvidenceRepository.create as jest.Mock;
const mockFireTrigger = triggerService.fireTrigger as jest.Mock;
const mockCreateProcessorClient = createProcessorClient as jest.Mock;
const mockResolveProcessor = resolveProcessor as jest.Mock;
const mockGhlApi = ghlApi as jest.Mock;
const mockFindSavedCard = findSavedCardForProcessor as jest.Mock;
const mockSaveOrReusePaymentMethod = saveOrReusePaymentMethod as jest.Mock;
const mockQuoteOffer = dualPricingService.quoteOffer as jest.Mock;
const mockGetFullConfig = merchantService.getFullConfig as jest.Mock;

jest.mock('../../src/repositories/merchant.repository', () => ({
  merchantRepository: {
    getByLocationId: jest.fn(),
  },
}));

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
      price: 200,
      installment_amount: 100,
      installment_frequency: 'weekly',
      num_payments: 2,
    });
    (merchantRepository.getByLocationId as jest.Mock).mockResolvedValue({
      id: 'merch_1',
      business_name: 'ScaleSafe Merchant',
      support_email: 'support@example.com',
    });
    mockGhlApi.mockResolvedValue({
      put: jest.fn().mockResolvedValue({ data: {} }),
      post: jest.fn().mockResolvedValue({ data: {} }),
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
    const ghl = await mockGhlApi.mock.results[0].value;
    expect(ghl.put).toHaveBeenCalledWith(
      '/contacts/contact_1',
      expect.objectContaining({
        customField: expect.objectContaining({
          'contact.offer_program_name': 'ScaleSafe Beta',
          'contact.offer_name': 'ScaleSafe Beta',
          'contact.offer_support_email': 'support@example.com',
          'contact.ss_enrollment_status': 'enrolled',
        }),
      }),
    );
    expect(mockFireTrigger).toHaveBeenCalledWith(
      'loc_1',
      'enrollment_complete',
      expect.objectContaining({
        offer_name: 'ScaleSafe Beta',
        program_name: 'ScaleSafe Beta',
        send_receipt: false,
        send_welcome: true,
        payment_already_received: true,
        processor_subscription_id: 'sub_existing_123',
        support_email: 'support@example.com',
        business_name: 'ScaleSafe Merchant',
      }),
    );
  });

  it('marks recurring billing ok when paid enrollment finalization creates the processor subscription', async () => {
    const createSubscription = jest.fn().mockResolvedValue({ success: true, subscriptionId: 'sub_new_123' });
    mockCreateProcessorClient.mockReturnValue({ createSubscription });
    mockResolveProcessor.mockResolvedValue({ config: { processor_type: 'stripe' } });
    mockFindSavedCard.mockResolvedValue({
      stripe_payment_method_id: 'pm_123',
      stripe_customer_id: 'cus_123',
    });

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
      processor_subscription_id: null,
    };

    const enrollmentUpdates: any[] = [];
    const updateChain: any = {};
    updateChain.eq = jest.fn(() => updateChain);
    const enrollments = {
      select: jest.fn(() => ({
        eq: jest.fn(function eq(this: any) { return this; }),
        maybeSingle: jest.fn(async () => ({ data: enrollment, error: null })),
      })),
      update: jest.fn((payload: any) => {
        enrollmentUpdates.push(payload);
        return updateChain;
      }),
    };
    mockGetSupabase.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'enrollments') return enrollments;
        return queryResult({ data: null, error: null });
      }),
    });

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

    expect(result?.processorSubscriptionId).toBe('sub_new_123');
    expect(enrollmentUpdates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        processor_subscription_id: 'sub_new_123',
        billing_setup_status: 'ok',
        billing_setup_error: null,
      }),
    ]));
  });

  it('marks recurring billing failed when paid enrollment finalization cannot create the subscription', async () => {
    const createSubscription = jest.fn().mockResolvedValue({ success: false, errorMessage: 'processor rejected plan' });
    mockCreateProcessorClient.mockReturnValue({ createSubscription });
    mockResolveProcessor.mockResolvedValue({ config: { processor_type: 'stripe' } });
    mockFindSavedCard.mockResolvedValue({
      stripe_payment_method_id: 'pm_123',
      stripe_customer_id: 'cus_123',
    });

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
      processor_subscription_id: null,
    };

    const enrollmentUpdates: any[] = [];
    const updateChain: any = {};
    updateChain.eq = jest.fn(() => updateChain);
    const enrollments = {
      select: jest.fn(() => ({
        eq: jest.fn(function eq(this: any) { return this; }),
        maybeSingle: jest.fn(async () => ({ data: enrollment, error: null })),
      })),
      update: jest.fn((payload: any) => {
        enrollmentUpdates.push(payload);
        return updateChain;
      }),
    };
    mockGetSupabase.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'enrollments') return enrollments;
        return queryResult({ data: null, error: null });
      }),
    });

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

    expect(result?.billingSetupIssue).toEqual(expect.objectContaining({
      code: 'recurring_setup_failed_after_paid_enrollment',
      message: 'processor rejected plan',
    }));
    expect(enrollmentUpdates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        billing_setup_status: 'failed',
        billing_setup_error: 'processor rejected plan',
        next_billing_date: null,
      }),
    ]));
  });
});

describe('payFirstEnrollmentService.chargeCardAndCreatePaidEnrollment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (merchantRepository.getByLocationId as jest.Mock).mockResolvedValue({
      id: 'merch_1',
      location_id: 'loc_1',
    });
    mockGhlApi.mockResolvedValue({
      post: jest.fn().mockResolvedValue({ data: { contact: { id: 'contact_1' } } }),
      put: jest.fn().mockResolvedValue({ data: {} }),
    });
    mockGetFullConfig.mockResolvedValue({ enrollmentFunnelUrl: '' });
    mockFindOffer.mockResolvedValue({
      id: 'offer_1',
      active: true,
      offer_name: 'ScaleSafe Beta',
      payment_type: 'pif',
      price: 100,
      processor_override: 'stripe',
    });
    mockResolveProcessor.mockResolvedValue({
      config: { processor_type: 'stripe' },
    });
    mockCreateProcessorClient.mockReturnValue({
      charge: jest.fn(),
    });
    mockGetSupabase.mockReturnValue({
      from: jest.fn(() => queryResult({ data: { id: 'enr_1' }, error: null })),
    });
    mockPaymentEventCreateOrReuse.mockResolvedValue({ id: 'pe_1' });
    mockEvidenceCreate.mockResolvedValue({});
    mockSaveOrReusePaymentMethod.mockResolvedValue(undefined);
    mockFireTrigger.mockResolvedValue({ sent: 1, failed: 0 });
    mockQuoteOffer.mockResolvedValue({
      selectedAmountCents: 10000,
      selectedAmount: 100,
      cardAmountCents: 10000,
      achAmountCents: 10000,
      dualPricingEnabled: false,
    });
  });

  it('fires the paid enrollment link trigger after a successful card manual sale', async () => {
    mockCreateProcessorClient.mockReturnValue({
      charge: jest.fn().mockResolvedValue({
        success: true,
        status: 'succeeded',
        transactionId: 'pi_manual_1',
        vaultedCustomerId: 'cus_1',
        vaultedCardLastFour: '4242',
        vaultedCardBrand: 'visa',
        vaultedCardExpMonth: 4,
        vaultedCardExpYear: 2028,
      }),
    });

    const result = await payFirstEnrollmentService.chargeCardAndCreatePaidEnrollment({
      locationId: 'loc_1',
      offerId: 'offer_1',
      firstName: 'Client',
      lastName: 'One',
      email: 'client@example.com',
      amount: 100,
      paymentToken: 'tok_card',
      paymentType: 'pif',
      paymentMethod: 'card',
      sendEnrollment: true,
    } as any);

    expect(result.success).toBe(true);
    expect(result.enrollmentId).toBe('enr_1');
    expect(result.enrollmentLinkIssue).toBeUndefined();
    expect(mockFireTrigger).toHaveBeenCalledWith(
      'loc_1',
      'ss_send_enrollment_link',
      expect.objectContaining({
        contact_id: 'contact_1',
        enrollment_id: 'enr_1',
        offer_id: 'offer_1',
        enrollment_url: expect.stringContaining('paidEnrollmentToken='),
        payment_source: 'quick_manual_sale',
      }),
    );
    expect(mockFireTrigger).toHaveBeenCalledWith(
      'loc_1',
      'ss_payment_received',
      expect.objectContaining({
        contact_id: 'contact_1',
        enrollment_id: 'enr_1',
        transaction_id: 'pi_manual_1',
      }),
    );
  });

  it('returns a visible issue when the paid enrollment link trigger has no active subscription', async () => {
    mockCreateProcessorClient.mockReturnValue({
      charge: jest.fn().mockResolvedValue({
        success: true,
        status: 'succeeded',
        transactionId: 'pi_manual_2',
        vaultedCustomerId: 'cus_1',
        vaultedCardLastFour: '4242',
        vaultedCardBrand: 'visa',
        vaultedCardExpMonth: 4,
        vaultedCardExpYear: 2028,
      }),
    });
    mockFireTrigger.mockImplementation(async (_locationId, triggerKey) => (
      triggerKey === 'ss_send_enrollment_link'
        ? { sent: 0, failed: 0 }
        : { sent: 1, failed: 0 }
    ));

    const result = await payFirstEnrollmentService.chargeCardAndCreatePaidEnrollment({
      locationId: 'loc_1',
      offerId: 'offer_1',
      firstName: 'Client',
      lastName: 'One',
      email: 'client@example.com',
      amount: 100,
      paymentToken: 'tok_card',
      paymentType: 'pif',
      paymentMethod: 'card',
      sendEnrollment: true,
    } as any);

    expect(result.success).toBe(true);
    expect(result.enrollmentLinkIssue).toEqual(expect.objectContaining({
      code: 'enrollment_link_trigger_missing',
      step: 'send_enrollment_link',
    }));
    expect(result.recordingIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'enrollment_link_trigger_missing' }),
    ]));
  });

  it('resends an existing paid pending enrollment link without creating another payment', async () => {
    mockGetSupabase.mockReturnValue({
      from: jest.fn(() => queryResult({
        data: {
          id: 'enr_existing',
          location_id: 'loc_1',
          contact_id: 'contact_1',
          offer_id: 'offer_1',
          email: 'client@example.com',
          first_name: 'Client',
          last_name: 'One',
          status: 'paid_pending_enrollment',
          payment_amount: 100,
        },
        error: null,
      })),
    });
    mockFireTrigger.mockResolvedValue({ sent: 1, failed: 0 });

    const result = await payFirstEnrollmentService.resendPaidEnrollmentLink({
      locationId: 'loc_1',
      enrollmentId: 'enr_existing',
      sendVia: ['email'],
    });

    expect(result.success).toBe(true);
    expect(result.enrollmentUrl).toContain('paidEnrollmentToken=');
    expect(mockPaymentEventCreateOrReuse).not.toHaveBeenCalled();
    expect(mockFireTrigger).toHaveBeenCalledWith(
      'loc_1',
      'ss_send_enrollment_link',
      expect.objectContaining({
        contact_id: 'contact_1',
        enrollment_id: 'enr_existing',
        enrollment_url: expect.stringContaining('paidEnrollmentToken='),
        payment_source: 'resend_paid_enrollment_link',
      }),
    );
  });

  it('directs Stripe bank payments to the dedicated manual-sale ACH flow', async () => {
    await expect(payFirstEnrollmentService.chargeCardAndCreatePaidEnrollment({
      locationId: 'loc_1',
      offerId: 'offer_1',
      firstName: 'Client',
      lastName: 'One',
      email: 'client@example.com',
      amount: 100,
      paymentToken: 'tok_bank',
      paymentType: 'pif',
      paymentMethod: 'ach',
    } as any)).rejects.toThrow('Stripe bank transfer uses the secure bank-account manual-sale flow.');

    expect(mockCreateProcessorClient.mock.results[0].value.charge).not.toHaveBeenCalled();
  });

  it('does not resolve Whop offers to the default manual-sale card processor', async () => {
    mockFindOffer.mockResolvedValue({
      id: 'offer_whop',
      active: true,
      offer_name: 'Whop Offer',
      payment_type: 'pif',
      price: 100,
      checkout_type: 'whop',
    });

    await expect(payFirstEnrollmentService.getManualSaleConfig('loc_1', 'offer_whop'))
      .rejects.toThrow('Whop offers cannot be charged from Quick Manual Sale');

    await expect(payFirstEnrollmentService.chargeCardAndCreatePaidEnrollment({
      locationId: 'loc_1',
      offerId: 'offer_whop',
      firstName: 'Client',
      lastName: 'One',
      email: 'client@example.com',
      amount: 100,
      paymentToken: 'tok_card',
      paymentType: 'pif',
      paymentMethod: 'card',
    } as any)).rejects.toThrow('Whop offers cannot be charged from Quick Manual Sale');

    expect(mockCreateProcessorClient).not.toHaveBeenCalled();
  });
});
