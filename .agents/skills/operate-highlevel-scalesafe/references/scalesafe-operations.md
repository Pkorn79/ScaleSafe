# ScaleSafe operations

## Contents

- Offers
- Checkout paths
- Clients and programs
- Enrollment and consent
- Payments
- Milestones
- Pulse checks
- Evidence
- Defense readiness

## Offers

- Keep the internal name and the buyer-facing program name distinct. Buyers see only the public
  program name — in funnels, agreements, receipts, and messages — so a scruffy internal name is fine
  and a wrong public name is visible to the customer.
- Set payment type, processor, duration, policies, acknowledgments, milestones, pulse cadence, and
  checkout path deliberately. Defaults chosen by convenience show up later as a record nobody can
  rely on.
- Never enable every acknowledgment clause by default. Enable the ones that genuinely apply.
- Creating or archiving an offer is a separate approval. Archiving must stop the pulse schedules of
  its active enrollments — verify that it did rather than assuming.
- Archive stale demo offers once testing is finished, and tell the owner which ones you created.

## Checkout paths

The paths differ in how much evidence exists before money moves, which is exactly why the choice
matters:

- **Full enrollment** — identity, offer review, milestones, terms and signature, then payment. The
  most complete pre-purchase record.
- **Streamlined checkout** — faster, with inline consent and less pre-purchase evidence.
- **Merchant-collected payment** — the merchant takes payment first, then sends the paid-enrollment
  consent flow. The consent record arrives after the money, so the follow-through matters more.
- **Hosted external payment** — payment happens on an external hosted page while enrollment and
  evidence are still recorded.

Whichever path, verify one processor action, one payment record, one correct enrollment, and one
applicable workflow result. After an ambiguous timeout, check reconciliation before resubmitting —
duplicate charges are the failure that costs trust fastest.

## Clients and programs

- Treat each enrollment as its own program record, even when one contact has several.
- Select the enrollment explicitly for program-specific messages, milestones, evidence, and defense
  work.
- Never assign activity to the newest enrollment merely because the contact matches. This is the
  single most common way records end up misfiled.
- Leave genuinely ambiguous client-level activity unlinked rather than inventing a program scope for
  it. Unlinked and honest beats linked and wrong.

## Enrollment and consent

- One enrollment per program. Verify the buyer sees the correct identity, public program name,
  branding, amount, payment structure, terms, policies, acknowledgments, and milestone copy before
  they sign.
- The signed packet is a frozen record. Changed terms mean a new enrollment, not an edited one.
- Verify the packet exists and is tied to the right enrollment after signing — a completed signature
  flow is not proof the packet was stored against the intended program.
- For demonstrations, use `DEMO - ` records and confirm the demo enrollment is distinguishable at a
  glance from a real one. `example.com` addresses by default — but where the check is whether a
  message actually arrived, and specifically for the receipt-versus-welcome duplication check,
  `example.com` cannot deliver and an owner-controlled inbox goes on the otherwise-fictional
  contact. Running that check against `example.com` proves nothing and is how two receipts with two
  different totals reach a real buyer.

## Payments

- **Every processor action is its own standalone approval**, in an explicitly established test or
  live context: a test charge, a live charge, a refund, a void, a retry after a failure or ambiguous
  timeout, storing a payment method, any subscription or instalment change, and any deliberate
  idempotency test. Name the single action and its amount when asking. Test context lowers the
  financial stakes; it does not remove the owner's need to know which action is about to run, and a
  retry that double-charges is still a real defect in test.
- Never fold a payment into an approval covering other steps — enrolment links, consent, milestones,
  pulse actions, or defense work each stand alone too.
- Reconcile the processor transaction, the payment record, the enrollment, and any
  subscription or membership record. All four, not the convenient one.
- Record add-ons separately from recurring principal.
- Update local status only after processor success for refunds and lifecycle actions. The processor
  is the source of truth; local state that disagrees with it is a reporting bug at best.
- Use the app's reconciliation view for diagnosis. Do not manually repair a record before processor
  truth is known — a manual fix applied to a misread state creates a second, harder problem.
- Never handle card details. The buyer enters payment details themselves, on their own screen.

## Milestones

- Complete the milestone against the exact enrollment.
- Verify the outbound signoff message references the same program and the same milestone.
- Client signoff becomes evidence scoped to that enrollment.
- A scheduled appointment does not mean a milestone was completed. Do not infer delivery from a
  calendar entry.

## Pulse checks

- Cadence belongs to the offer and the active enrollment.
- Delivery of the app event, the workflow execution, the outbound message, and the client's actual
  response are four separate proofs. Verify the one you are claiming.
- Archived offers and inactive enrollments must stop scheduling. Verify this after archiving.
- A response asking for follow-up stays visible to the owner and becomes enrollment-linked evidence.
- Send windows can leave executions queued. Already-queued work is distinct from newly scheduled
  work, and confusing the two produces either a false "nothing sent" or an accidental double send.

## Evidence

- Scheduled appointments are engagement. Attended or completed sessions, deliverables, progress
  records, and communications may support delivery — but only when they match one enrollment
  exactly.
- Connected does not mean observed, and observed does not mean published. Keep the three distinct in
  reporting.
- Test connector events stay diagnostic and never become production evidence.
- Relevance tags guide selection; they are not standalone factual claims.
- Unlinked evidence means the system cannot prove one exact enrollment. Fix the linkage or leave it
  unlinked — never default to the newest enrollment. Unlinked evidence stays out of
  enrollment-scoped defense material.

## Defense readiness

This skill prepares and verifies. It never submits, and it never predicts an outcome.

1. Select the actual disputed transaction where one exists.
2. Use the matching card brand and reason code.
3. Confirm the processor's actual deadline rather than assuming a generic response window.
4. Review enrollment scope, chronology, the compiled material, exhibits, the signed packet, amounts,
   and what evidence is missing.
5. A held or flagged-for-review state is an intentional hold. It is not a warning to clear, and
   marking something submitted does not resolve it.
6. Submitting evidence to a processor, or marking a defense submitted, is always a separate explicit
   approval and is the owner's decision.

Never claim a guaranteed win, never present evidence collection as protection against a chargeback,
and never represent client-level activity as enrollment proof without a defensible match. Report
what exists, what is missing, and what is unverified.
