export interface OperatorRunbookStep {
  action: string;
  expected: string;
}

export interface OperatorRunbook {
  key: string;
  title: string;
  owner: string;
  trigger: string;
  summary: string;
  checks: string[];
  procedure: OperatorRunbookStep[];
  escalation: string;
  evidence: string[];
  recovery: string;
  rollback: string;
}

export const OPERATOR_RUNBOOKS: readonly OperatorRunbook[] = Object.freeze([
  {
    key: 'RUNBOOK-API', title: 'Public application unavailable', owner: 'Platform operations',
    trigger: 'Public reachability, deployment, or API health is unhealthy or unknown.',
    summary: 'Establish whether the fault is at Cloudflare, Railway, the application, or Supabase before changing anything.',
    checks: ['Public health endpoint', 'Railway deployment and request logs', 'Supabase project status'],
    procedure: [
      { action: 'Open the public health endpoint from outside Railway.', expected: 'A current 200 response identifies each healthy dependency.' },
      { action: 'Compare the active Railway deployment with the approved release SHA.', expected: 'Exactly one approved release is serving traffic.' },
      { action: 'Inspect Railway request logs and Supabase status for the incident window.', expected: 'The failing boundary and first error timestamp are identified.' },
    ],
    escalation: 'Escalate immediately for sustained checkout failure, cross-tenant symptoms, or an unknown database outcome.',
    evidence: ['Health response and timestamp', 'Active deployment SHA', 'Sanitized request IDs and provider status'],
    recovery: 'Verify two consecutive healthy observations and one read-only merchant login before resolving.',
    rollback: 'Use the approved Railway rollback only when the current release is proven causal and the prior schema remains compatible.',
  },
  {
    key: 'RUNBOOK-DATABASE', title: 'Database health or schema mismatch', owner: 'Platform owner',
    trigger: 'Schema readiness, canary latency, connection pressure, or database availability is nonhealthy.',
    summary: 'Separate schema drift from capacity, connection, and provider availability before remediation.',
    checks: ['Schema version', 'Database canary latency', 'Timeout and connection pressure'],
    procedure: [
      { action: 'Read the deployed code range and database schema version.', expected: 'The database is within the release-supported range.' },
      { action: 'Review canary latency, timeout counts, and Supabase health.', expected: 'A current provider or query boundary is identified.' },
      { action: 'Inspect the exact failing request IDs without running writes.', expected: 'The failure is classified as schema, connection, capacity, or application.' },
    ],
    escalation: 'Escalate any write uncertainty, migration partial failure, or repeated connection termination to the platform owner.',
    evidence: ['Schema version output', 'Canary history', 'Supabase status and sanitized request IDs'],
    recovery: 'Require current schema readiness plus two healthy canaries before resolution.',
    rollback: 'Never reverse a migration casually. Follow the migration-specific rollback or deploy compatible code after owner approval.',
  },
  {
    key: 'RUNBOOK-WORKERS', title: 'Worker or queue delay', owner: 'Platform operations',
    trigger: 'A heartbeat is stale, due work is aging, or retry budget is exhausted.',
    summary: 'Distinguish a quiet queue from a stalled worker and active retries from exhausted work.',
    checks: ['Worker heartbeat', 'Oldest due work', 'Lease and retry state'],
    procedure: [
      { action: 'Identify the exact worker, queue, and last productive heartbeat.', expected: 'The affected worker and delay duration are known.' },
      { action: 'Check oldest due item, lease owner, expiry, and attempts.', expected: 'Work is classified as processing, retrying, stranded, or exhausted.' },
      { action: 'Check correlated Railway logs for one run window.', expected: 'A deterministic failure class is available.' },
    ],
    escalation: 'Escalate exhausted money, evidence, or defense work immediately. Other queues follow their stated service window.',
    evidence: ['Heartbeat row', 'Queue counts and oldest age', 'Lease, attempts, and sanitized log correlation'],
    recovery: 'Confirm the backlog declines and two productive heartbeats complete without duplicate side effects.',
    rollback: 'Disable only the affected new worker flag or return to the prior compatible release after owner approval.',
  },
  {
    key: 'RUNBOOK-MONEY', title: 'Payment outcome needs reconciliation', owner: 'Platform owner',
    trigger: 'A payment, refund, cancellation, billing, or processor outcome is unknown or inconsistent.',
    summary: 'Processor truth must be reconciled with one tenant-bound ScaleSafe record before any retry or finalization.',
    checks: ['Processor outcome', 'Idempotency key', 'Enrollment and tenant binding'],
    procedure: [
      { action: 'Locate the exact tenant, enrollment, request, and processor reference.', expected: 'All identifiers resolve to one merchant and enrollment.' },
      { action: 'Read the processor outcome before changing ScaleSafe state.', expected: 'The external financial outcome is definitive or explicitly unknown.' },
      { action: 'Compare idempotency and webhook history.', expected: 'No duplicate financial action is possible.' },
    ],
    escalation: 'Escalate immediately for wrong amount, duplicate movement, cross-tenant binding, or an unresolved live processor outcome.',
    evidence: ['Processor reference and status', 'ScaleSafe payment event', 'Idempotency and webhook correlation'],
    recovery: 'Resolve only after processor and ScaleSafe state agree and the enrollment ledger is singular.',
    rollback: 'Do not compensate automatically. Use the processor-specific owner-approved procedure for any corrective transaction.',
  },
  {
    key: 'RUNBOOK-WORKFLOW', title: 'GHL workflow delivery issue', owner: 'Platform support',
    trigger: 'A trigger, workflow, email, SMS, pulse, reminder, or provisioning signal is missing or delayed.',
    summary: 'Prove trigger acceptance, workflow execution, and final delivery as separate stages.',
    checks: ['ScaleSafe trigger job', 'GHL workflow execution', 'Communication delivery record'],
    procedure: [
      { action: 'Find the exact ScaleSafe trigger event and tenant.', expected: 'One accepted or retryable event exists for the intended merchant.' },
      { action: 'Inspect the matching GHL workflow execution.', expected: 'The workflow ran, was skipped for a stated reason, or is absent.' },
      { action: 'Inspect the provider delivery result.', expected: 'Acceptance is not mistaken for inbox or handset delivery.' },
    ],
    escalation: 'Escalate duplicate sends, cross-tenant delivery, or a failing critical payment notice immediately.',
    evidence: ['Trigger event ID', 'GHL execution ID', 'Provider delivery status'],
    recovery: 'Confirm one successful delivery or a documented recipient-side rejection, then close the incident.',
    rollback: 'Pause only the affected ScaleSafe workflow or release flag after approval; preserve queued-event history.',
  },
  {
    key: 'RUNBOOK-EVIDENCE', title: 'Evidence or connector issue', owner: 'Platform support',
    trigger: 'Connector health, identity resolution, evidence intake, attachment handling, or quarantine is nonhealthy.',
    summary: 'Keep unresolved events quarantined until tenant and exact enrollment binding are proven.',
    checks: ['Connector health', 'Enrollment match method', 'Quarantine and attachment status'],
    procedure: [
      { action: 'Confirm credential-derived tenant and connection status.', expected: 'The event cannot select its own merchant.' },
      { action: 'Inspect the external identity and enrollment match method.', expected: 'Exactly one defensible enrollment is resolved.' },
      { action: 'Review quarantine, attachment, and replay state.', expected: 'No unresolved event has become production evidence.' },
    ],
    escalation: 'Escalate any cross-tenant possibility, wrong-enrollment evidence, or attachment exposure immediately.',
    evidence: ['Connection ID and tenant', 'Match method and enrollment ID', 'Quarantine or replay record'],
    recovery: 'Confirm one idempotent replay reaches the intended enrollment and appears in its defense source set.',
    rollback: 'Disable the affected connection or provider release flag after approval; do not delete quarantined source records.',
  },
  {
    key: 'RUNBOOK-DEFENSE', title: 'Defense processing issue', owner: 'Platform operations',
    trigger: 'Dispute intake, readiness, packet compilation, export, or processor submission is nonhealthy.',
    summary: 'Keep the packet bound to the disputed transaction and its enrollment while preserving submission truth.',
    checks: ['Dispute transaction', 'Readiness reasons', 'Packet and processor submission state'],
    procedure: [
      { action: 'Verify merchant, disputed transaction, amount, and enrollment.', expected: 'The dispute resolves to one tenant and enrollment.' },
      { action: 'Review readiness reasons and required evidence sources.', expected: 'Missing evidence or fallback state remains visible.' },
      { action: 'Compare packet artifact and processor response.', expected: 'Submitted status exists only after processor acceptance.' },
    ],
    escalation: 'Escalate wrong-client evidence, deadline risk, or submission-state disagreement immediately.',
    evidence: ['Dispute and enrollment IDs', 'Readiness decision', 'Packet hash and processor response'],
    recovery: 'Confirm the final packet opens, matches the disputed enrollment, and has an authoritative submission or export result.',
    rollback: 'Return the packet to review only through the approved defense procedure; never erase submission history.',
  },
  {
    key: 'RUNBOOK-BACKUP', title: 'Encrypted backup needs attention', owner: 'Platform owner',
    trigger: 'Backup status, encrypted object proof, or independent heartbeat is stale, unknown, or unhealthy.',
    summary: 'Verify source completion and off-platform encrypted objects without exposing or altering backup contents.',
    checks: ['Backup status drop', 'Backblaze object proof', 'Backup timer history'],
    procedure: [
      { action: 'Read the latest published backup status and timer history.', expected: 'A completed snapshot or exact failure window is identified.' },
      { action: 'Verify the expected encrypted object set and completion marker.', expected: 'The off-platform snapshot is complete and nonempty.' },
      { action: 'Check the independent heartbeat and prior successful snapshot.', expected: 'Alert delivery and recovery point are known.' },
    ],
    escalation: 'Escalate immediately when no verified recovery point remains inside the approved age window.',
    evidence: ['Snapshot ID', 'Completion marker and encrypted byte count', 'Timer and heartbeat timestamps'],
    recovery: 'Publish current healthy proof and require the next scheduled backup to complete normally.',
    rollback: 'Restore the previous backup script release only after preserving failure artifacts and confirming format compatibility.',
  },
  {
    key: 'RUNBOOK-RESTORE', title: 'Restore proof is stale', owner: 'Platform owner',
    trigger: 'The latest isolated scratch restore proof exceeds its approved age or failed verification.',
    summary: 'Prove database and private Storage restoration in an isolated disposable project.',
    checks: ['Latest encrypted snapshot', 'Scratch project isolation', 'Schema and Storage verification'],
    procedure: [
      { action: 'Create an isolated scratch target with no production integrations.', expected: 'The target cannot send messages, charge cards, or receive live webhooks.' },
      { action: 'Restore the selected encrypted database and Storage snapshot.', expected: 'Restore tooling completes without modifying production.' },
      { action: 'Verify schema version, record counts, and object counts.', expected: 'The restored snapshot matches its manifest.' },
    ],
    escalation: 'Escalate any decryption failure, missing object, schema mismatch, or possible production target immediately.',
    evidence: ['Snapshot and scratch project IDs', 'Schema and count verification', 'Signed completion proof'],
    recovery: 'Publish the verified restore proof and delete the isolated target only after evidence is retained.',
    rollback: 'Abort before writes when isolation is uncertain. Never point restore tooling at production.',
  },
  {
    key: 'RUNBOOK-SECURITY', title: 'Security posture alert', owner: 'Platform owner',
    trigger: 'Authentication, tenant isolation, credential, dangerous-flag, or access-denial monitoring is nonhealthy.',
    summary: 'Preserve evidence and confirm the affected boundary before containment or credential changes.',
    checks: ['Dangerous flags', 'Authentication and access denials', 'Credential boundary'],
    procedure: [
      { action: 'Identify the exact alert, actor boundary, tenant scope, and first occurrence.', expected: 'The possible exposure is bounded without mutation.' },
      { action: 'Preserve relevant audit, request, deployment, and provider evidence.', expected: 'Investigation data remains available and credentials remain redacted.' },
      { action: 'Test the suspected path read-only or in isolation.', expected: 'The alert is confirmed, disproven, or remains explicitly unknown.' },
    ],
    escalation: 'Escalate suspected auth bypass, secret exposure, or cross-tenant access immediately and stop routine rollout.',
    evidence: ['Incident and audit IDs', 'Affected release SHA', 'Sanitized access and provider records'],
    recovery: 'Require a verified fix, regression proof, credential action if needed, and clean monitoring window before resolution.',
    rollback: 'Use the approved containment or rollback plan only after owner authorization unless active harm requires the documented emergency path.',
  },
]);
