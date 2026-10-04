# Enrollments Merchant Identity Fix

## Status And Boundary

Implemented locally in `codex/enrollments-merchant-identity` (commit `567e6a6`), then integrated with the pending OAuth lifecycle corrections in the separate release branch `codex/enrollments-identity-release`.
**Not deployed. Production SQL was read-only inspection; no migration, settings change, GHL lookup, credential refresh/rotation, push, or live approval was performed.**

Release worktree: `C:\Users\p_kor_e1dk2i3\.codex\worktrees\enrollments-identity-release\ScaleSafe`.
The original dirty checkout and other worktrees were not modified.

Read-only inspection on October 4, 2026:
- Railway ScaleSafe production deployment `34b4422d-d6a7-4cb4-9475-2c9fe9624ea5`, successful/running.
- Production and this worktree's starting commit: `4a17eabbf56e0b4953243cc50fd51bae5b39d50a`.
- `/health` reported healthy application, Supabase and schema checks. The inspected recent error-level Railway log window was empty.
- The read-only catalog check ran in the authenticated Supabase dashboard, with `BEGIN READ ONLY` and `ROLLBACK`. It confirmed schema version 112, eight merchant records, location uniqueness, the enabled `merchants_updated_at` trigger, and the existing 11-argument merchant-search RPC. Migration 114's columns are absent.
- Merchant RLS is enabled. Anon/authenticated have no table CRUD or search-RPC execution; service-role access is present. Search dependency columns match the migration. A private aggregate hash of business settings, approvals and billing was captured for comparison; no credential values or client records were selected.
- Sanitized credential-presence/binding checks found two pairs sharing business names and one nameless pending installation without authorization. Another legacy installation has credentials but no explicit binding metadata: the new heading must say unavailable until its identity is safely verified, not infer a tenant binding. These checks do not certify any live HighLevel name or usable provider token.
- Repeatable preflight/postflight SQL: [read-only identity release check](../supabase/security/check_enrollments_identity_release.sql). The private preflight result is outside source control.

## Combined Release Boundary

The separate OAuth worktree was snapshotted into this release branch without modifying it. Shared callback/repository tests were reconciled deliberately. This candidate includes its guarded INSTALL/UNINSTALL and OAuth writes, bounded reinstall-confirmation wait, and clear tokenless-SSO message; it is not an identity-only deployment.

An additional integration correction preserves the existing merchant business setting even when it is intentionally blank or null and an INSTALL insert wins the OAuth race. New combined tests exercise actual callback, GHL client, identity service and repository code together, with fictional provider/database boundaries.

The OAuth provider-handoff problem remains separate: this release cannot recover a callback HighLevel never delivered. The ten-second reinstall wait is in-memory, not durable; late confirmation or a process crash may require new authorization. Agency transfer remains deliberately unsupported without a verified transfer process. See [OAuth recovery record](OAUTH_LIFECYCLE_RECOVERY_2026-10-03.txt). No unavailable reviewer login or customer reinstall is a release prerequisite that Philip is being asked to supply.

## Identity Contract

| Value | Meaning |
| --- | --- |
| `business_name` | Merchant-editable business setting. Existing values, including intentionally blank settings, are preserved. |
| `ghl_location_name` | Only the trimmed `location.name` returned by the exact HighLevel location endpoint after ID validation. |
| `ghl_location_name_source` | `ghl_location_api`, never an agency name, business setting or installation-list label. |
| `ghl_location_name_verified_at` | Last successful verification of that exact location. |
| `ghl_location_name_checked_at` | Latest attempted lookup. |
| `ghl_location_name_error` | Sanitized failure category, never raw provider errors or headers. |
| `ghl_location_name_refresh_id` | Internal concurrent-lookup guard, not returned to operator screens. |
| `ghl_identity_authorized` | Database-generated safe credential-presence, scope and tenant-binding indicator. No credentials are returned to operators. This is not a claim that provisioning or provider availability is healthy. |

