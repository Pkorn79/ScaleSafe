# Command Center And Guardian Independent Architecture Review

**Status:** Ten-lane Fable review completed and independently reconciled by Codex  
**Architecture baseline:** `008b3bf68eaaa7f2dc825399b05acba70c1fba66` on `codex/beta-remediation`  
**Production reference at review start:** `67d9ea3f40d8882b0bbcd32163f0736261257597`  
**Database schema:** 102  
**Review date:** 2026-07-22

## Executive Verdict

**Conditional architecture approval.** The original direction was sound, but implementation should not start from the unreconciled draft. The reviewed architecture is acceptable only with the amendments now incorporated into `COMMAND_CENTER_GUARDIAN_ARCHITECTURE_PLAN.md`.

No production code, SQL, provider configuration, or deployment was changed during this review. Phase 1 remains blocked on Philip's owner-decision approval and creation of an isolated staging context.

## Review Method

Fable ran ten independent lanes:

1. Current-state verification.
2. Authentication, authorization, and tenant isolation.
3. Data model, migrations, and concurrency.
4. Observability, incidents, and alerting.
5. Scale and performance.
6. Guardian and backup-boundary security.
7. Reseller product/privacy boundary.
8. Operator UX and action safety.
9. Adversarial architecture review.
10. Cross-lane coherence and phase sequencing.

Codex then checked the load-bearing findings against current code and migrations. This document records the consolidated result rather than copying the ten raw temporary reports into the repository.

## Verified Current-State Corrections

1. **Two legacy privileged token surfaces exist.** `src/routes/hq-admin.routes.ts:39-49` protects HQ with `SCALESAFE_HQ_ADMIN_TOKEN`. `src/routes/health.routes.ts:14-39,65` protects `/api/debug/*` with `DEBUG_ADMIN_TOKEN` or `ADMIN_DEBUG_TOKEN`; mutating routes include GHL contact repair/backfill and a Storage write test. Both surfaces require a retirement or break-glass disposition.

2. **Current audit is best effort.** `src/routes/hq-admin.routes.ts:63-82` catches audit-write failures and allows the request to continue. The new mutation model must require a durable audit-intent write before execution.

3. **The current HQ list does per-merchant fan-out.** `src/routes/hq-admin.routes.ts:173-178` maps every merchant through a query-heavy overview. This cannot be the master dashboard read path at hundreds or thousands of merchants.

4. **The operator route namespace is not fail-closed today.** `src/app.ts:65-72` omits `/internal` from the SPA catch-all exclusion. An unmatched internal GET can return merchant SPA HTML with status 200.

5. **Proxy/IP assumptions are not yet trustworthy.** `src/app.ts` has no explicit `trust proxy` configuration, while `src/routes/hq-admin.routes.ts:56-60` and several public controllers trust the first raw `x-forwarded-for` value. `src/middleware/rateLimiter.ts:8-41` is also in-memory and per instance.

6. **Schema readiness lags the deployed schema.** `src/services/schema-readiness.service.ts:3` requires version 99 while the repository/live schema is 102. `src/routes/health.routes.ts:57-58` also contains an obsolete migration-099 message. Each migration-dependent release must advance its required schema version in lockstep.

7. **Scheduled jobs are boot-relative.** `src/index.ts:41-59` uses in-process intervals. Frequent deployments can defer a nominal daily job, and no durable run key proves one scheduled window executed exactly once.

8. **Adaptive workers can hang without process death.** `src/utils/adaptive-poller.ts:81-108` prevents overlap and adapts cadence, but it has no task timeout. Heartbeat truth must record completed ticks, not merely process liveness.

9. **The daily health job is broader than the draft stated.** It checks Stripe and NMI chargeback ratios and already uses GHL warning/critical triggers. Platform incidents should reference that merchant-facing path rather than duplicate merchant notifications.

10. **Database lockdown is stronger than the first draft stated.** Migration 059 forces RLS across the public schema, revokes public/anon/authenticated grants, and sets restrictive default privileges. Migration 098 re-locks later drifted tables, and migration 102 is the current minimum new-table pattern.

11. **Guardian cannot read the existing backup verifier safely as-is.** `ops/recovery/verify-latest.sh:7-18` sources the full backup environment. `ops/recovery/backup.env.example:5-11` includes a write-capable production database URL and Storage credentials. The backup service must write a sanitized status drop file for Guardian.

12. **Merchant reinstall does not currently mint a replacement merchant row.** `src/repositories/merchant.repository.ts:198-230` upserts on `location_id`, preserving the existing row. The Fable claim that uninstall/reinstall necessarily changes the merchant UUID is rejected. Assignments still use `location_id` because it is ScaleSafe's durable tenant authority and avoids coupling authorization to an implementation row ID.

## Accepted Blocking Amendments

### Dedicated Operator Origin

The operator SPA must use a dedicated hostname such as `ops.scalesafe.app`, with a host-only `__Host-` session cookie. Sharing one backend/codebase remains correct; sharing a browser origin with public checkout and merchant pages does not. Same-origin injected script can ride an HttpOnly operator cookie and read operator responses even when SameSite and CSRF protections exist.

### Live Authorization Inputs

Session validity, user/membership status, reseller assignments, and support grants are read from current authoritative state for every request. Presentation payloads may be cached after authorization, but a time-based cache never decides access. A denormalized reseller field in a rollup may filter results but never expands the live allowed-location set.

### Legacy Credential Cutover

