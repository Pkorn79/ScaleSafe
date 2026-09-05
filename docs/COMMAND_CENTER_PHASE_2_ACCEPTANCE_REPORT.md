# Command Center Phase 2 Acceptance Report

**Date:** 2026-07-25
**Branch:** `codex/beta-remediation`
**Baseline before Phase 2 work:** `c7ae87ee76f7b88ff025f85bfe7efdd9ddf45eb3`
**Production status:** Not deployed; migration 104 not applied; feature flags remain disabled

## Verdict

**Phase 2 is certified in isolation.**

The exact current artifact compiles, passes the complete regression suite, replays
cleanly through migration 104, passes the database behavior and concurrency
harnesses, enforces operator authorization over HTTP, stays far inside the
10,000-merchant latency targets, and completed a continuous healthy soak lasting
25.74 hours. The corrected authoritative run started at
`2026-07-24T01:16:15Z`; its final checker returned `healthy` with no current or
historical safety failure. Production remains separately gated.

## Exact Artifact

- Application directory: `/tmp/scalesafe-phase2-app-20260724j`
- Isolated Supabase workspace: `/tmp/scalesafe-phase2-104-20260723`
- Application PID: `1004225`
- Loopback-only application port: `3107`
- Package-lock SHA-256:
  `e4176c9dfd5e38ba381ea7ba1b25634b231e6a3cdfce54f49b4c14d49236cafe`
- Compiled Command Center runtime SHA-256:
  `23a471fe4eedb8582c2bf1fe07ba3b290a949a9235d5b2f8ee045348cf07fd55`
- Compiled health service SHA-256:
  `6e1c0c2a5d9f011bd91fb81d4f394273fffea903e7fad1a8eb41520fee2d7447`
- Migration 104 SHA-256:
  `6ba8fd718472f0324f71678fef1dbb3b3b47fd55216accee85995078c3b25e44`

The isolated application has no production provider credentials and the clean
database contains zero merchants. This makes any provider request a test
failure.

## Proven

### Schema and database behavior

- Migrations 001-104 replay from scratch in the isolated Supabase stack.
- The database reports schema version 104.
- Migration 104 separates operational scheduling from monitoring:
  `scheduled_job_definitions` owns business and monitoring schedules, while
  `health_check_definitions` owns health contracts. Disabling a health contract
  cannot prevent provisioning, reminders, pulse, account health, or PIF jobs.
- Tenant binding, incident deduplication, provider grouping, protected money
  incidents, suppression expiry, escalation, recovery dwell, immutable history,
  sweep checkpoints, and pagination pass the database behavior harness.
- A timed-out job can settle late, quarantine its ambiguous run, and allow the
  next window to succeed.
- A failed worker heartbeat opens an incident and subsequent healthy heartbeats
  resolve it only after the required recovery dwell.
- A 20-client PostgreSQL concurrency test produces one current-health row, one
  open incident, one scheduled run, and one lease owner.

### Authorization

The exact artifact passed the adversarial HTTP matrix:

- Platform owner can read platform health.
- Reseller receives `404` for platform health.
- Reseller can read only an actively assigned merchant.
- Unassigned and nonexistent merchants return indistinguishable `404` bodies.
- Mixed merchant/operator identity planes return `400`.
- Support access expires immediately with its grant.
- Disabled users, revoked memberships, and revoked sessions return `401`.
- A reseller assignment transfer removes access immediately.
- Operator actions are written with actor attribution.

### Capacity

The exact artifact passed the HTTP scale matrix:

| Seeded merchants | Platform overview p95 |
| ---: | ---: |
| 100 | 23.600 ms |
| 1,000 | 22.112 ms |
| 10,000 | 24.687 ms |

- The largest 1,000-merchant reconciliation batch at 10,000 merchants was
  806.08 ms against a 5,000 ms limit.
- The 10,000-row cursor traversal was complete and duplicate-free.
- Earlier rollback-only database tests also passed dirty reconciliation,
  no-change updates, platform reads, and observation/incident RPC targets.

### Fault containment

- Checkout/payment money state remains durable when its health dirty-write
  rejects.
- Evidence materialization succeeds when its health write rejects.
- Trigger delivery succeeds when dirty-state and heartbeat writes reject.
- Defense compilation completes and clears its lease when monitoring writes
  reject.
- Provisioning executes independently after global health evaluation fails.
- Source-boundary tests prove checkout, payment, and provisioning modules do not
  directly depend on health or incident services.
- Operational job coordination uses the independent durable scheduler
  repository, not the Command Center health repository.

### Regression and release hygiene

- Full regression: **193 suites and 1,548 tests passed**.
- Focused heartbeat-cadence and migration tests: 2 suites and 40 tests passed.
- TypeScript typecheck passed.
- Production build passed, including Vue/Vite assets.
- `git diff --check` reports no whitespace errors.
- Offline npm advisory data reports zero production vulnerabilities. The exact
  lockfile is unchanged from the fresh production-only dependency install that
  previously reported zero known vulnerabilities.
