# ScaleSafe Live Beta Certification - 2026-07-13

## Purpose

This is the authoritative action ledger for the July 13 deep certification of the WholePay test location. Every state-changing test must be recorded here before the next test begins. A browser success screen alone is not a pass.

## Fixed Test Boundary

- **Location:** `274dtgl30b7x2HG8hn69`
- **Environment:** Railway production application connected to processor test configurations where available.
- **Current baseline before active testing:** `666151b` (`fix: preserve defense exhibit snapshots`)
- **Latest deployed baseline:** `1dce009` (`fix: stabilize defense review and dashboard scans`)
- **Stripe:** test cards are authorized.
- **Whop:** test cards are authorized.
- **NMI:** charge only a clearly identified test offer priced at **$3.00 or less**, use only the saved card ending in **5321**, and add the transaction to the refund ledger below.
- Never record a full card number, processor credential, secret, raw signed action URL, or reusable token in this file.
- Do not alter processor, workflow, domain, webhook, or merchant settings without owner approval.

## Pass Standard

A vertical slice passes only when applicable proof agrees across:

1. Merchant-facing UI result.
2. ScaleSafe HTTP/Railway trace.
3. ScaleSafe database record.
4. Processor record.
5. GHL trigger/workflow execution.
6. Client communication.
7. Enrollment-scoped evidence.

Use `Not Applicable` when a layer legitimately does not participate. Do not call an unobserved layer a pass.

## Certification Matrix

