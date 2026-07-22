# ScaleSafe Command Center And Guardian Architecture Plan

**Status:** Independently reviewed architecture; recommended Phase 1 defaults approved by Philip on 2026-07-22
**Implementation status:** Phase 1 implemented on isolated branch; isolated staging certification still required
**Repository baseline:** `008b3bf68eaaa7f2dc825399b05acba70c1fba66` on `codex/beta-remediation`
**Production reference at planning start:** `origin/main` at `67d9ea3f40d8882b0bbcd32163f0736261257597`
**Database schema:** Production remains version 102; migration 103 is drafted and unapplied
**Last updated:** 2026-07-22

## 1. Purpose

Build one secure ScaleSafe operations system that lets the platform owner:

- See whether ScaleSafe and every merchant installation are healthy.
- Detect failures before merchants report them.
- Receive useful alerts without alert fatigue.
- Investigate incidents using trustworthy, sanitized diagnostics.
- Perform a small set of explicitly approved repair actions.
- Assign merchant accounts to reseller organizations.
- Give each reseller a restricted view of only its assigned accounts.
- Prove backups, restoration readiness, worker health, payment integrity, workflow delivery, evidence capture, and defense processing.

The system has two cooperating parts:

1. **ScaleSafe Command Center:** the authenticated platform and reseller operations application.
2. **ScaleSafe Guardian:** the independent, deterministic monitoring process on the always-on VPS.

This is operational infrastructure. It is not a merchant feature, a general AI assistant, or a replacement for processor, GHL, Railway, Supabase, and backup-provider controls.

## 2. Authority And Change Control

This document becomes authoritative only after:

1. Current code, migrations, deployed configuration, and recovery proof are reconciled.
2. The ten-lane independent Fable review is completed.
3. Every accepted Fable finding is verified against current code or explicitly marked as a future design requirement.
4. Philip approves the final architecture and unresolved product decisions.

Until then:

- No database migration is applied.
- No production route, authentication mechanism, or environment variable is changed.
- No production deployment is made.
- No current HQ capability is removed.
- No reseller receives access.
- No Guardian process receives mutation access to production data.

Each implementation phase has a completion gate. Work does not advance merely because code compiles or tests pass.

## 3. Non-Negotiable Design Rules

1. **One operations platform, role-filtered views, isolated browser origin.** HQ and reseller capabilities share one codebase, authorization system, and backend. The privileged operator SPA is served from a dedicated hostname such as `ops.scalesafe.app`, with a host-only operator cookie, so public checkout or merchant-surface code cannot ride an operator session.
2. **Trusted tenant derivation.** The server derives every permitted `location_id` from the authenticated operator's organization, role, assignment, and support grants. A browser-supplied location ID can narrow access but can never expand it.
3. **Fail closed.** Missing identity, assignment, permission, health data, or provider certainty produces no access and no optimistic health claim.
4. **Independent outage detection.** The Guardian remains able to report a ScaleSafe or Supabase outage when the application database cannot.
5. **Deterministic truth first.** Scripts, database state, signed observations, provider responses, hashes, and timestamps determine health. AI may summarize them but cannot create health truth.
6. **Read-only first.** The Command Center and reseller view launch read-only. Repair actions are introduced only after identity, authorization, audit, incidents, and idempotency are certified.
7. **No unrestricted impersonation.** Support access is explicit, scoped, time-limited, reasoned, and audited. The initial release has no merchant impersonation.
8. **No secret or raw-payment exposure.** The console never displays processor keys, OAuth tokens, Supabase keys, bank data, card data, stored webhook secrets, or permanent private-file URLs. A newly generated connector credential may be displayed once to an authorized platform operator, must not be retrievable afterward, and is never shown to a reseller.
9. **No per-merchant polling storm.** Global checks are batched. Merchant health uses event-driven updates, rollups, adaptive checks, and paginated aggregate queries.
10. **No silent repairs.** Every operator action states what it will do, what it will not do, its tenant, risk, idempotency boundary, and authoritative result.
11. **Marketplace review safety.** Development remains isolated from the submitted production application until owner-approved deployment.
12. **Evidence and money remain enrollment-scoped.** Operational tooling cannot weaken current payment, evidence, defense, or tenant boundaries.
13. **Authorization truth is live.** Session validity, user and membership status, reseller assignments, and support grants are resolved from current authoritative state for every request. A time-to-live cache is never an authorization boundary.
14. **Audit precedes privileged mutation.** A durable audit-intent write is required before a controlled mutation executes. If that write fails, the mutation does not run.

## 4. Current-State Map

### 4.1 Merchant Identity And Tenant Authority

- Merchant users enter ScaleSafe through GHL OAuth and SSO.
- `location_id` is the merchant tenant boundary.
- The merchant application derives location context from trusted GHL installation and session data.
- Merchant-facing database access is performed by the ScaleSafe backend with the Supabase service role; browser code does not receive the service key.
- The database was locked down in migration 046, given schema-wide forced RLS, grant revocation, and restrictive default privileges in migration 059, and reinforced for drifted newer tables in migration 098. New operator tables follow the stricter migration 102 pattern.

This merchant SSO model is not suitable as the sole identity system for ScaleSafe staff and resellers because platform operators may need to work across multiple assigned locations and independently of a merchant's GHL session.

### 4.2 Existing ScaleSafe HQ Foundation

`src/routes/hq-admin.routes.ts` currently provides a single internal page and API protected by one static `SCALESAFE_HQ_ADMIN_TOKEN`. A second privileged surface exists under `/api/debug/*`, protected by `DEBUG_ADMIN_TOKEN` or `ADMIN_DEBUG_TOKEN`; some of those routes mutate GHL contacts or Storage and currently have no operator attribution audit.

Existing capabilities include:

- List active merchants.
- View merchant installation and processor summary.
- Count active enrollments, recent payments, billing setup issues, trigger issues, and active trigger subscriptions.
- View unresolved money operations, refund claims, and defense submissions.
- Resolve limited ambiguous provider outcomes.
- Approve or revoke WholePay eligibility.
- Configure, test, activate, disable, rotate, and replay evidence connections.
- Control provider-catalog release state for evidence integrations.
- Write best-effort records to `hq_admin_audit_logs`.

Current limitations:

- One shared token is not a user identity.
- A caller-provided `x-scalesafe-admin-label` is not authoritative attribution.
- There is no MFA, invitation lifecycle, session revocation, organization membership, or role-based authorization.
- There are no reseller organizations or merchant assignments.
- There is no denied-access audit trail.
- Audit failure currently does not stop a privileged action.
- The merchant-list implementation performs multiple queries for every merchant. That fan-out cannot scale to hundreds or thousands of merchants.
- The UI is an embedded HTML string and is not an adequate long-term operator application.
- Existing mutation routes must not be exposed to resellers merely by hiding buttons.
- Both static-token surfaces must be inventoried and retired or moved behind the certified break-glass design before the platform Command Center is considered published.

The current HQ is a useful source of services and diagnostics, not the final access-control or user-interface architecture.

### 4.3 Current Application Health And Jobs

Current `/health` proves:

- The Express process responds.
- A simple Supabase query succeeds.
- The database reports at least hardcoded schema version 99. The repository and live database are at version 102, so this is not proof that a release's newest schema dependency is present.

