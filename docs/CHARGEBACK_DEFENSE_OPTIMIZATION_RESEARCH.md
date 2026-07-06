# ScaleSafe Chargeback Defense Optimization: Research & Planning Report

## Executive Summary

ScaleSafe's core thesis — capturing lifecycle evidence and generating transaction-specific defense packets for high-ticket service businesses — is fundamentally sound and aligns with what card networks actually reward. But the quality of a defense packet is decided by two things ScaleSafe must get right: (1) matching evidence precisely to the network reason code, and (2) telling a clean, chronological, transaction-first story that a bank reviewer can absorb quickly (industry practitioners commonly estimate reviewers spend only a few minutes per case — treat this as a working assumption, not a network-published figure). Generic evidence dumps lose.

Key strategic conclusions:

1. **Services businesses live in the "Consumer Dispute" / "Cardholder Dispute" families, not the fraud family.** The most common and winnable disputes for agencies, coaches, and consultants are Visa 13.1/13.2/13.3/13.5, Mastercard 4853/4841, Amex C08/C28/C31, and Discover RG/AA/AP. For these, the strongest evidence is proof of delivery/access + proof of agreement to terms + a documented usage/engagement trail — exactly what ScaleSafe captures. For true fraud disputes (Visa 10.4, MC 4837, Amex F29), ScaleSafe should be honest that these are hard to win and are governed by rigid network "compelling evidence" specs (Visa CE 3.0, Mastercard First-Party Trust).

2. **CE 3.0 and First-Party Trust are structured data programs, not narrative arguments.** Visa CE 3.0 requires two prior undisputed transactions 120–365 days old with matching data elements, and applies ONLY to Visa 10.4. Mastercard First-Party Trust uses three categories of data signals and, unlike Visa, can protect first-time customers. ScaleSafe cannot "win" these with prose — it must capture the specific data elements (IP, device ID, login history, delivery/access records) at the time of the transaction and every session thereafter.

3. **ScaleSafe's biggest risks are: over-dumping communication history, over-promising win rates, and weak clickwrap capture.** The packet must avoid irrelevant contact logs, must never claim a chargeback is winnable when the merchant failed to deliver, and must capture defensible clickwrap acceptance (versioned terms + timestamp + user identity + IP). ScaleSafe should build explicit "missing evidence" warnings and a manual-review gate when scope confidence is low, and should never position itself as a law firm, collections agent, or merchant of record.

---

## Part 1 — Card-Brand / Dispute-Category Research Table

All reason-code and evidence expectations below are drawn from primary network documents (Visa *Dispute Management Guidelines for Visa Merchants*, June 2024 — usa.visa.com; Mastercard *Chargeback Guide*, Merchant Edition 13 May 2025 — mastercard.us; American Express *Disputes Reference Guide* — americanexpress.com) and Stripe's network-mapped defense documentation (docs.stripe.com/disputes).

### Response deadlines (merchant/acquirer side)
- **Visa:** **30 calendar days** from the chargeback processing date to respond (dispute response / pre-arbitration window). Confirmed by Chargeback Gurus for 13.1/13.3/13.5: "The acquirer or merchant has 30 days to respond to a chargeback filed under reason code 13.1." (chargebackgurus.com)
- **Mastercard:** **45 days** to file a second presentment (mastercard.us Chargeback Guide; chargebackgurus.com reason code 4837).
- **American Express:** **20 days** to respond to an inquiry or chargeback (americanexpress.com *US Disputes Reference Guide*: "you have 20 days to respond to an Inquiry or Chargeback with supporting documentation").
- **Discover:** ~20–30 days to respond (30 days commonly cited by Chargeback Gurus; a 20-day representment window is also referenced by Chargebacks911).

