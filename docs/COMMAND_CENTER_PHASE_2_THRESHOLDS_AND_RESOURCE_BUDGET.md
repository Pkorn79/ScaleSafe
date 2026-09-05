# Command Center Phase 2 Thresholds And Resource Budget

**Status:** Approved for isolated implementation by Philip on 2026-07-23
**Applies to:** Isolated Phase 2 implementation and staging certification only
**Production activation:** Not authorized
**Threshold contract version:** `command-center-health-v1.1`

## 1. Purpose

This appendix is the numeric operating contract for Phase 2 of the ScaleSafe Command Center. It defines when a check becomes stale or unhealthy, when an incident opens or recovers, and how much database and application capacity the monitoring system may consume.

The thresholds are deliberately conservative for controlled beta. They favor durable detection of missing work over noisy alerts from a single timeout or Railway deploy. They do not claim independent detection of a total ScaleSafe or Supabase outage; that belongs to Phase 3 Guardian.

No threshold may be activated from an undocumented constant. Active check definitions are versioned seed data. A later threshold change requires a migration or an audited owner-approved configuration change.

## 2. Common Rules

### 2.1 Health states

- `healthy`: the latest authoritative state is within its contract.
- `degraded`: the check is outside its preferred range but has not crossed its incident threshold.
- `unhealthy`: the incident threshold has been crossed.
- `unknown`: ScaleSafe cannot establish current state from trusted data.
- `not_applicable`: the check does not apply to the scope.

`unknown` never rolls up as healthy.

### 2.2 Evaluation cadence

- Platform and queue health reconciliation: every 5 minutes.
- Dirty merchant health reconciliation: every 5 minutes, set-based and leased.
- Full merchant safety sweep: once every 24 hours, set-based and resumable.
- Current health is also refreshed after a relevant durable event changes.
- No provider API is polled merely to refresh a Command Center screen.

### 2.3 Failure debounce

- Security, cross-tenant, wrong-money, duplicate-money, destructive-data, and confirmed credential-compromise checks open a `critical` incident on the first verified observation.
- A money operation that remains `unknown` for more than 5 minutes after `provider_started_at` opens on the first verified observation because replay can cause duplicate money movement. A brief `unknown` state while a provider request is in flight is normal and does not open an incident.
- Other `urgent` checks require two consecutive failed 5-minute evaluations unless a check-specific rule below is stricter.
- `warning` checks require three consecutive failed 5-minute evaluations unless a duration threshold is explicitly listed.
- A listed duration threshold replaces count-based debounce. For example, a 15-minute stale threshold opens when the first evaluation verifies at least 15 minutes of staleness.
- A timeout or provider error from one request is evidence for the check; it is not by itself a provider-wide incident.

### 2.4 Recovery

- `critical` and `urgent` incidents require healthy evaluations at recovery time, 5 minutes later, and 10 minutes later before automatic resolution at the 10-minute mark.
- `warning` incidents require one healthy evaluation and at least 5 minutes of healthy dwell.
- Manual acknowledgement does not resolve or suppress an incident.
- Recovery writes an incident event and preserves the complete incident history.
- A resolved incident with the same deduplication key reopens if it recurs within 24 hours.

### 2.5 Suppression

- `critical` incidents for tenant isolation, wrong money, duplicate money, destructive data, or credential compromise cannot be suppressed.
- An authorized platform operator may suppress an `urgent` or `warning` incident for at most 24 hours.
- Suppression requires a reason, actor, start time, and expiration.
- Health evaluation continues during suppression. Suppression affects notification state, not the recorded health truth.

## 3. Worker Heartbeat Contracts

Workers continue using their existing database leases and adaptive polling. A heartbeat represents a **completed tick**, not process startup and not a transient Railway instance. Each worker maintains one current heartbeat row keyed by worker type. Instance identity is diagnostic context only.

