# ScaleSafe — Stripe Defense Layer
## Complete Build Specification: What, Why & How

---

## Overview

ScaleSafe's Stripe integration is not a payment processing play. It is a defense, stability, and evidence layer that sits on top of whatever Stripe account the merchant already has. The merchant keeps Stripe. ScaleSafe makes Stripe survivable for high-ticket service providers.

Stripe's native tools are built for e-commerce and SaaS — physical goods, subscriptions, digital downloads. They are not built for coaches, consultants, mastermind operators, or high-ticket service providers. The evidence model doesn't account for contracts, session logs, delivery proof, or offer terms. ScaleSafe fills that gap using Stripe's own API surface.

**The dual-processor model:** Merchants can run Stripe and WholePay's NMI side by side in GHL. ScaleSafe manages defense on both rails. Over time, as merchants see the economics of interchange-plus vs Stripe's flat rate, WholePay becomes the natural upgrade path. ScaleSafe is the bridge.

---

## Module 1 — Evidence Vault (Pre-Transaction)

### What
A structured evidence collection layer that captures proof of delivery, offer terms, client consent, and service documentation at the moment of sale — before any dispute ever occurs.

### Why
Stripe's dispute evidence API accepts a rich set of fields. But Stripe only auto-populates technical data: IP address, card fingerprint, device info. For high-ticket service providers, the winning evidence is human: signed agreements, coaching session logs, communication trails, offer terms accepted, client results documentation. Stripe never collects this. ScaleSafe does.

When a dispute fires, the merchant who pre-built their evidence vault wins. The merchant who scrambles to remember what they sold three months ago loses.

### How

**Stripe API endpoints used:**
- `POST /v1/payment_intents` — create or attach metadata at charge time
- `POST /v1/files` — upload documents (contracts, agreements, screenshots) with `purpose: dispute_evidence`
- `POST /v1/customers` — create/attach customer record with full contact data
- `GET /v1/payment_intents/{id}` — retrieve payment record for evidence assembly

**Data ScaleSafe captures at checkout and stores against each transaction:**

```
Transaction Record (stored in ScaleSafe, mapped to Stripe PaymentIntent ID):
  - scalesafe_offer_id
  - stripe_payment_intent_id
  - stripe_charge_id
  - customer_name
  - customer_email
  - customer_ip
  - offer_title
  - offer_description (full text of what was sold)
  - offer_terms_accepted (boolean + timestamp)
  - terms_document_url (hosted PDF of offer terms)
  - contract_signed (boolean + timestamp + DocuSign/PandaDoc ref)
  - contract_file_id (Stripe File object ID after upload)
  - service_start_date
  - session_log_urls[] (array of delivery proof links)
  - communication_trail_url
  - refund_policy_text
  - ce30_eligible (boolean — Visa CE 3.0 eligibility flag)
```

**Stripe metadata written to PaymentIntent at charge time:**
```json
{
  "metadata": {
    "scalesafe_offer_id": "offer_abc123",
    "offer_title": "12-Week Business Coaching Program",
    "terms_accepted": "true",
    "terms_accepted_at": "2025-10-01T14:32:00Z",
    "contract_signed": "true",
    "service_delivery_model": "live_sessions",
    "ce30_eligible": "true"
  }
}
```

**Why metadata matters:** Stripe's Radar for Fraud Teams reads metadata and uses it in risk scoring and Radar rules. Writing ScaleSafe identifiers into metadata also makes every transaction queryable via `GET /v1/payment_intents?query=metadata['scalesafe_offer_id']:'offer_abc123'`.

**File uploads for evidence:**
```
POST /v1/files
  purpose: dispute_evidence
  file: [PDF of signed contract / offer terms / session log]

Returns: { id: "file_abc123", url: "...", purpose: "dispute_evidence" }
```

Store the returned `file_id` against the transaction in ScaleSafe's database. These IDs are referenced directly when submitting dispute evidence.

---

## Module 2 — Dispute Detection & Triage

### What
Real-time dispute detection via Stripe webhooks, automatic triage scoring, and intelligent routing — fight vs accept decision support for every dispute.

