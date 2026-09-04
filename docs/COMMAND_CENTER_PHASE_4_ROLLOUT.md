# Command Center Phase 4 Rollout

**Status:** Integrated schema 112 release candidate and owner MFA login passed in isolation; production rollout pending
**Production authorization:** Not granted
**Last documented production schema:** 106; verify the real project and version before any migration
**Release migrations:** 107 through 112
**Operator hostname:** `ops.scalesafe.app`

## Outcome

Phase 4 provides an owner-authenticated ScaleSafe Command Center with read-only merchant and payment views. It provides:

- Platform totals and merchant health.
- Merchant installation, plan, processor, integration, workflow, evidence, payment, and defense summaries.
- Incidents with exact details, authoritative links, runbooks, audited acknowledgement, and time-bounded suppression.
- Recovery, deployment, reseller, and audit views.
- Invite-only Supabase Auth login with mandatory TOTP MFA.
- Tenant-scoped support access and reseller-safe read models.

It does not expose payment, refund, cancellation, replay, credential, plan approval, or other repair controls.

## Temporary Beta Exception

The existing token-protected HQ console remains available only to the platform owner for current beta operations that Phase 4 does not replace yet:

- Marketplace test/free access approval.
- WholePay plan approval.
- Provider outcome resolution.
- Existing connector setup and support actions.

This is a temporary compatibility surface, not the Command Center authentication model. Resellers and support users receive no access. Its replacement must be built as attributed, audited actions in Phase 6 before the token is retired. Debug routes remain disabled in production unless the owner explicitly authorizes a time-bounded incident procedure.

## Release Units

### A. Enrollment Lifecycle And Processor-Binding Fixes

The historical cancellation fix and the independently reproduced Fable payment/security findings are integrated into the release candidate through `adff345`. They are tested but not authorized for production by this document.

- Cancelling a fully paid finite installment enrollment with no future billing records the requested cancellation and stops ScaleSafe activity without requiring an impossible call to a disconnected processor.
- Cancellation clears the next billing date and disables future pulse scheduling.
- Historical processor references remain intact.
- Active recurring Stripe enrollments still require an authoritative processor cancellation.
- Whop remains processor-backed because membership access is provider controlled.
- Enrollments, payment events, payment methods, webhooks, retries, and lifecycle actions remain bound to the exact Stripe or NMI configuration that created them.
- Ambiguous active recurring records fail closed instead of selecting an arbitrary active processor configuration.

After an approved deployment and approval of the account action, cancel only the three confirmed PMG enrollments for Phil Kay and verify that no future pulse is due. Do not call the disconnected Stripe account for those three fully paid historical records.

### B. Read-Only Command Center And Database Integrity

Deploy only the missing migrations from 107 through 112 before enabling Command Center code paths. Migration 111 adds Stripe EFW integrity; migration 112 adds immutable processor ownership and configuration-aware payment idempotency. All flags remain false during the code deploy.

## Required Preflight

1. Record the final release SHA and current production deployment SHA. Fable's confirmed payment/security findings are reconciled through `adff345`; rerun every gate after any later integration change.
2. Identify the real ScaleSafe project by matching the existing production Railway service's `SUPABASE_URL` project reference, not a dashboard display name. Record the reference without credentials. Read the actual schema version, compare the live schema with the expected baseline, and run `supabase/security/check_command_center_rollout.sql` at the supported pre-migration version. Stop on drift, pre-existing conflicting objects, or any unexpected version.
3. Confirm the latest encrypted off-platform backup is healthy.
4. Run the full backend tests, typecheck, application build, UI build, secret scan, and production dependency audit.
5. Replay the full chain through 111 in a fresh isolated database, run `supabase/security/preflight_migration_112.sql`, apply migration 112, and run `verify_migration_112.sql` plus the post-migration catalog gate.
6. Prove anon and authenticated database roles cannot read operator or Guardian tables or invoke service-only functions.
7. Prove all operator functions return tenant-safe allowlisted data.
8. Seed at least 10,000 merchant rollup rows and certify the worst supported filters against the approved latency target.
9. Complete poison-data, cross-reseller, expired-grant, revoked-session, cursor, filter, and exact-count tests.
10. Complete desktop and mobile browser checks with no console errors. See [Phase 4 Certification](COMMAND_CENTER_PHASE_4_CERTIFICATION.md) for completed isolated evidence and remaining live checks.

The isolated 106-to-110 upgrade, role boundaries, poison-data checks, and 10,002-merchant performance test passed on September 4. A separate fresh replay through schema 111, aggregate preflight, exact 111-to-112 upgrade, rollback-only verifier, and schema 112 catalog gate also passed. Only missing migrations 107-112 go to production. Historical migration repairs, including consolidation of duplicate 055, are for fresh/recovery replay; do not replay 001-106 against the live database.

