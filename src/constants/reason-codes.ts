/**
 * Card-network reason-code registry.
 *
 * Single source of truth for: code → network, dispute category, display name,
 * and the network's merchant response window. The category selects the defense
 * strategy/template; the response window drives deadline defaults.
 *
 * IMPORTANT: an unrecognized code must NEVER silently fall back to the
 * services_not_provided strategy — a canceled-recurring dispute defended with a
 * "we delivered lots of services" argument loses. Callers use resolveReasonCode()
 * and route unknown codes to needs_review.
 *
 * Sources: Visa Dispute Management Guidelines (June 2024); Mastercard Chargeback
 * Guide (May 2025); Amex US Disputes Reference Guide; Discover dispute rules —
 * summarized in docs/CHARGEBACK_DEFENSE_OPTIMIZATION_RESEARCH.md.
 */

export type CardNetwork = 'visa' | 'mastercard' | 'amex' | 'discover';

export type DisputeCategory =
  | 'fraud'
  | 'authorization'
  | 'services_not_provided'
  | 'not_as_described'
  | 'credit_not_processed'
  | 'canceled_recurring'
  | 'misrepresentation'
  | 'canceled_services'
  | 'duplicate_processing';

export interface ReasonCodeInfo {
  code: string;
  network: CardNetwork;
  category: DisputeCategory;
  displayName: string;
}

/** Card-network MAXIMUM response window in calendar days, per network. These are
 *  what the ACQUIRER gets — never use them as the merchant's default deadline. */
export const NETWORK_RESPONSE_DAYS: Record<CardNetwork, number> = {
  visa: 30,
  mastercard: 45,
  amex: 20,
  // Discover windows are cited as 20-30 days depending on source; use the
  // conservative end so a default deadline never overshoots the real one.
  discover: 20,
};

/** Merchant-safe operational deadline default. Processors/acquirers require the
 *  merchant's response well before the network maximum (they need time to compile
 *  and forward it). Unless an actual processor/acquirer due date is supplied,
 *  deadline defaults must never exceed this. Mirrored in DefenseView.vue. */
export const OPERATIONAL_RESPONSE_DAYS = 20;

/** Default deadline window (days) for a reason code: the network window capped at
 *  the merchant-safe operational deadline. */
export function operationalResponseDays(code: string): number {
  const network = responseWindowDays(code);
  return Math.min(network ?? OPERATIONAL_RESPONSE_DAYS, OPERATIONAL_RESPONSE_DAYS);
}

const RC = (code: string, network: CardNetwork, category: DisputeCategory, displayName: string): ReasonCodeInfo =>
  ({ code, network, category, displayName });

export const REASON_CODE_REGISTRY: Record<string, ReasonCodeInfo> = Object.fromEntries([
  // ── Visa ──────────────────────────────────────────────────────────────
  RC('10.1', 'visa', 'authorization', 'EMV Liability Shift — Counterfeit Fraud'),
  RC('10.4', 'visa', 'fraud', 'Other Fraud — Card-Absent Environment'),
  RC('11.1', 'visa', 'authorization', 'Card Recovery Bulletin'),
  RC('11.2', 'visa', 'authorization', 'Declined Authorization'),
  RC('11.3', 'visa', 'authorization', 'No Authorization'),
  RC('12.5', 'visa', 'duplicate_processing', 'Incorrect Amount'),
  RC('12.6.1', 'visa', 'duplicate_processing', 'Duplicate Processing'),
  RC('12.6.2', 'visa', 'duplicate_processing', 'Paid by Other Means'),
  RC('13.1', 'visa', 'services_not_provided', 'Merchandise/Services Not Received'),
  RC('13.2', 'visa', 'canceled_recurring', 'Canceled Recurring Transaction'),
  RC('13.3', 'visa', 'not_as_described', 'Not As Described or Defective'),
  RC('13.5', 'visa', 'misrepresentation', 'Misrepresentation'),
  RC('13.6', 'visa', 'credit_not_processed', 'Credit Not Processed'),
  RC('13.7', 'visa', 'canceled_services', 'Canceled Merchandise/Services'),

  // ── Mastercard ────────────────────────────────────────────────────────
  RC('4808', 'mastercard', 'authorization', 'Authorization-Related Chargeback'),
  RC('4834', 'mastercard', 'duplicate_processing', 'Point-of-Interaction Error'),
  RC('4837', 'mastercard', 'fraud', 'No Cardholder Authorization'),
  RC('4841', 'mastercard', 'canceled_recurring', 'Canceled Recurring or Digital Goods'),
  RC('4853', 'mastercard', 'not_as_described', 'Cardholder Dispute'),
  RC('4855', 'mastercard', 'services_not_provided', 'Goods or Services Not Provided'),
  RC('4860', 'mastercard', 'credit_not_processed', 'Credit Not Processed'),

  // ── American Express ─────────────────────────────────────────────────
  RC('A01', 'amex', 'authorization', 'Charge Amount Exceeds Authorization'),
  RC('A02', 'amex', 'authorization', 'No Valid Authorization'),
  RC('A08', 'amex', 'authorization', 'Authorization Approval Expired'),
  RC('C02', 'amex', 'credit_not_processed', 'Credit Not Processed'),
  RC('C04', 'amex', 'credit_not_processed', 'Goods/Services Returned or Refused'),
  RC('C05', 'amex', 'canceled_services', 'Goods/Services Canceled'),
  RC('C08', 'amex', 'services_not_provided', 'Goods/Services Not Received'),
  RC('C14', 'amex', 'duplicate_processing', 'Paid by Other Means'),
  RC('C28', 'amex', 'canceled_recurring', 'Canceled Recurring Billing'),
  RC('C31', 'amex', 'not_as_described', 'Goods/Services Not As Described'),
  RC('C32', 'amex', 'not_as_described', 'Goods/Services Damaged or Defective'),
  RC('F29', 'amex', 'fraud', 'Card Not Present Fraud'),
  RC('FR2', 'amex', 'fraud', 'Fraud Full Recourse Program'),
  RC('FR6', 'amex', 'fraud', 'Partial Immediate Chargeback Program'),
  RC('P08', 'amex', 'duplicate_processing', 'Duplicate Charge'),

  // ── Discover ─────────────────────────────────────────────────────────
  RC('AA', 'discover', 'fraud', 'Does Not Recognize'),
  RC('AP', 'discover', 'canceled_recurring', 'Canceled Recurring Payment'),
  RC('RG', 'discover', 'services_not_provided', 'Non-Receipt of Goods/Services'),
  RC('RM', 'discover', 'not_as_described', 'Cardholder Disputes Quality'),
  RC('RN2', 'discover', 'credit_not_processed', 'Credit Not Received'),
  RC('UA', 'discover', 'fraud', 'Fraud — Card Not Present'),
].map((info) => [info.code, info]));

/** Look up a reason code. Returns null for unknown codes — callers must route
 *  unknown codes to needs_review rather than guessing a category. */
export function resolveReasonCode(code: string): ReasonCodeInfo | null {
  if (!code) return null;
  return REASON_CODE_REGISTRY[code.trim().toUpperCase()] || REASON_CODE_REGISTRY[code.trim()] || null;
}

/** Response window (days) for the network behind a reason code; null when unknown. */
export function responseWindowDays(code: string): number | null {
  const info = resolveReasonCode(code);
  return info ? NETWORK_RESPONSE_DAYS[info.network] : null;
}
