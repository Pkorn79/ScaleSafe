# NMI Monthly Recovery - Release Tracker

## Position in the roadmap

This is an urgent Enrollments production-billing repair ahead of the unfinished
six-area release. It is not the six-area release, the remaining audit backlog,
or the separate Evidence product. Do not deploy the unrelated dirty primary
checkout or integrated certification candidate with this fix.

Branch: `codex/nmi-monthly-recovery`, isolated from production baseline
`d731c5f0a7c365a8f415aca26d9f867164d7fe7f`.

## Verified production facts

- Railway history places `5aa3b475d187db68707f2f744b729082ba3fd02a` between
  September 25 and October 2. Its NMI monthly/quarterly/annual request omits
  `day_of_month`. The current production baseline still omits it. This is not
  introduced by the October release work. October 1 exact rejection logs are
  no longer returned by the focused historical log query.
- Two active NMI enrollments have the explicit day-of-month rejection. Initial
  charges succeeded, but both subscription IDs and next billing dates are absent.
- The larger initial purchase includes a separately priced one-time add-on;
  do not include that add-on again in future installments.
- NMI Query API verified all three relevant initial/manual transactions. The
  oldest is settled; the two October 30 sales are approved/pending settlement.
- NMI's recurring report returned an empty `nm_response` for the exact bound
  gateway credential. Recheck immediately before any schedule creation.
- Three legacy active recurring records without processor labels were inspected:
  their linked events identify two Stripe and one NMI record. They have no saved
  subscription and misleading `ok` setup status. They are not additional proven
  occurrences of this specific rejection. Do not silently repair those records.
- Merchant GHL trigger deliveries also fail because premium actions are disabled
  for the subaccount. This is a separate notification-delivery problem, not the
  cause of the NMI request rejection. No GHL billing/settings change authorized.

## Local implementation

- Required NMI monthly billing day, preserving original day through February and
  other short months. Daily and weekly request fields remain unchanged.
- UTC calendar calculation clamps the initial next date instead of overflowing
  into the following month. Applied to checkout and pay-first creation paths.
- Ambiguous NMI timeouts, malformed responses and approval without an ID remain
  uncertain, not safe-to-retry failures.
- Checkout preserves its billing warning and original payment attempt after a
  successful charge with failed setup; no success redirect hides that warning.
- Failed/uncertain plans remain visible; unsafe lifecycle controls are disabled.
- Tenant-scoped persistent health observations, hourly recovery scan, escalation
  after 24 hours and immediate escalation for uncertainty. A failed scan does
  not resolve an incident and is reflected in job health.
- Additive migration `116_recurring_setup_health.sql` registers the health check.
  It changes no payment records. Never repeat migrations 107-112.

These are in-app/HQ incident records, NOT proof that an email or SMS was delivered.
An independent, reliable merchant/HQ delivery channel is still required. The
current GHL premium-action failure makes relying only on that channel unsafe.

## Verified local gates

- Full Jest: 227 suites, 2,074 tests passed (localhost-enabled run).
- Backend TypeScript: passed.
- Frontend TypeScript: passed.
- Frontend production build: passed.
- PGlite migration check: passed, including repeated application and the actual
  health-definition table constraints.
- Targeted tests cover required request fields, calendar month ends/leap years,
  uncertain results, tenant isolation, health persistence/read failures,
  pagination, warning visibility and preservation of the original payment attempt.

These are offline tests with controlled provider responses, not evidence of a
new live NMI subscription. No live test charge, refund, subscription creation,
customer message, or merchant message has occurred.

## Remaining release gates

1. DONE: restored and verified deployment database access; see deployment below.
2. Finish review of the health
   check against production schema/permissions. Do not assume a green Jest suite
   proves remote alert delivery or schema readiness.
3. Implement/configure and prove proactive merchant/HQ delivery and escalation.
   Keep unresolved incident state until processor and database agree.
4. Review the isolated diff, apply only the additive approved migration, build
   an exact candidate and deploy only that candidate. Verify deployment ID/SHA,
   startup, database access, health scan and checkout preview warning.
5. Execute individually approved financial repairs only after the checks below.
6. Verify future processor notifications, correct receipts and installment
   completion without changing program status, milestones or pulse cadence.

The GHL recurring-payment estimated-date path now uses the same clamped calendar
and original enrollment day for month-end estimates, with regression coverage.
It remains explicitly estimated, not proof of a processor schedule date.

## Safe repair sequence

Private client identifiers and transaction evidence remain in the authorized
incident context, not in this potentially public repository document.

1. Re-read exact merchant, enrollment, offer, accepted payment terms, original
   base/add-on line items, successful payments, refunds/voids and card ownership.
2. Re-query NMI's transactions and subscriptions immediately before repair;
   stop on uncertainty, duplicate schedule or changed payment status.
3. Allocate the already-approved manual payment to the correct enrollment
   exactly once. Preserve original payment source/transaction and add an audited
   allocation. Do not create a new charge, duplicate receipt, enrollment or welcome.
4. Infer future dates from the original monthly anchor, not the manual payment
   date. The October 1 three-payment plan has one remaining payment on December 1
   after the October 30 manual installment. The October 30 three-payment plan has
   two remaining payments on November 30 and December 30. These dates are inferred
   from recorded cadence, not a retrieved immutable exact-date agreement.
5. Present the amount, count and first date for explicit financial approval.
   Verify authorization evidence for the newer enrollment, whose stored consent
   fields were empty. Do not manufacture acceptance from current offer settings.
6. Create future-only finite processor schedules through the exact tenant-bound
   NMI configuration and verified saved card. No immediate/catch-up charge.
   Use a durable operation record and never retry an uncertain provider result.