Verified means the name has endpoint/source/time proof, appropriate authorization is present, the last recorded attempt did not fail, and proof is less than 24 hours old. A failed refresh or older proof makes a previously verified name **stale**. No proof means **unavailable**. Missing authorization overrides the heading with **HighLevel name unavailable - authorization incomplete** (the UI uses an em dash), alongside the exact location ID. A prior verified name is retained as historical data, but is not substituted into that unavailable heading.

Business names remain separately searchable/displayed; an existing matching name is not verification. The migration does not guess or backfill names. Newly installed company-token locations can retain the existing initial business-name default from the install list, but it is never accepted as identity. Identity hydration never writes business name or support email.

## Retrieval And Isolation

The existing GHL client remains the sole provider client and retains API version `2021-07-28`. Identity retrieval requires `locations.readonly`, stored authorization and explicit location/company binding. A company credential goes through the existing exact-location token exchange; it is not used to fetch an agency name.

The response must contain `location.id` equal to the requested location ID, a nonblank bounded `location.name`, and no conflicting returned company ID when a company binding is known. A missing ID, agency response, nested business-only name or different location cannot be persisted as verified identity.

Lookup starts after OAuth persistence for every successfully authorized target, even when provisioning is already complete. Provisioning also attempts identity before its claim/setup; a setup failure does not suppress identity. Trusted SSO launches refresh stale/unverified names. Fresh lookups are cached for 24 hours; unsuccessful automatic attempts back off five minutes. The platform owner can force a refresh from the Enrollments access dialog, using the existing session, origin/CSRF protection and audit trail. There is no new scheduled worker or bulk credential operation.

Per-location singleflight and database compare-and-set writes prevent older lookups from overwriting a newer lookup, reauthorization, uninstall or concurrent update. Identity writes are confined to identity metadata. Approval, entitlement, plan and billing semantics are unchanged. Approval can still be recorded by exact location ID while authorization is incomplete, but it does not reconnect the account. ScaleSafe Evidence APIs, credentials, approvals and identity behavior are unchanged.