Railway uses `/health` as its deploy health check.

Current scheduled jobs:

- Daily Stripe and NMI processor health/chargeback-ratio checks, including existing merchant-facing GHL warning and critical triggers.
- Hourly payment reminders.
- Hourly pulse cadence.
- Daily paid-in-full completion.
- Five-minute provisioning recovery.

The daily/hourly schedules are currently boot-relative in-process timers. Repeated deployments can postpone or starve a nominal daily run, and the timers have no durable single-run key.

Current database-leased workers:

- External evidence processing.
- Defense compilation and accepted-submission reconciliation.
- Money/refund reconciliation.
- Durable GHL trigger field-sync delivery.

Current gaps:

- `/health` does not prove worker freshness, queue age, Storage access, GHL reachability, processor reachability, webhook intake, or customer-facing workflow delivery.
- In-process `setInterval` jobs do not expose durable run history or missed-run detection.
- Workers log failures but do not publish a unified heartbeat, backlog, oldest-item age, or incident.
- There is no common health-check catalog or incident lifecycle.
- There is no independent uptime alert when Railway or Supabase is unavailable.
- There is no centralized owner alert channel.

### 4.4 Current Reliability Assets

ScaleSafe already has important operational safety primitives:

- Durable money operations and reconciliation claims from migration 098.
- Durable trigger delivery jobs from migration 099.
- Database leases for multi-instance workers.
- Refund claims and idempotency boundaries.
- Schema-readiness blocking at application startup.
- Structured Pino logging with common secret/PII redaction.
- Merchant provisioning recovery claims.
- Connector health and quarantined external evidence events.
- `needs_review` defense safety state.
- Marketplace entitlement events and WholePay approval control.
- `AdaptivePoller` with non-overlapping adaptive worker cadence.

Current limits that the new design must not inherit blindly:

- `AdaptivePoller` has no task timeout, so a hung provider/database call can stop a worker without ending the process.
- Current request limits are in-memory and per Railway instance.
- Log redaction is useful but shallow; Command Center diagnostics must use typed allowlists rather than depend on recursive redaction.

The Command Center should observe and control these existing primitives rather than building duplicate retry systems.

### 4.5 Current Recovery Foundation

The recovery launch blocker is closed:

- Supabase Pro daily database backup is owner-attested as enabled; its continuing status must be re-attested or observed through an approved provider signal.
- A daily encrypted logical database and private Storage backup runs on the VPS.
- Encrypted archives are retained in a separate Backblaze B2 account.
- Backup age is machine-readable through `verify-latest.sh`.
- Snapshot `20260721T175646Z` passed a real isolated scratch restore at schema version 102.
- The production backup timer is enabled.

Guardian must consume this existing proof. It must not replace the backup engine, receive the offline `age` private identity, restore production, or delete backups.

### 4.6 Missing Foundation

The following do not currently exist as production-grade platform capabilities:

- Individual ScaleSafe operator identities.
- Mandatory MFA for privileged operations.
- Platform and reseller organizations.
- Merchant-to-reseller assignments.
- Expiring support grants.
- Server-enforced role and permission policies.
- Health observations and current-health rollups.
- Worker and scheduled-job heartbeats.
- Durable incidents, acknowledgements, escalations, and resolutions.
- Independent alert delivery and alert-delivery proof.
- Guardian authentication and signed observation ingestion.
- A scalable read model for merchant health.
- Reseller-safe aggregate metrics.
- Approved-action requests with idempotency and risk gates.
- A production-ready Command Center SPA.

## 5. Operating Model

### 5.1 Organization Types

#### Platform Organization

The single ScaleSafe/WholePay organization. Its authorized users may receive platform-wide roles.

#### Reseller Organization

A reseller business with one or more authenticated staff members. A reseller receives access only to merchants with an active assignment to that reseller.

Merchant users remain authenticated through GHL and are not made members of operator organizations.

### 5.2 Roles

| Role | Visibility | Initial mutation authority |
| --- | --- | --- |
| `platform_owner` | All platform, reseller, merchant, incident, audit, and recovery summaries | Identity administration, assignments, approvals, and later explicitly enabled high-risk actions |
| `platform_ops` | All operational and merchant health data | Approved low-risk actions; no owner identity or break-glass administration |
| `platform_support` | Merchant operational data required for support | Read-only initially; later scoped low-risk actions under an active support reason |
| `security_auditor` | Security, incidents, audit, deployment, backup, and sanitized platform health | None |
| `reseller_owner` | Assigned merchant accounts and reseller staff | Reseller staff administration and assignment requests; no platform or payment mutation |
| `reseller_operator` | Assigned merchant summaries and permitted support details | None initially |
| `reseller_viewer` | Assigned merchant aggregate health and commercial summaries | None |

Roles are memberships in organizations. They are not browser flags, GHL fields, or headers.

### 5.3 Reseller Assignment Rules

- A merchant may have zero or one active **primary reseller**.
- A reseller organization can have many merchants.
- The stable assignment authorization key is the merchant's trusted GHL `location_id`; an optional merchant-row UUID may be retained as a reference but is not the authorization currency.
- Transfers preserve assignment history and take effect atomically through one database function with a partial unique constraint enforcing one active primary reseller.
- Removing or transferring an assignment removes the old reseller's access immediately.
- Uninstalling ScaleSafe does not delete assignment history. An uninstalled merchant remains visible to its platform owner and assigned reseller as inactive until deliberately unassigned.
- Cross-reseller grants do not exist in v1. A second hidden primary assignment is never used.
- Platform users do not need reseller assignments.
- Browser payloads cannot create an assignment without an authorized platform decision.

### 5.4 Default Reseller Visibility

The initial reseller view includes:

- Merchant business name and installation status.
- Marketplace plan and WholePay eligibility state when commercially relevant.
- Processor connection status, never credentials.
- Aggregate enrollment, payment-state, workflow, evidence, defense, and connection health. Payment dollar totals are excluded initially.
- Open operational issues and setup steps the reseller is permitted to communicate.
- Sanitized recent activity and incident status.

It excludes by default:

- Raw client lists, emails, phone numbers, messages, signed packets, and evidence files.
- Card, bank, processor, OAuth, webhook, API, and Supabase credentials.
- Platform-wide revenue, other reseller accounts, or unassigned merchants.
- Raw provider payloads and internal stack traces.
- Refund, charge, cancellation, subscription, deployment, secret, and database controls.

Reseller responses are assembled from strict allowlisted read models and DTO mappers. Raw activity rows, incident errors, free-text provider messages, and generic internal metadata are never filtered into a reseller response after the fact because those fields can contain client PII.

Any later client-level reseller access requires a separate owner-approved product decision and a new privacy/access review.

### 5.5 Support Grants

An expiring support grant may provide a specific **platform** support user with additional access to one merchant. Reseller users and reseller organizations cannot receive support grants in v1.

Each grant requires:

- Merchant/location.
- Scope.
- Reason.
- Requester and approver.
- Start and expiration time.
- Revocation state.
- Audit trail.

The requester cannot approve the same grant. A grant is resolved from current database state on every request and stops authorizing access immediately at expiration or revocation.

