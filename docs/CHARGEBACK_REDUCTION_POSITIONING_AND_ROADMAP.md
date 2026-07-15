# ScaleSafe Chargeback Reduction Positioning and Roadmap

This document records the current product position for chargeback reduction and defense readiness. It is the reference point for marketing copy, beta readiness, and future defense-roadmap work.

## Positioning

ScaleSafe helps merchants reduce chargeback risk by building the evidence trail before a dispute happens. It should not be positioned as preventing all chargebacks or guaranteeing dispute wins.

The strongest value is lifecycle evidence capture tied to a client and enrollment: consent, payment, delivery, communication, milestones, pulse check-ins, refunds, cancellation history, and program activity.

Payment rail does not inherently weaken the evidence story. Stripe, NMI, Whop, FanBasis, ACH, and future rails can all support the same defense record when ScaleSafe reliably links payment events, processor IDs, refunds, cancellations, and webhook events to the right enrollment.

The rail-specific risk is operational: webhook coverage, transaction identifiers, refund/cancel support, dispute-event visibility, and whether the processor exposes useful dispute data automatically.

## Current Assets

- Contact-level evidence readiness scoring exists, but it should be treated as a rough client evidence indicator, not a dispute win prediction.
- Pulse cadence exists through the dedicated `ss_pulse_check_due` trigger, with legacy `ss_app_event` + `event_type = pulse_check_due` fallback during beta transition. Pulse submissions can become enrollment-linked evidence.
- GHL communication/activity tracking includes timestamps and can support the evidence timeline when the merchant uses GHL communication channels.
- External evidence ingestion exists for sessions, modules, milestones, pulse checks, payment updates, service access, course completion, assignment submissions, and custom events.
- Defense logic includes reason-code-aware evidence prioritization for authorization, payment history, communication, service delivery, and refund/cancellation evidence.
- The broader defense-response experience still needs deeper production hardening before it should be marketed as automated expert representment.

## MVP Beta Requirements

- Public copy must use "reduce chargebacks," "build the evidence trail," and "improve dispute readiness." Avoid "prevent chargebacks," "win every chargeback," and guarantee-style claims.
- Evidence readiness should be labeled as contact-level readiness until program/enrollment-level scoring ships.
- Pulse must be smoke-tested end to end before it is treated as beta-proven: due pulse found, app event delivered to GHL, GHL workflow executed, outbound email/SMS observed, client submitted, evidence linked to the enrollment.
- Defense packets should be positioned as organized evidence packets and draft response support, not guaranteed automated representment.
- Communication evidence must show readable message content, direction/channel when available, and timestamps.
- Payment, refund, pause, resume, cancel, and recurring evidence must be proven per active processor.
- WholePay processor setup can include Ethoca, Verifi, RDR, descriptor, and 3DS/Radar guidance, but ScaleSafe should not imply native network-alert automation until it is actually integrated and tested.

## Roadmap

- Dashboard attention center: replace the separate open-disputes and pulse sections with a compact three-tab work queue for Open Disputes, Pulse Check-Ins, and Milestones. Only one tab is visible at a time; each list is scrollable and a tab receives a red attention dot when action is due. Every item can be dismissed from the dashboard without deleting, resolving, or changing the underlying dispute, pulse response, milestone, enrollment, or evidence. Decide before implementation whether dismissal is per GHL user or shared across the merchant location.
- Scheduled milestone delivery: let each offer milestone carry an estimated delivery offset/window relative to enrollment start (for example, due during week 4 or seven days before a target date). Upcoming milestones should enter the Dashboard attention center shortly before the delivery window. The merchant can open the client/program or mark the milestone complete from the queue, using the same enrollment-scoped completion and client sign-off workflow as the program record. Overdue, dismissed, completed, and not-yet-due states must remain distinct.
- Enrollment-level evidence score: score each program/enrollment by evidence buckets such as authorization, accepted terms, delivery, communication, satisfaction, refund/cancel history, and payment history.
- Reason-code evidence readiness: show gaps by reason category, such as fraud/authorization, unrecognized charge, services not provided, not as described, and credit not processed.
- Pulse v2: ask stronger structured questions about what the client received, satisfaction with progress, needed help, billing/refund/cancellation concerns, and follow-up request.
- Negative pulse alerts: alert merchants when pulse responses show low satisfaction, billing concern, refund/cancel intent, or follow-up need.
- Support SLA evidence: calculate first-response time, unresolved complaint age, refund/cancel request age, and last merchant touch using GHL communication timestamps.
- Network alert dashboard: future optional integration/import for Ethoca Alerts, Verifi Order Insight, Verifi RDR, Stripe Early Fraud Warnings, and alert outcomes if WholePay or a processor/provider makes access practical.
- Order Insight / Consumer Clarity playbooks: provide setup guidance first; direct integration only if access, cost, and operational value justify it.
- Radar / 3DS recommendations: provide processor-side setup guidance and optional rule recommendations; do not make this beta-critical.
- External activity SDK/webhook v2: package the existing external webhook pattern into a simple guide for Zoom, Meet, course platforms, SaaS logins, downloads, and service usage.
- Recovery partner handoff: post-beta option where ScaleSafe compiles a recovery-ready evidence packet and, only when the merchant opts in, hands the case file to an approved legal/recovery/collections partner. ScaleSafe should not send legal or collection letters, act as a collector, imply waiver of cardholder dispute rights, or re-charge stored cards for disputed amounts. See `docs/RECOVERY_PARTNER_HANDOFF_RESEARCH_NOTES.md` before reopening legal/product research.
- Outcome analytics: track dispute outcomes by reason code, offer, source/closer, processor, evidence completeness, refund timing, and network-alert coverage.