### Why
As of June 2025, Stripe charges a $15 dispute fee plus a new $15 dispute counter fee when a merchant challenges a dispute. If you lose, you pay both. If Smart Disputes wins for you, Stripe takes 30% of recovered funds. The math changes depending on: dispute amount, strength of evidence, reason code, and likelihood of winning. ScaleSafe should compute this automatically so merchants stop making emotional decisions about which disputes to fight.

### How

**Stripe Webhook events to register:**

| Event | Trigger | ScaleSafe Action |
|---|---|---|
| `charge.dispute.created` | Dispute filed | Immediately alert merchant, pull transaction record, compute triage score |
| `charge.dispute.updated` | Evidence submitted or updated | Log update, check deadline |
| `charge.dispute.closed` | Won, lost, or expired | Record outcome, update merchant dispute rate dashboard |
| `charge.dispute.funds_withdrawn` | Funds debited | Log financial impact |
| `charge.dispute.funds_reinstated` | Funds returned after win | Log recovery |
| `radar.early_fraud_warning.created` | EFW fired before formal dispute | Proactive alert — refund window still open |

**Triage scoring model (computed on `charge.dispute.created`):**

```
Dispute Score (0–100, higher = stronger case to fight):

+ 30 pts  — Contract/offer terms file uploaded in ScaleSafe vault
+ 20 pts  — Customer communication trail documented
+ 20 pts  — Session/delivery log on file
+ 15 pts  — CE 3.0 eligibility flag = true
+ 10 pts  — Customer email confirmed at checkout
+ 5 pts   — Billing address matches card

- 20 pts  — Dispute reason = "not as described" or "product not received"
            (these are NOT covered by Stripe's Chargeback Protection)
- 15 pts  — No prior transaction history with this customer on Stripe
- 10 pts  — Dispute filed within 7 days of purchase
- 10 pts  — Amount > $3,000 (issuer banks favor cardholders on large amounts)

Score >= 60: Recommend FIGHT — ScaleSafe auto-assembles evidence packet
Score 30–59: Recommend REVIEW — present to merchant with evidence gap list
Score < 30: Recommend ACCEPT — calculate if fighting is worth the counter fee
```

**Deadline tracking:**

Pull `evidence_details.due_by` from the Dispute object on creation. ScaleSafe stores this and fires:
- T-7 days: email alert to merchant
- T-3 days: in-app alert + evidence completeness check
- T-1 day: final alert, auto-submit if evidence is complete and merchant has pre-authorized auto-submission

---

## Module 3 — Automated Evidence Assembly & Submission

### What
Automatic construction of a complete, reason-code-appropriate evidence packet and programmatic submission to Stripe before the deadline.

### Why
Stripe's Smart Disputes auto-submits evidence but only for cases its AI deems winnable, gives merchants zero control over what's submitted, and takes 30% of recovered funds. ScaleSafe builds a richer packet using evidence Stripe doesn't have access to — contracts, session logs, offer terms — and submits it through Stripe's own Dispute API. Merchant keeps 100% of recovered funds.

### How

**Dispute evidence API endpoint:**
```
POST /v1/disputes/{dispute_id}
  evidence[customer_name]: "Jane Smith"
  evidence[customer_email_address]: "jane@example.com"
  evidence[customer_purchase_ip]: "98.123.45.67"
  evidence[billing_address]: "123 Main St, Nashville TN 37201"
  evidence[product_description]: "12-Week Business Coaching Program — live weekly sessions, private community access, workbooks. Service commenced October 1, 2025."
  evidence[service_date]: "2025-10-01"
  evidence[customer_communication]: file_abc123
  evidence[refund_policy]: "All sales final per signed agreement dated 2025-10-01."
  evidence[cancellation_policy]: "No cancellations after program commencement per contract section 4."
  evidence[uncategorized_file]: file_def456 (signed contract)
  evidence[uncategorized_text]: "Client signed agreement on 2025-10-01 acknowledging terms, non-refund policy, and service delivery model. Three sessions completed prior to dispute. Session logs attached."
  submit: true (or false to stage first)
```

**Staging vs immediate submission:**

Set `submit: false` to stage evidence and review in Stripe Dashboard before sending. ScaleSafe uses staged submission by default for first-time merchants, auto-submit for merchants who have pre-authorized it.

