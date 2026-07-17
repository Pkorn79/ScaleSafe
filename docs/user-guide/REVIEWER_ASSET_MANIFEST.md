# Reviewer Screenshot Manifest

Status: Sanitized screenshot pass completed July 17, 2026.

Use only screenshots marked **Public Safe** in public pages or the GoHighLevel Marketplace submission. Every image was captured from the dedicated ScaleSafe reviewer sub-account or a public reviewer funnel and checked at full resolution.

## Current Reviewer Fixture

- Internal offer name: `CERT 2026-07-16 Stripe PIF`
- Public program name: `ScaleSafe Reviewer Test Program`
- Tracking ID: `GHL_REVIEW_STRIPE_PIF`
- Processor: Stripe test mode
- Price: $1.00 paid in full

## Public Safe

| File | Surface | Best use |
| --- | --- | --- |
| `assets/reviewer-2026-07-17/01-offers-list.png` | Reviewer offer list | Marketplace review, offer-management help, product site feature section. |
| `assets/reviewer-2026-07-17/02-dashboard.png` | Clean reviewer dashboard | Marketplace review, dashboard help, product overview. |
| `assets/reviewer-2026-07-17/03-enrollment-program.png` | Enrollment/program card | Client-record and enrollment documentation. The crop excludes the client identity and stale historical test row. |
| `assets/reviewer-2026-07-17/04-defense-workspace.png` | Empty defense workspace | Defense workflow overview without client or dispute data. |
| `assets/reviewer-2026-07-17/06-evidence-connections.png` | Evidence Connections catalog | Integrations page and connection help. |
| `assets/reviewer-2026-07-17/07-payments-overview-sanitized.png` | Sanitized payment filters/summary | Payment-management documentation. The crop excludes client and processor identifiers. |
| `assets/reviewer-2026-07-17/09-public-enrollment-welcome.png` | Public enrollment welcome page | Enrollment and consent-flow walkthrough. |
| `assets/reviewer-2026-07-17/10-public-offer-review.png` | Public offer, milestone, and refund review | Product site, Marketplace journey, and enrollment help. |

## Internal Only

| File | Reason |
| --- | --- |
| `assets/reviewer-2026-07-17/05-stripe-risk-health.png` | No client PII, but the deliberately artificial test metrics show a critical account state and are not representative marketing material. |
| `assets/reviewer-2026-07-17/08-offer-builder.png` | Useful operator reference, but the sticky bar displays `Unsaved changes` on initial load. |
| `assets/reviewer-2026-07-17/08-offer-builder-overview.png` | Same initial-load dirty-state caveat. |
| `assets/reviewer-2026-07-17/10-merchant-terms-page.png` | This is a merchant-specific terms page, not ScaleSafe's own Terms of Service. |

The older captures directly under `assets/` include PMG test identities, historical failures, processor records, or internal operational data. They remain engineering evidence and are not approved for public reuse.

## Still Needed From A Fictional Demo Record

- Client evidence timeline with consent, payment, communication, milestone, pulse, appointment, and fulfillment evidence.
- Completed defense packet detail and exhibits with a fictional dispute and no signed private-file URL.
- Refund and recurring lifecycle controls with fictional payment identifiers.
- Milestone completion/sign-off and pulse follow-up states.
- Provisioning Health with all location IDs, webhook URLs, secrets, credentials, and personal emails masked.
- Stripe Risk Health populated with a representative sandbox fixture rather than the current synthetic critical metrics.

Do not create these from the current real test client. Seed one fictional reviewer client so the images remain safe as the website and help center evolve.

## Inspection Checklist

Before any screenshot is published, inspect it at full resolution for:

- Names, email addresses, phone numbers, postal addresses, and IP addresses.
- Card or bank data and browser autofill suggestions.
- Processor customer, payment, transaction, subscription, membership, or vault IDs.
- GHL location/contact IDs, API keys, access tokens, webhook secrets, and signed URLs.
- Internal incident data, unrealistic test metrics, stale records, and unsupported feature labels.
