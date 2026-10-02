# Group Call Attendance And No-Show Audit

Date: October 1, 2026.
Status: October 2 scope narrowed to the existing correctness patch; release validation underway. No live workflow certification.

## October 2: Keep The Existing Features Simple

Philip clarified that this is bug fixing, not a new attendance system or additional routine operator work. The earlier question about who completes the feedback form is withdrawn as a release prerequisite. Do not ask him to design a form or choose an internal contract.

- Release only the six existing correctness fixes after fresh verification under the standing deployment approval. No additional runtime changes were needed for this scope clarification.
- Do not rebuild forms, revive obsolete workflows, add a roster/reporting project, or enable new follow-up automations in this release.
- PMG's incomplete feedback form remains untouched. It must not be turned into affirmative attendance or merchant attestation. Missing/unknown attendance deliberately sends neither attendance nor no-show follow-up; existing explicit attended/no-show values retain their existing trigger payload shape.
- Existing Session Follow-Up receives the same boolean `no_show_flag: false` for explicit attendance. The patch removes the erroneous session trigger for confirmed no-shows; it does not change Marketplace filter constants or recipient settings.
- PMG merchant-alert recipient and full inbox proof remain open, not repaired. Feedback configuration is a separate pending issue, not a requirement to ship protections against wrong-person records and false participation.
- No current source path infers a shared-call absence from missing feedback or a missing Zoom match. Complete automatic group no-show detection remains unbuilt; do not advertise it as part of this release.
- October 2 fresh full Jest run: 219 suites / 1,928 tests passed; backend typecheck and production build/asset copy passed. Rollout verification is recorded at completion. No SQL or real test messages.

## PMG Rollout Preflight: October 1

Deployment is HELD at the compatibility gate. Philip subsequently approved repairing the current PMG attendance setup and follow-ups, leaving obsolete workflows alone and requiring separate approval before test messages. Repair is NOT complete: inspection found a session-log/client-feedback contract mismatch, and the editor would not retain the merchant notification recipient. All attempted edits were discarded; after reloading, Save Workflow was disabled and the original blank Custom email recipient/body were verified. No top-level workflow save/publication, form submission, message, SQL, charge, or production deployment occurred.

- Confirmed PMG Merchant Consulting LLC, location `274dtgl30b7x2HG8hn69`, in the authorized HighLevel browser. An initial browser session opened an unrelated account; it was not modified or used for this audit.
- Read-only Railway status and fresh Git fetch agree: production remains `5aa3b475d187db68707f2f744b729082ba3fd02a`, deployment `b4851196-565c-4c7a-ac35-6738e4bada6a`, SUCCESS/RUNNING, service ScaleSafe in production. No push occurred.
- `SYS2-07 Evidence Logger` (`f1ddb029-1bf1-4f28-aaef-e696423ab54c`) is published and listens to `SYS2-07: Session Feedback`. Its Webhook action points to `https://scalesafe-production.up.railway.app/webhooks/ghl/forms`, has no custom-data mappings and no headers. Two downstream contact-update actions show warning icons; their specific validation errors were not inspected.
- `SYS 02-12 Session Logger` (`597f7a1c-432b-4062-b8b2-eb9d20daf925`) listens to `Form 2A: Session Log`, waits, and uses the same old URL with no custom data/headers.
- Current source requires a merchant-bound secret for `/webhooks/ghl/forms`, then `formId`, `contactId`, nested `data`, and tenant/contact-validated enrollment context when supplied. No authentication header is configured in the two inspected actions. No actual delivery was made; neither old-host reachability nor the rendered webhook body has been proven.
- `SS - Session Follow-Up` (`bb925125-6f8a-4eb6-9f93-39ca7bda7c85`) is published. Trigger: Session Logged, filter No Show Flag = No. One client email asks for feedback and links to `https://{{custom_values.website_base_url}}/session-feedback`. Subject/body still use contact-level offer name/support/business fields. The underlying Marketplace constant value and rendered link/context need verification; UI label No alone does not prove boolean false compatibility.
- `SS - No-Show Follow-Up` (`bc60e8b5-15e1-4a47-8ec4-96727e276044`) is published. Trigger: Session No-Show, no filters. Actions: client Email, SMS, Internal Notification, Add Tag. Internal Notification is email to Custom email, but its recipient is EMPTY. It uses contact-level program/no-show-count fields and claims email/SMS have been sent without independent delivery evidence. Presence of these actions is not inbox proof.

### Approved Repair Attempt And Remaining Decision

