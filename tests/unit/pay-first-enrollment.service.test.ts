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
import { checkoutCartService } from '../../src/services/checkout-cart.service';
import { whopService } from '../../src/services/whop.service';
import { moneyOperationService } from '../../src/services/money-operation.service';
import { enrollmentPacketService } from '../../src/services/enrollment-packet.service';
import { evidenceChainService } from '../../src/services/evidence-chain.service';

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
    findByType: jest.fn(),
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

jest.mock('../../src/services/checkout-cart.service', () => ({
  checkoutCartService: {
    quoteOffer: jest.fn(),
  },
}));

jest.mock('../../src/services/whop.service', () => ({
  whopService: {
    createCheckoutSession: jest.fn(),
  },
}));

jest.mock('../../src/services/money-operation.service', () => ({
  moneyOperationService: {
    begin: jest.fn(),
    markProviderStarted: jest.fn(),
    markProviderAccepted: jest.fn(),
    markRecorded: jest.fn(),
    markUnknown: jest.fn(),
  },
}));

jest.mock('../../src/services/enrollment-packet.service', () => ({
  enrollmentPacketService: {
    generateAndStore: jest.fn(),
  },
}));

jest.mock('../../src/services/evidence-chain.service', () => ({
  evidenceChainService: {
    verifyChain: jest.fn(),
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
const mockEvidenceFindByType = phase2EvidenceRepository.findByType as jest.Mock;
const mockFireTrigger = triggerService.fireTrigger as jest.Mock;
const mockCreateProcessorClient = createProcessorClient as jest.Mock;
const mockResolveProcessor = resolveProcessor as jest.Mock;
const mockCheckoutCartQuoteOffer = checkoutCartService.quoteOffer as jest.Mock;
const mockWhopCreateCheckoutSession = whopService.createCheckoutSession as jest.Mock;
const mockGhlApi = ghlApi as jest.Mock;
const mockFindSavedCard = findSavedCardForProcessor as jest.Mock;
const mockSaveOrReusePaymentMethod = saveOrReusePaymentMethod as jest.Mock;
const mockQuoteOffer = dualPricingService.quoteOffer as jest.Mock;
const mockGetFullConfig = merchantService.getFullConfig as jest.Mock;
const mockMoneyBegin = moneyOperationService.begin as jest.Mock;
const mockMoneyMarkProviderAccepted = moneyOperationService.markProviderAccepted as jest.Mock;
const mockMoneyMarkRecorded = moneyOperationService.markRecorded as jest.Mock;
const mockMoneyMarkUnknown = moneyOperationService.markUnknown as jest.Mock;
const mockGenerateEnrollmentPacket = enrollmentPacketService.generateAndStore as jest.Mock;
const mockVerifyEvidenceChain = evidenceChainService.verifyChain as jest.Mock;

jest.mock('../../src/repositories/merchant.repository', () => ({
  merchantRepository: {
    getByLocationId: jest.fn(),
  },
}));

function queryResult(result: any) {
  const chain: any = {
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    order: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    maybeSingle: jest.fn(async () => result),
    update: jest.fn(() => chain),
    insert: jest.fn(() => chain),
    single: jest.fn(async () => result),
  };
  return chain;
}

async function flushBackgroundTasks() {
  await new Promise((resolve) => setImmediate(resolve));
  await Promise.resolve();
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
      refund_window_text: 'Full refund within 14 days.',
      tc_url: 'https://merchant.example/terms/scale-safe-beta',
    });
    (merchantRepository.getByLocationId as jest.Mock).mockResolvedValue({
      id: 'merch_1',
      business_name: 'ScaleSafe Merchant',
      support_email: 'support@example.com',
      config: { tc_document_url: 'https://merchant.example/default-terms' },
    });
    mockGhlApi.mockResolvedValue({
      put: jest.fn().mockResolvedValue({ data: {} }),
      post: jest.fn().mockResolvedValue({ data: {} }),
    });
    mockEvidenceCreate.mockResolvedValue({});
    mockEvidenceFindByType.mockResolvedValue([]);
    mockFireTrigger.mockResolvedValue({});
    mockGenerateEnrollmentPacket.mockResolvedValue('signed-packet-url');
    mockVerifyEvidenceChain.mockResolvedValue({ chainStrength: 100, complete: true, gaps: [] });
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
        if (table === 'payment_events') return queryResult({ data: { id: 'pe_1' }, error: null });
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
    await flushBackgroundTasks();
    const ghl = await mockGhlApi.mock.results[0].value;
    expect(ghl.put).toHaveBeenCalledWith(
      '/contacts/contact_1',
      expect.objectContaining({
        customField: expect.objectContaining({
          'contact.offer_program_name': 'ScaleSafe Beta',
          'contact.offer_name': 'ScaleSafe Beta',
          'contact.offer_support_email': 'support@example.com',
          'contact.offer_refund_policy': 'Full refund within 14 days.',
          'contact.offer_tc_document_url': 'https://merchant.example/terms/scale-safe-beta',
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
    expect(mockGenerateEnrollmentPacket).toHaveBeenCalledWith('enr_1', 'loc_1');
    expect(mockVerifyEvidenceChain).toHaveBeenCalledWith('pe_1', 'loc_1');
  });

  it('marks recurring billing failed when paid pending recurring enrollment has no processor subscription', async () => {
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

    expect(result?.processorSubscriptionId).toBeNull();
    expect(result?.billingSetupIssue).toEqual(expect.objectContaining({
      code: 'recurring_setup_missing_after_paid_enrollment',
      message: 'Payment was received, but recurring billing was not linked to a processor subscription.',
    }));
    expect(enrollmentUpdates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        billing_setup_status: 'failed',
        billing_setup_error: 'Payment was received, but recurring billing was not linked to a processor subscription.',
        next_billing_date: null,
      }),
    ]));
    expect(createSubscription).not.toHaveBeenCalled();
  });

  it('initializes pulse cadence after paid pending enrollment finalization when the offer has pulse enabled', async () => {
    mockFindOffer.mockResolvedValue({
      id: 'offer_1',
      offer_name: 'ScaleSafe Beta',
      payment_type: 'pif',
      price: 200,
      pulse_cadence_enabled: true,
      pulse_frequency_days: 14,
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
      payment_amount: 200,
      payment_type: 'pif',
      payments_made: 1,
      payments_total: 1,
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

    expect(result?.success).toBe(true);
    await flushBackgroundTasks();
    expect(enrollmentUpdates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        pulse_cadence_enabled: true,
        pulse_frequency_days: 14,
        next_pulse_due_at: expect.any(String),
        last_pulse_sent_at: null,
      }),
    ]));
  });
});