| Test ID | Area / rail | Action | Expected result | UI | Railway | Database | Processor | GHL / message | Evidence | Status | Issue |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| BASE-001 | Deployment | Verify `666151b` | CI green; production deploy healthy | Pass | Pass | N/A | N/A | N/A | N/A | Pass | - |
| DEF-001 | Defense | Open legacy packet `a2d357fa-a9ee-439d-8a61-1c198fbc5302` | Report 8 preserved PDF exhibits without presenting raw contact rows as exhibits | Pass | Pass | Pass | N/A | N/A | Pass | Pass | FIND-001 |
| DEF-002 | Defense | Regenerate an eligible pre-submission packet | Save exact scoped exhibit list used by letter and PDF | Pass | Pass | Pass | N/A | Pass | Pass | Pass | FIND-038 to FIND-042 closed live; performance FIND-044 |
| MILESTONE-001 | Fulfillment | Mark the exact Stripe Plan milestone complete | One exact-enrollment milestone, one workflow execution, and one evidence row | Pass | Pass with 21.1s latency | Pass | N/A | Pass | Pass | Pass with performance follow-up | FIND-045 |
| SIGNOFF-001 | Fulfillment | Complete the public client milestone signoff | Exact enrollment and milestone remain linked through confirmation | Pass | Pass | Pass | N/A | Pass | Pass | Pass | - |
| DEF-003 | Defense | Regenerate after milestone completion and client signoff | Complete packet with exact enrollment fulfillment evidence and no duplicate ready trigger | Pass | Pass with 56.1s latency | Pass | N/A | N/A; no duplicate ready trigger | Pass | Pass with display follow-up | FIND-046, FIND-047 |
| SET-001 | Settings | Open without editing | `All changes saved`; Save disabled | Pass | Pass | N/A | N/A | N/A | N/A | Pass | FIND-002 |
| PULSE-001 | Diagnostics | Open Pulse readiness | Distinct app-event, outbound, and submission timestamps | Pass | Pass | Pass | N/A | Pass | Pass | Pass | FIND-003 |
| STRIPE-HEALTH-001 | Stripe health | Open partial legacy health snapshot | Missing classifications show Unknown, never Safe | Pass | Pass | Pass | Stripe test account | N/A | N/A | Pass | FIND-004 |
| QMS-LOAD-001 | QMS | Open modal and await configuration | Loading state first; no false no-provider error | Pass | Pass | N/A | N/A | N/A | N/A | Pass | FIND-005 |
| OFFER-001 | Offers | Create isolated Stripe PIF certification offer | Saved without changing historical offers | Pass | Pass | Pass | N/A | GHL product/price created | N/A | Pass | - |
| OFFER-002 | Offers | Create isolated Stripe installment offer with add-on | Save exact installment math, terms, milestone, processor, and line item | Pass | Pass | Pass | N/A | GHL product/price created | N/A | Pass | - |
| OFFER-003 | Offers | Create isolated Whop PIF/installment certification offer with add-on | Saved and synchronized with correct PIF, installment, and add-on prices | Pass | Pass | Pass | Pass | N/A | N/A | Pass | FIND-010 |
| OFFER-004 | Offers | Create isolated NMI offer at or below $3.00 | Saved with explicit NMI routing, refund policy, terms, and milestone | Pass | Pass | Pass | N/A | GHL product/price created | N/A | Pass | - |
| CLIENT-001 | Clients | Create isolated certification client | One GHL contact and one tenant-scoped manual client row are created | Pass | Pass | Pass | N/A | GHL contact created | N/A | Pass | - |
| LINK-001 | Enrollment link | Send Stripe PIF offer from client profile by email | Trigger accepted, outbound message observed, and evidence recorded | Pass | Pass | Pass | N/A | Trigger pass; one GHL outbound observed | Two pre-enrollment communication rows | Pass with follow-up | - |
| STRIPE-PIF-001 | Stripe full enrollment | Complete consent and pay $1.00 by Stripe test card | One settled payment, enrolled program, receipt/welcome, signed packet, and enrollment-scoped evidence | Pass | Fail | Partial | Pass | Partial | Pass | Fail; repair in progress | FIND-011, FIND-012, FIND-013, FIND-014 |
| STRIPE-PLAN-001 | Stripe installments | Pay first daily installment with $1.00 order bump | One $2.00 settled payment, correct subscription, line items, next billing, receipt/welcome, packet, and scoped evidence | Pass | Pass | Pass | Pass | Partial | Pass | Pass with configuration follow-up | FIND-013 |
| STRIPE-PIF-002 | Stripe full enrollment retest | Repeat $1.00 PIF after ledger/vault/log repairs | One canonical sale, correctly keyed vault, private packet, receipt/welcome, daily pulse, no signed URL leak | Pass | Pass | Pass | Pass | Partial | Pass | Pass with follow-up | FIND-013, FIND-017 |
| STRIPE-PIF-003 | Stripe repeat checkout and evidence-chain retest | Buy the same $1.00 offer again in the same browser with a new enrollment context | One new charge, exact offer metadata, complete tenant-scoped evidence chain, and no reuse rejection | Pass | Pass | Pass | Pass | Partial | Pass | Pass with configuration follow-up | FIND-013 |
| WHOP-PIF-001 | Whop full enrollment | Select $1.50 PIF plus $1.00 order bump and complete embedded checkout | One $2.50 sale, PIF enrollment with no next billing, exact line items, receipt/welcome, packet, and scoped evidence | Pass | Partial | Fail | Pass | Partial | Pass | Fail; repair in progress | FIND-013, FIND-021 |
| WHOP-PIF-002 | Whop full enrollment retest | Repeat the exact $2.50 PIF-plus-add-on cart after billing-choice repair | Preserve PIF, one sale, exact line items, no recurring state, receipt/welcome, packet, and scoped evidence | Pass | Pass | Pass | Pass | Partial | Pass | Pass with timestamp follow-up | FIND-013, FIND-022 |
| WHOP-PIF-003 | Whop billing-completion retest | Run a fresh $1.50 PIF checkout after first-webhook timestamp repair | First successful webhook sets `billing_completed_at` without recurring state | Hosted form loaded; payment not submitted | Pass through session creation | No payment row | No charge | N/A | N/A | Pending manual secure-frame completion | FIND-022 |
| WHOP-PIF-004 | Whop billing-completion retest | Complete a fresh $1.50 PIF checkout in Brave | First webhook records one sale and stamps billing completion without recurring state | Pass | Pass | Pass | Pass | Partial | Pass | Pass; exposed adjacent QMS defects | FIND-024, FIND-026 |
| WHOP-QMS-001 | Whop Quick Manual Sale | Pay first, then require the signed paid-enrollment flow | Payment remains `paid_pending_enrollment`; no welcome, packet, or enrollment completion before consent | Pass | Pass | Partial | Pass | Partial | Partial | Consent gate passes; post-consent packet and clause defects found | FIND-027, FIND-028 |
| NMI-QMS-001 | NMI saved-method QMS | Charge only the authorized saved card ending 5321 | The exact authorized card is identifiable before charge | Fail | N/A | Pass | Not attempted | N/A | N/A | Blocked safely; no charge | FIND-025 |
| GHL-FULFILLMENT-001 | GHL appointment evidence | Create one exact-enrollment appointment, then mark it Showed | Confirmed event remains engagement; Showed update becomes delivery evidence under the exact enrollment | Pass | Pass | Pass | N/A | Pass | Pass | Pass | - |
| DEF-GHL-001 | GHL fulfillment defense | Compile Visa 13.1 for the exact `$1.00` Stripe payment | Five exact exhibits, one ready trigger, factual component-level claims, valid chronology, and Stripe processor identity | Partial | Pass | Fail | Fail: Stripe payment compiled as NMI dispute | Partial: one ready delivery with wrong processor | Partial | Fail | FIND-053, FIND-054, FIND-055 |
| ZOOM-SETUP-001 | Zoom connection readiness | Inspect OAuth, setup discovery, merchant health, and signed webhook boundary | Authorized state is distinct from event-proven health; setup discovery succeeds; invalid signatures fail closed | Partial | Pass | Pass: invalid signature returned 401 with no writes | N/A | N/A | Pass | Fail | FIND-056 |
| ZOOM-IDENTITY-001 | Zoom participant identity | Trace host and attendee matching before live attendance certification | Host cannot become client attendance; one external attendee maps to the exact enrollment | Fail by code path | N/A | N/A | N/A | N/A | N/A | Blocked before live meeting | FIND-057 |
| CONNECTOR-STATUS-001 | Evidence connection truth | Compare merchant Connected/health labels with live connection state and published events | Draft, testing, disabled, and active evidence states are represented truthfully | Fail | Pass | N/A | N/A | N/A | Pass | Fail | FIND-059 |
| PAYMENT-FILTER-001 | Payment ledger | Inspect processor filter against visible active channels | Every active ledger processor can be selected | Fail | Pass | N/A | N/A | N/A | Pass | Fail | FIND-060 |
| PAYMENT-BACK-001 | Payment management | Open a client payment page and return to the ledger | Back returns to the main Payments workspace without stale state | Pass | Pass | N/A | N/A | N/A | N/A | Pass | - |
| RECON-001 | Payment reconciliation | Run the 365-day reconciliation check | Diagnostics refresh once, return categorized issues, and produce no HTTP error | Pass in 3.0s | Pass: 200 in 1.1s | 35 findings returned | N/A | N/A | N/A | Pass; historical cleanup remains | - |
| CLIENT-NOTE-001 | Client actions | Add a harmless certification note to the fresh Stripe client | One note persists, GHL echo is captured, and client summary refreshes | Partial | Pass | Pass | N/A | Pass | Pass as client-level note | Partial | FIND-065 |
| CLIENT-MESSAGE-001 | Client actions | Send a harmless certification email from the fresh Stripe client | One email is delivered/captured and linked to the intended enrollment with clear success feedback | Partial | Pass | Pass | N/A | Pass | Fail: client-level only | Fail | FIND-014, FIND-065, FIND-066 |
| QMS-PREVIEW-001 | Quick Manual Sale | Open QMS on the fresh client without charging | Identity is prefilled, active Stripe/NMI/Whop offers appear, and payment fields load | Pass | Pass | N/A | Not charged | N/A | N/A | Pass | - |
| STRIPE-RISK-001 | Stripe Risk Health | Refresh risk data and compare UI, API-backed rows, and processor snapshots | Stripe-only metrics and current normalized risk audit display consistently | Fail | Pass | Fail: NMI snapshot selected by Stripe read | Stripe audit completed | N/A | N/A | Fail | FIND-061, FIND-062 |
| STRIPE-DISPUTE-QUEUE-001 | Stripe dispute operations | Inspect the active dispute queue without submitting | Only actionable disputes appear with status-appropriate actions | Fail | Pass | Pass | Stripe test data | N/A | N/A | Fail | FIND-063 |
| CONNECTOR-EVENTS-001 | Evidence connections | Open recent events for existing test and draft connections | Event history loads with target client/program and diagnostic-only test state | Fail | Fail: two HTTP 500 responses | Fail: nonexistent enrollment column queried | N/A | N/A | N/A | Fail | FIND-064 |
| OPS-SUPABASE-001 | Production availability | Open reviewer account and correlate SSO, health, Railway, and Supabase | Installed app opens; health and database respond within bounded time | Fail: Unable to Connect | Fail: reads held 60-300s then 499 | Fail: project Unhealthy/resource exhausted | N/A | GHL shell/location correct | N/A | Launch blocked | FIND-067 |
| OPS-SUPABASE-002 | Disaster recovery | Inspect production backup and recovery state without changing billing | Managed backup exists and a restore is documented | N/A | N/A | Fail: Free plan reports no backups | N/A | N/A | Evidence/Storage backup absent | Launch blocked | FIND-068 |
| OPS-SUPABASE-003 | SSO recovery guidance | Compare reviewer error copy with the proven root cause | Database outage is labeled temporary service failure; reinstall is reserved for missing/revoked installs | Fail: valid install told to reinstall | Pass: SSO binding lookup logged Supabase fetch/522 failures | Fail: dependency unavailable | N/A | GHL shell/location correct | N/A | Fail with workaround: do not reinstall | FIND-069 |
| OPS-REGION-001 | Production topology | Compare active app and database regions | Application and database are intentionally co-located or cross-region latency is accepted with proof | N/A | Fail: Railway replica in us-west2 | Fail: Supabase primary in us-east-1 | N/A | N/A | N/A | Should fix | FIND-070 |
| SEC-SECRET-001 | Repository secret hygiene | Scan tracked tree and verify local password/evidence-artifact exclusions | No live credential in tracked tree; documented local password files and temporary evidence exports are ignored | N/A | N/A | N/A | N/A | N/A | Pass after local repair | Pass pending commit | FIND-071 |
| OPS-RELEASE-001 | Production release control | Inspect branch protection and Railway source/deploy behavior | Production requires a green reviewed commit or an explicit audited owner exception | N/A | Fail: main auto-deploys | N/A | N/A | N/A | GitHub main unprotected | Should fix | FIND-072 |
| GHL-SNAPSHOT-001 | Reviewer Snapshot inventory | Inspect the already-installed clean reviewer account without changing configuration | Install is recognized; current V2 allowlist is packaged once; obsolete/duplicate assets are absent | Partial: app installed, Snapshot populated | N/A | N/A | N/A | 29 workflows, 3 funnels, 27 forms, 160 fields, 22 values | Obsolete/duplicate assets present | Fail packaging gate | FIND-073 |
| GHL-SSO-001 | Installed Custom Page SSO | Open the installed app from reviewer and PMG sub-account context | GHL returns user/location context and backend SSO begins once | Fail: parent-frame timeout in both locations | No `/auth/sso` from the timed-out attempts | N/A | N/A | Marketplace preview returned agency context | N/A | Fail | FIND-074 |
| GHL-SCOPES-001 | Marketplace least privilege | Compare selected draft scopes with current runtime use and enabled Marketplace modules | Only required beta scopes remain selected and are documented for review | Historical fail: draft reported 29; resolved July 18 with 20 saved scopes | N/A | N/A | N/A | Product/price access retained for offer creation and custom payments; legacy Opportunity access removed | N/A | Reauthorization regression remains | FIND-075 |

## Isolated Offer Fixtures