- The current approved form `SYS2-07: Session Feedback`, ID `A91jAYjBV5DPZBQEYzrv`, was inspected in both its builder and public preview without submitting. It contains only required Email and Submit; no session date, attendance, duration, topics, enrollment or feedback questions were present. Do not manufacture an attended outcome from this input.
- `GHL_AUTOMATION_COMPANION.md` section 1E and the app's `handleFormSubmission('SYS2-07')` treat this as a merchant session-delivery log. The live form name and follow-up email instead suggest a client feedback form. Linking feedback straight back to `ss_session_logged` could request feedback again. Philip was asked whether the form should be completed by the client or the coach; no answer was received at this checkpoint.
- Merchant support email was verified from the PMG custom value `merchant_support_email`. The Internal Notification recipient field did not retain either the supported variable-picker selection or the verified email through the browser editor. No test mail was sent. A temporary Particular user selection was discarded without selecting any user; no recipient was broadened to All users.
- One Save action was attempted inside the workflow editor, but the top-level Save Workflow was never clicked. All local edits were then discarded by cancelling the action and reloading. The original Custom email mode, empty recipient and original message were rechecked; Save Workflow was disabled. No repair is claimed.
- Intended merchant alert copy should describe a recorded no-show and direct the merchant to the record. Remove unsupported no-show counts and claims that the client email/SMS were delivered. Event-specific program/date values require verified trigger variables, not a latest-contact-program guess.
- Resume from the confirmed form purpose, not another blind webhook edit. A coach log needs explicit attendance/date/client/enrollment and controlled merchant use; client feedback must remain client-supplied feedback with its own safe intake, not merchant attendance attestation. Reuse approved fields where suitable and verify live mappings before adding fields. Group roster/absence automation remains separate.

### Repair Boundary

The certified Snapshot allowlist explicitly excludes legacy `WF-SYS2` folders/duplicate loggers. Do not simply revive SYS 02-12 or copy these stale workflows into the package. First confirm the approved session form's actual fields and current intake path, then repair only that path under approval. Keep authentication and exact enrollment binding; do not invent attendance or use the contact's latest program. Check whether feedback collection could loop back into a fresh session-follow-up request. Preserve historical records.

Required before declaring this workflow path ready: canonical destination, merchant-secret reference (never literal secrets in notes), explicit attended/no-show outcome, exact client/enrollment data, event-specific follow-up values, a defined merchant-alert destination, and separate approved live submissions/inbox proof. Group-call roster/automatic absentee detection is still separate scope. Code tests remain 219 suites / 1,928 passing; the preflight found configuration blockers, not a failed local test.

## Correctness Fixes: October 1 Follow-Up

Philip approved the bounded correctness fixes. They are implemented in the isolated `codex/attendance-correctness` worktree at `C:/Users/p_kor_e1dk2i3/.codex/worktrees/attendance-correctness/ScaleSafe`, based on main `5aa3b47`. This section supersedes the audit-only status below; the original findings and source research remain historical evidence.

| Finding | Implemented behavior |
| --- | --- |
| Wrong-person Zoom attribution | Native Zoom resolution requires the provider-reported participant email, exact tenant ownership, and event-time enrollment eligibility. A scheduled meeting can narrow only that person's matching enrollments. Old automatic identity bindings are not used to identify native participants. Explicit tenant-scoped enrollment references used by connector tests remain supported. |
| False re-engagement | No-show, scheduled, cancelled, or unknown session/appointment outcomes cannot write Active. Genuine attendance and existing non-session participation paths remain eligible, with the merchant engagement toggle respected. A settings lookup failure cannot enable engagement. |
| Lost Zoom retry | Interval IDs use account, meeting UUID, participant instance and source occurrence time, not delivery-body bytes. Completed but unlinked intervals resume intake; published intervals return a duplicate. Compare-and-set completion and connection-scoped updates protect retries/concurrency/rejoins. Existing unambiguous completed rows retain their original canonical event ID. |
| Lost session enrollment | A supplied session-form enrollment is checked against location AND contact before evidence or triggers, then stored in canonical evidence/defense fields and outgoing context. Missing enrollment remains unassigned; no latest-program guessing. |
| Text false / missing status | Explicit false/true representations are parsed. Missing, unsupported or contradictory attendance remains unconfirmed, with no positive delivery claim or attendance follow-up. Present/attended/showed/completed and no-show statuses are recognized. |
| Conflicting form notifications | Confirmed attendance fires only `ss_session_logged`; confirmed absence fires only `ss_session_noshow`. No-show payload says `reschedule_needed`, not that a message was sent. Cancelled/rescheduled/unknown outcomes fire neither. Existing trigger slots are retained. |

