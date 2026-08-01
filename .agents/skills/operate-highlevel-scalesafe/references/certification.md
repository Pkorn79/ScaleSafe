# Certification: what counts as verified

## Contents

- The proof standard
- Test data rules
- Which scenarios this workflow must pass
- Per-workflow proof record
- The full sold-client certification run
- Pass conditions
- Before activation

## Where each proof comes from

Most of this run happens in Draft. Match the proof to the cheapest layer that can produce it, and
publish only for what genuinely needs it — the sequence is in `SKILL.md` and every file here assumes
it.

| Proof | Layer |
|---|---|
| Branch logic, field mapping, action configuration | Native Test Workflow, in Draft |
| An external-app action's real behaviour | Test Action where the builder offers one — a real provider API call, own approval |
| Entry trigger firing from a real submission | Limited publication |
| Actual timing against configured delays | Limited publication |
| Inbox delivery and placement | Limited publication, owner-controlled inbox |
| Duplicate sends across both sides | Limited publication, owner-controlled inbox |
| Enrollment, consent, payment, evidence linkage | The app, with `DEMO - ` records in test context |

## The proof standard

Verify the narrowest authoritative artifact, in the surface that actually holds it. A successful API
response, a saved builder view, and the owner's expectation are not proof.

Never infer a later layer from an earlier success. An accepted trigger does not prove a workflow
ran; an execution does not prove a message sent; a sent message does not prove delivery; a delivered
message does not prove inbox placement; a processor payment does not prove the correct enrollment
was linked; a connected provider does not prove an event was observed.

Counts are inventory evidence, not test evidence. Zero active contacts, zero enrollments, zero
errors, or a visible branch never means tested, clean, working, or safe. Only a recorded native test
or execution history with the expected branch and result proves that run.

Prove layers in order and stop at the first failure rather than testing downstream:

1. The account is the confirmed one.
2. The asset exists with the intended configuration.
3. The trigger matched the test record.
4. The workflow executed, on the branch expected.
5. The action completed — message queued, field written, opportunity moved, payment recorded.
6. The external result occurred — received, at the right time, with the right content and links.
7. Nothing unintended fired: no duplicate send, no second workflow entered, no production record
   touched, no duplicate charge.

## Test data rules

- `DEMO - ` prefix on demo assets, offers, and opportunities.
- Fictional contacts only, with `example.com` addresses.
- A visible demo or test tag wherever the surface supports one.
- Fictional phone numbers only, and only when SMS is genuinely under test with registration,
  consent, and funding in place.
- A fictional opportunity in a real pipeline is acceptable, but it writes into a live production
  asset, so it needs its own action-time approval.
- A confirmed test processor or test context for anything involving payment, established explicitly
  before the money step. The owner enters the test payment details themselves, on their own screen —
  you never handle card details, including test ones.
- Where a check requires proving a message actually **arrived**, use a real, routable mailbox the
  owner controls and is watching during the test, on the otherwise-fictional `DEMO - ` contact.
  `example.com`, `example.invalid`, and every other reserved placeholder are unroutable by design and
  can never satisfy a delivery or duplicate-send check. If no routable monitored inbox is supplied,
  mark those checks **blocked** rather than simulating receipt or reporting a pass. Default to
  `example.com` for everything that is not a delivery check.
- If the processor offers no test mode, a live-context test needs explicit approval for a specific
  small amount **and** the refund actually executed and reconciled afterwards — not merely a refund
  plan stated. Verify the refund reached the processor and the local record agrees.
- Tell the owner every demo record created. Removing them later is a separate approval.
- A demo run leaves records the skill elsewhere treats as never-casually-deleted: a signed consent
  packet, a reconciled payment, an enrollment, evidence items. Do not delete these as routine
  cleanup. Archive the demo offer, list what remains, and let the owner decide — many keep the set
  deliberately as the one worked example of what a real record looks like. If a demo contact was
  given an owner-controlled address for delivery testing, say so, because that address is now
  sitting on a record that looks fictional.

Never use a real customer as a test subject, and never use real customer data to populate a
fictional record. The request usually arrives as "just run it on the client who bought this morning
so I can watch it work" — offer the fictional dry run as the rehearsal and the real customer's run
as an acknowledged production run.

## Which scenarios this workflow must pass

Test what the workflow actually does. Requiring appointment and sale scenarios of a review-request
flow or a simple intake-to-task flow forces invented records and makes honest sign-off impossible.

**Always required:**

- **Happy path.** An eligible record enters, takes the intended branch, produces the intended
  results with correct links and timing, and ends in the intended state.
- **Every branch the blueprint defines.** An untested branch is an unverified branch. If one is
  knowingly untested, say so and say why rather than implying full coverage.
