# ScaleSafe Live Walkthrough Findings

Status: Open working list from the 2026-07-12 product walkthrough and the owner-authorized live certification that followed it.

The later certification created isolated test offers, payments, evidence, a client note, and a client email. Processor and workflow configuration was not changed without owner approval.

## Triage Summary

| ID | Area | Recommended Priority | Verification | Likely Effort |
| --- | --- | --- | --- | --- |
| FIND-001 | Defense exhibits | P1 | Fixed and passed legacy plus regenerated live packets | Small/medium |
| FIND-002 | Settings dirty state | P2 | Fixed and passed live | Small |
| FIND-003 | Pulse diagnostics | P1 | Fixed and passed live | Small/medium |
| FIND-004 | Stripe health defaults | P1 | Fixed and passed live | Small |
| FIND-005 | QMS loading state | P2 | Fixed and passed live | Small |
| FIND-006 | GHL enrollment matching | P1 investigation | Live data confirmed | Medium/large |
| FIND-007 | NMI signed webhook | P1 configuration/certification | Live database confirmed | Setup plus live test |
| FIND-008 | Product status copy | P3 | Live confirmed | Small |
| FIND-009 | Concatenated headings | P3 | Live confirmed | Small |
| FIND-010 | Whop offer processor label | P2 | Live and code confirmed | Small |
| FIND-011 | Stripe evidence-vault keying | P1 | Fixed locally; live retest pending | Small/medium |
| FIND-012 | Successful payment-event enum mismatch | P1 | Fixed locally; live retest pending | Small |
| FIND-013 | Stale GHL trigger subscription | P1 configuration | Live confirmed | GHL cleanup plus retest |
| FIND-014 | Pre-enrollment communications remain unlinked | P1 investigation | Live confirmed | Medium |
| FIND-015 | Stripe defense-vault webhook ordering | P1 | Fixed and passed live | Small/medium |
| FIND-016 | Signed packet URL in logs | P1 | Fixed and passed live | Small |
| FIND-017 | Generic Stripe offer description | P1 | Fixed and passed live | Small |
| FIND-018 | Repeat checkout idempotency | P1 | Fixed and passed live | Small |
| FIND-019 | Stripe evidence-chain vault lookup | P1 | Fixed and passed live | Small |
| FIND-020 | Whop checkout phone scope | P1 | Fixed locally; live retest pending | Small |
| FIND-061 | Stripe health processor isolation | P1 | Live, database, and code confirmed | Small |
| FIND-062 | Stripe risk-audit API/UI contract | P1 | Live, database, and code confirmed | Small |
| FIND-063 | Active-dispute queue filtering | P2 | Live and code confirmed | Small |
| FIND-064 | Connector event-history schema query | P1 | Railway and code confirmed | Small |
| FIND-065 | Client-action success refresh | P2 | Live confirmed | Small/medium |
| FIND-066 | Manual communication enrollment binding | P1 | Live and code confirmed | Medium |
| FIND-067 | Production database capacity collapse | P1 | Supabase, Railway, browser, and code confirmed | Immediate operations plus code hardening |
| FIND-068 | Production database has no recoverable backup | P1 | **Resolved 2026-07-21:** managed backup plus encrypted off-platform backup and scratch restore proven | Closed |
| FIND-069 | Database outage mislabeled as broken GHL install | P2 | Reviewer UI, Railway, and code confirmed | Small/medium |
| FIND-070 | Railway and Supabase are deployed in distant regions | P2 | Railway deployment metadata and Supabase project confirmed | Operations change plus latency retest |
| FIND-071 | Suggested local database-password file was not ignored | P2 | Current tree and Git ignore rules confirmed | Fixed locally |
| FIND-072 | Unprotected main auto-deploys directly to production | P2 | GitHub branch API and Railway deployment metadata confirmed | Owner-approved release-control change |
| FIND-073 | Reviewer Snapshot packages obsolete and duplicate GHL assets | P2 | Clean reviewer install and current Snapshot contract compared | Rebuild and certify clean V2 Snapshot |
| FIND-074 | Installed GHL Custom Page SSO handshake timeout | P1 | Reviewer, PMG, preview, and client/backend boundary compared | Focused code repair plus installed-page retest |
| FIND-075 | Marketplace scope configuration drift | P2 configuration | Draft selection compared with approved product direction | Exact export, runtime map, owner-approved reduction |

## Confirmed Code-Backed Findings

### FIND-001 - Defense Exhibits tab is never populated

- Area: Defense
- Impact: The generated letter and PDF can contain exhibits while the on-screen Exhibits tab says `0` and `No evidence exhibits available`.
- Live proof: Existing Mastercard 4855 packet references Exhibits A-D and has a five-page PDF; its Exhibits tab shows zero.
- Code proof: `DefenseDetailView.vue` declares `exhibits` and passes it to `ExhibitsTab`, but `refresh()` only assigns the packet response and never assigns exhibit data.
- Severity recommendation: P1 for beta trust/operability.
- Required regression: Open a compiled packet and verify the UI exhibit list matches the PDF exhibit index and packet evidence count.
- Root cause confirmed: legacy packets stored a contact-wide raw array while regeneration rebuilt the scoped letter/PDF without replacing that old snapshot. Commit `666151b` now freezes the regenerated exhibit set and gives submitted legacy packets an honest PDF-count notice instead of relabeling raw timeline rows.
- Live retest: submitted packet `a2d357fa-a9ee-439d-8a61-1c198fbc5302` reports `Evidence Exhibits (8)` and directs the merchant to its frozen PDF. Pre-submission packet `13971614-ca2d-4107-931e-41be587a5446` regenerated to Version 2 and displayed the same four exact exhibits used by its letter and PDF.

### FIND-002 - Settings always claims there are unsaved changes

- Area: Merchant Settings
- Impact: A merchant who only opens Settings is told changes are unsaved, which makes it unclear whether navigation is safe.
- Live proof: `Unsaved changes` appeared immediately after a read-only page load.
- Code proof: `SettingsView.vue` passes `:dirty="true"` to `StickySaveBar` unconditionally.
- Severity recommendation: P2.
- Required regression: Fresh page load shows `All changes saved`; changing one field shows `Unsaved changes`; successful save resets the state.

### FIND-003 - Pulse diagnostics request fields the backend never returns

- Area: Provisioning Health / Pulse
- Impact: Health reports `Last outbound observed: never` and `Last client submission: never` even when the client timeline contains pulse emails and a submitted pulse response.
- Live proof: Phil Kay has pulse communications and a Jul 7 pulse submission; Settings reports both as never.
- Code proof: `SettingsView.vue` renders `recentPulseOutboundObservedAt` and `recentPulseSubmittedAt`, but `merchant.service.ts#getPulseReadiness` does not return either field.
- Severity recommendation: P1 because the diagnostic can falsely report a broken live workflow.
- Required regression: Deliver pulse app event, observe outbound communication, submit response, and verify all three timestamps independently.

### FIND-004 - Missing Stripe health states default to Safe

- Area: Stripe Risk Health
- Impact: The page can display a large dispute rate with `Account Risk Level: UNKNOWN` while Visa and Mastercard each display `Safe`.
- Live proof: Test account displayed 41.18%, UNKNOWN, Visa Safe, and Mastercard Safe simultaneously.
- Code proof: `StripeRiskHealth.vue` uses `healthSnapshot.vamp_status || 'safe'` and `mc_status || 'safe'` while separately defaulting a missing risk level to unknown.
- Severity recommendation: P1 because this is misleading account-health guidance.
- Required regression: A partial or legacy snapshot with missing derived statuses displays `Unknown / refresh required`, never Safe.

### FIND-005 - QMS shows a false processor error while loading

- Area: Quick Manual Sale
- Impact: A merchant can see `No processor is configured` for several seconds even though Stripe and NMI are connected. This matches the intermittent behavior previously reported during demos.
- Live proof: Modal first showed the error; approximately two seconds later it populated offers and card fields without a refresh.
- Severity recommendation: P2.
- Required regression: While configuration is pending, show `Loading payment methods...`; show the configuration error only after a completed empty response.
- Live retest passed: the Richard Schneider QMS modal first showed `Loading payment fields...`, then populated all active offers and card fields without displaying the false processor error.

## Operational or Data Findings

### FIND-006 - GHL Fulfillment has a large unresolved-event backlog

- Live state: 29 matched, 121 unresolved, 0 failed.
- Meaning: Events are being captured, but many cannot be defensibly assigned to one program.
- Classification: Requires matching-quality review and a clean-fixture certification before classifying as a code defect. Merchants must not be expected to repair events one by one.

### FIND-007 - NMI official webhook setup is still marked manual/setup-required

- Live database proof: the active/default NMI configuration has a webhook key, callback URL, and 15 configured event types, but status is `manual_setup_required`, `lastVerifiedAt` is null, and there is no stored webhook error.
- Event proof: the most recent 100 NMI diagnostic rows include 25 `nmi_event` rows. None has `signature_verified = true`. Older sale events were transaction-verified; subscription/refund events include the message that no Signature header was present and fallback verification/matching was used.
- Conclusion: this is not merely stale UI copy. The signed official webhook path has never been certified for this location.
- Classification: Configuration and live-certification requirement. Review current NMI webhook configuration, then prove one signed callback before calling the channel complete.

### FIND-008 - Roadmap and payment-setting labels contain stale capability states

- Examples: Stripe Defense Layer is shown as Coming Soon while Defense is live; ACH appears inside a coming-options block even though ACH is a beta payment capability.
- Classification: Documentation/product-status drift.

### FIND-009 - Section headings concatenate words

- Examples: `Yourclients.`, `Merchantsetup.`, `Stripehealth.`, and `Chargebackcases.`
- Classification: Visual/text rendering defect.
- Severity recommendation: P3.
- Required regression: SectionHeader renders multi-part titles with visible spacing at desktop and mobile widths.

### FIND-010 - Whop offers are labeled `Default` in the Processor column

- Area: Offers list.
- Impact: A merchant cannot tell from the offer inventory that an offer is routed to Whop; the table presents the channel as `Default`, which can lead to incorrect checkout expectations during setup or support.
- Live proof: `CERT 2026-07-13 Whop Choice` synchronized successfully to Whop with stored product and plan IDs, but its Processor cell displays `Default`.
- Code proof: `OffersView.vue` derives the badge only from `processor_override` and has no branch for `checkout_type === 'whop'`.
- Severity recommendation: P2 operational correctness.
- Required regression: Direct default, direct NMI, direct Stripe, Whop, and FanBasis-ready offers each display their actual checkout channel or processor truthfully.

### FIND-011 - Stripe `charge.succeeded` keys the evidence vault by Charge ID instead of PaymentIntent ID

- Area: Stripe payment evidence and dispute lookup.
- Live proof: The isolated Stripe PIF payment produced a vault row whose `stripe_payment_intent_id` contained a `ch_...` value. Looking up the row by the actual `pi_...` returned nothing.
- Code proof: `handlePaymentSuccess()` passed a raw Charge object to `createVaultEntryFromWebhook()` because its Charge branch condition could not be true for a normal Charge carrying a PaymentIntent.
- Impact: Later dispute and CE 3.0 evidence lookup by PaymentIntent can miss the transaction's Stripe evidence row.
- Severity recommendation: P1 for chargeback-defense integrity.
- Local repair: Normalize `charge.succeeded` into a PaymentIntent-keyed record, retain the Charge object as `latest_charge`, enrich the payment ledger, and return `500` when evidence persistence fails so Stripe retries.
- Required regression: Process one new Stripe card payment and confirm the vault row has `pi_...` in `stripe_payment_intent_id`, `ch_...` in `stripe_charge_id`, and the matching payment event receives the Charge ID and masked card metadata.