The initial Command Center does not impersonate the merchant. It shows operator-safe diagnostics assembled by backend services.

## 6. Authentication And Authorization Architecture

### 6.1 Authentication

Use a dedicated operator authentication flow backed by Supabase Auth, subject to verification against current official Supabase guidance before implementation. Supabase Auth is a server-side credential and MFA backend only; the browser receives no Supabase access or refresh token.

Required properties:

- Invite-only operator accounts.
- Verified email.
- Mandatory second factor for platform roles and all mutation-capable reseller roles.
- Short idle timeout and bounded absolute session duration.
- Immediate session revocation when a user or membership is disabled.
- Server-managed, secure, HTTP-only session cookie.
- The operator SPA and API use a dedicated hostname such as `ops.scalesafe.app` on the same backend/codebase.
- A `__Host-` prefixed, host-only cookie with `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`, explicit CSRF protection for mutations, and no tokens in URL query strings.
- A strict Content Security Policy for the operator application.
- Separate operator login route from merchant GHL SSO.
- Exact trusted-proxy configuration for Railway before audited client IP or IP throttling is relied upon.
- Per-account and per-invite throttling in addition to per-IP throttling.
- Single-use invitations bound to the exact email and constrained so an inviter cannot grant a role outside the inviter's organization or above the inviter's authority.
- Owner-approved or step-up-gated MFA recovery; no unaudited self-service factor reset.

Do not reuse GHL SSO as platform identity and do not expose the Supabase service role to the browser.

### 6.2 Authorization Context

Every operator API request resolves an immutable server-side context:

```text
operator_user_id
session_id
organization_id
organization_type
role
permission_set
allowed_location_ids
active_support_grants
authentication_assurance
```

Authorization flow:

1. Verify the opaque operator session.
2. Verify the user and organization memberships remain active.
3. Resolve the named route permission and its required authentication assurance level.
4. Require that assurance level.
5. Resolve allowed merchant assignments and active support grants from current database state.
6. Intersect any requested location with that allowed set.
7. Evaluate the permission against the active organization and role.
8. On any denial or dependency error, fail closed and write an attributable denial event before returning.
9. For a sensitive read, write its access event. For a mutation, durably write an audit-intent record; if that write fails, stop.
10. Execute only after authorization and required audit succeed, then append the authoritative result.

The caller cannot supply `role`, `organization_id`, `allowed_location_ids`, or an authoritative admin label.

Operator middleware ignores GHL SSO and merchant tenant context. Merchant middleware ignores operator cookies. A request carrying both credential types is handled by the route's one declared identity plane and cannot combine their authority.

### 6.3 Break-Glass Access

The current HQ token and the debug tokens are retired from normal use at the end of Phase 4 after the new identity system passes live certification.

One optional break-glass path may remain with these constraints:

- Disabled by default.
- Separate credential from normal operator sessions.
- Platform-owner-only documented activation.
- Short activation window.
- Independent owner alert when activated or used.
- Read-only unless a separately approved incident runbook authorizes one action.
- Credential rotated after use.

The break-glass credential is distinct from `SCALESAFE_HQ_ADMIN_TOKEN`, `DEBUG_ADMIN_TOKEN`, and `ADMIN_DEBUG_TOKEN`. Before cutover, every human and non-human consumer of those legacy credentials is inventoried and migrated; code search proves no route still honors them; the values are rotated/unset; their disabled paths return `404`; and attempts to use them are denied and audited. The legacy tokens must not silently remain as permanent administrator accounts.

## 7. Health Model

### 7.1 Health States

Every check reports one state:

- `healthy`
- `degraded`
- `unhealthy`
- `unknown`
- `not_applicable`

`unknown` is not rendered as healthy.

### 7.2 Incident Severity

| Severity | Meaning | Example |
| --- | --- | --- |
| `critical` | Immediate security, tenant, wrong-money, destructive-data, or broad outage risk | Cross-tenant access, duplicate charge, database unavailable, confirmed secret leak |
| `urgent` | Core beta path broken or silently losing durable state | Worker stopped, payment reconciliation backlog past SLA, required webhook failing |
| `warning` | Important merchant-specific degradation with a workaround | Expired GHL token, missing workflow subscription, unhealthy evidence connector |
| `info` | Operational change or observation requiring no immediate response | Deploy completed, restore drill due soon, merchant configuration changed |

Health state and incident severity are separate. A check can be degraded without creating a new incident until its duration or threshold is reached.

Every check key has an owner-approved numeric contract before activation: cadence, timeout, stale-after window, consecutive-failure threshold, recovery dwell, severity, provider/request budget, and whether it bypasses debounce or suppression. Thresholds are versioned configuration, not prose hidden in code.

### 7.3 Global Check Catalog

#### Application

- Public endpoint reachability and TLS validity.
- `/health` status and latency.
- Deployed Git SHA and expected schema version.
- Unexpected `4xx`, `5xx`, latency, and process-restart rates.
- Current production environment and dangerous-flag posture without exposing values.

#### Supabase

- Database canary query and latency.
- Schema version.
- connection/resource pressure indicators available through approved APIs.
- Storage canary read for a dedicated non-sensitive object.
- Oldest pending lease and queue depth.
- Recent database timeout and availability events.

#### Workers And Jobs

- Last **completed tick** heartbeat for every worker type. Ephemeral Railway instance IDs are diagnostic context, not separate alert subjects.
- Last successful job run.
- Last failed run and sanitized error class.
- Claimed, pending, retrying, unknown, and oldest-item age.
- Lease expiration and abandoned-claim count.
- Throughput and retry trend.
- Task timeout and hung-tick detection.

#### Deployment And Source Control

- Latest Railway deployment status and Git SHA only if a verified read-only/tokenless source is available.
- Last known-good deployment.
- Latest CI state.
- Source-control and dependency posture in a digest when read-only API access permits.
- Dependency and secret-scan findings.

#### Recovery

- Latest completed encrypted snapshot and age.
- Backup service/timer result.
- Snapshot schema version and Storage object count.
- Backup destination reachability.
- Last sample verification.
- Last full scratch restore drill.
- Local staging-disk capacity threshold.

#### Security

- Required secrets present without reading their values into reports.
- Dangerous compatibility flags absent.
- Operator authentication anomalies and repeated denials.
- Guardian credential age and last rotation.
- Webhook signature failure trend.
- Unexpected access to disabled routes.

### 7.4 Merchant Check Catalog

#### Installation And Entitlement

- Merchant record and active installation.
- Marketplace plan and billing state.
- WholePay approval state when required.
- Snapshot/provisioning status.
- GHL token validity and refresh health.

#### Processors And Money

- Configured processors and connection state.
- Webhook/callback readiness.
- Recent successful payment and refund reconciliation.
- Unknown/provider-accepted money operations.
- Refund and defense submission claims awaiting reconciliation.
- Recurring billing setup failures and stale next-billing state.

Provider APIs are not polled for every merchant on every Guardian cycle. Stored operational state is checked continuously; provider canaries and reconciliation checks run on a controlled cadence.

A database-leased, set-based job inside the ScaleSafe application reconciles merchant health because it already holds the merchant/provider context. Guardian observes that job's freshness and aggregate result; Guardian never receives merchant processor credentials or performs per-merchant provider polling.

