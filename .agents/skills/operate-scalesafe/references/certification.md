# Certification And Reviewer Proof

## Test Boundaries

- Use a dedicated reviewer location for presentation and PMG/internal development for broader regression unless the owner directs otherwise.
- Use fictional clients and an approved monitored inbox.
- Use Stripe test mode for reviewer money movement.
- Run NMI live testing only with explicit owner approval for the exact low amount and payment method, followed by an approved refund plan.
- Never submit a real dispute or expose credentials.

## Baseline Certification Offer

Create or verify one offer with:

- Distinct internal and public names.
- Stripe test processor.
- Paid in full.
- Full enrollment.
- Purchase Summary and Cardholder Authorization.
- One simple milestone.
- Correct merchant logo, support identity, terms, and funnel hostname.

## End-To-End Proof

1. Open ScaleSafe from the exact reviewer sub-account without an account chooser.
2. Verify dashboard and merchant settings contain reviewer data only.
3. Open the full enrollment link.
4. Verify identity, public program name, merchant branding, amount, payment structure, terms, policies, acknowledgments, and milestone copy.
5. Complete consent/signature and one Stripe test payment.
6. Confirm success appears once.
7. Confirm Stripe has one test payment.
8. Confirm ScaleSafe has one client, enrollment, payment event, and signed packet tied together.
9. Confirm receipt and welcome workflows execute and the received messages use the public program name and correct links.
10. Confirm Programs, Payments, Evidence, Messages, and Files show the correct enrollment.
11. Add one milestone or attended-appointment evidence item and verify exact enrollment linkage.
12. Compile one defense from the test transaction and matching reason code.
13. Verify one-enrollment exhibits and that missing proof creates `needs_review`.
14. Review Stripe Risk Health and Evidence Connections without changing credentials.
15. Correlate the run with Railway logs and confirm no unexpected `4xx`, `5xx`, duplicate processor action, or failed background job.

## Workflow Proof Standard

For each required workflow, record:

- Triggering merchant/client action.
- Client, offer, and enrollment.
- ScaleSafe trigger delivery.
- GHL workflow execution state.
- Outbound communication record.
- Received email/SMS or other external result.
- Evidence/audit record and safe screenshot or stable ID.

Do not mark a workflow verified from GHL acceptance alone.

## Pass Conditions

- No cross-tenant data or account chooser.
- No unexplained provisioning blocker.
- Correct test/live processor identity.
- Exactly one expected payment and enrollment.
- Current public name, branding, terms, and support details.
- Required workflows proven end to end.
- Evidence tied to the exact enrollment.
- Unsafe defense output held for review.
- No unexplained production errors or duplicate side effects.
