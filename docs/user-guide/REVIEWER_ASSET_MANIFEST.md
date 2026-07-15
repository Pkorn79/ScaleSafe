# Reviewer Screenshot Manifest

Use only screenshots marked **Approved** in the GoHighLevel Marketplace submission. PMG captures are retained as internal test evidence and must not be submitted merely because they are stored beside the guide.

## Approved

| File | Surface | Review |
| --- | --- | --- |
| `assets/reviewer-dashboard-clean.png` | Dedicated `ScaleSafe` reviewer sub-account dashboard | Approved. Empty tenant-isolated state; no PMG client, payment, or evidence data. |
| `assets/offer-builder.png` | Blank offer builder | Approved. No entered merchant, client, processor, or credential data. |

## Internal Only

The following captures contain PMG test identities, test offer names, operational metrics, incident details, or historical findings. Keep them for engineering reference; do not include them in the reviewer package:

- `assets/dashboard-overview.png`
- `assets/clients-controls.png`
- `assets/offers-list.png`
- `assets/payments-reconciliation-summary.png`
- `assets/stripe-risk-health.png`
- `assets/defense-packet-detail.png`
- `assets/CLIENT-MESSAGE-001_evidence-unlinked_2026-07-14.png`
- `assets/OPS-SUPABASE-001_project-unhealthy_2026-07-14.png`
- `assets/OPS-SUPABASE-002_database-health_2026-07-14.png`

## Capture After Reviewer Fixtures Exist

Capture these from the dedicated reviewer sub-account after the fixtures in `REVIEWER_TEST_SCRIPT.md` have been created:

- Reviewer offer list showing only `Reviewer - Stripe PIF` and public name `Reviewer Program`.
- Stripe test checkout before card entry; no card number, client email, signed token, or private URL visible.
- Reviewer client Programs/Evidence view using a fictional identity.
- Defense packet detail with fictional data and no signed private-file URL visible.
- Provisioning Health with secrets, IDs, emails, and webhook URLs cropped or masked.
- Evidence Connections health with credential controls and tenant identifiers omitted.

Before approval, inspect each image at full resolution for names, emails, phone numbers, addresses, card/bank data, processor IDs, API keys, access tokens, signed URLs, webhook secrets, and browser autofill suggestions.