#### GHL Workflows

- Required active subscriptions.
- Recent trigger delivery failures and no-subscription outcomes.
- Durable field-sync backlog.
- App-event delivery proof separated from GHL workflow execution and outbound communication proof.
- Payment reminder and pulse readiness.

#### Evidence And Defense

- Evidence connection health.
- Quarantined/retrying external events and oldest age.
- Enrollment-link integrity failures.
- Defense compilation backlog and failure state.
- Packets in `needs_review`, failed, or unresolved submission state.
- Missing private files or failed attachment validation.

#### Merchant Activity

- Recent successful checkout and enrollment signals.
- Last processor event.
- Last evidence event.
- Last GHL trigger delivery.
- Health data freshness.

Low merchant activity is not itself an incident. Staleness thresholds depend on whether the merchant is active and whether a workflow is expected to run.

### 7.5 Health Rollups

Do not build the overview by issuing many queries per merchant.

Maintain one current rollup row per merchant containing:

- Overall health state.
- Highest open incident severity.
- Last observed time.
- Processor, workflow, evidence, defense, installation, and billing component states.
- Sanitized counts needed by list screens.
- Version used to calculate the rollup.

Update rollups when events change and through a bounded, database-leased, set-based reconciliation job. Dashboard requests read paginated rollups in one query plus separately aggregated platform totals. A denormalized reseller organization field may accelerate filtering but is display/filter data only; every reseller request still intersects the result with live server-derived assignments.

## 8. Incident And Alert Lifecycle

### 8.1 Incident States

- `open`
- `acknowledged`
- `mitigating`
- `resolved`
- `suppressed`

Every transition is retained. Resolving an incident does not delete its history.

### 8.2 Deduplication

Each incident has a stable deduplication key derived from:

```text
scope_type + scope_id + check_key + failure_class
```

Repeated observations update `last_seen_at`, occurrence count, and evidence. They do not create duplicate alerts or incident rows.

The database enforces one open incident for a deduplication key through an appropriate partial unique index and atomic upsert. A resolved incident may reopen within its configured recurrence window. Provider-wide outages use one parent incident with linked suppressed child observations; v1 supports only this single-level dependency model, not a generic dependency graph.

### 8.3 Noise Controls

- Debounce transient single failures where money or security is not at risk.
- Open immediately for wrong-money, tenant, security, and broad outage findings.
- Apply escalation thresholds based on duration and oldest-item age.
- Use notification cooldowns while keeping occurrence counts current.
- Send a recovery notification when a critical or urgent incident resolves.
- Require a reason and expiration for suppression.
- Never suppress wrong-money, cross-tenant, or confirmed credential-compromise incidents through ordinary UI controls.
- Guardian dead-man failure, alert-channel failure, and critical security incidents bypass ordinary debounce.
- Existing merchant-facing GHL health triggers are referenced in incident context rather than duplicated as a second merchant communication path.

### 8.4 Alert Routing

Initial routing:

- `critical`: immediate independent SMS/push plus email, repeated until acknowledged according to an owner-approved policy.
- `urgent`: immediate email/push, escalation if unacknowledged.
- `warning`: Command Center plus scheduled digest unless duration escalates.
- `info`: audit/activity feed and daily digest.

The first external alert provider must be independent of GHL, Railway, and Supabase so an outage in those systems cannot silence the alert. It must support an acknowledgement path that does not depend on the ScaleSafe database, a dead-man check, and narrowly scoped send-only credentials where the provider allows them. Provider selection is an explicit implementation gate.

Every alert delivery records provider reference, attempt, status, and sanitized error. Guardian also maintains minimal local delivery/acknowledgement state while the application database is unavailable and reconciles it after recovery. An incident is not considered owner-notified merely because an alert request was queued.

## 9. Guardian Architecture

### 9.1 Location And Trust Boundary

Guardian runs as a dedicated least-privilege service account on the existing always-on VPS.

It does not run inside:

- Railway production.
- A merchant GHL account.
- Hermes or OpenClaw reasoning state.
- The backup script itself.

The security promise applies to compromise of the Guardian service account, not compromise of VPS root. The same VPS currently holds a write-capable production database URL and Storage backup credentials for the backup engine, so root compromise can mutate production even if Guardian is correctly isolated. For controlled beta, this is an explicitly accepted residual risk only if Guardian cannot read `backup.env`, cannot join the Docker group, has no `sudo`, and receives only a sanitized backup-status drop file. A separate low-cost monitoring host is the recommended boundary before broader reseller/general availability.

### 9.2 Deterministic Components

Guardian consists of:

1. Versioned check definitions and scripts.
2. A scheduler with overlap prevention and bounded timeouts.
3. An Ed25519-signed observation client with monotonic sequence replay protection.
4. Local machine-readable run output.
5. An independent alert adapter for failures that prevent Command Center ingestion.

Hermes/OpenClaw may read the JSON output and produce a human summary. It does not determine PASS/FAIL, change thresholds, execute repairs, or receive production mutation credentials.

### 9.3 Credentials

Guardian receives only credentials required for its checks:

- A dedicated Guardian ingestion credential.
- Read-only provider tokens where provider APIs support them.
- Read access to a sanitized backup-status drop file written by the backup service, not `backup.env`, rclone credentials, the production database URL, Storage keys, or the offline decryption identity.
- No Stripe/NMI/Whop charge or refund credentials.
- No general Supabase service-role key if a narrow signed monitoring API can supply the required data.
- No Railway deploy token.
- No GitHub write token.

Guardian observations are signed with an Ed25519 private key held by Guardian; ScaleSafe stores only the public verification key. Each credential has a monotonic sequence and explicit rotation state. Compromise of the Guardian service account must not grant merchant-data mutation, payment, deploy, restore, backup deletion, identity administration, or authorization authority.

### 9.4 Cadence

Initial target cadence:

- Global uptime and API health: every 1-5 minutes.
- Worker/queue and database health: every 5 minutes.
- In-app batched merchant health reconciliation freshness: observed every 15 minutes, adaptive to active incidents.
- Backup verification: after the scheduled backup and at least daily.
- CI, deploy, branch, dependency, and secret posture: daily and after deploy when events are available.
- Decryption-free encrypted-object size/hash sampling: weekly, if the backup format exposes enough safe metadata.
- Human-run full isolated restore drill: monthly; Guardian verifies that a signed/recorded drill result is recent but cannot perform the restore.

Cadences must be load-tested before production enablement. The system backs off during provider or database pressure and never launches one provider request per merchant in a tight loop.

### 9.5 Independent Failure Reporting

If the Command Center ingestion endpoint is unavailable:

1. Guardian writes the failed run locally.
2. Guardian sends the critical/urgent alert through the independent provider.
3. Guardian retries ingestion with bounded exponential backoff.
4. The eventual ingestion preserves the original observation time.

Guardian's check-key catalog is allowlisted. Ingestion rejects unknown check keys, merchant-scoped claims Guardian is not permitted to assert, stale/out-of-order sequences, oversized payloads, and source-precedence violations. Guardian data cannot create identities, organizations, assignments, grants, permissions, or operator sessions.

## 10. Command Center Information Architecture

