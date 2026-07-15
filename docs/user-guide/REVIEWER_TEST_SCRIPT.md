# GoHighLevel Reviewer Test Script

Use the credentials supplied privately in the Marketplace submission. Do not store credentials in this repository.

Reviewer fixture:

- GHL sub-account: `ScaleSafe`
- GHL location: `BxiqLzUf4Rh5GXR6DUZ3`
- Processor: connected Stripe test account
- Test card: Stripe test Visa `4242 4242 4242 4242`, any future expiry, any CVC

The submission operator must create and verify the named reviewer fixtures below before recording the final video or sharing credentials.

## 1. Open ScaleSafe

1. Sign in with the supplied reviewer user.
2. Open the `ScaleSafe` sub-account.
3. Select ScaleSafe from the custom menu.

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

Use fixture `Reviewer - Stripe PIF`.

Expected configuration:

- Client-facing program name: `Reviewer Program`
- Internal name: `Reviewer - Stripe PIF`
- Stripe processor
- Paid in full
- Full enrollment
- Bot protection enabled for the public checkout
- One simple milestone

Expected result:

- Merchant lists show the internal name.
- Enrollment pages and client communications show `Reviewer Program`.

## 4. Complete Enrollment And Payment

1. Open the full-enrollment link.
2. Complete identity, program review, terms, and signature.
3. Complete Turnstile when shown.
4. Pay with the Stripe test card.

Expected result:

- Success appears once.
- Stripe records one test payment.
- ScaleSafe creates one client, one enrollment, one payment, and one signed packet.
- Receipt and welcome workflow deliveries reference `Reviewer Program`.
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
- Milestone or attended appointment evidence appears under `Reviewer Program`.
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