### Verification And Rollout Boundary

- Regression tests are in normal Jest discovery: `tests/unit/attendance-wiring.test.ts`, `zoom-integration.repository.test.ts`, `zoom-integration.service.test.ts`, and `evidence-connector-worker.zoom-resolution.test.ts`.
- Final verification: 219 suites / 1,928 tests passed; focused attendance/adjacent checks: 11 suites / 141 tests passed. Backend typecheck, final production build and diff whitespace check passed.
- No database migration is required. Existing Zoom join/leave uniqueness constraints are reused. No historical evidence, identities, messages or merchant data have been deleted or reassigned.
- No production deployment, live GHL workflow edits, SQL, provider configuration, real emails/SMS, charges, or merchant account access occurred.
- Rollout compatibility check: legacy session forms must explicitly send `no_show: false` or `attendance_status: attended`/`Present` for delivered sessions. Omitted unchecked fields no longer silently prove attendance. Inspect the actual PMG form webhook and session/no-show workflow consumers before rollout.
- Live proof remains required: attendance and absence form submissions, correct enrollment boundaries in timeline/defense output, a non-host Zoom attendee with provider email, leave/rejoin/replay, anonymous guest handling, exact GHL execution and actual approved inbox delivery. A successful local trigger mock is not proof of delivery.
- Dependency audit warnings were reported by the unchanged lockfiles: root 15 (3 moderate, 12 high); UI 3 (1 moderate, 2 high). Dependency remediation is separate; no automatic package upgrades were made.

### Still Separate Work

Shared-link expected-attendee rosters, group attendance reporting, post-meeting participant report reconciliation, and automatic absence detection are NOT implemented by this fix. Email-less Zoom participants remain unresolved, never assigned from a meeting or display name. Existing multi-program offer-selection heuristics are not a substitute for an approved per-call roster.

Also still open: a deduplicated no-show notification bridge from calendar/canonical/legacy ingestion, durable GHL form submission IDs, contact summary/count writers, and consistent cross-source absence counting. Genuine live re-engagement transitions/delivery still need certification; the existing historical-risk model was not replaced. Ambiguous legacy attendance duplicates need reviewed repair, not automatic reassignment. These gaps remain in the original audit and MASTER_INDEX; do not advertise a complete group no-show system yet.

## Original Audit: Bottom Line

ScaleSafe has attendance evidence capture, but not a complete, reliable group-call roll call and no-show notification system. Do not sell those as equivalent. Philip confirmed that the coach uses ONE SHARED ZOOM LINK, not individual bookings. Keep that joining experience where possible. An expected-attendee roster and reliable participant matching are still required to identify absences.

## Scope And Baseline

- Reviewed freshly fetched `origin/main` at `5aa3b475d187db68707f2f744b729082ba3fd02a`.
- Read and ran tests in `C:/Users/p_kor_e1dk2i3/ScaleSafe/.codex-tmp/standalone-payment-release`, whose application code is on that baseline. The original ScaleSafe checkout is older and has unrelated changes; do not deploy it over current main.
- No merchant location was selected or accessed. No live GHL/Zoom configuration, webhook delivery, workflow body, inbox, Railway deployment, or database state was inspected this turn.
- No application implementation, deployment, SQL, message, or money movement occurred. Added local-only audit probes and this record.
- This audit concerns the core ScaleSafe attendance/evidence paths, not the separately developed Client Evidence application.

## Current Paths

| Input | What the app actually does | Missing proof or behavior |
| --- | --- | --- |
| GHL appointment create/update/delete | Normalizes status; stores a scheduling record and appointment evidence; uses calendar/program matching where available. | Does not fire `ss_session_noshow` from this path. A recorded booking is not proof the person attended. |
| Session delivery form (`SYS2-07`) | Writes a session and fires `ss_session_logged`; also fires `ss_session_noshow` for truthy no-show input. | Boolean handling, enrollment retention, and contradictory notification risks below. |
| Zoom signed join/leave | Uses a credential-bound location, excludes the known host, stores join/leave times and duration; sends `session.attended` through connector resolution. | No expected-roster comparison, end-of-meeting absentee calculation, or report reconciliation. Identity and retry defects below. |
| Canonical external `session.no_show` | Materializes attendance evidence through the connector worker. | Does not fire the dedicated no-show workflow. |
| Legacy external no-show | Writes attendance evidence. | Does not fire the dedicated no-show workflow. |
| Disengagement assessment | Counts consecutive `attendance` rows and can flag at-risk contacts. | Calendar no-shows use appointment rows; session forms use session rows. Those are not the same inputs as the attendance-only count. |
| Client Evidence tab | Filters an individual client's timeline by session, attendance, appointment, or external session. | No group-call expected-versus-attended report found in the reviewed UI/routes. |

