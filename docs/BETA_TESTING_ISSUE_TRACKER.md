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

### Stripe manual refunds

- Status: FAILING
- Owner: Codex investigates next.
- Finding: Philip manually tested refunds for Stripe, Whop, and NMI on 2026-06-24. NMI refund worked. Stripe returned "An unexpected error occurred."
- Expected: Stripe refunds should work whether the stored transaction ID is a PaymentIntent (`pi_...`) or Charge (`ch_...`), write refund records/evidence when successful, and fire `ss_refund_processed`.

### Whop manual refunds

- Status: UNSUPPORTED IN SCALESAFE / NEEDS PRODUCT DECISION
- Owner: Codex prevents false-success UI; Philip refunds directly in Whop unless/until a real Whop refund API path is built.
- Finding: Philip saw a ScaleSafe/GHL refund email after attempting a Whop refund, but Whop did not show the refund. Treat this as not processor-confirmed.
- Expected: ScaleSafe must not show or process generic manual refunds for Whop unless Whop confirms the refund. Real Whop refund events should be recorded when Whop sends a refund webhook.

### Pulse check-ins

- Status: UNPROVEN / LIKELY NOT WORKING
- Owner: Codex to define and test the exact pulse path.
- Finding: Philip has not received a pulse notification and is not sure how to force/test it. Pulse likely needs to be tied to an offer/enrollment cadence and the shared `ss_app_event` workflow.
- Expected: due pulse fires `ss_app_event` with `event_type = pulse_check_due`, GHL sends the message, and client submission creates pulse evidence linked to the enrollment.

### Workflow live proof

- Status: WATCH
- Reason: the app now sends richer trigger payloads and syncs compatibility contact fields, but each live GHL workflow still has to prove that its trigger is active and its message body renders populated values.
- Known workflows needing proof: enrollment complete, payment received, refund processed, milestone reached, pulse due, chargeback detected, defense ready.
- Verified working: upcoming payment reminder has fired correctly in multiple live instances as of Philip's 2026-06-24 retest.
- Verified working: milestone signoff completed and created useful evidence as of Philip's 2026-06-24 retest. Example evidence: client digitally signed off on Milestone 1 with timestamp, IP, browser, and work delivered.
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

### NMI refund from Payment Management

- Status: VERIFIED WORKING
- Evidence: Philip manually tested Stripe, Whop, and NMI refunds on 2026-06-24. NMI refund worked.

### NMI recurring/installment live webhook path

- Status: VERIFIED WORKING
- Evidence: Philip confirmed NMI recurring has been working in live tests. Upcoming payment reminders and recurring receipt/progress behavior have also been observed working.

### Stripe recurring/installment sanity test

- Status: VERIFIED WORKING
- Evidence: Philip confirmed Stripe recurring should be recorded as completed from testing.

### Milestone mark-complete path

- Status: VERIFIED WORKING
- Evidence: milestone signoff completed and produced evidence with signer, milestone, timestamp, IP, browser, and work delivered.

## Notes

- Workflow template variables can still fail if the live GHL workflow action body uses a field or custom variable that differs from the app payload. The app can send the right data and still not render if the GHL message body points somewhere else.
- For beta, proof means: trigger delivery log shows `sent / 201`, GHL workflow execution exists, and the received email/SMS has populated values.
- Post-beta features stay out of the beta-critical path: ACH, Cloudflare enforcement, multi-processor routing, better defense automation, standalone non-GHL mode, AI/MCP control, and mobile/PWA polish.