Heartbeat persistence is bounded to one unchanged write per minute for money
reconciliation and one unchanged write per 5 minutes for the other workers.
Money reconciliation uses the shorter cadence because its degraded threshold is
5 minutes; the normal poll interval and task timeout must fit safely inside that
window. A state transition, timeout, or exhausted retry writes immediately.

| Worker key | Existing idle polling | Task timeout | Degraded after no completed tick | Incident threshold | Severity | Recovery dwell |
| --- | ---: | ---: | ---: | ---: | --- | ---: |
| `trigger_delivery` | up to 60 sec | 120 sec | 10 min | 15 min | urgent | 10 min |
| `external_evidence` | up to 60 sec | 75 sec | 10 min | 15 min | urgent | 10 min |
| `money_reconciliation` | up to 60 sec | 90 sec | 5 min | 10 min | urgent | 10 min |
| `defense_compilation` | up to 60 sec | 270 sec | 10 min | 15 min | urgent | 10 min |

Additional rules:

- A task timeout records `timed_out`. Phase 2 does not shorten or extend the existing database leases. Trigger, evidence, and money timeouts remain strictly shorter than their 180-, 90-, and 120-second leases. Defense remains inside its 300-second lease, while the pre-existing mismatch between that lease and the full Anthropic retry/fallback envelope is tracked separately.
- Only a productive tick that executed its claim query may refresh a completed-tick heartbeat. A second poller call that returns because the worker is already running cannot report health.
- Worker I/O is bounded. A timed-out promise is observed through an extended settlement deadline; Phase 2 does not start overlapping provider-boundary work merely because the monitoring timeout elapsed.
- A deploy or instance replacement does not open an incident if another instance completes the same worker tick within the stale window.
- A worker heartbeat can be healthy with zero claimed items.
- A worker is unhealthy if its latest completed tick failed continuously through the incident window, even if a timer is still running.

## 4. Scheduled Job Contracts

Every scheduled job uses a durable run key of `job_key + scheduled_window_start`. One instance claims a window, and a partial unique index permits at most one `running` row for a job key across all windows. A deploy or a second instance cannot create a duplicate or overlapping run. Catch-up claims only the most recent missed window; older missed windows are recorded as `missed` and are never replayed against current due data.

| Job key | Intended cadence | Start grace | Task timeout | Catch-up period | Incident rule | Severity |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| `provisioning_recovery` | 5 min | 5 min | 240 sec | 30 min | No successful run for 20 min | urgent |
| `payment_reminder_check` | 60 min | 10 min | 10 min | 4 hours | No successful run for 2 hours | urgent |
| `pulse_cadence_check` | 60 min | 10 min | 10 min | 4 hours | No successful run for 2 hours | urgent |
| `daily_account_health` | 24 hours | 60 min | 60 min | 48 hours | No successful run for 30 hours; urgent at 48 hours | warning, then urgent |
| `pif_completion_check` | 24 hours | 60 min | 30 min | 48 hours | No successful run for 30 hours; urgent at 48 hours | warning, then urgent |
| `command_center_health_reconcile` | 5 min | 5 min | 240 sec | 30 min | No successful run for 20 min | urgent |
| `merchant_health_full_sweep` | 24 hours | 60 min | 30 min per batch | 48 hours | Incomplete for 30 hours; urgent at 48 hours | warning, then urgent |
| `health_retention` | 24 hours | 2 hours | 10 min | 72 hours | No successful run for 72 hours | warning |

A scheduled run records `scheduled`, `running`, `succeeded`, `failed`, `timed_out`, `exhausted`, or `missed`. The run record includes counts and allowlisted error classes, never raw provider payloads or secrets. Jobs must surface fatal query or execution failure to the coordinator instead of logging an error and returning a false success.

Hourly jobs probe an unclaimed or externally owned window every 15 minutes.
Daily jobs probe every hour. Five-minute safety jobs retain five-minute probes.
These intervals remain inside each job's lease, catch-up, and incident windows
while avoiding repeated no-op claims against completed long-cadence windows.