**Reason-code evidence mapping (high-ticket specific):**

| Reason Code | Primary Evidence | Secondary Evidence |
|---|---|---|
| `fraudulent` (10.4) | Customer purchase IP + device data + prior transaction history | CE 3.0 eligibility — prior non-disputed transactions with same cardholder |
| `product_not_received` | Session attendance logs, delivery confirmation emails, access timestamps | Communication trail showing client engagement post-purchase |
| `not_as_described` | Full offer description at time of sale, signed agreement, results documentation | Customer communications prior to dispute showing no complaint raised |
| `credit_not_processed` | Signed no-refund policy, refund policy shown at checkout | Contract clause reference |
| `unrecognized` | Statement descriptor explanation, purchase receipt, customer IP match | Prior purchases from same customer |

**Visa CE 3.0 integration:**

For `fraudulent` reason code on Visa cards, Stripe automatically checks CE 3.0 eligibility and notifies the merchant via webhook and dashboard. ScaleSafe monitors the `charge.dispute.created` event and checks:

```
dispute.payment_method_details.card.network == "visa"
AND
dispute.reason == "fraudulent"
```

If both are true, ScaleSafe pulls the merchant's prior transaction history from Stripe to identify prior non-disputed transactions with the same cardholder — this is the CE 3.0 prior undisputed transaction requirement. ScaleSafe surfaces this data in the evidence packet automatically.

---

## Module 4 — Radar Optimization

### What
Configuring Stripe's Radar fraud engine with custom rules written against ScaleSafe metadata — effectively making Radar smarter for high-ticket service provider transactions.

### Why
Out of the box, Radar is tuned for e-commerce. A $5,000 coaching program triggers its high-amount rules. A repeat client buying a second program gets flagged as suspicious velocity. Radar doesn't know these are legitimate high-ticket recurring relationships unless you tell it. ScaleSafe tells it — via metadata and custom rules.

### How

**Metadata-driven Radar rules (written in Stripe Dashboard > Radar > Rules):**

```
# Allow known verified clients
Allow if ::scalesafe_verified:: = 'true'

# Review new clients on large tickets (don't block — review)
Review if ::scalesafe_verified:: != 'true' and :amount_in_usd: > 2000

# Request 3DS on unverified high-ticket transactions
Request 3DS if ::scalesafe_verified:: != 'true' and :amount_in_usd: > 1000

# Block known dispute-abuse cardholders (populated by ScaleSafe)
Block if :card_fingerprint: in @scalesafe_blocked_cards
```

**ScaleSafe manages these lists via Stripe's Value Lists API:**

```
POST /v1/radar/value_lists
  alias: scalesafe_blocked_cards
  item_type: card_fingerprint

POST /v1/radar/value_list_items
  value_list: rsl_abc123
  value: [card_fingerprint]
```

When a merchant wins a dispute that was clearly friendly fraud, ScaleSafe adds the card fingerprint to the blocked list automatically — preventing the same cardholder from disputing a future charge.

**3DS (3D Secure) enrollment:**

Stripe supports requesting 3DS via the PaymentIntent API. 3DS shifts liability from merchant to issuer on fraudulent disputes — meaning even if the cardholder disputes, the merchant wins automatically because the issuer approved the authentication.

```
POST /v1/payment_intents
  payment_method_options[card][request_three_d_secure]: 'automatic'
```

ScaleSafe recommends enabling 3DS for all new clients on first purchase. For returning verified clients, 3DS is skipped to reduce friction. ScaleSafe manages this logic via the `scalesafe_verified` metadata flag.

---

## Module 5 — Early Fraud Warning (EFW) Management

### What
Detection and response to Stripe's Early Fraud Warnings — the pre-dispute notification window where merchants can still refund and avoid a formal dispute entirely.

### Why
An EFW is Stripe telling the merchant: a cardholder has flagged this transaction as suspicious, and a formal dispute is likely coming. The merchant still has time to refund and avoid the dispute fee, the counter fee, the impact on their dispute rate, and the risk of losing the chargeback. For many high-ticket merchants, taking the EFW refund is the right call. For others, it's worth fighting. ScaleSafe helps the merchant decide.

