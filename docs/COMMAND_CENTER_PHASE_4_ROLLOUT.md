# Command Center Phase 4 Rollout

**Status:** Isolated database upgrade and owner MFA login passed; production rollout pending
**Production authorization:** Not granted
**Production schema assumed by this branch:** 106; verify before any migration
**Phase 4 migrations:** 107 through 110
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

### A. Historical Enrollment Cancellation Fix

Proposed separate release: the tested cancellation fix at `45a878a` on `codex/enrollment-cancellation-disconnected-stripe`. It has no migration and is not yet included in this Command Center branch. Neither release is authorized for production by this document.

- Cancelling a fully paid finite installment enrollment with no future billing sets its ScaleSafe status to cancelled without requiring a disconnected processor.
- Cancellation clears the next billing date and disables future pulse scheduling.
- Historical processor references remain intact.
- Active recurring Stripe enrollments still require an authoritative processor cancellation.
- Whop remains processor-backed because membership access is provider controlled.

After an approved deployment and approval of the account action, cancel only the three confirmed PMG enrollments for Phil Kay and verify that no future pulse is due. Do not call the disconnected Stripe account for those three fully paid historical records.

### B. Read-Only Command Center

Deploy migrations 107 through 110 before enabling Command Center code paths. All flags remain false during the code deploy.

## Required Preflight

1. Reconcile any newly shipped Fable fixes, record the exact integrated release SHA and current production deployment SHA, and rerun the gates on that integrated SHA. Do not assume this preparation checkpoint is the final production commit.
2. Identify the real ScaleSafe project by matching the existing production Railway service's `SUPABASE_URL` project reference, not a dashboard display name. Record the reference without credentials. Confirm schema version 106, compare the live schema with the expected baseline, and run `supabase/security/check_command_center_rollout.sql` for the pre-migration catalog gate. Stop on drift, existing operator objects, or a different version.
3. Confirm the latest encrypted off-platform backup is healthy.
4. Run the full backend tests, typecheck, application build, UI build, secret scan, and production dependency audit.
5. Apply migrations 107 through 110 to a fresh isolated database restored from the current migration chain.
6. Prove anon and authenticated database roles cannot read operator or Guardian tables or invoke service-only functions.
7. Prove all operator functions return tenant-safe allowlisted data.
8. Seed at least 10,000 merchant rollup rows and certify the worst supported filters against the approved latency target.
9. Complete poison-data, cross-reseller, expired-grant, revoked-session, cursor, filter, and exact-count tests.
10. Complete desktop and mobile browser checks with no console errors. See [Phase 4 Certification](COMMAND_CENTER_PHASE_4_CERTIFICATION.md) for completed isolated evidence and remaining live checks.

The isolated 106-to-110 upgrade, role boundaries, poison-data checks, and 10,002-merchant performance test passed on September 4. Only migrations 107-110 go to production. Historical migration repairs, including consolidation of duplicate 055, are for fresh/recovery replay; do not replay 001-106 against the live database.

Any failed preflight item stops the rollout.

## Dependency Audit Disposition

The release lockfile pins patched `qs`, `ip-address`, and Nano ID versions. Two upstream areas remain explicit, bounded exceptions:

- `sanitize-html` remains on the currently compatible release. ScaleSafe permits only a narrow tag and attribute allowlist for merchant terms, excludes the vulnerable form/media attributes and tags, blocks unsafe URL schemes, and serves the result under a restrictive CSP. The upstream fixed release changes its parser module boundary and must pass a separate Node 20/Jest compatibility change before adoption.
- Puppeteer's browser-download helper includes the flagged archive extractor. Production never accepts or extracts a browser archive: the PDF renderer launches the fixed system Chromium path installed in the application image. Removing that dependency requires the separately tested Node 22 plus Puppeteer 25 renderer upgrade.

These are owner-visible launch exceptions, not claims of a zero-finding audit. Re-test both paths and remove the exceptions in the dependency upgrade release.

## Production Rollout Order

Obtain explicit approval for the bounded production change window before starting. Preparation approval is not deployment approval. Stop at any failed gate without advancing or broadening the authorized scope.

1. Complete the live preflight above, then apply only migrations 107, 108, 109, and 110 in order. Confirm `scalesafe_schema_version()` returns 110 and the post-migration catalog gate passes. The behavioral SQL fixtures belong only in the disposable database, never production.
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
7. Roll application code back only when the prior release is compatible with schema 110. Keep the new flags false, verify merchant health/checkout/GHL SSO, and confirm the original scheduled jobs resume without overlap.

Do not reverse migrations 107 through 110 during an incident. They are service-role-only, feature-gated additions and remain inert while the flags are false.

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

## Parallel Bug-Fix Coordination

- Fable should reproduce and test each reported defect before changing it, using a separate worktree/branch.
- Do not duplicate the historical cancellation fix at `45a878a`.
- Command Center ownership includes operator routes/auth/UI, health runtime, Guardian integration, and migrations 107-110. Agree on any overlapping edits before either branch changes them.
- Coordinate new migration numbers after 110 against the latest main and all pending releases. A separate branch does not prevent migration-number collisions.
- Merge/rebase only in the release-integration branch after review, then rerun the full suite, migration replay, role checks, and build on the exact integrated candidate.
- Neither agent may push main, deploy, or change the production database without explicit approval. The Fable report is a remediation list, not evidence that every finding has been reproduced or fixed.

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
