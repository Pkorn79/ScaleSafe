# ScaleSafe Audit Test Handoff

**Captured:** 2026-07-31
**Purpose:** Preserve skill-test evidence in the strategy worktree and provide a ready-to-paste
verification prompt for a separate task running against the ScaleSafe main branch.

## Scope Boundary

This document does not establish that ScaleSafe has a software defect. The initial audit had
limited HighLevel access. A follow-up pass inspected fictional demo opportunities, but neither pass
had visibility into workflow configuration, workflow history, ScaleSafe app state, merchant
configuration, offers, or processor state.

Do not troubleshoot or change ScaleSafe product code in this skill-and-strategy worktree. Use the
prompt below in a separate main-branch task. Start with verification only and do not implement a fix
until the user reviews the findings.

## Test Context

The operator reported that it could inspect:

- HighLevel account settings.
- The pipeline list.
- Approximately 130 custom fields.

It could not inspect:

- Contacts or opportunities because both operations returned `no approval received`.
- Workflows, triggers, or execution history because the connector exposed no workflow tools.
- ScaleSafe installation, provisioning, merchant configuration, offers, processor state, or other
  ScaleSafe application surfaces.

These are connector or approval limitations until proven otherwise. They are not product findings.

## Follow-Up Audit Pass

The operator later received approval for record reads and reported:

- Exactly three fictional opportunities in `DEMO - Sales`: `Avery NoShow`, `Jordan Follow-up`, and
  `Casey Sold`.
- The records used `@example.com` addresses and had DND enabled. No real customer record was
  opened.
- Searching contacts for `DEMO` returned zero results. This establishes only that the string was not
  found by that contact search; it does not prove that demo contacts are absent.
- `Casey Sold` had values for enrollment status, evidence score, and last evidence date. This proves
  those fields were populated on that record. Without workflow history or application evidence, it
  does not prove whether a workflow, ScaleSafe code, setup fixture, or manual action wrote them.
- Browser control was unavailable, and the connector still exposed no workflow tools. Workflows,
  triggers, execution history, ScaleSafe installation and provisioning, merchant configuration,
  offers, and processor mode remained uninspected.

The owner later clarified that the three fictional opportunities were probably created during
ScaleSafe testing. Treat them as likely test artifacts. Their presence and populated fields do not
establish that a current production workflow ran, that the present automation is correct, or that a
product defect exists. The exact creator and write path remain unverified.

The follow-up response correctly relabeled the work as a **partial audit** and withdrew or narrowed
the initial conclusions:

- The named date fields are confirmed as HighLevel `TEXT` fields. The claim that timing logic is
  therefore broken was withdrawn. The observed ISO-8601 value is compatible with machine output,
  but the writer and intended comparison behavior remain unverified.
- The two field pairs exist, but the claim that they are accidental duplicates remains unverified.
  The pair names, creation timing, or empty values do not establish their contracts.
- The absence of a post-sale pipeline is not a demonstrated defect. The observed post-sale fields
  are consistent with fulfillment state being held outside a HighLevel pipeline, but the canonical
  product design still must be checked in the repository.
- The proposed tag-triggered workflow was withdrawn. No workflow should be recommended until the
  existing workflow inventory and trigger semantics are inspected.

## Reported Hypotheses

Treat each item below as an observation to verify, not a conclusion.

### Field types

The auditor reported the following HighLevel custom fields as text fields rather than date fields:

- `SS Next Payment Date`
- `SS Last Payment Date`
- `SS Pulse Due Date`
- `SS Payment Grace Period End`
- `SS TC Accepted Date`
- `SS Last Milestone Date`
- `SS Refund Date`

It then concluded that HighLevel timing logic could not reliably compare those values with the
current date. That conclusion was not verified against current product code, current HighLevel
behavior, workflow configuration, or an execution test.

### Possible duplicate fields

The auditor observed both names in each pair:

- `Offer Num Payments` and `Offer Number of Payments`
- `SS Defense Packet URL` and `SS Defense PDF URL`

The audit did not establish whether these are accidental duplicates, historical aliases,
backward-compatibility fields, demo artifacts, or fields with different intended contracts.

### Pipeline design

The auditor found one pipeline named `DEMO - Sales` with five stages ending at `Closed Won`. It
concluded that a post-sale fulfillment pipeline was missing. The audit did not establish that
ScaleSafe is designed to represent fulfillment through a HighLevel pipeline; the current product
may instead use enrollment, milestone, pulse, evidence, or internal application state.

### Proposed workflow

