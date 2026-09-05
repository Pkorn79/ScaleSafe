# Claude Code Codex Log - ScaleSafe V2

Purpose: repo-local technical handoff for Claude Code and Codex.

Audience: coding agents working inside `C:\Users\p_kor_e1dk2i3\ScaleSafe`.

This file is about implementation: files changed, security findings, tests, known code risks, and next code tasks. It is not the planning/documents log for Claude Cowork.

Current product, plan, launch, roadmap, and document status lives in `docs/MASTER_INDEX.md`. Entries below are a chronological technical record and may describe findings or priorities that were later resolved.

## Operating Rule For Codex

At the end of each meaningful Codex coding session, update this file with:

- Code changes made
- Files changed
- Verification run
- Known failures or test drift
- Open technical risks
- Recommended next code step

Do not include secrets, `.env` values, tokens, database credentials, or customer/client private data.

## Product Decision Note - 2026-06-24

- Saved the post-beta NMI Billing API / Portal concept in `docs/PROJECT_DECISIONS.md`.
- Direction: NMI-focused billing portal/API with a Stripe-inspired developer experience, not a literal Stripe clone.
- Concept: ScaleSafe can provide checkout sessions, billing management sessions, subscription status, external customer mapping, merchant webhooks, and evidence logging for merchants who want NMI-powered subscription management inside their own software.
- Security posture: merchant apps never receive card/bank data, NMI keys, Supabase keys, or service-role credentials; merchant backend requests short-lived scoped billing sessions after authenticating its own user.
- Scope: post-beta only. V1 should stay NMI-only and narrow: checkout session, billing session, payment-method update, cancel/request-cancel, subscription status, webhooks, and evidence logging.
- Deferred consideration: service integration with Polar or a similar international tax/VAT/GST support layer if this becomes SaaS billing infrastructure for merchants with global customers.

## Current Build Context

- Product: ScaleSafe V2, a GHL Marketplace app for evidence-powered chargeback defense.
- Stack: Express + TypeScript backend, Vue 3 + Vite UI, Supabase, Railway, GHL OAuth/SSO, NMI test mode, Stripe sandbox/connect testing.
- Treat historical real test data as sensitive.
- Current priority: security hardening before feature expansion.
- Philip clarified on 2026-04-30 that Make.com is not current architecture and is not a future option. Treat any Make.com references in older plans, archived docs, or historical V1 material as stale unless Philip explicitly says otherwise.

## Codex Changes

### 2026-09-04: Fable Payment/Security Reconciliation + Schema 112 Certification (Codex)

Summary:

- Reproduced and reconciled the confirmed Fable payment, webhook, dunning, and lifecycle findings into `codex/command-center-release-candidate`.
- Added migration 112 so enrollments, payment events, and stored payment methods retain an immutable exact processor configuration. Backfill occurs only when ownership is unambiguous; active ambiguous recurring records block rollout.
- Propagated exact processor configuration identity through checkout, pay-first enrollment, Stripe ACH, Stripe and NMI callbacks, payment-method storage, recurring reconciliation, dunning, and pause/resume/cancel/complete actions.
- Corrected Stripe partial-invoice counting and recurring PaymentIntent behavior, restored complete dunning-recovery side effects, hardened NMI pending-settlement and stale-failure handling, and kept Whop cancellation provider-backed.
- Added a read-only aggregate production preflight and rollback-only migration verifier. Neither returns customer data or mutates production.

Verification:

- Focused payment and migration coverage: 16 suites, 180 tests passed.
- Full backend suite: 210 suites, 1,768 tests passed.
- TypeScript, Vite production build, UI asset copy, and `git diff --check` passed.
- Fresh isolated schema 111 preflight returned `ready`; migration 112, the rollback-only verifier, and the schema 112 Command Center catalog gate passed on the loopback-only VPS database.
- The exact production project `zddyagfotdtfbcdursqu` was confirmed at schema 106. The checksum-verified direct PostgreSQL catalog checker enforced read-only transaction settings, returned `COMMAND_CENTER_PRE_MIGRATION_CATALOG_PASSED`, and rolled back.

Release boundary:

- Implementation commit: `adff345`.
- No production SQL, deployment, external configuration, `main` merge, or `main` push occurred.
- The read-only production preflight is complete. Next step is reconciliation of the final independent read-only Fable review, followed by explicit owner approval for the bounded migration and default-off deployment.

### 2026-08-18: Stripe Live Cutover Guardrails + Gated Test Access (Codex)

Summary:

- Added migration 106 for exact-location approval of the no-cost Marketplace plan and persisted Stripe connection mode.
- Added HQ controls to approve or revoke no-cost access without exposing a public code or browser-controlled bypass.
- Added a required backend-only `STRIPE_LIVE_MODE` guard. Stripe OAuth, payment actions, disputes, refunds, evidence uploads, risk operations, and webhooks reject missing or mismatched connection modes.
- Merchant settings use a generic `Reconnect Required` state for stale Stripe connections; there is no merchant-facing test/live selector or badge.
- Audited Stripe's external configuration read-only. The live connected-account destination had 13 events and the sandbox destination had 14, while current ScaleSafe code requires 17. The live destination was missing `payment_intent.processing`, `payment_intent.payment_failed`, `setup_intent.succeeded`, `setup_intent.setup_failed`, and `charge.refunded`. The live OAuth redirect still used the retired Railway hostname. No external setting was changed during the audit.
- Strengthened webhook registration coverage to assert the exact 17-event contract.

Verification:

- Full backend suite passed: 168 suites, 1,385 tests.
- Stripe connection contract test passed: 13 tests.
- `npm.cmd run typecheck`, UI production build, asset copy, and `git diff --check` passed.

Deployment gate:

- Migration 106 must be reviewed and applied before the new code deploys.
- Deploy first with the existing Stripe test values and `STRIPE_LIVE_MODE=false`.
- Before the live cutover, replace the live OAuth redirect with `https://dashboard.scalesafe.app/auth/stripe/callback` and align the live connected-account webhook destination to the 17-event code contract.
- Switch the four Railway Stripe credentials and `STRIPE_LIVE_MODE=true` together. Existing sandbox connections must reconnect; never copy their account IDs or webhook secrets into live mode.

### 2026-05-13: Trigger Wiring Audit + Health Visibility (Codex)

Files changed:

- `src/constants/trigger-contracts.ts`
- `src/services/trigger.service.ts`
- `src/services/trigger-health.service.ts`
- `src/services/merchant.service.ts`
- `src/services/defense.service.ts`
- `src/controllers/dashboard.controller.ts`
- `src/controllers/payment-management.controller.ts`
- `src/controllers/payment-update.controller.ts`
- `src/controllers/send-link.controller.ts`
- `src/controllers/webhook.controller.ts`
- `src/ui/src/views/SettingsView.vue`
- `supabase/migrations/060_trigger_delivery_no_subscription.sql`
- `tests/unit/trigger.service.test.ts`
- `tests/unit/defense.service.test.ts`
- `tests/unit/trigger-contracts.test.ts`

Summary:

- Added a trigger contract registry for all Marketplace trigger keys, including owner, source, audience, beta status, firing path, and required payload fields.
- `triggerService.fireTrigger` now records a visible `trigger_delivery_logs` row with `status = no_subscription` whenever the app fires a trigger that has no active GHL workflow subscription.
- Moved defense workflows off the old `notificationService` path. `ss_chargeback_detected` and `ss_defense_ready` now use the same modern `triggerService` + `trigger_delivery_logs` path as the rest of the app.
- Added trigger health to Settings > Provisioning Health: active subscription counts, last sent/failed/no-subscription times, and separate field-automation visibility for At Risk/Re-Engaged (`contact.ss_engagement_status`).
- Enriched sparse workflow payloads for refund, milestone reached/signed off, pause/resume, cancellation, program completion, and send-link paths with IDs, program names, processor/subscription details where available.

SQL required:

- Run `supabase/migrations/060_trigger_delivery_no_subscription.sql` in Supabase so `trigger_delivery_logs.status` accepts `no_subscription`.

Verification:

- `npm.cmd run typecheck` passed.
- `npm.cmd test -- --runInBand tests/unit/trigger.service.test.ts tests/unit/defense.service.test.ts tests/unit/trigger-contracts.test.ts` passed.

Next proof:

- After SQL + deploy, run Provisioning Health and inspect Trigger Health.
- Retest refund, milestone mark-complete/signoff, payment reminder, pulse due, and a defense packet so each beta-critical workflow has either `sent / 201` or an obvious `no_subscription` row.

### 2026-05-13: Refund + Milestone Workflow Recovery (Codex)

Files changed:

- `src/controllers/payment-management.controller.ts`
- `src/services/payment-lifecycle.service.ts`
- `src/controllers/dashboard.controller.ts`
- `src/ui/src/views/client-profile/ProgramsTab.vue`
- `src/utils/nmi.utils.ts`
- `tests/unit/nmi.client.test.ts`
- `docs/BETA_TESTING_ISSUE_TRACKER.md`
- `docs/CLAUDE_CODE_CODEX_LOG.md`

Summary:

- Repaired Beta Tester 2 missed NMI recurring charge after fixing NMI Query parsing for multi-action transaction responses.
- Manual refunds from Payment Management now only log refund events after processor success and now fire `ss_refund_processed` with refund amount/date/transaction id data.
- Milestone mark-complete now creates a signed milestone sign-off link, syncs milestone workflow contact fields, includes sign-off link aliases in the trigger payload, and updates the UI immediately after success.
- Added `docs/BETA_TESTING_ISSUE_TRACKER.md` so live beta failures and retest items are tracked explicitly.

Verification:

- `npm.cmd run typecheck` passed.
- `npm.cmd test -- --runInBand tests/unit/nmi.client.test.ts tests/unit/nmi-silent-post.controller.test.ts` passed.
- `npm.cmd run build` passed.

Known live retests:

- Philip is running a new 3-payment NMI installment test. Expected: recurring payment posts automatically without manual repair.
- Retest refund workflow: refund action should create a trigger delivery for `ss_refund_processed` and send the client notification.
- Retest milestone workflow: Mark Complete should advance UI state and fire the milestone sign-off request workflow with a usable sign-off link.

### 2026-05-11: Tracking ID First-Class Ledger Filter (Codex)

Files changed:

- `src/controllers/payment-management.controller.ts`
- `src/services/payment-ledger.service.ts`
- `src/ui/src/views/PaymentSearch.vue`
- `tests/unit/payment-ledger.service.test.ts`
- `docs/CLAUDE_CODE_CODEX_LOG.md`

Summary:

- Promoted offer Tracking ID from a small sublabel under Program to its own All Payments ledger column.
- Added a dedicated Tracking ID filter on Payments > All Payments so merchants can report by salesperson, campaign, source, or internal reference without mixing it into the broad client/program search box.
- The backend now accepts `trackingId` on the payment ledger endpoint and prefilters by matching `offers_mirror.tracking_id`.
- Added unit coverage proving a ledger query filtered by Tracking ID returns the matching payment row and excludes nonmatching tracking IDs.

Verification:

- `npm.cmd test -- --runInBand tests/unit/payment-ledger.service.test.ts` passed: 1 suite, 5 tests.

Roadmap note:

- Added "Stripe monetization / connected-account revenue" to the Cowork roadmap as strategy-needed, post-beta direction. This is not beta scope.

### 2026-05-11: Phase 4B Payment Display Truth + Tracking ID (Codex)

Files changed:

- `supabase/migrations/057_offer_tracking_id.sql`
- `src/services/payment-ledger.service.ts`
- `src/services/payment-reconciliation.service.ts`
- `src/controllers/dashboard.controller.ts`
- `src/repositories/offer.repository.ts`
- `src/services/offer.service.ts`
- `src/jobs/recurring-billing.ts`
- `src/ui/src/views/OfferFormView.vue`
- `src/ui/src/views/OffersView.vue`
- `src/ui/src/views/PaymentSearch.vue`
- `src/ui/src/views/PaymentManagement.vue`
- `src/ui/src/views/client-profile/PaymentsTab.vue`
- `tests/unit/payment-ledger.service.test.ts`
- `tests/unit/payment-reconciliation.service.test.ts`
- `tests/unit/offer.service.test.ts`
- `docs/CLAUDE_CODE_CODEX_LOG.md`