### How

**Webhook event:** `radar.early_fraud_warning.created`

**EFW response decision tree:**

```
On EFW received:
  1. Pull transaction record from ScaleSafe vault
  2. Check: is evidence strong? (Score >= 60)
     YES → Alert merchant: "EFW received. Evidence is strong. Hold and prepare to fight."
     NO  → Alert merchant: "EFW received. Consider refunding to avoid dispute.
            Refund window closes in ~72 hours."
  3. Check: is dispute rate approaching 0.65%?
     YES → Recommend refund regardless of evidence strength
           (protecting VAMP/monitoring program status is worth more than
            one recovery)
  4. Log EFW outcome for account health dashboard
```

**EFW to dispute rate calculation:**

ScaleSafe maintains a rolling dispute rate calculation using:
```
GET /v1/disputes?created[gte]={30_days_ago}&limit=100
GET /v1/charges?created[gte]={30_days_ago}&limit=100

dispute_rate = count(disputes) / count(charges)
```

This rate is displayed in the merchant's ScaleSafe dashboard and compared against VAMP thresholds (Visa: 0.65% early warning, 0.90% standard program) and Mastercard thresholds.

---

## Module 6 — Account Health Monitor

### What
A real-time dashboard showing each merchant's Stripe account health — dispute rate, chargeback velocity, EFW count, and risk of entering card network monitoring programs.

### Why
High-ticket merchants lose Stripe accounts before they know they're at risk. There's no built-in warning system. Stripe sends a notification when it's already too late. ScaleSafe gives merchants visibility before they cross the threshold — and gives WholePay the intelligence to have the right conversation at the right time.

### How

**Data pulled from Stripe API on a scheduled basis (daily):**

```
GET /v1/disputes
  created[gte]: 30_days_ago
  → dispute count, reason code breakdown, outcome rates

GET /v1/charges
  created[gte]: 30_days_ago
  → total transaction count for rate calculation

GET /v1/radar/early_fraud_warnings
  created[gte]: 30_days_ago
  → EFW count and fraud type breakdown

GET /v1/balance_transactions
  type: adjustment (dispute-related balance movements)
  → financial impact of disputes
```

**Dashboard metrics computed by ScaleSafe:**

| Metric | Calculation | Threshold Flags |
|---|---|---|
| Dispute rate (Visa) | disputes / charges (rolling 30 days) | 🟡 0.50% Warning / 🔴 0.65% Early Warning / 🚨 0.90% Program |
| Dispute rate (Mastercard) | disputes / charges (rolling 30 days) | 🟡 0.75% Warning / 🔴 1.50% Program |
| EFW rate | EFWs / charges | 🟡 > 0.50% investigate |
| Recovery rate | disputes won / disputes fought | Benchmark vs industry |
| Evidence completeness | % of transactions with full ScaleSafe vault entry | Internal KPI |
| Financial exposure | sum of open dispute amounts | Cash flow risk |

**WholePay trigger:** When a merchant's Stripe dispute rate exceeds 0.65% and their ScaleSafe evidence completeness is < 70%, ScaleSafe surfaces a prompt: "Your Stripe account is at risk. Merchants on WholePay's NMI maintain separate dispute rates — processing high-risk transactions through a dedicated merchant account protects your Stripe account." This is the organic, value-aligned upgrade conversation.

---

## Module 7 — Statement Descriptor Optimization

### What
Programmatic management of Stripe statement descriptors to reduce "unrecognized charge" disputes — the most preventable dispute type.

### Why
"Unrecognized charge" is the number one source of friendly fraud for high-ticket merchants. The cardholder doesn't recognize the charge on their statement, panics, and calls their bank. A clearly formatted descriptor showing the merchant's known business name eliminates most of these before they become disputes.

### How

**Stripe supports dynamic statement descriptors per transaction:**

```
POST /v1/payment_intents
  statement_descriptor_suffix: "COACHING-OCT"
  (max 22 chars total including prefix)
```

**ScaleSafe descriptor formula for high-ticket merchants:**
```
[BUSINESS_SHORT_NAME]* [OFFER_CODE]
Example: WHOLEWAY* COACH-OCT
         SMITHLAW* RETAINER
         WELLNESSCTR* SEP-PKG
```

