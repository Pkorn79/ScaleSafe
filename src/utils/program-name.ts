type EnrollmentNameSource = {
  program_name_snapshot?: unknown;
} | null | undefined;

type OfferNameSource = {
  offer_name?: unknown;
} | null | undefined;

function normalizedName(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Resolve the customer-facing name for enrollment-specific output.
 * The frozen enrollment value must win over a later offer rename.
 */
export function resolveProgramName(
  enrollment: EnrollmentNameSource,
  offer: OfferNameSource,
  fallback = '',
): string {
  return normalizedName(enrollment?.program_name_snapshot)
    || normalizedName(offer?.offer_name)
    || fallback;
}

/** Merchant-only offer label used for dashboard lists and selectors. */
export function resolveInternalOfferName(
  offer: { internal_name?: unknown; offer_name?: unknown } | null | undefined,
  fallback = 'Offer',
): string {
  return normalizedName(offer?.internal_name)
    || normalizedName(offer?.offer_name)
    || fallback;
}