The auditor proposed `DEMO - Milestone Sign-Off Evidence Capture`, triggered by a
`DEMO - milestone-signoff` tag. It suggested writing milestone name, sign-off date, work summary,
and evidence score while remaining in Draft with no sends or money movement.

This is a provisional idea only. The auditor had not inspected existing workflows, ScaleSafe app
state, the current evidence contract, or the product's canonical field mappings.

## Skill-Test Findings

Preserve these for the next skill revision review:

1. The response began with `Audit done` even though major required surfaces were uninspected. It
   should have called the result a **partial audit**.
2. It converted field metadata into a definitive platform-behavior claim without verifying current
   HighLevel behavior or an actual workflow execution.
3. It described same-purpose-looking fields as broken duplicates without checking aliases,
   migration history, field keys, or which fields current code reads and writes.
4. It treated the absence of a post-sale pipeline as a product gap without first confirming the
   product's intended state model.
5. It recommended a workflow despite having no workflow inventory and no ScaleSafe app visibility.
   Any recommendation under that scope should be labeled provisional and conditional.
6. `No approval received` should be reported as an approval/tooling limitation, not blended into
   the product audit.

The follow-up pass shows that findings 1 through 6 were corrected appropriately. Preserve these
additional observations for skill evaluation:

7. Populated fields prove state, not the mechanism that produced it. Do not describe a workflow or
   post-sale path as exercised without execution history or equivalent evidence.
8. A contact search returning zero results for `DEMO` is search evidence only; it should not be
   generalized into an inventory claim.
9. Refusing to recommend a new workflow without an existing workflow inventory was the correct
   behavior.
10. When a required browser surface is unavailable, the operator should end with a concise,
    transferable inspection checklist instead of repeatedly asking the owner to unblock the same
    session.

Do not patch the skill from this single run yet. Accumulate additional test results, then revise the
audit confidence and reporting rules as one coherent change.

## Ready-To-Paste Main-Branch Prompt

```text
You are working in the canonical ScaleSafe repository on the main branch, not in the
HighLevel/ScaleSafe skill-development worktree.

This is a verification task first. Do not change product code, migrations, HighLevel assets,
custom fields, pipelines, workflows, or live/test account data until I review your findings and
explicitly approve implementation.

Context

A limited read-only HighLevel MCP audit of the ScaleSafe test sub-account inspected account
settings, the pipeline list, roughly 130 custom fields, and three fictional opportunities in the
`DEMO - Sales` pipeline. The connector exposed no workflow tools, and the session had no browser
control, so it could not inspect ScaleSafe app installation, merchant configuration, offers,
processor state, workflows, triggers, or execution history.

One fictional sold opportunity had enrollment status, evidence score, and last evidence date
populated. Treat this only as proof that those fields held values. Do not infer which code,
workflow, fixture, or manual action wrote them without further evidence. The owner believes all
three opportunities were probably created during ScaleSafe testing, so evaluate them as likely test
artifacts rather than production behavior.

The audit produced four hypotheses. Do not accept them as true without evidence from the current
main branch and, where necessary, the current test account.

Hypothesis 1: These HighLevel fields were confirmed as text fields. The auditor withdrew the claim
that this alone means timing logic is broken. Verify their intended contract and actual usage:
- SS Next Payment Date
- SS Last Payment Date
- SS Pulse Due Date
- SS Payment Grace Period End
- SS TC Accepted Date
- SS Last Milestone Date
- SS Refund Date

Hypothesis 2: These field pairs both exist, but whether either pair is duplicated, superseded, or
intentionally distinct remains unverified:
- Offer Num Payments / Offer Number of Payments
- SS Defense Packet URL / SS Defense PDF URL

Hypothesis 3: The observed sales pipeline ends at Closed Won. The auditor withdrew the claim that a
post-sale fulfillment pipeline is required; verify the intended state model.

Hypothesis 4: The auditor withdrew its proposed DEMO - Milestone Sign-Off Evidence Capture workflow
after recognizing that it had no workflow inventory and that the proposed tag trigger has first-add
semantics. Evaluate the idea only after verifying the existing automation; do not build it.

Verification work

1. Confirm that this task is on the current main branch and identify the exact commit being
   inspected.
2. Locate the canonical HighLevel field definitions, keys, types, setup/provisioning code,
   migrations, snapshots, compatibility aliases, and tests in the current repository.
3. For every named date field, report:
   - canonical key and intended HighLevel type;
   - where it is created or reconciled;
   - every current read and write path;
   - whether the observed test-account type could be a legacy artifact;
   - whether any current workflow actually performs date comparison against it.
4. For each possible duplicate pair, determine whether it is:
   - an accidental duplicate;
   - a renamed or deprecated field;
   - a compatibility alias;
   - a demo/test artifact; or
   - two fields with distinct contracts.
   Show which keys current code reads and writes. Do not recommend deletion until usage and
   migration consequences are proven.
5. Verify the intended post-sale state model. Determine whether ScaleSafe is designed to use a
   HighLevel fulfillment pipeline or whether enrollment, milestones, pulse checks, evidence, and
   defense readiness live in ScaleSafe application state. Do not call the missing pipeline a defect
   unless current product requirements require one.
6. Inspect current workflow/snapshot/setup expectations in code. Treat the connector's lack of
   workflow tools as a connector limitation, not evidence that workflows are absent.
7. Evaluate the proposed DEMO - Milestone Sign-Off Evidence Capture workflow against the current
   data model and existing automation. State whether it is useful, redundant, or incompatible. Do
   not build it.
8. If live test-account inspection is necessary, list the exact read-only checks required and wait
   for approval before accessing it. Do not mutate the account.

Report format

Lead with findings ordered by severity and include file-and-line references. Classify every item as
one of:
- confirmed current defect;
- legacy account artifact;
- expected design;
- connector/approval limitation; or
- still unverified.

Then provide:
- the evidence supporting each classification;
- open questions;
- the smallest remediation plan for confirmed defects only;
- tests required before any implementation.

Do not implement fixes in this task unless I explicitly approve them after reviewing the report.
```

