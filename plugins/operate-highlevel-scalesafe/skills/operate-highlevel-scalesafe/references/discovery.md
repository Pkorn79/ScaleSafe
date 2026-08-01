# Discover: find the three highest-value workflows

## Contents

- How to run the interview
- What to ask about
- How to rank candidates
- How to present the recommendation
- Common traps

## How to run the interview

One question at a time. Wait for the answer. Let the answer change the next question.

A batch of ten questions gets skimmed and half-answered, and the half that gets skipped is
usually the part that would have changed the recommendation. A single question gets a real
answer, and the owner stays willing to keep going.

Reflect back what you heard in their own words before moving on — "so a good lead is someone
who already has a team, and the win is them booking the paid assessment" — because owners
frequently correct a restatement they would have let pass in a question.

Do not open a HighLevel screen during Discover. Nothing here needs account access yet, and
staying out of the account keeps this mode genuinely read-free. If you need to know what already
exists, ask the owner, or switch to Audit and say you are switching.

## What to ask about

Cover these areas. Order flexibly based on what the owner volunteers; skip what they have
already answered.

- **The most valuable result** a lead or client can reach. Not "more leads" — the specific
  moment that makes them money. Booked assessment? Signed proposal? Paid deposit?
- **Lead sources and current process.** Where do people arrive from, and what happens next
  today, step by step, including the manual parts.
- **Missed follow-up and repeated delay.** Where do people go quiet, and what does the owner
  keep doing by hand at 9pm.
- **Booking, qualification, and sales decisions.** Who decides a lead is worth a call, on what
  basis, and does that decision happen before or after booking.
- **Required contact data and consent.** What must be captured for the process to work, and how
  the owner currently obtains permission to email or text.
- **Human decisions and handoffs.** What must a person judge, and who receives the handoff.
- **Stop conditions and opt-outs.** What should immediately halt all messaging — replied,
  booked, paid, asked to stop, became a customer.
- **Channels already configured and funded.** Which of email, SMS, and calling actually work in
  the account today, with A2P and wallet in place. This constrains everything.
- **The post-sale delivery process.** What happens after someone buys, and who does it.
- **A measurable 30-day outcome.** One number the owner would be glad to see move.

## How to rank candidates

Score each candidate workflow against all nine criteria, then rank. Write the scoring down so
the owner can disagree with your reasoning rather than just your conclusion.

| Criterion | Favours |
|---|---|
| Value | Directly touches the money moment |
| Frequency | Happens often enough to matter |
| Owner time saved | Removes recurring manual work |
| Readiness | Required channels already configured and funded |
| Complexity | Fewer branches, fewer integrations |
| Usage cost | Low per-contact cost, email before SMS |
| Compliance risk | Consent already clean, no cold outreach |
| Testable in 7 days | Can be proven with `DEMO - ` records this week |
| Reversibility | Easy to switch off without damage |

Readiness and compliance risk override raw value. A high-value SMS-first workflow in an account
with no A2P registration is not the first build — it is a blocked build, and starting it produces
a half-finished automation the owner cannot use. Say so plainly and offer the email-first version
of the same workflow instead.

Readiness scores rest on the owner's self-report, because Discover does not read the account. Treat
them as provisional and say so. Two claims in particular deserve verification in Audit before you
commit to a build order: "my email is set up" can mean a verified dedicated sending domain or
merely a confirmed from-address, which are very different readiness levels; and wallet funding is a
prerequisite even for email-only workflows, so an owner who has not done A2P has often never funded
a wallet either. Rank on the self-report, flag which scores are unverified, and confirm them in
Audit before building.

Raise the sold-client side only where a candidate workflow itself performs enrollment, consent, or a
payment step. A workflow that merely feeds the thing that eventually sells — a form-to-first-contact
sequence, a booking reminder — does not need it, and surfacing ScaleSafe unprompted in an account
that has never installed it is noise the owner has to decode.

Where a candidate does reach a payment or enrollment step, its readiness depends on the app being
installed, merchant configuration complete, an active offer, and a connected in-scope processor.
Ask about those before ranking it ready, and rank it blocked rather than valuable if they are
missing.

Consent capture is a dependency of a dependency. A2P registration generally requires a working
opt-in mechanism and sample messages matching what will actually be sent, so a first build with no
consent-capture step silently blocks the SMS path later. Weight consent capture as a readiness
factor for any workflow whose eventual value depends on texting.

## How to present the recommendation

Recommend at most three workflows. More than three is not a recommendation, it is a menu, and
owners with a menu build nothing.

For each: one sentence on what it does, the outcome it moves, what it depends on, roughly what it
costs to run, and how it gets tested. Then recommend exactly one to build first and say why that
one — usually highest value among the ready-and-testable candidates.

Keep the recommendation at the scope the owner requested. When the requested workflow spans lead
capture, booking, outcome branches, and sold-client enrollment, a no-show branch alone is not the
recommended workflow. It may be the safest **first build slice** of that end-to-end workflow. Name
the complete workflow first, then distinguish its staged build order. An unverified payment mode may
block payment testing without blocking the Draft design of the non-money stages.

End by asking whether to blueprint that one. Do not begin building in the same breath; copy
`assets/workflow-blueprint-template.md` and fill it with the owner first, because a blueprint
disagreement is cheap and a rebuilt workflow is not.

## When the owner asks for a count

"Get my first three automations going" is a count-goal, and it collides with recommending three but
building one. Reframe it early, before the recommendation lands as under-delivery: three is the
shortlist and one is the build order, because the second and third get better once the first has
produced real data. Say when the next one starts — after the first is live and measured — so the
sequence sounds like a plan rather than a reduction in scope.

## The solo operator

Many HighLevel owners are the entire business. When there is no colleague, the design changes in
two ways worth stating.

Internal notification steps are nearly worthless when the notification arrives in the same inbox as
everything else; an owner task or a clear pipeline stage usually serves better. And stop conditions
matter more, not less, because there is nobody else to notice that a paying client is still
receiving "still interested?" messages. Weight stop-condition completeness higher when ranking for
a solo owner.

## Common traps

- **Accepting "more leads" as the goal.** Push for the specific valuable moment.
- **Designing for the channel the owner is excited about** rather than the one that is funded and
  compliant today.
- **Missing the stop conditions.** Owners rarely volunteer these and they are what prevents a
  paying customer receiving a "still interested?" text.
- **Ignoring what already exists.** A workflow that duplicates an existing one creates double
  messaging. Inventory in Audit mode before building.
- **Recommending the complex one because it is impressive.** The first build should succeed.