### Reason-code families
- **Visa** (Visa Claims Resolution): 10 = Fraud; 11 = Authorization; 12 = Processing Errors; 13 = Consumer Disputes.
- **Mastercard:** Authorization (4808); Point-of-Interaction / Processing Errors (4834); Fraud (4837); Cardholder Disputes (4853), plus 4841 (canceled recurring/digital goods), 4860 (credit not processed).
- **American Express:** alphanumeric — F-codes (fraud), C-codes (cardmember disputes), P-codes (processing errors), A-codes (authorization), R-codes (non-response).
- **Discover:** two-letter codes — RG (non-receipt), AA (does not recognize), AP (canceled recurring), RM (quality), plus fraud/authorization/processing families.

### Dispute-by-dispute evidence (services-business lens)

| Dispute type | Visa | MC | Amex | Discover | Most persuasive evidence | Often weak / irrelevant |
|---|---|---|---|---|---|---|
| Fraud / unauthorized (CNP) | 10.4 | 4837 | F29 | AA/UA | CE 3.0 / First-Party Trust data: IP, device ID/fingerprint, AVS/CVV match, 3DS/Visa Secure auth, login history, prior undisputed transactions | Rebuttal prose alone; terms of service; generic "we delivered" claims |
| Services not provided / not received | 13.1 | 4855/4853 | C08 | RG | Proof of service completion: milestone signoffs, session/attendance logs, login/access timestamps, deliverable files, communications confirming receipt | Marketing copy; unrelated contact history; refund policy |
| Not as described / defective | 13.3 | 4853 | C31/C32 | RM | Offer terms/scope as presented at purchase, deliverables matching description, usage logs, engagement showing satisfaction, rebuttal addressing each claim | Refund policy (Visa explicitly says return policy has no bearing on 13.3); referral to a third party |
| Misrepresentation | 13.5 | 4853 | C31 | RM | Accurate terms of sale, disclosure records; for trial/one-off, proof cardholder agreed to future billing + notice ≥7 days before the transaction date | Aggressive claims; income-promise marketing that contradicts terms |
| Credit/refund not processed | 13.6 | 4860 | C02/C04 | RN2 | Refund transaction record (amount + date), refund/cancellation policy agreed at purchase, proof no refund was due | Claiming refund issued without the transaction record |
| Canceled recurring | 13.2 | 4841 | C28 | AP | Proof of cancellation terms accepted, cancellation-request logs (or absence), usage after cancellation date, express consent to recurring | Billing after a cancellation request was received (indefensible) |
| Canceled merchandise/services | 13.7 | 4853 | C05 | — | Cancellation policy properly disclosed + accepted, proof cardholder didn't cancel per policy, continued usage | Undisclosed no-return policy |
| Duplicate processing | 12.6.1 | 4834 | P08 | DP | System logs showing two separate purchases, or proof one was an auth hold, receipts for distinct services | — |
| Paid by other means | 12.6.2 | 4834 | C14 | — | Sales records showing card was the only payment; proof the two charges were distinct | — |
| Authorization disputes | 11.x | 4808 | A01/A02/A08 | — | Authorization logs/approval codes; proof charge matched authorized amount | Contesting when no valid auth exists |
| Did-not-agree-to-terms | 13.5 (or 10.4) | 4837/4853 | C31/F29 | AA | Clickwrap acceptance record: versioned terms, timestamp, user ID/email, IP, "I agree" event log | Terms text alone without proof of acceptance |
| Did-not-receive access/delivery | 13.1 | 4855/4853 | C08 | RG | Login/access logs, download timestamps, onboarding completion, session attendance, portal activity tied to cardholder | City/ZIP-only confirmation; no identity linkage |

---

## Part 2 — Card-Brand Documentation Expectations (Detail)