Provider reference: [Get location, version 2021-07-28](https://marketplace.gohighlevel.com/docs/2021-07-28/ghl/locations/get-location/index.html), [location token exchange](https://marketplace.gohighlevel.com/docs/2021-07-28/ghl/oauth/get-location-access-token/index.html), [scope requirements](https://marketplace.gohighlevel.com/docs/Authorization/Scopes/index.html). These document the endpoint and response contract; they do not prove a particular production credential is usable.

## Local Verification

- Combined release result: **223 Jest suites / 2,018 tests passed**, plus the isolated PostgreSQL migration test. TypeScript check and application/UI build passed.
- The UI build reported three dependency-audit findings (one moderate, two high) in the existing dependency set. No dependency versions/lockfiles were changed or automatic audit fix applied; this identity patch does not certify those dependencies.
- Unit and route coverage: duplicate business names, exact IDs, renames, stale/unavailable states, provider failures, mismatched returned location/company IDs, missing scope/authorization, concurrent reauthorization/uninstall, safe persistence, search, existing approval semantics, owner/CSRF/audit enforcement and Evidence separation.
- In-memory PostgreSQL test applies **only 114** to a synthetic pre-migration schema. It proves proof constraints, generated authorization state, duplicate-name search before pagination, literal wildcard handling, preserved settings/approvals and service-role-only RPC execution. A second application fails without altering proof after rollback. It neither connects to Supabase nor replays 107-112.
- Combined callback/identity integration tests cover location and company credentials, identity before provisioning success, duplicate business names in either configuration order, renamed subaccounts, already-provisioned installations, missing authorization with approvals preserved, uninstall during a pending lookup, and mismatched returned location IDs.
- Browser fixture: separate names for a shared business, name/ID search, exact-location approval confirmation, renamed identity after refresh, and the missing-authorization message. Desktop and 390px mobile inspected; no page/dialog horizontal overflow or browser errors observed. Fixture buttons do not change real approvals or call HighLevel.

Reproduce:

```powershell
npm.cmd run typecheck
npm.cmd test -- --runInBand --silent
node --test tests/integration/merchant-location-identity.test.cjs
npm.cmd run build
node tests/fixtures/merchant-identity-preview.cjs
```

The optional preview binds only to `127.0.0.1:4319`, supports `PORT` override and contains fictional data. It does not load production configuration or start application jobs. The local preview was left running at `http://127.0.0.1:4319/#merchants` for review (process 180556); this is not the deployed app.

## Production Release Plan

Each production step below needs explicit approval; this document is not approval.

1. Recheck this combined branch against then-current main, the independent OAuth worktree and deployment SHA immediately before release. Integration and full tests have passed locally; do not overwrite later independent changes or deploy an older checkout. Confirm migration number 114 remains unclaimed. The current release baseline/rollback SHA is `4a17eabbf56e0b4953243cc50fd51bae5b39d50a`.
2. Inspect the production catalog read-only. Confirm the existing `merchants` columns, updated-at trigger, location uniqueness, RLS/grants and the current `list_operator_merchants_page` signature. Verify the new identity columns are not already present. Take a private pre-change comparison of business settings, support email, approval and billing fields without exporting credentials. Keep schema version handling unchanged; this is an additive capability migration, not a replay of the historical chain.
3. With explicit SQL approval, apply only `supabase/migrations/114_enrollments_location_identity.sql` once in the Enrollments project (`zddyagfotdtfbcdursqu`). **Never repeat 107-112.** Supply the exact SQL in chat before an owner-run change. If 114 is already applied, stop and verify it rather than rerunning. This transaction adds metadata/index/checks and replaces only the merchant-search RPC; it does not rewrite settings, names, approvals, billing or credentials. Three-second lock and thirty-second statement timeouts fail safely instead of waiting indefinitely. If it fails, issue `ROLLBACK` and inspect the cause before another approved attempt. No SQL runs against Evidence.
4. Verify the new columns/generated indicator/checks/RPC and retained RLS/service-only grants; verify the protected fields are unchanged. The migration intentionally leaves names unverified. Before code rollout, old screens may show location IDs in health search instead of legacy names; do not interpret that as data loss.
5. With explicit push/deploy approval, deploy the reviewed commit. The new code requires 114 first. Verify Railway SHA, `/health`, operator list/detail/access responses, and merchant-facing settings/checkout smoke tests. Do not send communications or take payments as part of this release.
6. Obtain explicit approval for the selected live identity refreshes as a narrow named batch. Proposed internal pair: `274dtgl30b7x2HG8hn69` and `BxiqLzUf4Rh5GXR6DUZ3` (both currently have the editable business setting PMG Merchant Consulting LLC). Their actual subaccount names remain unverified until fetched. The normal GHL client may renew the existing shared agency OAuth authorization or exchange exact-location credentials; shared renewal may update sibling installations' copies of that authorization. Approval must cover that possibility. This is not an API-key rotation or a portfolio name backfill. Do not reconnect the tokenless Freedom Frequency installation (`NqZwh9akrNWUXrTJcxK6`); inspect its unavailable heading and retained approval read-only. Authorize any reinstallation/reconnection separately.
7. Prove two same-business locations show their distinct GHL subaccount names and IDs in access lists, health lists, detail, search and approval review. Prove a known missing-authorization installation shows the required unavailable wording while preserving its previous approval. Compare names with HighLevel for those exact IDs. Verify the refresh audit names its actor and exact location. Use a separately approved test subaccount for an actual rename; never rename a live business as a test by default.
8. Verify a newly authorized test install obtains identity before provisioning finishes, and a provider failure does not overwrite previous proof. Reconfirm Evidence access/reporting and existing approval/billing fields are unchanged. Only then mark the fix deployed/live-verified in the Master Index.

No production success is claimed by passing local tests. Live refresh/canary steps remain pending approval.

## Rollback

Stop the rollout if schema, binding, approval or identity verification fails. Keep the additive columns and existing verified proof; do not drop them or restore names from business settings. Prefer a forward fix or a reviewed app rollback that retains the no-fallback identity presentation. Reverting all the way to `4a17eab` restores the original naming defect and should be treated as a temporary emergency measure, not a successful fix. Leave the additive migration in place unless a separately reviewed rollback is approved. No credential, billing, approval or Evidence rollback is part of this change.
