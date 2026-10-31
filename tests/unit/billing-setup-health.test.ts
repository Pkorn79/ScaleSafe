const mockFrom = jest.fn();
const mockObserve = jest.fn();
jest.mock('../../src/clients/supabase.client', () => ({ getSupabase: () => ({ from: mockFrom }) }));
jest.mock('../../src/repositories/command-center-health.repository', () => ({ commandCenterHealthRepository: { recordObservation: (...args: any[]) => mockObserve(...args) } }));
jest.mock('../../src/utils/logger', () => ({ logger: { error: jest.fn() } }));
import { billingSetupHealthService } from '../../src/services/billing-setup-health.service';
import { billingSetupAlert } from '../../src/utils/billing-setup-alert';
import { canControlProcessorLifecycle } from '../../src/ui/src/lib/paymentLifecycleCapabilities';

const row = { id: 'e1', status: 'enrolled', payment_type: 'installment', payments_made: 1, payments_total: 3,
  billing_setup_status: 'failed', enrolled_at: '2026-10-30T14:00:00Z' };
const now = new Date('2026-10-30T15:00:00Z');
describe('unresolved automatic billing alerts', () => {
  beforeEach(() => { jest.clearAllMocks(); mockObserve.mockResolvedValue(undefined); });
  it('alerts immediately for rejected setup, independent of due date', () => {
    expect(billingSetupAlert(row, now)).toMatchObject({ escalated: false, uncertain: false });
  });
  it('escalates after 24 hours and immediately for uncertain outcomes', () => {
    expect(billingSetupAlert(row, new Date('2026-10-31T14:00:00Z'))?.escalated).toBe(true);
    expect(billingSetupAlert({ ...row, billing_setup_status: 'needs_reconciliation' }, now)?.escalated).toBe(true);
  });
  it('gives in-flight setup a grace period, but catches stuck pending setup', () => {
    expect(billingSetupAlert({ ...row, billing_setup_status: 'pending' }, new Date('2026-10-30T14:05:00Z'))).toBeNull();
    expect(billingSetupAlert({ ...row, billing_setup_status: 'pending' }, now)).not.toBeNull();
  });
  it('includes payment-before-agreement enrollments with failed setup', () => {
    expect(billingSetupAlert({ ...row, status: 'paid_pending_enrollment' }, now)).not.toBeNull();
  });
  it.each([{ status: 'cancelled' }, { status: 'completed' }, { payment_type: 'pif' },
    { payments_made: 3 }, { billing_completed_at: '2026-10-30' }, { billing_setup_status: 'ok' }])(
    'does not alarm on resolved or non-recurring record %j', change => {
      expect(billingSetupAlert({ ...row, ...change }, now)).toBeNull();
    });
  it('does not treat a subscription payment count as finite completion', () => {
    expect(billingSetupAlert({ ...row, payment_type: 'subscription', payments_made: 3 }, now)).not.toBeNull();
  });
  it.each(['failed', 'pending', 'needs_reconciliation'])('disables unsafe lifecycle controls for %s setup', billingSetupStatus => {
    expect(canControlProcessorLifecycle({ processorType: 'nmi', billingSetupStatus })).toBe(false);
    expect(canControlProcessorLifecycle({ processor_type: 'stripe', billing_setup_status: billingSetupStatus })).toBe(false);
  });
  it('preserves normal enrolled plan controls', () => {
    expect(canControlProcessorLifecycle({ processorType: 'nmi', billingSetupStatus: 'ok', processorSubscriptionId: 'known' })).toBe(true);
  });
  function query(data: any[], error: any = null) {
    const q: any = { select: jest.fn(), eq: jest.fn(), in: jest.fn(), order: jest.fn(), range: jest.fn() };
    for (const key of ['select', 'eq', 'in', 'order']) q[key].mockReturnValue(q);
    q.range.mockResolvedValue({ data, error });
    mockFrom.mockReturnValue(q);
    return q;
  }
  it('records persistent HQ health for the exact tenant and no payment mutation', async () => {
    const q = query([row]);
    await billingSetupHealthService.checkLocation('location-A', 'merchant-A');
    expect(q.eq).toHaveBeenCalledWith('location_id', 'location-A');
    expect(mockObserve).toHaveBeenCalledWith(expect.objectContaining({ locationId: 'location-A', merchantId: 'merchant-A',
      scopeId: 'location-A', checkKey: 'merchant.recurring_setup', state: 'unhealthy', failureClass: 'RECURRING_SETUP_UNRESOLVED' }));
  });
  it('does not resolve incidents when a read fails', async () => {
    query([], new Error('unavailable'));
    await expect(billingSetupHealthService.checkLocation('A', 'M')).rejects.toThrow();
    expect(mockObserve).not.toHaveBeenCalled();
  });
  it('does not silently succeed when incident persistence fails', async () => {
    query([row]); mockObserve.mockRejectedValue(new Error('RPC failed'));
    await expect(billingSetupHealthService.checkLocation('A', 'M')).rejects.toThrow('RPC failed');
  });
  it('records recovery after all unresolved setups have been cleared', async () => {
    query([]);
    await billingSetupHealthService.checkLocation('A', 'M');
    expect(mockObserve).toHaveBeenCalledWith(expect.objectContaining({ state: 'healthy', failureClass: null }));
  });
  it('reads subsequent pages rather than missing later enrollments', async () => {
    const q = query([]);
    q.range.mockResolvedValueOnce({ data: Array.from({ length: 200 }, (_, i) => ({ ...row, id: `e${i}` })) })
      .mockResolvedValueOnce({ data: [{ ...row, id: 'last' }] });
    await billingSetupHealthService.checkLocation('A', 'M');
    expect(q.range).toHaveBeenNthCalledWith(2, 200, 399);
    expect(mockObserve.mock.calls[0][0].metrics.unresolved).toBe(201);
  });
});