Summary:

- Completed Phase 4B cleanup so payment reporting does not pretend an unlinked payment belongs to the newest client program.
- Payment ledger rows now only show a program when the payment event is directly tied by `enrollment_id` or `offer_id`; otherwise they show `Unassigned payment` while still using the contact enrollment only for customer name/email display.
- Payment reconciliation now follows the same rule for unassigned payment issues, duplicate transaction issues, missing transaction IDs, and recent failures.
- Added optional `offers_mirror.tracking_id` for internal salesperson/campaign/reference tracking. Offer create/edit/list screens support it, and ledger search/results can use/display it.
- Improved recurring plan cards in Payment Management and client profile Payments so they show processor, subscription ID, status, matching card/vault when known, and a warning when controls cannot be fully verified because the processor subscription ID is missing.
- Confirmed current code paths for upcoming payment reminders and pulse cadence: reminders run for 3-day and 1-day windows; pulse cadence fires the shared `ss_app_event` trigger with `event_type = pulse_check_due`.

Verification:

- `npm.cmd test -- --runInBand tests/unit/payment-ledger.service.test.ts tests/unit/payment-reconciliation.service.test.ts tests/unit/offer.service.test.ts` passed: 3 suites, 19 tests.
- `npm.cmd run typecheck` passed.
- `npm.cmd run build` passed.
- `npm.cmd test -- --runInBand` passed: 52 suites, 536 tests.

Deployment note:

- Apply migration `057_offer_tracking_id.sql` before relying on the new Tracking ID field in production. The app has compatibility fallbacks so offer saves should still work before the migration, but the field will not persist until the column exists.

Next proof:

- After deploy and migration, create/edit an offer with a Tracking ID and confirm it appears in Offers and Payments > All Payments.
- In PMG live testing, confirm unlinked/manual/noise payment events show as `Unassigned payment` rather than borrowing a program.
- Continue Phase 5 live workflow proof: Welcome, Enrollment Payment Receipt, Recurring Payment Receipt, failed payment, NMI second installment, Stripe final installment keeping program active, and upcoming payment reminder delivery.
- Continue Phase 6 pulse proof: force a due pulse, confirm `ss_app_event` delivery, and submit SYS2-09 with `enrollment_id` to confirm `pulse_checkin` evidence links to the enrollment.

### 2026-05-11: Payment Ledger Load Guard + Date Filters (Codex)

Files changed:

- `src/services/payment-ledger.service.ts`
- `src/controllers/payment-management.controller.ts`
- `src/ui/src/views/PaymentSearch.vue`
- `tests/unit/payment-ledger.service.test.ts`
- `docs/CLAUDE_CODE_CODEX_LOG.md`

Summary:

- Fixed the live Payments > All Payments blank/error path by making the ledger service fall back to the older stable `payment_events` and `enrollments` column sets if Supabase/PostgREST reports a missing optional column from the newer reporting metadata.
- Follow-up same day: production PMG also lacked `payment_events.payments_remaining`, so the ledger now has a third minimal `payment_events` fallback that omits payment-counter columns and still loads rows with `paymentsRemaining = null`.
- Ledger endpoint now logs the root error and returns a clearer load message instead of only surfacing the global generic "unexpected error" message.
- Added `From` and `To` date filters to the All Payments ledger UI. The frontend sends local start/end-of-day ISO timestamps to the existing backend `from`/`to` filters.
- Added a unit test proving the ledger still returns rows when optional ledger columns such as `customer_email` and `payments_remaining` are not deployed yet.

Verification:

- `npm.cmd run typecheck` passed.
- `npm.cmd test -- --runInBand tests/unit/payment-ledger.service.test.ts` passed: 1 suite, 3 tests.
- `npm.cmd run build` passed.

Next proof:

- After deploy, reload Payments > All Payments. Expected: ledger rows load instead of "unexpected error"; date filters should narrow the visible rows.

### 2026-05-11: Align Payment Ledger With Live `payment_events` Schema (Codex)

Files changed:

- `src/services/payment-ledger.service.ts`
- `src/repositories/paymentEvent.repository.ts`
- `src/services/recurring-payment.service.ts`
- `tests/unit/payment-ledger.service.test.ts`
- `tests/unit/recurring-payment.service.test.ts`
- `docs/CLAUDE_CODE_CODEX_LOG.md`

Summary:

- Philip's live Supabase column inventory showed `payment_events` has `payment_number` and `payments_total`, but not `payments_remaining`.
- Updated the ledger to select `payments_total` and compute `paymentsRemaining = payments_total - payment_number` in application code.
- Updated recurring payment event writes to store `payments_total` instead of trying to insert the missing `payments_remaining` column.
- Updated the shared payment event repository so older callers that still pass `payments_remaining` are translated into `payments_total` when `payment_number` is available.
- Workflow/evidence payloads still include `payments_remaining`; only the DB storage shape changed.

Verification:

- `npm.cmd run typecheck` passed.
- `npm.cmd test -- --runInBand tests/unit/payment-ledger.service.test.ts tests/unit/recurring-payment.service.test.ts` passed: 2 suites, 5 tests.
- `npm.cmd run build` passed.

Next proof:

- After deploy, Payments > All Payments should load without needing the minimal fallback. New recurring payment event rows should insert cleanly against the live PMG schema.

### 2026-05-10: Phase 1 Payment Truth + Recurring Lifecycle Correctness (Codex)

Files changed:

- `supabase/migrations/056_payment_truth_fields.sql`
- `src/services/recurring-payment.service.ts`
- `src/services/phase2Enrollment.service.ts`
- `src/controllers/stripe-webhook.controller.ts`
- `src/controllers/nmi-silent-post.controller.ts`
- `src/jobs/recurring-billing.ts`
- `src/jobs/pif-completion-check.ts`
- `src/controllers/checkout.controller.ts`
- `src/controllers/query-url.controller.ts`
- `src/services/payment-lifecycle.service.ts`
- `src/routes/payment-lifecycle.routes.ts`
- `src/services/offer.service.ts`
- `src/ui/src/views/OfferFormView.vue`
- Repository/type files and focused tests.

Summary:

- Added explicit payment truth fields: `enrollments.processor_type`, `enrollments.billing_completed_at`, and `offers_mirror.auto_complete_on_duration_end`.
- Final finite installment payments now mark billing complete, clear `next_billing_date`, and keep the program/enrollment active. They no longer set `status = completed`, no longer set `completed_at`, no longer disable pulse cadence, and no longer fire `ss_program_completed`.
- `ss_payment_received` still fires on final installment with `payments_remaining: 0`.
- Stripe `customer.subscription.deleted` after a paid-off finite installment is treated as expected processor cleanup, not a cancellation.
- Checkout, Quick Pay, processor-native recurring handlers, fallback cron, dunning retry, and lifecycle controls now preserve/use processor attribution instead of falling back blindly to merchant default.
- NMI Silent Post verification now forces NMI processor resolution and uses the offer NMI processor id when present.
- Duration-based program completion is now opt-in via offer setting `Mark program complete when duration ends`; default is unchecked.

Verification:

- `npm.cmd run typecheck` passed.
- `npm.cmd test -- --runInBand tests/unit/recurring-payment.service.test.ts tests/unit/nmi-silent-post.controller.test.ts` passed: 2 suites, 6 tests.
- `npm.cmd run build` passed.
- `npm.cmd test -- --runInBand` passed: 50 suites, 529 tests.

Next proof:

- Apply migration `056_payment_truth_fields.sql` in Supabase/Railway.
- Let the current daily Stripe and NMI installment tests run their second payments. Expected: `payments_made = 2`, `billing_completed_at` set, `next_billing_date = null`, program remains enrolled/active with milestones intact, and no `ss_program_completed` trigger from billing payoff.

### 2026-05-11: Phase 2 Payment Ledger + Reporting Visibility (Codex)

Files changed:

- `src/services/payment-ledger.service.ts`
- `src/controllers/payment-management.controller.ts`
- `src/routes/payment-management.routes.ts`
- `src/controllers/dashboard.controller.ts`
- `src/controllers/checkout.controller.ts`
- `src/ui/src/views/PaymentSearch.vue`
- `src/ui/src/views/PaymentManagement.vue`
- `src/ui/src/views/client-profile/PaymentsTab.vue`
- `tests/unit/payment-ledger.service.test.ts`

Summary:

- Added a tenant-scoped payment ledger service and SSO-gated endpoint: `GET /api/payments/manage/ledger`.
- Ledger rows now enrich `payment_events` with client name/email, offer/program, billing type, processor, source, recurring/final-payment context, transaction id, and subscription id.
- Rebuilt the Payments page into two tabs:
  - `All Payments`: date-ordered ledger with search, processor, billing type, status filters, summary totals, pagination, and links into per-client payment management.
  - `Clients`: existing client payment search, preserved.
- Updated per-client payment history and client profile Payments tab to show program, billing type, processor, and final installment context instead of only generic "Charge".
- Card-on-file labels now include processor context, e.g. Stripe Visa or NMI card on file. The per-client payment page also states that card update links replace the current default card.
- Initial checkout payment events now store `offer_id`, `customer_email`, `source = checkout`, and `is_recurring = false` when available so new ledger rows attribute more cleanly.
- Manual stored-card charges now use the selected card's processor rather than merchant default. Manual refunds now use the original payment event's processor and carry through enrollment/offer/source metadata.

Verification:

- `npm.cmd run typecheck` passed.
- `npm.cmd test -- --runInBand tests/unit/payment-ledger.service.test.ts tests/unit/nmi-silent-post.controller.test.ts tests/unit/recurring-payment.service.test.ts` passed: 3 suites, 8 tests.
- `npm.cmd run build` passed.
- `npm.cmd test -- --runInBand` passed: 51 suites, 531 tests.

Next proof:

- After deploy, open `Payments > All Payments` in PMG and confirm recent Stripe/NMI PIF, installment, subscription, refund, and failed-payment rows show the correct program and processor.
- Let the current daily NMI/Stripe installment tests post again, then verify the ledger and the client Payments tab show second-payment/final-payment context while the program remains active.

### 2026-05-08: Suppress Checkout-Triggered Re-Engagement + PIF Installment Clause (Codex)

Files changed:

- `src/services/phase2Enrollment.service.ts`
- `src/services/evidence.service.ts`
- `src/widgets/offer-review/index.html`
- `src/widgets/consent-capture/index.html`
- `docs/CLAUDE_CODE_CODEX_LOG.md`

Summary:

- Philip's paid Stripe test proved workflow fields now render, but also sent the "welcome back" re-engagement email during a normal checkout.
- Root cause: normal enrollment completion was writing `ss_engagement_status = Active`, and evidence re-engagement logic also treated payment/enrollment evidence as re-engagement. That can fire GHL Contact Field Changed workflows even though the client did not actually re-engage through participation.
- Removed the normal enrollment-completion write to `ss_engagement_status`.
- Narrowed re-engagement to participation-style evidence only: session delivery, module completion, pulse check-in, milestone completion, service access, external session, course completion, and assignment submission. Payment/enrollment evidence no longer flips re-engagement.
- Offer review now stores the selected PIF/installment choice in app-origin session storage.
- Consent capture now reads that payment choice and hides the `installment_billing` clickwrap clause when the client chose PIF. If the client chooses installments, the installment clause still appears.

Verification:

- `npm.cmd run typecheck` passed.
- `npm.cmd test -- --runInBand --testPathPatterns=evidence.service` passed: 1 suite, 16 tests.
- `npm.cmd test -- --runInBand --testPathPatterns=phase2Enrollment` passed: 2 suites, 16 tests.
- `npm.cmd run build` passed.

Next proof:

- After deploy, run a fresh paid PIF enrollment. Expected: Welcome/Receipt fields render, no "welcome back" email, and the terms step should not show the installment-billing acknowledgement for PIF.

### 2026-05-08: Stripe Agent Toolkit Research Pointer (Codex)

Files changed:

- `docs/CLAUDE_CODE_CODEX_LOG.md`

External Cowork docs changed:

- `C:\Users\p_kor_e1dk2i3\OneDrive\Documents\Claude\Projects\ScaleSafe\docs\STRIPE_AGENT_TOOLKIT_RESEARCH.md`
- `C:\Users\p_kor_e1dk2i3\OneDrive\Documents\Claude\Projects\ScaleSafe\docs\FEATURE_LEDGER.md`
- `C:\Users\p_kor_e1dk2i3\OneDrive\Documents\Claude\Projects\ScaleSafe\CLAUDE_COWORK_CODEX_LOG.md`

Summary:

- Researched Stripe Agent Toolkit / Stripe MCP from primary Stripe docs and Stripe's `stripe/ai` repository.
- Saved the strategy note in the Cowork roadmap docs as a future product lane, not beta scope.
- Recommendation: use Stripe Toolkit/MCP as a Stripe adapter behind ScaleSafe-controlled backend tools for internal ops, sandbox testing, and future merchant command flows. Do not expose broad Stripe tools directly to merchant prompts.

Verification:

- Docs-only update; no code tests run.

### 2026-05-08: GHL Contact Field Updates Must Use Field IDs (Codex)

Files changed:

- `src/clients/ghl.client.ts`
- `docs/CLAUDE_CODE_CODEX_LOG.md`

Summary:

- Philip confirmed the live Welcome/Receipt emails were still blank even though triggers sent successfully.
- Direct GHL inspection showed PMG's fields exist but the test contact still had empty values. A direct GHL test confirmed `customFields: [{ id, field_value }]` populates the field, while the app's key-based update shape could return success without writing values.
- Updated the shared GHL API client so every existing `api.put('/contacts/:id', { customField: ... })` call resolves `contact.*` field keys to GHL custom-field IDs and sends `{ id, field_value }`.
- This fixes the field-write layer globally for enrollment, recurring payment, failed payment, refund, defense, and other contact custom-field sync paths that use the shared client.

Verification:

- Direct GHL API proof on PMG test contact: writing by custom-field ID populated `Offer Program Name`.
- `npm.cmd run typecheck` passed.
- `npm.cmd test -- --runInBand --testPathPatterns=phase2Enrollment` passed.
- `npm.cmd run build` passed.

Next proof:

- After deploy, run a fresh enrollment. The contact fields should populate before `enrollment_complete` fires, and Welcome/Receipt emails should no longer render blank merge fields.

### 2026-05-08: Stale Inactive GHL Trigger Subscriptions Auto-Deactivate (Codex)

Files changed:

- `src/services/trigger.service.ts`
- `tests/unit/trigger.service.test.ts`
- `docs/CLAUDE_CODE_CODEX_LOG.md`

Summary:

- Philip's trigger delivery log showed successful current `enrollment_complete` sends, plus an old GHL Marketplace trigger execution URL failing with `Trigger with id: BshBp7eq3VuKjlecHdsT is inactive. Skipping execution`.
- Updated trigger delivery so when GHL reports a Marketplace trigger execution URL as inactive, ScaleSafe stops retrying that dead URL and marks the matching `trigger_subscriptions` row inactive locally.
- Result: future workflow logs should stay cleaner and stale GHL trigger URLs should not keep producing repeated failed attempts.

Verification:

- `npm.cmd test -- --runInBand --testPathPatterns=trigger.service` passed.
- `npm.cmd run typecheck` passed.
- `npm.cmd run build` passed.

### 2026-05-08: PMG Repair Fields Succeeded (Philip Manual Validation)

Summary:

- Philip ran the new Provisioning Health field repair in PMG and reported that it appears to have worked.
- Next proof is live workflow rendering, not more field creation: run free, installment, and subscription enrollments and confirm Welcome, Enrollment Payment Receipt, and Recurring Payment Receipt emails render the repaired contact fields.

Recommended next step:

- Query/inspect `trigger_delivery_logs` after each enrollment and compare against the received email/SMS body.

### 2026-05-08: Provisioning Health Repair Fields Visibility Fix (Codex)

Files changed:

- `src/ui/src/views/SettingsView.vue`
- `docs/CLAUDE_CODE_CODEX_LOG.md`

Summary:

- Philip's PMG screenshot showed the new backend field-health check (`6/85 beta ScaleSafe contact fields are missing`) but did not show the new top-level `Repair Fields` button in the GHL iframe.
- Kept the header button and added a second `Repair Fields` button directly on the `ScaleSafe contact fields` warning row. The header button group now wraps instead of clipping.

Verification:

- `npm.cmd run typecheck` passed.
- `npm.cmd run build` passed.

### 2026-05-08: Workflow-Compatible GHL Field Registry + Repair Path (Codex)

Files changed:

- `src/constants/ghl-fields.ts`
- `src/services/merchant.service.ts`
- `src/controllers/merchant.controller.ts`
- `src/routes/merchant.routes.ts`
- `src/ui/src/views/SettingsView.vue`
- `src/services/phase2Enrollment.service.ts`
- `src/services/enrollment.service.ts`
- `src/services/recurring-payment.service.ts`
- `src/services/payment-lifecycle.service.ts`
- `tests/unit/merchant.service.test.ts`
- `docs/WORKFLOW_FIELD_CONTRACT_MATRIX.md`
- `docs/GHL_WORKFLOW_TEMPLATE_REPAIR_PLAN.md`
- `docs/GHL_BETA_SNAPSHOT_EXECUTION_PLAN.md`
- `docs/GHL_AUTOMATION_COMPANION.md`
- `docs/ghl-custom-fields-reference.md`

Summary:

- Superseded the 2026-05-07 "canonical fields only" direction. For beta, Philip decided the current GHL workflows win so he does not have to manually rebuild every email/SMS template before snapshot.
- Added a beta custom-field registry in `src/constants/ghl-fields.ts` that includes canonical app fields plus workflow-compatible aliases such as `contact.offer_program_name`, `contact.offer_price_display`, `contact.offer_number_of_payments`, and `contact.offer_support_email`.
- Updated merchant provisioning/custom-field repair to create missing approved beta fields, report already-existing fields, and return ScaleSafe-owned delete candidates as a dry run. Custom values are not part of this cleanup pass.
- Added protected endpoints and a Settings > Provisioning Health "Repair Fields" action so PMG and fresh installs can create missing workflow-compatible fields without changing `snapshot_status`.
- Updated enrollment, recurring payment, failed payment, refund, and payment lifecycle paths to sync the workflow-compatible contact fields before GHL workflow triggers fire.
- No GHL fields are deleted automatically. The cleanup endpoint only deletes candidates when explicitly called with `confirmDelete: true`; the UI exposes repair, not delete.

Verification:

- `npm.cmd run typecheck` passed.
- `npm.cmd test -- --runInBand --testPathPatterns=ghl-fields` passed.
- `npm.cmd test -- --runInBand --testPathPatterns=merchant.service` passed.
- `npm.cmd test -- --runInBand` passed: 49 suites, 526 tests.
- `npm.cmd run build` passed.

Next manual beta check:

- After deploy, run Settings > Provisioning Health > Repair Fields in PMG, then run free/installment/subscription enrollments and confirm Welcome, Enrollment Payment Receipt, and Recurring Payment Receipt render values.

### 2026-05-07: Workflow Template Repair Plan Expanded From Source DOCX (Codex)

Files changed:

- `docs/GHL_WORKFLOW_TEMPLATE_REPAIR_PLAN.md`
- `docs/CLAUDE_CODE_CODEX_LOG.md`
- Cowork log / feature ledger notes in `C:\Users\p_kor_e1dk2i3\OneDrive\Documents\Claude\Projects\ScaleSafe`

Summary:

- Codex extracted merge fields from the actual Claude/Oke DOCX workflow sources instead of asking Philip to manually audit every workflow.
- Added a concrete workflow-by-workflow repair list showing which fields are stale, which app fields are written before triggers, and which `contact.ss_*` fields are not safe because the current app sends event payloads but does not write those GHL contact fields.
- Key correction: Welcome and Enrollment Payment Receipt can be fixed cleanly with canonical offer fields. Recurring receipt, failed payment, refund, milestone, and defense workflows need either trigger-variable templates or app-side contact field sync before those workflows can be considered beta-clean.
- HighLevel's Marketplace trigger docs confirm trigger payload data can be configured as workflow custom variables, but GHL API access available here still does not expose/edit the live email/SMS action bodies. Remaining GHL UI work is execution only: paste the repaired template fields/copy, not manual analysis.

Verification:

- Docs-only update; no code/tests run.

### 2026-05-07: Workflow Field Contract Audit + Canonical Cleanup (Superseded 2026-05-08)

Files changed:

- `src/services/phase2Enrollment.service.ts`
- `docs/WORKFLOW_FIELD_CONTRACT_MATRIX.md`
- `docs/GHL_BETA_SNAPSHOT_EXECUTION_PLAN.md`
- `docs/GHL_AUTOMATION_COMPANION.md`
- `docs/ghl-custom-fields-reference.md`
- `tests/integration/trigger.integration.test.ts`
- Cowork docs/logs in `C:\Users\p_kor_e1dk2i3\OneDrive\Documents\Claude\Projects\ScaleSafe`

Summary:

- Live PMG GHL audit returned 118 custom fields and 22 custom values. The old workflow DOCX guide used merge fields that do not exist in live PMG: `contact.offer_program_name`, `contact.offer_price_display`, `contact.offer_number_of_payments`, and `contact.offer_support_email`.
- Superseded on 2026-05-08: beta direction changed to current workflows win. The app now provisions and writes workflow-compatible alias fields instead of requiring Philip to manually rebuild every workflow body before snapshot.
- Added `docs/WORKFLOW_FIELD_CONTRACT_MATRIX.md` with canonical field mapping, immediate PMG workflow template edits, review fields, and snapshot gate.
- Removed the temporary alias writes from `phase2Enrollment.service.ts` while keeping the useful timing fix: canonical GHL contact fields still sync before workflow triggers can fire.
- Updated the trigger integration test to expect the current normalized trigger payload (`event_type`, `location_id/locationId`, and camel/snake aliases), and to accept `trigger_delivery_logs` inserts in its Supabase mock.
- Updated snapshot/provisioning docs and Cowork tracking so future agents do not revive the alias fields or create more duplicate PMG custom fields.

Verification:

- `npm.cmd run typecheck` passed.
- `npm.cmd test -- --runInBand --testPathPatterns=phase2Enrollment` passed: 2 suites, 16 tests.
- `npm.cmd test -- --runInBand` passed: 49 suites, 526 tests.
- `npm.cmd run build` passed.
- Manual GHL template rewrite is no longer the beta path. Run the Repair Fields action, then validate rendered emails/SMS with live enrollments.

### 2026-05-06: Shared Marketplace App Event Trigger Created Manually (Philip)

GHL Marketplace setup completed manually by Philip:

- New shared trigger: `ss_app_event` / ScaleSafe App Event.
- Subscription URL: `https://dashboard.scalesafe.app/webhooks/ghl/triggers`.
- Filter created:
  - Name: Event Type
  - Type: Select
  - Required: Yes
  - Reference: `event_type`
  - Option type: Constants
- Constants published:
  - Pulse Check Due = `pulse_check_due`
  - Upcoming Payment Reminder = `upcoming_payment_reminder`
  - Client At Risk = `client_at_risk`
  - Card Update Needed = `card_update_needed`
  - Client Reengaged = `client_reengaged`
  - Evidence Milestone = `evidence_milestone`
  - Chargeback Ratio Warning = `chargeback_ratio_warning`
  - Chargeback Ratio Critical = `chargeback_ratio_critical`
  - Defense Ready = `defense_ready`
  - Program Completed = `program_completed`

Purpose:

- Preserve scarce Marketplace trigger slots by using one generic trigger as a multi-event bus.
- Immediate beta use is pulse cadence: `SS - Pulse Check Due` should listen to `ss_app_event` with filter `Event Type = Pulse Check Due`.
- Future consolidation can move other app-driven notification events onto this trigger by filtering on `event_type`.

Code still needed:

- Add `ss_app_event` to `src/constants/trigger-keys.ts`.
- Change `src/jobs/pulse-cadence-check.ts` to call `triggerService.fireTrigger(locationId, 'ss_app_event', payload)` instead of requiring a per-location inbound webhook URL.
- Remove/defer reliance on `ScaleSafe Pulse Workflow Webhook URL` for beta pulse sends.

### 2026-05-05: GHL Marketplace Trigger Subscription Payload Fix (Codex)

