# Reference demonstration: the full path

A worked example using a fictional business, from first enquiry to fulfillment evidence. Every name
and value here is invented. Adapt the shape; never reuse these values in a real account.

## Contents

- The fictional business
- Blueprint summary
- Part 1 — build the lead-to-booking path
- Part 2 — the branches
- Part 3 — the sale closes
- Part 4 — the sold-client run
- Part 5 — receipt and welcome
- Part 6 — milestones, pulse, evidence
- The certification run
- Improve-mode example

## The fictional business

**Harbor Line Advisory** — a fictional fractional-CFO service for construction firms. One owner, one
closer. Sells a twelve-week engagement at a high ticket. Leads arrive from referrals and one paid
ad. The valuable moment is a completed paid engagement; the decisive step before it is an attended
45-minute strategy call.

Starting state: email sending domain verified, A2P **not** registered, wallet unfunded, one existing
pipeline whose stages the owner still uses, one abandoned workflow from a previous agency that still
sends a monthly email, and the ScaleSafe app installed with merchant configuration complete and a
test processor connected.

The abandoned workflow gets raised before anything is built. Left alone, it will double-message
every contact the new build touches.

## Blueprint summary

- **Goal.** More attended strategy calls, and every sale reaching a complete enrollment record.
- **Success metric.** Attended calls per month, and the share of closed sales with a signed packet
  and linked evidence.
- **Trigger.** Consultation form submitted.
- **Eligible.** New enquiries with a valid email.
- **Exclusions.** Existing clients, contacts with an open opportunity, contacts who opted out.
- **Re-entry.** Not for 90 days.
- **Required data.** Name, email, company, one qualifying answer, consent to be contacted.
- **Stop conditions.** Booked, replied, became a client, asked to stop, unsubscribed.
- **Human decisions.** Whether an enquiry is worth a call; the outcome after the call; the
  commercial terms of the offer.
- **Costs.** Email only at first. SMS built but inactive pending registration and funding.
- **30-day outcome.** The owner stops chasing enquiries in the evening, and every sale produces a
  complete record without anyone remembering to do it.

## Part 1 — build the lead-to-booking path

1. **Custom fields and tags.** One custom field for the qualifying answer; tags for enquiry source,
   call outcome, and opt-out. The account already had a company field, so no duplicate was created.
2. **Pipeline.** Existing pipeline reused — its stages already covered enquiry, call booked, call
   attended, proposal, Closed Won, Closed Lost. Nothing renamed.
3. **Calendar.** A 45-minute strategy call, timezone confirmed by the owner against their own
   booking view, buffers and minimum notice set to what the closer actually wants.
4. **Consultation form.** Five fields: name, email, company, the qualifying question, consent. Each
   mapped explicitly and verified by submitting a fictional entry and reading the resulting contact
   record.
5. **Funnel page.** One page, one action, existing branding, no navigation. Saved unpublished.
6. **Workflow.** Saved as Draft.

Fields and calendar through the connection; form, funnel page, and workflow through the supervised
browser, since those builders are commonly read-only through the connection. Execution history read
in the interface.

**Testing followed the sequence in `SKILL.md`.** Native Test Workflow with `DEMO - ` contacts, while
still in Draft, proved every branch, the field mappings, and the action configuration — no
publication needed for any of that. One external-app action offered a Test Action; it was used, and
because a Test Action makes a real API call it got its own approval for the record it created.

Four things Draft testing could not prove: that the real form submission fires the entry trigger,
actual timing against the configured delays, genuine inbox delivery, and duplicate-send behaviour.
Those needed limited publication, covered below.

## Part 2 — the branches

- **On submission.** Create or update the contact, create an opportunity in the enquiry stage, apply
  the source tag.
- **Immediately.** Email the enquirer with the booking link and what to expect.
- **Immediately.** Notify the owner internally with name, company, and qualifying answer.
- **Conditional SMS.** A short text with the booking link — built, held inactive. It stays off until
  registration is approved, consent recorded, and the wallet funded. All three, not any one.
- **On booking.** Move to call booked, confirmation immediately, reminders the day before and an
  hour before, stop the chase sequence.
- **No booking after 48 hours.** One reminder email, then stop. The owner chose one nudge.
- **No-show.** Move to a no-show state, one recovery email offering a rebook, owner task. Does not
  enter the attended path.
- **Attended, undecided.** Follow-up referencing what was discussed, plus an owner task after 24
  hours so a human decides.
- **Attended, sold.** Move to Closed Won and continue into Part 3.
- **Any stop condition.** Halt all sequences, opt-out honoured across every workflow including the
  inherited one.

## Part 3 — the sale closes

Verify in the account rather than from the owner's word: the correct contact, the specific
opportunity for this sale, the opportunity owner, and Closed Won in the expected stage.

The fictional buyer here had two opportunities — an earlier Closed Lost one from the previous year —
so the correct one was named explicitly and confirmed rather than assumed from recency.

Then confirm prerequisites: app installed in this sub-account, merchant configuration complete, an
active offer matching what was sold, a connected in-scope processor, and healthy provisioning. Then
establish test versus live context explicitly with the owner.

## Part 4 — the sold-client run

Demonstration run, so everything is `DEMO - ` prefixed, the buyer is fictional with an
`example.com` address, and the payment context is test.