The five-minute `command_center_health_reconcile` window performs both the
set-based global/queue evaluation and the leased dirty-merchant reconciliation.
They share one durable run because they have the same cadence, timeout, lease,
and incident contract. This keeps health-reconciliation history within the
approved 300-record daily budget without dropping either evaluation.

The current `daily_account_health` job deliberately sleeps one second per merchant and performs provider work per connected merchant. Its 60-minute contract is valid only through approximately 2,000 merchants. The 10,000-merchant Phase 2 load gate covers Command Center health storage, reconciliation, and read models, not 10,000 live processor API calls. Batching and rate-aware redesign of the existing processor health job is a separately measured follow-up before ScaleSafe approaches that merchant count.

## 5. Queue And Durable Operation Thresholds

Eligible age is measured from the time an item became due for its current attempt. A future `available_at` or `next_attempt_at` does not count as eligible backlog until it is due. Unresolved age is measured from the authoritative provider-accepted or provider-started timestamp and remains visible after retries are exhausted.

| Check key | Degraded | Incident threshold | Severity | Immediate rule |
| --- | --- | --- | --- | --- |
| `queue.trigger_delivery.pending` | oldest eligible item > 3 min | oldest eligible item > 10 min | urgent | Terminal failed or `unknown` outcome creates a merchant warning; lease-expiry unknowns do not count toward a provider parent |
| `queue.external_evidence.pending` | oldest due item > 5 min | oldest due item > 30 min | urgent | Quarantined event creates a merchant warning, not platform outage |
| `queue.money_reconciliation.pending` | oldest eligible item > 2 min | oldest eligible item > 5 min | urgent | `unknown` for more than 5 min is critical; provider-accepted but unreconciled for 10 min or 10 exhausted attempts is urgent regardless of current retry eligibility |
| `queue.refund_reconciliation.pending` | oldest eligible item > 2 min | oldest eligible item > 5 min | urgent | Provider-accepted refund not durably linked after 5 min or 10 exhausted attempts is urgent regardless of retry eligibility |
| `queue.defense_compilation.pending` | oldest eligible item > 5 min | oldest eligible item > 30 min | urgent | Terminal failed packet creates a merchant warning; `needs_review` is intentional and does not count as queue failure |
| `queue.provisioning.pending` | time since item became retryable > 20 min | time since item became retryable > 40 min | warning | Installation unavailable for an entitled merchant for 60 min escalates to urgent |

Depth is supporting context, not the primary incident trigger. Depth thresholds are:

- Warning context at 100 due items in one queue.
- Urgent context at 1,000 due items in one queue.
- Age thresholds still decide health when normal business growth raises queue depth.
- An expired lease is counted separately. Ambiguous provider-boundary leases retain their existing `unknown` safety behavior and are never blindly replayed.

## 6. Platform And Database Thresholds

Phase 2 can observe failures while the application and Supabase are available. Independent outage detection remains Phase 3.

| Check key | Cadence | Degraded | Incident threshold | Severity |
| --- | ---: | --- | --- | --- |
| `platform.schema_version` | startup and 5 min | database above code-required version is informational | database below code-required version on first verified mismatch | urgent |
| `database.canary_latency` | 5 min | p95 > 750 ms for 15 min | p95 > 2,000 ms or canary failures for 10 min | urgent |
| `database.request_timeouts` | 5 min rollup | >= 3 in 15 min | >= 10 in 15 min or >= 5% of observed DB requests | urgent |
| `application.http_5xx` | 5 min rollup | >= 5 and >= 2% in 15 min | >= 20 and >= 5% in 15 min | urgent |
| `application.http_latency` | 5 min rollup | p95 > 1,500 ms for 15 min | p95 > 3,000 ms for 15 min | warning |
| `dangerous_flag_posture` | startup and 15 min | n/a | first verified production-unsafe flag | critical |

