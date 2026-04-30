# GHL Beta Snapshot Execution Plan

**Created:** 2026-04-30
**Purpose:** Current execution checklist for the beta-blocking GHL Snapshot gate. This supersedes older snapshot notes where they conflict with current V2 code, Codex hardening, or Philip's explicit direction.

## Current Direction

- ScaleSafe V2 does not use Make.com. Treat Make.com references in older docs as V1/history only.
- Snapshot packaging is the next beta gate after the security/build hardening pass.
- The app already provisions what it can through API. The Snapshot should contain the GHL-native assets that are hard or impossible to create reliably through API.
- Webhook secrets are implemented in observe mode. Snapshot/workflow webhooks should include `x-scalesafe-webhook-secret` with value `{{ custom_values.scalesafe_webhook_secret }}`, but backend enforcement should stay off until active workflows are confirmed signed.

## App-Provisioned On Install

These should not be manually duplicated in the Snapshot unless GHL requires them there for workflow merge fields:

| Component | Current Source | Notes |
|---|---|---|
| Merchant DB record/config | App/Supabase | OAuth install path. |
| Per-merchant webhook secret | App/Supabase + GHL custom value | `merchants.webhook_secret`; backfilled for existing merchants and synced to `{{ custom_values.scalesafe_webhook_secret }}`. |
| Payment provider registration/API key | App | `merchantService.registerPaymentProvider()`. |
| SS contact fields | App | `SS Enrollment Status`, `SS Evidence Score`, `SS Last Evidence Date`, `SS Chargeback Status`, `SS Defense Status`, `SS Engagement Status`. |
| Offer-prefix contact fields | App | Offer bridge fields copied at enrollment. App creates these if missing. |
| Core custom values | App | See `CUSTOM_VALUE_REGISTRY` in `src/constants/ghl-fields.ts`, including `ScaleSafe Webhook Secret`. |
| Pipeline ID capture | App | App looks for `Client Milestones` after Snapshot install and stores the ID. |
| GHL products/prices | App | Created when offers are created/updated. |
| Trigger subscriptions | GHL marketplace | GHL posts subscription lifecycle to `/webhooks/ghl/triggers`; app stores subscriptions and fires to those URLs. |

## Snapshot Must Include

| Component | Status | Beta Action |
|---|---|---|
| `Client Milestones` pipeline | Exists in PMG | Package into Snapshot. App detects by name. |
| Offers Custom Object schema | Exists in PMG | Package full current schema. Verify it matches `docs/ghl-offers-custom-object-schema.md`. |
| Evidence forms SYS2-07 through SYS2-11 | Exists/partially verified | Package forms. Ensure any workflow/custom webhook action posts directly to `https://dashboard.scalesafe.app/webhooks/ghl/forms` or the current production app URL, with header `x-scalesafe-webhook-secret: {{ custom_values.scalesafe_webhook_secret }}`. |
| Notification workflows | Built/published per Cowork workflow reference | Package active V2 workflows. Do not include obsolete V1 duplicates. |
| Evidence form workflows | WF-01/WF-02 published | Package after webhook URL/header check. |
| Pulse cadence workflow | Published | Package if still intended for beta. Confirm it does not depend on V1 fields. |
| Enrollment funnel | Not started/currently biggest unknown | Build/package current V2 flow or explicitly defer if the app-hosted enrollment/Quick Pay path fully replaces it for beta. |

## Do Not Package

- V1 Make.com workflows, URLs, or helper fields.
- Accept.blue fields, custom values, or payment workflows.
- Google Sheets/Drive evidence export flows.
- Old model-specific onboarding forms/workflows.
- Any duplicate workflow that conflicts with the app's processor-native payment handling.

## Decisions Already Corrected

- `SS - Post Payment Actions` and `SS Refund Notification` were previously marked for deletion in some docs, but Philip later corrected that they are real app-triggered workflows. Do not delete/unpublish them without a fresh workflow-by-workflow review.
- `SS - Bump Acceptance Confirmation` should remain draft/deferred while order bumps are post-beta.
- The active app has 20 valid trigger keys in `src/constants/trigger-keys.ts`, not the older 18 count.
- Current managed SS contact fields are 6, including `ss_engagement_status` for at-risk/re-engagement workflows. Merchant provisioning now creates all 6.

## Manual GHL Checklist

1. Open PMG GHL location and create/refresh the beta Snapshot from a clean V2 baseline.
2. Confirm `Client Milestones` pipeline exists and is included.
3. Confirm Offers Custom Object exists and all required fields/associations are included.
4. Confirm forms SYS2-07 through SYS2-11 are included.
5. For each evidence workflow/custom webhook action, confirm:
   - URL posts directly to `https://dashboard.scalesafe.app/webhooks/ghl/forms`.
   - Header name is `x-scalesafe-webhook-secret`.
   - Header value is `{{ custom_values.scalesafe_webhook_secret }}`.
   - Body includes `locationId`, `contactId` or resolvable contact identity, `formId`, and `data`.
6. Confirm all active notification workflows listen to the correct current trigger keys/payload shapes.
7. Confirm no V1 Make.com or Accept.blue assets are included in the Snapshot package.
8. Install the Snapshot into a fresh sandbox location.
9. Install ScaleSafe into that fresh location.
10. Verify app provisioning marks the merchant `installed` or a known acceptable `partial` state with clear missing items.
11. Run the E2E test protocol from the Cowork folder against the fresh install.

## Codex/Code Follow-Ups

| Priority | Task | Why |
|---|---|---|
| P1 | Add a snapshot/provisioning health endpoint or admin diagnostic view | Shipped as `GET /api/merchants/provisioning-health` plus a Settings panel. Makes fresh install testing faster: pipeline found, fields found/created, custom values found/created, webhook secret present, payment provider registered. |
| P1 | Reconcile repo `GHL_AUTOMATION_COMPANION.md` with current Cowork workflow reference | Repo doc is stale on workflow counts, trigger counts, and Make references. |
| P1 | Copy or mirror current E2E protocol into repo docs | The feature ledger references `docs/E2E_TEST_PROTOCOL.md`, but it currently lives only in Cowork. |
| P2 | Add an install smoke script | Read-only verification for a fresh location once OAuth/install is complete. |

## Next Recommended Step

Use the Settings > Provisioning Health panel after the next fresh sandbox install, then manually package/test the Snapshot with the checklist above.
