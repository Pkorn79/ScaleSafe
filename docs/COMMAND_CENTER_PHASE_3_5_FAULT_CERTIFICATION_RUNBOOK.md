# Phase 3.5 Fault Certification Runbook

**Status:** Prerequisite remediation is frozen and fully tested. The isolated
harness is in progress. Production is not authorized.

## Frozen Baseline

- ScaleSafe branch: `codex/beta-remediation`
- ScaleSafe documentation baseline: `ea35246`
- ScaleSafe runtime candidate:
  `8a14838b7b9dc2b0a05f42affcc9ea21288f16e1`
- Guardian branch: `codex/phase35-fault-certification`
- Guardian baseline before Phase 3.5 remediation:
  `d6a2b0103bc3730ff2a48641bde53e6f3a7e6d85`
- Guardian runtime candidate:
  `cc0f3ef8e342f7a5fabd36bce9551a12a9fc7da2`
- Prerequisite verification: ScaleSafe 1,616/1,616 tests, typecheck, and
  production build passed; Guardian 106/106 tests passed.
- Do not run faults against uncommitted files. Build and package candidates
  directly from the recorded Git objects.
- Production migration 105: unapplied

The Phase 3.5 harness must record full commit IDs and checksums before its first
fault. If either candidate changes, discard the run and establish a new baseline.

## Non-Negotiable Boundaries

- Use a disposable ScaleSafe app, disposable schema-105 database, isolated
  Guardian state, isolated alert state, and synthetic incident IDs.
- Bind every local test service to `127.0.0.1`. Before data is loaded, verify
  from another machine that every published test port is closed.
- Never run `supabase db reset` in this workspace. Supabase CLI 2.109.1 was
  observed reattaching the database container to its generated bridge and
  publishing port 54322 on `0.0.0.0`. Start a fresh project once on the
  loopback-forcing bridge, then apply later migrations directly through the
  loopback PostgreSQL URL. Stop immediately if any listener changes to
  `0.0.0.0` or `::`.
- Never copy production merchant, payment, contact, evidence, or credential data.
- Never apply migration 105 to production, deploy Railway, change production
  flags, merge, push, or enable recurring Guardian/OpenClaw timers.
- Never delete or alter a real backup object. A live B2 negative test may use a
  nonexistent expected prefix with the existing read-only credential.
- Provider tests may use only the approved Better Stack certification heartbeat
  and sanitized GHL operational-alert workflow.
- Stop immediately for cross-tenant data, secret/PII output, an unexpected
  external target, an unbounded retry, a duplicate side effect, or a test port
  reachable outside loopback.

## Proof Classes

- **Automated isolated:** machine-verifiable fault, result, restoration, and
  idempotency proof using loopback services and disposable state.
- **Read-only provider:** a real provider is queried or intentionally given a
  non-mutating bad expectation; no provider data is changed.
- **Owner observed:** Philip independently confirms email, SMS, Better Stack
  incident, acknowledgement, or resolution. Guardian stores only hashed provider
  references.

## Fault Matrix

