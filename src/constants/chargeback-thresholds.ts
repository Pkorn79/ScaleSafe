/**
 * Chargeback ratio thresholds by processor.
 *
 * Stripe: thresholds from Stripe's dispute monitoring program.
 * NMI: Visa VAMP enforcement threshold is 1.5%. Early warning at 1.25%
 *   gives merchants time to react before program enrollment.
 *
 * NOTE: 1.25% warning is a suggested early-warning buffer — flagged for
 * Philip to confirm with NMI sponsor bank.
 */

export const CHARGEBACK_THRESHOLDS = {
  stripe: {
    warning: 0.005,    // 0.50% — Stripe elevated monitoring
    critical: 0.009,   // 0.90% — Stripe critical / program threshold
  },
  nmi: {
    warning: 0.0125,   // 1.25% — early warning before VAMP enforcement
    critical: 0.015,   // 1.50% — Visa VAMP enforcement threshold
  },
} as const;
