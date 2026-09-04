import {
  canControlProcessorLifecycle,
  hasProcessorLifecycleId,
  isWhopEnrollment,
} from '../../src/ui/src/lib/paymentLifecycleCapabilities';

describe('payment lifecycle capabilities', () => {
  it('requires a Whop membership ID before exposing lifecycle controls', () => {
    const enrollment = { processorType: 'whop', processorSubscriptionId: null, whopMembershipId: null };

    expect(isWhopEnrollment(enrollment)).toBe(true);
    expect(hasProcessorLifecycleId(enrollment)).toBe(false);
    expect(canControlProcessorLifecycle(enrollment)).toBe(false);
  });

  it('accepts either Whop membership field shape', () => {
    expect(canControlProcessorLifecycle({ processorType: 'whop', whopMembershipId: 'mem_123' })).toBe(true);
    expect(canControlProcessorLifecycle({ processor_type: 'whop', whop_membership_id: 'mem_456' })).toBe(true);
  });

  it('does not require a subscription ID for local Stripe or NMI lifecycle state', () => {
    expect(canControlProcessorLifecycle({ processorType: 'stripe' })).toBe(true);
    expect(canControlProcessorLifecycle({ processorType: 'nmi' })).toBe(true);
  });
});