7. Read the created schedule back from NMI; save exact subscription/config IDs,
   next date and setup state. If saving fails, retain the processor ID in the
   operation record and reconcile without creating another schedule.
8. Verify the payment count, remaining balance, visible UI and open program.
   Do not mark program completed/cancelled or change milestones/pulses.

## Access and changes

Brave and Railway CLI access were recovered in this session. The configured
Railway database key returned HTTP 401, while the prior running instance and the
known existing local service credential worked. Philip explicitly approved
restoring that credential to the existing `SUPABASE_SERVICE_KEY` variable.
The variable update succeeded without printing/storing new secrets or revoking
any key. Replacement deployment `1b41ae83-4a01-46fd-a50f-4b398db06c92` is SUCCESS,
still at `d731c5f`. The new configured database credential returns HTTP 200 and
the live health endpoint returns HTTP 200. This verifies infrastructure recovery,
not deployment of this billing fix. At that checkpoint no billing-fix code,
production SQL or financial repair had run; subsequent results are below.

October 30 logs from the former active deployment confirm that the new client's
card was persisted and processor subscription creation then failed. The older
client has a stored agreement PDF reference and signed installment consent. The
newer client has neither stored consent nor an agreement PDF nor evidence rows.
That is a real authorization-evidence gap, not an invitation to fabricate consent.

Philip asked that dates be deduced from enrollment records, rather than asking
him to calculate them. The derived dates above were explained. He subsequently
approved the repairs but requested a merchant question about the newer client's
authorization. The older client's manual-payment allocation and final schedule
were approved but not yet executed at that checkpoint. Hold the newer client's schedule until that
authorization is confirmed; general repair approval is not proof of consent.

The newer offer's stored checkout mode is `quick_checkout`, last updated before
this payment. Production logs at the payment time explicitly show `hasConsent:
false`, GHL contact upsert and `Quick Pay: offer enrollment created` for that
exact offer. This explains why the app has an enrolled record without a signed
agreement: it was Quick Checkout, not evidence that a required signature field
was bypassed in the full enrollment funnel. No separate enrollment/consent was
found for the matching contact/email in this tenant.

After this incident is closed, resume the six-area release from its existing
tracker; only then continue the remaining prioritized audit findings.

## Approved repair completed (October 30 local / October 31 UTC)

The older client's repair is now executed and verified, not just planned:

- The existing manual payment was linked in one locked database transaction.
  Preconditions guard the exact tenant, client, amount, transaction, unlinked
  state, existing payment count and processor configuration. An immutable audit
  receipt makes repeat execution a no-op. Eight local database tests passed,
  including mismatched tenant/contact/amount, pre-linked payment, cancelled
  program, existing schedule and audit-failure rollback.
- A fresh NMI read verified both payments, the original checkout vault and zero
  existing gateway subscriptions. Base-plan payments total $2,000; the separate
  one-time add-on is $1,000. Remaining obligation is one $1,000 installment.
- The fixed NMI client created exactly one future-only schedule for December 1,
  2026. A unique, durable provider-intent audit prevents resubmitting that create
  request, even if its response is lost. No immediate payment was requested.
- NMI's response nests amount/count under `subscription.plan`; the first
  readback correctly stopped before claiming success because it expected flat
  fields. No create retry was made. The existing schedule was read again using
  the observed response structure, confirming $1,000, one remaining payment,
  December 1 next charge, monthly day 1, zero attempts, zero completed payments,
  correct enrollment/location metadata, and exactly one gateway schedule.
- The official NMI subscription-created webhook independently linked the
  processor subscription ID. The approved repair then saved the verified date
  and changed setup state to `ok` without creating another schedule.
- Final database readback confirms 2 of 3 payments, enrolled/open program,
  unchanged milestones and pulse settings. No trigger delivery was recorded in
  this merchant during the repair window. Private identifiers and proof remain
  in the production audit and ignored local incident files, not this document.
- The newer client's schedule remains on hold pending the merchant's recurring
  authorization confirmation. No changes were made to that enrollment.

Additional local safeguards cover explicit NMI zero-count ongoing subscriptions,
uncertain responses in query-URL and ACH setup consumers, and failed persistence
of pay-first billing warnings. These application changes are NOT deployed yet.

## External alert delivery is not yet active

Read-only production checks returned zero `guardian_runs`, zero `alert_routes`,
and zero `alert_deliveries`. The repository contains an isolated Guardian/GHL/
Better Stack certification design, but that is not production delivery proof.
The Railway app has no independent email-sender configuration identified.
An attempted read of the documented private Guardian repository was unavailable;
this does not prove the repository does not exist under another owner.

The new recurring-setup health check records durable HQ incidents and escalation;
merchant payment/reconciliation views retain unresolved plans. Neither is an
email or SMS delivery claim. Activating and proving the operational notification
route remains unfinished and needs a separately approved test message. Do not
route these alerts through customer payment-failed or pulse workflows.

## Release certification and approval

Final local checks passed: 227 Jest suites / 2,083 tests, backend typecheck,
UI typecheck, production UI build, migration 116 idempotency test, and eight
private allocation safety tests. These are local results, not a deployment claim.

Philip explicitly approved the single billing-warning definition and production
deployment after these checks. Migration 116 was applied once to the production
project, and a separate read confirms `merchant.recurring_setup`, contract
`recurring-setup-v1`, hourly cadence and urgent default severity. No migrations
107-112 were rerun. This does not activate any outbound message delivery.

Application publication and Railway verification are the next release gate.

## Primary references

- https://docs.nmi.com/reference/transactions-processing
- https://docs.nmi.com/reference/query