| Test ID | Offer | Offer ID | Tracking ID | Configuration | Verification |
| --- | --- | --- | --- | --- | --- |
| OFFER-001 | `CERT 2026-07-13 Stripe PIF` | `59a8d66f-75a1-49fe-a67e-7d1fd5d47bda` | `cert-stripe-pif-20260713` | Stripe, $1.00 pay in full, full enrollment, four-week live virtual program, daily pulse, one milestone | UI, Railway, database, and GHL product/price creation agree |
| OFFER-002 | `CERT 2026-07-13 Stripe Plan` | `924251a4-5ddc-4b91-88ab-bae37e473c67` | `cert-stripe-plan-20260713` | Stripe, $2.00 total, two daily $1.00 installments, $1.00 order bump, full enrollment, daily pulse, one milestone | UI, Railway, and `offers_mirror` agree; GHL product/recurring price created |
| OFFER-003 | `CERT 2026-07-13 Whop Choice` | `287c4af6-69bf-426a-a630-fd794d118ce5` | `cert-whop-choice-20260713` | Whop, $2.00 total, two weekly $1.00 installments, $1.50 PIF option, $1.00 order bump, full enrollment, weekly pulse, one milestone | UI, Railway, `offers_mirror`, `offer_checkout_addons`, Whop product, and Whop plan agree; Offers table mislabels processor as Default |
| OFFER-004 | `CERT 2026-07-13 NMI PIF` | `ef1dd68f-e8d0-4295-8f47-afece145d9b2` | `cert-nmi-pif-20260713` | NMI, $1.00 pay in full, full enrollment, 30-day refund policy, weekly pulse, one milestone | UI, Railway, database, and GHL product/price creation agree; no charge run yet |

### OFFER-002 Trace

- Created at approximately `2026-07-13T16:09:39Z`.
- Railway returned `201` and logged offer ID `924251a4-5ddc-4b91-88ab-bae37e473c67`.
- Stored installment amount is `1`, frequency is `daily`, payment count is `2`, and processor override is `stripe`.
- The selected terms and milestone text persisted exactly.
- GHL emitted a `PriceCreate` default webhook after product/price creation. ScaleSafe acknowledged it with `200` and logged it as unhandled; no failure or state divergence was observed.

### OFFER-003 Trace

- Created at approximately `2026-07-13T16:12:48Z`.
- Railway returned `201`, logged offer ID `287c4af6-69bf-426a-a630-fd794d118ce5`, and logged a successful Whop synchronization.
- Stored Whop identifiers are present for both product and plan; `whop_sync_status` is `synced` and `whop_sync_error` is empty.
- Stored payment choices are $1.50 PIF or two weekly $1.00 installments. The one-time $1.00 order bump persisted with its fulfillment description.
- The Offers table's Processor column displays `Default` because its current UI logic does not inspect `checkout_type = whop`; see FIND-010.

### OFFER-004 Trace

- Created at approximately `2026-07-13T16:16:02Z`.
- Railway returned `201` and logged offer ID `ef1dd68f-e8d0-4295-8f47-afece145d9b2`.
- Stored price is $1.00, checkout type is direct, and processor override is explicitly `nmi`.
- The 30-day full-refund policy, selected terms, weekly pulse cadence, and Service Activation milestone persisted exactly.
- This offer is the only approved fixture for the upcoming NMI charge. The charge must use saved card ending 5321 and must be written to the refund ledger immediately.

## Isolated Client Fixture

- Name: `ScaleSafe Certification`
- Email: `philk+cert-20260713@openspacebusiness.com`
- GHL contact ID: `IprGRQLOEybLiV1fopQb`
- Initial ScaleSafe enrollment shell: `c420ea6c-e8c5-4f67-b8de-32aef17c8b1a`
- The initial row is intentionally offerless with status `manual_add`; it exists so the contact appears in ScaleSafe before an offer is assigned.
- Railway returned `200` for `/api/dashboard/add-client`; the stored location and contact IDs match the fixed certification tenant.

### LINK-001 Trace

- Started at `2026-07-13T16:19:43Z`; the UI reported success after approximately 15 seconds.
- `/api/dashboard/send-link` returned `200` after 5.4 seconds.
- `ss_send_enrollment_link` was accepted by one active GHL subscription with HTTP `201` and no failed delivery.
- ScaleSafe also sent the enrollment email through GHL Conversations; one resulting GHL outbound message was observed and captured.
- Two evidence rows are expected at this stage: a ScaleSafe `enrollment_link_sent` action record and the actual GHL outbound email record. Only one GHL outbound message has been observed so far; continue watching for unintended duplicate customer delivery.
- Both communication rows are currently pre-enrollment and therefore have no `enrollment_id`. Recheck after checkout to determine whether they become defensibly associated with the resulting enrollment.

### STRIPE-PIF-001 Trace

- Completed at approximately `2026-07-13T16:30:52Z` for $1.00 using Stripe's standard test card.
- The browser reached the Payment Confirmed page immediately after payment.
- Stripe accepted the PaymentIntent and Charge. ScaleSafe created one `sale` payment event for $1.00 and linked it to the exact certification enrollment and contact.
- The enrollment became `enrolled`, recorded one payment, enabled the offer's daily pulse cadence, and generated its signed packet in private storage.
- Generic `consent` and `enrollment_payment` evidence rows were created and linked to the exact enrollment.
- Railway logged a rejected second payment-event insert from `completeEnrollment()` because it used the non-canonical `payment_success` event type. The original `sale` row remained intact.
- The Stripe evidence vault stored the Charge ID in its PaymentIntent field, leaving lookup by the actual PaymentIntent empty.
- `ss_payment_received` and one `enrollment_complete` delivery returned HTTP 201. A second stale `enrollment_complete` subscription retried four times and failed because GHL says that trigger was deleted.
- The two pre-enrollment enrollment-link communication rows still have no enrollment ID after completion. Their defense inclusion must be tested before certification.
- This vertical slice is not a pass until the deployed repair produces exactly one clean ledger row, a correctly keyed Stripe evidence-vault row, complete settlement metadata, and no constraint error.

### STRIPE-PLAN-001 Trace

- Completed at approximately `2026-07-13T17:19:56Z` for $2.00 using Stripe's standard test card: $1.00 first installment plus the selected $1.00 Certification Add-on.
- Browser proof: checkout displayed the correct $2.00 due today, preserved the selected add-on, and reached Payment Confirmed.
- Enrollment `122e1aad-b21c-446b-9828-9ab0c15b3c15` became enrolled, linked to contact `IprGRQLOEybLiV1fopQb`, created one daily Stripe subscription, and set the next billing date to July 14, 2026.
- Payment event `e0612e07-aedc-46ab-adb4-ed5b8d810903` is the only ledger row: canonical `sale`, $2.00, matching PaymentIntent and Charge IDs, card ending 4242, settled timestamp, consent linkage, and two line items.
- The enrollment retained the order-bump title, description, ID, and amount. Generic consent and enrollment-payment evidence rows are scoped to the exact enrollment.
- Railway showed no payment-event constraint error. `ss_payment_received` sent once; one active `enrollment_complete` subscription sent and the known deleted subscription failed after retries.
- The vault keying repair passed, but the row exposed FIND-015: offer metadata remained incomplete when only the Charge webhook arrived during the observed window.
- Packet generation succeeded in private storage. FIND-016 was opened because the background success log printed the complete signed packet URL.

### STRIPE-PIF-002 Trace

- Completed at approximately `2026-07-13T17:38:24Z` for $1.00 using Stripe's standard test card on deployed commit `728eff6`.
- Enrollment `56ec52fc-627f-4e33-b0fc-b01ba6bc8ceb` became enrolled and linked to the isolated certification contact and exact PIF offer.
- Payment event `10d33140-a200-4d29-b498-2fbbf75318ed` is the only ledger row: canonical `sale`, $1.00, correct PaymentIntent and Charge references, card ending 4242, succeeded/settled state, consent linkage, and one base-offer line item.
- The Stripe evidence-vault row is keyed by the PaymentIntent, retains the Charge ID, exact offer ID, client name/email/IP, card and device fingerprints, accepted-terms timestamp, and completed CE identity fields. This closes FIND-015's webhook-ordering defect.
- Exact-enrollment `consent` and `enrollment_payment` evidence rows were present. The enrollment packet was generated at its private storage path and the evidence chain reported strength 70.
- The offer's daily pulse cadence was enabled with the next check due July 14, 2026.
- `ss_payment_received` and one active `enrollment_complete` subscription returned HTTP 201. The known deleted `enrollment_complete` subscription still failed separately after four attempts; FIND-013 remains open.
- The new deployment emitted zero messages containing `/object/sign/` or `token=` during the test. Packet logs contain only the private storage path plus `packetStored: true`, closing FIND-016.
- The vault still labeled the purchase `ScaleSafe Payment` rather than the resolved offer name. FIND-017 records the separate metadata-quality defect.

