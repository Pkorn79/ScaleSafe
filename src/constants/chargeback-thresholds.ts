/**
 * Chargeback ratio thresholds by processor.
 *
 * Stripe: thresholds from stripe-health.service.ts risk assessment.
 * NMI: card-brand thresholds (Visa VAMP/VDMP, Mastercard ECM).
 * OPEN QUESTION: NMI values need confirmation from Philip's NMI sponsor bank.
 */

export const CHARGEBACK_THRESHOLDS = {
  stripe: {
    warning: 0.005,   // 0.50% — elevated
    critical: 0.009,  // 0.90% — critical (Stripe program threshold)
  },
  nmi: {
    // Visa VAMP: 0.65% warning, 0.90% program enrollment
    // Mastercard ECM: 0.75% warning, 1.50% program enrollment
    // Using the lower of the two brand thresholds as default
    warning: 0.0065,  // 0.65% — Visa VAMP warning
    critical: 0.009,  // 0.90% — Visa VAMP program / Stripe critical
  },
} as const;