| ID | Fault | Injection | Required result | Recovery proof |
|---|---|---|---|---|
| F01 | Healthy baseline | Start the loopback database, app, Guardian stubs, and isolated state | All expected observations healthy; no incident, alert, quarantine, or pending outbox | Repeat cleanly with identical counts |
| F02 | Unavailable test endpoint | Configure the optional operator probe to an unused loopback port | Source becomes `unknown`; one urgent incident opens; no stale-healthy state | Two healthy observations resolve once |
| F03 | ScaleSafe app stopped | Stop only the isolated app | API, snapshot, and all six snapshot children fail closed; every incident is retained; only the API root notifies | Restart app; two healthy runs create one API resolution; never-notified children resolve silently |
| F04 | Local Supabase stopped | Stop only the Phase 3.5 database stack while the app remains up | `/health` fails, snapshot authority becomes unavailable, and the same API-root suppression tree applies; local outbox and incident history survive | Restart database; app reconnects; pending records reconcile exactly once |
| F05 | App and Supabase stopped | Stop both isolated services | Guardian remains operational and local records remain durable; one parent outage notification, no alert storm | Restart database then app; stable recovery resolves once |
| F06 | Guardian killed and restarted | Kill a supervised isolated Guardian process at a deterministic checkpoint | No corrupt state or duplicate sequence; interrupted work is fail-closed | Restart against the same state and reconcile once |
| F07 | Guardian network blocked | Run Guardian in a temporary network-isolated execution context | Network authorities become `unknown`; local incident and outbox remain durable | Restore network; exact pending requests reconcile once |
| F08 | Better Stack heartbeat fails | Withhold the approved certification heartbeat beyond its grace window | Better Stack opens an out-of-band incident independently of ScaleSafe/GHL | Resume clean heartbeat; owner confirms acknowledgement and resolution |
| F09 | GHL alert delivery fails | Use an approved provider-host URL that is guaranteed to reject without mutating GHL | Alert remains retryable/failed locally; GHL is not labeled notified; Guardian withholds heartbeat | Better Stack independently alerts; restore valid GHL URL and reconcile once |
| F10 | OpenClaw/model unavailable | Run the isolated handoff with an unavailable runtime/model credential boundary | Deterministic Guardian continues; advisory handoff becomes bounded `retrying`; no action executes | Restore certified runtime; one advisory completes without duplicate execution |
| F11 | ScaleSafe accepts but response is lost | Loopback proxy forwards one signed request, drops the response, then permits retry | Exact request, body hash, and sequence remain pending; no second domain mutation | Exact retry returns the original receipt and advances once |
| F12 | Forged/replayed/stale/gapped/oversized/never-seen key | Execute every shared protocol vector, including `unknown_credential_key_fails_authentication`, through the real isolated route and schema-105 claim RPC | Every invalid request fails with the expected generic contract and no unauthorized mutation | A subsequent valid request succeeds at the expected sequence |
| F13 | Backup status faults | Use copied status fixtures: missing, stale, failed, malformed, hash-tampered | Every invalid authority becomes `unknown` or `unhealthy`, never stale-healthy; no secret fields | Restore a valid copied receipt; stable recovery resolves once |
| F14 | B2 marker/object missing | Use the restricted key with a nonexistent expected prefix; never alter B2 | Read-only verifier reports missing marker/object and cannot write/delete/change retention | Restore the expected prefix; object hashes verify healthy |
| F15 | Restore proof stale | Use copied, correctly hashed current and intentionally stale restore proofs | Stale proof opens one incident; malformed/tampered proof fails closed | Restore current proof; two healthy observations resolve once |

## Exact Local Expectations

The certification profile omits the optional operator, DNS, and TLS probes. A
healthy run therefore contains exactly 11 observations: public API, three
recovery checks, snapshot freshness, and six snapshot-derived checks.

| Fault | Anomalous observations | Open notifications | Resolution notifications |
|---|---:|---:|---:|
| F01 | 0 | 0 | 0 |
| F02 | 1 of 12 | 1 operator | 1 operator after two healthy runs |
| F03 | 8 of 11 | 1 API | 1 API; suppressed children resolve silently |
| F04 | 8 of 11 | 1 API | 1 API; suppressed children resolve silently |
| F05 | 8 of 11 | 1 API | 1 API; suppressed children resolve silently |
| F06 | 1 synthetic incident | 1 after restart | 1 after two healthy runs; no duplicate opening |
| F07 | 9 of 11 | 2 roots: API and backup object | 2 after stable recovery; pending sends reconcile once |
| F10 | 0 deterministic health anomalies | 0 health alerts; 1 advisory enters bounded retry | 1 advisory completion |
| F11 | 0 health anomalies | 0 | 0; one original receipt on exact retry |
| F13 | 1 backup-status root per isolated subcase | 1 per subcase | 1 per subcase after two healthy runs |
| F14 | 1 backup-object root | 1 | 1 after two healthy runs |
| F15 | 1 restore-proof root | 1 | 1 after two healthy runs |