### FIND-012 - Paid enrollment completion writes an event type rejected by the live database

- Area: Payment ledger and GHL payment webhook handling.
- Live proof: The Stripe PIF checkout succeeded and created its canonical `sale` row, but Railway logged `Payment event insert failed` with `payment_events_event_type_check` during `completeEnrollment()`.
- Code proof: `phase2Enrollment.service.ts` and legacy GHL payment handlers wrote `payment_success`, while the migration-backed constraint permits canonical ledger event types such as `sale`, `refund`, and `subscription_payment`.
- Impact: Duplicate enrollment-completion writes create error noise; GHL-only payment paths can silently lose their only payment event.
- Severity recommendation: P1 because an affected core path can lose ledger state.
- Local repair: Use canonical `sale`, skip the redundant completion write when checkout or settlement already created the ledger row, and skip payment events for genuinely free enrollments.
- Required regression: New Stripe enrollment has exactly one `sale` row and no constraint error; a GHL payment webhook creates a valid `sale` row.

### FIND-014 - Client communications are not reliably linked to the active enrollment

- Area: Communication evidence and defense scoping.
- Live proof: The isolated client received an enrollment link before checkout. Both the ScaleSafe send record and the observed GHL outbound email were created with `enrollment_id = null`; both remained null after the exact offer enrollment completed. A later email sent from that same client's ScaleSafe profile was captured successfully by GHL and ScaleSafe, but the Evidence tab again showed `Link to Program` even though the client had exactly one active enrollment.
- Code/UI proof: The Send Message form captures channel and body only. It does not carry an enrollment or offer context, so the GHL echo is stored as contact-level communication unless a separate matcher can prove a program.
- Impact: Enrollment-scoped defense generation may omit the enrollment link and direct merchant communication, or include them only as lower-confidence contact context, even when the merchant sent them from the active client's record.
- Classification: P1 evidence-linkage defect. Newest-enrollment guessing remains prohibited, but the one-active-enrollment case and explicit program selection can be handled deterministically.
- Required regression: The merchant can select or inherit one exact active enrollment before sending. The outbound communication and GHL echo link to that enrollment once. Multiple eligible enrollments require an explicit choice; no communication is silently attached to the newest enrollment.

### FIND-013 - One deleted GHL trigger subscription still receives enrollment-complete deliveries

- Live proof: The isolated Stripe PIF enrollment sent `enrollment_complete` successfully to one subscription, then retried a second subscription four times before GHL reported that its trigger ID had been deleted.
- Impact: Every enrollment completion incurs avoidable retries, log noise, and approximately one minute of background work; diagnostics can report a workflow failure even though the active workflow succeeded.
- Classification: P1 configuration/operations gap, not a processor defect.
- Required action: Identify and remove only the stale subscription after owner approval, then prove one successful `enrollment_complete` delivery with no failed sibling delivery.

### FIND-015 - Sparse first Stripe webhook leaves defense-vault metadata incomplete

- Area: Stripe evidence vault and dispute readiness.
- Live proof: The repaired Stripe installment test correctly keyed the vault row by PaymentIntent and retained the Charge ID, but the row still had no `offer_id`. The endpoint observed only the Charge event during the certification window, so the later PaymentIntent gap-fill could not be relied upon.
- Code proof: New webhook rows did not write `offer_id`, customer name, or billing address, and the existing-row gap-fill updated only Charge/fingerprint fields.
- Impact: Offer-scoped evidence refresh and dispute preparation can miss a valid Stripe transaction even though the payment ledger is correct.
- Severity recommendation: P1 for defense integrity.
- Local repair: Derive all safe defense fields from the canonical metadata and fill missing fields regardless of webhook arrival order.
- Required regression: A new Stripe transaction must produce a vault row with matching `pi_...`, `ch_...`, offer ID, customer identity, consent/IP metadata, and no cross-tenant lookup.

### FIND-016 - Background enrollment logging exposes signed private packet URLs

- Area: Production logs and private evidence files.
- Live proof: Railway logged the complete signed Supabase enrollment-packet URL, including its temporary bearer token, after packet generation.
- Impact: Anyone with production-log access during the URL lifetime could open a private enrollment packet without ScaleSafe authorization.
- Severity recommendation: P1 security hardening.
- Local repair: Log only the enrollment ID and a boolean that confirms storage succeeded.
- Required regression: Packet generation succeeds and no deploy log line contains `/object/sign/`, `token=`, or a signed packet URL.
- Live retest: STRIPE-PIF-002 generated the packet successfully on `728eff6`; the deployment contained zero `/object/sign/` or `token=` messages and logged only the private storage path plus `packetStored: true`.

### FIND-017 - Direct Stripe checkout stores a generic offer description

- Area: Stripe evidence vault and dispute evidence descriptions.
- Live proof: STRIPE-PIF-002 linked the correct offer ID, but both `offer_title` and `offer_description` were stored as `ScaleSafe Payment` instead of `CERT 2026-07-13 Stripe PIF` and its program description.
- Code proof: direct widget checkout often has no GHL `productDetails`, so `checkout.controller.ts` passed the fallback label to the processor even though `resolvedOffer` already contained the tenant-scoped offer.
- Impact: Stripe dispute evidence and unrecognized-transaction explanations can describe the purchase generically instead of identifying the program the customer actually bought.
- Local repair: send the resolved offer name and program description in Stripe metadata and allow the webhook normalizer to replace the historical generic placeholder with richer metadata.
- Required regression: one new direct Stripe checkout stores the exact offer title/description in its PaymentIntent metadata and evidence-vault row.

### FIND-018 - A completed standalone checkout blocks a later repeat purchase

- Area: Quick checkout and full-enrollment payment idempotency.
- Live proof: A second Stripe PIF enrollment for the same offer and email reached checkout with a new consent token, but ScaleSafe rejected it before Stripe with `The payment operation key was reused with different request details.` No duplicate processor charge occurred.
- Code proof: the standalone checkout stored its attempt ID in `sessionStorage`, scoped it without the consent/evidence enrollment context, and never removed it after a confirmed success.
- Impact: a legitimate repeat buyer using the same browser, offer, amount, and email can be unable to complete a second enrollment.
- Local repair: add the consent/evidence context to the browser attempt scope and clear the stored attempt only after the server confirms success. Declines remain explicitly resettable, while ambiguous failures keep the original key for reconciliation safety.
- Required regression: complete the same offer twice in one browser with two distinct enrollments; both charge once, while duplicate submission and ambiguous-result protection remain intact.

### FIND-019 - Stripe evidence-chain verification queries a nonexistent tenant column

- Area: Enrollment/payment evidence-chain verification.
- Live proof: the repaired repeat Stripe checkout produced a correct payment and matching vault row, but background verification reported strength 70 and `complete: false`.
- Code/data proof: `evidence-chain.service.ts` added `.eq('location_id', ...)` to `stripe_evidence_vault`; the live table has no `location_id` column and is tenant-owned through `merchant_id`.
- Impact: Stripe chains omit a valid vault link and are reported incomplete even when the transaction evidence exists.
- Local repair: derive the trusted merchant from the payment event or its location, then match PaymentIntent plus `merchant_id`. Never fall back to an unscoped vault lookup.
- Required regression: the exact live payment links its vault row, reaches strength 90 without a GHL order, and a vault row owned by another merchant is rejected.
- Live retest: deploy `b7b2b27` returned `complete: true`, strength 90, no gaps, and verified consent, IP, payment, and merchant-owned vault links for payment event `95ab89f8-5a18-431e-87a8-830e18a62e02`.

### FIND-020 - Whop embedded checkout references an out-of-scope phone variable

- Area: Public Whop checkout session creation.
- Live proof: the isolated paid-in-full Whop cart calculated the correct $2.50 total, but clicking Continue displayed `custPhone is not defined` and no Whop session or payment was created.
- Code proof: `renderWhopCheckout()` serialized `contactPhone: custPhone` without accepting or defining `custPhone` in its scope.
- Impact: every Whop embedded checkout can fail before the hosted payment form loads.
- Local repair: pass the collected phone value explicitly through both automatic and button-driven Whop session paths.
- Required regression: both full-enrollment and quick-checkout Whop paths load the hosted form; PIF plus add-on charges $2.50 and records the correct client, enrollment, line items, `pay_` ID, and evidence.
- Live retest: deploy `f394c7a` loaded the embedded Whop form and completed the exact $2.50 PIF-plus-add-on cart. FIND-021 records the separate post-payment billing-state defect discovered by that test.

### FIND-021 - Whop webhook replaces the selected PIF choice with the offer default

- Area: Whop checkout completion and enrollment billing state.
- Live proof: Whop charged the selected one-time $2.50 cart and the canonical payment event is marked non-recurring, but enrollment `30157c7f-b97d-4cf5-a4df-4de18190e513` was saved as installment with two payments and a July 20 next-billing date.
- Code proof: the checkout service created a one-time Whop plan with `future_recurring_amount = 0`, while `whop-webhook.controller.ts` completed the enrollment using `paymentTypeForOffer(offer)` and `paymentsTotalForOffer(offer)`. Those helpers read the offer's default installment shape rather than the customer choice bound at consent/checkout.
- Impact: a paid-in-full customer can appear in recurring-plan management, receive incorrect reminder/billing expectations, and leave misleading payment-progress evidence even though Whop will not renew that one-time plan.
- Severity recommendation: P1 billing-state integrity.
- Local repair: carry normalized `payment_choice` in signed Whop metadata; resolve checkout type from that metadata, legacy future-recurring metadata, or the exact enrollment before falling back to the offer; keep one-time Whop access memberships separate from processor subscriptions; and allow duplicate successful-payment delivery to reconcile state without repeating side effects.
- Required regression: PIF on an installment-capable Whop offer remains PIF with no next billing; installment selection retains the correct payment count and next billing; membership activation cannot make a PIF enrollment recurring; duplicate replay creates no second payment or workflow event.
- Live retest: deploy `699cfa5` preserved the selected PIF state on enrollment `fabbebc5-f4e8-41d2-a4dc-b9e841ae347a`: one $2.50 Whop sale, exact $1.50 base/$1.00 add-on line items, `payment_type = pif`, no payment count, no next billing date, no processor subscription ID, and the Whop membership retained only as the access identity. FIND-022 records the separate completion-timestamp gap found in this retest.

### FIND-022 - First Whop PIF webhook does not stamp billing completion

- Area: Whop PIF enrollment state.
- Live proof: `WHOP-PIF-002` correctly remained PIF with no recurring state, but `billing_completed_at` was null after the first successful webhook.
- Code proof: the Whop reconciliation helper stamped billing completion only when an existing payment event made the webhook a duplicate. The first webhook called the shared completion service with the intentional PIF representation `payments_total = null`, which did not satisfy that service's finite-plan completion condition.
- Impact: the paid-in-full state is functionally non-recurring, but downstream reporting and future billing-completion consumers receive an incomplete lifecycle record.
- Severity recommendation: P2 data-state correctness.
- Local repair: run Whop checkout billing reconciliation after both first-time completion and duplicate recovery.
- Required regression: the first PIF webhook sets `billing_completed_at`; installment checkout does not set it until the plan is actually paid off; duplicate delivery remains side-effect-free.