Phase 4 owns one explicit cutover for HQ and debug token families. Every human/non-human consumer is inventoried, attributed replacement access is certified, legacy values are rotated/unset, disabled routes return 404, and a distinct owner-only break-glass credential remains disabled by default.

### Guardian And Backup Isolation

Guardian uses a separate Linux service account with no `sudo`, Docker group, backup environment, database URL, Storage key, decryption identity, deploy token, or processor credential. It receives a sanitized backup-status drop file. The architecture promise is limited to Guardian service-account compromise. Root compromise of the current shared VPS can reach the backup engine's production credentials; that residual risk must be explicitly accepted for controlled beta or removed with a separate monitoring host.

### Out-Of-Band Incident Survival

Critical outage alerting and acknowledgement cannot depend solely on ScaleSafe/Supabase. Guardian retains minimal local alert state, sends through an independent provider, supports an out-of-band acknowledgement/dead-man path, and reconciles after recovery. One-level parent suppression prevents one Supabase/Railway outage from opening hundreds of independent alerts.

### Merchant Health Ownership

Merchant/provider health reconciliation runs as a database-leased, set-based ScaleSafe application job because the application already has merchant/provider context. Guardian observes its freshness and aggregate result. Guardian does not receive merchant processor credentials or perform per-merchant polling.

### Audit And Action Safety

Every deny path is audited. A durable audit-intent write is a precondition for mutation. First repair actions are limited to cases with machine-verifiable idempotency and authoritative results. Generic workflow-field replay was removed because field synchronization may be coupled to a customer-facing GHL trigger; it may return only after the durable job records whether GHL was never called.

### Staging And Marketplace Isolation

The Command Center workstream stays off `main`, which auto-deploys. Live SQL is also a production change. An isolated Railway service and scratch Supabase project are required before Phase 1 certification. Nothing merges, migrates, or enables in production while the app is under Marketplace review without explicit owner approval.

## Accepted High-Priority Amendments

- Use Ed25519 signatures with a monotonic sequence for Guardian ingestion; ScaleSafe stores only the public verification key.
- Write health observations on state transition plus bounded confirmation, not every unchanged poll.
- Enforce one open incident per dedupe key with a partial unique index and atomic upsert.
- Heartbeat worker types at completed ticks, add task timeouts, and use durable scheduled-window run keys.
- Keep support grants platform-user-only in v1; no cross-reseller access.
- Build reseller data from strict allowlisted read models/DTOs; never filter raw free-text errors into a reseller response.
- Distinguish freshness unknown, provider-outcome unknown, retry-budget exhaustion, and active retry in storage and UI.
- Use one active operator organization per user in v1 to keep session context unambiguous.
- Require migrations to be idempotent, advance `scalesafe_schema_version()`, and raise the application's required schema version in the dependent release.
- Split platform publication after Phase 4 from reseller publication after Phase 5.

## Qualified Findings

1. **VPS compromise:** Fable correctly found that VPS root can reach co-resident backup credentials. It is not correct to describe a Guardian service-account compromise as automatically equivalent to root compromise. The plan now states both boundaries separately.

2. **Assignment key:** `location_id` is accepted as the durable authorization key. The supporting claim that current reinstall behavior replaces the merchant UUID is rejected, as documented above.

3. **Supabase Auth:** accepted only as a server-side credential/MFA backend with an app-owned opaque cookie. The exact current MFA/session flow must be verified against official Supabase documentation before implementation.

4. **Railway/GitHub checks:** included only when a tokenless or narrowly read-only source is proven. Permanently unknown panels and broad deploy tokens are not acceptable.

5. **Weekly backup verification:** Guardian may perform decryption-free encrypted-object/hash checks if safe metadata permits. Full restore remains a human-run isolated drill because the decryption identity stays offline.

## Rejected Or Deferred Complexity

- No generic incident dependency DAG in v1; one parent level is sufficient.
- No daily/13-month health aggregate tables until real trend requirements justify them.
- No speculative read-only Postgres monitoring role for Guardian in the first release.
- No cross-reseller support grants in v1.
- No reseller exports, direct client data, payment dollar totals, or communication actions in v1.
- Unused platform roles may exist in schema but remain disabled and uncertified until first use.
- No generic arbitrary action runner, SQL runner, URL caller, provider payload sender, or AI-directed repair executor.
- No promise that compromise of the shared VPS root lacks production mutation ability while backup credentials remain on that host.

## Phase Readiness

| Phase | Review disposition | Blocking prerequisite |
| --- | --- | --- |
| 0 - Architecture | Ready for owner approval | Approve recommended defaults and resolve genuinely open decisions |
| 1 - Identity and isolation | Not started | Dedicated operator hostname and isolated staging context |
| 2 - Health and incidents | Not started | Phase 1 gate plus owner-approved thresholds/resource budget |
| 3 - Guardian and alerting | Not started | Alert provider, VPS-risk decision, sanitized backup status handoff |
| 4 - Platform dashboard | Not started | Phases 1-3 certified and legacy-token cutover runbook |
| 5 - Reseller dashboard | Not started | Platform published, disclosure decision, two-reseller isolation dataset |
| 6 - Controlled actions | Not started | Read-only operation proven and each action individually certified |
| 7 - Optimization | Deferred | Real beta operating data |

## Owner Approval Point

The reconciled plan's Section 19 separates recommended defaults that can be approved as one batch from genuinely open choices. No implementation or migration should begin until that approval is recorded.
