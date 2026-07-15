# ScaleSafe End-to-End Beta Testing + Assistant Training SOP

Training owner: Philip

Primary tester: Oke

Working tracker: ScaleSafe E2E Beta Testing Tracker

Primary communication channel: Slack

## Purpose

This SOP turns beta testing into assistant training. The assistant should learn how ScaleSafe works by installing, configuring, and proving each workflow with evidence. Stripe sandbox and non-money tests are assistant-owned. NMI live-payment tests are owner-owned.

Every test case must include setup state, exact steps, expected ScaleSafe result, expected GHL result, expected processor result, proof required, pass/fail, issue notes, and cleanup.

Oke should use his own email address when creating test clients, running offer links, and testing client-facing communications. This lets him confirm whether the expected emails/SMS messages actually arrive and whether the merge fields render correctly from a real recipient perspective.

## Operating Rules

- Use the shared tracker workbook as the source of truth.
- Do not mark a test `Pass` without proof links or screenshots.
- Do not report "it did not work" without exact steps, expected result, actual result, and proof.
- Use Stripe sandbox for assistant payment tests.
- Use Oke's own email for test clients whenever the test involves client-facing communication.
- Use the Stripe sandbox dashboard view-only access to verify Stripe-side truth: PaymentIntent/charge ID, subscription ID, refund ID, payment method, status, amount, and duplicate-charge count.
- Owner performs NMI live card and NMI ACH tests.
- Any money-moving defect is `P0` until reviewed.
- Any generic "unexpected error" in a core launch path is at least `P1`.
- Known setup gaps should be logged as `Needs Setup`, not treated as app failures unless the app hides the reason.
- Ask Philip in Slack when a test is blocked, when live-money access is needed, when GHL setup does not match the SOP, or when an issue might be P0/P1.
- Philip and Oke will also do live training sessions. This SOP is the operating map, not a replacement for live walkthroughs.

## Communication And Escalation

Use Slack for quick questions and blockers.

Escalate immediately to Philip when:

- A payment appears to charge twice.
- Stripe shows a charge/subscription/refund that ScaleSafe does not show.
- ScaleSafe shows a payment/subscription/refund that Stripe does not show.
- Any live NMI action is required.
- A workflow sends the wrong message to a real contact.
- A test would require deleting live data or changing production workflow copy.
- The assistant is unsure whether a result is a bug or setup issue.

When reporting in Slack, include the tracker row or issue ID, a short description, and the proof link. The Sheet remains the permanent record.

## Test Identity Rules

Use consistent test identities so results are easy to trace.

- Use Oke's own email for tests where email delivery or client communications matter.
- Use a clearly labeled test client name, for example `Oke Stripe Full Enrollment Test`.
- Use the same test client only when the test is intentionally checking repeat-client behavior.
- Create a new test client for enrollment/payment tests unless the case says existing client.
- Never use a real customer record for assistant-run tests.
- Do not use Philip's email unless Philip asks for that specific test.

## Stripe Sandbox Verification Rules

Oke has view-only access to the Stripe sandbox. Use it to confirm processor truth for every Stripe payment test.

For Stripe payment tests, record:

- PaymentIntent ID or charge ID.
- Amount.
- Status.
- Customer/email.
- Payment method/card/test bank.
- Subscription ID for recurring tests.
- Refund ID for refund tests.
- Number of matching charges for double-click tests.

ScaleSafe passes only when ScaleSafe and Stripe agree on the payment/subscription/refund state.

## Shared Tracker Tabs

The companion workbook is `ScaleSafe_E2E_Beta_Testing_Tracker.xlsx`.

Tabs:

- `Test Runs`: one row per executed test attempt.
- `Install Checklist`: fresh sub-account setup and provisioning proof.
- `Offer Tests`: offer create/edit/update coverage.
- `Client Tests`: client creation, search, profile, enrollment, and evidence coverage.
- `Checkout Tests`: full enrollment, quick checkout, quick manual sale, dual pricing, add-ons, ACH, and double-click protection.
- `Recurring + Payment Tests`: subscriptions, installments, refunds, pause/resume/cancel, dunning, reminders.
- `Workflow Proof`: trigger subscription and GHL send proof.
- `Evidence + Defense`: evidence sources and defense packet proof.
- `Issues`: all defects and retest status.
- `Training Notes`: glossary, warnings, and operating guidance.

## Daily Testing Rhythm

1. Pick the next `Not Started` row from the relevant tab.
2. Create a unique `Run ID`, for example `RUN-2026-06-07-001`.
3. Run the test exactly as written.
4. Record all IDs: contact ID, offer ID, enrollment ID, transaction ID, subscription ID, trigger log ID.
5. Attach proof links/screenshots.
6. Mark status:
   - `Pass`
   - `Fail`
   - `Blocked`
   - `Needs Setup`
   - `Owner Only`
7. If failed, create or update an `Issue ID`.
8. Owner reviews issue rows daily and sends grouped batches to Codex.

## Phase 1: Assistant Setup Training

Goal: assistant proves they can install and orient inside a fresh or test GHL sub-account.

Test:

- Apply or verify the correct ScaleSafe snapshot assets.
- Install ScaleSafe through GHL.
- Confirm SSO login works.
- Open Settings and run provisioning health.
- Verify merchant record, webhook secret, fields, custom values, trigger subscriptions, payment settings, and pulse route.
- Confirm workflow trigger intent:
  - `ss_payment_received` sends receipts only.
  - `ss_send_enrollment_link` sends enrollment packet links only.
  - `enrollment_complete` sends welcome/access only.
  - `ss_app_event` handles payment reminders and pulse.

Proof:

- Provisioning health screenshot.
- Trigger health screenshot.
- List of remaining warnings with blocker/non-blocker status.

## Phase 2: Offer Lifecycle Testing

Goal: assistant becomes fluent in creating and maintaining offers.

Test:

- Create one-time offer.
- Create installment offer.
- Create subscription offer.
- Create offer with PIF/installment options.
- Edit title, description, price, tag, refund/terms/clause language, milestones, pulse cadence, dual pricing, order bump, pre-payment upsell.
- Change full enrollment to quick checkout.
- Clone offer if available.
- Save and reload after each meaningful edit.
- Copy and open checkout/enrollment links.

Expected:

- Changes persist after reload.
- Public links open.
- No generic "unexpected error."
- If an error occurs, assistant captures the exact action, screenshot, and console/network message if available.

## Phase 3: Client Lifecycle Testing

Goal: assistant proves client records and client pages work.

Test:

- Create new client.
- Search by name and email.
- Update editable client details.
- Assign offer.
- Send enrollment link.
- Confirm profile tabs load: overview, communications, evidence, payments, programs/enrollments, activity.
- Add note/message if available.
- Link evidence to program.
- Document duplicate-client behavior.

Proof:

- Contact ID.
- Client profile screenshots.
- Enrollment/program row.
- Evidence row before and after linking.

## Phase 4: Full Enrollment Funnel Tests

Assistant runs these with Stripe sandbox:

- Full enrollment, one-time card.
- Full enrollment, installment card.
- Full enrollment, subscription card.
- Full enrollment with PIF selected.
- Full enrollment with order bump.
- Full enrollment with pre-payment upsell.
- Full enrollment with dual pricing visible.
- Stripe ACH after setup is confirmed.

Expected:

- Pages 1-3 collect client details, terms, signature, device capture, and consent evidence.
- Payment happens once.
- `ss_payment_received` fires receipt.
- `enrollment_complete` fires welcome/access.
- Enrollment becomes active/enrolled.
- Evidence includes consent, payment, and selected line items.
- Recurring offers create processor subscription ID.

## Phase 5: Quick Checkout Tests

Assistant runs these with Stripe sandbox:

- One-time card.
- Installment card.
- Subscription card.
- Dual pricing.
- Order bump and pre-payment upsell.
- Double-click or rapid-submit protection.

Expected:

- Submit button prevents duplicate charge.
- Only one processor transaction exists.
- Only one payment event exists.
- Recurring creates subscription ID.
- Receipt fires once.
- Welcome/access does not fire unless the flow creates completed enrollment.

## Phase 6: Quick Manual Sale Tests

Assistant owns Stripe sandbox tests:

- Existing client, one-time.
- New client, one-time.
- Existing client, installment.
- New client, installment.
- Paid enrollment link checked.
- Paid enrollment link unchecked.

Expected:

- Card entry works after switching card/bank choices.
- Charge succeeds.
- Payment event exists.
- Saved card exists.
- Paid-pending enrollment is created when an offer is selected.
- Recurring offers save processor subscription ID.
- Receipt fires immediately.
- Enrollment link fires only when selected.
- Welcome/access waits until enrollment packet completion.

Owner-only NMI tests:

- Same matrix with tiny live NMI transactions.
- Verify NMI approval.
- Verify NMI subscription exists in NMI.
- Verify ScaleSafe stores NMI subscription ID.

## Phase 7: Payment Management Tests

Assistant owns Stripe sandbox tests:

- View payment history.
- View saved payment methods.
- Charge saved card.
- Refund full payment.
- Refund partial payment.
- Attempt over-refund and confirm clear error.
- Pause subscription.
- Resume subscription.
- Cancel subscription.
- Send card update link.
- Trigger failed payment/dunning path where possible.
- Verify recurring payment progress advances after webhook.

Owner-only NMI tests:

- Refund.
- Pause/resume/cancel.
- Recurring payment webhook proof.
- ACH after approval/configuration.

Expected:

- ScaleSafe status matches processor status.
- No fallback billing.
- No payment reminders for billing-not-ready enrollments.
- Payment progress updates once per processor transaction.
- Workflows fire once.

## Phase 8: Workflow + Trigger Proof

Prove every workflow independently.

Required workflows:

- Payment Receipt: `ss_payment_received`
- Send Enrollment Link: `ss_send_enrollment_link`
- Welcome/Access: `enrollment_complete`
- Payment Failed: `ss_payment_failed`
- Refund Processed: `ss_refund_processed`
- Chargeback Detected: `ss_chargeback_detected`
- ScaleSafe App Event: `ss_app_event`
- Upcoming Payment Reminder: `ss_app_event` with `event_type = upcoming_payment_reminder`
- Pulse Check Due: `ss_app_event` with `event_type = pulse_check_due`
- Milestone Reached
- Milestone Signed Off
- Defense Ready
- Evidence Milestone
- Chargeback Ratio Warning/Critical if active