Files changed:

- `src/controllers/trigger.controller.ts`
- `src/routes/webhook.routes.ts`
- `tests/unit/trigger.controller.test.ts`
- `docs/CLAUDE_CODE_CODEX_LOG.md`

Summary:

- Philip created the missing `trigger_subscriptions` table, but re-saving/publishing a GHL workflow using `enrollment_complete` still produced no subscription rows.
- Root cause found against current HighLevel Marketplace Trigger docs: the subscription URL payload is not the older/simple `{ type, locationId, triggerKey, subscriptionUrl }` shape. Current payload sends `triggerData.eventType` (`CREATED` / `UPDATED` / `DELETED`), `triggerData.key`, `triggerData.targetUrl`, and `extras.locationId`.
- Updated `triggerController.handleSubscription` to normalize both shapes.
- Removed official GHL webhook signature middleware from `/webhooks/ghl/triggers`. This route is the Marketplace workflow-trigger subscription lifecycle endpoint, not the official signed payment/platform webhook stream. `/webhooks/ghl/payment` remains signed.

Verification:

- `npm.cmd run typecheck` passed.
- `npm.cmd test -- --runInBand --testPathPatterns=trigger.controller` passed: 1 suite, 2 tests.

### 2026-05-05: Offer Save Compatibility For Daily/Pulse Test Fields (Codex)

Files changed:

- `src/services/offer.service.ts`
- `docs/CLAUDE_CODE_CODEX_LOG.md`

Summary:

- Philip reported that after `Daily (Testing)` appeared, editing Stripe/NMI offers and creating a new offer all returned "An unexpected error occurred."
- Added a compatibility retry for offer create/update when Supabase reports missing pulse cadence columns (`pulse_cadence_enabled` / `pulse_frequency_days`). The retry strips those fields so offer saves are not fully blocked while migration 053 is being applied.
- Kept the daily frequency database protection explicit: if migration 054 is missing, daily saves return a `ValidationError` message telling the operator to apply the latest daily billing test migration.
- For daily test offers only, if GHL rejects creation of a daily recurring Product price, ScaleSafe logs a warning and still saves the offer. ScaleSafe checkout/recurring billing uses the offer record and processor subscription logic, not the GHL Product price, so this keeps test cadence unblocked.

Verification:

- `npm.cmd run typecheck` passed.

### 2026-05-05: Daily Test Billing Railway Build Flag Fix (Codex)

Files changed:

- `Dockerfile`
- `docs/CLAUDE_CODE_CODEX_LOG.md`

Summary:

- Philip set `VITE_ENABLE_DAILY_TEST_BILLING=true`, pushed/reloaded, and `Daily (Testing)` still did not appear.
- Local verification proved the Vue/Vite gate works when the env var is present during `npm.cmd run build-ui`.
- Root cause: the Docker build ran `cd src/ui && npx vite build` without declaring/passing the Vite build-time flag, so Railway produced a frontend bundle with daily billing still compiled out.
- Added Docker `ARG VITE_ENABLE_DAILY_TEST_BILLING=false` and matching `ENV` before the Vite build step. Railway must have `VITE_ENABLE_DAILY_TEST_BILLING=true` set on the app service/environment before redeploying for the selector to show.

Verification:

- `npm.cmd run typecheck` passed.
- Local `build-ui` with `$env:VITE_ENABLE_DAILY_TEST_BILLING='true'` includes `Daily (Testing)` in the compiled OfferForm chunk.

### 2026-05-05: Daily Test Billing Save Fix + Durable Offer Link Policy (Codex)

Files changed:

- `supabase/migrations/054_daily_test_billing_frequency.sql`
- `.env.example`
- `src/ui/src/views/OfferFormView.vue`
- `src/services/offer.service.ts`
- `docs/GHL_BETA_SNAPSHOT_EXECUTION_PLAN.md`
- `docs/CLAUDE_CODE_CODEX_LOG.md`

Summary:

- Added migration 054 so `offers_mirror.installment_frequency` accepts `daily`. The daily save failure was caused by the DB CHECK constraint from migration 051 allowing quarterly/annual but not daily.
- Gated `Daily (Testing)` behind `VITE_ENABLE_DAILY_TEST_BILLING=true` so normal beta builds do not expose the testing cadence.
- Improved offer create/update error handling for the installment-frequency constraint: the API now returns a validation message instead of only a generic 500 if the migration is missing.
- Documented durable public offer-link policy: quick checkout links (`/quick-checkout?offerId=...`) and full enrollment funnel links (`/welcome?offerId=...`) must not expire by default. The signed 14-day tokens apply only to sensitive client action links (`payment_update`, `subscription_cancel`, `milestone_signoff`), not offer checkout/enrollment links.

Verification:

- `npm.cmd run typecheck` passed.
- `npm.cmd test -- --runInBand` passed (49 suites, 527 tests).
- `npm.cmd run build` passed.

### 2026-05-01: Daily Billing Frequency For Test Enrollments (Codex)

Files changed:

- `src/ui/src/views/OfferFormView.vue`
- `src/services/offer.service.ts`
- `src/types/processor.types.ts`
- `src/clients/stripe.client.ts`
- `src/clients/nmi.client.ts`
- `src/controllers/checkout.controller.ts`
- `src/services/phase2Enrollment.service.ts`
- `src/services/recurring-payment.service.ts`
- `src/services/payment-lifecycle.service.ts`
- `docs/CLAUDE_CODE_CODEX_LOG.md`

Summary:

- Added `Daily (Testing)` as an offer billing frequency for installments/subscriptions so Stripe sandbox and NMI tiny-charge recurring tests can complete without waiting a week/month.
- Wired `daily` through processor subscription creation: Stripe uses `interval: day`; NMI uses `day_frequency=1`.
- Wired `daily` through app-side next billing date calculations after enrollment completion, recurring success, and subscription resume.
- Also corrected related frequency pass-throughs in touched paths so quarterly/annual do not collapse to monthly in resume/subscription plumbing.

Verification:

- `npm.cmd run typecheck` passed.
- `npm.cmd test -- --runInBand` passed (49 suites, 527 tests).
- `npm.cmd run build` passed.

### 2026-05-01: Payment Reminder Trigger Payload Aliases (Codex)

Files changed:

- `src/jobs/payment-reminder-check.ts`
- `docs/CLAUDE_CODE_CODEX_LOG.md`

Summary:

- Expanded the `upcoming_payment_reminder` app-event payload so the GHL workflow has both flat fields and nested aliases.
- Flat fields now include `installment_amount`, `offer_name`, `next_billing_date`, `next_payment_number`, `payments_made`, `payments_total`, `payments_remaining`, `days_until_payment`, and `reminder_window`.
- Nested aliases now include `offer.name`, `offer.installment_amount`, and `subscription.next_billing_date` / `subscription.next_payment_number` / `subscription.payments_total` / `subscription.payments_made` / `subscription.payments_remaining`.
- Purpose: avoid ambiguity when building the GHL workflow. GHL can use whichever merge fields its custom trigger UI exposes from the sample event.

Philip/GHL action:

- Build the `ss_app_event` workflow filtered to `event_type = upcoming_payment_reminder`. The app controls timing. GHL only needs to send the message from trigger fields and can optionally branch on `reminder_window` (`three_day` vs `one_day`).

### 2026-05-01: Restore 3-Day + Add 1-Day Payment Reminders (Codex)

Files changed:

- `src/jobs/payment-reminder-check.ts`
- `docs/CLAUDE_CODE_CODEX_LOG.md`

Summary:

- Corrected the beta reminder behavior from "1-day only" to the standard two-touch sequence: 3 days before and 1 day before the next installment/subscription payment.
- Reused the shared `ss_app_event` trigger with `event_type = upcoming_payment_reminder` to avoid new GHL trigger subscriptions.
- Added payload fields `days_until_payment` (`3` or `1`) and `reminder_window` (`three_day` or `one_day`) so GHL can branch or use correct copy.

Philip/GHL action:

- Confirm the existing upcoming payment reminder workflow either uses dynamic copy from `days_until_payment` or branches on `reminder_window`.

### 2026-05-01: Pre-Snapshot Beta Lock Implementation (Codex)

Files changed:

- `supabase/migrations/053_pulse_cadence.sql`
- `src/services/merchant.service.ts`
- `src/controllers/merchant.controller.ts`
- `src/routes/merchant.routes.ts`
- `src/services/offer.service.ts`
- `src/services/phase2Enrollment.service.ts`
- `src/services/recurring-payment.service.ts`
- `src/services/evidence.service.ts`
- `src/controllers/webhook.controller.ts`
- `src/jobs/payment-reminder-check.ts`
- `src/jobs/pulse-cadence-check.ts`
- `src/index.ts`
- `src/ui/src/views/OfferFormView.vue`
- `src/ui/src/views/SettingsView.vue`
- `docs/GHL_BETA_SNAPSHOT_EXECUTION_PLAN.md`

Summary:

- Added installed-tenant repair action for PMG: `POST /api/merchants/provisioning-health/repair-webhook-secret` re-runs GHL custom value discovery/creation, maps `WEBHOOK_SECRET`, and pushes the existing per-merchant `merchants.webhook_secret` into `{{ custom_values.scalesafe_webhook_secret }}` even when `snapshot_status = installed`. Settings > Provisioning Health now has a Repair Webhook Secret button.
- Changed the payment reminder job from 3 days before billing to 1 day before billing. Existing successful recurring paths already fire `ss_payment_received`; final recurring completion now also disables future pulse cadence.
- Added app-owned pulse cadence: migration 053 adds offer/enrollment cadence fields and `evidence_pulse_checkins.enrollment_id`; Offer form exposes pulse enable/cadence; post-payment enrollment completion initializes `next_pulse_due_at`; a daily pulse job posts due enrollments to the configured GHL inbound-webhook workflow; SYS2-09 form webhooks carry `enrollment_id` into pulse evidence.
- Deferred GHL drift for beta: Offer Custom Object sync was disabled/removed from offer create/update; GHL Product/Price creation stays active. Provisioning and health no longer require the `Client Milestones` pipeline; app-native `enrollments.current_milestone` remains the beta source of truth.
- Snapshot execution plan updated: exclude Make.com, Accept.blue, Offers CO, Client Milestones pipeline, and old tag-driven pulse cadence; include the new `SS - Pulse Check Due` workflow.

Verification:

- `npm.cmd run typecheck` passed.
- `npm.cmd test -- --runInBand` passed (49 suites, 527 tests).
- `npm.cmd run build` passed end-to-end on Windows.
- Functional beta gates are still manual/outstanding: Stripe sandbox 2-pay weekly E2E, NMI live tiny-charge E2E, PMG webhook-secret repair button, pulse due-send webhook, and SYS2-09 evidence capture.

Open technical risks:

- The pulse due job needs the GHL inbound webhook URL and pulse form URL configured per merchant, preferably through the newly added `ScaleSafe Pulse Workflow Webhook URL` and `ScaleSafe Pulse Form URL` custom values.
- Manual PMG/GHL beta gates still need to be run before Snapshot export; local code gates are clean.

### 2026-04-30: Scalable Workflow Webhook Secret + Settings Health Panel (Codex)

Files changed:

- `src/constants/ghl-fields.ts`
- `src/controllers/merchant.controller.ts`
- `src/services/merchant.service.ts`
- `src/ui/src/views/SettingsView.vue`
- `docs/GHL_BETA_SNAPSHOT_EXECUTION_PLAN.md`
- `CHANGELOG.md`
- `docs/CLAUDE_CODE_CODEX_LOG.md`

Summary:

- Added `ScaleSafe Webhook Secret` to `CUSTOM_VALUE_REGISTRY` with merge field `{{ custom_values.scalesafe_webhook_secret }}`.
- Merchant provisioning now creates/maps that GHL custom value and syncs the per-merchant `merchants.webhook_secret` into it. Secret rotation also syncs the GHL custom value.
- `GET /api/merchants/webhook-secret` now returns the merge field so the UI/Snapshot can use the scalable value, not a manual pasted raw secret.
- Settings > Workflow Webhooks now tells Snapshot builders to use `x-scalesafe-webhook-secret: {{ custom_values.scalesafe_webhook_secret }}`.
- Settings now includes a Provisioning Health panel that calls `GET /api/merchants/provisioning-health` and displays pass/warn/fail install checks in-app.
- Snapshot execution plan updated: new clients should not require manual per-workflow secret paste; the Snapshot should use the merge field and ScaleSafe fills it per merchant.