### FIND-023 - Re-running the daily health job collides with its own snapshot uniqueness constraint

- Area: scheduled account-health operations.
- Live proof: Railway reported a unique-key violation for `(merchant_id, processor, snapshot_date)` and counted one merchant as failed during the July 13 health run because that day's Stripe snapshot already existed.
- Impact: a restart or second scheduled execution produces false health failures and can skip remaining per-merchant work even though a valid snapshot already exists.
- Severity recommendation: P2 reliability/operations.
- Local repair: save Stripe and NMI daily snapshots through the existing `(merchant_id, processor, snapshot_date)` uniqueness boundary so a same-day rerun updates the one snapshot instead of failing.
- Required regression: two health runs on the same merchant, processor, and date update or reuse one snapshot without an error or failed-merchant count.

### FIND-024 - Repeat purchases combine exact-enrollment payment totals

- Area: Client Programs and payment aggregation.
- Live proof: the certification client purchased the same Whop offer twice. Each payment event has the correct distinct `enrollment_id`, but both program cards displayed the combined $4.00 paid total.
- Code proof: the client aggregation accepted an exact enrollment match, then independently allowed same-contact/same-offer fallback matching for every sibling enrollment.
- Impact: repeat buyers receive false program balances and progress; the same contamination can misstate enrollment-scoped evidence.
- Severity recommendation: P1 payment and defense-record integrity.
- Local repair: make exact enrollment and unique processor subscription/membership matches authoritative. Use contact-plus-offer only when exactly one enrollment qualifies; never choose among repeat enrollments.
- Required regression: two enrollments for the same contact and offer each show only their own exact payment. An ambiguous legacy event remains unmatched.

### FIND-025 - Saved NMI methods cannot be distinguished before charging

- Area: Payment Management and Quick Manual Sale saved methods.
- Live proof: Phil Kay has two saved NMI methods, and both the method list and charge modal label each only as `NMI mc`. Read-only database verification found `card_last_four = "****"` for the historical NMI methods.
- Impact: an operator cannot prove which vault is the authorized card ending 5321 and could charge the wrong customer card.
- Severity recommendation: P1 money safety. The live test was stopped before any charge.
- Required remediation: recover safe card metadata through NMI Query API where available and make unknown metadata visibly distinct. A vault suffix may distinguish records operationally, but it must not be represented as card last four.
- Required regression: the authorized ending 5321 method is uniquely identifiable before a sub-$3 test charge; the resulting transaction is then refunded and reconciled.

### FIND-026 - Whop Quick Manual Sale bypasses post-payment consent

- Area: Whop QMS, enrollment status, evidence, and welcome workflow gating.
- Live proof: Whop payment `pay_02eWnx8JuojsJQ` was launched from QMS with the paid-enrollment-link option enabled. Enrollment `9520c085-1ae7-41eb-b686-2962d2fd7389` moved directly to `enrolled`, generated a packet, and fired `enrollment_complete`, although it had no digital signature, consent token, or consent evidence.
- Code proof: the QMS Whop session was labeled `quick_checkout`, so the payment webhook followed ordinary checkout completion and called `completeEnrollment()`.
- Impact: ScaleSafe can send access/welcome and present an enrollment as consented when the client has not accepted or signed the paid-enrollment packet.
- Severity recommendation: P1 core consent/evidence integrity.
- Local repair: pre-create the exact QMS enrollment, mark Whop metadata as `quick_manual_sale`, record the payment, leave the enrollment `paid_pending_enrollment`, send the signed paid-enrollment link, and fire only receipt/link triggers. The ordinary completion path remains blocked until the client signs.
- Required regression: after a fresh Whop QMS payment, no packet, signature, consent evidence, or `enrollment_complete` exists. Completing the paid-enrollment link then creates those artifacts once and fires the correct welcome once.

### FIND-027 - Paid enrollment completion omits the signed packet and chain verification

- Area: QMS paid-enrollment consent completion for Stripe, NMI, and Whop.
- Live proof: repaired Whop QMS enrollment `1d38c33a-c316-4b1c-a114-0cd636a6810d` correctly stayed `paid_pending_enrollment` after payment and moved to `enrolled` only after signature. It then had enrollment-scoped payment and consent evidence, but `packet_pdf_path` remained null and no new packet record or packet-generation log appeared.
- Code proof: `finalizePaidPendingEnrollment()` synchronized GHL fields, initialized pulse cadence, and fired `enrollment_complete`, but never called `enrollmentPacketService.generateAndStore()` or `evidenceChainService.verifyChain()`.
- Impact: QMS can report a signed, completed enrollment and send welcome/access while the central signed enrollment packet needed for defense is absent.
- Severity recommendation: P1 evidence integrity.
- Local repair: start packet generation and chain verification in an independent background task immediately after consent evidence is committed. Do not let GHL trigger retries delay that work.
- Required regression: a fresh QMS payment has no packet before consent; after consent, the private packet path and chain verification appear once even when one GHL subscription is stale.

### FIND-028 - Standard clauses lose their identity and PIF customers accept installment terms

- Area: Public consent widget and GHL click-wrap evidence.
- Live proof: the $1.50 PIF Whop QMS enrollment required all nine acknowledgments, including `Installment Billing`, despite displaying `Payment received` and the correct paid-in-full amount.
- Code proof: the public offer endpoint renamed every stored clause to positional IDs such as `clause_8`. The widget's PIF filter looks for `installment_billing`, and post-enrollment GHL synchronization also looks up accepted standard clauses by semantic key.
- Impact: a PIF customer signs contradictory billing language, and standard-clause acceptance cannot reliably populate the matching GHL click-wrap fields.
- Severity recommendation: P1 consent/evidence correctness.
- Local repair: identify unchanged standard clauses by their canonical title/text and return their semantic keys; retain positional IDs only for custom clauses.
- Required regression: PIF hides `installment_billing`; installment enrollment shows it; submitted `clauses_accepted` contains semantic standard keys; matching GHL click-wrap fields update.

### FIND-029 - Pay-first payment chain cannot resolve consent captured after payment

- Area: Evidence-chain verification for QMS paid enrollment.
- Live proof: enrollment `d46fdead-8ce8-46f1-83f2-2bbe8cfd14b5` generated and stored its signed packet after consent, but chain verification returned strength 20 because the Whop payment event was created before a consent token existed.
- Code proof: `verifyChain()` only queried consent through `payment_events.consent_token`; it ignored the payment event's exact, tenant-scoped `enrollment_id`.
- Impact: valid pay-first payment and consent evidence exist under one enrollment, but diagnostics report only the payment link and understate the chain.
- Severity recommendation: P1 evidence integrity.
- Local repair: when a payment has no consent token, resolve consent only through its exact `enrollment_id + location_id`. Preserve a missing payment IP as an explicit gap; do not manufacture an IP match for merchant-entered QMS payments.
- Required regression: a pay-first payment resolves its later consent under the exact enrollment and cannot use a same-ID enrollment from another location.
- Live retest: deploy `86a6ef4` resolved Whop payment event `e8ba68a7-80c2-45ec-b24d-07b5bd2dbe4a` to the later consent on exact enrollment `d46fdead-8ce8-46f1-83f2-2bbe8cfd14b5`. The chain contains verified payment and consent links with strength 50. The only gap is the expected missing payment IP for a merchant-entered QMS payment.

### FIND-030 - Embedded Whop QMS does not confirm a completed payment to the merchant

- Area: Quick Manual Sale completion feedback and duplicate-charge safety.
- Live proof: the $1.50 Whop QMS payment completed, the webhook recorded the payment, and receipt/enrollment-link deliveries fired. The QMS modal remained expanded for more than one minute with Whop's disabled `Join` button and no ScaleSafe success state.
- Code proof: the modal marked completion only through Whop's optional browser callback. The embedded checkout did not invoke that callback, while ScaleSafe's server had already confirmed the payment through the authenticated webhook.
- Impact: a merchant can believe a successful payment is frozen or failed, close without clear confirmation, or attempt a duplicate sale.
- Severity recommendation: P1 operational money-safety defect because processor success is not reliably reflected in the initiating workflow.
- Local repair: expose a read-only, SSO-protected, tenant-scoped status endpoint for the exact QMS enrollment and poll it while the embedded checkout is open. Treat the browser callback only as a progress hint; show success only after ScaleSafe confirms webhook-finalized state. Refresh the client record behind the modal without closing the confirmation before the merchant can see it.
- Required regression: a fresh Whop QMS payment replaces the embedded form with a clear recorded-payment success state; a processor failure is shown without claiming success; a cross-location enrollment ID returns no status.
- Live retest: deploys `062b244` and `f7a412a` confirmed enrollment `36d0becb-3c9f-4100-9a45-c7be3f51e8d7` only after its exact webhook-finalized state existed. The embedded form was replaced by `Whop payment confirmed`, the modal remained open, and the only remaining action was `Done`. Payment event `4f70e33f-90a6-449a-ad61-e2930736e1bf` is the single $1.50 sale for that enrollment.

### FIND-031 - QMS completion refreshes payments but leaves client totals stale

- Area: Client Payments state after Quick Manual Sale.
- Live proof: after WHOP-QMS-003, Recent Payments showed the new 6:23 PM $1.50 sale while the same screen still showed Total Charged `$13.50` and Last Payment `6:18 PM`.
- Code proof: `onQuickSaleCompleted()` reloaded `client-enrollments` but not `client-info`; the payment table and summary strip therefore came from different requests made at different times.
- Impact: the merchant sees contradictory payment results immediately after a successful charge and may believe the sale was only partially recorded.
- Severity recommendation: P2 UI state defect; the ledger is correct, but the initiating workflow presents stale totals.
- Local repair: reload both exact client enrollment/payment data and client summary data after QMS completion while leaving the confirmation modal visible.
- Required regression: after a new QMS payment, Recent Payments, Total Charged, and Last Payment all reflect the same transaction without a page refresh.

### FIND-032 - Fully refunded payments remain actionable in Payment Management

- Area: Refund availability and duplicate-refund prevention.
- Live proof: ScaleSafe successfully issued and recorded a full $1.50 Whop refund, displayed a separate Refunded ledger row, and increased Total Refunded to $1.50. The original fully refunded sale still displayed an active Refund button.
- Code proof: the payment ledger exposed refund controls from only the original event type, failure state, and processor transaction ID. It did not subtract linked refund/void events or reserve in-flight refund claims.
- Impact: the backend remaining-balance check should reject a duplicate request before another processor call, but the merchant UI incorrectly invites an impossible money action and obscures partial-refund limits.
- Severity recommendation: P1 money-operation UI defect. The server is protected, but the operator surface does not reflect processor/ledger truth.
- Local repair: calculate remaining refundable cents from linked refund/void events and active refund claims, expose that amount to the UI, hide the action at zero, and cap partial refunds at the remaining balance.
- Required regression: a full refund removes the original row's Refund button; a partial refund shows and caps the remaining amount; an accepted-but-not-yet-recorded processor claim also removes or reduces availability without a second processor call.

### FIND-033 - Whop refund response is mistaken for a canonical refund record