Build a dedicated operator SPA on the isolated operator hostname, separate from merchant navigation, public checkout, and GHL iframe context. It may share the same deployment and backend process, but not the merchant/public browser origin or operator cookie scope.

### 10.1 Platform Overview

- Current platform status and freshness.
- Open incidents by severity.
- Merchant health counts.
- Worker and queue status.
- Payment/reconciliation risk.
- Workflow delivery risk.
- Evidence/defense processing risk.
- Backup and restore status.
- Latest deploy and CI.

### 10.2 Merchants

- Paginated and searchable merchant health list.
- Filters for reseller, plan, processor, installation, incident severity, and component health.
- Merchant detail showing sanitized installation, processor, workflows, payments, evidence, defenses, connectors, and incident history.
- No secrets or raw card/bank data.

### 10.3 Incidents

- Open, acknowledged, mitigating, resolved, and suppressed views.
- Timeline of observations, alerts, operator notes, and actions.
- Runbook link and owner.
- Acknowledge, assign, suppress, and resolve based on permission.
- Deep-link each incident to the exact queue item, merchant, runbook key, and authoritative diagnostic record when available.

### 10.4 Payments And Reconciliation

- Unknown/provider-accepted money operations.
- Retry-budget-exhausted operations requiring human attention, distinct from work that is still actively retrying.
- Refund claims awaiting local finalization.
- Defense submissions awaiting reconciliation.
- Recurring billing setup failures.
- No direct charge/refund controls in the initial Command Center release.

### 10.5 Workflows And Evidence

- Subscription and delivery health.
- Durable field-sync queue.
- Pulse/reminder diagnostics.
- Connector intake, retry, quarantine, and attachment health.
- Enrollment-resolution failures.

### 10.6 Recovery And Deployments

- Latest backup proof and age.
- Last restore drill.
- Backup timer/service status.
- Latest deploy, last known-good SHA, and CI state.
- Runbooks for approved human recovery actions.

### 10.7 Resellers

- Reseller organizations and staff.
- Assigned merchants.
- Assignment history and transfer workflow.
- Aggregate health and setup status.
- No platform-wide merchant or revenue visibility.

### 10.8 Security And Audit

- Operator login/session activity.
- Access denials.
- Sensitive views.
- Assignment and role changes.
- Action requests and results.
- Guardian credential and alert-channel status.

## 11. Controlled Action Model

### 11.1 Action Risk Classes

#### Read-Only Diagnostics

- Refresh current health.
- Re-run a non-mutating provider connection check.
- View sanitized queue or incident details.

#### Low-Risk Idempotent Repairs

Potential later examples:

- Retry a failed local-only finalization after provider success is already known.
- Replay an idempotent quarantined connector event after a mapping correction.
- Re-run a trigger delivery only when durable state proves the GHL workflow was never fired; the job must record a machine-readable `failure_stage` before this action can ship.
- Create a persistent merchant reconnect task for an operator; it does not send a message automatically.
- Disable a compromised evidence connector and atomically expire its active credentials.
- Re-run a bounded provisioning-recovery or health-rollup reconciliation job.

Each action still needs permission, audit, a deterministic idempotency key, and post-action proof.

#### High-Risk Actions

- Charges, refunds, voids, retrying processor requests, and subscription lifecycle changes.
- Deploy, rollback, secret rotation, database repair, restore, deletion, and data relinking.
- Marketplace entitlement, WholePay approval, role, assignment, and credential mutations.

These remain owner-only or require a separate two-person/step-up approval design. Resellers do not receive them in the initial release.

Existing provider-outcome resolution and WholePay approval remain owner-only attributed actions. They are not lost during the transition from the legacy HQ page, but they are not exposed as generic repair commands.

### 11.2 Action Record

Every controlled action records:

- Requesting actor, organization, role, and session.
- Target merchant and exact resource.
- Named action and risk class.
- Sanitized parameters.
- Reason.
- Required and obtained approvals.
- Stable idempotency key.
- Start/end time.
- Authoritative before and after state.
- Result, provider reference where safe, and sanitized failure.

An HTTP `200` is not proof that the intended external result occurred.

## 12. Proposed Data Model

The next migration number is chosen only after a live-schema comparison and a check for concurrent work.

### 12.1 Identity And Organizations

#### `operator_organizations`

- `id`
- `organization_type`: `platform` or `reseller`
- `name`
- `status`
- `external_reference`
- timestamps

#### `operator_users`

- `id`
- `auth_user_id` unique reference to Supabase Auth identity
- `email_normalized`
- `display_name`
- `status`
- `last_login_at`
- timestamps

#### `operator_memberships`

- `organization_id`
- `operator_user_id`
- `role`
- `status`
- inviter and timestamps
- unique active membership boundary

V1 permits one active operator organization per user so every session has an unambiguous organization context. Supporting one identity in multiple organizations requires an explicit organization-selection and re-authentication design later.

#### `reseller_merchant_assignments`

- `reseller_organization_id`
- trusted `location_id` as the durable authorization and uniqueness key
- optional `merchant_id` reference for joins, never used alone as authorization currency
- `relationship_type`
- `status`
- effective and ended timestamps
- assigned/ended actors and reason
- partial uniqueness for one active primary reseller per merchant

#### `operator_support_grants`

- grantee platform user only in v1
- trusted merchant `location_id`
- named server-owned permission bundle
- reason
- start, expiration, and revocation
- requester and approver
- requester cannot equal approver

### 12.2 Sessions And Authorization

#### `operator_sessions`

- opaque session ID hash
- operator user
- authentication assurance
- created, last-seen, idle-expiration, absolute-expiration, revoked timestamps
- device/session metadata minimized and sanitized

Do not store reusable plaintext session tokens.

### 12.3 Health And Incidents

#### `service_heartbeats`

One upserted current row per service/worker instance, with bounded write cadence.

#### `job_runs`

One row per scheduled run with run key, status, counts, duration, and sanitized error class.

#### `health_observations`

Append-only recent observations with source, scope, check key, state, latency, observed time, expiry, idempotency key, and typed sanitized details. Write on state transition plus one bounded periodic confirmation, not on every unchanged poll.

#### `merchant_health_rollups`

One current row per merchant for scalable list and reseller queries.

#### `platform_health_rollup`

One current platform summary.

#### `platform_incidents`

Stable incident, severity, status, dedupe key, scope, title, summary, first/last seen, owner, acknowledgement, resolution, runbook key, suppressibility, parent incident, and recovery dwell. A partial unique index enforces one active incident per dedupe key.

#### `incident_events`

Append-only timeline for observations, transitions, alerts, notes, and linked actions.

### 12.4 Alerting And Guardian

#### `alert_routes`

Owner-controlled channel configuration reference. Secrets remain encrypted outside browser-visible rows.

#### `alert_deliveries`

Incident, channel, attempt, status, provider reference, and sanitized error.

#### `guardian_credentials`

Credential ID, Ed25519 public verification key, expected monotonic sequence, status, rotation overlap, and revocation. No shared HMAC secret or private signing key is stored by ScaleSafe.

#### `guardian_runs`

Run ID, version, host, start/end, status, observation counts, ingestion result, and signed payload hash.

#### `recovery_verifications`

Backup snapshot, age, schema, object count, verification result, restore-drill reference, and observed time.

### 12.5 Audit And Actions