### Visa
- **Compelling Evidence rights exist only for Conditions 10.1, 10.3, and 10.4** (fraud). For consumer-dispute conditions (13.x), Visa specifies condition-specific "how should I respond" evidence rather than the formal Compelling Evidence chart.
- **CE 3.0 (Condition 10.4 only):** two previous undisputed transactions settled 120–365 days before the dispute, same payment credential, no prior fraud report, with at least two matching data elements (of: customer account/login ID, delivery address, device ID/fingerprint, IP address) where one must be IP address or device ID/fingerprint. Consistent billing descriptors matter (first six characters must match). Confirmed by Chargebacks911: the cardholder "completed two or more transactions (settled more than 120 calendar days prior to the dispute) which were not reported as fraud, and which have at least two data elements (device ID, device fingerprint, or the IP address) in common." Successfully resolved TC40 fraud qualifying under CE 3.0 is excluded from the VAMP ratio.
- **Digital services / card-absent compelling evidence (10.4):** description of downloaded goods/services + date/time of download + two or more of: purchaser IP + device geolocation; device ID + device name; purchaser name/email linked to profile; evidence the profile was accessed and verified before the transaction date; evidence the merchant's site/app was accessed by the cardholder on/after the transaction date; evidence the same device+card were used in a prior undisputed transaction.
- **Recurring transactions (Item 13 of the CE chart):** a legally binding contract + evidence the cardholder is using the goods/services + a previous undisputed transaction.
- **13.2 update (effective 19 October 2024):** merchant may show the cardholder used services after the withdrawal-of-permission date and before the dispute processing date.
- **Subscription/free-trial rules:** express consent at enrollment; enhanced notification with cancellation link at least 7 days before a trial/promo converts; explicit transaction receipts disclosing trial length + that the cardholder will be charged unless they cancel; easy online cancellation regardless of signup channel. For 13.5 misrepresentation on trials, provide proof the cardholder expressly agreed to future transactions AND notified the cardholder of an upcoming charge at least 7 days in advance (per Chargebacks911, Visa).
- **13.3 special rules:** the merchant's return policy has no bearing; the merchant may not refer the cardholder to the manufacturer; quality disputes may require a neutral third-party opinion.
- **VAMP (effective 1 April 2025; enforcement 1 October 2025):** single count-based ratio = [TC40 fraud + TC15 disputes] ÷ settled transactions on CNP VisaNet transactions. Merchant "Excessive" threshold 2.2% enforced Oct 1, 2025, dropping to 1.5% on April 1, 2026 for US/Canada/EU, carrying an $8-per-fraud-or-disputed-transaction fee (Chargeback Gurus: "Merchants – Excessive: $8 per fraudulent or disputed transaction"). Applies to merchants with ≥1,500 monthly fraud+dispute events. CE 3.0-qualified fraud and RDR-resolved disputes are excluded.