The certified Snapshot allowlist includes `SS - No-Show Follow-Up` and `SS - Session Follow-Up`. Their presence in a package does not establish current merchant notification settings, execution, or inbox delivery. A native GHL Appointment Status workflow could independently notify users, but this audit did not inspect a live one.

## Reproduced Findings

References below are relative to the release worktree above, not the older root checkout.

1. **P1: Zoom can attach a different participant to the sole scheduled client.** In `src/services/evidence-connector-worker.ts`, `resolveUnmappedZoomSubject` returns the one scheduled enrollment BEFORE comparing participant identity. A fixture with Alice's sole booking and Bob's explicit email resolves to Alice. A meeting link/time identifies a call, not a person. Require verified participant identity; never learn an identity binding from this shortcut.
2. **P1: No-show evidence can falsely mark a client re-engaged.** `src/services/evidence.service.ts`, `logEvidence`, tests only the evidence category, not attendance outcome. Given an at-risk record and engagement enabled, an appointment with `appointment_status: no_show` sets the GHL engagement field to Active. This can activate welcome-back automation. Require affirmative participation and a genuine transition; scheduled/cancelled/no-show events are not participation.
3. **P1: A temporary Zoom intake failure can strand attendance.** `src/services/zoom-integration.service.ts` marks attendance completed before canonical intake succeeds. Retry only looks for joined rows via `src/repositories/zoom-integration.repository.ts`; the existing completed row is then treated as a missing join. Reproduced a failed first intake followed by retry returning `leave_without_join` instead of publishing evidence. Use durable event identity and a recoverable intake/publish state, including replay after failures at every boundary.
4. **P2: Session forms discard supplied enrollment identity.** The webhook controller forwards enrollment ID, but the session mapper omits it from the typed evidence/defense fields. The original ID survives only inside raw payload. Verify location/contact/enrollment ownership, then persist the validated ID in the canonical columns and payloads.
5. **P2: Text false becomes a no-show.** `d.no_show` uses JavaScript truthiness; a form value of `"false"` becomes absent. Parse supported boolean representations explicitly and validate unknown values. Missing/unrecognized status must not fabricate positive attendance either.
6. **P2: No-show forms emit both session and no-show triggers.** Reproduced both `ss_session_logged` and `ss_session_noshow`. This is a confirmed dual-dispatch behavior and a notification hazard, not proof that a particular live client received both messages. Existing live filters must be checked before deciding whether to stop session dispatch or make all session consumers explicitly outcome-aware.

## Additional Source Findings

- Session form deduplication in `src/controllers/webhook.controller.ts` uses `Date.now()` in its event ID; a delivery retry can create a new ID. Replace with a stable provider submission identity or a documented bounded fallback, without merging genuinely separate visits.
- Form no-show payload claims `follow_up_action: auto_reschedule_sent` before any delivery proof. Record requested, accepted, sent, and received separately; do not represent a requested action as delivered evidence.
- The registry creates `ss_no_show_count`, `ss_last_session_duration`, and `ss_last_session_topic`, but no dedicated runtime writes to those fields were found in the reviewed source. Existing workflow docs already note missing no-show writer proof. Use event-specific scalar payload values, with contact summaries only as a secondary display layer.
- Calendar/form/Zoom events have separate storage shapes. Counting only attendance rows misses some actual no-shows, while repeated join intervals or duplicate form submissions can inflate totals if combined naively.
- Zoom currently handles joined/left events only. The Zoom client lists meetings but does not fetch final participant reports/registrations for attendance reconciliation. There is no absence-detection job in this path.
- Known-host exclusion exists, but assistant/co-host/guest behavior still requires explicit coverage. A lack of recognized attendance must not be turned into a proven absence when unidentified guests or missing events remain.

## Provider Facts