1. **Offer.** `DEMO - Twelve Week Advisory` selected, confirmed against what was actually sold —
   amount, payment structure, duration, and the public program name the buyer sees.
2. **Checkout path.** Full enrollment chosen, because it produces the most complete pre-purchase
   record and this is the path being certified.
3. **Enrollment.** One enrollment created against the verified opportunity.
4. **Consent and signature.** Before signing, the buyer's view was checked for correct identity,
   public program name, branding, amount, payment structure, terms, policies, acknowledgments, and
   milestone copy. Only the acknowledgments that genuinely applied were enabled. Verified at mobile
   width as well as desktop.
5. **Test payment.** Its own standalone approval, naming that one charge and its amount, in the
   confirmed test context — not bundled with the enrolment link, the consent step, the milestone, or
   anything downstream. The owner entered the test card details on their own screen. Reconciled
   afterwards: one processor action, one payment record, one correct enrollment, one instalment
   schedule, and success shown once rather than twice.

Each of the numbered steps above was its own approval as it came up. The tempting version — one yes
covering offer, enrolment, consent, payment and welcome — is the one to refuse, because the owner
who agrees to a plan has not agreed to a specific charge and loses the moment where a wrong amount
gets caught.

## Part 5 — receipt and welcome

HighLevel sends the receipt and the welcome/access message. The enrollment and evidence sequence
stays separate, so a change to the welcome email cannot disturb payment evidence.

Before either went live, the owner confirmed which side sends which message. Checking actual arrivals
in the owner-controlled test inbox — not the configuration — revealed both sides sending a receipt,
with different wording and different totals. The buyer would have opened a support ticket. This is
the check that only works with a real inbox, which is why delivery testing is the one case where
`example.com` gives way.

## Part 6 — milestones, pulse, evidence

6. **Milestones.** First milestone completed against the exact enrollment; the signoff message
   verified as referencing the same program and milestone. A scheduled kickoff call was deliberately
   *not* treated as a completed milestone.
7. **Pulse.** Cadence confirmed against the offer and the active enrollment, and the next scheduled
   event verified as present.
8. **Fulfillment evidence.** One attended-session evidence item added and verified as linked to the
   exact enrollment. A merely booked appointment was checked and correctly treated as engagement
   rather than delivery. The connected video provider showed as *connected* only — no event
   observed, nothing published — and was reported that way rather than as working evidence.
9. **Defense readiness.** Material assembled against the demo test transaction with the matching
   reason code, gaps left visible, and the held state left held rather than cleared. Nothing
   submitted, and no outcome implied.
10. **Archive last.** Only now was the demo offer archived, and the pulse schedule verified to have
    actually stopped. Archiving earlier would have deactivated the enrollment's scheduling and made
    steps 8 and 9 run against an archived program — which is why the archive test comes last rather
    than alongside the pulse check.

## The certification run

Fictional records throughout, `DEMO - ` prefixed. Most of it ran in Draft via native Test Workflow;
only the four things Draft cannot prove needed publication.

**The limited publication.** No entry-scoping mechanism had been verified in this account — the
workflow's entry conditions offered nothing the demo records could be given that it demonstrably
respected. So the exposure was stated plainly rather than engineered around: while the page was
published and the workflow live, any real enquiry submitting the form would enter and receive the
sequence. The owner approved that, at a quiet hour, for a stated window. No second sub-account was
invented to avoid it — the confirmed account is the only account.

Because inbox delivery and duplicate sends were among the things under test, the `DEMO - ` contacts
used an inbox the owner controls rather than `example.com`, which cannot receive mail. The contacts
stayed fictional; only the address was real.

Beyond the happy path, the two tests most often skipped were run and both found something. A second
submission from the same address confirmed no double messaging and confirmed which record was acted
on. An opt-out confirmed it halted this workflow *and* the inherited monthly email — which it did
not, until the inherited workflow was given the stop condition too, as its own production-workflow
approval.

**Restoration.** Production activation had not been approved, so at the end of the window the
workflow was returned to Draft and the page unpublished. Both were then reloaded and confirmed to be
in that state on screen, and the restoration was recorded with the time. A certification run that
leaves something quietly live is worse than no run.

SMS steps were left in Draft and reported as unproven, with the reason stated: no registration, no
funding.

## Improve-mode example

> "People are attending but not completing enrollment. Shorten the follow-up delay, add the
> enrollment link to the first message, create an owner task after 24 hours, and test the sequence
> again."

Measure before changing. Read execution history for the attended branch over a defined period: how
many attended, how many received the follow-up, actual delay against configured, and where people
stopped. Report the numbers — including that the premise may be wrong. If the follow-up is not being
received at all, delay is not the problem.

Then propose the narrow change as one enumerated set: reduce the delay to the agreed interval, add
the enrollment link to the first message, add the owner task at 24 hours. State the side effects,
particularly contacts currently mid-sequence and whether the change reaches them.

Get approval for that set. Implement on a duplicate or with the workflow paused, whichever this
account allows without disturbing in-flight contacts — and if neither is possible without a
production workflow change, treat that as its own separate approval with the blast radius stated.
Do not tidy anything else while in there.

Retest the attended-undecided path plus the stop conditions, because a shortened delay can collide
with a booking arriving in between. Reactivate with separate approval, then watch real runs rather
than declaring improvement. Report the measurement, the change, the retest, and the single next
experiment worth running.