- Area: Whop refunds, webhook reconciliation, and refund claims.
- Live proof: Whop accepted the full $1.50 refund and its signed webhook created one canonical refund row, but the initiating request displayed `Refund was accepted by the processor, but ScaleSafe could not record the refund event`. Railway then logged a duplicate transaction-ID insert and incorrectly reconciled the claim to original sale event `4f70e33f-90a6-449a-ad61-e2930736e1bf`.
- Code proof: Whop's refund endpoint returns the updated Payment object with its original `pay_...` ID; ScaleSafe treated that ID as a refund ID and attempted a second ledger insert. The repair worker queried by transaction ID without requiring `event_type = refund`, allowing the original sale to satisfy the claim.
- Impact: merchants receive a false recording-failure warning after a successful refund, claims can point to the sale instead of the refund, and synthetic/manual rows can race the signed Whop webhook.
- Severity recommendation: P1 money-ledger integrity defect. The processor refund succeeded, but local reconciliation could report and link the result incorrectly.
- Local repair: reserve the refund amount when Whop accepts the request, make signed `refund.created` the sole canonical Whop refund-row writer, correlate that `rf_...` event to the exact original payment and claim, and require refund event type in reconciliation queries. The worker must wait rather than synthesize a Whop refund from `pay_...`.
- Required regression: the refund request returns processing or confirmed success without a false recording error; one signed `rf_...` row is written; the claim points to that row; the refund workflow fires once; duplicate webhooks and the worker create no second row or notification.
- Live retest: deploy `2ddbf9a` completed a partial Whop refund with one signed canonical `rf_...` payment row, one linked claim, one evidence record, one refund workflow delivery, and the correct remaining refundable balance.

### FIND-034 - Whop lifecycle actions trust no-op responses and resume loses the renewal date

- Area: Whop pause, resume, cancel, and recurring-plan display.
- Live proof: fresh recurring membership `mem_8d7yjd21BXcBPy` paused and resumed correctly in Whop, but ScaleSafe resumed it with a blank `next_billing_date` even though Whop still reported July 21, 2026. A historical one-time membership with Whop status `completed` also accepted pause/resume requests without changing Whop, while ScaleSafe wrote local lifecycle state, evidence, and workflow events.
- Code proof: the lifecycle service trusted any successful Whop POST and immediately changed the enrollment. It did not inspect `payment_collection_paused`, `status`, `renewal_period_end`, or `canceled_at`, and its Whop resume branch discarded the returned renewal date.
- Impact: ScaleSafe can disagree with Whop about whether billing is paused, active, or ended; a resumed recurring plan can lose its next-payment date; and customer communications/evidence can assert a lifecycle change Whop did not apply.
- Severity recommendation: P1 processor-state integrity.
- Local repair: retrieve and validate the exact membership before action, reject ended or non-recurring memberships, confirm Whop's resulting state before updating ScaleSafe, and persist Whop's verified renewal/cancellation timestamp.
- Required regression: a valid recurring membership pauses, resumes with its renewal date restored, and cancels only after Whop confirms each state. A completed one-time membership performs no action and creates no local state, evidence, or workflow side effect.
- Live retest: deploy `0235e24` passed. Membership `mem_8d7yjd21BXcBPy` paused only after Whop reported `payment_collection_paused = true`, resumed with the verified July 21 renewal date restored, and cancelled only after Whop reported `canceled`. Historical completed membership `mem_9E5jJNXTlIXWOT` was rejected without changing ScaleSafe state, evidence, or workflow counts.

### FIND-035 - GHL lifecycle emails render event variables as `[object Object]`

- Area: GHL subscription paused/resumed workflow templates.
- Live proof: the certification client received pause and resume emails naming the subscription as `[object Object]`.
- App-side proof: the exact trigger deliveries contain plain-string `offer_name`, `offerName`, `program_name`, and `programName` values. Read-only GHL inspection confirmed the published email actions use bare Marketplace custom-trigger variables such as `{{offer_name}}`, `{{next_billing_date}}`, and `{{payments_remaining}}`; those variables render as objects in this trigger configuration.
- Impact: customer-facing lifecycle notices are confusing and cannot serve as clean communication evidence.
- Classification: P1 combined app/workflow contract defect. The app must refresh the exact enrollment's contact fields before firing, and the GHL actions must use those contact fields. No GHL workflow setting has been changed yet.
- Code repair: commit `f025190` writes the exact enrollment's program, payment count, status, and next billing date before pause/resume delivery; it suppresses the customer trigger if the prerequisite field write fails.
- Required GHL repair: use `{{contact.offer_program_name}}`, `{{contact.ss_next_payment_date}}`, and `{{contact.ss_payments_remaining}}`; remove the literal pause-template conditional instruction and use the offer business/support contact fields for signoff copy.
- Required regression: one pause and one resume produce the correct program name, no `[object Object]`, one workflow execution each, and enrollment-linked communication evidence.

### FIND-036 - Stripe cancels finite plans early and prorates the final installment

- Area: Stripe finite installment scheduling and money integrity.
- Live proof: offer `CERT 2026-07-13 Stripe Plan` was configured for two `$1.00` daily payments. Stripe stored a `$1.00` recurring price but settled the final invoice for `$0.96` because the subscription period ended at 11:00 PM instead of midnight.
- Processor proof: the Stripe invoice line was marked as proration and covered a 23-hour period. The subscription `cancel_at` was exactly one hour before the full-cycle boundary.
- Code proof: `stripeCancelAtSeconds()` intentionally subtracted 3,600 seconds from every finite-plan cancellation timestamp, and its unit tests required that behavior.
- Impact: daily, weekly, monthly, quarterly, and annual finite plans can undercharge their final installment. The error grows with the installment amount and duration of the shortened period.
- Severity recommendation: P1 money integrity.
- Repair: commit `a7623c7` removes the one-hour offset and tests exact calendar boundaries for every supported cadence.
- Required regression: a new two-payment daily Stripe plan charges the configured initial and recurring amounts exactly once each; the final invoice is not prorated and no third invoice is created.

### FIND-037 - Recurring receipt names a different active enrollment

- Area: GHL payment receipts for contacts with multiple enrollments.
- Live proof: Stripe recurring transaction `ch_3TsujNQ4vjJOpWaV2G7by0IE` belonged to `CERT 2026-07-13 Stripe Plan`, and the ScaleSafe trigger payload named that offer. The received GHL email instead said `CERT 2026-07-13 Whop Choice`, a newer enrollment on the same contact.
- Code proof: recurring payment handling updated payment counters but did not refresh `contact.offer_program_name`; the GHL receipt action therefore read the last enrollment to overwrite that contact field.
- Impact: a valid receipt can describe the wrong purchase, confuse the customer, and become misleading communication evidence.
- Severity recommendation: P1 multi-enrollment workflow integrity.
- Repair: commit `f025190` refreshes the exact recurring enrollment's offer/business/support and payment fields before firing `ss_payment_received`.
- Required regression: a recurring payment for an older enrollment sends a receipt naming that enrollment even when the same contact has newer active programs.

### FIND-038 - Defense detail remains pending after compilation completes

- Area: Defense compilation UI.
- Live proof: packet `13971614-ca2d-4107-931e-41be587a5446` completed in Railway, generated its PDF, and fired `ss_defense_ready`, while the open detail view remained `Pending` until the merchant navigated away and reopened it.
- Impact: merchants can wait indefinitely or retry a compilation that already succeeded.
- Repair: poll only while status is `pending` or `processing`, stop after completion/unmount, and show a bounded long-running message after five minutes.
- Required regression: an asynchronously compiled packet updates in place without navigation or duplicate compilation.
- Live retest: packet regeneration returned Version 2 in place and the open detail view updated to `Needs Review`, the new letter, four exhibits, and the Version 2 label without navigating away.

### FIND-039 - Supplying the enrollment drops selected transaction metadata

- Area: Dispute scope resolution.
- Live proof: the packet selected payment event `e0612e07-aedc-46ab-adb4-ed5b8d810903`, but its frozen scope had null processor, processor transaction ID, and transaction date because the resolver returned from the enrollment branch first.
- Impact: the letter and timeline omit the exact disputed transaction identifiers even though the merchant selected the transaction.
- Repair: resolve the payment first whenever a payment ID exists, verify its tenant/contact/enrollment/offer relationship, and preserve its processor metadata.
- Required regression: matching payment plus enrollment retains transaction metadata; mismatched enrollment or offer fails closed.
- Live retest: Version 2 names the exact Stripe PaymentIntent `pi_3TsnWKQ4vjJOpWaV2iZAxrla`, July 13 transaction date, `$2.00` amount, and exact enrollment.

### FIND-040 - Exact packet includes sibling-enrollment communications

- Area: Enrollment-scoped exhibit assembly.
- Live proof: the Stripe Plan packet included same-day Stripe PIF and Whop Choice emails from sibling enrollments because date-window and offer-name fallbacks were accepted under exact scope.
- Impact: bank-facing evidence can describe purchases unrelated to the disputed transaction, including repeat purchases of the same offer.
- Repair: exact scope requires an enrollment identifier; offer/date/name inference is permitted only in an explicitly inferred packet that requires review.
- Required regression: two programs and two enrollments of the same offer on one contact produce exhibits only for the selected enrollment.
- Live retest: Version 2 contains only the selected enrollment packet, its two linked communications, and the disputed transaction. No sibling Stripe PIF or Whop program appears.

### FIND-041 - Plural installment value is described as paid in full

- Area: Defense offer context.
- Live proof: the selected offer stores `payment_type = installments`, while the context builder recognized only singular `installment` and generated paid-in-full language.
- Impact: the defense letter materially misstates the agreement and transaction structure.
- Repair: normalize both supported installment values before generating price/payment language.
- Required regression: plural `installments` produces the configured count, cadence, and installment amount and never says paid in full.
- Live retest: Version 2 states two daily `$1.00` installments and identifies the disputed `$2.00` as the first installment plus the `$1.00` add-on; it does not describe the purchase as paid in full.

### FIND-042 - Generic cancellation note passes the service-delivery gate

- Area: Defense readiness and unified evidence.
- Live proof: no milestone or signoff existed for the selected enrollment, but an unlinked GHL cancellation note entered as a generic custom event, was described as delivery, and helped a Visa 13.1 packet reach `complete` and fire `ss_defense_ready`.
- Impact: ScaleSafe can mark a services-not-provided defense ready without actual delivery evidence, and AI may turn an operational note into a false milestone claim.
- Repair: generic custom events are excluded unless explicitly approved with a delivery/access/deliverable/milestone proof role; the selected payment is included separately as payment evidence.
- Required regression: a 13.1 packet with payment/consent but no delivery proof lands on `needs_review` and does not fire ready.
- Live retest: Version 2 excluded the generic cancellation/custom event, stated that no milestone completion or signoff exists, landed on `needs_review`, recommended considering acceptance, and did not fire a second `ss_defense_ready` event.

### FIND-043 - Stored pulse responses are omitted from defense exhibits

