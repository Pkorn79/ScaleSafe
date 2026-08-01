# Building and verifying funnels and workflows

## Contents

- Order of construction
- Custom fields and tags
- Pipelines and opportunity stages
- Calendars, reminders, and appointment outcomes
- Short lead forms
- Focused funnel pages
- Workflow logic
- Consent, opt-outs, and stop conditions
- Execution history
- Responsive and mobile inspection
- Design-tool iteration
- Native assets before custom code

## Order of construction

Build the data structures before the things that write to them, and the messaging last.

1. Custom fields and tags the workflow depends on.
2. Pipeline and stages, if the workflow moves opportunities.
3. Calendar, if the workflow books.
4. Form, so there is something to submit.
5. Funnel page hosting the form.
6. Workflow, created inactive.
7. Test with fictional records — `DEMO - ` prefix, `example.com` addresses, visible demo tag where
   supported — following the test sequence in `SKILL.md`: save as Draft, run native Test Workflow,
   use Test Action where offered and approve its real API call, and reach for limited publication
   only for the true entry trigger, real timing, inbox delivery, or duplicate sends. Restore the
   agreed final state afterwards and verify it. Production activation is a separate approval after
   that.

Where the workflow reaches a sale, the sold-client steps continue from Closed Won in the same
conversation; see `references/sold-client-path.md`. Build and prove the lead-to-booking path first,
because a sold-client run on an unproven path just moves the defect downstream.

Building the workflow first means every branch references fields that do not exist yet, and
HighLevel will happily let you save a workflow pointing at nothing.

## Custom fields and tags

Inventory existing fields and tags before creating any. Duplicate fields with near-identical names
are the most common quiet defect in an inherited account: forms write to one, workflows read the
other, and the branch never fires.

Reuse what exists. Match the account's existing naming convention rather than introducing yours.
Create the minimum the blueprint requires, and get approval for the enumerated set.

Tags are workflow control surface as well as labels. Decide deliberately whether a tag means
"this happened once" or "this is true now", because a tag used for both cannot do either job. Note
that some tag-based triggers fire only on first application, so a tag that gets removed and
re-added may not re-trigger — verify the behaviour rather than assuming a re-entry works.

## Pipelines and opportunity stages

Confirm whether a suitable pipeline already exists before proposing a new one. Owners often have
one they abandoned, and reviving it beats running two.

Stages should map to decisions a human actually makes, not to internal automation states. If a
stage exists only so a workflow can detect it, prefer a tag or field.

Pipeline creation may not be available through the MCP; it is commonly an interface or snapshot
operation. Check at runtime and route accordingly rather than reporting failure.

Never move, edit, or bulk-reassign production opportunities as a side effect of a build. Use
`DEMO - ` prefixed fictional opportunities for every test.

Where a sale continues into the sold-client process, the stage that represents the closed sale
matters more than the others: it is what the enrollment gets verified against. Keep it unambiguous,
and avoid two stages that both arguably mean sold.

## Calendars, reminders, and appointment outcomes

Confirm timezone on the calendar as well as the sub-account — a mismatch produces bookings that
appear at the wrong hour to one party only.

Set availability, buffer, and minimum notice from what the owner actually wants, and have them
confirm by viewing the live booking view themselves. Owners catch availability mistakes instantly
that are invisible in settings.

Confirmations and reminders are communications. Decide channel per step, keep SMS conditional on
A2P and consent, and state the cost of the reminder pattern before activating.

Distinguish clearly, in the workflow and in reporting: booked, confirmed, attended, no-show, and
cancelled. A booked appointment is engagement, not a completed meeting, and treating booked as
attended is what produces "attended" follow-up to people who never showed.

**Decide explicitly how the outcome gets recorded**, and write it into the blueprint. This is the
most common place a well-built workflow silently never fires: the branches exist, and nothing ever
sets the value they test. The realistic options are an appointment status the owner changes on the
calendar, a manual tag, a short internal outcome form, or a pipeline stage move. Each needs the
owner to actually do something after every call, so pick the one they will really do — a solo owner
who must remember to open a form after each call will not — and confirm the workflow's branch reads
the same field that mechanism writes.

Test it by setting the outcome the way the owner will set it rather than by editing the field
directly — and be precise about which you actually did. Native Test Workflow exercises the branch
against the field's value; it does not exercise the owner remembering to move the card after a call.
Proving the field logic and proving the habit are different claims, and only the second tells you
whether this still works in three weeks.

