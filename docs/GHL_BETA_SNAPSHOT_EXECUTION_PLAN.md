# GHL Beta Snapshot Execution Plan

**Created:** 2026-04-30
**Purpose:** Current execution checklist for the beta-blocking GHL Snapshot gate. This supersedes older snapshot notes where they conflict with current V2 code, Codex hardening, or Philip's explicit direction.

## Current Direction

- ScaleSafe V2 does not use Make.com. Treat Make.com references in older docs as V1/history only.
- Snapshot packaging is blocked until beta scope is frozen, installment billing is functionally proven, pulse cadence is tested, and PMG's webhook-secret custom value repair/sync is verified.
- The app already provisions what it can through API. The Snapshot should contain the GHL-native assets that are hard or impossible to create reliably through API.
- Webhook secrets are implemented in observe mode. Snapshot/workflow webhooks should include `x-scalesafe-webhook-secret` with value `{{ custom_values.scalesafe_webhook_secret }}`, but backend enforcement should stay off until active workflows are confirmed signed.
- Offer checkout/enrollment links are durable public links and must not expire by default. Quick checkout links (`/quick-checkout?offerId=...`) and full enrollment funnel links (`/welcome?offerId=...`) may be used in funnels, automations, emails, ads, or client follow-ups. Signed 14-day public action tokens are only for sensitive client actions such as payment update, subscription cancellation, and milestone signoff.
- Current workflow email/SMS templates are accepted as the beta source of truth. The app now creates/writes the workflow-compatible contact fields they expect, including `contact.offer_program_name`, `contact.offer_price_display`, `contact.offer_number_of_payments`, and `contact.offer_support_email`. Run Settings > Provisioning Health > Repair Fields before snapshot export and after fresh install.

## Current Beta Finish Path Status - 2026-05-11

- Phase 1 payment truth shipped: final installment payoff marks billing complete without completing the program.
- Phase 2 payment ledger shipped: all-payments reporting, date filters, processor/billing/status filters, and schema-drift fallbacks.
- Phase 3 processor clarity/lifecycle controls shipped: per-plan pause/resume/cancel controls and processor-aware stored-card handling.
- Phase 4 reconciliation diagnostics shipped and should stay visible during beta.
- Phase 4B payment display truth shipped: unlinked payment rows and reconciliation issues now show `Unassigned payment` instead of borrowing a program from the same contact. Offer Tracking ID is available after migration `057_offer_tracking_id.sql`.
- Phase 5 payment workflow proof is still live-testing work: Welcome, Enrollment Payment Receipt, Recurring Payment Receipt, failed payment, NMI second installment, Stripe final installment keeping program active, and payment reminders.
- Phase 6 pulse cadence is code-shipped but still needs GHL smoke proof: force due pulse, confirm `ss_app_event` delivery filtered to `pulse_check_due`, submit SYS2-09, and verify `pulse_checkin` evidence links to the enrollment.
- Phase 7 fresh install E2E remains blocked until Phases 5 and 6 are clean.

## App-Provisioned On Install

These should not be manually duplicated in the Snapshot unless GHL requires them there for workflow merge fields:

| Component | Current Source | Notes |
|---|---|---|
| Merchant DB record/config | App/Supabase | OAuth install path. |
| Per-merchant webhook secret | App/Supabase + GHL custom value | `merchants.webhook_secret`; backfilled for existing merchants and synced to `{{ custom_values.scalesafe_webhook_secret }}`. |
| Payment provider registration/API key | App | `merchantService.registerPaymentProvider()`. |
| SS contact fields | App | Enrollment, evidence, chargeback, defense, engagement, payment, refund, milestone, and workflow-compatible beta fields are created from `BETA_CUSTOM_FIELD_REGISTRY`. |
| Offer-prefix contact fields | App | Canonical offer bridge fields plus workflow-compatible aliases are copied at enrollment. App creates these if missing. |
| Core custom values | App | See `CUSTOM_VALUE_REGISTRY` in `src/constants/ghl-fields.ts`, including `ScaleSafe Webhook Secret`. |
| Pulse cadence timing | App | Offers choose cadence; enrollments store next due/last sent; daily app job fires the shared `ss_app_event` trigger with `event_type = pulse_check_due`. |
| GHL products/prices | App | Created when offers are created/updated. |
| Trigger subscriptions | GHL marketplace | GHL posts subscription lifecycle to `/webhooks/ghl/triggers`; app stores subscriptions and fires to those URLs. |

## Snapshot Must Include

| Component | Status | Beta Action |
|---|---|---|
| `Client Milestones` pipeline | Deferred | Exclude from beta Snapshot. App-native `enrollments.current_milestone` remains the beta source of truth. |
| Offers Custom Object schema | Deferred | Exclude from beta Snapshot. Offer sync to GHL Custom Objects is disabled; GHL Product/Price creation remains active for checkout/payment provider flow. |
| Evidence forms SYS2-07 through SYS2-11 | Exists/partially verified | Package forms. Ensure any workflow/custom webhook action posts directly to `https://dashboard.scalesafe.app/webhooks/ghl/forms` or the current production app URL, with header `x-scalesafe-webhook-secret: {{ custom_values.scalesafe_webhook_secret }}`. |
| Notification workflows | Built/published per Cowork workflow reference | Package active V2 workflows. Do not include obsolete V1 duplicates. |
| Evidence form workflows | WF-01/WF-02 published | Package after webhook URL/header check. |
| `SS - Pulse Check Due` workflow | Required for beta | Package the workflow that listens to the shared Marketplace trigger `ss_app_event` and filters `Event Type = Pulse Check Due` (`event_type = pulse_check_due`). The app owns cadence and sends `enrollment_id`, `contact_id`, `offer_name`, `form_url`, and context fields. Exclude the old tag-driven pulse workflow. |
| Enrollment funnel | Not started/currently biggest unknown | Build/package current V2 flow or explicitly defer if the app-hosted enrollment/Quick Pay path fully replaces it for beta. |