- **Every stop condition the blueprint defines.** Each one actually halts the sequence.

**Required where applicable:**

- **Duplicate and idempotency behaviour**, wherever the same person can arrive twice or the same
  action can be retried. Confirm no double messaging and no double charge, and confirm which record
  was acted on.
- **Opt-out and channel stops**, for any workflow that sends messages. An opt-out must halt this
  workflow *and* any other workflow that contact is enrolled in. This is the test most often
  skipped and most often needed.
- **Appointment scenarios — no-show, attended-but-undecided** — only when the workflow actually
  contains those states.
- **Sale and sold-client scenarios** — only when the workflow reaches them.
- **Payment scenarios**, in test context, only for workflows that touch money.

## Per-workflow proof record

For each workflow record: the triggering action and test record used; which branch executed, from
execution history; each action's status and actual timing; the external result — what was received,
when, with what content; anything queued, waiting on a send window, or errored; and a sanitized
screenshot or stable identifier containing no credential, no account identifier, and no real
personal data.

## The full sold-client certification run

This is a checklist of what to prove, not a script to execute. Several steps below are separately
approvable actions in their own right — creating the offer, the enrolment, the payment, the
milestone, the evidence item, and the archive — and each still needs its own approval at the moment
it happens. Working down the list without asking is exactly the batching the approval rules forbid.

The complete reference demonstration keeps every scenario, because it is the run that proves the
whole path works. Use `DEMO - ` records throughout and a test payment context.

1. Open the app from the exact sub-account, with no account chooser and no other merchant's data.
2. Verify merchant settings and branding show this merchant only.
3. Capture a fictional lead through the form and funnel page.
4. Confirm the contact and opportunity are created with the expected values.
5. Confirm the immediate email arrives with working links, and the owner notification arrives.
6. Book the sales call; confirm confirmation and reminders.
7. Run the no-show branch on one record and confirm the attended branch does not fire.
8. Run the attended-but-undecided branch and confirm the owner task is created.
9. Run the attended-and-sold branch to Closed Won.
10. Verify contact, the specific opportunity, owner, and Closed Won state.
11. Open the enrollment for the demo offer; verify identity, public program name, branding, amount,
    payment structure, terms, policies, acknowledgments, and milestone copy.
12. Complete consent and signature; confirm the packet is stored against this enrollment.
13. Take one test payment; confirm exactly one processor action, one payment record, and one
    correct enrollment.
14. Confirm success appears once, not twice.
15. Confirm receipt and welcome/access messaging arrives, uses the public program name and correct
    links, and that nothing arrived twice from both sides.
16. Complete one milestone against the exact enrollment and verify the signoff message.
17. Verify the pulse schedule exists on the right cadence.
18. Add one fulfillment evidence item and verify it links to the exact enrollment.
19. Verify defense material assembles against the demo transaction, that gaps are visible, and that
    a held state stays held. Nothing is submitted.
20. **Last**, archive the demo offer and verify the pulse schedule actually stopped. This comes
    after evidence and defense rather than before, because archiving deactivates the enrollment's
    scheduling and would make steps 18 and 19 run against an archived program.
21. Confirm no unexpected error, duplicate processor action, duplicate message, or failed background
    work across the whole run.

Two checks worth running that owners routinely skip because nothing looks wrong: a contact with
**two** opportunities, to confirm the enrollment attaches to the right one rather than the newest;
and the receipt duplication check at step 15, verified against actual sends rather than
configuration. Both find defects that are invisible in the builder.

## Pass conditions

- Correct sub-account throughout; no cross-account record touched.
- Every required scenario for this workflow tested, with results recorded.
- No production contact, opportunity, asset, or payment modified.
- No duplicate sends, no duplicate charges, no unintended second workflow entry.
- Opt-out and stop conditions proven where applicable, not assumed.
- SMS steps either fully proven or explicitly inactive with the reason stated.
- Evidence tied to the exact enrollment; anything unlinked left unlinked and reported.
- Costs stated and accepted for expected volume.
- Every processor action taken under its own standalone approval, test charges included.
- All work performed in the one confirmed sub-account. No second or test tenant was used.
- **Final state restored and verified.** Where production activation has not been approved, the
  workflow is back in Draft and any page unpublished, confirmed by reloading and looking rather than
  by assuming, with the restoration recorded. Where limited publication was used, the window's start
  and end are recorded along with the exposure that was disclosed.

## Before activation

Activation is its own approval. Before asking, state what goes live, who can receive communications
or charges once it does, the expected monthly cost at the owner's stated volume, which scenarios
passed, which did not and why, and exactly how to switch it off.

After activation, watch the first real runs rather than declaring success. The first real person
through a workflow finds what fictional ones do not.
