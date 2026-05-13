# Beta Testing Issue Tracker

Purpose: keep live beta test failures visible until they are proven fixed. This is the practical checklist, not a feature roadmap.

## Open / Watch

### NMI 3-payment installment test

- Status: WATCH
- Owner: Philip runs the live test; Codex reviews app state after recurring payments post.
- Expected: each NMI recurring payment reaches ScaleSafe automatically through Silent Post, advances `payments_made`, fires `ss_payment_received`, and final payment sets `billing_completed_at` without completing the program.

### Workflow live proof

- Status: WATCH
- Reason: the app now sends richer trigger payloads and syncs compatibility contact fields, but each live GHL workflow still has to prove that its trigger is active and its message body renders populated values.
- Known workflows needing proof: refund processed, milestone sign-off request, milestone sign-off confirmation, recurring receipt, payment reminders.

## Fixed / Ready To Retest

### Beta Tester 2 missed NMI recurring payment

- Status: FIXED BY REPAIR
- Evidence: transaction `12054526789`, NMI reference/subscription `12053506151`, repaired to `2 of 2 paid`.
- Code follow-up: NMI Query parsing was fixed so multi-action NMI transaction responses select the real sale amount instead of treating the verified amount as zero.

### Refund notification from Payment Management refund action

- Status: FIXED IN CODE, NEEDS RETEST
- Finding: manual refunds from the Payment Management UI logged a refund payment event but did not fire `ss_refund_processed`.
- Fix: successful manual refunds now fire the refund workflow trigger and sync refund amount/date/transaction id fields before firing.

### Milestone mark-complete path

- Status: FIXED IN CODE, NEEDS RETEST
- Finding: milestone completion wrote the app evidence/enrollment state but did not send enough workflow data for the sign-off request path.
- Fix: milestone completion now builds a signed milestone sign-off link, includes it in the trigger payload, syncs milestone contact fields, and updates the UI immediately after a successful mark-complete call.

## Notes

- Workflow template variables can still fail if the live GHL workflow action body uses a field or custom variable that differs from the app payload. The app can send the right data and still not render if the GHL message body points somewhere else.
- For beta, proof means: trigger delivery log shows `sent / 201`, GHL workflow execution exists, and the received email/SMS has populated values.
