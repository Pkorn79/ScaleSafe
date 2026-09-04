# Command Center Phase 4 Certification

**Recorded:** 2026-09-04
**Scope:** Isolated release preparation, not production authorization
**Branch:** `codex/command-center-phase4`
**Integration base:** `40f17e8`, including `origin/main` at `821c1c5`
**Release instructions:** [Phase 4 Rollout](COMMAND_CENTER_PHASE_4_ROLLOUT.md)

## Completed Gates

| Gate | Result | Evidence / limitation |
| --- | --- | --- |
| Fresh baseline replay | Passed | Disposable Supabase reset through schema 106, no production credentials or customer data |
| Exact upgrade 106 to 110 | Passed | Migrations 107, 108, 109, 110 applied in order; pre/post catalog checks passed |
| Catalog access boundaries | Passed | 32 tables require forced RLS; 50 named routines checked for expected role access and unambiguous definitions |
| Guardian database behavior | Passed | `verify_migration_109.sql`, transaction rolled back at schema 110 |
| Operator read models | Passed | `verify_migration_110.sql`, poison-data/tenant boundaries, allowlisted projections and counts; transaction rolled back |
| Portfolio query performance | Passed | 10,002 synthetic merchants, measured page query 89.141 ms, 5,000 ms limit; this is isolated query performance, not live load capacity |
| Owner Auth and TOTP | Passed in isolation | Bootstrap, first login/enrollment, page reload, logout, returning MFA login, logout; two sessions, none unrevoked after final logout |
| Browser layout | Passed in isolation | Populated fixture desktop views and 390x844 mobile; filters, incident detail, runbooks, menu/table scrolling; no console errors observed |
| Operator-host routing | Passed | Root redirects only with center/auth enabled; other merchant paths blocked on the operator host; forwarded-host spoof rejected; merchant health remains reachable |
| Backend regression suite | Passed | 201 suites, 1,679 tests |
| TypeScript | Passed | `npm run typecheck` |
| Backend and UI build | Passed | `npm run build`; UI assets copied into `dist`; optional WASM peer-dependency warning recorded in build log |
| Credential pattern check | Passed within stated scope | 49 changed/new candidate files scanned, no high-confidence matches or test-fixture matches; not a full-history secret audit |

The final September 4 disposable reset removed the scratch owner and earlier synthetic rows. No production user was created. The real Auth test used a localhost HTTP reverse proxy because the browser rejected the self-signed HTTPS certificate. Production HTTPS, secure cookies, exact-origin requests, and client-IP handling still require live-domain acceptance. The UI fixture check and the real Auth check are separate evidence, not proof that live customer totals are correct.

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

The isolated stack was stopped after final SQL proof, using Supabase's default volume-preserving shutdown. Production, backup, and Guardian services were not stopped or reconfigured.

## Remaining Production Gates

1. Review the candidate and dependency exceptions, coordinate any Fable fixes, and record the exact integrated release SHA. Rerun certification after relevant integration changes.
2. Confirm the production ScaleSafe Supabase project from the existing Railway service's project reference, check schema 106 and live drift, and verify a fresh encrypted backup.
3. Obtain explicit approval before production SQL, deployment, main push/merge, domain/config changes, or operator user creation.
4. Apply only 107-110, deploy default-off code, establish the real operator domain and private credentials, then complete owner MFA login acceptance.
5. In the approved activation window, verify scheduled-job continuity, no duplicate execution, correct live tenant totals, audit attribution, and rollback readiness.
6. Certify Guardian ingestion and current alert routing separately before changing its live services or timers. The owner's dashboard login does not imply Guardian or reseller onboarding is fully activated.

The cancellation fix at `45a878a` is a separate, undeployed branch. No PMG enrollment was changed as part of this certification.
