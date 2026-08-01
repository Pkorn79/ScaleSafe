# Specialist brief: [one-line problem summary]

Fill every section. A brief missing the acceptance test produces a job that cannot be closed, and
a brief missing existing state produces a specialist who rebuilds something that already worked.

Values in `[square brackets]` are for the owner to supply. Before sending, re-read
`references/specialist-brief.md` and confirm nothing prohibited is in here: no credentials, no card
or bank details, no location or account identifiers, no real customer data, no revenue figures.

**Platform:** GoHighLevel (HighLevel) — single sub-account
**Surface:** [the specific area, e.g. email services / sending domain, plus any external system]

---

## Exact problem and desired result

**What happens now:** [observable behaviour, with dates and the exact on-screen wording]

**What should happen:** [the observable end state]

## Narrow deliverable

[One outcome, verifiable. Not "help with our CRM". State explicitly what is out of scope.]

## HighLevel area involved

[The specific surface, so specialists can self-select. Note what is not in scope — no workflow,
funnel, or contact-data work, for instance.]

## Existing state

**Configured:**

- [what exists today]

**Already tried:**

- [each attempt and its result]

**Explicitly not yet ruled out** — the job is to isolate which of these it is:

- [candidate cause]
- [candidate cause]

**Screenshots attached:** [Owner supplies. Crop to the failing element. Then check the whole frame
and remove: agency/account name, sub-account switcher, location ID, browser profile name and
bookmarks bar, notification popups, and any customer name in a sidebar. Replace with an obvious
placeholder such as ACCOUNT-NAME-REMOVED.]

## Required experience

[The specific capability, stated as demonstrable experience with this surface rather than a
seniority label. Add one question candidates should answer to show it.]

## Acceptance test

The owner runs this alone, with no specialist present:

1. [step, with the exact expected result]
2. [step]
3. [step]

All steps must pass on the same day without the specialist re-triggering anything. If any step
fails, the milestone is not complete.

[If relevant, state what passing does *not* prove — for example, that domain authentication passing
does not guarantee inbox placement.]

## Fixed-price milestone recommendation

**Single milestone:** [deliverable], closed by the acceptance test above, including a written
statement of the root cause and exactly what was changed.

Only if the work genuinely splits:

- **M1 — Diagnosis:** [deliverable]. Acceptance: [owner-verifiable evidence].
- **M2 — Fix and verify:** acceptance test above passes.

Fixed price on a defined deliverable keeps scope honest on both sides. Avoid open-ended hourly
arrangements for a bounded problem.

## Minimum temporary access

Time-bounded, agreed up front: [duration], extendable only if justified.

**Do not grant under any circumstances:** agency-level login; the owner's own user account or
password; any shared login; billing, card, or bank details; a permanent API key or integration
token; access to any other sub-account.

**Grant instead:**

- A new temporary user created solely for this job, on this one sub-account, at the narrowest
  permission level that reaches [the relevant setting].
- [For DNS or domain work: identify the authoritative DNS host first, which may or may not be the
  registrar. The specialist specifies records and the owner enters them, or a screen share where the
  owner drives. Public DNS state needs no access. Zone-scoped delegated access at that provider only
  on demonstrated need — never the master account at either.]
- Extra permissions added only after the specialist shows why, not pre-emptively.

## Handoff and revocation checklist — run on completion, not "soon"

1. Run the acceptance test yourself, in the account, before releasing the milestone.
2. Get a written summary of everything changed, including anything outside the deliverable.
3. Delete the temporary user and revoke any external delegated access.
4. Rotate any credential the specialist could have seen, and any the owner pasted anywhere.
5. Disconnect any third-party tool or integration they connected that you do not intend to keep.
6. Review recent account activity for changes beyond the deliverable.
7. Confirm no automation now depends on the specialist's own account, inbox, or domain.
8. Record what changed and why, so the next person diagnosing this knows this work happened.

---

**Where to post:** Upwork and Freelancer are two options; so is the owner's own network, and a
referral from someone who has done this specific work is often better than a marketplace listing.
Compare at least two candidates.

**On cost:** bounded one-off work against a written acceptance test often costs substantially less
than an ongoing retainer, because scope cannot drift. This is a reason to keep the brief tight, not
a price prediction. Promise no price, turnaround, availability, or quality.