## Short lead forms

Ask only for what the blueprint's actions require. Every extra field costs completions, and a
field nobody reads costs completions for nothing.

Include the consent language the owner's channels require, worded so it is truthful about what
will be sent and by which channels.

Map each field explicitly to its contact field or custom field and verify the mapping by
submitting a fictional entry and reading the resulting contact record — not by reading the form
builder back to yourself.

Where hidden fields carry values from URL parameters, the key must match the parameter exactly,
including case. This is a frequent silent failure: the form saves, the value is empty.

## Focused funnel pages

One page, one action. A lead page competing with navigation, testimonials, and a newsletter signup
converts worse than a page asking for one thing.

Reuse the account's existing branding, fonts, and colours. Confirm the page's domain or subdomain
is one the owner intends to use, and never repoint a domain serving live traffic to test a page.

Keep pages unpublished until the owner approves publishing as its own action.

## Workflow logic

Create the workflow as a Draft. Prove as much as possible there — native Test Workflow with a
fictional contact covers branch logic, field mapping, and action configuration without publishing
anything.

Publish only for proof Draft testing cannot give you: the real entry trigger firing, actual timing,
inbox delivery, duplicate sends. That is a separate approval with the exposure stated, and it is
followed by restoring the agreed final state and verifying it. Production activation is a further,
separate approval after certification. The full sequence is in `SKILL.md`.

Define, matching the blueprint: the trigger and which contacts are eligible; exclusions and
whether a contact can re-enter; the actions in order with their delays; the branches and the
condition each one tests; the stop conditions; and the human decision points.

Prefer few branches. Every branch is a path someone will travel that you did not test.

Delays interact with send windows: a workflow can hold an action until an allowed sending hour,
so a "5 minute" delay may deliver much later. Verify actual timing in execution history rather
than trusting the configured delay.

Re-entry deserves an explicit decision. A workflow that a contact can re-enter freely will
eventually message a customer as though they were a new lead.

## Consent, opt-outs, and stop conditions

Every messaging workflow needs stop conditions defined before it is activated. At minimum, stop
on: replied, booked, paid or became a customer, asked to stop, and unsubscribed or opted out.

Honour opt-outs across all workflows, not just the one that received it. Verify that an opt-out on
a fictional contact actually halts a second workflow that contact is enrolled in — this is the
test owners most often skip and most often need.

SMS steps stay conditional on A2P approval, active consent, and a funded wallet. If any of the
three is missing, the step stays off and the email path carries the workflow. Say this to the
owner explicitly so a half-live workflow is never a surprise.

Never message a contact who lacks a lawful basis for that channel, even when the owner asks.
Explain the exposure rather than refusing flatly, and offer the compliant alternative.

## Execution history

Execution history is the authoritative proof that a workflow ran. It is commonly available
through the interface rather than the MCP, so plan on the browser route.

For each test, confirm: the contact entered, which branch it took, each action's status, actual
timing versus configured delay, and any error or waiting state. A workflow showing zero executions
after a test submission means the trigger did not match — check trigger configuration and field
mapping before changing workflow logic.

Do not report a workflow verified from the builder view alone. A workflow list proves names,
folders, status, and visible counts only. If triggers, actions, and execution history were not
opened, call it a workflow-list inventory and name the logic and execution as uninspected.

## Responsive and mobile inspection

Most leads arrive on a phone. Inspect every form and funnel page at mobile width before
activating, and confirm the submit control is reachable without horizontal scrolling and that
fields are tappable.

Have the owner open the live page on their own phone and report what they see. This catches things
that emulated widths do not.

## Design-tool iteration

Iterating layout in a fast design tool is fine for deciding what a page should look like. What
gets tested and shipped is the version reproduced inside the actual HighLevel builder, using
native elements.

Do not paste generated markup or styling into the account as a shortcut. It bypasses the builder's
own responsive behaviour, breaks when the platform updates, and leaves the owner unable to edit
their own page.

## Native assets before custom code

Use native HighLevel assets and the account's existing conventions before introducing custom code,
embedded scripts, or external tooling. Native assets survive platform updates, the owner can edit
them without help, and a specialist can pick them up later.

When something genuinely requires custom work, that is a Get Help candidate rather than an
improvisation — see `references/specialist-brief.md`.