Any failed preflight item stops the rollout.

## Read-Only Production Preflight Snapshot

Recorded September 4, 2026 without changing production:

- Railway project `pure-renewal`, production service `ScaleSafe`, is online at `https://dashboard.scalesafe.app`.
- Current successful deployment is `c3b9a20c-c221-456c-ab96-424eba36de1a` from `main` commit `821c1c57a920216c8b79617f7a9722d0f457e199`.
- Railway's production `SUPABASE_URL` identifies project `zddyagfotdtfbcdursqu`, matching the repository's linked project reference.
- The service-only `scalesafe_schema_version()` RPC returned `106` using a server-identifying request. No secret value was printed or written.
- Read-only PostgREST OpenAPI metadata shows the migration 106 merchant-access and Stripe-mode columns, no Command Center tables or routines, and no migration 112 processor-binding columns. This rules out an API-visible partial rollout, but does not replace the direct PostgreSQL catalog gate.
- `/health` returned healthy with app, Supabase, and schema checks all `ok`.
- Railway reported no error-level application logs during the sampled 24-hour window. It reported two HTTP 500 responses on `/api/payments/lifecycle/enrollment/status`; both correlate to the known test-Stripe connection/live-platform mismatch during the three historical cancellation attempts. The candidate contains the tested fully paid historical cancellation correction.
- `scalesafe-backup.timer` and `scalesafe-backup-status.timer` are active and waiting; their latest services report `Result=success` and `ExecMainStatus=0`. The status publisher's successful run proves its internal latest-snapshot verification returned healthy.

Remaining preflight item: run the checksum-verified, forced-read-only catalog checker through the existing VPS backup database connection. The prepared wrapper is `/home/clawuser/run-command-center-production-preflight.sh`; it refuses any project other than `zddyagfotdtfbcdursqu` and cannot write because `default_transaction_read_only=on` is enforced. It requires one interactive VPS sudo-password entry. Do not apply migrations after this check without separate approval.

## Dependency Audit Disposition

The release lockfile pins patched `qs`, `ip-address`, and Nano ID versions. Two upstream areas remain explicit, bounded exceptions:

- `sanitize-html` remains on the currently compatible release. ScaleSafe permits only a narrow tag and attribute allowlist for merchant terms, excludes the vulnerable form/media attributes and tags, blocks unsafe URL schemes, and serves the result under a restrictive CSP. The upstream fixed release changes its parser module boundary and must pass a separate Node 20/Jest compatibility change before adoption.
- Puppeteer's browser-download helper includes the flagged archive extractor. Production never accepts or extracts a browser archive: the PDF renderer launches the fixed system Chromium path installed in the application image. Removing that dependency requires the separately tested Node 22 plus Puppeteer 25 renderer upgrade.

These are owner-visible launch exceptions, not claims of a zero-finding audit. Re-test both paths and remove the exceptions in the dependency upgrade release.

## Production Rollout Order

Obtain explicit approval for the bounded production change window before starting. Preparation approval is not deployment approval. Stop at any failed gate without advancing or broadening the authorized scope.

1. Complete the remaining direct SQL catalog preflight above. Apply only the missing migrations from 107, 108, 109, 110, 111, and 112 in order. Migration 112 may run only after its aggregate preflight at schema 111 reports `ready` or an explicitly reviewed safe backfill condition. Confirm `scalesafe_schema_version()` returns 112 and the post-migration catalog gate passes. The behavioral SQL fixtures belong only in the disposable database, never production.
2. Deploy the approved release with every new flag false.
3. Add `ops.scalesafe.app` to the existing application service and verify DNS, TLS, exact host routing, and a disabled-route `404`.
4. Verify the actual Railway/Cloudflare proxy chain, then set `APP_TRUST_PROXY_HOPS` before deploying the candidate. This changes global Express client-IP handling and is required for safe per-client rate limiting. Check both origin and proxied access; do not guess a hop count. Add the documented operator variables and a new 32-byte operator encryption key. The operator key must differ from the processor encryption key. Use the publishable/anon Auth key from the same confirmed ScaleSafe project.
5. Enable Supabase TOTP enrollment and verification on that confirmed project. Create and email-confirm Philip's dedicated Supabase Auth user using the approved private credential setup flow. Never put his password or TOTP secret in chat, Git, or release logs.
6. Invoke `bootstrap_platform_owner` once for that exact Auth user and email. The second-owner refusal must be tested only in isolation; do not attempt a second production bootstrap as a test.
7. Enable `OPERATOR_COMMAND_CENTER_ENABLED=true` and `OPERATOR_AUTH_ENABLED=true`. Keep health and Guardian ingestion disabled.
8. Sign in at `https://ops.scalesafe.app`, enroll TOTP MFA, and verify the authenticated session endpoint, host-only secure cookies, logout, session revocation, and a fresh MFA login. Health-dependent dashboard endpoints remain unavailable at this stage; do not interpret that as a failed login.
9. Enable `OPERATOR_HEALTH_INCIDENTS_ENABLED=true` only within the approved window. This switches existing scheduled jobs to the durable coordinator and starts health reconciliation; it is not just a display toggle. Verify lease ownership, absence of duplicate job execution, and continuity of existing merchant workers.
10. Verify overview totals, PMG and WholePay merchant detail, filters, exact incident detail, runbook deep links, recovery status, and audit attribution. Require two consecutive healthy observations for the enabled app checks; investigate any unknown or unhealthy result. Recovery data must remain explicitly unknown until current Guardian evidence arrives. Do not fabricate health to pass a gate.
11. Guardian activation is a separate approval boundary. Enable `GUARDIAN_INGESTION_ENABLED=true` only after the signed Guardian credential, dedicated host, build SHA, and external alert delivery are current. Prove one signed observation, one rejected replay, and one recovery event. Do not change existing VPS services, timers, GHL routing, or Better Stack monitors as a side effect of owner-dashboard rollout.