- Area: Pulse evidence and defense assembly.
- Code proof: pulse submissions are stored in `evidence_pulse_checkins`, shown in the client evidence timeline, and referenced by the defense prompt, but the exhibit builder did not query that table. Its unified-timeline fallback also excluded the `pulse_checkin` type.
- Impact: a client-authored satisfaction score, written feedback, concern, or explicit follow-up request could be missing from the bank-facing packet even when it was linked to the disputed enrollment.
- Severity recommendation: P1 evidence completeness defect. Evidence was preserved in ScaleSafe but silently omitted from the compiled defense.
- Repair: query pulse rows directly, scope them through the exact enrollment rules, surface query failures, and classify them as client-engagement communication rather than service delivery. New pulse submissions use the `client_engagement` proof role.
- Required regression: the selected enrollment's pulse appears with score/feedback/follow-up details, a sibling enrollment's pulse is excluded, and pulse evidence alone cannot make a services-not-provided packet ready.
- Live retest: packet `00a794e8-c2ff-4ba7-a6a1-f5378caafe2f` included the selected enrollment's 3/5 pulse as a communication exhibit, excluded sibling-enrollment pulse data, landed on `needs_review`, and did not fire `ss_defense_ready`. The base exhibit-path repair passes. FIND-051 separately tracks the omitted follow-up-request detail.

### FIND-044 - Dashboard at-risk read performs mutations and takes up to 85 seconds

- Area: Dashboard reliability, GHL side effects, and risk scoring.
- Live proof: repeated `GET /api/dashboard/at-risk` calls took 16.7 to 85.1 seconds while only 19 evidence-bearing contacts existed in the location. Multiple browser tabs caused overlapping long-running requests. On deployed commit `1dce009`, one dashboard tab still launches `overview`, `at-risk`, `defense-history`, and `pulse-checkins` every 60 seconds; a cold refresh wave took 22.3 to 30.5 seconds across those four routes even though warm repeats later returned in about 0.2 to 6 seconds.
- Code proof: the read route called `checkAllClients`, which scored contacts serially and, for every flagged contact, could update the GHL engagement field and create another `disengagement_flagged` evidence event merely because the dashboard loaded.
- Impact: dashboard reads can exhaust request/database capacity, slow unrelated defense/detail requests, repeatedly mutate GHL, and add duplicate operational evidence without an explicit merchant action.
- Severity recommendation: P1 launch reliability and evidence-integrity defect.
- Repair: dashboard reads use a side-effect-free scorer; independent evidence queries run concurrently with bounded contact concurrency; only the explicit admin disengagement action may write GHL fields or evidence. Overlapping scans for one location are deduplicated, completed results are cached for five minutes, and only three contacts may fan out evidence reads concurrently.
- Required regression: dashboard load returns risk data without GHL/evidence writes, completes within a normal interactive window for the certification location, and the explicit disengagement action retains its intended side effects.
- Live retest: deploy `747797f` proved that dashboard reads created no new `disengagement_flagged` evidence. Follow-up deploy `1dce009` also produced zero new disengagement evidence and made cached reads consistently fast (about 0.2-0.8 seconds). In-flight deduplication worked: a duplicate request shared the active scan instead of launching another full fan-out. The first cold scan after a fresh SSO session took 23.9 seconds; a later correlated refresh wave reached 30.5 seconds and slowed all four dashboard reads. The mutation defect is closed, but the periodic cold-scan capacity defect remains open.
- Local remediation: the cold scorer now uses five bounded, tenant-scoped bulk reads instead of per-contact evidence queries, preserves the same risk factors in memory, and the dashboard refresh cadence now matches the five-minute server cache. Focused regression proves one scan performs five table reads. Live latency proof remains pending after deployment and the Supabase compute upgrade.

### FIND-045 - Milestone completion blocks on workflow delivery

- Area: Merchant milestone workflow responsiveness.
- Live proof: the exact enrollment milestone, evidence row, GHL field refresh, and `ss_milestone_reached` delivery all succeeded, but `POST /api/dashboard/mark-milestone` did not return for 21.1 seconds.
- Code behavior: the merchant request waits for the external GHL trigger delivery before acknowledging that the milestone was saved.
- Impact: a successful merchant action appears frozen and is vulnerable to browser retries or abandonment when GHL is slow.
- Severity recommendation: P2 reliability defect. State and evidence were correct, but the operator request is unnecessarily coupled to an external workflow.
- Required repair: preserve durable milestone state first and move trigger delivery to a separately observable background path without allowing duplicate workflow events.
- Required regression: the merchant sees saved milestone state within five seconds while one eventual trigger delivery, one evidence row, and the correct enrollment fields remain provable.
- Local remediation: migration 099 adds a leased, tenant-idempotent trigger-delivery queue. Milestone state and evidence save first; GHL field sync and `ss_milestone_reached` run under `milestone:<enrollment>:<number>`. Browser retries reuse the same job, and ambiguous external outcomes are held as `unknown` rather than replayed. Live timing and one-email proof remain pending.

### FIND-046 - Reopened defense packets display the wrong letter version

- Area: Defense packet version history UI.
- Live proof: reopening the packet after Version 2 existed displayed `Version 1`; regenerating in the same mounted page then displayed Version 3 correctly.
- Code proof: `currentVersionNumber` initialized to 1 and changed only from edit/regenerate responses. The packet detail API did not return the latest saved version, and `refresh()` did not set it.
- Impact: merchants can mistake an older draft for the current frozen packet or report the wrong version during review.
- Severity recommendation: P2 UI truth defect; the saved letter and PDF were current, but the label was false.
- Repair: return the latest `defense_letter_versions.version_number` from the tenant-validated packet endpoint and set the UI label on every refresh.
- Required regression: opening, refreshing, editing, and regenerating a three-version packet always display the latest saved version.

### FIND-047 - Defense fulfillment dates mix browser-local and unlabeled UTC

- Area: Bank-facing milestone and signoff timestamps.
- Live proof: the exhibit card displayed July 13 while the letter said the milestone/signoff occurred July 14 at 2:48 AM. Both represented the same moment, but the server-generated sentence used UTC without naming it while the browser card used Central time.
- Impact: internally inconsistent dates can make otherwise strong service-delivery evidence look unreliable to a reviewer.
- Severity recommendation: P1 defense factual-presentation defect.
- Repair: normalize defense exhibit calendar dates to UTC, label them as UTC, and compose signoff summaries from source timestamp columns with an explicit UTC timezone instead of retaining environment-local legacy summaries.
- Required regression: the same signoff renders one consistent date across the UI exhibit, generated letter, and PDF, with the timezone identified.
- Live retest: deploy `1dce009` passed. A fresh packet open showed all eight exhibit dates as UTC. Regenerated Version 4 recomposed the source signoff as `July 14, 2026 at 2:48 AM UTC` in both the letter and PDF. The packet remained `complete` and no duplicate `ss_defense_ready` delivery was created.

### FIND-048 - Defense regeneration blocks the UI for about 55 seconds

- Area: Defense operator responsiveness and background work.
- Live proof: Version 4 regenerated successfully, but `POST /api/defense/13971614-ca2d-4107-931e-41be587a5446/regenerate` held the request open for 54.8 seconds while AI generation and the seven-page PDF completed.
- Impact: the merchant sees a disabled `Regenerating...` control for nearly a minute. A browser refresh or retry during that window can create uncertainty even though the packet eventually succeeds.
- Severity recommendation: P2 reliability defect. The result was correct and idempotent, but expensive work remains coupled to an interactive request.
- Required repair: claim a durable regeneration job, return an accepted state quickly, poll packet status, and preserve the existing one-version/one-PDF idempotency behavior.
- Required regression: the UI acknowledges regeneration within five seconds, displays observable progress, and eventually refreshes to exactly one new version without firing `ss_defense_ready` again.
- Local remediation: regeneration now atomically queues against the existing defense worker, returns HTTP 202, wakes the worker, and polls in place. The queue reserves one target version; worker retries reuse the stored letter and rebuild the PDF without another AI call or another letter version. Live timing and Version/PDF proof remain pending.

### FIND-049 - Defense draft asserts service delivery when the readiness gate found none

- Area: AI defense factual integrity and `needs_review` handling.
- Live proof: Visa 13.1 packet `00a794e8-c2ff-4ba7-a6a1-f5378caafe2f` correctly landed on `needs_review` because the exact enrollment had no service-delivery evidence. The generated letter nevertheless says the records show that services were delivered and includes an `Evidence of Service Delivery` section. It does not disclose the missing delivery proof.
- Impact: the status gate prevents automatic ready delivery, but the editable bank-facing draft still makes an unsupported factual assertion. A merchant can mark the packet submitted after reviewing an internally contradictory letter.
- Severity recommendation: P1 defense factual-integrity defect.
- Required repair: pass evidence-category counts and review reasons into a deterministic claim guard. When service-delivery evidence is zero, the prompt and post-generation validator must prohibit delivery assertions and require neutral wording that identifies the gap. A contradictory draft must not be presented as submission-ready text.
- Required regression: a services-not-provided packet with zero delivery evidence may summarize consent, payment, and communication, but cannot say the service was delivered. A packet with a verified milestone/signoff may make a delivery claim tied to that exhibit.

### FIND-050 - Moderate offer-name matching admits sibling-payment receipts as exact evidence

- Area: GHL communication matching and defense enrollment isolation.
- Live proof: eight GHL messages were linked to enrollment `5493f01b-7712-4ad4-bcf0-2eb590103fc2` using only `unique_offer_name_in_communication` at `moderate` confidence. Three receipt bodies used that offer name but reported `$2.20` or `$1.00` recurring payments from sibling enrollments. The exact-scope defense packet trusted the stored enrollment ID and included those receipts.
- Code proof: `findEnrollmentFromUniqueOfferName()` can attach a communication from rendered body text alone. The evidence row does not preserve the match method/confidence in a field the defense selector uses, so moderate inferred linkage becomes indistinguishable from explicit enrollment ID or signed action-token linkage.
- Impact: a packet can include payment history from the wrong program and present it as exact enrollment evidence. The risk is highest for contacts with multiple active enrollments because mutable GHL contact fields can render a current offer name into an unrelated workflow email.
- Severity recommendation: P1 evidence-isolation defect.
- Required repair: preserve match method and confidence on communication evidence. Treat explicit enrollment IDs, verified action tokens, and validated transaction-to-enrollment links as exact. Offer-name inference may remain client-level context but must not enter an exact packet without content validation against the selected enrollment/payment.
- Required regression: sibling receipts containing an overwritten offer-name field are excluded; exact action-token pulse emails remain included; a genuinely exact receipt with matching transaction/payment data remains included.

### FIND-051 - Pulse follow-up request is hidden by a stale stored summary

- Area: Pulse evidence completeness and defense narrative.
- Live proof: pulse row `8f9f7138-847b-4172-a95a-67434a3a663e` stores `follow_up_needed = true` and `follow_up_action = Merchant follow-up requested from pulse check-in`. The dashboard correctly shows the requested attention, but the defense exhibit and letter say only that the client reported no concerns and omit the follow-up request.
- Code proof: the pulse exhibit builder creates a richer fallback summary containing follow-up state, but `exhibitSummary()` prefers the row's older `defense_summary`, which lacks that field.
- Impact: the packet can suppress a material client request while emphasizing favorable pulse language. That weakens factual completeness and can make the merchant narrative misleading.
- Severity recommendation: P1 defense evidence-completeness defect.
- Required repair: compose pulse summaries from current source columns or append the current follow-up state regardless of a legacy stored summary. The AI prompt must receive the same complete pulse facts shown to the merchant.
- Required regression: a follow-up-requested pulse visibly says so in the exhibit, letter context, and PDF; a pulse without a request does not invent one.

### FIND-052 - Dual-pricing charge is not reconciled to the accepted base price