### STRIPE-PIF-003 Trace

- Completed after deploy `34a90aa` for $1.00 by repeating the same offer in the same browser with a distinct consent and enrollment context.
- Enrollment `e5e75664-f600-42fc-bab8-98e30af220bc` completed successfully. Payment event `95ab89f8-5a18-431e-87a8-830e18a62e02` is the only canonical sale for this attempt and retains the matching PaymentIntent and Charge references.
- The Stripe vault contains the exact offer title `CERT 2026-07-13 Stripe PIF`, full program description, offer ID, customer identity, IP, accepted terms, and processor references. This closes FIND-017.
- The completed browser attempt no longer blocks a legitimate later purchase, while the existing server idempotency claim still protects duplicate submissions. This closes FIND-018.
- The initial background verifier exposed FIND-019: it queried `stripe_evidence_vault` by a nonexistent `location_id` column and incorrectly reported strength 70.
- After deploy `b7b2b27`, a read-only live verification of the same payment returned `complete: true`, strength 90, no gaps, and verified consent, IP, payment, and merchant-owned evidence-vault links. This closes FIND-019.
- The active receipt and enrollment-complete deliveries succeeded. The known deleted GHL trigger still failed after retries, so FIND-013 remains an external configuration follow-up.

### WHOP-PIF-001 Trace

- Completed at approximately `2026-07-13T19:08:08Z` through Whop's embedded hosted checkout for $2.50: $1.50 paid in full plus the selected $1.00 Whop Certification Add-on.
- The browser calculated and displayed the correct cart, loaded the Whop form after deploy `f394c7a`, completed the hosted payment, and reached Payment Confirmed.
- Enrollment `30157c7f-b97d-4cf5-a4df-4de18190e513` is linked to the exact certification client and offer. Its private packet was generated at the expected tenant/enrollment storage path.
- Payment event `5e7305be-e0e0-4e31-80d0-6b52ec4f582e` is the only ledger row: canonical `sale`, $2.50, Whop payment and membership references, `is_recurring = false`, and the exact base-offer/order-bump names, descriptions, IDs, and amounts.
- Exact-enrollment `consent` and `enrollment_payment` evidence rows were created. `ss_payment_received` and one active `enrollment_complete` delivery returned HTTP 201. The known deleted enrollment trigger failed separately after retries.
- Whop and the payment ledger correctly identify a one-time $2.50 transaction, but the webhook completed the enrollment using the offer's default installment type instead of the client's PIF selection. The enrollment incorrectly shows two payments and a July 20 next-billing date. FIND-021 records this state-integrity defect.
- The local repair now stores `payment_choice` in Whop checkout metadata, honors the consent/checkout choice in webhook processing, keeps one-time access memberships separate from recurring billing, and reconciles duplicate successful-payment delivery without duplicating enrollment or payment side effects. Deployment and a clean live retest remain pending.

### WHOP-PIF-002 Trace

- Completed at approximately `2026-07-13T20:10:41Z` after deploy `699cfa5` for the same $2.50 PIF-plus-add-on cart.
- Whop rejected plus-addressing in its hosted email field, so the hosted checkout used a syntactically standard test address while the signed ScaleSafe checkout metadata preserved the original quick-checkout identity. The webhook still matched the exact tenant, offer, enrollment, and contact.
- Enrollment `fabbebc5-f4e8-41d2-a4dc-b9e841ae347a` is `enrolled` and `pif`, with one payment, no payment total, no next billing date, no processor subscription ID, and Whop membership `mem_mCjZfOsJH33rVv` retained as the hosted access identity.
- Payment event `c6e7e1f6-a5b0-4076-8ef6-ba4161c5c82e` is the only canonical sale: $2.50, processor `whop`, succeeded, exact $1.50 base offer and $1.00 order bump, and Whop payment/membership references.
- Exact-enrollment `consent` and `enrollment_payment` evidence rows exist, and the private enrollment packet was generated successfully.
- `ss_payment_received` and the active `enrollment_complete` subscription returned HTTP 201. The known deleted sibling subscription failed after retries; FIND-013 remains open.
- The primary FIND-021 billing-choice defect is closed by this retest. `billing_completed_at` remained null on the first webhook, opening FIND-022; its local repair now reconciles completion state on both first-time and duplicate checkout events.

### WHOP-PIF-003 Trace

- Deployed baseline `e298068` loaded a new $1.50 PIF Whop session with no add-on and no future recurring amount.
- Railway returned `200` for each session request and logged the exact one-time plan shape. No checkout, webhook, enrollment, or payment event completed.
- The third-party secure Whop card fields did not accept automated input in the certification browser. Database verification for the exact test email returned zero payment rows, confirming no accidental charge.
- This is an automation limitation, not a ScaleSafe failure. The live `billing_completed_at` proof remains pending one manually completed sandbox checkout.

### WHOP-PIF-004 Trace

- Submitted through Whop's embedded sandbox checkout at `2026-07-13T22:01:36.067Z` for the $1.50 paid-in-full option.
- Enrollment `9520c085-1ae7-41eb-b686-2962d2fd7389` is linked to the exact certification contact and offer, remains `pif`, has one payment, no next billing date, and no processor subscription ID.
- Payment event `000b4501-5d3d-486a-82d4-c29da5e878db` is the single canonical $1.50 Whop sale with payment ID `pay_02eWnx8JuojsJQ`.
- The first successful webhook stamped `billing_completed_at = 2026-07-13T22:01:52.577Z`, closing FIND-022.
- Client Programs then exposed FIND-024: this enrollment and the earlier enrollment for the same offer each displayed the combined $4.00 from both exact-enrollment payment events.
- This payment was initiated through Quick Manual Sale with **Send paid enrollment link after payment** enabled. The webhook nevertheless changed the enrollment directly to `enrolled`, created a packet, and fired `enrollment_complete` while `digital_signature`, `consent_token`, and consent evidence were absent. FIND-026 records this consent-gating defect.

### WHOP-QMS-001 Trace

- Submitted the embedded Whop sandbox payment at `2026-07-13T22:29:22Z`; the valid checkout completed after the billing address was corrected and Whop delivered the successful webhook at approximately `22:29:49Z`.
- Enrollment `1d38c33a-c316-4b1c-a114-0cd636a6810d` remained `paid_pending_enrollment`, with one exact $1.50 payment event, Whop payment `pay_NwqH3IQ4Qd6bf6`, membership `mem_XrulgvZTroX3hf`, no signature, no consent token, and no `enrollment_complete` before the link was opened.
- `ss_send_enrollment_link` and `ss_payment_received` each fired once with `send_welcome=false`. The client Programs view showed `Resend Link` and the exact $1.50 payment after a fresh record load.
- Page 1 prefilled the known first name, last name, and email; the missing phone remained required. Page 2 displayed only the paid $1.50 summary, with no PIF/installment choice or add-ons.
- Consent submitted at `2026-07-13T22:35:56Z` and reached the success screen in the normal fast path. The enrollment changed to `enrolled`, retained the exact payment identity, stored the signature and consent forensics, created enrollment-scoped `enrollment_consent`, and fired one successful active `enrollment_complete` delivery.
- The same trigger key also retried the known deleted GHL subscription for roughly 38 seconds, so FIND-013 remains open.
- No private enrollment packet or chain verification was produced after consent, opening FIND-027. The PIF terms also required `Installment Billing`, opening FIND-028.