Verification:

- `npm.cmd run typecheck` passed.
- `npm.cmd test -- tests/unit/merchant.service.test.ts --runInBand` passed.
- `npm.cmd test -- --runInBand` passed (49 suites, 527 tests).
- `npm.cmd run build` passed end-to-end on Windows.

### 2026-04-30: Fresh-Install Provisioning Health Endpoint (Codex)

Files changed:

- `src/services/merchant.service.ts`
- `src/controllers/merchant.controller.ts`
- `src/routes/merchant.routes.ts`
- `tests/unit/merchant.service.test.ts`
- `docs/GHL_BETA_SNAPSHOT_EXECUTION_PLAN.md`
- `CHANGELOG.md`
- `docs/CLAUDE_CODE_CODEX_LOG.md`

Summary:

- Added SSO-protected `GET /api/merchants/provisioning-health`.
- The report checks merchant record status, webhook secret presence, payment provider registration/API key, processor config, GHL `Client Milestones` pipeline, expected ScaleSafe contact fields, and ScaleSafe custom value mapping.
- The response returns `overallStatus` plus pass/warn/fail items without exposing secrets.
- While wiring the report, Codex found merchant provisioning still created only the original 5 SS contact fields. Added `SS Engagement Status` / `ss_engagement_status` so fresh installs match the current 6-field workflow/constant set.
- Updated the Snapshot plan to mark this code assist shipped.

Verification:

- `npm.cmd run typecheck` passed.
- `npm.cmd test -- --runInBand` passed (49 suites, 527 tests).
- `npm.cmd run build` passed end-to-end on Windows.

### 2026-04-30: GHL Beta Snapshot Execution Plan (Codex)

Files changed:

- `docs/GHL_BETA_SNAPSHOT_EXECUTION_PLAN.md`
- `CHANGELOG.md`
- `docs/CLAUDE_CODE_CODEX_LOG.md`

Summary:

- Created a current beta Snapshot execution checklist that supersedes older snapshot docs where they conflict with current V2 code, Codex security hardening, or Philip's no-Make direction.
- Clarified what the app already provisions on install versus what the GHL Snapshot must package.
- Captured manual GHL checklist items for forms, workflows, webhook URL/header setup, clean sandbox install, and E2E pass.
- Recommended the next code assist: a provisioning health report/diagnostic to make fresh-install testing fast and unambiguous.

Verification:

- Docs-only change; tests not run.

### 2026-04-30: Cross-Platform Build Packaging Script (Codex)

Files changed:

- `package.json`
- `scripts/copy-build-assets.js`
- `docs/CLAUDE_CODE_CODEX_LOG.md`

Summary:

- Replaced the Unix-only `mkdir -p` / `cp -r` tail of `npm run build` with `npm run copy-build-assets`.
- Added `scripts/copy-build-assets.js`, which uses Node's filesystem APIs to copy `src/ui/dist` into `dist/ui/dist` and `src/widgets` into `dist/widgets`.
- Updated stale open findings so webhook shared-secret work is marked in-flight/operational instead of design-open.

Verification:

- `npm.cmd run build` passed end-to-end on Windows.

### 2026-04-30: Correct External Integration Architecture Docs (Codex)

Files changed:

- `CHANGELOG.md`
- `docs/CLAUDE_CODE_CODEX_LOG.md`
- `docs/CLAUDE_CODE_SESSION_PROMPT.md`
- `docs/external-integration-guide.md`
- `docs/GHL_AUTOMATION_COMPANION.md`
- Cowork `CLAUDE_COWORK_CODEX_LOG.md`
- Cowork `docs/FEATURE_LEDGER.md`

Summary:

- Philip clarified that Make.com is not current architecture and is not a future option.
- Updated active repo/Cowork handoff docs so agents treat Make.com references as V1/history only.
- Rewrote the active external integration guide around direct/app-native posts to the ScaleSafe app endpoint with `x-scalesafe-webhook-secret`.
- No runtime code changed.

Verification:

- Docs-only change; tests not run.

### 2026-04-30: Daily Health Snapshot Processor Fix (Codex)

Files changed:

- `src/services/stripe-health.service.ts`
- `src/types/stripe-defense.types.ts`
- `src/jobs/daily-health-check.ts`
- `tests/unit/stripe-health.service.test.ts`
- `CHANGELOG.md`

Summary:

- Railway production logs showed the daily health job failing with `null value in column "processor" of relation "account_health_snapshots" violates not-null constraint`.
- `StripeHealthService.computeHealthSnapshot()` now inserts `processor: 'stripe'` on Stripe health snapshots.
- `AccountHealthSnapshot` type now includes the processor discriminator.
- Ratio threshold history lookup in `daily-health-check.ts` now filters by `processor`, so Stripe/NMI snapshot histories do not mix.

Verification:

- `npm.cmd run typecheck` passed.
- `npm.cmd test -- tests/unit/stripe-health.service.test.ts --runInBand` passed (25/25).
- `npm.cmd test -- --runInBand` passed (49 suites, 527 tests).

### 2026-04-30: External Webhook Observe-Mode Secret + Stable Idempotency (Codex)

Files changed:

- `src/routes/webhook.routes.ts`
- `src/controllers/webhook.controller.ts`
- `tests/unit/webhook.controller.test.ts`
- `docs/external-integration-guide.md`
- `CHANGELOG.md`
- `docs/CLAUDE_CODE_CODEX_LOG.md`

Summary:

- `/webhooks/external` now uses `requireMerchantWebhookSecret`, the same observe/enforce middleware used by `/webhooks/ghl/forms`.
- While `REQUIRE_WEBHOOK_SECRET=false`, external posts without the `x-scalesafe-webhook-secret` header are logged but still allowed. When enforcement is enabled, missing/invalid secrets return `401` and location mismatches return `403`.
- External webhook idempotency now uses a stable SHA-256 hash of source, event type, contact identifier, and sorted payload data instead of `Date.now()`. Identical replays now generate the same event ID and can actually dedupe.
- Updated the external integration guide to instruct direct/app-native external integrations to send `x-scalesafe-webhook-secret`.

Verification:

- `npm.cmd run typecheck` passed.
- `npm.cmd test -- tests/unit/webhook.controller.test.ts --runInBand` passed.
- `npm.cmd test -- --runInBand` passed (49 suites, 526 tests).
- `npm.cmd run build-ui` passed. `src/ui/package-lock.json` was restored afterward because `npm install` rewrites lock metadata on this host.

Next:

- Keep Claude Code read-only. It can audit docs or workflow setup, but Codex owns implementation sequencing.

### 2026-04-30: Webhook Secret Migration Applied + Backfilled (Codex Ops)

Summary:

- Philip applied migration `052_merchant_webhook_secret.sql` in Supabase SQL Editor.
- Codex ran `railway run node scripts/backfill-webhook-secrets.js`.
- Backfill created webhook secrets for 2 existing merchants.
- Read-only verification through Railway confirmed 2 total merchants, 2 with secrets, 0 missing secrets.
- Railway `REQUIRE_WEBHOOK_SECRET` is currently unset, so `/webhooks/ghl/forms` remains in observe mode.

Next operational step:

- Update existing GHL workflow Custom Webhook actions to include `x-scalesafe-webhook-secret` with the merchant-specific value from Settings > Workflow Webhooks.
- Keep `REQUIRE_WEBHOOK_SECRET` unset/false until observe logs show active workflow posts are signed.

### 2026-04-30: GHL Workflow Webhook Shared-Secret Rollout - Observe Mode (Codex)

Files changed:

- `.env.example`
- `supabase/migrations/052_merchant_webhook_secret.sql`
- `scripts/backfill-webhook-secrets.js`
- `src/repositories/merchant.repository.ts`
- `src/services/merchant.service.ts`
- `src/middleware/merchantWebhookSecret.ts`
- `src/routes/webhook.routes.ts`
- `src/routes/merchant.routes.ts`
- `src/controllers/merchant.controller.ts`
- `src/ui/src/views/SettingsView.vue`
- `tests/unit/merchantWebhookSecret.middleware.test.ts`
- `docs/GHL_AUTOMATION_COMPANION.md`
- `CHANGELOG.md`

Summary:

- Added per-merchant `webhook_secret` support for GHL workflow Custom Webhook posts to `/webhooks/ghl/forms`.
- Added observe-mode middleware. With `REQUIRE_WEBHOOK_SECRET=false` (default), missing/invalid/mismatched secrets are logged but not blocked so existing GHL workflows keep working. With `REQUIRE_WEBHOOK_SECRET=true`, missing/invalid secrets return `401` and tenant mismatches return `403`.
- Added SSO-protected merchant endpoints to fetch and rotate the workflow webhook secret, plus a Settings > Workflow Webhooks card with show/copy/rotate controls.
- Added a one-shot `scripts/backfill-webhook-secrets.js` for existing merchants after migration 052 is applied.
- Provisioning now tries to ensure a webhook secret for new installs/retries and logs a warning instead of failing if the DB migration has not been applied yet.

Verification:

- `npm.cmd run typecheck` passed.
- `npm.cmd test -- tests/unit/merchantWebhookSecret.middleware.test.ts --runInBand` passed (5/5).
- `npm.cmd test -- --runInBand` passed (49 suites, 524 tests).
- `npm.cmd run build-ui` passed. `src/ui/package-lock.json` was restored afterward because `npm install` rewrites lock metadata on this host.

Operational next steps:

- Apply Supabase migration `052_merchant_webhook_secret.sql`.
- Run `node scripts/backfill-webhook-secrets.js` in an environment with `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`.
- Keep `REQUIRE_WEBHOOK_SECRET=false` while updating existing GHL workflow Custom Webhook actions to send `x-scalesafe-webhook-secret`.
- Flip `REQUIRE_WEBHOOK_SECRET=true` only after observe logs show active workflows are signed.

### 2026-04-30: NMI Card-On-File Display Cleanup (Codex)

Files changed:

- `src/clients/nmi.client.ts`
- `src/controllers/payment-management.controller.ts`
- `src/controllers/dashboard.controller.ts`
- `src/ui/src/views/PaymentManagement.vue`
- `src/ui/src/views/client-profile/PaymentsTab.vue`
- `tests/unit/nmi.client.test.ts`
- `CHANGELOG.md`

Summary:

- `NmiClient.saveCard()` now seeds card display metadata from NMI's successful vault-add transaction response (`cc_number`, `cc_type`, `cc_exp`) before attempting the vault query. If the query fails, new saved NMI cards can still persist useful last4/brand/expiry instead of `****`, `unknown`, `0/0`.
- Payment Management and dashboard client-info APIs sanitize legacy placeholder card metadata before returning it to the Vue UI.
- Payment Management and Client Profile card displays no longer render `unknown ending in **** (exp 0/0)`. If metadata is missing, the UI shows a clean "NMI card on file" or "Card on file" label and only shows last4/expiry when real values exist.
- Dashboard/defense wording was checked; the dashboard stat label is already "Total Value Recovered".

Verification:

- `npm.cmd run typecheck` passed.
- `npm.cmd test -- tests/unit/nmi.client.test.ts --runInBand` passed (35/35).
- `npm.cmd test -- --runInBand` passed (48 suites, 519 tests).
- `npm.cmd run build-ui` passed. `src/ui/package-lock.json` was restored afterward because `npm install` rewrites lock metadata on this host.

Recommended next code step:

- Continue with the open custom/workflow webhook shared-secret audit and implementation plan, or run a live NMI add-card test to confirm the gateway includes `cc_number`/`cc_type`/`cc_exp` on the exact sandbox path.

### 2026-04-29: Step 1 - Gate Debug Routes

Files changed:

- `.env.example`
- `src/routes/health.routes.ts`

Summary:

- Kept `/health` public.
- Added a guard for all `/api/debug/*` routes.
- Debug routes now require `DEBUG_ADMIN_TOKEN` or `ADMIN_DEBUG_TOKEN`.
- If no debug token is configured, debug routes return `404`.
- If a bad token is supplied, debug routes return `401`.
- Documented `DEBUG_ADMIN_TOKEN` in `.env.example`.

