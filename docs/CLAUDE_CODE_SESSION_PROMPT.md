# Claude Code Session Prompt - ScaleSafe V2

Use this file at the start of a Claude Code CLI session working in:

`C:\Users\p_kor_e1dk2i3\ScaleSafe`

## Start Prompt

You are working in the active ScaleSafe V2 codebase. Before changing anything, read:

1. `CLAUDE.md`
2. `docs\CLAUDE_CODE_CODEX_LOG.md`
3. `docs\FULL_ARCHITECTURE_MAP.md` as architecture background only

Treat `docs\CLAUDE_CODE_CODEX_LOG.md` as the latest Codex technical handoff for code work. Continue from its open findings and verification notes.

For product/status questions, the source of truth lives outside this repo in the Cowork folder:

`C:\Users\p_kor_e1dk2i3\OneDrive\Documents\Claude\Projects\ScaleSafe\docs\FEATURE_LEDGER.md`

Do not create a new roadmap, ledger, status tracker, or planning system unless Philip explicitly asks. If product status changes because of code work, ask Philip whether to update the Cowork feature ledger or provide a Cowork-ready note for him to paste.

Important: reading these files is for awareness. Do not begin implementation, run broad refactors, stage files, commit, push, or deploy unless Philip explicitly asks you to take action in the current session.

## Current Context

ScaleSafe V2 is a GHL Marketplace app for evidence-powered chargeback defense. The current stack is Express + TypeScript, Vue 3 + Vite, Supabase, Railway, GHL OAuth/SSO, NMI test mode, and Stripe sandbox/connect testing.

The codebase previously ran with real test data, so treat data paths, debug routes, auth, logs, and tenant access as sensitive.

## Important Boundaries

- Do not trust V1 Make/GHL/Accept.blue architecture as current unless Philip explicitly says it applies.
- Current code, migrations, `CLAUDE.md`, and `docs\CLAUDE_CODE_CODEX_LOG.md` override older planning docs.
- Do not revert Codex security hardening unless Philip explicitly asks.
- Never commit `.env`, credentials, tokens, database strings, or copied customer/client data.
- Every meaningful change should update `CHANGELOG.md` if it is headed toward a commit.

## Current Codex Security Work

Completed and pushed by Codex/Claude Code:

- `/api/debug/*` routes are gated by `DEBUG_ADMIN_TOKEN` or `ADMIN_DEBUG_TOKEN`.
- `x-location-id` is no longer normal production auth; it only works in explicit dev/test mode.
- Dispute and EFW routes require SSO, tenant context, and verified merchant ownership.
- Dashboard recovered-value totals are tenant-scoped and use `amount_recovered`.
- Legacy enrollment `/prep` and `/offer/:id` routes now require SSO and tenant context.
- Full Jest suite is green: 45 suites / 506 tests at last Codex verification.

Open security item:

- Public client-service links for payment update, subscription cancellation, and milestone signoff should move from `locationId + contactId` query params to signed, short-lived action tokens.

## Verification Expectations

Use:

```powershell
npm.cmd run typecheck
npm.cmd test -- --runInBand
```

If a targeted test fails, distinguish new regression from known drift documented in `docs\CLAUDE_CODE_CODEX_LOG.md`.

## End-Of-Session Rule

Before ending a meaningful Claude Code session where Philip explicitly asked you to make changes, update:

`docs\CLAUDE_CODE_CODEX_LOG.md`

Include:

- What changed
- Why it changed
- Verification run
- Known failures or risks
- Recommended next step
