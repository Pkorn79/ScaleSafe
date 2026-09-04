/**
 * cancelSubscription must not require a live processor cancellation when the
 * enrollment's billing is already complete (fully paid finite installments).
 *
 * Live incident (2026-09-03, PMG): three fully paid Stripe installment
 * enrollments could never be cancelled because the processor call always runs
 * and any failure (mode mismatch, deleted subscription) is rethrown before the
 * enrollment row is updated.
 */

const singleQueue: any[] = [];
const maybeSingleQueue: any[] = [];
const thenQueue: any[] = [];
const fromCalls: any[] = [];

function builder(table: string) {
  const ops: any = { table, chain: [] };
  fromCalls.push(ops);
  const b: any = {};
  ['select', 'insert', 'update', 'eq', 'in', 'neq', 'limit', 'order'].forEach((m) => {
    b[m] = (...args: any[]) => { ops.chain.push([m, args]); return b; };
  });
  b.single = () => Promise.resolve(singleQueue.shift() ?? { data: null, error: null });
  b.maybeSingle = () => Promise.resolve(maybeSingleQueue.shift() ?? { data: null, error: null });
  b.then = (onF: any, onR: any) => Promise.resolve(thenQueue.shift() ?? { data: [], error: null }).then(onF, onR);
  return b;
}

const mockRpc = jest.fn();
const mockSupabase = { from: (t: string) => builder(t), rpc: (...a: any[]) => mockRpc(...a) };
const mockProcessorCancel = jest.fn();
const mockResolveProcessor = jest.fn();
const mockCreateProcessorClient = jest.fn(() => ({ cancelSubscription: (...a: any[]) => mockProcessorCancel(...a) }));
const mockLogEvidence = jest.fn();

jest.mock('../../src/clients/supabase.client', () => ({ getSupabase: () => mockSupabase }));
jest.mock('../../src/clients/ghl.client', () => ({
  ghlApi: jest.fn().mockResolvedValue({ put: jest.fn().mockResolvedValue({}), post: jest.fn().mockResolvedValue({}) }),
}));
jest.mock('../../src/services/processor.factory', () => ({
  resolveProcessor: (...a: any[]) => mockResolveProcessor(...a),
  createProcessorClient: (...a: any[]) => mockCreateProcessorClient(),
}));
jest.mock('../../src/services/trigger.service', () => ({ triggerService: { fireTrigger: jest.fn().mockResolvedValue({ sent: 1, failed: 0 }) } }));
jest.mock('../../src/services/evidence.service', () => ({ evidenceService: { logEvidence: (...args: any[]) => mockLogEvidence(...args) } }));
jest.mock('../../src/services/payment-methods.service', () => ({ collapseVisiblePaymentMethods: jest.fn(), archivePaymentMethod: jest.fn() }));
jest.mock('../../src/repositories/merchant.repository', () => ({ merchantRepository: { getByLocationId: jest.fn() } }));
jest.mock('../../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { paymentLifecycleService } from '../../src/services/payment-lifecycle.service';

const PARAMS = {
  merchantId: 'm1',
  locationId: 'loc_1',
  contactId: 'contact_1',
  offerId: 'offer_1',
  reason: 'Merchant-initiated cancellation',
  enrollmentId: 'enr_1',
  processorSubscriptionId: 'sub_stale_test_mode',
  processorType: 'stripe' as const,
};

function enrollmentUpdates() {
  return fromCalls
    .filter((c) => c.table === 'enrollments')
    .flatMap((c) => c.chain)
    .filter(([m]: any[]) => m === 'update')
    .map(([, args]: any[]) => args[0]);
}

describe('cancelSubscription — fully paid installments and dead processor subscriptions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    singleQueue.length = 0;
    maybeSingleQueue.length = 0;
    thenQueue.length = 0;
    fromCalls.length = 0;
    mockLogEvidence.mockResolvedValue({});
    mockResolveProcessor.mockResolvedValue({ config: { processor_type: 'stripe' } });
  });

  it('skips the processor entirely when the enrollment is fully billed, and still cancels', async () => {
    maybeSingleQueue.push(
      // billing-state lookup
      { data: { payments_made: 4, payments_total: 4, payment_type: 'installment', billing_completed_at: null } },
      // updateEnrollmentForLifecycleAction result
      { data: { id: 'enr_1', status: 'cancelled', next_billing_date: null, processor_subscription_id: null } },
    );

    await paymentLifecycleService.cancelSubscription({ ...PARAMS });

    expect(mockResolveProcessor).not.toHaveBeenCalled();
    expect(mockProcessorCancel).not.toHaveBeenCalled();
    const updates = enrollmentUpdates();
    expect(updates.length).toBeGreaterThanOrEqual(1);
    expect(updates[0]).toMatchObject({ status: 'cancelled', processor_subscription_id: null });
  });

  it('skips the processor when billing_completed_at is set even if counters look incomplete', async () => {
    maybeSingleQueue.push(
      { data: { payments_made: 1, payments_total: 4, payment_type: 'installment', billing_completed_at: '2026-08-01T00:00:00Z' } },
      { data: { id: 'enr_1', status: 'cancelled', next_billing_date: null, processor_subscription_id: null } },
    );

    await paymentLifecycleService.cancelSubscription({ ...PARAMS });

    expect(mockProcessorCancel).not.toHaveBeenCalled();
    expect(enrollmentUpdates()[0]).toMatchObject({ status: 'cancelled' });
  });

  it('treats a processor "subscription not found" as an already-complete cancel', async () => {
    maybeSingleQueue.push(
      { data: { payments_made: 1, payments_total: 4, payment_type: 'installment', billing_completed_at: null } },
      { data: { id: 'enr_1', status: 'cancelled', next_billing_date: null, processor_subscription_id: null } },
    );
    mockProcessorCancel.mockResolvedValue({ success: false, notFound: true, errorMessage: 'No such subscription' });

    await paymentLifecycleService.cancelSubscription({ ...PARAMS });

    expect(mockProcessorCancel).toHaveBeenCalledTimes(1);
    expect(enrollmentUpdates()[0]).toMatchObject({ status: 'cancelled', processor_subscription_id: null });
  });

  it('still rethrows a real processor failure without touching the enrollment', async () => {
    maybeSingleQueue.push(
      { data: { payments_made: 1, payments_total: 4, payment_type: 'installment', billing_completed_at: null } },
    );
    mockProcessorCancel.mockResolvedValue({ success: false, errorMessage: 'gateway down' });

    await expect(paymentLifecycleService.cancelSubscription({ ...PARAMS })).rejects.toThrow(/gateway down/);

    expect(enrollmentUpdates()).toHaveLength(0);
  });

  it('still cancels at the processor for an active, not-fully-billed subscription', async () => {
    maybeSingleQueue.push(
      { data: { payments_made: 1, payments_total: 4, payment_type: 'installment', billing_completed_at: null } },
      { data: { id: 'enr_1', status: 'cancelled', next_billing_date: null, processor_subscription_id: null } },
    );
    mockProcessorCancel.mockResolvedValue({ success: true });

    await paymentLifecycleService.cancelSubscription({ ...PARAMS });

    expect(mockProcessorCancel).toHaveBeenCalledWith('sub_stale_test_mode');
    expect(enrollmentUpdates()[0]).toMatchObject({ status: 'cancelled' });
  });
});