Verification:

- `npm.cmd run typecheck` passed.
- Runtime smoke check confirmed no-token debug request returns `404` and wrong-token request returns `401`.

### 2026-04-29: Step 2 - Close `x-location-id` Auth Bypass

Files changed:

- `.env.example`
- `src/middleware/ssoAuth.ts`
- `src/ui/src/composables/useApi.ts`
- `src/ui/src/views/SettingsView.vue`
- `tests/setup-env.ts`

Summary:

- `x-location-id` is no longer accepted as normal authentication.
- Backend only accepts `x-location-id` when `NODE_ENV !== production` and `ALLOW_DEV_LOCATION_AUTH=true`.
- Vue shared API calls now send only `x-sso-payload` for authenticated routes.
- Vue Settings logo upload no longer falls back to `x-location-id`.
- Tests opt into local shortcut auth with `ALLOW_DEV_LOCATION_AUTH=true`.
- Documented `ALLOW_DEV_LOCATION_AUTH=false` in `.env.example`.

Verification:

- `npm.cmd run typecheck` passed.
- Production smoke check confirmed `x-location-id` returns `401` even when `ALLOW_DEV_LOCATION_AUTH=true`.
- Targeted evidence route test gets past auth but still has one pre-existing failure: the test expects `evidenceRepository.getTimeline(locationId, contactId)`, while current code passes a third pagination/filter options argument.

### 2026-04-29: Agent File Separation

Files created:

- `docs/CLAUDE_CODE_SESSION_PROMPT.md`
- `docs/CLAUDE_CODE_CODEX_LOG.md`

Summary:

- Repo now has Claude Code-specific instructions and a repo-local technical log.
- Claude Cowork has separate planning/documentation files in its own OneDrive folder.

### 2026-04-29: Step 3 - Lock Down Dispute + EFW Routes, Dashboard Tenant Scope, Evidence Test Repair (Claude Code)

Files changed:

- `src/routes/dispute.routes.ts`
- `src/routes/efw.routes.ts`
- `src/controllers/dashboard.controller.ts`
- `tests/integration/evidence.routes.integration.test.ts`
- `CHANGELOG.md`
- `docs/CLAUDE_CODE_CODEX_LOG.md`

Summary:

- `dispute.routes.ts`: mounted `ssoAuth` + `requireTenant`. Added `requireMatchingMerchant(req, res)` that looks up the merchant by `tenantContext.locationId` and verifies it matches `req.params.merchantId`. Mismatch returns `403 { error: 'Tenant mismatch' }` and logs both IDs. All four handlers (list, get, submit, accept) gated.
- `efw.routes.ts`: same lockdown pattern on the two EFW handlers.
- `dashboard.controller.ts:45`: added `.eq('location_id', locationId)` to the `overview` handler's `defense_outcomes` query so `totalValueSaved` only sums the caller's tenant. The line-295 `defenseHistory` aggregate is already transitively tenant-scoped via `packetIds` derived from a `location_id`-filtered `defense_packets` query (verified, no change).
- Evidence integration test: updated to the current `getTimeline(locationId, contactId, opts) → { rows, total }` contract. Mocks now resolve `{ rows, total }`; assertion checks the third opts arg `{ limit: 100, offset: 0, type: undefined, from: undefined, to: undefined }`.

Verification:

- `npm.cmd run typecheck` — passed.
- `npm.cmd test -- --runInBand --testPathPatterns="evidence.routes"` — 8/8 pass.
- `npm.cmd test -- --runInBand` — full suite: 474 pass, 6 fail. The 6 failures are all pre-existing test drift unrelated to this change:
  - `tests/unit/trigger-keys.test.ts` — expects 18 trigger keys; `VALID_TRIGGER_KEYS` constant has grown to 20.
  - `tests/unit/merchant-config.test.ts` — references `CV.CV_COMPILED_TERMS_HTML`, `CV.CV_CUSTOM_CLAUSE_1_TITLE`, etc.; those exports no longer exist on `src/constants/ghl-custom-value-ids`.
  - `tests/unit/defense.service.test.ts` — passes a plain `{ evidence_type, event_date, summary }[]` where the production type is now `ExhibitList` (`{ exhibits, byCategory, totals, enrollmentPacketPath }`).
  - `tests/integration/enrollment.integration.test.ts` — Puppeteer can't find Chromium on this Windows host; environmental, not a code regression.
  - `tests/unit/send-enrollment-link.test.ts`, `tests/unit/checkout.controller.test.ts`, `tests/unit/ghl-fields.test.ts` — same shape: refer to symbols/types that the production code has since renamed or restructured.
  None of these touch dispute, EFW, dashboard, or evidence-route code.

Side observation (not fixed, flagging for the next pass):

- `src/controllers/dashboard.controller.ts:50` reads `o.amount_saved`, but `defense_outcomes` actually has `amount_recovered` (per `supabase/migrations/002_defense_tables.sql:140`). The same column name appears at line 244 (`defenseHistory`) and line 295. No migration in `supabase/migrations/` adds `amount_saved`. Net effect: `totalValueSaved` always evaluates to 0 regardless of how many won outcomes exist. Out of scope for the tenant-filter fix, but the metric won't actually populate until the column reference (or the schema) is reconciled.

### 2026-04-29: Step 3 Follow-Up - Preserve LocationId URL Compatibility (Codex)

Files changed:

- `CHANGELOG.md`
- `src/routes/dispute.routes.ts`
- `src/routes/efw.routes.ts`
- `docs/CLAUDE_CODE_SESSION_PROMPT.md`
- `docs/CLAUDE_CODE_CODEX_LOG.md`

Summary:

- Reviewed Claude Code's pushed Step 3 security patch and found a route contract mismatch: the Vue app calls `/api/disputes/${ssoSession.locationId}`, while the new route guard accepted only the merchant UUID in `:merchantId`.
- Updated dispute and EFW route guards so the URL identifier may be either the authenticated tenant's `merchant.id` or `merchant.location_id`.
- After verification, route handlers query/service-call with the verified merchant UUID, not the raw URL param.
- Updated `CLAUDE_CODE_SESSION_PROMPT.md` to make clear that reading the prompt/log is for awareness only and Claude Code should not implement, commit, push, or deploy unless Philip explicitly asks for action in that session.

Verification:

- `npm.cmd run typecheck` passed.
- Philip approved commit/push.

### 2026-04-30: Fix Dashboard Value Recovered Column Mismatch (Codex)

Files changed:

- `CHANGELOG.md`
- `src/controllers/dashboard.controller.ts`
- `src/repositories/defense.repository.ts`
- `src/services/defense.service.ts`
- `docs/CLAUDE_CODE_CODEX_LOG.md`

Summary:

- Replaced stale `amount_saved` references with the schema-backed `amount_recovered` column.
- Dashboard overview and defense history totals now sum `amount_recovered`.
- Defense outcome recording now inserts `location_id` and `amount_recovered`, matching `supabase/migrations/002_defense_tables.sql`.
- Dashboard and Defense UI labels now say "Value Recovered" instead of "Value Saved."

Verification:

- `npm.cmd run typecheck` passed.
- Search confirmed no remaining `amount_saved` references in `src/**/*.ts` or `tests/**/*.ts`.

### 2026-04-30: Align Constants Tests With Current V2 Code (Codex)

Files changed:

- `CHANGELOG.md`
- `CLAUDE.md`
- `tests/unit/trigger-keys.test.ts`
- `tests/unit/ghl-fields.test.ts`
- `docs/CLAUDE_CODE_CODEX_LOG.md`

Summary:

- Updated trigger key test expectation from 18 to 20 to match `VALID_TRIGGER_KEYS`.
- Updated GHL fields test expectation from 5 to 6 to match current `SS_CONTACT_FIELDS`, including `ENGAGEMENT_STATUS`.
- Updated `CLAUDE.md` architecture constraint text from "5 SS contact fields" to "6 SS contact fields" so the repo rule matches the current V2 implementation.

Verification:

- `npm.cmd test -- tests/unit/trigger-keys.test.ts tests/unit/ghl-fields.test.ts --runInBand` passed: 2 suites, 11 tests.
- `npm.cmd run typecheck` passed.

### 2026-04-30: Clear Remaining Jest Test Drift (Codex)

Files changed:

- `CHANGELOG.md`
- `tests/unit/merchant-config.test.ts`
- `tests/unit/defense.service.test.ts`
- `tests/unit/send-enrollment-link.test.ts`
- `tests/unit/checkout.controller.test.ts`
- `tests/integration/enrollment.integration.test.ts`
- `docs/CLAUDE_CODE_CODEX_LOG.md`

Summary:

- `merchant-config.test.ts`: removed expectations for deleted location-level T&C custom value IDs. V2 stores custom clauses/compiled terms per offer, not as merchant custom values. Updated module-toggle GHL PUT assertions to allow the current `{ name, value }` payload.
- `defense.service.test.ts`: updated reason-code assertions to the current `reason_code_category` column and changed prompt-building tests to pass the production `ExhibitList` shape.
- `send-enrollment-link.test.ts`: updated trigger payload assertions from camelCase to snake_case workflow fields.
- `checkout.controller.test.ts`: mocked `resolveProcessor` directly because checkout config now uses the shared processor-resolution path.
- `enrollment.integration.test.ts`: mocked GHL, enrollment packet generation, and evidence chain verification, and awaited queued trigger work so the test checks the enrollment/trigger lifecycle without leaking background jobs after Jest teardown.

Verification:

- `npm.cmd test -- tests/unit/merchant-config.test.ts tests/unit/defense.service.test.ts --runInBand` passed: 2 suites, 26 tests.
- `npm.cmd test -- tests/unit/send-enrollment-link.test.ts tests/unit/checkout.controller.test.ts tests/integration/enrollment.integration.test.ts --runInBand` passed: 3 suites, 19 tests.
- `npm.cmd run typecheck` passed.
- `npm.cmd test -- --runInBand` passed: 45 suites, 506 tests.

### 2026-04-30: Gate Legacy Enrollment Prep Routes (Codex)

Files changed:

- `CHANGELOG.md`
- `src/routes/enrollment.routes.ts`
- `docs/CLAUDE_CODE_CODEX_LOG.md`

Summary:

- Found stale route protection on `src/routes/enrollment.routes.ts`: comments marked legacy `/prep` and `/offer/:id` routes as SSO-gated, but the route definitions did not apply `ssoAuth` or `requireTenant`.
- Added `ssoAuth, requireTenant` to `router.post('/prep', ...)` and `router.get('/offer/:id', ...)`.
- Left intentionally public funnel/client endpoints public: `/device-capture`, `/offer/:offerId/public`, `/consent`, `/consent-lookup/:consentToken`, and the public enrollment page.

Verification:

- `npm.cmd run typecheck` passed.
- `npm.cmd test -- --runInBand` passed: 45 suites, 506 tests.

Next security item:

- Public client-service links currently use `locationId + contactId` query params for payment update, subscription cancellation, and milestone signoff. They should move to signed short-lived action tokens so guessed IDs cannot fetch client display data, save a card, cancel an enrollment, or submit signoff evidence.

## Open Technical Findings

- P0 fixed: unauthenticated debug route exposure (Codex Step 1).
- P0 fixed: `x-location-id` SSO bypass (Codex Step 2).
- P0 fixed: dispute routes IDOR — now require matching tenant.
- P0 fixed: EFW routes IDOR — now require matching tenant.
- P1 fixed: dashboard `totalValueSaved` overview tenant filtering.
- P2 fixed: pre-existing test drift in 6 unit/integration suites. Full Jest suite now passes.
- P2 fixed: `defense_outcomes.amount_saved` vs. `amount_recovered` column name mismatch.
- P1 fixed: public client-service links tokenized (`payment-update`, `subscription-cancel`, `milestone-signoff`).
- P2 fixed: top-level `npm.cmd run build` now uses a cross-platform Node asset-copy script instead of Unix packaging commands (`mkdir -p`, `cp -r`).
- P1 fixed: official GHL marketplace webhook signature verification added for `/webhooks/ghl/triggers` and `/webhooks/ghl/payment`.
- P1 fixed: NMI Silent Post no longer processes approved transaction posts when processor verification throws or fails.
- P1 in-flight: custom/workflow webhook receivers (`/webhooks/ghl/forms`, `/webhooks/external`) now have per-merchant shared-secret observe-mode validation, Settings UI, migration, and backfill. Remaining work is operational: add `x-scalesafe-webhook-secret` to active GHL workflow Custom Webhook actions, observe signed traffic, then enable `REQUIRE_WEBHOOK_SECRET=true`.

