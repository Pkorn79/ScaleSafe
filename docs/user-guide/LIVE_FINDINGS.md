# ScaleSafe Live Walkthrough Findings

Status: Open working list from the 2026-07-12 read-only product walkthrough.

No setting, workflow, processor, payment, enrollment, or external system was changed while verifying these findings.

## Triage Summary

| ID | Area | Recommended Priority | Verification | Likely Effort |
| --- | --- | --- | --- | --- |
| FIND-001 | Defense exhibits | P1 | Fixed; legacy live packet passed, regeneration retest pending | Small/medium |
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

## Confirmed Code-Backed Findings

### FIND-001 - Defense Exhibits tab is never populated

- Area: Defense
- Impact: The generated letter and PDF can contain exhibits while the on-screen Exhibits tab says `0` and `No evidence exhibits available`.
- Live proof: Existing Mastercard 4855 packet references Exhibits A-D and has a five-page PDF; its Exhibits tab shows zero.
- Code proof: `DefenseDetailView.vue` declares `exhibits` and passes it to `ExhibitsTab`, but `refresh()` only assigns the packet response and never assigns exhibit data.
- Severity recommendation: P1 for beta trust/operability.
- Required regression: Open a compiled packet and verify the UI exhibit list matches the PDF exhibit index and packet evidence count.
- Root cause confirmed: legacy packets stored a contact-wide raw array while regeneration rebuilt the scoped letter/PDF without replacing that old snapshot. Commit `666151b` now freezes the regenerated exhibit set and gives submitted legacy packets an honest PDF-count notice instead of relabeling raw timeline rows.
- Live retest: submitted packet `a2d357fa-a9ee-439d-8a61-1c198fbc5302` now reports `Evidence Exhibits (8)` and directs the merchant to its frozen PDF. A pre-submission regeneration still needs a live certification run.

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

### FIND-014 - Enrollment-link communications are not linked after the enrollment is created

- Area: Communication evidence and defense scoping.
- Live proof: The isolated client received an enrollment link before checkout. Both the ScaleSafe send record and the observed GHL outbound email were created with `enrollment_id = null`; both remained null after the exact offer enrollment completed.
- Impact: Enrollment-scoped defense generation may omit the pre-enrollment delivery/consent communication unless another defensible matching layer associates it.
- Classification: P1 investigation until defense exhibit behavior is tested against this exact enrollment.
- Required regression: Compile a packet for the isolated enrollment and verify whether the two link communications are included only for that enrollment. If omitted, implement exact offer/context linkage rather than newest-enrollment guessing.

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

### FIND-039 - Supplying the enrollment drops selected transaction metadata

- Area: Dispute scope resolution.
- Live proof: the packet selected payment event `e0612e07-aedc-46ab-adb4-ed5b8d810903`, but its frozen scope had null processor, processor transaction ID, and transaction date because the resolver returned from the enrollment branch first.
- Impact: the letter and timeline omit the exact disputed transaction identifiers even though the merchant selected the transaction.
- Repair: resolve the payment first whenever a payment ID exists, verify its tenant/contact/enrollment/offer relationship, and preserve its processor metadata.
- Required regression: matching payment plus enrollment retains transaction metadata; mismatched enrollment or offer fails closed.

### FIND-040 - Exact packet includes sibling-enrollment communications

- Area: Enrollment-scoped exhibit assembly.
- Live proof: the Stripe Plan packet included same-day Stripe PIF and Whop Choice emails from sibling enrollments because date-window and offer-name fallbacks were accepted under exact scope.
- Impact: bank-facing evidence can describe purchases unrelated to the disputed transaction, including repeat purchases of the same offer.
- Repair: exact scope requires an enrollment identifier; offer/date/name inference is permitted only in an explicitly inferred packet that requires review.
- Required regression: two programs and two enrollments of the same offer on one contact produce exhibits only for the selected enrollment.

### FIND-041 - Plural installment value is described as paid in full

- Area: Defense offer context.
- Live proof: the selected offer stores `payment_type = installments`, while the context builder recognized only singular `installment` and generated paid-in-full language.
- Impact: the defense letter materially misstates the agreement and transaction structure.
- Repair: normalize both supported installment values before generating price/payment language.
- Required regression: plural `installments` produces the configured count, cadence, and installment amount and never says paid in full.

### FIND-042 - Generic cancellation note passes the service-delivery gate

- Area: Defense readiness and unified evidence.
- Live proof: no milestone or signoff existed for the selected enrollment, but an unlinked GHL cancellation note entered as a generic custom event, was described as delivery, and helped a Visa 13.1 packet reach `complete` and fire `ss_defense_ready`.
- Impact: ScaleSafe can mark a services-not-provided defense ready without actual delivery evidence, and AI may turn an operational note into a false milestone claim.
- Repair: generic custom events are excluded unless explicitly approved with a delivery/access/deliverable/milestone proof role; the selected payment is included separately as payment evidence.
- Required regression: a 13.1 packet with payment/consent but no delivery proof lands on `needs_review` and does not fire ready.

## Operations Access

- Railway CLI 4.35.0 is authenticated as `p_korniotes@yahoo.com` and connected to `pure-renewal / production / ScaleSafe` as of 2026-07-12.
- The baseline deployment for commit `c03bcc5dfbe1c90cfeb361c5e71e118ccbf49920` was successful. Its preceding 24-hour log window contained no error-level entries, warning-level entries, or HTTP responses at or above 400.
- Log review must use narrow timestamps, request/correlation IDs, location ID, route, and safe processor identifiers. Do not paste broad logs containing PII or secrets into documentation.

## Historical Test-Data Noise

- Old `[object Object]` workflow emails remain visible in communications/evidence history.
- Reconciliation reports old missing processor/subscription IDs and unassigned payments.
- The test Stripe account has deliberately unrealistic dispute metrics.
- These records should remain available for troubleshooting but must not be used in public media or treated as representative merchant data.