ScaleSafe stores the merchant's preferred descriptor prefix and auto-appends an offer-specific suffix on each PaymentIntent. This gives the cardholder enough context to recognize the charge without calling their bank.

---

## Module 8 — Stripe Connect Integration Path

### What
The technical pathway for ScaleSafe to connect to a merchant's existing Stripe account via OAuth, without requiring the merchant to re-create their Stripe setup or switch processors.

### Why
The merchant keeps their Stripe account. ScaleSafe plugs in as a connected platform via OAuth. This gives ScaleSafe API access to read disputes, write evidence, configure Radar rules, and register webhooks — all on the merchant's account. Zero disruption to the merchant's existing setup.

### How

**OAuth flow:**

1. Merchant clicks "Connect Stripe" in ScaleSafe GHL app
2. ScaleSafe redirects to: `https://connect.stripe.com/oauth/authorize?response_type=code&client_id=[SCALESAFE_CLIENT_ID]&scope=read_write`
3. Merchant authorizes ScaleSafe in Stripe
4. Stripe redirects back to ScaleSafe with `?code=ac_abc123`
5. ScaleSafe exchanges code for access token:
   ```
   POST https://connect.stripe.com/oauth/token
     client_secret: [SCALESAFE_SECRET]
     code: ac_abc123
     grant_type: authorization_code
   ```
6. ScaleSafe stores `access_token` and `stripe_user_id` for that merchant
7. All subsequent API calls use merchant's `access_token` as Bearer token

**Scopes needed:**
- `read_write` — for evidence submission, file uploads, dispute updates
- Webhook registration is per-account via `POST /v1/webhook_endpoints` using the merchant's access token

**Webhook registration per merchant account:**
```
POST /v1/webhook_endpoints
  url: https://scalesafe.app/webhooks/stripe/{merchant_id}
  enabled_events:
    - charge.dispute.created
    - charge.dispute.updated
    - charge.dispute.closed
    - charge.dispute.funds_withdrawn
    - charge.dispute.funds_reinstated
    - radar.early_fraud_warning.created
    - payment_intent.payment_failed
```

---

## Module 9 — Verifi & Ethoca: Dispute Prevention Network

### What
Three distinct pre-dispute tools accessed through Stripe's native integration with Verifi (Visa) and Ethoca (Mastercard) that stop chargebacks before they are formally filed — meaning they never count against the merchant's dispute rate and never incur dispute fees.

This is the single most powerful lever for keeping high-ticket Stripe merchants out of VAMP and Mastercard monitoring programs. ScaleSafe's role is to ensure every merchant is enrolled, correctly configured, and feeding these systems the transaction data quality they need to work.

### The Three Tools — Understood Separately

These are not one product. They are three distinct mechanisms that operate at different stages of the dispute lifecycle.

---

### Tool 1 — Verifi Order Insights (OI)
**Network:** Visa only
**Stage:** Pre-dispute — before the cardholder even files

#### What it does
When a Visa cardholder sees a charge they don't recognize, they open their banking app or call their bank. Instead of immediately filing a dispute, the issuer sends a real-time lookup request to Stripe asking: "What was this charge for?" Stripe responds with rich transaction data — merchant name, offer description, purchase date, IP address, customer email. The cardholder sees a digital receipt and recognizes the charge. Dispute never filed.

Ethoca describes this as connecting the issuer, merchant, and cardholder in real time — when a customer calls their bank and the call center representative has detailed purchase information, the cardholder is far less likely to follow through on a dispute.

#### Why it matters for high-ticket merchants
Most "unrecognized charge" disputes from coaching and consulting clients aren't fraud — they're confusion. The client's spouse sees a $3,000 charge from an unfamiliar descriptor and calls their bank. Order Insights stops this cold by surfacing the full offer description to the issuer before the dispute is filed.

#### CE 3.0 pre-dispute block
If enrolled in OI, Stripe can use CE 3.0 pre-dispute to completely block the dispute from being filed. If at least two prior non-fraud transactions exist with the same cardholder with matching IP addresses and at least one matching email address or customer delivery address, the issuer is required to block the cardholder from filing the dispute at all.

