# Command Center Phase 1 Implementation And Certification

**Status:** Implemented on `codex/beta-remediation`; isolated staging certification pending
**Owner approval:** Recommended Phase 1 defaults approved 2026-07-22
**Production state:** Unchanged; schema 102 and operator features disabled
**Proposed staging schema:** Migration 103

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

## Isolated Staging Requirements

Create a Railway service and Supabase project that are not connected to production traffic or data. Configure only that isolated service with:

```text
OPERATOR_COMMAND_CENTER_ENABLED=true
OPERATOR_AUTH_ENABLED=true
OPERATOR_HOST=<dedicated staging hostname>
OPERATOR_TRUST_PROXY_HOPS=<verified Railway proxy hop count>
SUPABASE_PUBLISHABLE_KEY=<scratch project publishable/anon key>
OPERATOR_AUTH_TOKEN_ENCRYPTION_KEY=<new 32-byte hex or base64 key>
```

The operator encryption key must be distinct from `PROCESSOR_ENCRYPTION_KEY`. Do not copy production processor, webhook, payment, or merchant credentials into this environment.

## Migration And Bootstrap Order

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

## Certification Matrix

### Host And Identity Isolation

- Flags off: all operator routes return the same JSON `404`.
- Wrong host: operator routes return `404` even with a valid operator cookie.
- Unknown `/internal/*`: JSON `404`, never merchant SPA HTML.
- Merchant SSO headers or location query parameters on an operator request: rejected before session authorization.
- Operator cookies cannot authorize any merchant route.

### Authentication And Sessions

- Wrong password returns one generic response and creates no browser session.
- First login requires TOTP enrollment; later login requires a valid TOTP code.
- No app session is created unless Supabase reports AAL2.
- Browser receives only opaque app tokens, never Supabase access or refresh tokens.
- Session and pending cookies are Secure, host-only, SameSite=Strict, and HttpOnly; the CSRF cookie is readable only for double-submit validation.
- Missing/mismatched Origin or CSRF values reject mutations.
- Disabled user, membership, organization, assignment, grant, or revoked session loses access on the next request.

### Invitations And Roles

- Invite links contain a single-use verification token only in the URL fragment.
- Invitation acceptance requires the exact token, auth user, confirmed email, organization, and role.
- A reseller owner cannot create an auth identity for another organization.
- Platform roles cannot be invited into reseller organizations, and reseller roles cannot be invited into the platform organization.
- Expired, consumed, mismatched, or replayed invitations fail closed.

### Tenant Authorization

- Create two reseller organizations and assign separate test `location_id` values.
- Each reseller can read only its assigned merchant summary.
- Cross-reseller and nonexistent locations produce indistinguishable `404` responses.
- Assignment transfer is atomic; old access disappears immediately.
- Platform support sees no merchant until a different platform owner approves a live, unexpired grant.
- Grant expiry/revocation removes access immediately.
- Security auditor can read audit data but no merchant summary.

### Audit And Database Controls

- Every sensitive read writes an allowed audit event; audit failure blocks the read.
- Every privileged mutation has intent plus succeeded/failed evidence under one correlation ID.
- Audit rows reject update and delete.
- Concurrent assignment transfers leave exactly one active primary reseller.
- Auth and invite rate limits are shared across service instances.
- No operator table or RPC is reachable with scratch anon/authenticated credentials.

### Merchant Regression

- GHL Marketplace installation and SSO still load normally.
- Checkout, payments, pulse, milestones, evidence, defense, and connector routes remain unchanged.
- Existing HQ/debug token consumers remain unchanged during Phase 1; their attributed cutover is Phase 4.

## Local Verification Completed

- Focused Phase 1 suite: 9 suites, 61 tests.
- Full repository suite: 177 suites, 1,438 tests.
- TypeScript typecheck: pass.
- Production backend/UI build: pass.
- Patch secret scan: no high-confidence secret hit except the explicit fake Stripe fixture in `tests/setup-env.ts`.
- Dependency advisory lookup: pending explicit approval because npm receives the dependency manifest.

## Acceptance Gate

Phase 1 is certified only when every staging check above passes and proof is recorded. Until then:

- Do not apply migration 103 to production.
- Do not configure production operator DNS.
- Do not enable either operator feature flag in production.
- Do not merge or push this work to `main`.
- Do not begin Phase 2 implementation.

## Rollback

The immediate code rollback is both flags set to `false`, which makes the routes unavailable. Do not destructively remove migration 103 tables. If a later production release is approved, retain the additive schema and roll code forward after correcting the defect.