### 2026-04-30: Tracking Reconciliation Rule (Codex)

Files changed:

- Repo: `docs/CLAUDE_CODE_SESSION_PROMPT.md`
- Cowork folder: `CLAUDE_COWORK_SESSION_PROMPT.md`
- Cowork folder: `docs/FEATURE_LEDGER.md`
- Cowork folder: `CLAUDE_COWORK_CODEX_LOG.md`
- Repo: `docs/CLAUDE_CODE_CODEX_LOG.md`

Summary:

- Reconciled the tracking system so `docs/FEATURE_LEDGER.md` in the Cowork folder is the product/status source of truth.
- Kept this repo log as the technical change/handoff log for Codex and Claude Code.
- Kept `CLAUDE_COWORK_CODEX_LOG.md` as the plain-English awareness log for Cowork.
- Updated both session prompts to say agents should not create new roadmap/status tracker systems unless Philip explicitly asks.
- Updated the Cowork feature ledger to reflect current Codex status: full backend suite green, Codex security hardening shipped, public client action links tokenization still open, dashboard performance bug logged, and NMI card metadata display bug logged.

Next queue for planning:

1. Signed short-lived public action links for payment update, subscription cancellation, and milestone signoff.
2. Public endpoint/webhook security validation pass.
3. Dashboard performance profiling and optimization.
4. NMI card-on-file metadata fix.

### 2026-04-30: Post-Beta Feature + Strategy Docket Added (Codex)

Files changed:

- Cowork folder: `docs/FEATURE_LEDGER.md`
- Cowork folder: `CLAUDE_COWORK_CODEX_LOG.md`
- Repo: `docs/CLAUDE_CODE_CODEX_LOG.md`

Summary:

- Added future/post-beta roadmap items to the existing Cowork feature ledger rather than creating a new tracker:
  - More Stripe accounts per merchant.
  - More NMI accounts per merchant.
  - Multi-MID routing by offer.
  - Compliant surcharging and dual pricing.
  - Financing / BNPL options.
  - Standalone non-GHL version.
  - Mobile/PWA direction.
- Added a `Strategy Sessions Needed` section to the Cowork feature ledger:
  - Product direction and positioning.
  - ICP pain and marketplace strategy.
  - Fast iteration path.
  - Standalone non-GHL path.
  - Mobile/PWA path.
  - Optional defense output review using Philip's generated-letter example.

Note:

- These are planning/post-beta docket items, not current beta execution tasks unless Philip explicitly promotes one.

### 2026-04-30: Signed Public Client Action Links (Codex)

Files changed:

- `.env.example`
- `CHANGELOG.md`
- `src/controllers/payment-update.controller.ts`
- `src/routes/payment-lifecycle.routes.ts`
- `src/routes/payment-update.routes.ts`
- `src/services/payment-lifecycle.service.ts`
- `src/services/phase2Enrollment.service.ts`
- `src/ui/src/views/PaymentManagement.vue`
- `src/utils/public-action-token.ts`
- `tests/unit/public-action-token.test.ts`
- `docs/CLAUDE_CODE_CODEX_LOG.md`

Summary:

- Added HMAC-signed public action tokens for client-facing actions: `payment_update`, `subscription_cancel`, and `milestone_signoff`.
- New generated payment update links use `/payment-update?actionToken=...` instead of exposing raw `contactId` and `locationId`.
- Public payment update, cancellation, and milestone signoff endpoints now resolve tenant/contact context from the signed token before returning config data or accepting mutations.
- Legacy raw `contactId`/`locationId` links are allowed only outside production or when `ALLOW_LEGACY_PUBLIC_ACTION_LINKS=true` is explicitly set.
- Added optional `PUBLIC_ACTION_TOKEN_SECRET`; if unset, tokens use `GHL_APP_SSO_KEY`.
- Updated Payment Management's "copy card update link" path to request a signed backend-generated link with `sendTrigger: false`, so copying a link does not also fire the GHL workflow.

Verification:

- `npm.cmd run typecheck` passed.
- `npm.cmd test -- --runInBand --testPathPatterns=public-action-token` passed: 1 suite, 5 tests.
- `npm.cmd test -- --runInBand` passed: 46 suites, 511 tests.
- `npm.cmd run build` got through TypeScript and Vite UI compilation, then failed at the existing Windows-incompatible packaging step (`mkdir -p` / `cp -r` under `cmd`). Treat as a follow-up build-script portability issue, not a code compile failure.

Next queue:

1. Public endpoint/webhook security validation pass.
2. Dashboard performance profiling and optimization.
3. NMI card-on-file metadata display fix.

### 2026-04-30: Webhook Verification Hardening (Codex)

Files changed:

- `.env.example`
- `CHANGELOG.md`
- `src/controllers/nmi-silent-post.controller.ts`
- `src/middleware/ghlWebhookSignature.ts`
- `src/routes/webhook.routes.ts`
- `tests/unit/ghl-webhook-signature.test.ts`
- `tests/unit/nmi-silent-post.controller.test.ts`
- `docs/CLAUDE_CODE_CODEX_LOG.md`

Summary:

- Added `requireGhlWebhookSignature` middleware for official GHL marketplace webhook routes:
  - `/webhooks/ghl/triggers`
  - `/webhooks/ghl/payment`
- Middleware verifies `X-GHL-Signature` with the Ed25519 public key from current HighLevel docs and falls back to legacy `X-WH-Signature` RSA verification during the transition window.
- Production rejects missing/invalid GHL marketplace webhook signatures by default.
- Non-production allows missing signatures for tests/local development, but malformed signatures are rejected everywhere.
- Added emergency compatibility env `ALLOW_UNSIGNED_GHL_WEBHOOKS=false`.
- NMI Silent Post now fails closed when an approved transaction-bearing post cannot be verified with the processor. Previous behavior processed anyway if verification threw, which could allow a spoofed post to advance recurring payment state if a subscription ID was known/guessed.

Verification:

- `npm.cmd run typecheck` passed.
- `npm.cmd test -- tests/unit/nmi-silent-post.controller.test.ts tests/unit/ghl-webhook-signature.test.ts --runInBand` passed: 2 suites, 7 tests.
- `npm.cmd test -- --runInBand` passed: 48 suites, 518 tests.

Open security follow-up:

- `/webhooks/ghl/forms` and `/webhooks/external` appear to be workflow/custom integration receivers rather than official signed marketplace webhooks. They still need a coordinated shared-secret/header design with GHL workflow updates before enforcement, so evidence capture is not silently broken.

### 2026-04-30: Dashboard Overview Load Optimization (Codex)

Files changed:

- `CHANGELOG.md`
- `src/controllers/dashboard.controller.ts`
- `src/ui/src/views/DashboardView.vue`
- `docs/CLAUDE_CODE_CODEX_LOG.md`

Summary:

- `dashboard.controller.ts` overview no longer fetches all `evidence_timeline.contact_id` rows just to count total evidence and dedupe active clients.
- Active offers, active clients, and evidence totals now use count-only Supabase queries (`head: true`) where response row bodies are not needed.
- Active clients now count from `client_list_view` using the same active-status group as the Clients page.
- `DashboardView.vue` no longer blocks stat-card rendering on `/api/dashboard/at-risk`; overview and at-risk requests are launched together, overview renders as soon as it returns, and at-risk fills in independently.

Verification:

- `npm.cmd run typecheck` passed.
- `npm.cmd test -- --runInBand` passed: 48 suites, 518 tests.
- `npm.cmd run build-ui` passed; Vite built the Vue app successfully.

Residual risk:

- If dashboard still feels slow in production, the remaining likely source is `disengagementService.checkAllClients()` behind `/api/dashboard/at-risk`, which does sequential per-client scoring plus possible GHL field writes for flagged clients. That should become a cached/background risk snapshot rather than a page-load scan.

### 2026-05-06: Trigger Delivery Logging + Shared App Event Pulse Wiring (Codex)

Files changed:

- `supabase/migrations/055_trigger_delivery_logs.sql`
- `src/services/trigger.service.ts`
- `src/constants/trigger-keys.ts`
- `src/services/phase2Enrollment.service.ts`
- `src/jobs/payment-reminder-check.ts`
- `src/jobs/pulse-cadence-check.ts`
- `tests/unit/trigger-keys.test.ts`
- `docs/CLAUDE_CODE_CODEX_LOG.md`
- `docs/GHL_BETA_SNAPSHOT_EXECUTION_PLAN.md`

Summary:

- Added `trigger_delivery_logs` so Marketplace trigger delivery is persisted in Supabase, not only Railway logs. Each active subscription POST now records trigger key, target URL, sent/failed status, HTTP status, attempt count, error message, and the payload sent.
- Added `ss_app_event` to valid trigger keys. Philip created this as the shared multi-event GHL Marketplace trigger with required `event_type` filter constants.
- Rewired the pulse cadence job away from direct workflow webhook URLs. App-owned pulse cadence now fires `ss_app_event` with `event_type = pulse_check_due`; GHL workflows should filter on that event type.
- Enriched `enrollment_complete`, `ss_payment_received`, and `upcoming_payment_reminder` app-event payloads with both snake_case and camelCase aliases (`contact_id`/`contactId`, `enrollment_id`/`enrollmentId`, etc.) so GHL workflows have easier access to contact and event data.

Verification:

- `npm.cmd run typecheck` passed.
- `npm.cmd test -- --runInBand --testPathPatterns=trigger.service` passed: 1 suite, 3 tests.
- `npm.cmd test -- --runInBand --testPathPatterns=trigger-keys` passed: 1 suite, 5 tests.
- `npm.cmd test -- --runInBand --testPathPatterns=phase2Enrollment.service` passed: 1 suite, 9 tests.

Manual follow-up:

- Apply migration 055 in Supabase production before relying on the delivery log table.
- After deploy, run a new enrollment or wait for the next daily installment/reminder, then query `trigger_delivery_logs` to see whether ScaleSafe sent to GHL and how GHL responded.

### 2026-05-06: GHL Trigger Execute 401 Fix (Codex)

Files changed:

- `src/services/trigger.service.ts`
- `tests/unit/trigger.service.test.ts`
- `docs/CLAUDE_CODE_CODEX_LOG.md`

Summary:

- Philip ran two new enrollments and `trigger_delivery_logs` showed `enrollment_complete` payloads were built correctly, including contact IDs, but GHL returned `401` for the `workflows-marketplace/triggers/execute/...` subscription URLs.
- Updated `trigger.service.ts` so GHL Marketplace trigger execution URLs are posted through the token-aware `ghlApi(locationId)` client instead of unauthenticated `axios.post`.
- Added centralized trigger payload normalization for all trigger fires:
  - Ensures `event_type`, `location_id`, and `locationId`.
  - Mirrors `contact_id` <-> `contactId`.
  - Mirrors `enrollment_id` <-> `enrollmentId`.
  - Mirrors `offer_id` <-> `offerId`.
- Improved failed-delivery status capture so rejected Axios responses preserve HTTP status in `trigger_delivery_logs`.

Verification:

- `npm.cmd run typecheck` passed.
- `npm.cmd test -- --runInBand --testPathPatterns=trigger.service` passed: 1 suite, 4 tests.

Next manual check:

- After Railway deploys this commit, run one more enrollment and query `trigger_delivery_logs`. Expected result is no longer `401`; either `sent`/2xx or a more specific GHL workflow/trigger error.

### 2026-05-06: Subscription Checkout Amount + Offer UI Polish (Codex)

Files changed:

- `src/routes/checkout.routes.ts`
- `src/services/offer.service.ts`
- `src/ui/src/views/OfferFormView.vue`
- `src/ui/src/views/OffersView.vue`
- `docs/CLAUDE_CODE_CODEX_LOG.md`

Summary:

- Fixed full enrollment checkout subscription amount handling. The standalone checkout page now charges `installmentAmount` when `paymentChoice === 'subscription'`, matching the quick checkout path and displayed subscription price.
- Fixed offer form subscription persistence. `OfferFormView.vue` now loads and saves `installmentAmount` for subscription offers, and `offer.service.ts` persists explicit subscription recurring amount updates.
- Removed implementation-language UI copy from the Pulse Check-Ins section. The Pulse helper now says clients can be checked in automatically during active enrollments.
- Improved offer link copy UX by showing `Copying...` and disabling the specific copy button until the clipboard write finishes, reducing the chance Philip/users paste the previous clipboard value during the brief async link lookup.

Verification:

- `npm.cmd run typecheck` passed.
- `npm.cmd run build-ui` passed.

Notes:

- Philip reported the full funnel browser tab title says "Welcome to your coaching program." That exact string is not in the repo; it appears to be on the GHL `/welcome` funnel page/snapshot and should be changed there to neutral copy such as "Welcome" or "Enrollment".
- Philip reported `enrollment_complete` should fire multiple workflows. ScaleSafe now fires all active subscription URLs stored in `trigger_subscriptions`; if only one workflow runs, verify every GHL workflow using that trigger is published/resaved after the `workflows.readonly` scope reauthorization and has an active row in `trigger_subscriptions`.

### 2026-05-07: Subscription Offer Amount Guardrails (Codex)

Files changed:

- `src/services/offer.service.ts`
- `src/routes/checkout.routes.ts`
- `docs/CLAUDE_CODE_CODEX_LOG.md`

Summary:

- Philip retested a subscription enrollment and still saw `$0.00` on the full enrollment checkout payment page.
- Added backend validation so subscription offers cannot be created or updated without a positive `installmentAmount` / `installment_amount`.
- Added checkout-page guardrail: if a subscription offer somehow reaches checkout without a positive billing amount, the page shows an unavailable/error message instead of displaying or submitting `$0.00`.

Verification:

- `npm.cmd run typecheck` passed.
- `npm.cmd test -- --runInBand --testPathPatterns=offer.service` passed: 1 suite, 12 tests.

Manual diagnostic:

- Query production `offers_mirror` for active subscription offers and inspect `price`, `installment_amount`, `installment_frequency`, and `checkout_mode`. Existing malformed offers may need a resave after this deploy or direct data correction.

Correction:

- Philip clarified that `$0` offers/subscriptions are an intentional supported product path, and the reported bug was not "missing amount on the offer." Codex removed the broad positive-amount validation and checkout block. The remaining investigation should compare the offer row/API response against the full enrollment checkout page's selected `paymentChoice`.
- Philip's SQL confirmed the real issue: subscription offers had `price = 1.00` but `installment_amount = null`. Codex patched subscription create/update to default `installment_amount` to `price` when a separate recurring amount is not supplied, and patched full enrollment checkout to fall back to `price` for subscription display/charge if an older offer still has `installment_amount = null`. This preserves legitimate `$0` subscriptions because it does not require a positive amount.

### 2026-05-11: Phase 3 Payment Processor Clarity (Codex)

Files changed:

- `src/controllers/payment-management.controller.ts`
- `src/controllers/dashboard.controller.ts`
- `src/ui/src/views/PaymentManagement.vue`
- `src/ui/src/views/client-profile/PaymentsTab.vue`
- `docs/CLAUDE_CODE_CODEX_LOG.md`

Summary:

- Philip paused recurring payments to verify lifecycle controls and raised the concern that Stripe/NMI subscriptions looked crossed in the UI.
- The app already stores processor identity on enrollments; the UI was too contact-level/default-processor oriented, which made multiple recurring plans for the same client hard to reason about.
- Payment methods now return processor-aware display/detail labels. NMI cards no longer render as "unknown ending in ****"; Stripe/NMI labels identify the processor and show only known card/vault details.
- The full payment-management page now shows a per-enrollment Recurring Plans section with program name, billing type, processor, status, processor subscription id, next billing date, and remaining payment count.
- Pause/resume/cancel now uses `/api/payments/lifecycle/enrollment/status` with the selected enrollment id, so the action targets the specific Stripe or NMI plan rather than a generic client subscription.
- Client profile Payments tab now shows processor badges and processor subscription ids for active installment/subscription programs.

Verification:

- `npm.cmd run typecheck` passed.
- `npm.cmd run build` passed.

Next proof:

- After deploy, retest the paused Stripe/NMI subscriptions from the UI and confirm the selected recurring plan changes status without affecting the other plan for the same contact.

### 2026-05-11: Phase 4 Payment Reconciliation Report (Codex)

Files changed:

- `src/services/payment-reconciliation.service.ts`
- `src/controllers/payment-management.controller.ts`
- `src/routes/payment-management.routes.ts`
- `src/ui/src/views/PaymentSearch.vue`
- `docs/CLAUDE_CODE_CODEX_LOG.md`

Summary:

- Added a tenant-scoped reconciliation API at `GET /api/payments/manage/reconciliation?days=30`.
- Added a Payments > Reconciliation tab beside All Payments and Clients.
- The first reconciliation pass compares ScaleSafe records against ScaleSafe's own payment truth tables and flags records that make processor proof hard:
  - recurring enrollments missing `processor_type`
  - active recurring enrollments missing `processor_subscription_id`
  - payment event processor mismatches against the enrollment processor
  - payment events not tied to an enrollment
  - paid events without processor transaction ids
  - recent failed payments
  - duplicate processor transaction ids
  - overdue `next_billing_date` values
  - installment payoffs not marked with `billing_completed_at`
  - historical rows where billing payoff appears to have completed the program
- This is not yet a live Stripe/NMI transaction-list reconciliation job. It is the in-app consistency/reporting layer needed before we add processor-export or processor-API comparison.

Verification:

- `npm.cmd run typecheck` passed.
- `npm.cmd run build` passed.

Next proof:

- After deploy, open Payments > Reconciliation and run 30/90-day checks against PMG. Use the issue list to verify the known NMI/Stripe daily tests, paused subscriptions, duplicate NMI test attempts, and any historical rows affected by earlier final-installment completion behavior.

## Current Working Tree Notes

### 2026-05-11: Phase 5 Payment Reminder Scheduler Fix (Codex)

Files changed:

- `src/jobs/payment-reminder-check.ts`
- `src/repositories/idempotency.repository.ts`
- `src/index.ts`
- `tests/unit/payment-reminder-check.test.ts`
- `docs/CLAUDE_CODE_CODEX_LOG.md`

Summary:

- Philip reported no upcoming-payment reminders during daily billing tests.
- Root cause found: `runPaymentReminderCheck` ran 5 minutes after deploy/startup and then every 24 hours. If a daily test enrollment was created after that day's scan, the next run would already be looking at the following day and the 1-day reminder could be missed entirely.
- Changed payment reminders to run hourly.
- Added reminder idempotency using the existing `idempotency_keys` table, keyed by location + enrollment + next billing date + reminder window (`3d` or `1d`), so hourly scans do not duplicate 3-day or 1-day reminders.
- The reminder job now returns/logs totals for scanned, sent, and skipped reminders.
- No new SQL is required; this reuses the existing `idempotency_keys` table.

Verification:

- `npm.cmd test -- --runInBand tests/unit/payment-reminder-check.test.ts tests/unit/offer-display.test.ts tests/unit/recurring-payment.service.test.ts` passed.
- `npm.cmd run typecheck` passed.
- `npm.cmd run build` passed.

### 2026-05-11: Phase 5 Payment Workflow Field/Trigger Tightening (Codex)

Files changed:

- `src/utils/offer-display.ts`
- `src/services/phase2Enrollment.service.ts`
- `src/services/enrollment.service.ts`
- `src/services/recurring-payment.service.ts`
- `tests/unit/offer-display.test.ts`
- `tests/unit/recurring-payment.service.test.ts`
- `docs/CLAUDE_CODE_CODEX_LOG.md`

Summary:

- Philip confirmed Welcome fires for all tested enrollment types and Enrollment Payment Receipt now renders fields.
- New issue found: an installment receipt path was showing the paid-in-full display price as the full offer price instead of the discounted PIF price.
- Added a shared offer display helper so `contact.offer_price` remains the full program price, while workflow-compatible `contact.offer_price_display` uses the discounted PIF price when `pif_discount_enabled` and `pif_price` are present.
- Tightened the recurring `ss_payment_received` trigger payload so subsequent Stripe/NMI recurring payments send the same useful identifiers as enrollment triggers: `location_id/locationId`, `contact_id/contactId`, `enrollment_id/enrollmentId`, `offer_id/offerId`, `processor`, `source`, `payment_number`, `payments_total`, `payments_remaining`, `running_total`, and `payment_kind`.
- This is a forward fix. The next proof is the next Stripe/NMI recurring transaction plus `trigger_delivery_logs` for `ss_payment_received`.

Verification:

- `npm.cmd test -- --runInBand tests/unit/offer-display.test.ts tests/unit/recurring-payment.service.test.ts tests/unit/phase2Enrollment.service.test.ts` passed.
- `npm.cmd run typecheck` passed.
- `npm.cmd run build` passed.

### 2026-05-07: Enrollment Receipt Merge Field Fix (Codex)

Files changed:

- `src/services/phase2Enrollment.service.ts`
- `docs/CLAUDE_CODE_CODEX_LOG.md`

Summary:

- Philip received a GHL payment receipt email where the workflow fired, but contact merge fields such as `{{contact.offer_program_name}}`, `{{contact.offer_price_display}}`, `{{contact.offer_number_of_payments}}`, and `{{contact.offer_support_email}}` rendered blank.
- Initial root causes found:
  - The PMG workflow template used friendlier aliases while the app wrote canonical fields like `contact.offer_name`, `contact.offer_price`, and `contact.offer_num_payments`.
  - The app fired workflow triggers before the GHL contact field update ran in the background, so immediate email/SMS workflows could send before contact merge fields were populated.
- First patch moved the important GHL contact field sync ahead of workflow-trigger timing in `completeEnrollment`, so receipt/welcome workflows have contact fields available before they send.
- Superseded again on 2026-05-08 by the Workflow-Compatible Field Registry: for beta, the current GHL workflows win. The app now creates and writes the alias fields the templates expect so Philip does not need to manually rebuild every email/SMS body before snapshot.

Verification:

- `npm.cmd run typecheck` passed.
- `npm.cmd test -- --runInBand --testPathPatterns=phase2Enrollment` passed: 2 suites, 16 tests.

### 2026-05-07: NMI Recurring Silent Post Reference ID Fix (Codex)

Files changed:

- `src/controllers/nmi-silent-post.controller.ts`
- `tests/unit/nmi-silent-post.controller.test.ts`
- `docs/CLAUDE_CODE_CODEX_LOG.md`

Summary:

- Philip compared ScaleSafe payment records against an NMI transaction export and found Stripe recurring payments were posting back to ScaleSafe, but NMI recurring payments were not.
- The NMI export showed successful recurring charges using `reference_id` as the recurring subscription id (`12030251307`, `12034706411`, `12034762268`, etc.), while the app only read `subscription_id` from Silent Post payloads.
- Updated the NMI Silent Post handler to accept NMI's alternate recurring identifiers: `subscription_id`, `subscriptionid`, `reference_id`, `referenceid`, `recurring_id`, and `recurringid`.
- Also accepts alternate transaction id fields (`transactionid`, `transaction_id`, `transactionId`, `id`) so the NMI charge id can still be used for idempotency if the payload follows the export naming.

Verification:

- `npm.cmd test -- --runInBand --testPathPatterns=nmi-silent-post.controller` passed: 1 suite, 4 tests.
- Added a regression test using the exact production-like NMI shape: `reference_id = 12034762268`, `id = 12036110931`, `amount = 0.50`.

Operational note:

- This is a forward fix for future NMI recurring Silent Posts. Already-missed NMI recurring transactions will not automatically backfill unless NMI retries them; they should be reconciled/backfilled from the NMI export or a future reconciliation job.

- Existing untracked file observed before Codex edits: `scripts/backfill-merchant-id.js`.
- Codex did not modify that file.
- Git emits warnings about `C:\Users\p_kor_e1dk2i3\.config\git\ignore` permission denied; this appears environmental, not project-specific.
