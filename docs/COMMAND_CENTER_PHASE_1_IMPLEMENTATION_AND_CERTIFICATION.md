# Command Center Phase 1 Implementation And Certification

**Status:** Isolated staging certification passed on `codex/beta-remediation`
**Owner approval:** Recommended Phase 1 defaults approved 2026-07-22
**Production state:** Unchanged; schema 102 and operator features disabled
**Certified staging schema:** Migration 103
**Implementation baseline:** `986ee98be0fd1d985fdb23c8e11778bf91539482`
**Certification date:** 2026-07-22

## Purpose

Phase 1 establishes the Command Center identity and tenant-authorization foundation. It does not publish the master dashboard, Guardian monitoring, reseller dashboard, or repair actions.

## Implemented Scope

- Dedicated operator hostname enforcement.
- Independent operator identity plane; GHL merchant identity cannot authorize operator routes.
- Server-side Supabase Auth password verification and TOTP MFA.
- App-owned opaque browser sessions; Supabase access and refresh tokens stay server-side.
- `__Host-` Secure, SameSite=Strict cookies and exact-origin CSRF validation.
- Live session, user, membership, organization, assignment, and support-grant checks on every request.
- Platform and reseller organizations with one active organization per operator in v1.
- One active primary reseller assignment per GHL `location_id`.
- Platform-support access only through named, expiring, two-person-approved grants.
- Single-use invitations bound to the exact Supabase user and confirmed email.
- Append-only operator audit events, durable audit intent before privileged mutation, and database-backed auth rate limits.
- Explicit JSON `404` for disabled or unknown `/internal/*` routes.
- Startup refusal for invalid/reused operator credential-encryption keys.

## Default-Off Controls

The code is inert unless both flags are enabled:

```text
OPERATOR_COMMAND_CENTER_ENABLED=false
OPERATOR_AUTH_ENABLED=false
```

When disabled, no operator page or API is available. The existing merchant application, GHL SSO, Marketplace install, payment, evidence, and defense routes remain unchanged.

## Certified Isolated Staging

The certification used a separate Railway project/service and a separate Supabase project. Neither environment received production traffic, data, payment credentials, webhook credentials, or GHL credentials. The isolated service used:

```text
OPERATOR_COMMAND_CENTER_ENABLED=true
OPERATOR_AUTH_ENABLED=true
OPERATOR_HOST=<dedicated staging hostname>
OPERATOR_TRUST_PROXY_HOPS=<verified Railway proxy hop count>
SUPABASE_PUBLISHABLE_KEY=<scratch project publishable/anon key>
OPERATOR_AUTH_TOKEN_ENCRYPTION_KEY=<new 32-byte hex or base64 key>
```

The operator encryption key must be distinct from `PROCESSOR_ENCRYPTION_KEY`. Do not copy production processor, webhook, payment, or merchant credentials into this environment.

## Migration And Bootstrap Order Used

1. Confirm the service and database are isolated from production.
2. Review migration 103 against the scratch schema.
3. Apply migration 103 to the scratch project only.
4. Confirm `scalesafe_schema_version()` returns `103`.
5. Confirm anon/authenticated roles cannot read or mutate any operator table or call operator RPCs.
6. Create and email-confirm one scratch Supabase Auth user for the platform owner.
7. Call `bootstrap_platform_owner(auth_user_id, email, display_name)` once through an owner-controlled scratch-database session.
8. Configure the staging hostname and verify TLS before enabling both flags.
9. Sign in and enroll TOTP through the operator page.

The bootstrap RPC refuses to create a second active platform owner. Additional users must use the invitation flow.

## Certification Results

The automated staging harness completed 62 requirements. One initial report showed 61/62 because the harness expected an obsolete action label; the runtime and audit record correctly used `merchant.summary.read`. Reconciliation confirmed all 62 requirements.

### Host And Identity Isolation

- Passed: flags off made every operator route return the same JSON `404`.
- Passed: wrong host returned `404`, including with an operator session.
- Passed: unknown `/internal/*` returned JSON `404`, never merchant SPA HTML.
- Passed: mixed GHL/operator identity was rejected with `400` before authorization.
- Passed: an operator cookie did not authorize the merchant dashboard route.

### Authentication And Sessions

- Passed: wrong password returned `401` and created no operator session.
- Passed: first login enrolled TOTP; returning login required MFA verification.
- Passed: the owner session reached AAL2 before the app session was issued.
- Passed: browser cookies contained only app-owned opaque tokens.
- Passed: session and pending cookies were Secure, host-only, SameSite=Strict, and HttpOnly; the CSRF cookie remained readable only for double-submit validation.
- Passed: missing/mismatched CSRF and wrong Origin returned `403`.
- Passed: suspending the user, membership, or organization invalidated the next request; restoring each restored access. Logout immediately revoked the session.

