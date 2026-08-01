# Troubleshooting: diagnose by layer before changing anything

## Contents

- Diagnose before you change
- Capture the failure
- Work the layers in order
- Common HighLevel failure patterns
- Common ScaleSafe failure patterns
- The sanitized escalation record
- When to stop and escalate

## Diagnose before you change

An unexplained failure plus a speculative fix produces two problems and no information. Find the
failing layer first, then change one thing.

Diagnosis is Audit work: read, do not change. If it genuinely requires a change — sending a test
message, creating a `DEMO - ` record — that is a separate approval with fictional data, and say why
it is necessary.

Never fix by rebuilding. Rebuilding destroys the evidence of what was wrong and frequently
reproduces the same defect with new names. Never apply successive speculative fixes, and never
resolve a missing-account-context error by selecting a different sub-account.

## Capture the failure

Before touching anything, record: the confirmed sub-account by name; the exact timestamp and
timezone; what the owner did and expected; what they actually saw, in their words, plus the exact
on-screen message; whether it happened once, intermittently, or every time; and what changed
recently — a new workflow, an edited form, a domain change, a plan change, an expired card, a
reinstall.

"It stopped working" almost always has a recent change behind it. Ask what changed before
theorising.

## Work the layers in order

Confirm each layer before suspecting the next. Most reported failures are two layers earlier than
where the owner is looking.

1. **Account.** Is this the sub-account you both think it is?
2. **Asset exists and is active.** Workflow published and active, form live, page published,
   calendar enabled, offer active.
3. **App installed and provisioned**, for anything ScaleSafe-related.
4. **Trigger.** Did it match? Zero executions means the trigger never fired — the defect is in
   trigger configuration or field mapping, not workflow logic.
5. **Eligibility and exclusions.** Excluded, already enrolled, or blocked by re-entry rules?
6. **Branch condition.** Unexpected branch because a field was empty or a tag missing?
7. **Action execution.** Errored, or waiting on a delay or send window?
8. **Channel capability.** Verified sending domain, approved registration, provisioned number,
   funded wallet, connected processor?
9. **External result.** Sent, delivered, and did it reach the inbox rather than spam? Did the
   processor actually charge?
10. **Record linkage.** Did the result attach to the correct contact, opportunity, and enrollment?

Read execution history rather than reasoning from the builder view. The builder shows intent;
history shows what happened.

## Common HighLevel failure patterns

- **Zero executions after a submission.** Trigger mismatch, or the form writes to a different field
  than the workflow reads. Check the resulting contact record, not the form builder.
- **Empty values from a URL.** A hidden field key not matching the URL parameter exactly, including
  case. The form saves successfully with an empty value, so nothing looks wrong.
- **Branch never taken.** The condition tests a field the form does not populate, or a duplicate
  custom field with a near-identical name.
- **Messages much later than the configured delay.** A send window held the action.
- **SMS silently not sending.** Registration not approved, no provisioned number, no consent, or an
  empty wallet. Check all four before suspecting workflow logic.
- **Email delivered but in spam.** Sending domain unverified, or verified but with no sending
  history. Verification passing does not mean inbox placement.
- **Double messaging.** Two active workflows with overlapping triggers, often one inherited and
  forgotten.
- **Tag-based re-trigger not firing.** Some tag triggers fire only on first application.
- **Wrong timezone on everything time-related.** Left from whoever built the account.
- **Right contact, wrong opportunity.** A contact with several opportunities, and the automation
  acted on the newest rather than the relevant one.

## Common ScaleSafe failure patterns

- **App will not open, or shows an account chooser.** Confirm the intended sub-account rather than
  the agency view. Missing trusted location context is never permission to choose another account,
  and is not by itself a reason to reinstall.
- **Checkout or enrollment will not load.** Confirm an active offer, plan entitlement, processor
  ownership and configuration. Do not resubmit after an ambiguous timeout — check reconciliation
  state first.
- **Payment missing or misclassified.** Compare the processor transaction, the payment record, the
  enrollment, and any subscription record. Confirm contact identity and offer details. Never borrow
  another program belonging to the same contact, and never repair before processor truth is known.
- **Workflow did not send.** Prove separately: app trigger delivery, workflow entry, action state,
  communication record, inbox delivery. Check re-entry, send windows, removed trigger
  subscriptions, and merge fields. A message rendering as an object placeholder rather than text
  means the workflow used a structured value where a simple field was required.
- **Pulse missing or too frequent.** Confirm offer cadence, offer active state, enrollment status,
  next due time, filters, re-entry, and send window. Distinguish already-queued executions from
  newly scheduled ones. Archiving an offer must stop its enrollment pulse schedules.
- **Evidence unlinked.** The system cannot prove one exact enrollment. Check explicit enrollment
  selection, provider identity, the mapped resource, and overlapping program dates. Never default to
  the newest enrollment; unlinked evidence stays out of enrollment-scoped defense material.
- **Provider connected but no evidence.** Confirm a qualifying event was actually observed and
  resolved to one contact and enrollment. Authorization success alone is not evidence publication.
- **Defense held for review.** Read the stated reasons and check the selected transaction,
  enrollment scope, reason code, chronology, delivery proof, signed packet, and amounts. Do not
  clear the hold by marking it submitted.
- **App slow or unavailable.** This is a platform-side incident rather than an account
  configuration error. Confirm the symptom, note the timestamp, and escalate — do not reinstall, do
  not reconnect the processor, and do not retry a payment.

## The sanitized escalation record

When the failing layer sits inside the platform rather than the account, the owner needs to escalate
to the vendor. Prepare the record for them, containing: timestamp and timezone; the sub-account by
name; the visible screen and exact message; the offer, program, or enrollment reference where it is
safe to include one; the action attempted; expected versus actual result; and whether retrying could
duplicate money or a communication.

Exclude credentials, card data, location identifiers, and real customer personal data. Crop
screenshots to the failing element and check the whole frame before sending.

Flagging whether a retry could duplicate money matters more than anything else in the record. It is
the difference between the vendor safely re-running something and charging a customer twice.

## When to stop and escalate

Stop and switch to Get Help — `references/specialist-brief.md` — when the failing layer is outside
your reach, such as DNS host behaviour or a carrier rejection; when two diagnostic attempts have not
identified the failing layer; when the fix needs custom code, broader access, or an irreversible
change you cannot verify first; or when the blocker is a platform limitation rather than a
configuration error.

Say plainly which layer you proved, which you could not, and what a specialist would need. A bounded
blocker reported honestly is a better outcome than a confident wrong fix, and costs the owner far
less.