This is the most powerful protection available for repeat clients — the merchant's second, third, and fourth sales to the same client become nearly undisputable.

#### What ScaleSafe must do to make OI work
To ensure Stripe can effectively block disputes on your behalf with CE 3.0, all transactions must include IP Address, Customer Email Address, Product Descriptions, and if possible, Shipping or Customer Address.

ScaleSafe's Evidence Vault (Module 1) already captures all of this. The key is that these fields must be written to the PaymentIntent at charge time — not added later.

**Required fields on every PaymentIntent for OI/CE 3.0 eligibility:**
```
POST /v1/payment_intents
  receipt_email: "client@example.com"
  description: "12-Week Business Coaching Program — Weekly live sessions, private community, workbooks"
  metadata[customer_ip]: "98.123.45.67"          ← critical for CE 3.0
  metadata[offer_description]: "[full offer text]"
  metadata[ce30_eligible]: "true"

POST /v1/customers
  email: "client@example.com"
  name: "Jane Smith"
  address[line1]: "123 Main St"
  address[city]: "Nashville"
  address[state]: "TN"
  address[postal_code]: "37201"
```

**Enrollment:** OI enrollment is handled through the Stripe Dashboard under Dispute Settings > Dispute Prevention. The onboarding flow collects business name, URL, and phone number. No coding is required. Stripe handles the Verifi-side setup. ScaleSafe guides merchants through this enrollment as part of onboarding.

**ScaleSafe onboarding checklist for OI:**
- [ ] Merchant navigates to Stripe Dashboard > Disputes > Dispute Prevention
- [ ] Completes OI enrollment form (business name, URL, phone, email)
- [ ] ScaleSafe verifies that all new PaymentIntents include required CE 3.0 fields
- [ ] ScaleSafe flags any transactions missing required fields as "CE 3.0 ineligible" in the account health dashboard

---

### Tool 2 — Verifi Rapid Dispute Resolution (RDR)
**Network:** Visa only
**Stage:** Pre-dispute — after the cardholder contacts issuer, before formal chargeback

#### What it does
RDR lets merchants construct a ruleset to resolve incoming disputes on Visa transactions for a fee per dispute. Resolved disputes don't count towards overall dispute rates and merchants don't pay a separate dispute received fee on these resolved disputes.

In practice: when a Visa cardholder initiates a dispute, Verifi intercepts it before it becomes a formal chargeback. If the transaction matches the merchant's RDR rules, Verifi automatically issues a refund to the cardholder. The dispute is resolved. It never hits the merchant's dispute rate. No dispute fee. No counter fee. No chargeback.

#### Why it matters for high-ticket merchants
RDR is the safety valve for disputes that couldn't be deflected by OI. The merchant still loses the revenue on that transaction, but they protect their dispute rate — which protects their Stripe account and keeps them out of monitoring programs. For a merchant approaching VAMP thresholds, one RDR-managed month can be the difference between keeping their account and losing it.

#### The key tradeoff
RDR auto-refunds. The merchant loses revenue on that transaction. The strategic question is: which disputes are worth fighting (via evidence submission) and which are worth auto-refunding to protect the rate? ScaleSafe's triage scoring (Module 2) feeds this decision.

**RDR rule design for high-ticket service providers:**

This is where ScaleSafe adds real expertise. Generic RDR rules auto-refund everything, which is expensive. Smart rules protect rate without unnecessary refunds.

```
Recommended RDR ruleset for high-ticket service merchants:

AUTO-REFUND (protect rate, accept loss):
  - Transaction amount < $500 AND dispute reason = fraudulent
  - Transaction > 120 days old (evidence likely weak, hard to win)
  - Customer has prior won dispute against this merchant (dispute abuse pattern)
  - Merchant dispute rate currently > 0.75% (rate protection mode)

DO NOT AUTO-REFUND (fight these):
  - Transaction amount > $500 with complete evidence vault entry
  - Client has signed contract on file
  - Service delivery documented (session logs present)
  - Transaction < 60 days old with strong CE 3.0 history
```

