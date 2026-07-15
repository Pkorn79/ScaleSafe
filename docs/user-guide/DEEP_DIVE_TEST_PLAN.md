# ScaleSafe Interface and Production Trace Deep-Dive Plan

## Objective

Certify the beta workflows by following each action from the merchant interface through ScaleSafe, Railway, Supabase, GoHighLevel, and the payment processor. The result is a repeatable test record, an accurate user guide, and a prioritized issue list.

This is not a random click-through. Every test has one expected state transition and one trace window.

## Recommended Order

### Phase 0 - Establish the Baseline

1. Wait until Fable's active work is committed and deployed.
2. Record the deployed commit SHA and migration number.
3. Confirm CI is green and Railway reports the expected deployment.
4. Run `railway login` and verify read-only log access.
5. Select one dedicated fictional merchant, client, and offer set for screenshots and active tests.
6. Record processor environments. Never assume Stripe is sandbox or NMI is safe for a live charge.
7. Confirm the production database is healthy, has adequate compute headroom, and has a recoverable backup before creating live test traffic.
8. Record worker/cron request cadence so an idle system cannot exhaust the database before the first merchant action.

### Phase 1 - Re-Verify Observability Repairs

The original five observability defects have been repaired: Defense displays compiled exhibits, Settings initializes clean, pulse diagnostics separate app-event/outbound/submission timestamps, missing Stripe health classifications display as Unknown, and QMS shows a loading state while processor configuration loads.

Re-verify those behaviors after every release before relying on them as test evidence. Treat a regression as a new issue rather than repeating the historical repair steps.

### Phase 2 - Fresh Installation and Provisioning

Test in the new GHL review sub-account:

- Reviewer fixture: `ScaleSafe`, location `BxiqLzUf4Rh5GXR6DUZ3`; the app is already installed.
- Internal regression fixture: `PMG Merchant Consulting`, location `274dtgl30b7x2HG8hn69`; do not substitute it for the clean reviewer walkthrough.
- `Vine and Branch` is outside this certification and must not receive a ScaleSafe install.

1. Marketplace installation and snapshot delivery.
2. Location-bound SSO launch with no agency account selector.
3. Merchant Setup fields and enrollment funnel domain.
4. Processor connections intended for the review account.
5. Provisioning Health after setup.
6. GHL custom values, fields, workflow subscriptions, and webhook authentication.

Expected proof:

- Browser screenshot.
- Railway install/SSO/provisioning routes and status codes.
- Sanitized database merchant/config state.
- GHL workflow and custom-value presence.
- No cross-location query or selector.

### Phase 3 - Offer and Client Workflow Certification

Test one workflow at a time:

1. Create paid-in-full offer.
2. Create installment offer.
3. Create subscription offer.
4. Configure full enrollment, then quick checkout.
5. Add a fictional client.
6. Send Offer by email.
7. Assign Offer and document that it intentionally creates no payment/consent proof.
8. Run QMS with an offer.
9. Run QMS without an offer and verify it remains an unassigned client payment.

Expected proof includes the exact offer/enrollment IDs and the workflow trigger delivery result.

### Phase 4 - Payment Vertical Slices

Run separate slices for Stripe, NMI, and Whop. Never mix processors in one test record.

For each supported channel, test:

1. Initial payment.
2. Saved payment method or hosted checkout result.
3. Recurring/subscription identifier.
4. Recurring payment webhook.
5. Full and partial refund where supported.
6. Pause, resume, and cancel where supported.
7. Duplicate submission/webhook behavior.
8. Reconciliation output.

Controls:

- Stripe uses sandbox for review certification.
- Every NMI action requires owner approval for the exact amount immediately before submission.
- Whop minimums and hosted-checkout constraints are recorded as channel behavior.
- No refund, cancellation, or subscription change runs without explicit approval.

### Phase 5 - Fulfillment and Evidence

Certify the enrollment link for each evidence source:

1. Enrollment consent and signed packet.
2. Payment evidence.
3. GHL inbound/outbound communication.
4. GHL appointment scheduled, attended/completed, cancelled, and no-show.
5. Milestone completion and client sign-off.
6. Pulse app event, GHL workflow, outbound message, client submission, and merchant follow-up alert.
7. Zoom meeting attendance and participant duration.
8. Custom Software API event.

For every source, prove:

- The event belongs to the correct location and contact.
- One exact enrollment was selected by a defensible method.
- The source timestamp and receipt timestamp remain distinct.
- Ambiguous events remain unlinked and out of defense exhibits.
- The client Evidence tab and defense service read the same record.

### Phase 6 - Defense and Stripe Defense Layer

1. Create a dispute against a selected test transaction.
2. Use the matching card-brand reason code.
3. Confirm the processor deadline and ScaleSafe deadline.
4. Compile the packet.
5. Compare letter, Exhibits tab, PDF, version history, and readiness state.
6. Verify Needs Review gating.
7. Submit through Stripe only in the approved test path.
8. Confirm Stripe response before local submission status changes.
9. Record outcome without changing unrelated packets.

### Phase 7 - Documentation and Public Fixture

1. Convert each passing test into a user-guide workflow.
2. Capture screenshots only from the fictional review fixture.
3. Add the expected result and troubleshooting branch.
4. Record unresolved defects in `LIVE_FINDINGS.md`.
5. Remove or replace screenshots after material UI changes.

## Per-Test Trace Template

```text
Test ID:
Deployed SHA:
Location ID:
Tester:
Start/end time and timezone:
Client/contact ID:
Offer ID:
Enrollment ID:
Processor/environment:
Approved amount, if any:

Merchant action:
Expected ScaleSafe state:
Expected GHL state:
Expected processor state:
Expected evidence/audit state:

Browser result:
Railway request/log result:
Supabase result:
GHL execution result:
Processor result:

Pass/fail:
Issue ID:
Screenshots/record IDs:
```

## Railway Log Procedure

After each state-changing action:

1. Record the exact click/submit timestamp in CDT and UTC.
2. Pull a narrow Railway log window around the action.
3. Filter by route, location ID, request ID, contact/enrollment ID, and safe processor identifier.
4. Record HTTP status, duration, retries, warnings, and downstream response category.
5. Confirm that sensitive credentials, full payment data, and raw secrets were not logged.
6. Compare the log conclusion with Supabase, GHL, and processor truth.

Do not use a broad log dump as proof. A successful HTTP response proves only that route's response, not the downstream email, processor mutation, or evidence publication.

## Issue Triage

- **P0:** cross-tenant access, auth bypass, wrong/duplicate money movement, destructive corruption, or evidence for the wrong enrollment.
- **P1:** a core beta path is broken or silently loses payment, workflow, or evidence state.
- **P2:** important usability/reliability issue with a workable beta path.
- **P3:** visual polish, documentation drift, or post-beta hardening.

Every finding must be classified as code, data/schema, configuration, missing live proof, documentation drift, or intentional limitation.

## Stop Conditions

Stop the current test immediately when:

- The selected location/contact/offer is not the intended fixture.
- A payment environment or amount is unclear.
- Railway reports an ambiguous timeout after a money action.
- Processor and ScaleSafe state disagree.
- The production database reports unhealthy/resource-exhausted or the health endpoint cannot answer inside its bounded deadline.
- No recoverable database and private-file backup exists for the data being changed.
- A duplicate charge/refund/subscription action may occur.
- A test would change settings, workflows, credentials, or live client communication without approval.