- HighLevel emits appointment status and contact/calendar identifiers in appointment webhooks. Its Appointment Status trigger supports showed/no-show outcomes and internal or client follow-up workflows. These are status changes, not an automatic Zoom presence detector. [Appointment webhook](https://marketplace.gohighlevel.com/docs/2023-02-21/webhook/AppointmentUpdate/index.html), [workflow trigger](https://help.gohighlevel.com/support/solutions/articles/155000002619).
- HighLevel class bookings support per-attendee status changes; a class is not one shared attendance outcome for everyone. [Class attendee controls](https://help.gohighlevel.com/support/solutions/articles/155000007952-unified-appointment-screen-in-the-highlevel-mobile-app).
- Zoom join/leave events provide participant/meeting identifiers and times, but external or unsigned-in participant email can be absent. Do not match by display name alone. [Zoom event documentation](https://developers.zoom.us/docs/api/meetings/events/).
- Zoom's participant-report API supports post-meeting reconciliation; its documented requirements include a Pro-or-higher plan and reporting scope. Pagination and rejoin intervals must be handled. Verify actual merchant permissions before making this a prerequisite; absence of report access must remain visible. [Meeting API and report requirements](https://developers.zoom.us/docs/api/meetings/).

## Recommended Build Order

### 1. Correct Existing Behavior

Fix findings 1-5 first. Resolve finding 6 against the actual workflow consumers. Add stable deduplication, preserve source timestamps/enrollment ownership, and connect confirmed no-shows from each supported path to one outcome-aware notification service. Reuse current trigger slots; do not add a new slot or send duplicate native-GHL and ScaleSafe notifications for the same outcome. Add immutable notification/evidence links and use actual outbound status, not predicted delivery language.

### 2. Add Shared-Link Group Attendance

Keep one Zoom link. Let a merchant select the program/cohort and the clients expected for its calls. Snapshot that roster per meeting occurrence so later enrollment/cancellation changes cannot rewrite past attendance. Do not assume every active program client owes attendance at every optional call.

Resolve each participant against that roster using trustworthy email or a previously verified provider/registrant identity. Retain unresolved participant rows for a small coach review step when needed. A shared link does not guarantee identifiable attendees; explain that limit plainly. Optional individual registration/authenticated joining can improve identity, but is a separate merchant choice, not a silently imposed change.

Use meeting occurrence UUID, client, enrollment, and provider connection in uniqueness rules. Merge reconnect intervals for one person's total presence without double-counting overlaps/devices. Track partial attendance separately from complete attendance; brief presence alone must not prove the whole service was delivered.

Finalize absences only after the call ends, event/report reconciliation is complete, and unresolved identities or provider outages cannot explain missing attendance. For unknown cases say Unconfirmed, not No-show. Coach-confirmed corrections need an audit trail and must not resend old notifications.

### 3. Report, Notify, And Certify

- Meeting report: date, program, facilitator, expected clients, attended, partial, confirmed no-show, excused/cancelled, and unconfirmed.
- Participant drilldown: identity-match basis, join/leave intervals, total duration, enrollment, source IDs, and evidence link. Filters for date/program/client/outcome; export with tenant-scoped authorization.
- Merchant digest or alert plus appropriate client follow-up, configured separately. Notify once per confirmed outcome, not on each join/leave or replay. Preserve the exact rendered message, recipient, and available delivery result as communication evidence.
- Live proof after fixes: approved test location and inboxes; one identified attendee, one known absentee, a reconnect, an unidentified guest, overlapping programs, and two tenants. Verify timeline and defense packet retain exact program boundaries and never call a no-show delivered service.

## Local Verification

Existing focused suite: 8 suites / 72 tests passed (Zoom service, Zoom resolution, GHL activity/fulfillment, evidence service, disengagement, defense ordering, connector worker).

New audit-only desired-behavior probes: 7 cases, 6 reproduce gaps, 1 normal-session control passes. These deliberately fail until the fixes exist; they are NOT passing acceptance tests and are excluded from ordinary `*.test.ts` discovery. No live providers are called. Files:

- `tests/audits/attendance-wiring.audit.ts`
- `tests/audits/zoom-attendance-retry.audit.ts`
- `tests/audits/zoom-subject.audit.ts`

Run from the release worktree:

```powershell
npm.cmd test -- --runInBand --testMatch **/tests/audits/*.audit.ts
```

The audit initially had a missing test mock for worker timeout configuration; that harness error was corrected. The remaining failures are the six behavior assertions described above. The default suite was not modified. A full production build, live meeting, live workflow body inspection, and email/SMS delivery test were not performed.

## Next Checkpoint

Implement the bounded correctness fixes first, then certify them with an approved account. Group-call roster/reporting is an additional feature, not something already available. Philip's shared-link answer resolves the joining pattern; confirm whether attendance is required for all program members or only selected/registered attendees before automatic absentee messages are enabled.