ScaleSafe surfaces these rules in a plain-language interface. Merchant sets thresholds. ScaleSafe translates them into the Stripe RDR ruleset format during enrollment.

**Enrollment:** Although there are no coding requirements for RDR, the onboarding process requires setting up rules to define which transactions to refund. After requesting access, Stripe will be in touch with next steps to set up the ruleset.

RDR enrollment is currently in beta via Stripe — merchants request access at `dispute-prevention-beta@stripe.com`. ScaleSafe assists with this process and the ruleset configuration.

**Important limitation:** Verifi doesn't currently support partial dispute resolution or disputes on refunded transactions. RDR only resolves disputes when the cardholder disputes the full amount of the original transaction and the transaction has not been refunded.

---

### Tool 3 — Ethoca Alerts (Consumer Clarity)
**Network:** Mastercard only
**Stage:** Pre-dispute — before formal chargeback, typically within 24 hours of alert

#### What it does
Ethoca Alerts allows merchants to construct rulesets to prevent what would be chargebacks by setting up automatic resolutions. Ethoca Alerts is available for Mastercard transactions and resolved disputes don't count towards dispute rates, helping merchants exit Mastercard's chargeback monitoring programs such as ECM, HECM and EFM.

Ethoca operates as Mastercard's equivalent to Verifi — when a Mastercard cardholder initiates a dispute, Ethoca sends an alert to the merchant (via Stripe) giving them a window to refund before the dispute becomes a formal chargeback. The merchant refunds, the dispute is resolved, it never hits the dispute rate.

#### Response window — critical
All Ethoca alerts must be responded to and refunded (when applicable) within 24 hours of alert creation. This is tight. ScaleSafe must be configured to detect Ethoca alerts via Stripe webhook and alert the merchant immediately — not daily digest, not next business day. Immediate.

Verifi alerts have a slightly longer window: all Verifi alerts must be responded to, and refunded (if resolved), within 72 hours of alert creation date and time.

#### What ScaleSafe does on Ethoca alert receipt

```
Webhook event: charge.dispute.created (Ethoca disputes appear here)

On receipt:
  1. Identify network: dispute.payment_method_details.card.network == "mastercard"
  2. Pull ScaleSafe evidence vault entry for this transaction
  3. Run triage score (Module 2)
  4. If score < 50 OR amount < $500 OR rate approaching threshold:
       → Immediate merchant alert: "ETHOCA ALERT — 24hr refund window open"
       → Display refund button in ScaleSafe dashboard
       → Auto-refund option for pre-authorized merchants
  5. If score >= 60 AND amount > $500 AND rate healthy:
       → Alert merchant: "Ethoca alert received. Evidence strong. Review before refunding."
  6. Log outcome to account health dashboard
  7. Update dispute rate calculation
```

**Enrollment:** Ethoca Alerts enrollment is managed through Stripe's Dispute Prevention settings alongside OI. No separate Ethoca contract required when using Stripe as the integration layer.

---

### Network Coverage Summary

| Tool | Network | Stage | Outcome | Counts Against Rate? |
|---|---|---|---|---|
| Order Insights (OI) | Visa | Pre-filing | Dispute deflected | No |
| CE 3.0 via OI | Visa | Pre-filing | Dispute blocked entirely | No |
| RDR | Visa | Pre-chargeback | Auto-refund issued | No |
| Ethoca Alerts | Mastercard | Pre-chargeback | Merchant-triggered refund | No |
| Evidence Submission (Module 3) | All | Post-chargeback | Won or lost | Win = reversed |

Combined, OI + RDR covers Visa end to end. Ethoca covers Mastercard. This is full pre-dispute coverage across the two dominant card networks. Disputes that get through this layer go to Module 3 evidence submission.

---

### Transaction Data Quality — The Foundation of All Three Tools

All three tools depend entirely on the quality of data written to Stripe at charge time. This is why Module 1 (Evidence Vault) is built first. Without quality transaction data, OI can't deflect, CE 3.0 can't block, and Ethoca alerts have less context.

**ScaleSafe data quality checklist (verified on every transaction):**

