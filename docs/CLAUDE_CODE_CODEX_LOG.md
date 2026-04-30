# Claude Code Codex Log - ScaleSafe V2

Purpose: repo-local technical handoff for Claude Code and Codex.

Audience: coding agents working inside `C:\Users\p_kor_e1dk2i3\ScaleSafe`.

This file is about implementation: files changed, security findings, tests, known code risks, and next code tasks. It is not the planning/documents log for Claude Cowork.

## Operating Rule For Codex

At the end of each meaningful Codex coding session, update this file with:

- Code changes made
- Files changed
- Verification run
- Known failures or test drift
- Open technical risks
- Recommended next code step

Do not include secrets, `.env` values, tokens, database credentials, or customer/client private data.

## Current Build Context

- Product: ScaleSafe V2, a GHL Marketplace app for evidence-powered chargeback defense.
- Stack: Express + TypeScript backend, Vue 3 + Vite UI, Supabase, Railway, GHL OAuth/SSO, NMI test mode, Stripe sandbox/connect testing.
- Treat historical real test data as sensitive.
- Current priority: security hardening before feature expansion.

## Codex Changes

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
- P2 open: top-level `npm.cmd run build` uses Unix packaging commands (`mkdir -p`, `cp -r`) and fails under Windows `cmd` after TypeScript/Vite compilation succeeds.

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

## Current Working Tree Notes

- Existing untracked file observed before Codex edits: `scripts/backfill-merchant-id.js`.
- Codex did not modify that file.
- Git emits warnings about `C:\Users\p_kor_e1dk2i3\.config\git\ignore` permission denied; this appears environmental, not project-specific.