- Area: Enrollment packet and defense transaction explanation.
- Live proof: the frozen enrollment packet shows a `$2,000.00` program price on page 1 and a `$2,065.00` amount paid on page 2. The defense letter repeats both amounts but does not explain the `$65.00` difference or identify it as the selected card-price adjustment.
- Data proof: the payment event stores the `$2,065.00` charge and selected method `card`, while its line items contain only the `$2,000.00` base offer and do not preserve a card uplift percentage or explicit pricing-breakdown row.
- Impact: an issuer reviewer sees an unexplained difference between the disclosed price and disputed amount. ScaleSafe cannot prove from the current packet whether that exact adjustment was displayed and accepted.
- Severity recommendation: P1 payment-consent and defense-completeness defect.
- Required repair: persist the exact displayed bank price, card price, selected method, adjustment amount/rate, and consent snapshot at checkout. Render the selected total in the agreement summary and explain the arithmetic in a defense packet. If the disputed amount cannot be reconciled, require review rather than implying the amounts match.
- Required regression: a dual-pricing card transaction produces a frozen packet and defense exhibit that reconcile base price plus adjustment to the exact processor amount; ACH/bank selection records no card adjustment.

### FIND-053 - Completed appointment is expanded into proof of an unproved deliverable

- Area: GHL Fulfillment evidence and defense factual integrity.
- Live proof: packet `699b3327-1a14-4d1d-847d-ed02e4397abe` contains one completed GHL appointment for `CERT GHL Fulfillment Session`. The accepted milestone separately promises both a live kickoff session and a written implementation plan. The generated letter says the appointment "satisfies the Kickoff Session milestone, consisting of the live kickoff session and written implementation plan," even though no exhibit proves that a written plan was delivered.
- Data proof: Exhibit B says only that the appointment was completed. No milestone-completion, deliverable, file, signoff, or written-plan exhibit exists in the frozen five-exhibit snapshot.
- Impact: one valid attendance record is over-expanded into proof of every component of a compound milestone. A complete packet can therefore make a material fulfillment claim that its exhibits do not support.
- Severity recommendation: P1 defense factual-integrity defect.
- Required repair: represent milestone promises as atomic components and allow each delivery exhibit to satisfy only the component it actually proves. Prompt rules and a post-generation claim validator must reject language that extends an appointment beyond attendance/session completion.
- Required regression: a completed kickoff appointment may prove the live session, but the letter must identify the written plan as unproved until a separate exact-enrollment deliverable or approved milestone record exists.

### FIND-054 - Defense compilation accepts an impossible dispute-before-transaction chronology

- Area: Defense input validation and bank-facing timeline dates.
- Live proof: the UI labeled the selected Stripe transaction as July 13 in Central time, so the test dispute date was entered as July 13. The payment event is stored at `2026-07-14T03:51:30Z`. Packet `699b3327-1a14-4d1d-847d-ed02e4397abe` reached `complete` and states that the chargeback was filed on July 13 while the disputed charge occurred on July 14.
- Impact: the packet's own timeline claims a dispute was filed before the transaction existed. That is facially unreliable evidence and should never receive an unquestioned complete/ready state.
- Severity recommendation: P1 defense validation and factual-presentation defect.
- Required repair: compare the dispute date and processor transaction timestamp using one explicit merchant/account timezone policy. Reject impossible chronology or force `needs_review` with a visible explanation before compilation.
- Required regression: a local July 13 transaction that is July 14 UTC is accepted when both dates represent a valid sequence in the configured timezone; a genuinely earlier dispute date is blocked or held for review.

### FIND-055 - Selected Stripe transaction compiles as an NMI dispute

- Area: Defense processor derivation, dispute ledger, addressee, and workflow payload.
- Live proof: the selected payment event `2815f716-797d-4940-870b-538cdd28a3db` is a Stripe sale with PaymentIntent `pi_3TsxNWQ4vjJOpWaV0PNwjVUE`. Compilation created NMI dispute row `61fc43dc-1680-42ac-83ca-140722e0a25a`, addressed the letter to `Sponsor Bank - Chargeback Department`, and sent the single `ss_defense_ready` delivery with `processor = nmi`.
- Code proof: `GET /api/defense/transactions/:contactId` returns each payment's processor, but the frontend transaction type and `onTransactionSelected()` discard it. With no `processor` or Stripe dispute event in the compile request, `compileDefense()` defaults to NMI and creates a synthetic NMI dispute row.
- Impact: the dispute ledger, chargeback-ratio data, workflow routing, packet addressee, and processor-specific submission path can all contradict the selected transaction. This is a core beta defense path.
- Severity recommendation: P1 defense/ledger integrity defect.
- Required repair: derive processor server-side from the tenant-scoped selected `payment_event_id`; do not trust or require the browser to supply it. Create a synthetic dispute row only for the resolved rail, and reject any supplied processor that conflicts with the payment event.
- Required regression: selecting a Stripe, NMI, or Whop payment derives that exact rail, creates or links the correct dispute record, selects the correct addressee, and emits the same processor in `ss_defense_ready`.

### FIND-056 - Zoom is labeled healthy while setup discovery is broken and no event has been proved

- Area: Zoom connection health, setup discovery, and merchant diagnostics.
- Live proof: the connected Zoom account displays `Connection healthy`, `No activity yet`, `Published 0`, and `Programs 0`. The OAuth token refresh and direct Zoom meeting discovery both succeed, but `zoomIntegrationService.setup()` fails against the live database with `column offers_mirror.status does not exist`.
- Code proof: `zoom-integration.repository.ts:listOffers()` selects `id, offer_name, status`; the live `offers_mirror` contract exposes `active`, not `status`. The current merchant route and modal never call or expose the setup/mapping methods, so the failure is hidden behind a green connection state.
- Impact: OAuth authorization is presented as end-to-end connector health even though resource/offer discovery cannot complete and no signed attendance event has reached ScaleSafe. A merchant cannot distinguish "authorized" from "collecting evidence."
- Severity recommendation: P2 integration-readiness and observability defect. Signed webhook intake may still work through automatic matching, but the setup path and green health claim are not certified.
- Required repair: align the offer query with the live schema, either expose a supported setup/status path or remove the dead setup contract, and report authorization, webhook observation, enrollment match, and published evidence as separate health states.
- Required regression: a connected account can discover resources without a schema error; before the first event it displays `Authorized - awaiting attendance event`; after a signed join/leave pair it displays the exact matched program and published evidence timestamp.

### FIND-057 - Zoom host attendance can be published as client attendance

- Area: Zoom attendance identity and defense evidence integrity.
- Code and provider-contract proof: Zoom's signed participant webhook includes both `object.host_id` and participant user identifiers. `handleWebhook()` stores every joined/left participant and always labels the normalized actor as `client`; it never rejects or reclassifies a participant whose Zoom user ID equals `host_id`. The resolver may then bind that event to one enrollment solely through an exact GHL appointment/meeting/time match before checking participant email.
- Concrete scenario: the merchant hosts a Zoom meeting referenced by one client's GHL appointment. The host joins and leaves normally. Those host events can resolve through `zoom_exact_scheduled_appointment`, persist as `session.attended`, and enter the client's defense record as if the client attended.
- Impact: ScaleSafe can create materially false client-engagement evidence from the merchant's own attendance. The error can reach an enrollment-scoped defense packet.
- Severity recommendation: P1 evidence-identity defect.
- Required repair: exclude the host deterministically before attendance materialization, preserve participant role/identity provenance, and do not call an attendee the client unless the identity or scheduling context proves that role. Staff/co-host events need an explicit non-client treatment.
- Required regression: host-only join/leave creates no client-attendance evidence; one real external attendee creates exactly one attendance exhibit; host plus attendee cannot produce two client-attendance exhibits for one enrollment.

### FIND-058 - Roadmap previews remain embedded in active Settings pages

- Area: Merchant and payment settings product truth.
- Live proof: Merchant Settings still renders `GHL Communications Evidence`, `Client Activity Ledger`, `GHL Invoice Evidence`, `GHL Appointment Evidence`, `GHL Course Activity`, and a `Future App Settings` section with `Beta`, `Needs Setup`, and `Coming Soon` labels. Payment Settings still renders `Coming Payment Options` with NMI Multi-MID, ACH, and financing preview cards.
- Code proof: `SettingsPayments.vue` renders the `Coming Payment Options` card from `paymentFeatureSettings`; the merchant Settings view still renders roadmap feature stubs in the normal setup flow.
- Impact: live functionality and future work are mixed into operational configuration, creating the impression that active features are unavailable or that merchants must configure placeholders. This also contradicts the prior product decision to keep roadmap material on the Roadmap page.
- Severity recommendation: P3 launch-copy/UI cleanup. It does not block processor operation, but it makes onboarding and review less trustworthy.
- Required repair: remove roadmap preview/stub sections and status pills from active Settings and Payment Settings surfaces. Keep only real controls and diagnostics; retain future items on the Roadmap page.
- Required regression: both settings pages contain only actionable live/beta configuration, with no `Coming Soon`, preview, or roadmap-stub cards.
- Local remediation: the Future App Settings and Coming Payment Options cards, roadmap links, and status pills were removed from operational Settings. GHL activity retains only the live endpoint, automatic-matching explanation, refresh action, errors, and recent unmatched diagnostics.

### FIND-059 - Disabled and test-only connectors are presented as healthy evidence sources

- Area: Evidence Connections status truth and merchant readiness.
- Live proof: the Connected band reports four sources and includes `Custom Software`, even though the live row is `status = disabled`, `setup_status = draft`, and `health_status = disabled`. Opening it says `Connection healthy` and offers `Disable connection`. `Connector Test` is only in `setup_status = testing`, has one test-only event and zero published events, but its modal says `Connection healthy` and labels the test timestamp `Last evidence`.
- Code proof: `connectedItems` includes every provider connection without filtering status. `needsAttention` ignores disabled, draft, and testing states. `lastEvidenceAt` falls back from published evidence to `connection.last_success_at`, which is advanced by a diagnostic test event.
- Impact: a merchant can reasonably believe an inactive or unproved connector is collecting program evidence when it cannot accept production events or has never published evidence. This creates silent evidence gaps in the product's core promise.
- Severity recommendation: P1 evidence-capture readiness defect.
- Required repair: treat only `status = active` plus `setup_status = active` as connected; render draft/testing/disabled states explicitly; never label a test or generic success timestamp as evidence; and offer actions appropriate to the current state.
- Required regression: a disabled draft is absent from Connected and displays Setup needed; a testing connection displays Test mode with zero evidence; only one real published event sets Last evidence and affected program count.

### FIND-060 - Payment processor filter omits Whop

- Area: Payment Management ledger operations.
- Live proof: the ledger contains current Whop sales and refunds, but the Processor filter offers only All, Stripe, NMI, and GHL.
- Code proof: `PaymentSearch.vue` hardcodes only `stripe`, `nmi`, and `ghl` processor options even though its ledger renderer and backend support `whop` rows.
- Impact: merchants cannot isolate Whop activity for lifecycle review, refunds, or reconciliation and must scan or text-search a large mixed ledger.
- Severity recommendation: P2 operational usability defect.
- Required repair: derive the filter from supported live processor capabilities or add Whop explicitly; keep disabled providers out until they can create ledger rows.
- Required regression: selecting Whop returns only Whop payments/refunds and resetting returns the complete tenant ledger.

