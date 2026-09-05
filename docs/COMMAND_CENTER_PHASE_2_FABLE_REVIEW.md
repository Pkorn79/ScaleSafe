# Command Center Phase 2 Independent Review

**Reviewer:** Claude Fable
**Review mode:** Audit-only plan mode
**Date:** 2026-07-22
**Verdict:** Approved with changes
**Implementation performed by reviewer:** None

## Scope

The review compared the proposed Phase 2 threshold and resource-budget appendix with the current worker, queue, scheduled-job, lease, retry, processor-boundary, and operator-authorization code through migration 103.

## Confirmed Findings

1. A money operation is intentionally set to `unknown` immediately before every provider call. Treating the first observed `unknown` state as critical would false-alarm on healthy checkouts. The corrected contract requires more than 5 minutes in that state.
2. Proposed evidence and money worker timeouts exceeded their existing 90- and 120-second leases. The corrected timeouts are 75 and 90 seconds. Defense uses 270 seconds inside its 300-second lease, while the larger Anthropic retry-envelope mismatch remains separately tracked.
3. Money and refund rows stop being claimable after 10 reconciliation attempts but remain unresolved. Health must inspect provider-accepted age and exhausted attempts independently of claim eligibility.
4. A poller invocation that returns because a prior tick is still running cannot refresh a completed-tick heartbeat. Only a productive claim-query tick can do so.
5. Trigger jobs made `unknown` by lease expiry need merchant review but must not independently manufacture a provider-wide outage during Railway deploy churn.
6. The current daily account-health loop sleeps one second per merchant and is not a 10,000-merchant provider polling design. Phase 2's 10,000-merchant gate applies to the Command Center storage and read path; processor-health batching is a separately measured scale change.
7. Durable scheduled windows require one running row per job key across all windows. Only the latest missed window may run because current jobs scan current state and cannot safely replay historical windows.
8. The original 3,000-request daily budget was below the proposal's own cadence floor. The corrected budget is 4,500 additional Supabase requests per application instance, with no additional provider polling.
9. Existing jobs often catch fatal errors and return apparent success. Phase 2 must surface fatal job failure to its coordinator without changing successful business behavior.
10. Database schema checks must treat database-below-code as urgent and database-ahead-of-code as informational during migration-first rollout.
11. Restart-rate incidents are unreliable without Railway deployment metadata and are deferred to Guardian.
12. Phase 2 needs explicit role permissions and non-blocking producer hooks so health-table failure cannot break checkout or other business paths.
13. The pre-existing PIF completion update filters only by enrollment UUID, not `location_id`. UUID uniqueness limits practical reach, but this violates the tenant-query invariant and should be corrected with a focused regression before Phase 2 certification.

## Reconciliation

All substantive findings were independently traced to current code and accepted into `COMMAND_CENTER_PHASE_2_THRESHOLDS_AND_RESOURCE_BUDGET.md` version `command-center-health-v1.1`.

No reviewer recommendation authorizes production SQL, deployment, DNS, feature flags, or a merge to `main`.

## Recommended Implementation Sequence

1. Correct the PIF tenant filter and add its focused regression on the isolated branch.
2. Add the staging-only Phase 2 schema: heartbeats, durable job runs, current health, observations, merchant rollups, incidents, and incident events.
3. Add productive-tick worker heartbeats and bounded task observation without changing existing leases.
4. Replace in-process `setInterval` scheduling with database-leased durable windows and latest-window-only catch-up.
5. Add queue and unresolved-operation evaluators, including exhausted attempts.
6. Add incident deduplication, recovery dwell, suppression, and one-level provider dependency handling.
7. Add non-blocking dirty hooks, set-based merchant reconciliation, and rollups.
8. Add platform checks and the Phase 1 permission-registry routes.
9. Add retention, failure injection, seeded load tests, and the 24-hour no-change soak.

Philip approved the corrected numeric contract and recommended owner choices for isolated implementation on 2026-07-23. Production remains separately gated.