| Field | Required For | ScaleSafe Source |
|---|---|---|
| Customer email | OI, CE 3.0, Ethoca | Checkout capture |
| Customer IP address | CE 3.0 | Checkout capture |
| Product/offer description | OI, CE 3.0 | Offer builder |
| Customer billing address | CE 3.0 (optional but strengthens) | GHL contact record |
| Statement descriptor | OI deflection | Module 7 |
| Prior transaction history | CE 3.0 block eligibility | Stripe native (auto) |

**CE 3.0 block requirement (the highest standard):**
To completely block a Visa dispute from being filed, Stripe needs at minimum:
- 2+ prior non-disputed transactions with the same cardholder
- Matching IP address across those transactions
- Matching email address OR customer address

ScaleSafe flags merchants who have repeat clients and ensures these fields are consistently captured — building CE 3.0 eligibility with every transaction.

---

### Build Priority for Module 9

| Step | Action | Complexity |
|---|---|---|
| 1 | Guide merchant through OI enrollment in Stripe Dashboard | Low — UI walkthrough |
| 2 | Verify PaymentIntent fields include all CE 3.0 required data | Low — field validation |
| 3 | Configure Ethoca alert detection via existing dispute webhook | Low — extend Module 2 |
| 4 | Build 24hr Ethoca alert notification system | Medium |
| 5 | Build RDR ruleset configuration interface in ScaleSafe | Medium |
| 6 | Assist merchant with RDR beta enrollment via Stripe | Low — guided process |
| 7 | Add OI/RDR/Ethoca outcomes to account health dashboard | Medium |

---

## Integration with GHL

Stripe users who install ScaleSafe from the GHL Marketplace:

1. Complete OAuth connection to their Stripe account
2. ScaleSafe registers webhooks automatically
3. ScaleSafe begins populating the evidence vault on all new transactions
4. Dispute alerts fire inside GHL via ScaleSafe's custom page (iFrame)
5. Account health dashboard displays in GHL sidebar
6. WholePay upgrade prompt surfaces contextually when thresholds are approached

**Processing side by side:** The merchant's Stripe account handles their existing products and funnels. WholePay's NMI handles offers routed through ScaleSafe's offer builder. ScaleSafe manages defense on both rails. The merchant sees one unified dispute dashboard regardless of processor.

---

## Build Priority Order

| Phase | Module | Complexity | Value |
|---|---|---|---|
| 1 | Stripe OAuth Connect | Medium | Unlocks everything |
| 1 | Webhook registration + dispute detection | Low | Core foundation |
| 1 | Evidence vault schema + transaction record | Medium | Pre-populates automatically |
| 2 | Dispute triage scoring | Medium | Immediate merchant value |
| 2 | Evidence assembly + submission | High | Core defense feature |
| 2 | Account health dashboard | Medium | Retention + upsell trigger |
| 3 | EFW detection + response | Low | High value, low complexity |
| 3 | Radar rule configuration | High | Advanced protection |
| 3 | Statement descriptor management | Low | Quick win |
| 3 | CE 3.0 eligibility tracking | Medium | Win rate improvement |

---

## Key Stripe API Reference Summary

| Endpoint | Method | ScaleSafe Use |
|---|---|---|
| `/v1/payment_intents` | POST/GET | Write metadata at charge time, retrieve for evidence |
| `/v1/files` | POST | Upload contracts, session logs, agreements |
| `/v1/disputes/{id}` | GET/POST | Retrieve dispute details, submit evidence |
| `/v1/disputes` | GET | List disputes for rate calculation |
| `/v1/radar/value_lists` | POST | Create blocked card lists |
| `/v1/radar/value_list_items` | POST | Add card fingerprints to block list |
| `/v1/radar/early_fraud_warnings` | GET | Pull EFW history |
| `/v1/webhook_endpoints` | POST | Register dispute webhooks per merchant |
| `/v1/customers` | POST/GET | Create customer records, attach billing address |
| `/v1/charges` | GET | Pull charge count for dispute rate calculation |
| `/v1/balance_transactions` | GET | Track dispute financial impact |
| `connect.stripe.com/oauth/token` | POST | Exchange OAuth code for merchant access token |

---

*ScaleSafe Stripe Defense Layer Specification v1.0*
*Built for non-technical review and agent-ready implementation*
