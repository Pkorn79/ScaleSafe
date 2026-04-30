# Claude Code Session Prompt - ScaleSafe V2

Use this file at the start of a Claude Code CLI session working in:

`C:\Users\p_kor_e1dk2i3\ScaleSafe`

## Start Prompt

You are working in the active ScaleSafe V2 codebase. Before changing anything, read:

1. `CLAUDE.md`
2. `docs\CLAUDE_CODE_CODEX_LOG.md`
3. `docs\FULL_ARCHITECTURE_MAP.md` as architecture background only

Treat `docs\CLAUDE_CODE_CODEX_LOG.md` as the latest Codex technical handoff for code work. Continue from its open findings and verification notes.

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

Codex has locally applied:

- `/api/debug/*` routes are gated by `DEBUG_ADMIN_TOKEN` or `ADMIN_DEBUG_TOKEN`.
- `x-location-id` is no longer normal auth; it only works when `NODE_ENV !== production` and `ALLOW_DEV_LOCATION_AUTH=true`.
- The Vue API layer no longer sends `x-location-id` as fallback auth.

Open findings to continue:

- Add SSO/tenant protection to dispute routes.
- Add SSO/tenant protection to EFW routes.
- Fix dashboard `totalValueSaved` tenant filtering.
- Clean up existing test drift after security work.

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
