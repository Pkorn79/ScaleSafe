# Phase 3.4 External Certification Runbook

**Status:** Prepared only. No step in this document is currently authorized.

**Purpose:** Certify Better Stack, GHL notification truth, signed alert
reconciliation, and the no-action boundary without touching production data or
enabling recurring Guardian execution.

## Stop boundaries

Do not:

- Apply migration 105 to production.
- Deploy ScaleSafe or push/merge `main`.
- Enable `GUARDIAN_INGESTION_ENABLED` in Railway.
- Enable or start a recurring Guardian/OpenClaw timer.
- Send merchant, client, payment, dispute, evidence, or tenant data to an alert
  provider.
- Treat GHL app-event acceptance as outbound notification proof.
- Execute a repair or high-risk action.

## 1. Freeze the candidate

Record both feature-branch SHAs, migration 105 SHA-256, shared protocol hashes,
and clean test results. Confirm both repositories contain byte-identical protocol
README, alert schema, and test vectors.

Gate: Guardian tests, ScaleSafe focused/full tests, typecheck, build, syntax
checks, and `git diff --check` all pass.

## 2. Certify migration 105 in a disposable database

Use a loopback-only Supabase workspace restored to schema 104. Apply migration
105 only there. Run `supabase/security/verify_migration_105.sql` inside a caller-
owned transaction and roll it back. Then run the shared Guardian database-vector
verifier.

Prove:

- Invalid, forged, replayed, stale, gapped, oversized, and unauthorized requests
  fail closed.
- Alert delivery accepts only exact sanitized terminal transitions.
- Logical duplicates advance the sequence without duplicating a delivery row.
- Changed content under the same delivery ID conflicts.
- Browser roles cannot read Guardian tables.
- History rows cannot be updated or deleted outside the bounded retention RPC.
- Both SECURITY DEFINER functions are owned by a role that can operate through
  forced RLS in the disposable environment.
- The retention RPC actually deletes one eligible old receipt while preserving
  an old original that still has a younger logical duplicate.
- Schema version is 105 in the disposable workspace only.

Destroy or reset the disposable workspace after preserving machine-readable
proof.

## 3. Create Better Stack free checks

Create:

- One public HTTPS monitor for ScaleSafe reachability.
- One Guardian heartbeat/dead-man monitor.

Use no Better Stack API token in Guardian. Store only the send-only heartbeat URL
in the root-owned Guardian configuration. Keep notification contacts limited to
the owner-approved destination.

Prove one successful heartbeat, one intentionally missed heartbeat, external
incident creation, owner acknowledgement, and recovery. The heartbeat proves
Guardian process and alert-pipeline liveness, not ScaleSafe ingestion success.
Guardian must withhold it while alert quarantine or another alert-delivery error
needs attention. Pause the certification heartbeat afterward so it cannot create
recurring test alerts.

## 4. Create the dedicated GHL operational workflow

Use one dedicated inbound webhook. It receives exactly:

- `schema_version`
- `alert_id`
- `incident_id`
- `event_type`
- `check_key`
- `severity`
- `state`
- `occurred_at`
- `summary_code`
- `summary`
- `runbook_id`

Workflow behavior:

- Send one internal email for every routed warning, urgent, or critical incident.
- Send one internal SMS only when severity is `urgent` or `critical`.
- Use fixed owner destinations, not the triggering merchant or client.
- Do not add a wait step.
- End immediately after notification actions.
- Allow repeated independent incidents without leaving a contact trapped in the
  workflow.

The workflow URL is a secret and remains only in Guardian's root-owned
configuration. The workflow does not authorize or execute repairs.

## 5. Run one-shot isolated-provider certification

Run Guardian directly once with:

- `GUARDIAN_MODE=certification`
- Loopback-only ScaleSafe and Supabase targets.
- The provider-owned Better Stack HTTPS heartbeat URL.
- The provider-owned GHL HTTPS workflow URL.
- Alerting enabled only for the approved test window.
- Every Guardian/OpenClaw timer disabled.

Create two sanitized test incidents using real allowlisted check keys:

1. Warning: use `platform.workers.aggregate`; expect GHL acceptance and one
   email; expect no SMS.
2. Critical: expect GHL acceptance, one email, and one SMS.

Do not use `certification.synthetic`; that check is deliberately excluded from
owner alert routing.

## 6. Record notification proof

For each observed message, use the operator proof recorder with only event ID,
channel, provider reference, and observed timestamp. Confirm raw provider
references and message content do not appear in Guardian state or logs.

Prove:

- GHL `2xx` creates only an `accepted` transition.
- Warning becomes `notified` only after email proof.
- Critical becomes `notified` only after both email and SMS proof.
- Exact proof replay is idempotent.
- Conflicting proof replacement is rejected.
- GHL timeout becomes acceptance-unknown and is not blindly retried.

## 7. Reconcile and verify

Run the isolated Guardian once more against the loopback ScaleSafe receiver.
Confirm every immutable transition reconciles exactly once through the signed
sequence outbox. Compare Guardian local transition IDs with disposable database
rows and ingestion receipts.

Prove that no payload or stored row contains merchant, tenant, contact, payment,
dispute, evidence, message content, address, phone number, or raw provider ID.

## 8. Prove action denial

Prove:

- Deterministic Guardian checks are read-only.
- OpenClaw can only summarize the sanitized handoff and has no execution tools.
- A structurally valid approval reference still cannot run a repair because no
  repair executor exists.
- Deploy, rollback, SQL, restore, secret, delete, money, subscription,
  entitlement, and identity actions remain unavailable.

The current approval-reference format is an inert policy contract, not an owner-
authentication mechanism. A future repair executor requires a separately
certified operator approval control plane.

## 9. Close the window

Disable alerting in the certification configuration. Confirm every Guardian,
OpenClaw, and B2 verifier timer remains disabled. Pause test-only provider checks,
preserve proof, remove temporary state, and stop the disposable ScaleSafe/Supabase
workspace.

Phase 3.4 passes only after every gate above is evidenced. Passing does not
authorize migration 105 in production, Railway deployment, recurring timers,
`main` merge/push, Phase 3.5, or Phase 3.6.
