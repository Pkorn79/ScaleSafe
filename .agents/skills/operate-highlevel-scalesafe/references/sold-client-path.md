# From Closed Won into the sold-client process

## Contents

- Why this is one continuous path
- Verify the sale first
- Confirm the ScaleSafe prerequisites
- Establish test versus production
- The continuation, in order
- Receipt and welcome: coordinated but distinct
- Reporting

## Why this is one continuous path

When a prospect attends the sales call and buys, the work continues in the same conversation, in the
same account, under the same safeguards. There is nothing to hand off and nothing to look up. The
sale closes in the pipeline, and the sold-client process — offer, enrollment, consent, payment,
receipt and welcome, milestones, pulse, fulfillment evidence — carries on from there.

What does change at this boundary is the stakes. Everything past Closed Won creates records a
business may later need to rely on: a signed consent packet, a payment event, evidence of delivery.
Those are the records that matter when a payment is disputed months later, and a record attached to
the wrong enrollment is worse than no record at all. So the verification below is not ceremony, and
the approvals do not relax because the owner is pleased.

## Verify the sale first

Confirm in the account — not from the owner's summary:

- The correct contact, in the confirmed sub-account.
- The correct opportunity for **this** sale, distinguished from any other open or historical
  opportunity for the same contact.
- The opportunity owner.
- Closed Won state, in the expected pipeline and stage.

If the contact has more than one opportunity, never assume the newest is the sale. Name the ones you
can see and let the owner choose. A contact who bought a small package last year and a large one
today has two, and attaching this enrollment to the wrong one misfiles every downstream record.

If any of the four cannot be verified, stop and say which. Moving a production opportunity to Closed
Won is itself a change needing its own approval — prefer confirming a state the owner already set.

## Confirm the ScaleSafe prerequisites

Before starting the sold-client sequence, verify in the account that each of these is actually in
place. Assume none of them from the conversation.

- The ScaleSafe app is installed in **this** sub-account, and opens without an account chooser and
  showing only this merchant's data.
- Merchant configuration is complete: identity, support details, descriptor, terms source, and the
  enrollment funnel address.
- An appropriate offer exists and is active.
- A processor is connected, is owned by this merchant, and is within the approved launch scope.
- Provisioning is healthy, including the required workflows and field or value dependencies.

Any missing prerequisite produces the blocked-action report in `SKILL.md` rather than a partial
attempt. Naming the specific gate — "no active offer exists for this program" — lets the owner fix
it in minutes. "Something went wrong" costs them an afternoon.

Never substitute a HighLevel approximation for a missing ScaleSafe record. An opportunity marked
paid is not an enrollment; a note is not consent; a tag is not payment evidence. Those substitutions
look helpful and produce exactly the gap that matters later.

## Establish test versus production

Ask the owner directly which context this run is in. Do not infer it from their phrasing — "let's do
a test enrollment" describes an intention, not a configured state, and owners frequently do not know
which mode the processor is actually in.

Verify the configured state in the account, state it back, and get agreement before any money step.
If it cannot be established, stop rather than guessing: a confident wrong answer here is a real
charge on a real card.

For a demonstration run, everything is fictional and clearly labelled — see the test-data rules in
`SKILL.md` and `references/certification.md`. A live buyer is never the rehearsal.

## The continuation, in order

Each step is its own action-time approval where it changes anything. Detail for each lives in
`references/scalesafe-operations.md`; this is the order and the gate at each point.

**These do not get bundled.** A single approval covering "the enrolment, the payment, the welcome
email and the first milestone" is the failure mode to avoid — it sounds efficient and it removes the
one moment where a wrong amount, a wrong offer, or a wrong enrolment gets caught. Every processor
action in particular is standalone, test charges included.

1. **Select the offer.** Confirm the offer matches what was actually sold — the amount, the payment
   structure, the duration, and the public program name the buyer will see. Confirm with the owner
   rather than picking the closest match.
2. **Choose the checkout path.** Full enrollment, a streamlined checkout, or a merchant-collected
   payment followed by the consent flow. The choice determines how much pre-purchase evidence
   exists, so make it deliberately rather than by convenience.
3. **Enrollment.** One enrollment per program, even when a contact has several. Never let activity
   attach to the newest enrollment merely because the contact matches.
4. **Consent and signature.** Verify the buyer sees the correct identity, program name, branding,
   amount, payment structure, terms, policies, acknowledgments, and milestone copy before signing.
   Enable only acknowledgments that genuinely apply. A signed packet is a frozen record — changed
   terms need a new enrollment, not an edit.
5. **Payment.** Separate approval, in the established context. The buyer enters their own payment
   details on their own screen; in a demonstration run the owner enters test details on theirs. You
   never handle card details, including test ones, and never accept them read aloud. Reconcile the
   processor result, the payment record, the enrollment, and any instalment or subscription record.
   After an ambiguous timeout, check reconciliation state before retrying — never blind-retry a
   payment. If the processor has no test mode, a live-context test needs approval for a specific
   small amount and the refund actually executed and reconciled afterwards, not merely planned.
6. **Receipt and welcome/access.** See below.
7. **Milestones.** Completed against the exact enrollment, with the signoff message referencing the
   same program and milestone. A scheduled appointment is not a completed milestone.
8. **Pulse checks.** Cadence belongs to the offer and the active enrollment. Confirm an archived
   offer or inactive enrollment stops scheduling. A response asking for follow-up should stay
   visible to the owner and become enrollment-linked evidence.
9. **Fulfillment evidence.** Attended or completed sessions, deliverables, progress, and
   communications may support delivery when they match exactly. A booked appointment is engagement,
   not delivery. A connected provider does not prove an event was observed or published.
10. **Defense readiness.** Verify evidence is linked to the exact enrollment and that gaps are
    visible. Held or flagged output is an intentional hold, not a warning to clear. Submitting
    evidence to a processor is always a separate, explicit approval.

Verify each step in the surface that holds the authoritative record before moving to the next.

## Receipt and welcome: coordinated but distinct

HighLevel-side receipt, welcome, and access-delivery messaging stays separate from the ScaleSafe
enrollment and evidence sequence. Keeping them apart means a change to the welcome email cannot
disturb payment evidence, and an evidence problem cannot stop the buyer getting access to what they
paid for.

Coordination is still required, because both sides can message the same buyer. Before either goes
live, confirm with the owner which side sends which message, and verify against actual sends that
nothing arrives twice. A buyer receiving two different receipts with two different totals is a
support ticket and a trust problem.

Do not merge them into one workflow for convenience.

## Reporting

Report both halves together:

- The sale: contact, the specific opportunity, Closed Won state, and the account.
- The sold-client run: offer, enrollment, consent, payment, and which milestones, pulse schedule,
  and evidence now exist.
- What the buyer actually received, from which side.
- Anything unverified, named specifically, on either half.
- Test or production context, and whether the subject was real or a `DEMO - ` record.

Never promise or imply a dispute outcome.