### WHOP-QMS-002 Trace

- Created from Quick Manual Sale for the exact certification client and the $1.50 PIF Whop choice. Enrollment `d46fdead-8ce8-46f1-83f2-2bbe8cfd14b5` and checkout session `ch_P9m5XKssGxrx59D` were created before hosted checkout.
- Whop completed the payment at approximately `2026-07-13T22:51:18Z`. Before consent, ScaleSafe showed one exact $1.50 payment, `paid_pending_enrollment`, and `Resend Link`; no packet or welcome existed. `ss_payment_received` and `ss_send_enrollment_link` each fired once.
- The paid-enrollment funnel prefilled known identity, displayed only the received $1.50 PIF summary, hid payment choices and add-ons, and omitted the installment-billing clause. Consent reached the success screen quickly.
- After consent, the enrollment became `enrolled`, stored consent forensics, generated its private packet independently of the stale GHL trigger retry, and displayed the new packet in Client Files. This closes FIND-027 and FIND-028.
- Deploy `86a6ef4` verified payment event `e8ba68a7-80c2-45ec-b24d-07b5bd2dbe4a` against the later consent through the exact tenant enrollment. The chain strength is 50 with verified payment and consent; the truthful remaining gap is the missing customer payment IP for merchant-entered QMS.
- The embedded Whop form did not transition to a ScaleSafe success state after payment even though the webhook and workflows completed. FIND-030 tracks this separate merchant-feedback defect.

### WHOP-QMS-003 Trace

- Completed after status-reconciliation deploy `062b244` and visible-confirmation deploy `f7a412a` for another $1.50 PIF Whop sandbox payment.
- Enrollment `36d0becb-3c9f-4100-9a45-c7be3f51e8d7` is the exact `paid_pending_enrollment`; payment event `4f70e33f-90a6-449a-ad61-e2930736e1bf` is its single canonical $1.50 sale with Whop payment `pay_BN4yXNVJzdZSC0`.
- The browser callback changed the progress copy to `Confirming the payment with ScaleSafe`, but did not declare success. The authenticated status check then observed the webhook-finalized exact enrollment.
- The embedded checkout was replaced by `Whop payment confirmed`, the modal remained visible, and the only action was `Done`. Client/payment data refreshed behind the modal. This closes FIND-030.
- Recent Payments refreshed to the new sale, but the client summary still showed the preceding total and payment timestamp. FIND-031 tracks this separate client-info refresh defect.

### WHOP-REFUND-001 Trace

- From the full Payment page, issued a full $1.50 refund against the newest refundable Whop payment.
- Whop accepted the refund and its signed webhook added one distinct Refunded ledger row. Total Refunded changed to $1.50 and `ss_refund_processed` fired once.
- The initiating request also displayed a false post-processor warning. Railway showed that the Whop API returned the original `pay_...` payment ID, ScaleSafe attempted to insert it as a second transaction, and the reconciliation worker then linked the claim to the original sale instead of requiring the signed `rf_...` refund event. FIND-033 tracks this ledger/reconciliation defect.
- The original fully refunded sale retained an active Refund button. No second refund was attempted. FIND-032 tracks the refund-availability defect while the existing server-side remaining-balance and refund-claim protections remain in place.

### WHOP-LIFECYCLE-001 Trace

- Created a fresh current-code Whop QMS installment enrollment for `$1.00` per week, two total payments: enrollment `6a0edd5c-d9d0-435a-9229-a5edca7f54c5`, membership `mem_8d7yjd21BXcBPy`, initial payment `pay_yhT5spUmwVvf0F`.
- The Whop checkout and direct readback both proved a renewal plan with a July 21, 2026 renewal boundary. The paid-enrollment funnel correctly stayed consent-only, hid payment choices, completed quickly, and moved the exact enrollment to `enrolled` after signature.
- Pause succeeded in Whop (`payment_collection_paused = true`) and ScaleSafe, with one evidence row and one `ss_subscription_paused` delivery.
- Resume succeeded in Whop (`payment_collection_paused = false`) but ScaleSafe left `next_billing_date` null instead of restoring July 21. FIND-034 tracks the code defect and the required cancel retest after deployment.
- A pre-fix historical paid-in-full Whop membership has external status `completed` but previously accepted local pause/resume state and workflow writes. The same finding adds a preflight/readback guard so ended one-time memberships cannot generate false lifecycle evidence.
- The corresponding GHL pause and resume emails rendered the program as `[object Object]`, while ScaleSafe trigger payloads and contact custom fields contained the correct string. FIND-035 tracks the GHL workflow-template defect; no workflow was changed.
- Post-fix processor retest passed: pause, resume with July 21 renewal restoration, and immediate cancellation each matched Whop state and produced one local evidence/workflow side effect. A completed historical one-time membership was rejected without local mutation. Whop lifecycle processing is certified; customer email copy remains blocked on FIND-035.

### STRIPE-PLAN-RECUR-001 Trace

- Enrollment `122e1aad-b21c-446b-9828-9ab0c15b3c15` collected its second Stripe installment through the live recurring webhook path. Exactly one recurring ledger event was created for Charge `ch_3TsujNQ4vjJOpWaV2G7by0IE`, payment progress reached 2 of 2, billing was marked complete, and no duplicate charge was found.
- The configured installment was `$1.00`, but Stripe settled `$0.96`. Direct processor inspection proved the final invoice was a 23-hour proration caused by ScaleSafe's one-hour-early `cancel_at`. Commit `a7623c7` is deployed; a fresh finite plan must verify the final amount after its next billing boundary.
- The exact ScaleSafe trigger payload named `CERT 2026-07-13 Stripe Plan`, but the GHL receipt named the contact's newer Whop program. FIND-037 tracks the contact-field collision; commit `f025190` refreshes the event's exact enrollment fields before trigger delivery.

### DEFENSE-STRIPE-PLAN-001 Trace

- Packet `13971614-ca2d-4107-931e-41be587a5446` was compiled for the selected `$2.00` Stripe payment on enrollment `122e1aad-b21c-446b-9828-9ab0c15b3c15` using Visa 13.1.
- Railway proved the asynchronous compile completed, stored a seven-page PDF with nine exhibits, and fired one `ss_defense_ready`, but the open UI remained `Pending` until reopened (FIND-038).
- The frozen scope dropped the selected payment's processor ID/date when the enrollment was also supplied (FIND-039).
- The packet mixed exact Stripe Plan emails with sibling Stripe PIF and Whop Choice emails (FIND-040), described the plural `installments` offer as paid in full (FIND-041), and treated an unlinked cancellation note as service delivery despite no milestone/signoff for this enrollment (FIND-042).
- The repair requires exact enrollment identifiers for exact-scope activity, preserves selected payment metadata, adds the selected payment as a first-class exhibit, excludes unapproved generic custom events, and automatically refreshes pending compilation status.
- Post-deploy Version 2 passed the expected safety result: `needs_review`, exact PaymentIntent/date/amount, installment-plus-add-on language, four exact-enrollment exhibits, no sibling-program records, no false delivery claim, and no second `ss_defense_ready` delivery.
- The open UI updated to Version 2 without navigation. Railway recorded a 93.4-second synchronous regeneration, a 16.7-second defense-detail read, and overlapping `at-risk` reads as high as 85.1 seconds. The at-risk route was confirmed to be the main capacity and unintended-side-effect defect (FIND-044); defense latency must be remeasured after that repair deploy.
- The merchant marked `Implementation Review` complete on the exact enrollment. ScaleSafe wrote one milestone evidence row and delivered one `ss_milestone_reached` event with the correct offer, milestone, and enrollment. The endpoint took 21.1 seconds because it waited synchronously for GHL (FIND-045).
- The public signoff page showed the correct work and responsibility. The client acknowledgment produced one exact-enrollment signoff row, one `ss_milestone_signedoff` delivery, and the correct signoff-request and confirmation communications.
- Version 3 regenerated to `complete` with eight exact-enrollment exhibits: signed enrollment packet, milestone, client signoff, four exact-program communications, and the disputed transaction. The letter accurately connected the $2.00 installment/add-on charge to the delivered milestone and client confirmation. No second `ss_defense_ready` event fired.
- Reopening a prior version falsely displayed Version 1, and the defense UI/letter represented the same signoff moment with different calendar dates because browser-local time and unlabeled UTC were mixed (FIND-046 and FIND-047).
- Post-deploy fresh-open verification passed: the packet immediately displayed Version 3, `Complete`, and eight exact-enrollment exhibits. Every exhibit card labeled its date as UTC.
- Controlled Version 4 regeneration passed with status `complete`, eight exhibits, explicit `2:48 AM UTC` signoff language in the browser and rendered PDF, and exactly one historical `ss_defense_ready` delivery overall. This closes FIND-046 and FIND-047.
- Railway measured the synchronous regeneration request at 54.8 seconds even though it completed correctly and produced a seven-page PDF. FIND-048 tracks moving regeneration to an observable background job.
- Dashboard verification after deploy `1dce009` produced no new `disengagement_flagged` evidence. Cached at-risk reads returned in roughly 0.2-0.8 seconds, but the first cold scan after fresh SSO took 23.9 seconds and slowed adjacent dashboard reads. A later Railway-correlated refresh showed the dashboard's four automatic 60-second reads (`overview`, `at-risk`, `defense-history`, and `pulse-checkins`) taking 22.3 to 30.5 seconds in the same cold wave; warm repeats ranged from about 0.2 to 6 seconds. FIND-044 remains open for cold-scan capacity and periodic request fan-out only.

