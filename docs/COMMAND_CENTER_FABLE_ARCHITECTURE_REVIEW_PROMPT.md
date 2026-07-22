# Fable Review Prompt: ScaleSafe Command Center And Guardian

```text
You are independently reviewing the architecture plan for the ScaleSafe Command Center, Guardian monitoring service, and reseller dashboard.

This is an ARCHITECTURE AUDIT ONLY.

Do not write code, edit files, create migrations, change configuration, access live providers, commit, push, deploy, or mutate any database or external system.

PRIMARY PLAN

Read:

- docs/COMMAND_CENTER_GUARDIAN_ARCHITECTURE_PLAN.md

CURRENT IMPLEMENTATION SOURCES

Treat current code and migrations as implementation truth. Use the following as starting points, then follow their dependencies:

- src/routes/hq-admin.routes.ts
- src/routes/health.routes.ts
- src/index.ts
- src/config.ts
- src/middleware/ssoAuth.ts
- src/services/schema-readiness.service.ts
- src/services/money-reconciliation-worker.ts
- src/services/defense-compilation-worker.ts
- src/services/evidence-connector-worker.ts
- src/services/trigger-delivery-worker.ts
- src/services/provider-outcome-resolution.service.ts
- src/services/marketplace-entitlement.service.ts
- src/repositories/merchant.repository.ts
- src/utils/logger.ts
- supabase/migrations/046_rls_lockdown.sql
- supabase/migrations/082_turnstile_and_hq_admin.sql
- supabase/migrations/098_durable_money_operations.sql
- supabase/migrations/099_durable_trigger_delivery_jobs.sql
- supabase/migrations/102_marketplace_entitlements.sql
- ops/recovery/README.md
- docs/RECOVERY_DRILL_2026-07-21.md
- docs/MASTER_INDEX.md
- docs/PROJECT_DECISIONS.md
- docs/CHARGEBACK_REDUCTION_POSITIONING_AND_ROADMAP.md

BASELINE

Before analysis, record:

- Current branch.
- git rev-parse HEAD.
- git status --porcelain.
- Latest migration number.

Expected planning baseline when this prompt was written:

- Branch: codex/beta-remediation
- HEAD: 008b3bf68eaaa7f2dc825399b05acba70c1fba66
- Database schema represented in the repo: 102

If the repository has moved, identify the difference and review the newer clean baseline. Do not assume that stale file names remain current.

PRODUCT OBJECTIVE

ScaleSafe needs one secure operations system with:

- A platform-owner/master seller dashboard across all merchants.
- Deterministic health monitoring and independent alerting.
- Incident tracking and operational diagnostics.
- A restricted reseller dashboard showing only assigned merchant accounts.
- Carefully approved repair actions in a later phase.
- Strong tenant isolation for hundreds and eventually thousands of merchants.

The system must not expose one merchant to another, one reseller to another, or merchant/payment secrets to operators who do not need them.

ESTABLISHED BOUNDARIES

- Merchant identity remains GHL SSO and trusted location_id context.
- Platform/reseller identity needs a separate invite-only identity system.
- The current static HQ token is not sufficient as the final identity system.
- One operations backend should serve role-filtered platform and reseller views.
- Guardian runs on the always-on VPS and must remain useful when Railway or Supabase is down.
- Deterministic checks create health truth. AI may summarize only.
- Guardian does not deploy, restore production, rotate secrets, charge, refund, pause, cancel, or mutate merchant/payment data.
- Read-only platform and reseller views ship before repair actions.
- Browser-supplied location_id, role, organization, or assignment is never authoritative.
- The existing encrypted backup and scratch-restore system is already implemented and certified. Guardian consumes its proof rather than replacing it.
- Development must not disrupt the GHL Marketplace application while it is under review.

REVIEW METHOD

Use independent review agents in controlled waves. No more than four agents should run concurrently. Preserve each lane's report before synthesis.

Wave A:

1. CURRENT-STATE VERIFIER
   Confirm or reject every material statement in sections 4 and 5 of the plan against current code, migrations, and recovery documentation. Identify important existing capabilities the plan missed.

2. AUTHENTICATION, AUTHORIZATION, AND TENANT-ISOLATION REVIEWER
   Threat-model operator identity, sessions, MFA, organizations, reseller assignments, support grants, authorization context, break-glass access, CSRF, XSS, cache invalidation, and denied-access auditing.

3. DATA MODEL AND CONCURRENCY REVIEWER
   Review proposed tables, keys, constraints, partial uniqueness, RLS posture, assignment transfers, support-grant expiry, health rollups, incident deduplication, action idempotency, migrations, and retention.

4. OBSERVABILITY AND INCIDENT-RESPONSE REVIEWER
   Review check coverage, health states, thresholds, worker/job heartbeats, queue/backlog visibility, incident lifecycle, alert routing, outage independence, recovery proof, and alert-noise controls.

Wave B:

5. SCALE AND PERFORMANCE REVIEWER
   Determine whether the plan avoids the existing per-merchant query fan-out and remains viable at 100, 1,000, and 10,000 merchants. Review write cadence, batching, polling, provider limits, indexes, rollups, pagination, retention, and Supabase pressure.

6. GUARDIAN SECURITY REVIEWER
   Threat-model the VPS, Guardian credentials, signed ingestion, replay protection, local reports, independent alerts, Railway/GitHub/Supabase access, backup verification, and compromise blast radius.

7. RESELLER PRODUCT-BOUNDARY REVIEWER
   Review whether account-level reseller visibility is useful while avoiding client PII, payment secrets, cross-reseller leakage, hidden impersonation, and ambiguous account ownership. Identify decisions that truly require the owner.

8. OPERATOR-UX AND ACTION-SAFETY REVIEWER
   Review the proposed Command Center information architecture, unknown/stale states, incident workflow, audit discoverability, safe-action registry, step-up approval, idempotency, and authoritative post-action proof.

Wave C:

9. ADVERSARIAL ARCHITECTURE REVIEWER
   Attempt to break the combined design through cross-tenant requests, stale assignments, compromised sessions, compromised VPS, DB outage, alert outage, provider ambiguity, duplicate action requests, XSS/CSRF, and health-data poisoning.

10. PLAN COHERENCE REVIEWER
    Find contradictions, missing phase dependencies, gates that cannot actually prove completion, migration/deployment ordering problems, and places where the plan adds complexity without reducing a concrete risk.

REVIEW STANDARDS

- Only report a current-state statement as wrong when backed by exact code, migration, or documentation evidence.
- Separate current code defects from weaknesses in the proposed design.
- Do not treat intentionally deferred repair actions as missing from the read-only release.
- Do not propose generic enterprise features without explaining the concrete ScaleSafe risk they address.
- Do not assume Supabase Auth, Railway APIs, log drains, or provider alert services behave a certain way without either current code evidence or official primary documentation.
- Do not recommend placing the Guardian inside Railway or giving it broad mutation credentials.
- Do not recommend trusting UI hiding, request headers, or browser-supplied tenant fields as authorization.
- Do not expand reseller access to client-level PII merely because it may be convenient.
- Do not require two separate platform and reseller codebases unless a concrete security boundary makes that necessary.

Every proposed amendment must include:

- Priority: BLOCKER, HIGH, MEDIUM, or LOW.
- Plan section affected.
- Exact current-code reference when applicable.
- Concrete failure, attack, scalability, or operator scenario.
- Why the existing plan does or does not cover it.
- Minimal architectural amendment.
- Phase and acceptance test that should own the amendment.
- Whether owner input is required.

QUESTIONS TO ANSWER EXPLICITLY

1. Is a Supabase Auth-backed, server-managed operator session appropriate here? If not, what exact alternative is safer and simpler for this stack?
2. Does one active primary reseller per merchant create any unacceptable operational limitation?
3. Can assignments and session authorization be revoked immediately without relying on unsafe long-lived caches?
4. What is the narrowest Guardian credential model that still permits useful monitoring during a ScaleSafe/Supabase outage?
5. Which checks must run outside ScaleSafe, and which should be event-driven inside ScaleSafe?
6. How should worker/job heartbeats avoid creating database pressure?
7. Is the proposed merchant health rollup sufficient to eliminate O(merchants) query fan-out?
8. Which incidents must bypass debounce and suppression?
9. Which low-risk repair actions are genuinely safe for the first action phase?
10. What must be proven before the static HQ token is retired?
11. What must be proven before the first reseller receives access?
12. What changes, if any, could interfere with the current GHL Marketplace review?

FINAL OUTPUT

Produce one consolidated architecture review:

1. Baseline and files reviewed.
2. Executive verdict:
   - ACCEPT
   - ACCEPT WITH REQUIRED AMENDMENTS
   - REWORK REQUIRED
3. Verified current-state corrections.
4. Required plan amendments ordered by priority.
5. Rejected or unnecessary complexity.
6. Owner decisions that cannot be safely inferred.
7. Revised phase dependencies and completion gates.
8. Final pre-implementation checklist.

Do not edit the plan. Do not implement anything. The result will be reconciled against the repository before the architecture is approved.
```