Expected client errors (`400`, `401`, `403`, `404`, `409`, `422`, and `429`) are counted but do not become `5xx` incidents. Repeated authentication denials are evaluated separately as security observations without storing request bodies or credentials. Restart-rate incidents are deferred to Phase 3 because the application cannot reliably distinguish Railway deploy starts from crash restarts without deployment metadata.

## 7. Provider-Wide Dependency Suppression

A provider-wide parent incident may be created only when the same allowlisted failure class is observed within 15 minutes for:

- at least 3 active locations and at least 50% of active locations using that provider; or
- at least 10 active locations regardless of percentage.

The parent must identify one provider/component such as Supabase, GHL trigger delivery, Stripe API, NMI, Whop, Zoom, or Anthropic. Linked merchant incidents remain visible but are notification-suppressed while the parent is active. Only one parent level is allowed.

Security, cross-tenant, wrong-money, and duplicate-money incidents are never suppressed beneath a provider parent.

## 8. Merchant Rollup Contract

Each merchant has one current rollup with these components:

- installation and entitlement
- processor and money
- workflows
- evidence connections
- defense
- billing and scheduled activity

Rollup precedence is `critical incident` > `urgent incident` > `unhealthy` > `warning incident` > `degraded` > `unknown` > `healthy` > `not_applicable`.

Low merchant activity does not create an incident. A time-based check applies only when a durable record says activity was expected, such as a due payment, active pulse schedule, pending trigger job, active connector, queued defense, or incomplete provisioning run.

Merchant list and detail reads must intersect results with live server-derived operator authorization. A cached reseller or organization identifier is a filter optimization, never the authorization decision.

Phase 2 permissions are registered in the Phase 1 permission registry. `platform_owner` and `platform_ops` may read, acknowledge, and suppress permitted incidents. `security_auditor` and `platform_support` are read-only. Reseller roles receive the standard indistinguishable `404` until the separately gated reseller phase.

## 9. Observation And Retention Budget

### 9.1 Write controls

- Current heartbeats: maximum one unchanged money-reconciliation write per
  minute and one unchanged write per other worker every 5 minutes.
- Current health rows: write on state or contract change, plus one confirmation every 6 hours while non-healthy. Volatile metrics from an unchanged healthy evaluation do not rewrite the row; durable job history proves evaluation cadence and application metric buckets retain the live measurements.
- Healthy merchant state is not rewritten during a no-change full sweep.
- Observation history: write on state transition, incident transition, or non-healthy 6-hour confirmation.
- HTTP and database metrics: aggregate in memory and flush one row per instance per 5-minute bucket.
- Dashboard reads never write health observations.

### 9.2 No-change 24-hour budget

On one application instance with no merchant or queue state changes, Phase 2 may add no more than:

- 2,500 heartbeat writes.
- 300 health-reconciliation run updates.
- 350 scheduled-job run records.
- 300 application metric rollups.
- 100 additional health/incident writes.
- 4,500 Supabase requests added by Command Center per application instance. Total
  application Supabase traffic is recorded separately as the denominator for
  database health, but pre-existing queue-worker polling is not charged to this
  incremental Phase 2 budget.
- Zero additional Stripe, NMI, Whop, GHL, Zoom, Anthropic, or other provider requests.

Each 5-minute evaluation cycle uses at most three consolidated Supabase requests. The 24-hour staging soak fails if any limit is exceeded by more than 10% without a documented forced-failure test.

### 9.3 Retention

- Current heartbeat, current health, and merchant rollup rows: retained while the subject exists.
- Job-run history and application metric buckets: 90 days.
- Health observation history: 180 days.
- Incident and incident-event history: 1 year for controlled beta; no automatic deletion until the retention job is certified.
- Sanitized diagnostic detail is capped at 4 KB per row.
- No raw webhook, processor payload, email body, card/bank data, credential, token, or private file is copied into health or incident tables.

## 10. Query And Capacity Budget

