export function isWhopEnrollment(enrollment: any): boolean {
  return String(enrollment?.processorType || enrollment?.processor_type || '').toLowerCase() === 'whop';
}

export function hasProcessorLifecycleId(enrollment: any): boolean {
  return Boolean(String(
    enrollment?.processorSubscriptionId
    || enrollment?.whopMembershipId
    || enrollment?.processor_subscription_id
    || enrollment?.whop_membership_id
    || '',
  ).trim());
}

export function canControlProcessorLifecycle(enrollment: any): boolean {
  return !isWhopEnrollment(enrollment) || hasProcessorLifecycleId(enrollment);
}