## Internal Security / Recovery Roadmap

ScaleSafe should have a separate post-beta internal "Guardian" service or agent whose only job is to verify security posture, verify recoverability, and alert when something is wrong. It should not live inside the merchant-facing app, and it should not write product code or mutate customer/payment records.

Recommended architecture:

- Host the Guardian core on the always-on virtual server, not the command-center PC.
- Keep the backup and verification logic deterministic: scripts, scheduled jobs, API checks, manifests, hashes, and restore tests.
- Use Hermes/OpenClaw only as a reporting/orchestration layer that reads Guardian outputs and drafts human-readable reports. The AI layer should not be the source of truth for backup execution.
- Store reports as Markdown/JSON so any future agent can inspect them.
- Use separate encrypted backup storage, ideally S3-compatible storage with versioning and object-lock style protection.

Minimum access model:

- Read-only GitHub access where possible.
- Read-only Railway access where possible.
- Supabase export/backup access.
- Write-only access to backup storage.
- No production deploy permission.
- No processor mutation access.
- No refund, charge, pause, cancel, or merchant-data mutation permissions.
- No automatic secret rotation unless a separate break-glass process is explicitly approved.

MVP Guardian checks:

- GitHub: `main` protection, latest CI status, unexpected force-pushes/direct pushes, secret-scan results.
- Railway: required env vars present, dangerous flags absent, latest deploy healthy, last known-good deployment recorded.
- Supabase: PITR/daily backup status, encrypted logical export, backup hash manifest, periodic scratch restore test.
- Evidence files: backup generated defense packets, enrollment packets, uploaded files, and evidence artifacts; record file manifests and hashes; periodically restore sample files and compare hashes.
- Secrets posture: maintain an encrypted inventory of expected secrets and last rotation dates without storing secrets in the repo.
- Incident readiness: keep runbooks for bad deploy rollback, database corruption, leaked secrets, processor credential compromise, missing evidence files, GHL integration failure, and full production outage.

Operational targets for beta:

- Code rollback RTO: under 10 minutes through Railway/GitHub rollback.
- Secret rotation RTO: under 30-60 minutes once compromise is confirmed.
- Database RPO: under 1 hour if Supabase PITR and export cadence make that practical.
- Evidence-file backup: daily minimum, more frequent once live merchants are active.
- Restore testing: weekly sample restore, monthly full incident simulation.

Daily report shape:

```text
ScaleSafe Guardian Daily Report

Status: PASS / WARN / FAIL

Code:
- main protected: yes/no
- latest CI: green/failing
- latest deploy: healthy/unhealthy
- secrets detected in repo: yes/no

Database:
- PITR enabled: yes/no
- last backup: timestamp
- last restore test: timestamp
- backup age: X hours

Evidence files:
- files checked: X
- missing/corrupt: X
- last restore sample: pass/fail

Secrets:
- required env vars present: yes/no
- stale rotation warnings: list

Actions needed:
- none / list exact remediation steps
```

Design rule: the Guardian can create encrypted backups, verify backups, write audit logs, send alerts, and open internal incident records. It should not automatically delete backups, rotate secrets, push code, rollback production, or mutate customer/payment data.

## External Product Clarifications

- Verifi Order Insight shares richer purchase details with issuers so cardholders and issuer agents can recognize transactions before filing disputes.
- Verifi Rapid Dispute Resolution resolves eligible pre-disputes using merchant-defined rules, usually by issuing a refund before a formal chargeback is created.
- Ethoca Alerts provides near-real-time issuer dispute/fraud alerts so merchants can refund, stop fulfillment, or take action before the dispute becomes a formal chargeback.
- Ethoca Consumer Clarity shares richer purchase details in issuer channels to reduce confusion-driven disputes.
- Visa CE 3.0 can block or reject eligible Visa fraud disputes when the required historical transaction evidence is available.
- Statement descriptors help transaction recognition on the card statement. Order Insight and Consumer Clarity provide richer issuer-side purchase context and are not the same thing as descriptors.
