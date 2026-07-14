# ScaleSafe Open Remediation Register

Closed review baseline: `1dce009bc056f3987e30636b5acf6ada211ae87a` on 2026-07-14.

This file contains only work that remains open after the July live certification. The numbered findings in `LIVE_FINDINGS.md` remain the historical evidence ledger; fixed findings are intentionally omitted here.

## Stop-Ship Before A Real Beta Merchant

| Finding | Area | Classification | Required outcome | Dependency |
|---|---|---|---|---|
| FIND-067 | Supabase capacity and failure containment | Operations plus code | Healthy paid production compute; bounded dependency timeouts; low idle worker request rate | Owner upgrades production plan/compute |
| FIND-068 | Database and private-file recovery | Operations | Managed backup, encrypted off-platform export, private Storage manifest/backup, scratch restore proof | Owner enables paid backup capability |
| FIND-049/050/051/052/053/054/055 | Defense factual and scope integrity | Code/data | No unsupported delivery claims, sibling evidence, omitted pulse concern, unexplained dual pricing, impossible chronology, or wrong processor | None for code; live packet retest later |
| FIND-057 | Zoom participant identity | Code | Host participation can never become client attendance evidence | None |
| FIND-061/062 | Stripe Risk Health truth | Code | Stripe-only snapshot selection and one normalized API/UI DTO | None |
| FIND-064 | Connector event-history 500 | Code/schema query | Route returns exact client/program event history from live schema | None |
| FIND-066 | Manual communication enrollment binding | Product/code | One-active enrollment auto-links; multiple eligible enrollments require explicit choice | None |
| FIND-074 | Installed GHL Custom Page SSO | Code/integration/live proof | Trusted location context reaches backend once; parent timeout is typed and observable | Installed GHL page retest after code deploy |

## Required Publication And Controlled-Beta Gates

| Finding | Area | Classification | Required outcome | Dependency |
|---|---|---|---|---|
| FIND-007 | NMI official webhook readiness | Configuration/live proof | Signed/verified live webhook path certified per active NMI configuration | Owner/NMI setup access |
| FIND-013 | Deleted GHL trigger subscription | GHL configuration | Stale subscription removed and exact workflows republished/retested | Owner-approved GHL workflow edit |
| FIND-025 | NMI saved-method identity | Data/UI | Safely identify card ending before any saved-method charge | NMI test data or fresh vaulted card |
| FIND-035 | Lifecycle workflow template fields | GHL configuration | Pause/resume emails render exact program fields, never objects | Owner-approved GHL template edit |
| FIND-036/037 | Stripe recurring amount and workflow proof | Missing live proof | Fresh finite plan settles full amount and names exact enrollment | One new Stripe sandbox cycle |
| FIND-056 | Zoom setup discovery | Code/live proof | Discovery query succeeds and health separates OAuth from event/evidence proof | None for code; live event later |
| FIND-059 | Connector status truth | Code/UI | Draft/testing/disabled connections never appear healthy or as published evidence | None |
| FIND-073 | Reviewer Snapshot packaging | GHL configuration/package | Clean V2 allowlist installed in a scratch account | Owner approves source Snapshot cleanup |
| FIND-075 | Marketplace scope drift | Marketplace configuration | Exact least-privilege list and reviewer explanations | Owner-assisted exact scope export/save |

## Important Beta Reliability Work

| Finding | Area | Classification | Required outcome |
|---|---|---|---|
| FIND-044 | Dashboard cold scans | Code/performance | No read-side mutations; bounded cold latency; reduced periodic fan-out |
| FIND-045 | Milestone completion latency | Code/reliability | Durable save returns promptly; trigger work is observable in background |
| FIND-048 | Defense regeneration latency | Code/reliability | Durable background compilation with progress and retry state |
| FIND-058 | Settings product truth | UI/content | Remove obsolete roadmap/coming-soon material from operational settings |
| FIND-060 | Payment processor filter | UI | Whop appears through capability-driven filtering |
| FIND-063 | Dispute queue truth | Code/UI | Active and historical disputes have status-appropriate actions |
| FIND-065 | Client action feedback | UI | Notes/messages show one success state and refresh affected data |
| FIND-069 | SSO error classification | Code/UI | Reinstall guidance only for a proven missing/revoked installation |
| FIND-070 | Cross-region deployment | Operations | App and database co-located or measured exception approved |
| FIND-072 | Production release control | Operations/security | Green reviewed branch cannot bypass production gate |

## Completed Locally But Not Yet Integrated

- FIND-071: `.gitignore` now excludes `scripts/.dbpass`, `tmp/`, and extracted temporary defense text. The change remains uncommitted on the remediation branch.
- Review closure: FIND-074 and FIND-075 are now in the certification ledger, journal, Snapshot inventory, and historical findings register.
- Code remediation is complete locally for FIND-044/045/048/049-058/059-067/069/074. This includes factual defense guards, processor/date validation, connector and Stripe health truth, Zoom host exclusion, bulk dashboard scoring, durable milestone delivery, queued defense regeneration, typed dependency failures, and settings cleanup.
- Migration 099 is required before this branch can deploy. It installs the durable trigger-delivery queue, atomic defense-regeneration claim, service-only RLS, and schema version 99.
- Full local verification on 2026-07-14: 160 suites / 1,326 tests passed, TypeScript passed, production build passed, `git diff --check` passed, and `npm audit --omit=dev` reported zero vulnerabilities.
- These findings remain launch gates until migration 099 is applied and the named live regressions are certified in the internal test location.

## Remediation Order

1. Code-only correctness repairs with narrow regressions: FIND-064, FIND-061/062, FIND-059, FIND-060, FIND-063, FIND-065/066.
2. Authentication and dependency failure handling: FIND-074, FIND-069, and the code portion of FIND-067.
3. Defense factual-integrity batch: FIND-049 through FIND-055.
4. Zoom identity and discovery: FIND-056/057.
5. Background-job and dashboard performance: FIND-044/045/048 and worker polling from FIND-067.
6. Owner-operated infrastructure and publication gates: FIND-007/013/025/035/068/070/072/073/075.
7. Fresh live proof for Stripe recurring, GHL workflows, connector publication, Zoom attendance, and the reviewer install.

## Deployment Rule

Remediation work starts from `codex/beta-remediation`. Do not push directly to `main` or trigger Railway production deployment until focused tests, the full suite, typecheck, build, migration review, and owner approval are complete.