#### `operator_audit_events`

Actor identity, organization, role, session, action, result, target, request ID, IP/user agent minimization, and sanitized metadata.

Existing `hq_admin_audit_logs` is retained as historical data and either migrated or exposed through a compatibility view.

#### `operator_action_requests`

Action lifecycle including `unknown`, risk, target, sanitized input, approvals, idempotency key, compare-and-set execution claim, execution result, and authoritative verification. The state machine follows the durable-operation pattern from migration 098.

### 12.6 Access Policy

- Enable and force RLS on every new table.
- Revoke access from `PUBLIC`, `anon`, and ordinary `authenticated` roles unless a narrowly reviewed policy is intentionally needed.
- Keep normal browser access behind the ScaleSafe backend.
- Use backend authorization plus database constraints; UI visibility is never an authorization boundary.
- Add indexes for every assignment, incident, health, status, and time-bound query before production use.
- Apply `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY`, explicit grant revocation, and service-role-only function execution using migration 102 as the minimum pattern.

## 13. API Boundaries

Final names may change during implementation, but boundaries remain separate.

### 13.1 Operator Session

- `POST /internal/operator/auth/start`
- `GET /internal/operator/auth/callback`
- `POST /internal/operator/auth/mfa/verify`
- `POST /internal/operator/auth/logout`
- `GET /internal/operator/api/session`

### 13.2 Read Models

- `GET /internal/operator/api/overview`
- `GET /internal/operator/api/incidents`
- `GET /internal/operator/api/merchants`
- `GET /internal/operator/api/merchants/:locationId`
- `GET /internal/operator/api/resellers`
- `GET /internal/operator/api/recovery`
- `GET /internal/operator/api/audit`

The same endpoints return only records allowed by the server-derived context. There is no separate reseller API that can drift into weaker controls.

### 13.3 Administration

- Invitations and membership lifecycle.
- Reseller organization lifecycle.
- Merchant assignment transfer.
- Support-grant lifecycle.
- Incident acknowledgement and assignment.

### 13.4 Controlled Actions

- `POST /internal/operator/api/action-requests`
- `POST /internal/operator/api/action-requests/:id/approve`
- `POST /internal/operator/api/action-requests/:id/execute`

Actions are selected from a server-owned registry. Arbitrary route names, SQL, JavaScript, URLs, or provider payloads cannot be submitted as actions.

### 13.5 Guardian Ingestion

- `POST /internal/guardian/v1/runs`
- `POST /internal/guardian/v1/observations`
- `POST /internal/guardian/v1/recovery-verifications`

Guardian routes use a separate signed credential with timestamp, monotonic sequence replay protection, payload limits, and rate limits. They do not accept operator browser sessions.

Operator routes are served only on the dedicated operator hostname. Guardian routes are server-to-server only. Unmatched `/internal/*` paths return an explicit `404` and are excluded from the merchant SPA catch-all.

## 14. Performance And Retention

### 14.1 Performance Rules

- No list endpoint may issue one query bundle per merchant.
- Use rollup rows and grouped aggregate queries.
- Paginate every merchant, incident, audit, and event list.
- Bound all details and time ranges.
- Cache only post-authorization, sanitized presentation data briefly. Session validity, membership, role, assignments, grants, and permission inputs are read live or synchronously invalidated and are never protected by a bare TTL.
- Use database leases for reconciliation, not in-memory locks.
- Record worker heartbeat no more frequently than needed for the SLA.
- Load-test at 100, 1,000, and 10,000 merchant equivalents before declaring the architecture scalable.

### 14.2 Retention Proposal

Final retention requires owner approval and legal/privacy review.

Initial technical proposal:

- Current rollups: retained while resource exists.
- Detailed health observations: 90 days, written only on transition plus bounded confirmation.
- Incident and incident-event history: retained according to the platform audit policy.
- Operator audit and assignment history: retained according to the platform audit policy.
- Guardian run details: 90 days.
- Alert delivery attempts: 90 days.
- Job runs: 90 days unless operational volume justifies a shorter owner-approved window.

Retention jobs must be bounded, observable, and incapable of deleting payment, enrollment, evidence, defense, or recovery archives.

## 15. Threat Model

### 15.1 Primary Threats

- Stolen shared HQ token.
- Compromised operator or reseller account.
- Browser changing `location_id` to another merchant.
- Reseller assignment race or stale cache retaining old access.
- Privilege escalation through client-supplied role or organization fields.
- XSS stealing sessions or invoking actions.
- CSRF invoking privileged mutations.
- Compromised Guardian VPS.
- Compromised VPS root reaching co-resident write-capable backup credentials.
- Forged/replayed Guardian observations.
- Alert spoofing or alert-channel outage.
- Health polling causing Supabase resource exhaustion.
- Raw logs or health details exposing PII/secrets.
- Ambiguous retries causing duplicate provider actions.
- A database outage making the dashboard falsely appear healthy.
- Suppression hiding a critical incident.
- Public/merchant same-origin script riding a privileged operator cookie.
- Legacy debug token remaining as an unattributed administrator path.
- Invitation escalation or MFA recovery bypass.

### 15.2 Required Controls

- Invite-only identity and MFA.
- Opaque HTTP-only sessions and CSRF protection.
- Strict CSP, output encoding, no unsafe HTML.
- Dedicated operator hostname and host-only operator cookie.
- Server-derived authorization context on every request.
- Atomic assignment transfer and immediate cache invalidation.
- Expiring support grants.
- Signed Guardian ingestion and replay protection.
- Least-privilege Guardian credentials.
- Independent outage alert path.
- Sanitized allowlisted diagnostic fields.
- Rate limits, payload limits, bounded queries, and adaptive polling.
- Idempotent action registry and processor-state verification.
- Immutable incident and audit history.
- Out-of-band Guardian alert acknowledgement and dead-man monitoring.
- Backup-status drop file so Guardian never reads backup credentials.
- Tests that attempt cross-tenant and cross-reseller access on every relevant endpoint.

## 16. Implementation Phases And Gates

### Phase 0 - Architecture And Independent Review

Deliverables:

- Current-state map.
- Owner decisions register.
- Target architecture and threat model.
- Data/API/UI plan.
- Implementation phases and test matrix.
- Independent Fable review and verified reconciliation.
- Recommended-default and genuinely-open owner decisions separated.
- Branch, staging, feature-flag, migration, and Marketplace-review ground rules.

Gate:

- Philip approves the final architecture.
- Every accepted critical/high review issue has a documented resolution.
- No unresolved ambiguity remains about reseller visibility, alert provider, operator authentication, or production deployment timing.
- The standing direct-to-`main` workflow is suspended for this workstream until Philip explicitly approves the production deployment window.

### Phase 1 - Identity, Organizations, Assignments, And Audit

Deliverables:

- Migration for operator organizations, users, memberships, assignments, support grants, sessions, and operator audit.
- Dedicated operator hostname, backend-proxied invite-only authentication, opaque-cookie sessions, and MFA.
- Central server-side authorization middleware.
- `location_id`-keyed atomic reseller assignment transfer and platform-user-only support grants.
- Durable denial audit and audit-intent-before-mutation behavior.
- Exact trust-proxy configuration, account/invite throttling, invite constraints, MFA recovery policy, and `/internal` fail-closed routing.
- Isolated Railway service and scratch Supabase project for certification; no production database or deployment required.
- Legacy HQ/debug compatibility kept inaccessible to resellers pending the Phase 4 cutover.
- Authorization policy tests.

