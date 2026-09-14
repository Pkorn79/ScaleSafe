# ScaleSafe Evidence Command Center module

Prepared September 14, 2026. Local implementation; production activation pending.

## Behavior

The existing console at `ops.scalesafe.app` retains its password/MFA identity. Navigation explicitly separates **ScaleSafe Enrollments**, **ScaleSafe Evidence**, and administration. The Evidence overview is at `/internal/operator/home#evidence`.

Evidence provides its own installations, active installations, active customer records, purchases, open disputes (`needs_response`), evidence records and capture job counts. Merchants currently display their exact GHL location IDs because the Evidence installation table does not store a verified business name. No Enrollments merchant lookup is used to fill that gap.

Evidence totals are global to the Evidence service, not the current page. Pages contain up to 50 locations. Customer counts reflect active record status, including retained records in a disconnected installation. Active installations require both active installation and beta access. Capture issues count only the latest retrying/blocked capture job for each active customer's source; superseded failures are excluded. The last completed capture is the most recent successful job, not proof that every source is current. This release does not claim complete provider/worker/backup monitoring or evidence coverage certification.

Loading Evidence does not query Enrollments health or depend on its incident flag. An unconfigured/unavailable connection clears counts and displays a distinct message, rather than showing zeros or a previous successful result as current. Report timestamps are validated and displayed as current/delayed/stale.

## Boundaries and contract

- Console: `GET /internal/operator/api/evidence/overview?limit=50&offset=0` requires a live operator session plus `platform.evidence.read`, granted only to platform owner/operations. A successful audit write is required before the read.
- Evidence producer: `GET /internal/command-center/overview` accepts only a dedicated bearer credential. Its router provides no mutation endpoints. It executes one aggregate SELECT against `client_evidence` in the independent project `xrdisibfewptgkkwpcbq`.
- Contract identifiers: `product=scalesafe-client-evidence`, `contractVersion=command-center-evidence-v1`.
- Fixed HTTPS destination: `https://scalesafe-client-evidence-production.up.railway.app`. No browser-supplied upstream URL or redirect is accepted. Six-second timeout, bounded response size, explicit field projection, no upstream error/header logging, no provider credentials or original document bytes in responses.
- Reporting secret: `CE_COMMAND_CENTER_READ_TOKEN` on Evidence; matching `OPERATOR_EVIDENCE_READ_TOKEN` on the console service. Use a freshly generated random base64url value of at least 32 bytes (43–128 characters). Keep it in the services' secret stores. Do not use SSO, database, processor or existing operator login secrets.
- The existing Enrollments project `zddyagfotdtfbcdursqu` remains separate. No schema change is needed in either project. Never rerun migrations 107–112.

## Paired source locations

- Console changes: this repository, starting at `248d961a887a11225efec84c9fd04dff0193801a`; remote main was independently checked at that commit on September 14.
- Evidence reporting changes: independent `ScaleSafe-Client-Evidence` repository, isolated branch `codex/command-center-evidence`, starting at `932f532`. Checkout: `.codex-tmp/client-evidence-command-center` under this worktree. The active Evidence development checkout was not modified.

## Verification

- Console operator regression suite: 15 suites / 127 tests passed, covering sessions, permissions, host isolation, audit failure, reporting projection, timeouts and independent health gates.
- Evidence endpoint tests execute the actual aggregate SQL in scratch PostgreSQL (PGlite), checking tenant-specific counts, global pagination totals, superseded failures, read authentication and redaction.
- Evidence regression corpus: 38 suites / 360 tests passed in the broad run. One additional suite initially could not load the Vue dependency in the new isolated checkout; after linking the existing frontend dependencies, that suite passed all 6 tests. All 39 suites / 366 tests are accounted for; no application defect was hidden by the setup correction.
- Both backends pass TypeScript compilation.
- Evidence's full production build (TypeScript, Vue/Vite and asset copy) passed. Vite needed permission to write its temporary bundled configuration in the existing dependency cache; the retry succeeded without source changes.
- Browser verification with fictional records: separate product navigation; 51 installations across two pages; Evidence loads while Enrollments returns 503; unavailable data clears counts; unconfigured and empty states differ; old reports show stale; phone navigation works with no page-wide horizontal overflow.
- This is local proof. No live reporting credential has been provisioned and no production changes have been made.
- Public HTTPS preflight: the Command Center login and Evidence `/health` both returned 200 on September 14. This confirms reachable TLS endpoints, not authenticated reporting or current live counts.

Preview: `node scripts/preview-command-center-evidence.cjs`, then `http://127.0.0.1:4387/#evidence`. Optional query modes are `?evidence=offline`, `unconfigured`, `empty`, or `stale`. The preview is loopback-only and uses fictional data with no database or provider calls.

## Production activation after approval

1. Recheck the latest commits and actual Railway service identities. Integrate only these scoped commits with current work; do not overwrite the active Evidence branch or deploy a stale Enrollments checkout.
2. Deploy the paired Evidence reporting endpoint to its separate service. With its credential unset, it returns 404. Ordinary Evidence SSO/API behavior remains intact.
3. Deploy the console module. With its credential unset, the authorized Evidence view shows that reporting is not connected.
4. Generate and privately install the matching fresh reporting credential on the two services. These settings can restart the services; coordinate with current releases. No GHL scope, database credential, DNS change or SQL migration is required.
5. Verify the unauthenticated Evidence reporting endpoint rejects access, owner MFA login sees actual Evidence counts, Enrollments retains its own merchants/counts, and merchant/reseller requests cannot access the new endpoint. Confirm counts against authoritative Evidence records and check both services' health/logs.

Rollback: clear the two reporting variables to disable the link, or restore the previous scoped application releases. No data repair or migration rollback is required.