## Raw Audit Response

The original response is retained below for comparison during main-branch verification and skill
evaluation.

> Audit done on ScaleSafe. Read-only. Nothing was changed.
>
> What I could read: account settings, the pipeline list, and all 130-odd custom fields.
>
> What I could not: contacts and opportunities both came back "no approval received," so I have no
> read on actual records. And this connector's tool set has no workflow tools at all, so workflows,
> triggers, and execution history are completely uninspected. I also cannot see ScaleSafe app install
> state, merchant config, offers, or processor status through it. Those are unverified, not clean.
>
> The three findings that matter
>
> 1. Your date fields are text, not dates.
> Every field that drives timing is stored as plain text: SS Next Payment Date, SS Last Payment Date,
> SS Pulse Due Date, SS Payment Grace Period End, SS TC Accepted Date, SS Last Milestone Date, SS
> Refund Date. HighLevel cannot compare text to today's date. That means dunning windows, grace
> period expiry, and pulse cadence cannot branch or wait on those values reliably. This is
> structural. Everything timing-based sits on top of it.
>
> 2. Duplicate fields are already in the account.
> Offer Num Payments and Offer Number of Payments both exist. SS Defense Packet URL and SS Defense
> PDF URL both exist. Duplicates are the classic quiet cause of broken branches and wrong reports,
> because half your automation writes to one and half reads the other. Worth resolving before
> anything is built on them.
>
> 3. The pipeline ends at the sale.
> One pipeline exists, DEMO - Sales, with five stages ending at Closed Won. All the field scaffolding
> for the sold-client path is there - enrollment, consent, milestones, pulse, evidence, defense. But
> there is no pipeline to hold a client after they buy. Nowhere to see fulfillment state at a glance,
> and no stage changes to trigger from.
>
> The one DEMO workflow I recommend
>
> DEMO - Milestone Sign-Off Evidence Capture.
>
> Entry on a DEMO - milestone-signoff tag being added. Writes the milestone name, the sign-off date,
> the work summary, and bumps the evidence score. No sends. No money. No real people.
>
> Why this one first: it is the smallest piece of your actual product value, and a tag trigger means
> the whole thing proves out with HighLevel's native test on a fictional contact. It stays in Draft.
> Nothing gets published. It will also show you in practice whether the text date field is workable
> or whether finding 1 has to be fixed first.
>
> If you want it, the next step is a written blueprint for your approval, then a build in Draft. I
> have not built anything.
>
> Two things you can unblock when ready: approve the record reads so I can finish the contact and
> opportunity side, and tell me whether you want workflow inspection, which needs supervised browser
> access since this connector cannot do it.

## Raw Follow-Up Audit Response

The follow-up response is retained below for comparison during main-branch verification and skill
evaluation.

