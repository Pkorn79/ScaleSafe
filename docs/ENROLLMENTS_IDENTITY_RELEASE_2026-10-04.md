# Enrollments Merchant Identity Fix

## Status And Boundary

Implemented in the isolated local branch `codex/enrollments-merchant-identity`.
**Not deployed. No production SQL, settings changes, GHL lookups, credential refresh/rotation, push, or live approval was performed.**

Worktree: `C:\Users\p_kor_e1dk2i3\.codex\worktrees\enrollments-merchant-identity\ScaleSafe`.
The original dirty checkout and other worktrees were not modified.

Read-only inspection on October 4, 2026:
- Railway ScaleSafe production deployment `34b4422d-d6a7-4cb4-9475-2c9fe9624ea5`, successful/running.
- Production and this worktree's starting commit: `4a17eabbf56e0b4953243cc50fd51bae5b39d50a`.
- `/health` reported healthy application, Supabase and schema checks. The inspected recent error-level Railway log window was empty.
- No live merchant-name or credential inventory was fetched. Existing health checks do not certify the new identity columns, live GHL authorization or individual names.

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

- Final result: **220 Jest suites / 1,966 tests passed**, plus the isolated PostgreSQL migration test. TypeScript check and application/UI build passed.
- The UI build reported three dependency-audit findings (one moderate, two high) in the existing dependency set. No dependency versions/lockfiles were changed or automatic audit fix applied; this identity patch does not certify those dependencies.
- Unit and route coverage: duplicate business names, exact IDs, renames, stale/unavailable states, provider failures, mismatched returned location/company IDs, missing scope/authorization, concurrent reauthorization/uninstall, safe persistence, search, existing approval semantics, owner/CSRF/audit enforcement and Evidence separation.
- In-memory PostgreSQL test applies **only 114** to a synthetic pre-migration schema. It proves proof constraints, generated authorization state, duplicate-name search before pagination, literal wildcard handling, preserved settings/approvals and service-role-only RPC execution. It neither connects to Supabase nor replays 107-112.
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

1. Review/reconcile this branch with the then-current main and deployment SHA. The independent `codex/oauth-lifecycle-recovery` worktree has overlapping OAuth/merchant repository changes. Merge deliberately and rerun the combined tests; do not overwrite its changes or deploy an older checkout. Confirm migration number 114 is still unclaimed.
2. Inspect the production catalog read-only. Confirm the existing `merchants` columns, updated-at trigger, location uniqueness, RLS/grants and the current `list_operator_merchants_page` signature. Verify the new identity columns are not already present. Take a private pre-change comparison of business settings, support email, approval and billing fields without exporting credentials. Keep schema version handling unchanged; this is an additive capability migration, not a replay of the historical chain.
3. With explicit SQL approval, apply only `supabase/migrations/114_enrollments_location_identity.sql` once in the Enrollments project (`zddyagfotdtfbcdursqu`). **Never repeat 107-112.** Supply the exact SQL in chat before an owner-run change. If 114 is already applied, stop and verify it rather than rerunning. This transaction adds metadata/index/checks and replaces only the merchant-search RPC; it does not rewrite settings, names, approvals, billing or credentials. No SQL runs against Evidence.
4. Verify the new columns/generated indicator/checks/RPC and retained RLS/service-only grants; verify the protected fields are unchanged. The migration intentionally leaves names unverified. Before code rollout, old screens may show location IDs in health search instead of legacy names; do not interpret that as data loss.
5. With explicit push/deploy approval, deploy the reviewed commit. The new code requires 114 first. Verify Railway SHA, `/health`, operator list/detail/access responses, and merchant-facing settings/checkout smoke tests. Do not send communications or take payments as part of this release.
6. Obtain explicit approval for each selected live identity refresh/canary, naming the exact location ID. The normal GHL client may refresh expired OAuth credentials or exchange company credentials, so approval must cover that possibility. Do not silently run a portfolio backfill or renew an incomplete installation. Authorize a separate reinstallation/reconnection only if actually needed.
7. Prove two same-business locations show their distinct GHL subaccount names and IDs in access lists, health lists, detail, search and approval review. Prove a known missing-authorization installation shows the required unavailable wording while preserving its previous approval. Compare names with HighLevel for those exact IDs. Verify the refresh audit names its actor and exact location. Use a separately approved test subaccount for an actual rename; never rename a live business as a test by default.
8. Verify a newly authorized test install obtains identity before provisioning finishes, and a provider failure does not overwrite previous proof. Reconfirm Evidence access/reporting and existing approval/billing fields are unchanged. Only then mark the fix deployed/live-verified in the Master Index.

No production success is claimed by passing local tests. Live refresh/canary steps remain pending approval.

## Rollback

Stop the rollout if schema, binding, approval or identity verification fails. Keep the additive columns and existing verified proof; do not drop them or restore names from business settings. Prefer a forward fix or a reviewed app rollback that retains the no-fallback identity presentation. Reverting all the way to `4a17eab` restores the original naming defect and should be treated as a temporary emergency measure, not a successful fix. Leave the additive migration in place unless a separately reviewed rollback is approved. No credential, billing, approval or Evidence rollback is part of this change.
