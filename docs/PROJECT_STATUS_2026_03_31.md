# ScaleSafe Project Status — March 31, 2026

**Purpose:** Context for Claude Code so you know where things stand before working on any task.

---

## What's Built and Deployed

The app is live at `https://scalesafe-production.up.railway.app` on Railway (auto-deploys from GitHub main). Here's what works:

- **OAuth callback** → exchanges GHL authorization code for tokens, creates merchant record in Supabase
- **SSO** via postMessage handshake → app loads inside GHL iframe
- **Merchant provisioning** → creates 50 custom fields + 3 custom values in GHL via API on install
- **Offer creation** → PIF + installment pricing with 11 T&C clause slots
- **Public enrollment page** → renders at /enrollment?offerId=xxx
- **Phase 1 (Trigger Infrastructure)** → trigger_subscriptions table, trigger subscription endpoint, trigger firing service (17 tests)
- **Phase 2 (Enrollment + Payment Webhooks)** → enrollments, evidence, payment_events tables; consent.service, enrollment.service; GHL payment webhook handler for 4 event types; enrollment list/detail endpoints (31 new tests)
- **Total: 124+ tests passing**

---

## What Just Happened (GHL Marketplace Side)

Philip registered all **18 custom workflow triggers** in the GHL Marketplace developer portal. All approved. These are the trigger keys:

- `enrollment_complete` (no prefix — submitted before convention)
- `ss_payment_received`, `ss_payment_failed`, `ss_cancellation_requested`
- `ss_session_logged`, `ss_session_noshow`, `ss_module_completed`
- `ss_milestone_reached`, `ss_milestone_signedoff`, `ss_program_completed`
- `ss_refund_processed`, `ss_client_at_risk`, `ss_client_reengaged`
- `ss_chargeback_detected`, `ss_defense_ready`, `ss_evidence_milestone`
- `ss_chargeback_ratio_warning`, `ss_chargeback_ratio_critical`

---

## What's In Progress: GHL Snapshot Build

Philip is manually updating GHL workflows in his test sub-account (Vine and Branch / PMG). Progress:

**Completed:**
- Webhook URLs updated on SYS2-07, SYS2-08, SYS2-09, SYS2-10, SYS2-12, SYS2-06, WF-02
- SYS2-03 (Agency Onboarding), SYS2-04 (Coach Onboarding), SYS2-05 (Course Onboarding), Export Trigger → moved to draft

**In Progress:**
- SYS2-11 (Cancellation) → needs webhook URL updated to app endpoint
- Post Payment Actions → needs trigger changed from tag-based (ss-payment-confirmed) to `enrollment_complete` custom trigger
- SS Refund Notification → needs trigger changed to `ss_refund_processed`

**Still To Do:**
- Convert remaining tag-based workflows to custom triggers
- Move Merchant Config Bridge and Offer Builder to draft
- Rebuild WF-D1 with enrollment_complete trigger
- Build 22 new communication workflows
- Build 4-page enrollment funnel
- Package the Snapshot in GHL Marketplace console

---

## BLOCKING ISSUE RIGHT NOW

Philip uninstalled the ScaleSafe app from his test sub-account and when he tried to reinstall, got:

```json
{"error":"VALIDATION_ERROR","message":"GHL token response missing locationId — cannot provision merchant"}
```

**This blocks everything.** He can't test custom triggers, workflows, or anything else until the app is reinstalled.

See `CLAUDE_CODE_FIX_OAUTH_REINSTALL.md` for the diagnostic task.

---

## Key Architecture Rules (Always Follow)

1. **Every query filters by location_id** — multi-tenant from day one
2. **Services never send communications** — fire GHL triggers, workflows handle comms
3. **ScaleSafe observes payments, never processes them** — GHL Products/Prices + native order form handle payment processing
4. **JSONB evidence column** — new evidence types plug in without schema migrations
5. **consent_token threads everything** — consent → payment → enrollment
6. **Processor column on payment_events** — processor-agnostic from day one
7. **Design tables with future phases in mind** — bumps (Phase 5), external funnels (Phase 8), Stripe migration (Phase 9)

---

## Key Documents (in /docs/)

- **FULL_ARCHITECTURE_MAP.md** — READ FIRST before building anything. Every table, endpoint, service across all 10 phases.
- **SCALESAFE_APP_BLUEPRINT_v2.1.md** — Complete product spec
- **MASTER_BUILD_SEQUENCE.md** — 10-phase roadmap with parallel tracks
- **GHL_SNAPSHOT_PLAN.md** — What goes in the GHL Snapshot
- **GHL_AUTOMATION_COMPANION.md** — All 18 triggers with payloads and workflow specs