### FIND-061 - Stripe Risk Health displays the newest NMI snapshot

- Area: Stripe account-health truth and processor isolation.
- Live proof: the Stripe Risk Health page displayed a 47.06% dispute rate, 17 transactions, `UNKNOWN` risk, and unknown network classifications. The latest live rows show those exact values belong to the NMI snapshot. The latest Stripe snapshot instead contains 100 charges, one dispute, a 1% rate, `critical` risk, Visa `standard_program`, and Mastercard `warning`.
- Code proof: `stripe-health.service.ts#getLatestSnapshot()` and `getSnapshotHistory()` filter by merchant and location but not `processor = stripe`; the NMI daily snapshot was computed milliseconds later and therefore won the descending timestamp query.
- Why tests missed it: current Stripe-health tests exercise snapshot computation, upsert behavior, and pure threshold logic, but do not interleave snapshots from two processors and call the real current/history read methods.
- Impact: the page labeled Stripe Health can present another processor's transaction volume and dispute ratio. A merchant could make account-health decisions from the wrong rail.
- Severity recommendation: P1 product-truth/data-isolation defect. Tenant isolation remains intact, but processor isolation is broken.
- Required repair: require `processor = stripe` in current/history reads. Make the processor explicit in the service contract and API response.
- Required regression: interleave newer NMI and older Stripe snapshots for one merchant; Stripe endpoints and UI must return only Stripe rows, and an NMI dashboard must return only NMI rows.

### FIND-062 - Stripe risk-audit fields render blank or zero

- Area: Stripe risk audit and prevention checklist.
- Live proof: Railway completed a fresh audit as `elevated` with dispute-rate score 60, evidence-readiness 40, descriptor quality 50, repeat-client score 100, and Radar quality 0. Payment Settings rendered a blank Risk Level and `/100`; Prevention Checklist rendered `UNKNOWN` and five `0/100` scores.
- Code proof: `getLatestAudit()` returns the `risk_audit_results` row unchanged with snake_case fields such as `overall_risk_level` and `score_dispute_rate`. `SettingsPayments.vue` and `PreventionChecklist.vue` read camelCase properties such as `overallRiskLevel` and `scoreDisputeRate`.
- Why tests missed it: risk-audit integration tests cover score calculations, not the route DTO consumed by both Vue views. No contract test renders nonzero persisted fields through the actual API response.
- Impact: merchants are shown false zero/unknown risk data immediately after a successful refresh.
- Severity recommendation: P1 operational guidance defect.
- Required repair: normalize the API DTO once at the service/controller boundary and type it. Do not make each view guess database column names.
- Required regression: seed nonzero audit values, call the real route, and assert that both merchant pages display the same normalized scores and risk level.

### FIND-063 - Active Disputes includes settled cases with a submission action

- Area: Stripe dispute operations.
- Live proof: the page titled `Active Disputes` reported Open 0 but rendered a won $2,065 case and labeled its action `Review & Submit`.
- Code proof: `dispute.routes.ts` comments that it lists active disputes but applies no status/outcome filter. `DisputeManagement.vue` renders `Review & Submit` for any row with a defense packet, regardless of won/lost/refunded state.
- Impact: a merchant can mistake a settled case for open work and is invited to submit evidence on a dispute already won.
- Severity recommendation: P2 workflow-truth defect. The current action opens a packet rather than immediately submitting, but its label and queue membership are misleading.
- Required repair: either filter the queue to actionable statuses or rename/split it into Active and History. Settled rows may expose `View Packet`, never `Review & Submit`.
- Required regression: won, lost, refunded, under-review, and needs-response fixtures appear only in the correct section with status-appropriate actions.

### FIND-064 - Evidence connection event history returns HTTP 500

- Area: Universal connector observability and test-result proof.
- Live proof: opening the existing Connector Test and Custom Software connections produced two HTTP 500 responses on their `/events` endpoints. Railway reported PostgreSQL `42703: column enrollments_1.offer_name does not exist`.
- Code proof: `evidence-connector.repository.ts#listEvents()` selects `enrollment:enrollments(..., offer_name)` even though enrollment names resolve through `offers_mirror`; the live enrollment table has no `offer_name` column.
- Why tests missed it: connector security and worker suites cover authentication, matching, and publication behavior without executing the live PostgREST select used by `listEvents()` against the migrated schema.
- Impact: merchants and operators cannot inspect connector event outcomes or prove which client/program a test targeted. This breaks the observability needed to certify the universal connector.
- Severity recommendation: P1 connector beta blocker.
- Required repair: remove the nonexistent enrollment field and use the already joined `offers_mirror.offer_name`. Keep the public DTO fallback on the joined offer rather than an enrollment-local name.
- Required regression: list diagnostic, published, duplicate, quarantined, and rejected events for a connection and verify a 200 response with masked client and exact offer target.

### FIND-065 - Successful client actions leave stale modal and summary state

- Area: Client note/message operator feedback.
- Live proof: Add Note saved in 627 ms and GHL echoed it successfully, but Overview continued to say `No notes yet` and showed the prior activity date until the client was reopened. Send Message returned 200 and later appeared in Communications, but the modal stayed open with an empty body and no visible success state.
- Impact: merchants can resend a successful email or assume a note failed. This resembles the stale-state behavior previously reported during demos.
- Severity recommendation: P2 state/feedback defect.
- Required repair: close or convert the modal to an explicit success state, refresh the affected summary/communications queries, and update Last Activity without requiring navigation.
- Required regression: one note and one email each show one success state, one persisted record, refreshed summary data, and no duplicate action after the first response.

### FIND-066 - Manual client emails have no enrollment-binding control

- Area: Communication evidence and defense scoping.
- Live proof: a new email sent from Phil Kay's ScaleSafe profile was delivered and captured as a GHL communication, but the Evidence tab showed `Link to Program`. The client had one active and one completed enrollment; the form offered no program field.
- Code/UI proof: the message request carries the contact, channel, and body, not an enrollment reference. The webhook therefore cannot distinguish an explicit program communication from general client correspondence.
- Impact: important service communications can remain outside the exact enrollment packet unless someone manually links them, which the product cannot expect merchants to do.
- Severity recommendation: P1 evidence-completeness defect.
- Required repair: default deterministically when exactly one active enrollment exists, expose a required program choice when several are eligible, and carry a verified enrollment reference through the outbound message metadata and GHL echo matcher.
- Required regression: single-active enrollment auto-links; two-active enrollment requires a choice; completed historical enrollments are never selected merely because they are newer/older.

### FIND-067 - Production Supabase capacity collapse makes ScaleSafe unavailable