## Do Not Package

- V1 Make.com workflows, URLs, or helper fields.
- Accept.blue fields, custom values, or payment workflows.
- Google Sheets/Drive evidence export flows.
- Old model-specific onboarding forms/workflows.
- Old tag-driven pulse cadence workflow.
- Offers Custom Object.
- Client Milestones pipeline.
- Any duplicate workflow that conflicts with the app's processor-native payment handling.

## Decisions Already Corrected

- `SS - Post Payment Actions` and `SS Refund Notification` were previously marked for deletion in some docs, but Philip later corrected that they are real app-triggered workflows. Do not delete/unpublish them without a fresh workflow-by-workflow review.
- `SS - Bump Acceptance Confirmation` should remain draft/deferred while order bumps are post-beta.
- The active app has 21 valid trigger keys in `src/constants/trigger-keys.ts`, including the shared `ss_app_event` multi-event trigger.
- Current managed SS contact fields are 6, including `ss_engagement_status` for at-risk/re-engagement workflows. Merchant provisioning now creates all 6.

## Manual GHL Checklist

1. Open PMG GHL location and create/refresh the beta Snapshot from a clean V2 baseline.
2. Confirm `Client Milestones` pipeline is excluded for beta.
3. Confirm Offers Custom Object is excluded for beta.
4. Confirm forms SYS2-07 through SYS2-11 are included.
5. For each evidence workflow/custom webhook action, confirm:
   - URL posts directly to `https://dashboard.scalesafe.app/webhooks/ghl/forms`.
   - Header name is `x-scalesafe-webhook-secret`.
   - Header value is `{{ custom_values.scalesafe_webhook_secret }}`.
   - Body includes `locationId`, `contactId` or resolvable contact identity, `formId`, and `data`.
6. Confirm `SS - Pulse Check Due` exists, uses the shared Marketplace trigger `ss_app_event`, filters `Event Type = Pulse Check Due`, and the old tag-driven pulse cadence workflow is excluded.
7. Confirm all active notification workflow email/SMS bodies use the canonical field replacements in `docs/WORKFLOW_FIELD_CONTRACT_MATRIX.md`.
8. Confirm all active notification workflows listen to the correct current trigger keys/payload shapes, including `ss_app_event` with `event_type = upcoming_payment_reminder` before billing and `ss_payment_received` after installments.
9. Confirm no V1 Make.com or Accept.blue assets are included in the Snapshot package.
10. Install the Snapshot into a fresh sandbox location.
11. Install ScaleSafe into that fresh location.
12. Verify app provisioning marks the merchant `installed` or a known acceptable `partial` state with clear missing items.
13. Run the E2E test protocol from the Cowork folder against the fresh install.

## Codex/Code Follow-Ups

| Priority | Task | Why |
|---|---|---|
| P1 | Add a snapshot/provisioning health endpoint or admin diagnostic view | Shipped as `GET /api/merchants/provisioning-health` plus a Settings panel. It no longer treats the deferred Client Milestones pipeline as beta-required. |
| P1 | Add installed-tenant webhook secret repair | Shipped as `POST /api/merchants/provisioning-health/repair-webhook-secret` plus a Settings button. Use it for PMG after creating `ScaleSafe Webhook Secret` in GHL. |
| P1 | Build app-owned pulse cadence | Shipped in code: migration 053, offer cadence settings, enrollment due fields, daily pulse job, and SYS2-09 enrollment linkage. Needs functional GHL workflow smoke before Snapshot export. |
| P1 | Reconcile repo `GHL_AUTOMATION_COMPANION.md` with current Cowork workflow reference | Repo doc is stale on workflow counts, trigger counts, and Make references. |
| P1 | Copy or mirror current E2E protocol into repo docs | The feature ledger references `docs/E2E_TEST_PROTOCOL.md`, but it currently lives only in Cowork. |
| P1 | Wire pulse cadence to `ss_app_event` | Shipped. Marketplace trigger/filter created manually by Philip; code now fires `triggerService.fireTrigger(locationId, 'ss_app_event', { event_type: 'pulse_check_due', ... })` from `pulse-cadence-check.ts`. Needs functional GHL workflow smoke. |
| P1 | Add trigger delivery observability | Shipped in migration 055 and `trigger.service.ts`. Apply migration 055 in Supabase production, then use `trigger_delivery_logs` to verify whether enrollment/payment/reminder/pulse trigger deliveries reached GHL. |
| P1 | Reconcile workflow merge-field contract | In progress. `docs/WORKFLOW_FIELD_CONTRACT_MATRIX.md` now defines canonical fields and stale-field replacements. PMG workflow bodies still need manual GHL UI edits before snapshot export. |
| P2 | Add an install smoke script | Read-only verification for a fresh location once OAuth/install is complete. |

## Next Recommended Step

Before export, run Settings > Provisioning Health and Repair Webhook Secret in PMG, complete Stripe/NMI installment E2E, smoke the pulse due-send/SYS2-09 evidence loop, then package the Snapshot with the checklist above.