> Partial audit - ScaleSafe
>
> Not every required surface was inspected. Inspection only. Nothing created, edited, or sent.
>
> Verified this pass
>
> Record reads went through. The DEMO - pipeline holds exactly three fictional opportunities (Avery
> NoShow, Jordan Follow-up, Casey Sold), all @example.com, all created 30 July, all DND-enabled. A
> contact search for "DEMO" returns zero, so the demo naming lives on opportunities, not contacts. No
> real customer records were opened.
>
> Casey Sold carries three written values: enrollment status enrolled, evidence score 10, and last
> evidence date 2026-07-30T03:35:38.6584+00:00. Written roughly 16 minutes after creation. Avery
> NoShow has nothing written. So something exercised a post-sale path once, on one record.
>
> Still blocked
>
> No browser tool is available to me in this session, so none of your item 2 was inspected.
> Workflows, triggers, execution history, ScaleSafe install and provisioning, merchant config,
> offers, and processor test/live state are all uninspected. This connector also exposes no workflow
> tools at all. There is no workflow inventory, and I could not build one.
>
> Previous findings, re-examined
>
> 1. Date fields stored as text - half supported. The types and keys are confirmed directly:
> ss_next_payment_date, ss_pulse_due_date, ss_payment_grace_period_end, ss_last_evidence_date and the
> rest are dataType: TEXT. My conclusion that timing logic is broken is not supported. The evidence
> leans the other way. The timestamp written to Casey Sold is full ISO-8601 with microseconds and
> offset, which is machine-written, consistent with ScaleSafe doing its own date math and using
> these fields as a display sink. Without workflow logic I cannot say HighLevel ever compares them.
> Withdrawn as a finding.
>
> 2. Two duplicate pairs - unverified, and I overstated it. offer_num_payments and
> offer_number_of_payments were both created in the same automated batch seconds apart, same parent
> group, same type. That pattern fits two spec sources, not a rename. ss_defense_packet_url and
> ss_defense_pdf_url look like different purposes: the PDF field carries the placeholder
> "Auto-populated by S11 Defense Compiler," the packet field carries none. Neither pair is populated
> on any demo record. Which one the app writes is answerable only from the repo, not from here. No
> deletion recommended.
>
> 3. No post-sale pipeline - contradicted. Casey Sold holds enrollment status and evidence score
> with no pipeline stage backing them. That points to fulfillment state living in ScaleSafe and its
> contact fields, not in a HighLevel pipeline. Your primer also notes pipelines cannot be created via
> API and arrive by Snapshot. The authoritative answer sits in GHL_AUTOMATION_COMPANION.md in the
> repo, which I cannot read.
>
> Recommendation
>
> None. No responsible DEMO workflow recommendation can be made without a workflow inventory. My
> earlier tag-trigger idea was also unsound: your own primer notes the Contact Tag Added trigger
> fires only on first add.
>
> To proceed, I need workflow visibility or that companion doc.

## Cowork Browser-Control Test

**Captured:** 2026-08-01

The owner continued the audit in Cowork. The HighLevel MCP connection named `GHL - ScaleSafe`
resolved to the intended ScaleSafe sub-account, but the Claude-in-Chrome tools were not loaded for
the conversation. The extension was installed in Brave rather than Google Chrome.

Environment findings:

- Anthropic documents Claude in Chrome as supported only in Google Chrome, not other
  Chromium-based browsers. Brave is therefore not a supported fallback.
- Claude in Chrome is a browser connector distinct from Cowork computer use. The owner wants
  browser-only access and does not authorize full desktop control or control of the LeadConnector
  desktop application.
- The connector must be enabled in Claude Desktop settings and separately enabled for the specific
  Cowork conversation. If it is not loaded, the operator must state that exact problem and must not
  substitute desktop control.

Skill-test findings from this run:

11. Two HighLevel connections were enabled. Before confirming tool binding, the operator called the
    connection named `Highlevel`, read a WholePay workflow list, then discarded it. Discarding the
    result does not undo the cross-tenant read. The operator must select and verify `GHL - ScaleSafe`
    before every account read and must not call the WholePay connection during a ScaleSafe task.
12. The operator described the 130-field set as a complete ScaleSafe installation without comparing
    it with an authoritative manifest or inspecting application provisioning. Field count and names
    alone do not prove completeness.
13. It again called `offer_num_payments` and `offer_number_of_payments` a confirmed duplicate pair.
    Their coexistence and shared type prove neither duplicate behavior nor a broken branch.
14. It recommended a no-show recovery workflow despite having no workflow inventory. This repeats
    the earlier recommendation error and violates the instruction to recommend only after inspecting
    existing automation.