### DEFENSE-PULSE-001 Trace

- Packet `00a794e8-c2ff-4ba7-a6a1-f5378caafe2f` was compiled for Phil Kay's exact `$2,065.00` Stripe payment on enrollment `5493f01b-7712-4ad4-bcf0-2eb590103fc2` using Visa 13.1.
- The exact 3/5 pulse appeared as a communication exhibit. A pulse from another enrollment did not enter the packet, pulse alone did not satisfy service delivery, status landed on `needs_review`, and `ss_defense_ready` did not fire. This closes the base FIND-043 retest.
- The generated draft contradicted that safety result by stating that services were delivered and adding an `Evidence of Service Delivery` section despite zero delivery evidence. FIND-049 tracks the unsupported claim.
- Eight GHL communications in the packet had been linked only by offer-name text at moderate confidence. Three were actually `$2.20` or `$1.00` sibling-enrollment receipts whose rendered contact field named the selected offer. FIND-050 tracks the false exact linkage.
- The pulse source row records that the client requested merchant follow-up, but the exhibit and letter omitted that fact because a stale stored summary overrode current source columns. FIND-051 tracks the omission.
- The frozen signed packet shows a `$2,000.00` base program price and `$2,065.00` amount paid without explaining the `$65.00` card-price adjustment. The defense letter repeats both values without reconciliation. FIND-052 tracks the missing dual-pricing consent breakdown.
- Railway recorded an exact-scope, non-fallback AI compilation in about 53 seconds and a seven-page PDF with 11 exhibits. No source query failed and no ready delivery was created.

### GHL-FULFILLMENT-001 and DEF-GHL-001 Trace

- A fresh `$1.00` Stripe PIF enrollment `6bc8fc63-03e3-469b-8e90-70d9893b74a8` was created for Phil Kay under `CERT 2026-07-13 Stripe PIF`.
- GHL appointment `gj8UInB4SWwi2Z6o57w7` first arrived as `AppointmentCreate` with status `confirmed`. ScaleSafe matched it by `unique_enrollment_at_appointment_time`, kept `proof_role = client_engagement`, and tagged it only `general`.
- Changing the same appointment to `Showed` produced one `AppointmentUpdate` normalized as `completed`. ScaleSafe kept the exact enrollment and offer, created one new `service_delivery` evidence row, and tagged it for `services_not_provided` and `not_as_described`.
- Both GHL webhook requests returned HTTP 200. The frozen defense snapshot contains exactly five exhibits: signed enrollment packet, completed appointment, exact welcome email, selected Stripe transaction, and confirmed appointment.
- Packet `699b3327-1a14-4d1d-847d-ed02e4397abe` reached `complete`, stored a PDF, and fired exactly one `ss_defense_ready` delivery with HTTP 201.
- The letter correctly distinguishes the confirmed appointment from the completed appointment, but then overstates the completed session as proof that the separate written implementation plan was delivered. FIND-053 tracks the unsupported milestone-component claim.
- The packet states that the chargeback was filed July 13 and the transaction occurred July 14 because the UI showed the transaction in Central time while the defense timeline rendered UTC. It still reached complete. FIND-054 tracks the missing chronology guard.
- Although the selected payment is Stripe, compilation created an NMI dispute row, used the sponsor-bank addressee, and sent `processor = nmi` in the ready trigger. FIND-055 tracks the dropped transaction processor and unsafe backend default.

### ZOOM-SETUP-001 and ZOOM-IDENTITY-001 Trace

- Merchant UI shows the Zoom connection for Philip Korniotes as healthy but reports no evidence, no published events, and no affected programs.
- The live OAuth refresh succeeds and the authorized Zoom API can list meetings. The setup discovery call then fails because it selects nonexistent `offers_mirror.status`; the merchant UI does not expose that failure.
- A valid JSON Zoom event with a current timestamp and invalid signature returned HTTP 401. Attendance rows remained at zero and the tenant's external-event count remained unchanged, proving the mutation boundary failed closed.
- Zoom's official participant event supplies `host_id` plus participant user identifiers. Current code does not compare them, labels every participant as `client`, and may resolve an event through the exact GHL meeting bridge before checking email. Live attendance certification is paused until host events cannot contaminate client evidence.

### NMI-QMS-001 Trace

- The certification contact contains only a Stripe 4242 method, so the authorized NMI test moved to Phil Kay's payment-management record.
- Payment Management lists two saved NMI methods with the identical label `NMI mc`; the charge modal provides no last four or other safe identifier.
- Read-only database verification showed the historical NMI rows store `card_last_four = "****"`, so ScaleSafe cannot prove which choice is the authorized card ending 5321.
- No NMI charge was attempted. The test remains blocked until the exact saved method can be identified safely.

## Detailed Test Record

Copy this block before every state-changing test.

```text
Test ID:
Deployed SHA:
Start/end time (CDT and UTC):
Location ID:
Client/contact:
Offer:
Enrollment:
Processor/environment:
Approved amount:

Merchant action:
Expected ScaleSafe state:
Expected GHL state:
Expected processor state:
Expected evidence state:

Browser result:
Railway route/status/request trace:
Database identifiers/state:
Processor identifiers/state:
GHL execution and communication proof:
Evidence record and enrollment match:

Pass/fail:
Issue ID:
Screenshots:
Cleanup required:
```

## NMI Charge and Refund Ledger

Every authorized NMI charge must be written here immediately. A row may not be omitted because a UI step failed.

| Test ID | Charged at CDT | Offer | Contact | Amount | Card | NMI transaction ID | Payment event ID | Enrollment ID | Refund required | Refund status | Refund transaction ID | Notes |
| --- | --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- | --- | --- |
| - | - | - | - | - | ending 5321 only | - | - | - | - | - | - | No NMI charge run yet |

## Issue Register

