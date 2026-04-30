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

## Open Technical Findings

- P0 fixed: unauthenticated debug route exposure (Codex Step 1).
- P0 fixed: `x-location-id` SSO bypass (Codex Step 2).
- P0 fixed: dispute routes IDOR — now require matching tenant.
- P0 fixed: EFW routes IDOR — now require matching tenant.
- P1 fixed: dashboard `totalValueSaved` overview tenant filtering.
- P2 still open: pre-existing test drift in 6 unit/integration suites (see Verification above) — not introduced by security work, but worth a sweep.
- P2 still open: `defense_outcomes.amount_saved` vs. `amount_recovered` column name mismatch — `totalValueSaved` always returns 0 until reconciled.

## Current Working Tree Notes

- Existing untracked file observed before Codex edits: `scripts/backfill-merchant-id.js`.
- Codex did not modify that file.
- Git emits warnings about `C:\Users\p_kor_e1dk2i3\.config\git\ignore` permission denied; this appears environmental, not project-specific.
