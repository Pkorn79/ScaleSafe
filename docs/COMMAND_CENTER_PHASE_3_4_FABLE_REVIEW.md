# Command Center Phase 3.4 Independent Fable Review

**Date:** 2026-07-31

**Scope:** The uncommitted Phase 3.4 candidates in the ScaleSafe and separate
Guardian feature branches.

**Review boundary:** Fable ran through Claude Code with only `Read`, `Grep`, and
`Glob`. Shell, edits, writes, browser access, databases, external providers,
deployment, session persistence, and production changes were unavailable.

## Independent Verdict

Fable returned **READY FOR EXTERNAL CERTIFICATION** and reported no remaining
P0 or P1 finding. It verified the notification-proof replacement fix and the
recovery failure-code allowlist fix.

The report proposed two P2 latent robustness findings and three P3 findings.
Codex traced each claim through both repositories before accepting it.

## Verified Findings And Disposition

### P2: One malformed alert record could stop unrelated GHL alerts

Verified. Alert handoff and delivery directory scans previously threw on the
first malformed or contract-conflicting record. Guardian then continued sending
the Better Stack heartbeat even though the GHL alert pipeline had stopped.

Remediation prepared locally:

- Invalid handoffs and delivery records move to protected, reason-coded
  quarantine directories.
- A corrupt delivery record also quarantines its source handoff so it cannot be
  silently restaged and sent twice.
- Unrelated valid alerts continue processing.
- Any non-empty quarantine makes the run require attention and withholds the
  Better Stack heartbeat until operator review.
- Quarantine is never cleared automatically.
- Tests cover one invalid plus one valid handoff, a conflicting delivery record,
  continued valid delivery, persistent quarantine state, and heartbeat
  withholding.

### P2: Snapshot metrics allowed 24 fields while run facts allowed 16

Verified. A future valid snapshot with 17 to 24 metrics could have produced a
signed run that ScaleSafe permanently rejected.

Remediation prepared locally:

- Snapshot metrics are capped at 16 in both repositories and the shared JSON
  schema.
- The signed run-facts limit remains 16.
- A shared 17-metric response vector must fail both validators.

### P3: Permanently rejected pending request lacked an operator procedure

Verified as a documentation gap. Guardian intentionally preserves the pending
request and does not advance its sequence. The install guide now defines a
fail-closed procedure that preserves proof, distinguishes explicit pre-mutation
validation rejection from ambiguous responses and `409` conflicts, keeps
`state.json` unchanged, and verifies exact sequence reuse under supervision.

### P3: Stale process-lock cleanup had a bounded race

Verified. Guardian no longer removes a stale internal lock automatically. It
fails closed and requires supervised operator review. Lock release now removes
only a lock that still contains the current process ID. Tests cover stale and
live lock behavior. The systemd service retains its independent `flock`.

### P3: DNS and TLS metrics could exceed migration-owned ranges

Verified. DNS address count and TLS expiry age are now clamped to the catalog
ranges, with injected-dependency tests for both boundaries.

## Disproven Candidates

Fable independently rejected these candidate concerns:

- Shared recovery-failure vectors were stale.
- Crash recovery could blindly resend an uncertain GHL alert.
- Replay or credential rotation could duplicate central domain rows.
- GHL acceptance was mislabeled as outbound notification.
- Guardian rate limiting was not durable.
- Guardian exposed a tenant or PII selector.
- Snapshot retry broke sequence binding.
- Certification mode could reach production ScaleSafe targets.

## External Proof Still Required

These are certification or configuration gates, not established code defects:

- Execute migration 105 and its verifier only in the disposable schema-104
  PostgreSQL environment.
- Prove the SECURITY DEFINER owners operate through forced RLS and that bounded
  retention both deletes an eligible row and preserves protected history.
- Configure and prove Better Stack heartbeat/dead-man behavior.
- Configure the dedicated GHL workflow and independently observe email and SMS.
- Record hashed channel proof and reconcile every terminal transition exactly
  once.
- Keep all recurring timers disabled until the complete certification report is
  accepted by the owner.

## Local Verification After Remediation

- Guardian: 94 of 94 tests passed.
- ScaleSafe focused Guardian contracts: 74 of 74 tests passed.
- ScaleSafe full regression: 1,614 of 1,614 tests passed across 196 suites.
- TypeScript typecheck and the production build passed.
- All shared protocol-v1 files are byte-identical across both repositories.
- Both repositories pass `git diff --check` apart from informational Windows
  line-ending warnings.
- Filename-only credential scans found no live credential; reviewed matches were
  placeholders or test fixtures.
- `npm audit --omit=dev` reports zero ScaleSafe production vulnerabilities after
  the local PostCSS `8.5.25` security override. Guardian has no third-party
  runtime dependencies and no dependency lockfile to audit.

## Independent Follow-Up

After the remediations and local gates, Fable performed a second bounded
read-only review. Its verdict was **CLOSED (code-side)** with no new reachable
P0 or P1 finding. It independently confirmed all five original findings and the
supplementary retention, SECURITY DEFINER, notification-proof, and recovery-code
checks were closed.

The follow-up identified two final P3 hardening points, both remediated before
this record was frozen:

- TLS certificate `not_before_unix` and `not_after_unix` values are clamped to
  the migration-owned nonnegative safe-integer range, with a pre-1970 regression
  test.
- The install guide now states exactly how an operator archives a reviewed
  quarantine item, proves no duplicate alert or transition, and restores the
  schedule without deleting the sole preserved copy.

Guardian remained 94 of 94 after these edits.

Migration 105 remains unapplied. No Phase 3.4 candidate has been installed,
deployed, enabled, merged, or pushed.
