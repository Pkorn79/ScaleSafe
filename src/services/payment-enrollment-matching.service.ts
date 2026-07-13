function normalizedId(value: unknown): string {
  return String(value || '').trim();
}

function enrollmentSubscriptionIds(enrollment: any): string[] {
  return [enrollment?.processor_subscription_id, enrollment?.whop_membership_id]
    .map(normalizedId)
    .filter(Boolean);
}

function appendToIndex(index: Map<string, any[]>, key: string, value: any): void {
  if (!key) return;
  const rows = index.get(key) || [];
  rows.push(value);
  index.set(key, rows);
}

/**
 * Assign payment events to one enrollment without leaking a repeat purchase's
 * payments into another enrollment for the same contact and offer.
 */
export function groupPaymentEventsByEnrollment(
  enrollments: any[],
  paymentEvents: any[],
  contactId: string,
): Map<string, any[]> {
  const grouped = new Map<string, any[]>();
  const enrollmentById = new Map<string, any>();
  const enrollmentsBySubscription = new Map<string, any[]>();
  const enrollmentsByOffer = new Map<string, any[]>();

  for (const enrollment of enrollments || []) {
    const enrollmentId = normalizedId(enrollment?.id);
    if (!enrollmentId) continue;
    grouped.set(enrollmentId, []);
    enrollmentById.set(enrollmentId, enrollment);
    for (const subscriptionId of enrollmentSubscriptionIds(enrollment)) {
      appendToIndex(enrollmentsBySubscription, subscriptionId, enrollment);
    }
    appendToIndex(enrollmentsByOffer, normalizedId(enrollment?.offer_id), enrollment);
  }

  for (const payment of paymentEvents || []) {
    const linkedEnrollmentId = normalizedId(payment?.enrollment_id);
    if (linkedEnrollmentId) {
      const linkedEnrollment = enrollmentById.get(linkedEnrollmentId);
      if (linkedEnrollment) grouped.get(linkedEnrollmentId)?.push(payment);
      continue;
    }

    const paymentSubscriptionId = normalizedId(payment?.processor_subscription_id);
    if (paymentSubscriptionId) {
      const candidates = enrollmentsBySubscription.get(paymentSubscriptionId) || [];
      if (candidates.length === 1) grouped.get(normalizedId(candidates[0].id))?.push(payment);
      continue;
    }

    if (normalizedId(payment?.contact_id) !== normalizedId(contactId)) continue;
    const paymentOfferId = normalizedId(payment?.offer_id);
    if (!paymentOfferId) continue;

    const candidates = enrollmentsByOffer.get(paymentOfferId) || [];
    if (candidates.length === 1) grouped.get(normalizedId(candidates[0].id))?.push(payment);
  }

  return grouped;
}