### Mastercard
- **Reason code consolidation:** 4855 (goods/services not provided) and 4841 items have largely been folded into 4853 (Cardholder Disputes), though legacy codes remain valid. 4837 = No Cardholder Authorization (fraud); 4841 = Canceled Recurring or Digital Goods; 4860 = Credit Not Processed; 4834 = Point-of-Interaction Error/duplicate.
- **4853 recurring:** merchant may show the transaction was installment (not recurring), that the cardholder failed to meet signed cancellation terms, that services were used after the cancellation date, or that proper disclosure of the recurring arrangement was provided and accepted.
- **Digital goods ≤ $25 modifier:** merchant must show minimum purchase controls — default option to disable digital purchases, account-open window not exceeding 15 minutes from credential entry, and confirm/cancel of the displayed total before completion.
- **First-Party Trust (Mastercard's CE 3.0 analogue):** launched in the US (piloted 2023, broad US availability October 2024) and expanded globally on 25 June 2025 (Mastercard Newsroom). Requires one data element from each of three categories — Device identity (IP address, device ID, fingerprint), Delivery (shipping address, email, or telephone), and Identity (account ID, login history, device name/location, or billing address) (Mastercard b2b blog; granular element lists per Merchant Cost Consulting / cside.com). Unlike Visa CE 3.0, secondary sources (Chargeblast, Merchant Cost Consulting) indicate it does not require prior undisputed transaction history and so can protect first-time customers — though other sources note the post-dispute path may still match against historical transactions; reconfirm against the Mastercard Chargeback Guide before relying on the first-time-customer claim. Applies primarily to 4837.
- **Chargeback Guide** includes a dedicated compelling-evidence section for "airline, recurring, installment-based repayment, e-commerce, and/or MO/TO transactions," plus installment-billing dispute remedies (correct number of installments, correct installment amount, not premature, valid acceleration).

### American Express
- As both network and issuer, Amex disputes are often more direct. Merchant response window is 20 days (americanexpress.com Disputes Reference Guide).
- C08 (not received/partial): proof of delivery/service completion; digital-goods modifier requires IP-match evidence; airline modifier requires boarding pass/manifest/miles/ancillary purchases.
- C28 (canceled recurring): proof of subscription agreement + auto-renewal consent, cancellation policy, proof of non-cancellation, usage logs after the charge.
- C31/C32 (not as described / defective): written descriptions from time of purchase, service completion records, proof of acceptance, communications, return policy.
- R03/R13 (insufficient/no reply): losing by default for late or non-responsive submissions — a process risk ScaleSafe must guard against with deadline tracking.

### Discover
- 26 reason codes across Fraud, Authorization, Processing Errors, Services, Dispute Compliance.
- RG (non-receipt of goods/services/cash): proof of delivery or service completion; digital = email/IP/date/time of download; ~20–30 day response window.
- AA (does not recognize): evidence cardholder received goods/services, identity verification, authorization approval; recurring-billing authorization proof.
- AP (canceled recurring): subscription authorization and cancellation-policy evidence.

---

## Part 3 — Recommended ScaleSafe Defense Packet Structure

Design principle: front-load the answer and make the reason-code rebuttal skimmable (reviewers give each case only minutes). Follow the "reverse pyramid" — most compelling evidence first.

**1. Cover / Rebuttal Letter (1 page, always first)**
- Identifiers: merchant DBA + MID, ARN, case/dispute ID, network reason code, transaction amount, original transaction date.
- One-sentence thesis directly answering the reason code (e.g., "The cardholder received and used the enrolled coaching program; access logs and milestone signoffs are provided as Exhibits A–C.").
- 3–6 bullet points, each a claim → exhibit reference.
- Professional, factual close. No legal threats, no emotion.

**2. Executive Summary of the Transaction (½ page)**
- What was sold (offer name + scope), price and payment structure (paid-in-full / installment / subscription), enrollment date, fulfillment model.

**3. Transaction Timeline (chronological table)**
- Columns: Date/time | Event | Evidence reference | Cardholder-linked identifier (IP/device/email/login).
- Include: terms acceptance → payment → onboarding → deliverables/milestones → sessions → pulse check-ins → communications → dispute date. Mark the dispute date and highlight that engagement occurred after purchase.

**4. Reason-Code-Specific Argument Section**
- A single section tailored to the exact code. State the network's standard for that code and map each ScaleSafe exhibit to that standard.

**5. Exhibits (labeled A, B, C… in order of persuasiveness)**
- Each exhibit gets a one-line caption stating what it proves. Group by type (agreement/terms, payment, delivery/access, engagement, communications, refund/cancellation records).

**6. Prior-transaction / CE 3.0 or First-Party Trust data block (fraud disputes only, when applicable)**
- Structured data fields, not prose.

**Language guidance**
- Strong: "The evidence contradicts the cardholder's claim." Factual, specific, dated.
- Avoid: legal threats ("we will pursue legal action"), blaming the issuer/network, emotional language, company history, industry statistics, the customer's behavior with other merchants.
- Do NOT dump full contact history. Include only communications that prove receipt, acceptance, satisfaction, or absence of a pre-dispute complaint.

---

## Part 4 — ScaleSafe Evidence Mapping Matrix

| Dispute type | Strongest ScaleSafe evidence | Secondary evidence | Missing-evidence risk | Recommended packet language | Product improvement needed |
|---|---|---|---|---|---|
| Fraud / unauthorized (10.4 / 4837 / F29) | Login history + device ID/IP at enrollment and each session; AVS/CVV/3DS result; prior undisputed payments on same credential | Onboarding identity capture; email/SMS confirmations tied to account | No device/IP capture; no identity linkage → CE 3.0/FPT ineligible | "The same device and login used at enrollment accessed the program on [dates]." | Capture + store IP, device fingerprint, login timestamps for 18+ months; surface CE 3.0/FPT eligibility flag |
| Services not provided (13.1 / C08 / RG) | Milestone signoffs; session attendance; portal access logs; delivered files | Pulse check-in responses confirming progress; comms confirming receipt | Signoffs not timestamped or not cardholder-linked | "Cardholder accessed deliverables on [dates] and signed off on milestone [X]." | Timestamp + identity-bind every signoff and access event |
| Not as described (13.3 / C31 / RM) | Offer terms/scope as shown at purchase; deliverables matching scope; pulse responses showing satisfaction | Support threads offering remedies | Scope described only in marketing, not in accepted terms | "Delivered scope matches the enrollment agreement accepted [date]; cardholder rated progress positively on [date]." | Version and snapshot the exact offer/scope shown at checkout |
| Misrepresentation (13.5 / 4853) | Accepted terms; disclosure records; for trials, express consent + 7-day notice logs | Communications setting expectations | No record of advance billing notice | "Cardholder expressly agreed to the payment schedule and was notified [date], 7+ days before billing." | Automate 7-day pre-billing notice + store proof |
| Credit not processed (13.6 / C02 / RN2) | Refund transaction record (amount+date); refund policy accepted | Comms explaining refund terms | Refund claimed but no processor record | "A refund of $X was processed on [date]; see Exhibit A." | Pull refund/settlement records directly from processor |
| Canceled recurring (13.2 / C28 / AP) | Cancellation-request logs (or absence); express recurring consent; usage after cancel date | Terms with cancellation policy | Billing after a cancellation request (indefensible) | "No cancellation request was received before the [date] billing; cardholder used the service on [dates]." | Cancellation-event ledger + block billing after cancel |
| Duplicate / paid by other means (12.6 / 4834 / P08/C14) | Processor logs distinguishing the two charges | Receipts for distinct services | Auth-hold vs settle not distinguishable in data | "The two charges correspond to separate offers billed [dates]." | Store auth vs capture states clearly |
| Did-not-agree-to-terms (varies) | Clickwrap record: versioned terms + timestamp + user ID/email + IP + "I agree" event | Screenshot/archive of the acceptance screen | Terms text stored but no acceptance event or version | "Cardholder actively accepted v[X] of the terms on [date] from IP [Y]." | Immutable, versioned clickwrap capture with acceptance audit trail |

Note on clickwrap: courts consistently favor clickwrap over browsewrap (one widely-cited 2020 analysis found ~70% court success for clickwrap vs ~14% for browsewrap). Enforceability turns on proof of a specific user accepting a specific version at a specific time — so ScaleSafe's acceptance audit trail (user ID, timestamp, version, IP, screenshot of the acceptance screen) is precisely the evidentiary backbone issuers and courts look for.

---

## Part 5 — Product Recommendations by Priority

### Beta-critical (before launch)
1. **Reason-code-aware packet assembly.** The packet must branch on the specific network reason code, not a generic template. If ScaleSafe currently produces one universal packet, this is the single most important fix.
2. **Defensible clickwrap capture.** Store versioned terms, timestamp, user ID/email, IP, and the discrete "I agree" event. Terms text without a linked acceptance event is weak.
3. **Identity-bound, timestamped delivery/access evidence.** Every milestone signoff, session, login, and file access must carry a timestamp and a cardholder-linked identifier.
4. **Missing-evidence warnings.** Before generating a packet, flag which reason-code-required elements are absent and rate packet strength.
5. **Manual-review gate on low scope confidence.** If the system cannot confidently classify the dispute type or the offer structure, route to human review rather than auto-generating.
6. **Deadline tracking.** Surface network-specific response windows (Visa 30d, MC 45d, Amex 20d, Discover ~20–30d) to prevent default losses (Amex R03/R13).
7. **Honest "don't fight this" guidance.** When the merchant failed to deliver, billed after cancellation, or lacks required evidence, advise accepting the chargeback.

### Soon after beta
8. **CE 3.0 / First-Party Trust data capture and eligibility flagging.** Store IP, device fingerprint, login history for 18+ months; auto-detect two prior undisputed transactions (Visa) or the three-category data set (Mastercard).
9. **Consistent billing-descriptor checks** (first six characters) to support CE 3.0 matching and reduce "does not recognize" disputes.
10. **Automated subscription/trial compliance:** express consent capture, 7-day pre-billing notice with cancellation link, explicit receipts.
11. **Pulse-question redesign for evidentiary value.** Add periodic, timestamped satisfaction/progress confirmations phrased so a positive response rebuts "not as described." (Caution: pulse questions that surface dissatisfaction can also create adverse evidence — design so responses are factual acknowledgments of receipt/progress, and retain them regardless of sentiment.)
12. **Milestone/signoff wording** that captures explicit acknowledgment of receipt and acceptance.
13. **Refund/cancellation ledger** pulling processor settlement records.

### Longer-term roadmap
14. **Third-party activity integrations** (course platforms, community tools, calendars) to corroborate usage and access.
15. **Win/loss analytics** by reason code and evidence type to refine which disputes are worth fighting.
16. **Issuer-preference learning** (limited) — track outcomes to tune packet emphasis.
17. **Merchant pre-dispute guidance** — coach merchants to resolve directly and document, and integrate pre-dispute deflection (e.g., Visa RDR/Order Insight, Ethoca alerts) awareness so winnable-but-costly disputes are refunded before they hit the dispute ratio.

---

## Part 6 — Implementation Planning Notes (no code)

- **Scope resolution first.** The pipeline must classify (a) network, (b) reason code / family, (c) offer structure (paid-in-full / installment / subscription / refund / cancellation / delivered service) before selecting a template. Low confidence → manual review.
- **Evidence service contracts.** Each evidence type should expose: what it proves, timestamp, cardholder-linked identifier, source system, and a confidence/completeness flag. This enables missing-evidence warnings and exhibit ranking.
- **Template system = base + reason-code modules.** A shared cover/summary/timeline skeleton plus reason-code-specific argument modules and evidence-priority ordering. Prior successful payments should surface only for fraud disputes or where recurring-usage continuity is relevant — never as filler.
- **Exhibit ranking.** Order by persuasiveness for the specific code, cap length, one-line captions, group by type.
- **PDF generation.** Legible, English (or translated), high-contrast, labeled exhibits, consistent pagination referenced by the cover letter. Respect processor caps — Stripe limits evidence to 4.5 MB for all networks and 19 pages for Mastercard (docs.stripe.com).
- **AI-assisted letters.** Constrain the model to factual, reason-code-specific language; forbid legal threats, emotional or aggressive tone, speculation, and irrelevant history. Never allow the model to reference exhibits that do not exist. Human review before submission.
- **Guardrails.** ScaleSafe assists the merchant's evidence-backed response only. It must not act as a law firm, collections agency, or merchant of record, and must not guarantee outcomes.

---

## Part 7 — Repo Code-Review Checklist & Evaluation Rubric (substitute for inaccessible repo review)

Apply this in a developer session with repo access. For each file category, answer the questions and score strong/weak.

### A. Dispute scope resolution
- Does it map to the specific network reason code, or only a broad category? (Strong: exact code + family. Weak: single generic path.)
- Does it classify offer structure (paid-in-full/installment/subscription/refund/cancellation/delivered service)?
- Is there a confidence score and a manual-review fallback when confidence is low?
- Does it handle multi-network differences (Visa vs MC vs Amex vs Discover), including differing deadlines and code families?

### B. Evidence services
- Does every evidence object carry timestamp, cardholder-linked identifier, source, and completeness flag?
- Is clickwrap captured as a discrete acceptance event with terms version + IP + user ID, not just stored terms text?
- Are delivery/access/milestone events identity-bound and timestamped?
- Is device/IP/login data captured and retained ≥18 months for CE 3.0/FPT eligibility?
- Are refund/cancellation records pulled from the processor, not merchant-asserted?

### C. Defense packet / exhibit building
- Does the packet branch by reason code, or emit one universal layout? (Red flag: universal.)
- Are exhibits ranked by persuasiveness and given one-line captions?
- Is there logic to EXCLUDE irrelevant communication history?
- Does it produce a cover letter with identifiers + thesis + claim→exhibit bullets?
- Is there a transaction timeline generator that highlights post-purchase engagement and the dispute date?
- Does "prior successful payments" appear only when relevant (fraud/recurring continuity)?

### D. Prompt / template logic
- Are templates reason-code-specific modules over a shared skeleton?
- Does the AI-letter prompt forbid legal threats, emotion, aggression, speculation, and irrelevant history?
- Is generated language constrained to the evidence actually present (no hallucinated exhibits)?
- Is there a missing-evidence warning surfaced to the merchant before submission?

### E. PDF generation
- Legible, high-contrast, labeled exhibits, English/translated, consistent pagination?
- Are exhibit labels in the letter consistent with the PDF?
- File size and page count within processor limits (Stripe: 4.5 MB all networks, 19 pages Mastercard)?

### F. Sample defense output PDFs
- Does the sample directly answer the reason code in the first sentence?
- Could a reviewer reach a favorable decision in only a few minutes of skimming?
- Is every claim backed by a referenced exhibit?
- Does it avoid over-dumping, over-promising, and aggressive tone?
- For a fraud sample: does it use structured CE 3.0/FPT data rather than narrative?

### What would lose reviewer confidence (automatic red flags)
- One universal packet for all reason codes.
- Terms text with no proof of acceptance.
- City/ZIP-only delivery confirmation with no identity linkage.
- Full, unfiltered contact-history dumps.
- Emotional/aggressive/legalistic language.
- Claims not tied to exhibits; hallucinated evidence.
- Fighting clearly valid chargebacks (non-delivery, billing after cancellation).

---

## Caveats

- **Not every chargeback is winnable.** True fraud and merchant-fault disputes (non-delivery, billing after cancellation, refund owed) should be accepted. Fighting unwinnable cases wastes resources and can prejudice issuers.
- **Winning does not erase the dispute.** Chargeback fees and the dispute's effect on the VAMP/dispute ratio generally persist even on a win.
- **Issuer outcomes are inconsistent.** Two identical cases can be decided differently depending on the reviewing issuer.
- **Primary vs secondary sourcing.** Reason-code mechanics here are anchored to Visa, Mastercard, Amex, and Stripe primary documents. Some details — Mastercard First-Party Trust's granular data elements and the "first-time-customer / no prior history" claim, and Discover's exact response windows — rely partly on reputable secondary sources and conflict slightly across sources; reconfirm against the current Mastercard Chargeback Guide and Discover Dispute rules before launch.
- **Reviewer time is an estimate.** The "few minutes per case" premise is an industry practitioner estimate, not a network-published figure; the design implication (front-load and keep it skimmable) holds regardless.
- **Scope boundaries.** ScaleSafe should remain an evidence-and-response tool, not a law firm, collections company, or merchant of record.

### Key sources
- Visa, *Dispute Management Guidelines for Visa Merchants* (June 2024) — usa.visa.com
- Visa, *Compelling Evidence 3.0 Merchant Readiness* and *Client FAQs* — usa.visa.com
- Visa, *Updated Policy for Subscription Merchants Offering Free Trials* — usa.visa.com
- Visa Acquirer Monitoring Program (VAMP) Fact Sheet 2025 — corporate.visa.com
- Mastercard, *Chargeback Guide* (Merchant Edition, 13 May 2025) — mastercard.us
- Mastercard, First-Party Trust program (b2b blog + June 2025 Newsroom press releases) — mastercard.com
- American Express, *US Disputes Reference Guide* — americanexpress.com
- Stripe disputes documentation: reason codes/defense requirements, categories, best practices, visual evidence — docs.stripe.com
- Chargeback Gurus, Chargebacks911, Chargeflow, Kount, Sift (reason-code detail and deadlines); Ironclad, TermsFeed (clickwrap enforceability)