Philip's required participation is private password setup and authenticator enrollment. After the owner acceptance checks pass, provide the real login URL and a short access handoff. Keep reseller/support invitations and assignments out of the initial owner rollout until their production role-scoped acceptance is complete.

## Owner Login Acceptance

- Only the dedicated operator hostname serves the login and Command Center.
- Merchant GHL SSO cannot authorize any operator endpoint.
- Password verification occurs through Supabase Auth and TOTP MFA is mandatory.
- One owner session can view platform totals and exact merchant details.
- A support user cannot enumerate the merchant portfolio without a current approved grant.
- A reseller cannot see another reseller's merchants, totals, incidents, payment amounts, clients, or evidence.
- No Command Center page exposes secrets, raw provider payloads, unrestricted metadata, or permanent private file URLs.
- Merchant/payment data cannot be changed through the Command Center. Incident acknowledgement and time-bounded suppression require permission, CSRF validation, and attributable audit events.
- Localhost browser testing is not production TLS proof. Repeat secure-cookie, exact-origin, host isolation, and forwarded-client-IP checks on the real domain before declaring access ready.

## Rollback

Rollback is feature-first and non-destructive:

1. Set `GUARDIAN_INGESTION_ENABLED=false`.
2. Set `OPERATOR_HEALTH_INCIDENTS_ENABLED=false`.
3. Set `OPERATOR_AUTH_ENABLED=false`.
4. Set `OPERATOR_COMMAND_CENTER_ENABLED=false`.
5. Verify every `/internal/*` route and the operator hostname return the expected disabled response.
6. Revoke active operator sessions if identity compromise is suspected.
7. Roll application code back only when the prior release is compatible with schema 112. Keep the new flags false, verify merchant health/checkout/GHL SSO, and confirm the original scheduled jobs resume without overlap.

Do not reverse migrations 107 through 112 during an incident. The Command Center additions remain service-role-only and feature-gated while their flags are false; processor bindings are additive integrity data used by the approved candidate.

## Release Evidence

Preserve:

- Approved Git SHA and Railway deployment ID.
- Production schema version before and after migration.
- Isolated migration and 10,000-row certification output.
- Full test, typecheck, and build output.
- Owner MFA login and logout proof.
- Cross-role and cross-tenant denial proof.
- Guardian signature, replay-rejection, alert, and recovery proof.
- PMG enrollment cancellation result and pulse-disabled verification.
- Rollback verification.

## Fable Reconciliation

- Fable reproduced the reported payment and public-surface defects on `fable/audit-remediation`; Codex reviewed and reconciled the confirmed behaviors into this release candidate.
- The integrated implementation does not assume one active processor account per merchant. It carries exact processor configuration identity through all money and lifecycle paths and enforces that ownership in migration 112.
- Focused payment/migration coverage, the full 1,768-test backend suite, typecheck, UI build, isolated migration verifier, and schema 112 catalog gate passed on the integrated candidate.
- Any later Fable or Codex change must land in a release-integration branch and repeat the full suite, migration replay, role checks, and build.
- No agent may push `main`, deploy, or change the production database without explicit approval.

## Stop Conditions

Stop and leave the new flags off for any:

- Cross-tenant or cross-reseller access.
- Wrong or non-exact platform count.
- Missing audit attribution.
- Schema mismatch or partial migration.
- Operator route reachable from the merchant host.
- Unknown state presented as healthy.
- Payment or enrollment mutation exposed through the read-only Command Center.
- Unexpected impact to checkout, GHL SSO, Marketplace installation, evidence, defense, or existing Guardian delivery.
