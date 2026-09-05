# Command Center Phase 4 Certification

**Recorded:** 2026-09-04
**Scope:** Isolated release preparation, not production authorization
**Branch:** `codex/command-center-release-candidate`
**Integrated payment-security SHA:** `01bf2c8`
**Release instructions:** [Phase 4 Rollout](COMMAND_CENTER_PHASE_4_ROLLOUT.md)

## Completed Gates

| Gate | Result | Evidence / limitation |
| --- | --- | --- |
| Fresh baseline replay | Passed | Disposable Supabase reset through schema 111, no production credentials or customer data |
| Command Center upgrade 106 to 110 | Passed | Migrations 107, 108, 109, 110 applied in order during the original Phase 4 certification; pre/post catalog checks passed |
| Payment integrity upgrade 111 to 112 | Passed | A null-processor `delinquent` subscription blocked preflight and migration, complete transaction rollback was verified, then the clean preflight, migration 112, rollback-only behavioral verifier, and catalog gate passed |
| Catalog access boundaries | Passed | 32 tables require forced RLS; 51 named routines checked for expected role access and unambiguous definitions at schema 112 |
| Exact processor ownership | Passed | Three immutable binding triggers, three restrictive foreign keys, configuration-aware deduplication, tenant/processor rejection, ambiguous recurring fail-closed behavior, and exact dunning settlement passed |
| Guardian database behavior | Passed | `verify_migration_109.sql`, transaction rolled back at schema 110 |
| Operator read models | Passed | `verify_migration_110.sql`, poison-data/tenant boundaries, allowlisted projections and counts; transaction rolled back |
| Portfolio query performance | Passed | 10,002 synthetic merchants, measured page query 89.141 ms, 5,000 ms limit; this is isolated query performance, not live load capacity |
| Owner Auth and TOTP | Passed in isolation | Bootstrap, first login/enrollment, page reload, logout, returning MFA login, logout; two sessions, none unrevoked after final logout |
| Browser layout | Passed in isolation | Populated fixture desktop views and 390x844 mobile; filters, incident detail, runbooks, menu/table scrolling; no console errors observed |
| Operator-host routing | Passed | Root redirects only with center/auth enabled; other merchant paths blocked on the operator host; forwarded-host spoof rejected; merchant health remains reachable |
| Backend regression suite | Passed | 210 suites, 1,776 tests |
| TypeScript | Passed | `npm run typecheck` |
| Backend and UI build | Passed | TypeScript build, Vite production build, and UI asset copy passed; optional WASM peer-dependency warning remains recorded in the original build log |
| Credential pattern check | Passed within stated scope | 49 changed/new candidate files scanned, no high-confidence matches or test-fixture matches; not a full-history secret audit |
| Production pre-migration catalog | Passed read-only | Exact project `zddyagfotdtfbcdursqu`, schema 106; checksum-verified checker enforced read-only transaction settings, returned `COMMAND_CENTER_PRE_MIGRATION_CATALOG_PASSED`, and rolled back |

The final September 4 disposable reset removed the scratch owner and earlier synthetic rows. No production user was created. The real Auth test used a localhost HTTP reverse proxy because the browser rejected the self-signed HTTPS certificate. Production HTTPS, secure cookies, exact-origin requests, and client-IP handling still require live-domain acceptance. The UI fixture check and the real Auth check are separate evidence, not proof that live customer totals are correct.

The Fable payment/security findings were reproduced and reconciled into the release candidate. The final implementation goes beyond the one-active-config assumption by carrying an immutable `processor_config_id` through enrollment, payment, dunning, webhook, and lifecycle paths. Fable's follow-up findings were also reconciled: exact Stripe/NMI missing-subscription responses can finish a local cancel or completion, all other processor failures still block, fatal asynchronous errors are logged without keeping a corrupted process alive, and migration 112 covers every nonterminal subscription in an explicit transaction.

## Permission Hardening

The catalog gate identified default public execute grants on two trigger-only helper functions in migration 108. Both now explicitly revoke public, anon, and authenticated execution. The corrected migration passed the complete isolated upgrade and catalog gate. This was an unreleased migration hardening issue, not evidence of production access or compromise.

## Dependency Exceptions

