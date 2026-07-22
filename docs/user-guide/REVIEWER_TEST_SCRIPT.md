# GoHighLevel Reviewer Test Script

ScaleSafe has no separate username or password. The HighLevel reviewer installs the submitted app version in a reviewer-controlled GHL sub-account and opens ScaleSafe through GHL SSO. Do not supply a shared GHL user: HighLevel's native login enforces email OTP, so such credentials are not suitable for unattended review.

The reviewer should run the journey in a reviewer-controlled GHL test sub-account using fictional records and reviewer-owned Stripe test credentials. The private ScaleSafe certification account shown in the submitted walkthrough is reference material only and is not required for reviewer access.

Suggested test payment:

- Processor: Stripe test mode
- Test card: Stripe test Visa `4242 4242 4242 4242`, any future expiry, any CVC

## 1. Open ScaleSafe

1. Install the submitted ScaleSafe version and attached Snapshot in one reviewer-controlled GHL test sub-account.
2. Select the Standard plan if HighLevel prompts for a plan; WholePay approval and NMI are not required for review.
3. Open that exact sub-account and select ScaleSafe from the custom menu.

Expected result:

- Dashboard loads without an account chooser.
- Only reviewer-fixture data is visible.
- No PMG Merchant Consulting clients, offers, payments, or evidence appear.

## 2. Review The Dashboard

Expected result:

- Summary counts match the reviewer fixtures.
- Open disputes and pulse follow-ups appear only when fixture data requires attention.
- Defense Activity and At-Risk Clients load without an error or long stall.

## 3. Create Or Review An Offer

Create a simple test offer:

- Internal name: `Reviewer Stripe PIF Test`
- Client-facing program name: `ScaleSafe Reviewer Test Program`

Expected configuration:

- Client-facing program name: `ScaleSafe Reviewer Test Program`
- Internal name: `Reviewer Stripe PIF Test`
- Stripe processor
- Paid in full
- Full enrollment
- Two relevant acknowledgments: Purchase Summary and Cardholder Authorization
- One simple milestone

Expected result:

- Merchant lists show the internal name.
- Enrollment pages and client communications show `ScaleSafe Reviewer Test Program`.

## 4. Complete Enrollment And Payment

1. Copy and open the full-enrollment link generated for the test offer.
2. Complete identity, program review, terms, and signature.
3. Before paying, confirm the ScaleSafe logo renders and the terms link opens the terms page generated for the review sub-account.
4. Complete Turnstile only if it is enabled for the fixture.
5. Pay with the Stripe test card.

Expected result:

- Success appears once.
- Stripe records one test payment.
- ScaleSafe creates one client, one enrollment, one payment, and one signed packet.
- Receipt and welcome workflow deliveries reference `ScaleSafe Reviewer Test Program`.
- The client Evidence tab links consent and payment to the exact enrollment.

## 5. Review Client And Payment Records

Expected result:

- Programs shows enrollment date, processor, payment status, and milestone.
- Payments shows the Stripe transaction ID and paid status.
- Files contains the private enrollment packet.
- Evidence contains enrollment consent and payment records with no unrelated client/program activity.

## 6. Add Fulfillment Evidence

Mark the reviewer milestone complete or use the prepared GHL appointment fixture.

Expected result:

- The exact enrollment is updated.
- Milestone or attended appointment evidence appears under `ScaleSafe Reviewer Test Program`.
- A scheduled-only appointment is labeled engagement; attended/completed activity may be delivery evidence.

## 7. Compile A Test Defense

1. Open Defense and choose the reviewer Stripe transaction.
2. Select the matching card-brand reason code.
3. Enter the test dispute date and the actual processor deadline when available.
4. Compile.

Expected result:

- The packet uses the selected transaction and one enrollment.
- Exhibits contain only that enrollment's consent, payment, fulfillment, and communication evidence.
- Missing required proof produces **Needs Review**.
- A Needs Review packet does not fire `ss_defense_ready`.
- No evidence is submitted to Stripe until the reviewer uses the separate reviewed submission action.

## 8. Review Stripe Risk Health

Expected result:

- The page identifies the connected Stripe test account.
- Metrics are explicitly test-account data.
- Only real Stripe dispute IDs appear in Active Disputes.
- Local/manual defense tests remain in Defense, not the Stripe queue.

## 9. Review Evidence Connections

Expected result:

- GHL Fulfillment appears as the native connection.
- Provider health separates Connected, Event observed, and Evidence published.
- A test connector event is labeled diagnostic and does not become production evidence.

## Reviewer Safety Notes

- Do not use live cards or bank accounts.
- Do not enter, rotate, or expose processor/API credentials.
- Do not test NMI money movement.
- Do not mark a real dispute submitted.
- Do not uninstall the app to troubleshoot a temporary service error.
- Contact `support@scalesafe.app` with the timestamp, sub-account, screen, and visible error.