### Invitations And Roles

- Passed: invitation links used a one-time fragment token and were single-use.
- Passed: invited users completed TOTP enrollment before receiving a session.
- Passed: two reseller owners, a second platform owner, platform support, and a security auditor were provisioned with their intended roles.
- Passed: reseller owners could not cross-invite or assign a platform role.
- Passed: replayed invitations failed closed.

### Tenant Authorization

- Passed: two reseller organizations were assigned separate test locations.
- Passed: each reseller could read only its assigned merchant.
- Passed: cross-tenant and nonexistent merchant requests returned the same `404` body.
- Passed: transfer removed old access immediately and granted the new reseller access immediately.
- Passed: concurrent transfers serialized and left exactly one active primary assignment.
- Passed: platform support had no merchant access before a grant, while pending, after expiry, or after revocation.
- Passed: the requester could not approve its own grant; a different platform owner could approve it.
- Passed: the security auditor could read the audit feed but received `404` for merchant summaries.

### Audit And Database Controls

- Passed: a controlled audit-write outage made a sensitive merchant read return `503`.
- Passed: mutation intent/result pairs shared a correlation ID; no incomplete groups remained.
- Passed: audit-row update and delete were rejected, including service-role attempts.
- Passed: database-backed login throttling returned six `401` responses and then `429`.
- Passed: anon and authenticated credentials could not read operator tables or call operator RPCs.
- Passed: the audit feed enforced its 200-row cap.

### Merchant Regression

- Passed by code and regression suite: merchant routes remained separate from operator authentication and an operator cookie could not authorize them.
- Passed by full regression suite: checkout, payments, pulse, milestones, evidence, defense, connectors, and existing HQ/debug behavior remained green.
- Not repeated against a live GHL merchant during this isolated exercise because the scratch service intentionally had no GHL credentials and production/Marketplace review was protected. No merchant implementation was changed by the Phase 1 feature flags.

## Migration Replay Certification

A second disposable Supabase project was created solely to replay the repository from an empty database.

- All 103 migrations ran sequentially with no manual shim.
- `scalesafe_schema_version()` returned `103`.
- Replay completed in 28 seconds.
- The disposable project was deleted after verification.

The replay uncovered and fixed three historical clean-install defects:

- Migration 031 now extends the earlier migration-019 account-health table before indexing newer columns.
- Migration 086 now guards backfills for columns that existed only in a drifted live schema.
- Migration 095 no longer uses PostgreSQL's reserved `authorization` word as an alias.

Permanent static regression tests protect all three fixes.

## Staging Defect Corrected

Creating a reseller with an already-used external reference correctly failed at the database boundary, but the API exposed it as an unhandled `500`. The service now maps that known uniqueness conflict to `409 CONFLICT`, with a focused regression test.

## Operational Observations

- One trigger-delivery worker tick exceeded the scratch Supabase request timeout during a cold/loaded period on nano compute. The worker reported the failure and later ticks continued. This is a Phase 2 health/heartbeat input, not an operator-auth defect.
- Scratch provisioning jobs remained in OAuth-waiting state because the environment intentionally used fake GHL credentials.
- Expected certification traffic produced deliberate `401`, `403`, `404`, `409`, `429`, and one controlled `503` response.

## Verification Completed

- Isolated staging requirements: 62/62 passed after action-label reconciliation.
- Clean database replay: 103/103 migrations passed without shims.
- Focused replay/admin regression: 2 suites, 11 tests passed.
- Full repository suite: 178 suites, 1,442 tests passed.
- TypeScript typecheck: pass.
- Production backend/UI build: pass.
- Patch secret scan: no high-confidence secret hit except the explicit fake Stripe fixture in `tests/setup-env.ts`.
- Dependency advisory lookup: pending explicit approval because npm receives the dependency manifest.
- The first post-certification branch redeploy for commit `b6c41e1` failed before the build started because Railway's internal build-orchestrator snapshot service refused its connection. No ScaleSafe code ran, and the prior certified staging container remained active while the isolated branch deployment was retried.

## Acceptance Gate

**Isolated Phase 1 gate: passed.** The identity, organization, assignment, support-grant, tenant-isolation, audit, database, and route boundaries are certified in isolated staging.

This does not authorize production release. Before any production rollout:

- Philip must explicitly approve migration 103, merge/deployment timing, operator DNS, secrets, bootstrap, and both feature flags.
- Production remains on schema 102 with both operator flags disabled.
- The work remains off `main` while Marketplace review is protected.
- Phase 2 requires its own approved thresholds/resource-budget appendix before implementation.

## Rollback

The immediate code rollback is both flags set to `false`, which makes the routes unavailable. Do not destructively remove migration 103 tables. If a later production release is approved, retain the additive schema and roll code forward after correcting the defect.
