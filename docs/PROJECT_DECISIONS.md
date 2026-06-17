# ScaleSafe Project Decisions

This file records product and launch decisions that should not be re-litigated unless Philip explicitly reopens them.

## Client / Contact Behavior

- Duplicate client email should resolve to the existing contact/client.
- Do not hard-block the user for duplicate email.
- The UI should clearly show that an existing client was found and used, so the merchant understands what happened.

## Marketplace / GHL App Review

- GHL External Authentication stays OFF.
- ScaleSafe does not use an extra third-party OAuth step during GHL app installation.
- Marketplace pricing stays Free during private beta.
- Do not create GHL billing meters, paid plans, or freemium plans unless Philip explicitly approves later.
- Permission/scope justifications are only prepared if HighLevel specifically asks during review.

## Testing / QA Workflow

- Do not treat an unchanged stale sheet row as a confirmed retest.
- When a fix is shipped, add the affected case to the Retest Queue with the fix/deploy context.
- Mark a case as retested only when Oke or Philip adds new proof, date, and result.
- NMI live-money tests are owner-only.
- Oke owns Stripe sandbox, GHL setup, offer/client/workflow/evidence/defense tests.

## Payment / Billing

- No fallback billing.
- Recurring/installment billing should be processor-native through Stripe, NMI, or future Whop.
- If processor subscription setup fails, ScaleSafe should surface the issue clearly and avoid pretending billing is healthy.
- Payment reminder workflows must use trigger payload fields, not stale contact fields, for payment-specific values.

## UI / UX

- Sticky/minimizable left navigation has shipped and should be considered accepted unless a new UI bug is reported.
- Sticky/minimizable navigation is not a launch blocker.
