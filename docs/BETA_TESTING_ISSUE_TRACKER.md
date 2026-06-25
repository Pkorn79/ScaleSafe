# Beta Testing Issue Tracker

Purpose: keep live beta test failures visible until they are proven fixed. This is the practical checklist, not a feature roadmap.

## June Beta Readiness Sprint

- Target: beta-ready by early June.
- Mode: stability/proof only. No major new feature work before beta unless it fixes a beta blocker.
- Production standard: no hidden fallback billing or silent repair paths. Payment and workflow failures must be visible in UI/logs.
- Definition of beta-ready: a fresh merchant can install, provision, enroll a client, take payment, record evidence, send required workflow notifications, and generate a usable defense packet.

## 10-Day Beta Path

| Day | Focus | Exit proof |
|---|---|---|
| 1-2 | NMI + Stripe payment truth | Live recurring payment posts through processor webhook, advances progress, and sends receipt. |
| 2-3 | Critical workflows | Trigger delivery log says sent, GHL workflow runs, received email/SMS has populated values. |
| 3-4 | Milestones, refund, reminders, pulse, evidence forms | Each action creates the correct client/enrollment/evidence record and sends the intended workflow. |
| 4-5 | Defense packet | Packet generated from a real test client uses useful evidence details. |
| 5-6 | Provisioning + snapshot checklist | Provisioning Health clean or known warnings documented; only current V2 assets packaged. |
| 6-7 | Fresh sandbox install | Fresh location installs and completes one end-to-end enrollment/payment test. |
| 7-8 | Cloudflare cautious setup, if payment/webhooks are stable | No challenge/CAPTCHA on checkout, public action pages, or webhooks; webhook delivery still works. |
| 8-9 | Final beta dry run | One clean merchant flow with known limitations documented. |
| 10 | Freeze | Beta notes ready; no unproven changes shipped into beta. |

## Open / Watch

### NMI 3-payment installment test

- Status: WATCH
- Owner: Philip runs the live test; Codex reviews app state after recurring payments post.
- Expected: each NMI recurring payment reaches ScaleSafe automatically through the live NMI webhook path, advances `payments_made`, fires `ss_payment_received`, and final payment sets `billing_completed_at` without completing the program.
- Must not pass by: `nmi_history_sync`, `recurring_billing`, manual repair, or any hidden backup charge.

### Stripe recurring/installment sanity test

- Status: WATCH
- Owner: Philip runs one small test; Codex reviews app state.
- Expected: Stripe processor subscription/payment webhook advances the right enrollment, sends receipt, and keeps finite installment payoff separate from program completion.

### Workflow live proof

- Status: WATCH
- Reason: the app now sends richer trigger payloads and syncs compatibility contact fields, but each live GHL workflow still has to prove that its trigger is active and its message body renders populated values.
- Known workflows needing proof: enrollment complete, payment received, refund processed, milestone reached, milestone signed off, pulse due, chargeback detected, defense ready.
- Verified working: upcoming payment reminder has fired correctly in multiple live instances as of Philip's 2026-06-24 retest.
- 2026-05-13 update: Trigger Health now logs `no_subscription` when the app fires a trigger with no active GHL workflow subscription, and Provisioning Health surfaces last sent/failed/no-subscription status per trigger.

### Client record and evidence proof

- Status: WATCH
- Expected: programs, payments, milestones, evidence, and defense records attach to the correct client/enrollment.
- Watch for: orphan enrollments, unassigned payments, missing processor subscription IDs, and vague evidence rows where useful details exist.

### Fresh install and snapshot proof

- Status: WATCH
- Expected: run Provisioning Health, repair fields/webhook secret if needed, package only current V2 GHL assets, install into a fresh sandbox location, and complete one end-to-end enrollment/payment test.

### Production hygiene

- Status: WATCH
- Expected: deploys are green, health check is healthy, required env vars are present, and migration 068 is run when convenient:

```sql
ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS ghl_access_token_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS ghl_refresh_token_encrypted TEXT;

NOTIFY pgrst, 'reload schema';
```

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
- Post-beta features stay out of the beta-critical path: ACH, Cloudflare enforcement, multi-processor routing, better defense automation, standalone non-GHL mode, AI/MCP control, and mobile/PWA polish.