Gate:

- Cross-tenant and cross-reseller tests pass.
- Disabled user, removed membership, transferred assignment, expired grant, and revoked session lose access immediately.
- Concurrent assignment transfer leaves one active primary assignment; uninstall/reinstall preserves assignment history.
- Every permission-registry sensitive view and every forced denial is attributable to a real operator; forced audit failure blocks mutation.
- Operator credentials cannot combine with GHL merchant credentials, and out-of-scope/nonexistent locations return indistinguishable not-found responses.
- Both legacy token families remain platform-only and their complete consumer inventory is recorded for cutover.
- Static HQ token is not yet removed until the new path is live-certified.

### Phase 2 - Health, Heartbeats, Rollups, And Incidents

Deliverables:

- Service heartbeats and durable job-run history.
- Health observation and current-rollup model.
- Incident engine with dedupe, escalation, acknowledgement, suppression, and resolution.
- Event-driven health updates for current workers and operations.
- Database-leased, set-based in-app merchant health reconciliation.
- Scalable merchant health read model with live authorization intersection.
- Owner-approved check-threshold and resource-budget appendix.
- State-transition plus bounded-confirmation observation writes, typed diagnostic allowlists, retention jobs, and staleness-at-read-time.
- Worker task timeouts, completed-tick heartbeats, durable scheduled-window run keys, exhausted-retry states, and one-level dependency suppression.
- A separate health/incident feature flag whose disabled state starts no worker and serves no route.
- Seeded load-test and failure-injection harness.

Gate:

- Concurrent forced worker/job/degraded-database/queue failures create exactly one correct incident; provider-wide failure creates one alerting parent with linked suppressed children.
- Recovery resolves the health state and records recovery without deleting history.
- Deploy/instance churn creates no false worker incident.
- A 24-hour no-change run proves bounded observation writes.
- At 100, 1,000, and 10,000 seeded merchants, query count remains bounded and p95 latency/resource usage remain within the approved appendix.
- Total Supabase/Railway outage alerting is intentionally certified in Phase 3, not claimed here.

### Phase 3 - Guardian And Independent Alerting

Deliverables:

- Least-privilege Guardian service on VPS.
- Ed25519-signed observation ingestion with monotonic sequence, rotation, check-key allowlist, payload limits, and durable rate limits.
- Global uptime, worker, queue, deployment, CI, security, backup, and restore checks.
- Sanitized backup-status drop file; Guardian never reads `backup.env` or decryption material.
- Independent alert provider, local delivery/ack state, out-of-band acknowledgement, dead-man check, and delivery proof.
- Decryption-free backup-object verification plus human-run restore-drill recency tracking.
- Machine-readable local reports for optional Hermes/OpenClaw summaries.

Gate:

- Guardian detects an intentionally unavailable test endpoint.
- Guardian still alerts and can be acknowledged when Command Center/Supabase ingestion is unavailable, then reconciles after recovery.
- Replayed, stale, out-of-order, forged, unknown-key, oversized, and unauthorized merchant-scoped observations are rejected, including attempts using every secret held by ScaleSafe's verifier.
- Guardian service-account compromise shows no payment, merchant-data mutation, deploy, restore, identity, assignment, or authorization authority.
- The co-resident VPS-root backup-credential risk is either explicitly accepted for controlled beta or removed through a separate monitoring host.
- Railway/Supabase outage renders dependent state `unknown`, never stale-healthy.
- Backup verification continues unchanged.

### Phase 4 - Read-Only Master Seller Dashboard

Deliverables:

- Dedicated operator SPA.
- Platform overview, merchants, incidents, payments/reconciliation, workflows/evidence, recovery/deployments, resellers, and audit views.
- Per-panel freshness indicators and distinct explanations for freshness unknown, provider outcome unknown, and retry-budget exhausted.
- Runbook registry, incident-to-authoritative-record links, certification dataset, completed operator runbooks, and owner training.
- Individually attributed deep links to the legacy provider-outcome function until it is rebuilt as a controlled action.
- Legacy HQ and debug credential retirement checkpoint with certified break-glass replacement.
- No normal production mutation controls.

Gate:

- `platform_owner` sees only its allowed views; unused platform roles remain disabled and are certified before first assignment.
- Pages meet the owner-approved p95 targets at 10,000 seeded rollup rows and worst supported filter combinations.
- No secret, excessive PII, raw provider payload, or permanent private URL is present.
- Every count reconciles to its authoritative source in certification data.
- Every permission-registry view and denial is audited; all legacy static-token routes are disabled or certified break-glass only.
- Platform publication requirements in Section 20 are satisfied.

### Phase 5 - Reseller Dashboard

Deliverables:

- Reseller staff management.
- Assigned merchant list and aggregate merchant detail.
- Assignment/transfer process controlled by platform roles.
- Reseller-safe incidents and setup status.
- Allowlisted reseller read models and DTO mappers; no filtered raw operational rows.
- Merchant disclosure/terms and reseller offboarding behavior approved and documented.

Gate:

- Two resellers with overlapping client emails cannot see one another's merchants or data on any endpoint.
- Browser tampering with location, organization, route, cursor, filter, and export inputs cannot expand access.
- Transferred and unassigned merchants disappear immediately from the old reseller.
- Exists-but-unassigned and nonexistent merchant lookups are indistinguishable.
- Poison data placed in every free-text source column produces no prohibited client data, platform total, raw error, or credential in reseller responses.
- Reseller output is read-only and contains no payment dollar totals or export capability in v1.
- Reseller publication requirements in Section 20 are satisfied.

### Phase 6 - Approved Repair Actions

Deliverables:

- Server-owned action registry.
- Action requests, approvals, idempotency, execution, and authoritative verification.
- First vetted action set: local-only finalization after authoritative provider success, eligible connector replay, never-fired trigger retry with `failure_stage`, connector disable plus credential expiry, and bounded provisioning/rollup reconciliation.
- Existing provider-outcome resolution and WholePay approval moved into attributed owner-only actions.
- Reconnect request represented only as a persistent operator task unless a separately approved communication design is added.
- Step-up authentication for elevated actions.

Gate:

- Duplicate clicks and retries execute once.
- Provider timeout ambiguity does not resend unsafe actions.
- Failed external action does not create false local success.
- Retry-budget exhaustion and ambiguous outcome enter an explicit `unknown`/attention state rather than claiming a retry is still active.
- Every action is fully audited.
- Resellers remain mutation-free unless a later separately approved permission is added.

### Phase 7 - Operational Optimization

Deliverables:

- Trend analytics and capacity forecasting.
- Alert-threshold tuning from real beta data.
- Additional provider adapters and log-drain integration where valuable.
- Expanded runbooks and controlled automations.

Gate:

- Changes are justified by observed operational data, not speculative complexity.

## 17. Verification Matrix

### Authentication And Authorization