Proof:

- Active subscription count.
- Last delivery log.
- GHL workflow execution screenshot.
- Received email/SMS screenshot.
- Payload fields rendered correctly.

## Phase 9: Evidence + Activity Tests

Test:

- Consent evidence.
- Payment evidence.
- Refund evidence.
- GHL inbound email/SMS communication.
- GHL outbound email/SMS communication.
- GHL appointment booked/updated/cancelled.
- GHL invoice created/paid.
- GHL note.
- GHL task.
- GHL opportunity.
- Course activity if configured.
- Manual evidence upload.
- Session log.
- Communication upload.
- Link evidence to program.

Expected:

- Communication previews are readable, not raw HTML.
- Direction, channel, conversation ID, and message ID are preserved when present.
- Unsupported GHL events do not create junk evidence.
- Client-level evidence appears on Client > Evidence.
- Linked evidence shows as linked.
- Defense packet can include relevant client-level evidence.

## Phase 10: Milestone + Pulse Tests

Milestone tests:

- Mark milestone reached.
- Send milestone signoff.
- Client submits signoff.
- Evidence appears.
- Workflow fires.

Pulse tests:

- Confirm pulse route/link works.
- Confirm workflow copy is cadence-neutral.
- Trigger pulse due.
- Confirm trigger delivery log means app-to-GHL delivery only.
- Confirm GHL workflow history/execution.
- Confirm outbound email/SMS activity and received message.
- Client submits pulse check.
- Evidence/activity appears.
- Due date does not advance if setup is missing.
- Health explains missing setup clearly.

## Phase 11: Defense Packet Tests

Test:

- Search/select client.
- Select transaction/payment.
- Generate defense packet.
- Confirm included evidence: consent, payment, communications, milestones/pulse, refund/cancellation when relevant.
- Edit/regenerate letter if available.
- Mark submitted.
- Record outcome.
- Confirm Defense Ready workflow fires.

Proof:

- Defense packet ID.
- Packet screenshot/PDF proof.
- Included evidence list.
- Workflow delivery log.

## Phase 12: Fresh Sub-Account Certification

Assistant must run a fresh install certification before beta.

Checklist:

- New GHL sub-account.
- Snapshot/funnel/workflows present.
- ScaleSafe install/OAuth.
- Provisioning health.
- Payment setup instructions followed.
- Stripe sandbox connected.
- Create offer.
- Create client.
- Run Stripe quick checkout.
- Run Stripe full enrollment.
- Send enrollment link.
- Verify workflows.
- Verify evidence.
- Generate defense packet.

Launch pass requires:

- No unexplained critical provisioning warnings.
- Stripe card full checkout, quick checkout, and quick manual sale pass.
- Recurring subscription proof pass.
- Receipt/welcome split pass.
- Refund pass.
- Client/evidence/defense pass.
- Known NMI owner tests pass separately.

## Issue Reporting SOP

Severity:

- `P0`: money moved incorrectly, duplicate charge, security/data leak, checkout blocked.
- `P1`: core launch workflow broken.
- `P2`: confusing/broken but workaround exists.
- `P3`: copy/layout/minor polish.

Every issue must include:

- Exact account/sub-account.
- Exact client.
- Exact offer.
- Exact URL/page.
- Exact steps.
- Expected result.
- Actual result.
- Screenshot/video.
- Processor transaction ID if money moved.
- Trigger delivery log if workflow-related.

Owner reviews issue list daily and sends Codex grouped batches:

- Payment bugs.
- Workflow bugs.
- Provisioning bugs.
- UI/copy bugs.
- Evidence/defense bugs.

## Ownership

Assistant owns:

- Stripe sandbox tests.
- Offer/client/workflow/provisioning testing.
- Screenshots and issue tracking.
- Fresh sub-account install practice.

Owner owns:

- NMI live card tests.
- NMI ACH tests.
- Production processor credentials.
- Final launch approval.

Codex owns when prompted:

- Review sheet/exported rows.
- Group issues by root cause.
- Propose or implement fix batches.
- Produce retest instructions.

## Beta Launch Acceptance

ScaleSafe is beta-ready when:

- Fresh install can be completed by assistant using this SOP.
- Provisioning health has no unexplained critical warnings.
- Stripe card full checkout, quick checkout, and quick manual sale pass.
- NMI owner tests pass for card checkout, quick checkout, quick manual sale, recurring, and refunds.
- Recurring subscriptions create processor subscription IDs.
- Payment reminders, pulse, refund, failed payment, enrollment link, receipt, and welcome workflows are proven.
- Evidence appears correctly across payments, communications, milestones, pulse, and consent.
- Defense packet can be generated from a real client record.
- Duplicate-click tests do not create duplicate charges.
- All P0/P1 issues are fixed or explicitly removed from launch scope by owner decision.
