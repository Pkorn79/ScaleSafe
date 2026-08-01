# Get Help: the sanitized specialist brief

## Contents

- When to escalate
- Sanitize first
- The brief
- Access and revocation
- Cost framing and honest limits

## When to escalate

Get Help mode turns a blocker into a one-off, tightly scoped job someone else can complete. Use it
when the work needs a skill or an access level that is not safely available here: DNS behaviour at
the authoritative host that will not resolve, a carrier or A2P rejection needing specialist
remediation, custom code, a platform limitation needing a workaround, or a diagnosis that two
attempts have not isolated.

A failure inside the ScaleSafe platform itself is different — that goes to the vendor with the
sanitized escalation record in `references/troubleshooting.md`, not to an outside specialist.

Escalating early with a bounded brief is cheaper than a third speculative fix. Say so to the owner
rather than framing escalation as a failure.

If a zero-cost diagnostic remains unrun and would plausibly isolate the failing layer — a public
DNS lookup the owner can run themselves, a header check on a received message — offer it alongside
the brief rather than instead of it. It costs the owner nothing, it might end the problem for free,
and if it does not, its result strengthens the brief.

Get Help mutates nothing. It produces a document.

## Sanitize first

The brief goes to someone outside the business. Before it leaves, remove:

- Credentials of every kind — passwords, tokens, API keys, integration keys, webhook secrets.
- Card, bank, and payment details.
- Location IDs, account IDs, and internal identifiers not needed to do the work.
- Real customer names, emails, phone numbers, and any personal data.
- Revenue figures and commercial terms not needed to do the work.

Screenshots normally come from the owner, not from you — you may have no browser authorization at
this point, and Get Help needs no account access. Give them the redaction instructions as a short
explicit list rather than expecting them to infer it: crop to the failing element, then check the
whole visible frame for the agency or account name, the sub-account switcher, the location ID, the
browser profile name and bookmarks bar, any notification popup, and any customer name in a
sidebar. Replace anything identifying with an obvious placeholder.

The account identifier never appears in the brief, and it is not collected from the owner in order to
leave it out — a specialist fixing one setting does not need it at all. Identity is established by
the comparison routes in `SKILL.md`, which never put the value anywhere.

State the platform as GoHighLevel and the surface involved. That is enough for a specialist to
judge fit without exposing the account.

## The brief

Include every section. A brief missing the acceptance test produces a job that cannot be closed,
and a brief missing existing state produces a specialist who rebuilds something that worked.

- **Exact problem and desired result.** What happens now, what should happen. Observable, not
  interpreted.
- **Narrow deliverable.** One outcome. Not "help with our CRM" — a single verifiable change.
- **HighLevel area involved.** The specific surface, so specialists can self-select.
- **Existing state.** What is configured, what has been tried, what was ruled out and how. Include
  the sanitized screenshots.
- **Required experience.** The specific capability needed, stated as experience with the surface
  rather than a seniority label.
- **Acceptance test.** The exact check that proves it is done, written so both sides read it the
  same way, and runnable by the owner without the specialist present.
- **Fixed-price milestone recommendation.** One milestone for a single deliverable; two or three
  for anything staged, each with its own acceptance test. Fixed price on a defined deliverable
  keeps scope honest on both sides.
- **Minimum temporary access.** Exactly what access is needed, at the narrowest level, for how
  long.
- **Credential-revocation and handoff checklist.** Below.

Write it so the owner can read it, understand it, and post it themselves.

## Access and revocation

Never recommend, and actively warn against: an agency-level login, the owner's own password, a
shared owner account, card or billing details, a permanent token, or access broader than the task
needs. A specialist fixing a DNS record does not need the ability to export the contact database.

**Domain and DNS work needs its own pattern**, because control of a domain is more dangerous than
CRM access — it can be used to take over both email and the website. Establish first where the
domain's DNS is authoritatively served, since that may be the registrar or an entirely separate
provider, and access to the wrong one accomplishes nothing while still handing out credentials.

Never hand over the login to either. Start with the specialist telling the owner the exact record
changes and the owner making them, or a screen share where the owner drives. Current public DNS
state can be read by anyone with no access at all, so diagnosis needs no credential. Only if direct
access is demonstrably required, use that provider's own delegated or sub-user access scoped to the
single domain's zone — never the master account.

Recommend instead:

- Delegated sub-account access only, scoped to the one sub-account.
- A separate temporary user created for this job, never a shared credential.
- The narrowest permission set that allows the deliverable, added only if the specialist
  demonstrates it is needed.
- Time-bounded access, agreed up front.
- Milestones with acceptance tests, so payment tracks verified delivery.

Handoff and revocation checklist, run immediately on completion:

1. Run the acceptance test yourself, in the account, before closing the milestone.
2. Obtain a written summary of what was changed, including anything changed outside the stated
   deliverable.
3. Remove the temporary user or revoke the delegated access.
4. Rotate any credential the specialist could have seen, and any the owner pasted anywhere.
5. Disconnect any third-party tool or integration the specialist connected and you do not intend
   to keep.
6. Review recent account activity for changes beyond the deliverable.
7. Confirm no automation now depends on the specialist's personal account, inbox, or domain.
8. Record what changed, so a future diagnosis knows this work happened.

Revoke on completion, not "soon". Access that outlives the job is the access that gets forgotten.

One ordering distinction: a *third party's* access is revoked immediately on completion, but the
owner's *own* credential is rotated only after its replacement is verified working. Revoking a
specialist early costs nothing; revoking the owner's own token before the new one works strands
them with no connection at all.

Use `assets/specialist-brief-template.md` as the starting structure so briefs stay consistent
between sessions and no required section gets dropped.

## Cost framing and honest limits

Upwork and Freelancer are two optional places to find one-off specialists. There are others,
including the owner's own network, and a referral from someone who has done this work is often
better than a marketplace listing.

Explain the economics honestly: focused one-off work on a well-specified deliverable can often
cost substantially less than an ongoing agency retainer, because the scope is bounded and the
acceptance test is defined. That is a reason to write the brief well, not a promise about price.

Never promise a price, a turnaround, availability, or quality. You do not control any of them.
Recommend the owner compare more than one candidate, ask for relevant specific experience, and
start with the smallest milestone that produces something verifiable.