| Issue ID | Severity | Classification | First observed | Scope | Current state | Retest |
| --- | --- | --- | --- | --- | --- | --- |
| FIND-001 | P1 | Code/data-shape defect | Defense packet live walkthrough | Defense exhibit UI and regeneration snapshots | Fix `666151b` deployed | Pass for legacy and regenerated packets |
| FIND-005 | P2 | UI state defect | QMS walkthrough | Initial configuration loading | Fix `8139dac` deployed | Pass |
| FIND-006 | P1 investigation | Data/matching quality | GHL Fulfillment diagnostics | 121 unresolved historical events | Open | Clean-fixture test pending |
| FIND-007 | P1 certification gap | Configuration/operations | NMI diagnostics | Signed official NMI callback not proved | Open | Signed callback required |
| FIND-010 | P2 | UI status defect | Whop offer creation | Whop checkout offers display `Default` in the Processor column | Open | Fix and retest offer list |
| FIND-011 | P1 | Evidence linkage defect | Stripe PIF certification | Stripe Charge stored as the evidence-vault PaymentIntent key | Fix `7eb2704` deployed | Pass on STRIPE-PLAN-001 |
| FIND-012 | P1 | Ledger/schema contract defect | Stripe PIF certification | `payment_success` rejected by payment-events constraint | Fix `7eb2704` deployed | Pass on STRIPE-PLAN-001; GHL-only path remains targeted-test coverage |
| FIND-013 | P1 configuration | Stale workflow subscription | Stripe PIF certification | Deleted GHL trigger retried on every enrollment complete | Open; no GHL change made | Owner-approved cleanup required |
| FIND-014 | P1 | Evidence scoping | Enrollment link and manual client email | Link and direct merchant communications remain client-level even with one active enrollment | Open | Carry exact enrollment context; never guess newest |
| FIND-015 | P1 | Evidence-vault metadata defect | Stripe installment certification | Charge-first vault row lacks offer/defense metadata | Fix `728eff6` deployed | Pass on STRIPE-PIF-002 |
| FIND-016 | P1 | Security/logging defect | Stripe installment certification | Signed private packet URL emitted to Railway logs | Fix `728eff6` deployed | Pass on STRIPE-PIF-002 |
| FIND-017 | P1 | Evidence-vault description defect | Stripe PIF retest | Direct checkout stores generic `ScaleSafe Payment` instead of the resolved offer name/description | Fix `7861474` deployed | Pass on STRIPE-PIF-003 |
| FIND-018 | P1 | Checkout idempotency defect | Repeat Stripe PIF retest | A completed checkout's browser attempt key blocks a legitimate later purchase with a new consent/enrollment | Fix `34a90aa` deployed | Pass on STRIPE-PIF-003 |
| FIND-019 | P1 | Evidence-chain tenant lookup defect | Repeat Stripe PIF retest | Stripe vault verification filters a table by nonexistent `location_id`, leaving correct chains incomplete | Fix `b7b2b27` deployed | Pass: complete, strength 90, no gaps |
| FIND-020 | P1 | Whop checkout defect | Whop PIF plus add-on certification | Embedded checkout references an out-of-scope `custPhone` variable before session creation | Fix `f394c7a` deployed | Pass: embedded form loaded and charged the correct $2.50 cart |
| FIND-021 | P1 | Whop billing-state defect | Whop PIF plus add-on certification | Webhook replaces the selected PIF type with the offer's default installment type | Fix `699cfa5` deployed | Pass on WHOP-PIF-002: PIF, one $2.50 sale, no recurring state |
| FIND-022 | P2 | Whop lifecycle data defect | Whop PIF clean retest | First successful PIF webhook leaves `billing_completed_at` empty | Fix `e298068` deployed | New PIF must stamp billing complete on its first webhook |
| FIND-023 | P2 | Scheduled-job idempotency defect | Railway log correlation | A second daily health snapshot for the same processor/date violates the unique constraint and fails the merchant run | Fix `1a81220` deployed | Focused/full tests pass; second live same-day run remains optional proof |
| FIND-024 | P1 | Payment/enrollment matching defect | Repeat Whop purchase for one client and offer | Both program cards combine the payments from both enrollments | Fix `9f3bbe3` deployed | Pass: repeat Whop shows $1.50/$2.50 and each repeat Stripe PIF shows $1.00 |
| FIND-025 | P1 | Money-safety/data-quality defect | NMI saved-method certification | Multiple NMI vaults display as identical `NMI mc`; stored last four is `****` | Open; charge blocked | Identify ending 5321 before any NMI charge |
| FIND-026 | P1 | Consent/workflow state defect | Whop QMS live payment | Pay-first Whop webhook enrolls the client, generates packet, and fires welcome before consent | Fix `9f3bbe3` deployed | Pass on WHOP-QMS-001 before consent |
| FIND-027 | P1 | Evidence-generation defect | Whop QMS consent completion | Signed paid enrollment becomes enrolled without generating its private packet or verifying the chain | Fix `c6cc23f` deployed | Pass on WHOP-QMS-002: packet generated independently of trigger retry |
| FIND-028 | P1 | Consent/clause identity defect | Whop QMS PIF consent | PIF requires installment billing; accepted standard clauses use generic positional IDs | Fix `c6cc23f` deployed | Pass on WHOP-QMS-002: no installment clause; semantic clauses retained |
| FIND-029 | P1 | Evidence-chain matching defect | Whop QMS PIF consent | Payment predates consent token, so verifier reports only payment strength despite exact enrollment link | Fix `86a6ef4` deployed | Pass: exact consent + payment links, strength 50, missing payment IP visible |
| FIND-030 | P1 | QMS completion-feedback defect | Whop QMS live payment | Webhook records payment, but embedded modal never leaves disabled Whop checkout or shows ScaleSafe success | Fixes `062b244` and `f7a412a` deployed | Pass on WHOP-QMS-003: server-confirmed success remains visible with one `Done` action |
| FIND-031 | P2 | Client-summary stale-state defect | Whop QMS live payment | Recent Payments refreshes while Total Charged and Last Payment remain on the preceding transaction | Fix `9ecece0` deployed | New QMS sale must update table, total, and last-payment timestamp together |
| FIND-032 | P1 | Refund availability defect | Whop full-refund live test | Fully refunded original payment retains an active Refund action | Fix `e8ab1a2` deployed | Full refund hides action; partial refund exposes only remaining balance |
| FIND-033 | P1 | Whop refund reconciliation defect | Whop full-refund live test and Railway trace | Whop's returned `pay_...` ID is treated as a refund ID; claim is mislinked to original sale | Fix `2ddbf9a` deployed | Pass: one signed `rf_...` row, linked claim, evidence, workflow, and correct remaining balance |
| FIND-034 | P1 | Whop processor-state integrity defect | Fresh recurring and historical completed membership lifecycle tests | Successful POST was trusted without state proof; resume discarded renewal date | Fix `0235e24` deployed | Pass: pause/resume/cancel verified; completed one-time membership rejected without side effects |
| FIND-035 | P1 | App/workflow field-contract defect | Whop pause/resume live emails | Bare trigger variables render as `[object Object]`; lifecycle fields were not refreshed before delivery | Code fix `f025190` pushed; GHL templates unchanged | Owner-approved template edit plus fresh pause/resume email proof |
| FIND-036 | P1 | Stripe money integrity defect | First live finite-plan recurring charge | One-hour-early `cancel_at` prorated final `$1.00` installment to `$0.96` | Fix `a7623c7` deployed | Fresh two-payment daily plan must settle full final amount with no extra invoice |
| FIND-037 | P1 | Multi-enrollment workflow integrity defect | Stripe recurring receipt | Receipt named newer Whop enrollment instead of exact Stripe program | Fix `f025190` pushed | Older-enrollment recurring receipt must name exact program |
| FIND-038 | P2 | Defense UI state defect | Live Visa 13.1 compilation | Detail stayed Pending after backend completed | Fix `9aa59d9` deployed | Pass: Version 2 refreshed in place |
| FIND-039 | P1 | Transaction-scope integrity defect | Live Visa 13.1 compilation | Enrollment-first branch dropped selected processor transaction/date | Fix `9aa59d9` deployed | Pass: exact PI/date retained |
| FIND-040 | P1 | Evidence isolation defect | Live Visa 13.1 compilation | Same-day sibling-program communications entered exact packet | Fix `9aa59d9` deployed | Pass: four exact-enrollment exhibits only |
| FIND-041 | P1 | Defense factual-accuracy defect | Live Visa 13.1 compilation | `installments` was described as paid in full | Fix `9aa59d9` deployed | Pass: two-installment terms and add-on accurate |
| FIND-042 | P1 | Defense readiness defect | Live Visa 13.1 compilation | Generic cancellation note counted as delivery and permitted ready | Fix `9aa59d9` deployed | Pass: needs_review; no second ready trigger |
| FIND-043 | P1 | Defense evidence completeness defect | Defense evidence-path audit | Stored pulse responses were never loaded into defense exhibits | Fix `4e47d50` deployed | Compile an enrollment with a pulse and confirm engagement-only exhibit inclusion |
| FIND-044 | P1 | Dashboard reliability/evidence side-effect defect | Railway/browser correlation | GET at-risk took up to 85.1s and ran GHL/evidence mutations | Mutation fixed; cold-scan latency remains | Zero new evidence writes; cached reads pass; periodic cold wave still reached 30.5s across four routes |
| FIND-045 | P2 | Milestone workflow latency defect | MILESTONE-001 | Successful milestone request blocked 21.1s on GHL delivery | Open | Decouple durable save from observable trigger delivery |
| FIND-046 | P2 | Defense version-label defect | DEF-003 | Reopened Version 2 packet displayed Version 1 | Fix `1dce009` deployed | Pass: fresh open displayed Version 3 before regeneration |
| FIND-047 | P1 | Defense timestamp consistency defect | DEF-003 | UI and narrative showed different dates for one signoff moment | Fix `1dce009` deployed | Pass: UTC matched across UI, Version 4 letter, and PDF |
| FIND-048 | P2 | Defense regeneration latency defect | DEF-004 | Interactive regeneration held the request for 54.8s | Open | Move AI/PDF work to an observable durable background job |
| FIND-049 | P1 | Defense factual-integrity defect | DEFENSE-PULSE-001 | Draft claims services were delivered while the exact evidence gate found none | Open | Prohibit unsupported delivery claims and validate generated text against readiness facts |
| FIND-050 | P1 | Evidence-isolation defect | DEFENSE-PULSE-001 | Moderate offer-name matching admitted sibling-payment receipts as exact enrollment evidence | Open | Preserve match provenance and require strong linkage or validated transaction content |
| FIND-051 | P1 | Pulse evidence-completeness defect | DEFENSE-PULSE-001 | Client follow-up request is present in source data but omitted from exhibit and letter | Open | Compose pulse summary from current source columns and include follow-up state |
| FIND-052 | P1 | Payment-consent/defense defect | DEFENSE-PULSE-001 | `$2,000` accepted price and `$2,065` charge are not reconciled to a stored dual-pricing breakdown | Open | Persist and render the exact selected pricing arithmetic |
| FIND-053 | P1 | Defense factual-integrity defect | DEF-GHL-001 | Completed appointment is presented as proof of a separate written-plan deliverable | Open | Enforce atomic milestone claims and evidence-to-component validation |
| FIND-054 | P1 | Defense chronology-validation defect | DEF-GHL-001 | Complete packet says the dispute predates the selected transaction | Open | Normalize timezone policy and block/hold impossible chronology |
| FIND-055 | P1 | Defense processor/ledger integrity defect | DEF-GHL-001 | Selected Stripe payment created an NMI dispute row and NMI ready payload | Open | Derive processor server-side from selected payment event |
| FIND-056 | P2 | Zoom integration readiness/observability defect | ZOOM-SETUP-001 | OAuth is green while setup discovery fails on nonexistent `offers_mirror.status` and no event is proved | Open | Repair schema query and separate authorized/event-observed/evidence-published health |
| FIND-057 | P1 | Zoom evidence-identity defect | ZOOM-IDENTITY-001 | Host join/leave can resolve as client attendance through an exact GHL meeting bridge | Open; live meeting intentionally blocked | Exclude/reclassify host and prove one real attendee maps once |
| FIND-058 | P3 | Settings product-truth defect | Read-only merchant/payment settings pass | Roadmap preview cards and Beta/Coming Soon labels remain embedded in active settings | Open | Remove preview sections from operational settings and keep roadmap content on Roadmap |
| FIND-059 | P1 | Connector readiness truth defect | CONNECTOR-STATUS-001 | Disabled draft and testing-only connections appear Connected/healthy; test timestamp is labeled Last evidence | Open | Filter connected state and separate diagnostic activity from published evidence |
| FIND-060 | P2 | Payment operations UI defect | PAYMENT-FILTER-001 | Whop rows exist but Whop is absent from the processor filter | Open | Add capability-driven Whop filtering and regression coverage |
| FIND-061 | P1 | Processor-data truth defect | STRIPE-RISK-001 | Stripe Risk Health displays the newest NMI snapshot because reads omit `processor = stripe` | Open | Scope current/history reads by processor |
| FIND-062 | P1 | API/UI contract defect | STRIPE-RISK-001 | Snake-case audit rows render as blank/zero camelCase fields | Open | Normalize one typed risk-audit DTO |
| FIND-063 | P2 | Dispute workflow truth defect | STRIPE-DISPUTE-QUEUE-001 | Won dispute appears in Active queue with Review & Submit | Open | Split active/history and use status-aware actions |
| FIND-064 | P1 | Connector schema/query defect | CONNECTOR-EVENTS-001 | Event-history route returns 500 on nonexistent `enrollments.offer_name` | Open | Use joined offer name and add live-schema regression |
| FIND-065 | P2 | Client action state defect | CLIENT-NOTE-001 / CLIENT-MESSAGE-001 | Successful note/email leaves stale summary or open modal | Open | Refresh affected state and show one success result |
| FIND-066 | P1 | Communication evidence defect | CLIENT-MESSAGE-001 | Manual client email has no enrollment-binding control | Open | Deterministic single-active match or explicit program choice |
| FIND-067 | P1 | Configuration/code availability defect | OPS-SUPABASE-001 | Nano project unhealthy; database/API requests time out and app SSO fails | Open launch blocker | Upgrade capacity, reduce worker polling, add bounded failure handling, then retest |
| FIND-068 | P1 | Operations/data-resilience gap | OPS-SUPABASE-002 | Production project reports no backups | Open launch blocker | Enable managed and off-platform backups, then complete restore proof |
| FIND-069 | P2 | SSO recovery/product-truth defect | OPS-SUPABASE-003 | A valid reviewer installation is told to reinstall when Supabase is unavailable | Open | Classify typed SSO failures and show temporary-service retry guidance for dependency errors |
| FIND-070 | P2 | Configuration/performance gap | OPS-REGION-001 | Railway runs in us-west2 while Supabase runs in us-east-1 | Open | Co-locate app/database through a planned operations change and retest latency |
| FIND-071 | P2 | Preventative security defect | SEC-SECRET-001 | Migration helper and local evidence-review artifacts were not fully excluded from Git | Fixed locally | Commit `.gitignore`; retain redacted secret scanning in release checks |
| FIND-072 | P2 | Operations-security gap | OPS-RELEASE-001 | Unprotected main automatically deploys to production | Open | Add owner-approved branch/status/deployment gates and practice rollback |
| FIND-073 | P2 | Marketplace Snapshot packaging defect | GHL-SNAPSHOT-001 | Clean reviewer install contains obsolete SYS2, model-specific onboarding, and duplicate GHL assets | Open | Build and certify a clean V2 Snapshot in a separate scratch location |
| FIND-074 | P1 | GHL Custom Page SSO defect | GHL-SSO-001 | Installed reviewer and PMG pages time out before backend SSO begins | Open | Isolate parent-frame messaging behavior and add a bounded, observable handshake fallback/test |
| FIND-075 | P2 | Marketplace scope configuration drift | GHL-SCOPES-001 | Historical run found 29 scopes; direct draft reconciliation on July 18 reduced this to 20 and removed unused webhooks | Resolved configuration gate; reauthorization regression remains | Reauthorize the clean reviewer install and run the scope regression without re-adding removed scopes |

## Screenshot Rules

- Capture only fictional/test identities suitable for training.
- Mask or crop email, phone, transaction identifiers, card metadata, and signed URLs when they are not needed to teach the workflow.
- Give screenshots stable names: `TEST-ID_step-description_YYYY-MM-DD.png`.
- Retake screenshots after a material UI fix; do not document a stale failure as the normal workflow.