- A high-confidence secret-pattern scan found no Stripe, Anthropic, GitHub,
  private-key, age identity, or production database credential in the changed
  Phase 2 surface. The only database URLs found were loopback examples and a
  runtime URL constructor.

## Startup Race Found and Corrected

The first exact-artifact soak attempt exposed a deterministic startup race.
Health reconciliation and retention both began after 15 seconds, so the
evaluator could inspect retention milliseconds before its first successful run
and report `unknown`.

The initial health evaluation now waits 30 seconds. Monitored jobs retain their
15-second start. The corrected artifact started with:

- schema version 104;
- zero merchants;
- zero open incidents;
- zero nonhealthy checks;
- zero nonhealthy workers;
- zero failed jobs;
- zero provider requests; and
- zero application log error matches.

## Heartbeat Boundary and Cadence Findings

The next soak ran cleanly at startup but exposed a second timing defect after
two hours. JavaScript throttled unchanged worker heartbeats using the productive
tick's completion time. PostgreSQL throttled them using the slightly later
database persistence time. A valid five-minute heartbeat could therefore miss
the database boundary by milliseconds while the application assumed the write
had succeeded. The money worker briefly appeared degraded until its following
heartbeat even though its ticks continued normally.

Migration 104 now applies the five-minute throttle using `last_completed_at` on
both sides. A real database regression writes two healthy ticks exactly five
minutes apart in immediate succession; the old predicate rejects the second
tick and the corrected predicate accepts it. The complete behavior harness and
full regression suite pass with the correction.

The subsequent `2026-07-23T22:56:20Z` soak proved that the clock correction was
necessary but not sufficient. Money reconciliation is declared degraded after
five minutes without a persisted completed tick, while unchanged heartbeats
were also throttled to five minutes. Normal adaptive-poller timing therefore
left no safety margin. The evaluator recorded:

- degraded at `2026-07-23T23:35:01Z`, recovered at `23:40:01Z`; and
- degraded at `2026-07-24T00:30:01Z`, recovered at `00:35:01Z`.

The current-state-only checker initially missed both recovered transitions. The
correction persists unchanged money-reconciliation heartbeats once
per minute, retains the five-minute throttle for workers with ten-minute stale
thresholds, and makes any nonhealthy observation during a soak a permanent
failure for that run. It passed clean migration replay, the real database
boundary and behavior harness, the 20-client concurrency test, the complete
test/build gates, the authorization matrix, and the 10,000-merchant scale
matrix before the new authoritative soak started.

## Invalidated Soak Samples

The following samples are diagnostic history only and cannot satisfy the gate:

- The early two-reconciliation-job sample.
- The healthy-row volatile-metric rewrite sample.
- The `2026-07-23T17:57:59Z` probe-frequency sample.
- The `2026-07-23T18:18:21Z` outdated-artifact sample.
- The `2026-07-23T20:30:14Z` startup-race sample.
- The `2026-07-23T20:41:57Z` heartbeat-clock mismatch sample.
- The `2026-07-23T22:56:20Z` heartbeat-cadence sample.

Each was stopped before the next run. No stale process remains.

## Authoritative 24-Hour Soak

- Started: `2026-07-24T01:16:15Z`
- Artifact: `/tmp/scalesafe-phase2-app-20260724j`
- PID: `1004225`
- Database: clean loopback-only Supabase, replayed through schema 104
- Initial status: `in_progress`
- Initial observations: 31 healthy, zero nonhealthy
- Initial incidents, failed jobs, provider requests, HTTP 5xx, database
  timeouts, and log error matches: zero
- Initial other health writes: 93 of the 100-write contract

The soak checker measures process liveness, the health endpoint, schema version,
merchant count, incidents, worker state, durable jobs, PostgreSQL write
counters, HTTP failures, database timeouts, application metrics, Command Center
Supabase requests, and outbound provider requests.

### Final result

The final checker ran after 25.74 continuous hours and returned `healthy`.
The same Node process, PID `1004225`, had remained alive since
`2026-07-24T01:16:14Z`; its loopback health endpoint returned `200`.
After the final checker, log review, and database history review were preserved,
the isolated app stopped cleanly. PID `1004225` no longer exists, port `3107`
is closed, and the proof log remains in the isolated artifact directory.

Final checker state:

- Schema version: 104.
- Merchants: 0.
- Current nonhealthy checks: 0.
- Nonhealthy workers: 0.
- Failed jobs: 0.
- Open incidents: 0.
- Historical nonhealthy observations: 0.
- HTTP 5xx responses: 0.
- Database timeouts: 0.
- Database canary failures: 0.
- Provider requests: 0.
- Checker-recognized application log errors: 0.
- Failure list: empty.

The checker was intentionally rerun on the next scheduled heartbeat after the
24-hour boundary, so its raw cumulative values cover 25.74 hours. The checker
allows no more than ten percent scheduling overage for a late final collection.
Its raw cumulative values remained inside those hard ceilings:

| Resource | Final actual | Nominal 24-hour budget | Late-check hard ceiling |
| --- | ---: | ---: | ---: |
| Heartbeat writes | 1,882 | 2,500 | 2,750 |
| Health reconciliation runs | 312 | 300 | 330 |
| Scheduled job records | 370 | 350 | 385 |
| Application metric rows | 309 | 300 | 330 |
| Other health writes | 93 | 100 | 110 |
| Command Center Supabase requests | 2,811 | 4,500 | 4,950 |

The exact first 24-hour database window also stayed inside every nominal
time-window budget:

| Resource | Exact 24-hour result | Budget |
| --- | ---: | ---: |
| Health reconciliation runs | 289 | 300 |
| Non-health scheduled job records | 345 | 350 |
| Application metric rows | 289 | 300 |
| Command Center Supabase requests | 2,627 | 4,500 |
| Provider requests | 0 | 0 |

All 636 scheduled job records in the exact 24-hour window succeeded. Across the
full 25.74-hour collection, all 682 scheduled job records succeeded.

### Final database history review

- `health_current` contained 31 rows, all `healthy`.
- `health_observations` contained 31 observations during the soak, all
  `healthy`; there was no recovered nonhealthy transition hidden by current
  state.
- All four worker heartbeats were `healthy`, had no error class, and were
  between 8.9 and 166 seconds old at the final review.
- `platform_incidents` contained no incident created during the soak.
- `health_dirty_scopes` was empty.
- The clean database still contained zero merchants.

### Final application log review

The complete log contained 128 structured records:

- 127 informational records.
- One startup warning, described below.
- No `error`, `fatal`, unhandled exception, connection-reset, or
  connection-refused match after startup.
- No Stripe, webhook, authorization, Supabase service-key, database URL,
  private-key, card-number, or processor-encryption secret pattern.

### Isolated Storage startup observation

The complete application-log review found one level-40 warning at startup:
`Could not ensure storage bucket exists`. Local Kong returned `502` because it
still routed Storage API traffic to the previous Storage container address
immediately after the isolated Supabase stack restarted. The restarted Storage
container was healthy on its new address, and a subsequent read-only request
through the same local API returned `200`.

Because bucket setup is a one-shot startup action, the isolated database still
contains only its seeded legacy bucket. This run does not exercise Storage,
attachments, or defense-PDF generation. The warning is unrelated to the Phase 2
runtime, and no Command Center check, worker, job, incident, provider boundary,
or database canary was affected. It therefore does not invalidate the isolated
Command Center no-change soak, but the final report must not describe the
application log as warning-free. No production system was touched and no
storage code or test environment was changed during the run.

## Acceptance Gate Status

| Gate | Status | Evidence |
| --- | --- | --- |
| Worker completed ticks and recovery | Proven | Unit and isolated failure/recovery harness |
| Durable once-per-window scheduling | Proven | Unit contracts and 20-client database claim test |
| Timeout cannot stop poller or cause blind replay | Proven | Unit timeout tests and late-settlement database harness |
| Queue age drives backlog health | Proven | Versioned definitions and evaluator tests |
| Concurrent observations deduplicate incidents | Proven | 20-client database test |
| Provider parent incident behavior | Proven | Isolated SQL behavior harness |
| Recovery dwell and retained history | Proven | Isolated SQL behavior harness |
| Disabled flag starts no Phase 2 surface | Proven | Runtime gate and route tests |
| Tenant and reseller authorization | Proven | Exact-artifact adversarial HTTP matrix |
| 10,000-merchant query and batch targets | Proven | Exact-artifact HTTP and database matrices |
| Monitoring failure cannot break business paths | Proven | Six fault-containment paths plus dependency-boundary test |
| Existing automated behavior unchanged | Proven | 193 suites / 1,548 tests and production build |
| 24-hour no-change budget | Proven | Final checker `healthy` after 25.74 continuous hours; exact 24-hour window remained within nominal budgets |

## Production Remains Separately Gated

Phase 2 certification is complete, but it does not authorize production.

Before production:

1. Obtain Philip's explicit approval before applying migration 104, enabling
   either Command Center feature flag, merging, or deploying.
2. Use migration-first deployment ordering if production is later approved.
3. Run the approved production-safe post-deploy verification without enabling
   Phase 3.

Passing this report does not authorize Phase 3, production SQL, Railway changes,
Marketplace changes, a merge, or a push to `main`.

## Repeatable Proof

- `scripts/replay-isolated-pending-migrations.sh`
- `scripts/verify-command-center-phase2-behavior.sh`
- `scripts/verify-command-center-phase2-concurrency.sh`
- `scripts/verify-command-center-phase2-auth.sh`
- `scripts/verify-command-center-phase2-scale.sh`
- `scripts/check-command-center-phase2-soak.sh`
- `scripts/start-command-center-phase2-soak.sh`
- `scripts/stop-command-center-phase2-soak.sh`

Every script refuses non-loopback database or application targets where
applicable.