- Platform owner can view all merchants.
- Platform support cannot administer platform identities.
- Reseller roles see only active assignments.
- Requested location from another reseller returns no data.
- Disabled user and revoked session fail immediately.
- MFA is required for privileged actions.
- CSRF and session replay attempts fail.
- Public/merchant-origin script cannot read or invoke the operator origin with operator authority.
- A request carrying both GHL and operator credentials cannot combine identity planes.
- Forced audit-intent failure prevents the privileged mutation.

### Assignment Integrity

- One active primary reseller per merchant.
- Transfer is atomic and historical.
- Old reseller access disappears without waiting for a long cache TTL.
- Support grant expires and revokes correctly.
- Merchant uninstall/reinstall does not change or silently reassign reseller ownership.

### Health And Incidents

- Missing heartbeat becomes unhealthy after its defined window.
- One transient warning does not create noise unless the rule requires immediate action.
- Repeated failure deduplicates.
- Severity escalation and recovery notification work.
- Unknown data never appears healthy.
- Retry-budget exhausted is visibly distinct from actively retrying.
- Total database outage is independently alerted and acknowledged without the application database.

### Scalability

- Merchant overview query count remains bounded as merchant count grows.
- Health write cadence remains bounded across multiple Railway instances.
- Guardian backs off during database/provider pressure.
- Historical data retention does not degrade current read models.

### Security

- Guardian payload cannot select arbitrary tenants or execute actions.
- Guardian signature replay fails.
- Legacy HQ/debug tokens are absent after cutover and their routes return `404` outside break-glass.
- Reseller export/filter/cursor tampering cannot cross assignments.
- Logs and diagnostics redact credentials and client PII.
- Typed allowlist and poison-data tests prove reseller/operator diagnostics do not leak free-text PII.
- XSS payloads render inert.
- Audit records include denials and failed actions.

### Operational Actions

- Duplicate action request executes once.
- Provider ambiguity creates reconciliation, not blind retry.
- Local state changes only after authoritative success where appropriate.
- Action proof matches the exact merchant and resource.

### Recovery

- Guardian reports the existing backup snapshot and age accurately.
- Failed backup timer creates an incident.
- Stale backup creates an independent alert.
- Monthly restore drill status is visible.
- Guardian cannot decrypt archives or restore production.
- Guardian cannot read `backup.env`; it receives only a sanitized status drop file.
- The monthly restore remains a human-run isolated drill whose recorded recency Guardian can verify.

## 18. Deployment And Rollback Strategy

1. Build each phase on a dedicated branch from the reconciled baseline. For this workstream, the standing direct-to-`main` practice is suspended because `main` auto-deploys to the application under GHL Marketplace review.
2. Provision an isolated Railway service and scratch Supabase project before Phase 1 certification. Do not certify destructive or outage scenarios against production.
3. Run a live-schema comparison and concurrent-work check before choosing each migration number.
4. Write every migration idempotently and make it advance `scalesafe_schema_version()`.
5. Paste migration SQL for owner review before applying it. Applying SQL to the live database is a production change even when new routes are feature-flagged.
6. Apply migration before deploying dependent code. In the same release, raise `REQUIRED_SCHEMA_VERSION` to that migration and remove hardcoded older-migration health messages.
7. Keep every new surface behind separate flags:
    - Command Center identity/access.
    - Health/incident producers and reconciliation.
    - Guardian ingestion.
    - Reseller portal.
    - Operator actions.
8. A disabled flag starts no background producer and causes every associated route to return `404`. Unmatched `/internal/*` never falls through to merchant SPA HTML.
9. Certify in the isolated operator/staging context before production enablement.
10. Enable read-only platform access before reseller access.
11. Enable one reseller and two isolated reseller test organizations before broader rollout.
12. Keep a documented rollback for code, feature flags, sessions, and schema compatibility.
13. Do not destructively roll back schema. The normal forward path is migration before code; absent-table tolerance exists only for flag-off behavior and the rollback window.

Nothing merges to `main`, no live migration is applied, and no production flag is enabled without owner approval while the GHL Marketplace application is under review.

## 19. Phase 1 Approval Record And Remaining Owner Decisions

### 19.1 Recommended Defaults For One Batch Approval

**Approved by Philip on 2026-07-22.** These defaults govern the isolated Phase 1 implementation. They do not authorize production SQL, deployment, DNS, or feature enablement.

1. Use `ops.scalesafe.app` as the dedicated operator hostname on the existing backend/codebase.
2. Keep the default reseller view account-level, exclude client PII/evidence and payment dollar totals, and allow one active primary reseller per merchant.
3. Allow one active operator organization per user in v1.
4. Limit support grants to named platform users; do not support cross-reseller grants in v1.
5. Use Supabase Auth server-side for credentials/MFA and issue only an app-owned opaque browser session after official-flow verification.
6. Make MFA recovery owner-approved or step-up-gated, never unreviewed self-service.
7. Keep reseller exports, direct merchant communications, and client-level detail out of v1.
8. Keep unused platform roles disabled; certify each before first assignment.
9. Retire both legacy token surfaces at the Phase 4 cutover and retain only the separately controlled break-glass path.
10. Keep all Command Center work off `main` and the live database until Philip approves production timing.

### 19.2 Genuinely Open Decisions

1. Select an alert provider and owner destinations that support out-of-band acknowledgement, dead-man monitoring, and narrowly scoped credentials.
2. Decide whether the existing VPS co-residency risk is acceptable for controlled beta or whether Guardian receives a separate low-cost host before Phase 3 production certification.
3. Decide whether a merchant sees the assigned reseller organization's name and approve any related terms/privacy disclosure before Phase 5.
4. Decide whether `platform_support` may ever receive temporary client-level diagnostics through an owner-approved support-grant bundle.
5. Confirm audit, incident, health, job-run, and alert-delivery retention after legal/privacy review.
6. Approve the Phase 2 numeric threshold/resource-budget appendix before monitoring activation.
7. Confirm the production deployment window relative to the active GHL Marketplace review.
8. Decide the final disposition of the legacy debug routes: retire, rebuild as attributed actions, or place a narrowly selected subset behind break-glass.

## 20. Definition Of Published Command Center

The Command Center is not considered published because pages render.

### 20.1 Published Platform Command Center

Platform publication requires:

- Identity-based authentication and MFA.
- Certified `platform_owner` role and assignment enforcement; unused roles remain disabled.
- Read-only master dashboard backed by scalable rollups.
- Independent Guardian checks and alert delivery proof.
- Incident lifecycle and audited operator activity.
- Recovery status tied to the proven backup system.
- Completed runbooks and owner training.
- Legacy HQ/debug credentials retired or restricted to the certified break-glass path.
- No open critical or urgent defects.
- A documented controlled-beta rollout and rollback.

### 20.2 Published Reseller Command Center

Reseller publication additionally requires:

- Certified cross-reseller isolation on every reseller endpoint.
- Server-derived live assignment enforcement and immediate revocation/transfer behavior.
- Allowlisted account-level read models proven with poison-data tests.
- Approved merchant disclosure/terms and reseller offboarding behavior.
- No reseller mutation, export, payment-dollar-total, client-PII, evidence-file, message, or credential access in v1.

Repair actions may follow after read-only publication. They are not required to prove the core Command Center, but the architecture must support them without bypassing authorization, audit, idempotency, or processor truth.