F08 and F09 use their provider-specific counts. F08 must create one Better Stack
incident and one resolution. F09 must create one local alert transition whose
provider delivery remains unnotified until the valid GHL endpoint is restored;
the withheld heartbeat must create one Better Stack incident and one resolution.
F12 executes every named vector independently and compares exact HTTP, receipt,
sequence, and mutation deltas from the shared contract.

## Parent Notification Rules

The shared `check-catalog.json`, migration 105, and Guardian runtime must match
exactly. Each check follows only its direct catalog parent; those direct edges may
cascade through the full dependency tree:

- `public.api.reachability` -> snapshot freshness and deployment.
- Snapshot freshness -> database, HTTP, and security.
- Database -> workers, queues, and jobs.
- Backup status -> backup object.
- DNS -> TLS.

Suppression never changes child incident state, severity, occurrence, or recovery
history. A child that was never owner-notified must not emit a stray resolution.
When its direct parent is healthy and the child remains nonhealthy, the child
becomes independently notifiable. An explicit security failure from a fresh,
healthy snapshot is not suppressed; security becomes suppressed only when its
snapshot authority is itself unavailable or stale. App outages never suppress
independent backup-status, restore, CI, alert-channel, or dead-man authorities.

## Harness Requirements

The harness must:

1. Refuse a dirty or changed candidate.
2. Refuse any listener not bound to loopback. Before schema or test data is
   loaded, prove the Supabase ports closed from both the VPS public address and
   its Tailscale address.
3. Allocate unique state and project directories for each run.
4. Record fault start, observation, incident, alert, recovery, duration, and
   resource usage without secrets or PII.
5. Assert exact incident and transition counts after every fault.
6. Restore each fault before advancing.
7. Leave Guardian/OpenClaw recurring timers disabled.
8. Write source artifacts only beneath
   `/var/tmp/scalesafe-phase35-certification/<run-id>/` on the VPS and copy the
   sanitized proof bundle to
   `certification-artifacts/phase35/<run-id>/` locally.
9. Record SHA-256 hashes for both candidate commits, migration 105, shared
   protocol files, configuration templates, and every final proof artifact.
10. Produce a machine-readable result plus a concise acceptance report.

## Numeric Resource Budget

- Disposable stack peak memory: at most 6 GiB.
- Artifact and container disk growth: at most 10 GiB during certification.
- Guardian deterministic run: at most 30 seconds; any bounded provider/model run:
  at most 120 seconds.
- Sustained five-minute load average: no higher than the VPS vCPU count; brief
  peak: no higher than twice that count.
- OpenRouter spend for all Phase 3.5 certification: at most $0.25.
- GHL: only the explicitly counted certification notifications; no merchant or
  production workflow traffic.
- Better Stack: one F08 and one F09 incident/resolution pair only.
- B2: zero writes, deletes, retention changes, or key changes.

Exceeding any budget fails the run and requires a fresh isolated attempt after
review; it is not waived by an otherwise correct functional result.

## Acceptance Gate

Phase 3.5 passes only when:

- F01 through F15 pass against one immutable candidate.
- Authoritative sources become `unknown`, never stale-healthy, when absent.
- Parent suppression prevents duplicate owner notifications without hiding child
  incident history.
- Every pending run and delivery reconciles exactly once after recovery.
- Warning email, critical email/SMS, dead-man incident, provider-failure
  escalation, acknowledgement, and resolution are independently proven.
- Logs and artifacts contain no secrets or merchant PII.
- Peak CPU, memory, disk growth, run duration, and provider usage remain within
  the approved Phase 3 budget.
- Full Guardian and ScaleSafe regressions remain green.
- Fable independently reviews the final harness, results, and any remediation.

Passing Phase 3.5 does not authorize Phase 3.6 or any production activation.