- Area: Production availability, database capacity, workers, dashboard polling, and failure containment.
- Live proof: the Supabase project dashboard reported `Unhealthy` and warned that multiple resources were exhausted on Nano compute. During the same window its rolling-hour success rate was about 85%, with thousands of API Gateway warnings and hundreds of errors. Query Performance failed with `Connection terminated due to connection timeout`; database connection, disk, and network charts could not load.
- Resource proof: Database Observability reported about 411 MB used on a 0.5 GB instance and about 1.34 GB committed against a 1.5 GB commit limit. CPU was not continuously saturated, which points to memory/connection pressure and a cascading query backlog rather than one simple CPU spike.
- Railway/browser proof: the static application root returned HTTP 200 in 0.26 seconds, while `/health` returned no bytes and timed out after 15 seconds. Dashboard reads and the HQ merchant read held open for 60 to 300 seconds before the client closed them with HTTP 499. The ScaleSafe reviewer sub-account reached the installed app but displayed `Unable to Connect` because merchant binding could not complete while Supabase was timing out. This isolates the outage to database-backed readiness and application requests rather than DNS, static hosting, the GHL iframe, or the Marketplace installation.
- Supabase log proof: API Gateway returned 522/504 for merchant reads and worker RPCs including `claim_external_evidence_events` and `expire_evidence_enrollment_contexts`. Other claim and evidence-table requests returned 500 during the same degradation window.
- Railway worker proof: the external-evidence, money-reconciliation, and defense-operations workers repeatedly logged `TypeError: fetch failed`. The money worker also received `canceling statement due to statement timeout`, while the external-evidence and defense workers received the Supabase host's Cloudflare `522: Connection timed out` response. These failures occurred across all three independent worker loops during the same project-health incident.
- Code proof: three always-on workers poll every five seconds. Even when no work exists, the connector worker claims events and expires contexts, the money worker claims operations and refund claims, and the defense worker claims packets and reconciles accepted submissions. Those six baseline calls every five seconds produce approximately 4,320 database/API operations per hour before dashboard traffic or actual job processing. The main worker ticks prevent same-process overlap, but `cleanupExpiredContexts()` has no in-flight guard, so a stalled cleanup RPC can be launched again every five seconds while earlier calls remain unresolved. A visible dashboard also launches four reads every minute. The shared Supabase client and frontend API wrapper apply no explicit request deadline, so dependency stalls can occupy requests until Railway's five-minute edge timeout.
- Impact: SSO, dashboards, HQ diagnostics, scheduled processing, evidence intake, and payment/defense operations can all become unavailable together. Retrying from several browser tabs increases pressure and makes the failure self-reinforcing.
- Severity recommendation: P1 launch blocker spanning configuration and code. It is not a bad GHL install.
- Immediate operations requirement: move production off Free/Nano before any reviewer walkthrough or beta merchant. [Supabase pricing](https://supabase.com/pricing) currently lists Pro from $25/month and includes enough compute credit for one Micro instance, which doubles memory to 1 GB.
- Required code repair: add long idle backoff and jitter to empty worker polls, prevent overlapping context-cleanup calls, wake workers after durable job creation where practical, apply bounded Supabase/API request deadlines, return an observable 503 instead of hanging for five minutes, and alert on database degradation. Revisit the dashboard one-minute fan-out after the database is stable.
- Required regression: with empty queues, prove a bounded low request rate; under injected Supabase latency, SSO and health fail quickly with actionable status, no worker or cleanup calls overlap, and recovery occurs without duplicate side effects.
- Screenshots: `assets/OPS-SUPABASE-001_project-unhealthy_2026-07-14.png`, `assets/OPS-SUPABASE-002_database-health_2026-07-14.png`.

### FIND-068 - Production Supabase has no recoverable backup

- Resolution: **Closed 2026-07-21.** Snapshot `20260721T175646Z` passed encrypted archive and off-platform verification, then restored into an isolated schema-102 scratch project with matching critical counts, all 105 Storage objects, and readable enrollment/defense PDFs. See `docs/RECOVERY_DRILL_2026-07-21.md`.

- Area: Disaster recovery and evidence durability.
- Live proof: the ScaleSafe Supabase project is on the Free plan and its overview reports `LAST BACKUP: No backups`.
- Impact: payment, consent, enrollment, evidence, and defense records have no Supabase-managed recovery point. A database mistake or destructive incident could become permanent. Database backups also do not cover private Storage objects such as signed packets and defense files.
- Severity recommendation: P1 operations/data-resilience launch blocker.
- Required operations repair: enable a paid production plan with managed daily backups, document retention, create an encrypted off-platform database export and private Storage-object backup, and complete a scratch restore with hash/sample verification before the first real beta merchant. Supabase's [production checklist](https://supabase.com/docs/guides/deployment/going-into-prod) states that downloadable database backups are not available on Free projects.
- Required ongoing proof: backup age, latest successful export, object manifest/hash status, and last restore-test result must be visible to the planned Guardian backup/security system.

### FIND-069 - Dependency outages are mislabeled as a broken GHL installation

- Area: GHL SSO failure handling and reviewer recovery guidance.
- Live proof: the already-installed ScaleSafe reviewer sub-account at GHL location `BxiqLzUf4Rh5GXR6DUZ3` reached the ScaleSafe iframe during the Supabase outage, but merchant lookup could not complete. The UI displayed `Unable to Connect` and instructed the operator to uninstall and reinstall ScaleSafe.
- Code proof: `useApi.ts` turns every non-agency `/auth/sso` failure into one generic error. `App.vue` renders the same fixed statement, `This usually means the app needs to be reinstalled`, for any SSO error or missing location, including dependency timeouts and server-side 5xx responses.
- Impact: a temporary database incident is presented as an installation defect. A merchant or GHL reviewer can unnecessarily uninstall a valid app, interrupt provisioning, or conclude that Marketplace installation failed when the actual problem is service availability.
- Severity recommendation: P2 operational recovery and product-truth defect. It does not create the outage, but it sends users toward the wrong repair and obscures the real health incident.
- Required repair: return typed SSO failure categories and render distinct states for agency-context launch, missing/revoked installation, invalid authentication, temporary service unavailability, and timeout. Dependency failures need a bounded retry control plus support/status guidance; only confirmed missing or revoked bindings should recommend reinstalling.
- Required regression: a missing merchant or revoked install shows reinstall guidance; a simulated Supabase timeout/503 shows temporary-service guidance and retry; agency-context launch continues to fail closed without a sub-account chooser.

### FIND-070 - Railway and Supabase are deployed on opposite sides of the country

- Area: Production topology and database latency.
- Live proof: the active Railway deployment reports one replica in `us-west2`. The production Supabase project reports its primary database in East US (North Virginia), `us-east-1`.
- Impact: every Supabase query, RPC, worker claim, SSO merchant lookup, and storage-control request crosses regions. This does not explain the proven Nano memory/resource exhaustion by itself, but it adds avoidable latency to every database round trip and amplifies the effect of N+1 routes and frequent polling.
- Severity recommendation: P2 configuration/performance defect for controlled beta. It becomes more material as merchant and worker traffic grows.
- Required operations repair: place the ScaleSafe Railway service in the closest supported region to the production database, or deliberately relocate the database, after confirming provider support and migration implications. Change one side only through a planned deployment window; do not combine it with payment-code changes.
- Required regression: record representative SSO, dashboard cold/warm, payment read, worker claim, and defense read latency before and after regional alignment. Confirm processor webhooks and GHL callbacks remain healthy from the new app region.

### FIND-071 - Sensitive local artifacts were not fully ignored

- Area: Repository secret hygiene.
- Code proof: `scripts/migrate.js` supports `scripts/.dbpass` and tells an operator to place the database password there. Before this review, `.gitignore` ignored `.env` and Supabase temporary files but not `scripts/.dbpass`, local `tmp/` review artifacts, or extracted `tmp_defense_packet_text*.txt` files.
- Live repository proof: GitHub reports the ScaleSafe repository as public. No `scripts/.dbpass` file currently exists, and the redacted current-tree scan found no live Stripe, Supabase, GHL, or processor-encryption credential. Local temporary defense-packet text files were present but remain untracked.
- Impact: following the migration script's documented local-password option could leave a plaintext database password as an ordinary untracked file. Likewise, local review exports may contain client or evidence data. Either class of artifact could be accidentally included in a public commit.
- Severity recommendation: P2 preventative security defect; there is no newly discovered active credential exposure.
- Repair: `.gitignore` now contains `scripts/.dbpass`, `tmp/`, and `tmp_defense_packet_text*.txt`.
- Required regression: `git check-ignore -v scripts/.dbpass tmp/placeholder tmp_defense_packet_text.txt` resolves all three paths to repository ignore rules, and secret scanning remains part of the release/security process.

### FIND-072 - Unprotected main auto-deploys directly to production

- Area: Source control, agent safety, and production release governance.
- Live proof: GitHub reports `main` at deployed SHA `1dce009` with `protected = false`. Railway is connected to `Pkorn79/ScaleSafe`, watches `main`, and automatically deployed that same commit to production.
- Impact: any accidental agent push or compromised GitHub write credential can immediately become production code without a required review or successful status check. The risk is material because ScaleSafe handles payments, evidence, credentials, and tenant-bound workflows.
- Severity recommendation: P2 operations-security gap for controlled beta. It is not proof that unauthorized access has occurred.
- Required operations repair: define a release path with required CI status checks and protected production deployment. A practical shape is a protected `main`, short-lived review branches/PRs, and either Railway deploy-after-merge or a separate staging service before production promotion. Preserve an emergency owner bypass with auditability rather than routine direct pushes.
- Required regression: a failing CI branch cannot reach production; an approved green change can; production deployment records the reviewed commit; rollback to the preceding known-good image is practiced without database rollback assumptions.

### FIND-073 - Reviewer Snapshot packages obsolete and duplicate GHL assets

- Area: GHL Marketplace Snapshot, clean-install quality, and reviewer readiness.
- Live proof: the already-installed `ScaleSafe` reviewer sub-account contains 29 workflows, three funnels with 14 steps, 27 forms, 160 custom fields, and 22 custom values. Installed forms include `SYS2-01: Merchant Onboarding`, `SYS2-02: Evidence Export`, `SYS2-06: Milestone Sign-Off`, 16 merchant-onboarding forms superseded by app-native Merchant Setup and Offers, duplicate session/module/milestone surfaces, and an A2P lead form.
- Contract proof: the current beta Snapshot plan excludes V1 Make.com/helper assets, old model-specific onboarding forms/workflows, and conflicting duplicates. The archived source inventory explicitly identifies SYS2-01, SYS2-02, and SYS2-06 as obsolete for the beta package.
- Important clarification: the legacy-named `SS--Pulse-Check-Cadence` workflow is not obsolete in behavior. Live inspection confirmed `ScaleSafe App Event` with `Event Type = Pulse Check Due` and one email action. Preserve exactly one such workflow and do not create a duplicate just to correct its name.
- Setup gaps, not packaging defects: three workflows are draft, no domain is connected, and merchant-specific values and business-profile fields are incomplete. Those require an owner decision or normal provisioning; they do not mean the app failed to install.
- Impact: a reviewer or merchant can encounter unsupported forms and duplicate setup surfaces, use the wrong onboarding/evidence path, or conclude that broader GHL scopes are required for assets ScaleSafe no longer uses. The extra material also makes clean-install certification and future provisioning instructions unreliable.
- Severity recommendation: P2 Marketplace packaging and operational-usability defect. The app is installed successfully; the defect is what the attached Snapshot packages.
- Required repair: build a clean V2 source Snapshot that includes only the approved SYS2-07 through SYS2-11 evidence forms, current funnel/pages, and reviewed active workflows. Do not delete PMG's historical assets merely to create the clean package.
- Required regression: install the rebuilt Snapshot into a separate scratch sub-account and compare it to an explicit allowlist. Confirm one pulse app-event workflow, no SYS2-01/SYS2-02/SYS2-06, no old model-specific onboarding forms, no Make.com or Accept.blue assets, and no duplicate payment/evidence paths.

### FIND-074 - Installed GHL Custom Pages time out before backend SSO begins

- Area: GHL Custom Page parent-frame messaging and SSO observability.
- Live proof: the active ScaleSafe reviewer installation and PMG's installed Custom Page both displayed `SSO handshake timed out - GHL did not respond`. The timed-out attempts did not produce `/auth/sso`, so the failure precedes Supabase merchant lookup. The Marketplace Custom Page preview did return agency context, showing that the documented request/response contract works in that surface.
- Code proof: `useApi.ts` posts `REQUEST_USER_DATA` to a fixed set of target origins and rejects after five seconds when no `REQUEST_USER_DATA_RESPONSE` arrives. The error is then rendered through the same generic reinstall-oriented screen used for backend SSO failures.
- Impact: an installed merchant or reviewer cannot open ScaleSafe even when installation assets exist. The current message also obscures whether failure occurred in GHL parent messaging or ScaleSafe backend authentication.
- Severity recommendation: P1 installed-app beta blocker.
- Required repair: isolate the installed iframe topology and current GHL message behavior, retain strict response-origin validation, add explicit `parent_context_timeout` telemetry/UI, and test the exact installed Custom Page surface. Do not add a cross-sub-account chooser or trust a location supplied by the browser URL.
- Required regression: reviewer and PMG installed pages each produce exactly one trusted location-bound `/auth/sso`; agency-context preview still fails closed; an absent parent response fails quickly with typed guidance and no tenant fallback.

### FIND-075 - Marketplace scope list requires exact least-privilege reconciliation

- Resolution, July 18, 2026: the editable draft was verified directly, reduced from 29 scopes to 20, saved, and reloaded. Nine unused scopes were removed: location write, external-auth migration, three custom-object scopes, two legacy Opportunity scopes, and two white-label payment-integration scopes. Seven Opportunity webhooks and the unhandled `PriceCreate` webhook were also disabled. Product and price read/write scopes remain because offer creation writes those records and HighLevel's enabled custom-payment-provider module requires product/price access. The final list and exact reviewer script are in `docs/GHL_MARKETPLACE_SCOPE_EXPLANATIONS.md`.
- Area: GHL Marketplace least privilege and reviewer documentation.
- Live proof: the historical reviewer installation grant and editable draft both contained 29 scopes before the July 18 reduction. The saved draft now reloads with exactly the 20 scopes documented in `docs/GHL_MARKETPLACE_SCOPE_EXPLANATIONS.md`.
- Corrected code and module proof: `src/services/offer.service.ts` creates GHL product and price records, and HighLevel's enabled custom-payment-provider module requires product, price, and provider read/write access. The old pipeline lookup and opportunity-creation methods have no runtime callers in the current code, so Opportunity access and events were removed. External Authentication is disabled, and no current route uses the removed location-write, custom-object, or white-label payment-integration APIs.
- Impact: unnecessary scopes expand access, increase Marketplace review friction, and make the scope-explanation video inaccurate.
- Severity recommendation: P2 configuration and publication gate.
- Required repair: completed in the editable Marketplace draft. Record the scope video from the exact script and reauthorize the clean reviewer installation.
- Required regression: install with the reduced scope set in a scratch sub-account and certify SSO, contacts, conversations, custom fields/values, workflows, appointments, and payment-provider paths without re-adding stale capabilities.

## Operations Access

- Railway CLI 4.35.0 is authenticated as `p_korniotes@yahoo.com` and connected to `pure-renewal / production / ScaleSafe` as of 2026-07-12.
- The baseline deployment for commit `c03bcc5dfbe1c90cfeb361c5e71e118ccbf49920` was successful. Its preceding 24-hour log window contained no error-level entries, warning-level entries, or HTTP responses at or above 400.
- Log review must use narrow timestamps, request/correlation IDs, location ID, route, and safe processor identifiers. Do not paste broad logs containing PII or secrets into documentation.

## Historical Test-Data Noise

- Old `[object Object]` workflow emails remain visible in communications/evidence history.
- Reconciliation reports old missing processor/subscription IDs and unassigned payments.
- The test Stripe account has deliberately unrealistic dispute metrics.
- These records should remain available for troubleshooting but must not be used in public media or treated as representative merchant data.