describe('payFirstEnrollmentService.getWhopManualSaleStatus', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('confirms only a tenant-scoped Whop enrollment finalized by the webhook', async () => {
    const enrollmentQuery = queryResult({
      data: {
        id: 'enr_whop_qms',
        contact_id: 'contact_1',
        offer_id: 'offer_1',
        status: 'paid_pending_enrollment',
        initial_payment_status: 'succeeded',
        billing_setup_status: 'ok',
        billing_setup_error: null,
        payment_transaction_id: 'pay_123',
        whop_checkout_session_id: 'ch_123',
      },
      error: null,
    });
    mockGetSupabase.mockReturnValue({ from: jest.fn(() => enrollmentQuery) });

    const result = await payFirstEnrollmentService.getWhopManualSaleStatus('loc_1', 'enr_whop_qms');

    expect(enrollmentQuery.eq).toHaveBeenCalledWith('id', 'enr_whop_qms');
    expect(enrollmentQuery.eq).toHaveBeenCalledWith('location_id', 'loc_1');
    expect(enrollmentQuery.eq).toHaveBeenCalledWith('checkout_type', 'whop');
    expect(result).toEqual(expect.objectContaining({
      confirmed: true,
      failed: false,
      enrollmentId: 'enr_whop_qms',
      transactionId: 'pay_123',
    }));
  });

  it('reports a processor failure without presenting the checkout as confirmed', async () => {
    const enrollmentQuery = queryResult({
      data: {
        id: 'enr_failed',
        contact_id: 'contact_1',
        offer_id: 'offer_1',
        status: 'payment_processing',
        initial_payment_status: 'failed',
        billing_setup_status: 'failed',
        billing_setup_error: 'Whop checkout failed',
        payment_transaction_id: null,
        whop_checkout_session_id: 'ch_failed',
      },
      error: null,
    });
    mockGetSupabase.mockReturnValue({ from: jest.fn(() => enrollmentQuery) });

    const result = await payFirstEnrollmentService.getWhopManualSaleStatus('loc_1', 'enr_failed');

    expect(result).toEqual(expect.objectContaining({
      confirmed: false,
      failed: true,
      error: 'Whop checkout failed',
      transactionId: null,
    }));
  });

  it('fails closed when no Whop enrollment exists inside the trusted tenant', async () => {
    const enrollmentQuery = queryResult({ data: null, error: null });
    mockGetSupabase.mockReturnValue({ from: jest.fn(() => enrollmentQuery) });

    await expect(
      payFirstEnrollmentService.getWhopManualSaleStatus('loc_other', 'enr_whop_qms'),
    ).rejects.toThrow('Whop manual-sale enrollment not found');
    expect(enrollmentQuery.eq).toHaveBeenCalledWith('location_id', 'loc_other');
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
    mockMoneyBegin.mockResolvedValue({ action: 'execute', operation: { id: 'money-op-1' } });
    mockMoneyMarkProviderAccepted.mockResolvedValue(undefined);
    mockMoneyMarkRecorded.mockResolvedValue(undefined);
    mockMoneyMarkUnknown.mockResolvedValue(undefined);
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
      paymentAttemptId: 'attempt_test_manual_1',
      paymentType: 'pif',
      paymentMethod: 'card',
      sendEnrollment: true,
    } as any);

    expect(result.success).toBe(true);
    expect(result.enrollmentId).toBe('enr_1');
    expect(result.enrollmentLinkIssue).toBeUndefined();
    expect(mockMoneyBegin).toHaveBeenCalledWith(expect.objectContaining({
      operationType: 'manual_sale_charge',
      request: expect.objectContaining({ paymentAttemptId: 'attempt_test_manual_1' }),
    }));
    expect(mockFireTrigger).toHaveBeenCalledWith(
      'loc_1',
      'ss_send_enrollment_link',
      expect.objectContaining({
        contact_id: 'contact_1',
        enrollment_id: 'enr_1',
        offer_id: 'offer_1',
        enrollment_url: expect.stringContaining('paidEnrollmentToken='),
        enrollmentUrl: expect.stringContaining('email=client%40example.com'),
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

  it('records an explicit decline so the browser can rotate only that attempt id', async () => {
    mockCreateProcessorClient.mockReturnValue({
      charge: jest.fn().mockResolvedValue({
        success: false,
        status: 'declined',
        transactionId: '',
        errorMessage: 'Card was declined',
      }),
    });

    await expect(payFirstEnrollmentService.chargeCardAndCreatePaidEnrollment({
      locationId: 'loc_1', offerId: 'offer_1', firstName: 'Client', lastName: 'One',
      email: 'client@example.com', amount: 100, paymentToken: 'tok_declined',
      paymentAttemptId: 'attempt_declined_manual_1', paymentType: 'pif', paymentMethod: 'card',
    } as any)).rejects.toThrow('Card was declined');

    expect(mockMoneyMarkRecorded).toHaveBeenCalledWith(expect.objectContaining({
      response: {
        success: false,
        error: 'Card was declined',
        paymentAttemptStatus: 'declined',
      },
    }));
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
      paymentAttemptId: 'attempt_test_manual_2',
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

  it('keeps a processor-approved manual sale in reconciliation when ledger recording fails', async () => {
    mockCreateProcessorClient.mockReturnValue({
      charge: jest.fn().mockResolvedValue({
        success: true,
        status: 'succeeded',
        transactionId: 'pi_needs_reconciliation',
        vaultedCustomerId: 'cus_1',
        vaultedCardLastFour: '4242',
        vaultedCardBrand: 'visa',
      }),
    });
    mockPaymentEventCreateOrReuse.mockRejectedValueOnce(new Error('ledger unavailable'));

    const result = await payFirstEnrollmentService.chargeCardAndCreatePaidEnrollment({
      locationId: 'loc_1', offerId: 'offer_1', firstName: 'Client', lastName: 'One',
      email: 'client@example.com', amount: 100, paymentToken: 'tok_card',
      paymentAttemptId: 'attempt_test_reconcile_1', paymentType: 'pif', paymentMethod: 'card',
    } as any);

    expect(result.recordingIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'payment_event_recording_failed' }),
    ]));
    expect(mockMoneyMarkRecorded).not.toHaveBeenCalled();
    expect(mockMoneyMarkProviderAccepted).toHaveBeenLastCalledWith(expect.objectContaining({
      processorReference: 'pi_needs_reconciliation',
      response: expect.objectContaining({ success: true }),
    }));
  });

  it('does not record the parent charge when a created subscription id cannot be saved', async () => {
    mockFindOffer.mockResolvedValue({
      id: 'offer_1',
      active: true,
      offer_name: 'Recurring Offer',
      payment_type: 'installment',
      price: 100,
      installment_amount: 100,
      installment_frequency: 'monthly',
      num_payments: 3,
      processor_override: 'stripe',
    });
    const createSubscription = jest.fn().mockResolvedValue({
      success: true,
      subscriptionId: 'sub_created_not_saved',
      status: 'active',
    });
    mockCreateProcessorClient.mockReturnValue({
      charge: jest.fn().mockResolvedValue({
        success: true,
        status: 'succeeded',
        transactionId: 'pi_subscription_save_failure',
        vaultedCustomerId: 'cus_1',
        vaultedCardLastFour: '4242',
        vaultedCardBrand: 'visa',
      }),
      createSubscription,
    });

    const enrollmentUpdates: any[] = [];
    mockGetSupabase.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table !== 'enrollments') return queryResult({ data: null, error: null });
        let result = { data: null as any, error: null as any };
        const builder: any = {
          insert: jest.fn(() => {
            result = { data: { id: 'enr_recurring_1' }, error: null };
            return builder;
          }),
          update: jest.fn((payload: any) => {
            enrollmentUpdates.push(payload);
            result = payload.processor_subscription_id
              ? { data: null, error: { message: 'subscription mapping unavailable' } }
              : { data: null, error: null };
            return builder;
          }),
          select: jest.fn(() => builder),
          eq: jest.fn(() => builder),
          single: jest.fn(async () => result),
          maybeSingle: jest.fn(async () => result),
          then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
        };
        return builder;
      }),
    });

    const result = await payFirstEnrollmentService.chargeCardAndCreatePaidEnrollment({
      locationId: 'loc_1', offerId: 'offer_1', firstName: 'Client', lastName: 'One',
      email: 'client@example.com', amount: 100, paymentToken: 'tok_card',
      paymentAttemptId: 'attempt_subscription_save_1', paymentType: 'installment', paymentMethod: 'card',
    } as any);

    expect(result.billingIssue).toEqual(expect.objectContaining({
      code: 'processor_subscription_save_failed',
    }));
    expect(enrollmentUpdates).toEqual(expect.arrayContaining([
      expect.objectContaining({ billing_setup_status: 'needs_reconciliation' }),
    ]));
    expect(mockMoneyMarkRecorded).not.toHaveBeenCalled();
    expect(mockMoneyMarkProviderAccepted).toHaveBeenLastCalledWith(expect.objectContaining({
      processorReference: 'pi_subscription_save_failure',
      reconciliationPayload: expect.objectContaining({
        processorSubscriptionId: 'sub_created_not_saved',
      }),
    }));
  });

  it('replays a completed manual sale without charging the processor again', async () => {
    const charge = jest.fn();
    mockCreateProcessorClient.mockReturnValue({ charge });
    mockMoneyBegin.mockResolvedValue({
      action: 'replay',
      operation: { id: 'money-op-recorded', status: 'recorded' },
      response: {
        success: true,
        contactId: 'contact_1',
        enrollmentId: 'enr_1',
        transactionId: 'pi_manual_replayed',
        processorType: 'stripe',
      },
    });

    const result = await payFirstEnrollmentService.chargeCardAndCreatePaidEnrollment({
      locationId: 'loc_1',
      offerId: 'offer_1',
      firstName: 'Client',
      lastName: 'One',
      email: 'client@example.com',
      amount: 100,
      paymentToken: 'tok_card',
      paymentAttemptId: 'attempt_test_manual_3',
      paymentType: 'pif',
      paymentMethod: 'card',
    } as any);

    expect(result.transactionId).toBe('pi_manual_replayed');
    expect(charge).not.toHaveBeenCalled();
  });

  it('replays a completed Stripe ACH intent without creating another intent or enrollment', async () => {
    const createAchPaymentIntent = jest.fn();
    mockCreateProcessorClient.mockReturnValue({ createAchPaymentIntent });
    mockMoneyBegin.mockResolvedValue({
      action: 'replay',
      operation: { id: 'money-op-ach', status: 'recorded' },
      response: {
        success: true,
        contactId: 'contact_1',
        enrollmentId: 'enr_1',
        paymentIntentId: 'pi_ach_existing',
        clientSecret: 'secret_existing',
      },
    });

    const result = await payFirstEnrollmentService.createStripeAchManualSaleIntent({
      locationId: 'loc_1',
      offerId: 'offer_1',
      firstName: 'Client',
      lastName: 'One',
      email: 'client@example.com',
      amount: 100,
      paymentAttemptId: 'attempt_test_ach_12345',
      paymentType: 'pif',
      paymentMethod: 'ach',
    });

    expect(result.paymentIntentId).toBe('pi_ach_existing');
    expect(createAchPaymentIntent).not.toHaveBeenCalled();
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
      paymentAttemptId: 'attempt_test_manual_4',
      paymentType: 'pif',
      paymentMethod: 'ach',
    } as any)).rejects.toThrow('Stripe bank transfer uses the secure bank-account manual-sale flow.');

    expect(mockCreateProcessorClient.mock.results[0].value.charge).not.toHaveBeenCalled();
  });

  it('creates a hosted Whop checkout session from Quick Manual Sale fields without using the card processor', async () => {
    mockFindOffer.mockResolvedValue({
      id: 'offer_whop',
      active: true,
      offer_name: 'Whop Offer',
      payment_type: 'pif',
      price: 100,
      checkout_type: 'whop',
      location_id: 'loc_1',
      whop_product_id: 'prod_123',
      whop_plan_id: 'plan_123',
    });
    mockCheckoutCartQuoteOffer.mockResolvedValue({
      selectedAmount: 100,
      selectedAmountCents: 10000,
      lineItems: [{ type: 'base_offer', label: 'Whop Offer', amount: 100 }],
    });
    mockWhopCreateCheckoutSession.mockResolvedValue({
      sessionId: 'ch_123',
      checkoutUrl: 'https://whop.com/checkout/ch_123',
      planId: 'plan_123',
      embedScriptUrl: 'https://js.whop.com/static/checkout/loader.js',
      environment: 'production',
    });

    const cfg = await payFirstEnrollmentService.getManualSaleConfig('loc_1', 'offer_whop');
    expect(cfg).toEqual(expect.objectContaining({
      processorType: 'whop',
      hostedCheckout: true,
    }));

    const result = await payFirstEnrollmentService.createWhopManualSaleSession({
      locationId: 'loc_1',
      offerId: 'offer_whop',
      firstName: 'Client',
      lastName: 'One',
      email: 'client@example.com',
      amount: 100,
      paymentType: 'pif',
    } as any);

    expect(result).toEqual(expect.objectContaining({
      success: true,
      processorType: 'whop',
      hostedCheckout: true,
      checkoutUrl: 'https://whop.com/checkout/ch_123',
    }));
    expect(mockWhopCreateCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({
      locationId: 'loc_1',
      offer: expect.objectContaining({ id: 'offer_whop' }),
      contactId: 'contact_1',
      contactEmail: 'client@example.com',
      contactName: 'Client One',
      enrollmentId: 'enr_1',
      checkoutMode: 'quick_manual_sale',
      sendEnrollment: true,
    }));
    expect(mockCreateProcessorClient).not.toHaveBeenCalled();
  });

  it('finalizes a Whop Quick Manual Sale as paid pending consent without enrollment completion', async () => {
    const enrollment = {
      id: 'enr_whop_qms',
      location_id: 'loc_1',
      merchant_id: 'merch_1',
      contact_id: 'contact_1',
      offer_id: 'offer_1',
      email: 'client@example.com',
      first_name: 'Client',
      last_name: 'One',
      status: 'payment_processing',
      initial_payment_status: 'processing',
    };
    const updates: any[] = [];
    const enrollmentQuery: any = queryResult({ data: enrollment, error: null });
    enrollmentQuery.update = jest.fn((payload: any) => {
      updates.push(payload);
      return enrollmentQuery;
    });
    mockGetSupabase.mockReturnValue({
      from: jest.fn((table: string) => (
        table === 'enrollments'
          ? enrollmentQuery
          : queryResult({ data: null, error: null })
      )),
    });
    mockFindOffer.mockResolvedValue({ id: 'offer_1', offer_name: 'ScaleSafe Beta' });
    mockEvidenceFindByType.mockResolvedValue([]);

    const result = await payFirstEnrollmentService.finalizeWhopManualSale({
      locationId: 'loc_1',
      enrollmentId: 'enr_whop_qms',
      transactionId: 'pay_whop_qms',
      amount: 1.5,
      paymentType: 'pif',
      sendEnrollment: true,
    } as any);

    expect(result).toEqual(expect.objectContaining({
      success: true,
      enrollmentId: 'enr_whop_qms',
      status: 'paid_pending_enrollment',
      enrollmentUrl: expect.stringContaining('paidEnrollmentToken='),
    }));
    expect(updates).toContainEqual(expect.objectContaining({
      status: 'paid_pending_enrollment',
      initial_payment_status: 'succeeded',
      payments_made: 1,
      enrolled_at: null,
    }));
    expect(updates.some((payload) => payload.initial_payment_method === 'whop')).toBe(false);
    expect(mockEvidenceCreate).toHaveBeenCalledWith(expect.objectContaining({
      enrollment_id: 'enr_whop_qms',
      evidence_type: 'enrollment_payment',
      data: expect.objectContaining({ transaction_id: 'pay_whop_qms', processor: 'whop' }),
    }));
    expect(mockFireTrigger).toHaveBeenCalledWith(
      'loc_1',
      'ss_send_enrollment_link',
      expect.objectContaining({
        enrollment_id: 'enr_whop_qms',
        send_welcome: false,
      }),
    );
    expect(mockFireTrigger).toHaveBeenCalledWith(
      'loc_1',
      'ss_payment_received',
      expect.objectContaining({
        enrollment_id: 'enr_whop_qms',
        transaction_id: 'pay_whop_qms',
        send_welcome: false,
      }),
    );
    expect(mockFireTrigger).not.toHaveBeenCalledWith(
      'loc_1',
      'enrollment_complete',
      expect.anything(),
    );
  });
});