15. When browser control failed, it repeatedly proposed full control of the LeadConnector desktop
    application. That exceeded the owner's browser-only access preference. The correct response is
    to repair or enable Claude in Chrome, or stop with a precise connector-status message.
16. The operator should never infer that a generic connector and a specifically named connector are
    interchangeable when they resolve to different sub-accounts. Connector selection is part of
    tenant confirmation, not a convenience choice.

Preserve this run for the next coherent skill revision. Do not treat any Cowork claim above as a
ScaleSafe product defect, and do not troubleshoot product code in this worktree.

## Cowork Chrome-Reconnect Follow-Up

**Captured:** 2026-08-01

After the owner installed and connected the extension in Google Chrome, the Cowork operator claimed
that Brave and Chrome were equivalent, instructed the owner to run `/chrome`, and again offered full
LeadConnector desktop control. The owner ran `/chrome` in Cowork and received `invalid or unknown
skill`.

Official-source resolution:

- Anthropic documents Claude in Chrome as unsupported in Brave and other Chromium-based browsers.
- `/chrome` is a Claude Code CLI/VS Code command. It is not the documented Cowork reconnection path.
- In Claude Desktop and Cowork, Claude in Chrome is configured under **Settings > Connectors** and
  must be enabled for the specific conversation. If it fails to connect, Anthropic recommends
  updating or restarting the extension and Claude Desktop, checking the connector toggle, and then
  starting the task again if necessary.
- Claude in Chrome is distinct from Cowork computer control. The owner's browser-only boundary still
  prohibits substituting LeadConnector or broader desktop access.

Confirmed local cause: the owner later found that Claude in Chrome was turned off. This explains why
the Cowork conversation had no browser tools. It does not explain or excuse the separate
cross-tenant read, unsupported audit conclusions, incorrect Brave compatibility claim, `/chrome`
instruction, or repeated requests for broader desktop access.

Additional skill-test findings:

17. Surface-specific setup commands must never be transferred between Claude Code, Cowork, and
    Claude Chat without checking the documented surface. `/chrome` is valid in Claude Code but not a
    Cowork instruction.
18. Do not contradict current official compatibility documentation from remembered behavior. Brave
    accepting a Chrome extension does not make it a supported Claude-in-Chrome host.
19. Do not claim that a connector cannot be added to an existing Cowork conversation unless the
    current interface proves that limitation. The documented action is to enable the connector for
    that conversation.
20. Once the owner declines computer control, do not continue presenting full desktop or
    LeadConnector access as a fallback.

## Cowork Browser Audit With Chrome Enabled

**Captured:** 2026-08-01

With Claude in Chrome enabled, the Cowork operator completed a read-only workflow-list inventory and
inspected several ScaleSafe screens in the intended ScaleSafe sub-account. No mutation was reported.

Observed account evidence to re-check from the main branch, without treating it as a defect:

- 39 workflow entries were listed: 30 in the ScaleSafe folder, 8 evidence-form workflows under
  WF-SYS2, and 1 at root. Four were shown as Draft, including `DEMO - Lead to Enrollment Branches`.
- The demo workflow was shown with an Opportunity Changed trigger and No-show, Follow-up,
  Sold - ScaleSafe, and Other branches, each ending without actions.
- The ScaleSafe app was shown Active with two active offers and Stripe shown Connected. NMI and Whop
  were shown Not Connected.
- The payment and evidence screens displayed two payment records totaling $45.63, 14 evidence
  records, and a $1 dispute-labeled record. Test versus live mode was not verified.

Additional skill-test findings:

21. The operator called the payment records "real charges" and said "live money has moved" while
    separately admitting that test versus live mode was unverified. A ledger row, dispute label,
    processor connection, or risk score does not establish environment or real-money status.
22. The operator called a branch "tested-clean at 0 enrollments." Zero enrollments proves no active
    enrollment, not that a trigger, branch, action, or stop condition was tested successfully.
23. "Full workflow inventory" overstated a list-level inspection. Names, folders, statuses, and
    counts were captured, but logic and execution history for most workflows remained uninspected.
24. Recommending only the No-show branch did not satisfy the requested first DEMO workflow spanning
    lead capture, booking, call outcomes, and ScaleSafe enrollment. No-show is a reasonable first
    build slice of `DEMO - Lead to Enrollment Branches`; the complete workflow remains the
    recommendation, with payment execution blocked until environment mode is verified.

These findings belong to operator-skill evaluation and main-branch verification. Do not troubleshoot
or change ScaleSafe product code in this worktree based on them.