The September 4 production-dependency audit returned **three high and one moderate package findings**, with no critical findings:

- `puppeteer-core`, `@puppeteer/browsers`, and `extract-zip`: one browser-download dependency chain, upgrade proposed to Puppeteer 25.10.0. Production uses system Chromium; the Node 22/renderer compatibility release remains separate.
- `sanitize-html` 2.13.1: moderate, upgrade proposed to 2.17.7. Existing narrow sanitizer allowlists and CSP are mitigations, not an upstream patch. Parser/Jest compatibility needs its own tested change.

See the rollout document for the bounded exposure assessment. These exceptions still need owner acceptance or remediation before launch. Do not describe this audit as clean.

## Evidence Location

Local evidence directory:

`C:\Users\p_kor_e1dk2i3\ScaleSafe\.codex-tmp\command-center-release-20260904`

- `database-upgrade.log`: before/after catalog gates and four-migration upgrade.
- `database-behavior.log`: rollback-only Guardian and operator behavioral checks plus scale timing.
- `typecheck.log`, `tests.log`: final local type and regression gates.
- `build.log`: final backend/UI build and non-fatal dependency warning.
- `dependency-audit.json`: package advisory report, no application credentials.
- `credential-pattern-scan.json`: bounded changed-file credential check and its limitations.
- `release-manifest.json`: exact candidate file hashes, proof hashes, Git references, and production authorization boundary.
- `migration-bundle/`: only migrations 107-110 and the read-only catalog checker; no credentials, customer rows, or destructive test fixtures.

Isolated VPS workspace: `/tmp/scalesafe-phase4-110-20260903b`, dedicated Docker network `scalesafe-phase4-loopback-20260903`. Actual published ports were verified as `127.0.0.1:55321` and `127.0.0.1:55322`, not public interfaces. Preserve migration hashes with the release bundle; do not reuse the earlier archive hash after the migration 108 grant fix.

Processor-binding replay workspace: `/tmp/scalesafe-phase4-111-replay-20260904b`, PostgreSQL on loopback `127.0.0.1:55522`. The authoritative sequence started at schema `111`, seeded one fixed synthetic null-processor `delinquent` subscription, observed a blocked aggregate preflight and expected migration failure, then returned `MIGRATION_112_BLOCKED_ROLLBACK_PASSED`. After removing only that fixture, preflight returned `ready`, migration 112 completed with `BEGIN` and `COMMIT`, `MIGRATION 112 IMMUTABLE PROCESSOR CONFIG BINDING PASSED`, and `COMMAND_CENTER_POST_MIGRATION_CATALOG_PASSED` returned at schema `112`. Final schema was 112 with zero enrollments.

During non-authoritative harness setup, two Supabase CLI operations omitted the global `--network-id` option and briefly recreated disposable, default-key test containers with ports on all interfaces. Each was detected and stopped immediately. The workspace contained no production credentials, customer data, or production connection. The authoritative reset and replay explicitly passed the loopback network to `start`, `db reset --local`, and `stop`; Docker bindings were verified before and after, and no Phase 4 container remained running. Production, recovery, backup, and Guardian services were not stopped or reconfigured.

## Remaining Production Gates

1. Obtain one final independent read-only review of the follow-up patch through `01bf2c8`, review the dependency exceptions, and record the final release SHA. Rerun certification after any additional integration change.
2. Completed September 4: the forced-read-only PostgreSQL catalog gate confirmed exact Supabase project `zddyagfotdtfbcdursqu` at schema 106 with no conflicting rollout objects and rolled back successfully.
3. Obtain explicit approval before production SQL, deployment, main push/merge, domain/config changes, or operator user creation.
4. Apply only the missing migrations from 107 through 112 in order, deploy default-off code, establish the real operator domain and private credentials, then complete owner MFA login acceptance.
5. In the approved activation window, verify scheduled-job continuity, no duplicate execution, correct live tenant totals, audit attribution, and rollback readiness.
6. Certify Guardian ingestion and current alert routing separately before changing its live services or timers. The owner's dashboard login does not imply Guardian or reseller onboarding is fully activated.

The exact-enrollment cancellation fix is integrated into the candidate and covered by the full suite. No PMG enrollment or other production record was changed as part of this certification.
