/** Only an intentional client-level sale is exempt from missing-program diagnostics. */
export function isStandalonePayment(event: {
  source?: string | null;
  contact_id?: string | null;
  enrollment_id?: string | null;
  offer_id?: string | null;
  processor_subscription_id?: string | null;
  is_recurring?: boolean | null;
}): boolean {
  return event.source === 'quick_manual_sale'
    && Boolean(event.contact_id?.trim())
    && !event.enrollment_id
    && !event.offer_id
    && !event.processor_subscription_id
    && !event.is_recurring;
}