The Command Center must remain set-based and paginated.

| Operation | Maximum application queries | 10,000-merchant staging target |
| --- | ---: | ---: |
| Platform overview | 4 | p95 <= 300 ms |
| Merchant list, 50 rows | 3 | p95 <= 350 ms |
| One merchant health detail | 6 | p95 <= 350 ms |
| Incident list, 50 rows | 3 | p95 <= 300 ms |
| Dirty reconciliation batch | 4 | 500 merchants <= 2 sec |
| Full-sweep batch | 4 | 1,000 merchants <= 5 sec |
| One observation plus incident evaluation | 1 RPC | p95 <= 250 ms |

Additional capacity rules:

- No N+1 query per merchant, queue item, incident, reseller assignment, or health component.
- Normal reconciliation uses at most one concurrent batch per job key.
- Database claim limits remain bounded: trigger delivery 5; evidence 20; money plus refund 40 combined; defense compilation 3 unless a later measured change is approved.
- Phase 2 adds no provider polling loop.
- Monitor failures back off; they never spin faster because Supabase is slow.
- The health feature flag disabled state starts no Phase 2 scheduler and serves no Phase 2 route.
- Dirty-marking hooks on checkout, payments, triggers, evidence, defenses, and provisioning are flag-gated, non-blocking, error-swallowing, and limited to one health write per durable business event. A health-table failure cannot fail the underlying business operation.

## 11. Incident Notification Boundary

Phase 2 creates and manages durable incidents in the isolated Command Center. It does not claim independent notification during a total application or database outage.

- Existing merchant-facing GHL health workflows remain the merchant notification path.
- Phase 2 does not send duplicate merchant alerts.
- Command Center acknowledgement and suppression are recorded, but independent SMS/push/email delivery and dead-man monitoring are Phase 3 Guardian.

## 12. Phase 2 Acceptance Gate

Phase 2 passes only when all of the following are proven in isolated staging:

1. Every worker publishes completed-tick state and recovers after a forced failure.
2. Every scheduled job uses a durable window key and runs once across concurrent instances.
3. A task timeout cannot permanently stop a poller or cause blind replay at an ambiguous provider boundary.
4. Queue age, not raw depth alone, determines backlog health.
5. Concurrent observations create one open incident per deduplication key.
6. Provider-wide failure creates one parent and linked suppressed children without suppressing security or money-integrity incidents.
7. Recovery dwell resolves the incident and retains its complete event history.
8. Disabled health flags start no scheduler and expose no health route.
9. Cross-tenant and cross-reseller authorization tests pass for every health and incident read.
10. The 24-hour no-change soak remains within the write/request budget.
11. Seeded 100, 1,000, and 10,000-merchant tests meet the query and latency targets.
12. Existing checkout, payment, refund, trigger, evidence, defense, provisioning, and Marketplace behavior remains unchanged.
13. Fault injection proves health-table or incident-engine failure cannot fail checkout, payment recording, trigger delivery, evidence materialization, defense compilation, or provisioning.

Passing this gate authorizes a Phase 2 completion report only. It does not authorize migration, flags, DNS, merge, or deployment in production.

## 13. Owner Approval Record

Philip approved the following contract for isolated Phase 2 implementation on 2026-07-23:

- the incident timing and severity tables;
- the corrected 4,500-request no-change budget per application instance;
- the query and latency targets;
- the 90-day, 180-day, and 1-year retention periods; and
- the boundary that independent outage alerts remain Phase 3.

The recommended implementation choices are: surface fatal scheduled-job errors to the coordinator; preserve existing queue leases; include aggregated HTTP `5xx` and latency metrics in Phase 2; defer restart-rate detection to Phase 3; use 90/180/365-day retention; grant suppression only to `platform_owner` and `platform_ops`; and apply the provider-parent gates in Section 7 without a second conflicting trigger count.

Approval applies only to isolated Phase 2 development and certification. Production remains separately gated.
