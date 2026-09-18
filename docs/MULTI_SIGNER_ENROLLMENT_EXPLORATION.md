# Shared Enrollment And Multiple Signers

Date: 2026-09-18
Status: Design exploration only. No implementation approved or included in the standalone-payment fix.

## The Simple Model

One purchased program, two participants, one designated payer. Each participant has their own contact/email and signs for themselves. Both belong to the same enrollment; this must not create two charges or two subscriptions.

An offer can eventually specify how many participant signatures are required, defaulting to one. Page 3 could collect the second person's name and email, show each signature's progress, and invite the second person to sign through their own restricted link.

Two name boxes filled in by one person would not establish that two different people reviewed and accepted the terms.

## What Exists Now

- `src/widgets/consent-capture/index.html` has one signature input.
- `src/controllers/enrollment.controller.ts` accepts one `digitalSignature` and one email for consent.
- `src/services/enrollment.service.ts` stores one signature, consent timestamp, device, IP, accepted clauses, and terms hash on the enrollment. It currently derives the client's name from that single signature.
- `src/services/pay-first-enrollment.service.ts` releases a paid-pending enrollment after that single consent submission.
- `src/services/enrollment-packet.service.ts` prints one signer and one set of consent details.
- Billing, pulse, milestone signoff, and workflow recipients are currently anchored to the enrollment's single contact.

## Smallest Coherent Build

1. Keep one enrollment as the shared program/purchase and one payer as the billing owner.
2. Add enrollment participants with contact ID, role, required-signature status, and email. Scope all participant lookups to the enrollment's location.
3. Record each acceptance separately: signer identity, acceptance time, exact terms/clauses version, IP/device context, and signature. Do not overwrite the first person's signature when the second signs.
4. Freeze the agreement version for that enrollment so both people see the same terms. Changed terms require an explicit new acceptance process.
5. Give each signer an individual, enrollment-bound action link. Verify control of the intended email through an appropriate confirmation flow; a typed name or shared link alone is not identity verification.
6. Show `Awaiting 1 of 2 signatures` and `All signatures received`. Completion must be idempotent: simultaneous signatures cannot create duplicate enrollments, welcome messages, or billing.
7. Produce one packet containing both acceptance records and the shared agreement. Distinguish who authorized payment from who agreed to participate.
8. Route receipts, refunds, card updates, and billing failures to the payer. Decide separately who receives program messages, pulse checks, and milestone requests.
9. Restrict private coaching responses. A participant's personal pulse answers or notes should not automatically be shared with their partner. Authorized merchant access and participant-facing access need separate rules.

## Decisions Needed Before A Build

- Must both sign before the payer can pay, or can payment come first with access withheld until both sign?
- Is one person always the payer? Supporting split payments would be a separate feature.
- Does each person complete their own pulse checks and milestone signoffs, or are those shared?
- What happens if the second person never signs, declines, or is replaced?
- Do changes/cancellation require one person's request or both? Contract wording needs merchant/legal review; software should not assume joint financial liability.

Recommended first scope: two adults, two separate emails, one payer, one program, separate signatures on a frozen agreement. Preserve existing single-person offers unchanged. No split billing, family accounts, minors/guardians, or generalized group enrollment in that first build.

## Proof Required

- Existing one-signer enrollment remains unchanged, including free, paid-first, and normal checkout.
- Both signing orders, simultaneous submissions, resend, expired link, wrong signer, and cross-tenant access.
- Second signature never renames the payer or overwrites their email/card.
- Exactly one payment schedule; no second charge caused by signature completion/retry.
- No premature welcome/access release; each message goes only to its intended recipient.
- Both consent records and agreement version appear accurately in the packet and evidence record.
- Partial signing, abandonment, cancellation, and participant replacement have defined outcomes.

This is a contained product feature, not a small checkbox change. It does not require a second HighLevel subaccount or a shared NMI gateway.
