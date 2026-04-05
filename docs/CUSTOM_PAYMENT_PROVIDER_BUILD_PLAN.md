# Custom Payment Provider Build Plan v2.0

**Feature:** ScaleSafe Dual-Rail Payment Infrastructure (NMI Processing + Stripe Defense Layer)
**Date:** 2026-04-03 (updated from v1.0)
**Status:** APPROVED FOR BUILDING
**Spec inputs:** Custom Payment Provider research + Stripe Defense Layer Specification v1.0

---

## 1. Current State

**What exists today:**
- ScaleSafe marketplace app created in GHL with all 11 payment scopes enabled (including `payments/custom-provider.write` and `payments/custom-provider.readonly`)
- OAuth install + token refresh: working
- Offer CRUD: working (creates GHL Products/Prices + Supabase + Custom Object)
- `merchants` table in Supabase with location_id, tokens, settings
- `offers_mirror` table with `ghl_product_id`, `ghl_price_id`, payment_type, price fields
- `enrollment_packets` table designed (consent forensics)
- `evidence` tables designed (21 evidence types)
- `payment_events` table designed but NOT built
- No payment processing code exists
- No processor configuration storage
- No checkout page
- No queryUrl backend
- Legacy accept.blue integration via Make.com (being sunset)

**What this build creates:**
- **NMI rail:** Full payment processing through GHL Custom Payment Provider — ScaleSafe owns the checkout, processes transactions via merchant's NMI account
- **Stripe rail:** Defense + intelligence layer that sits on top of merchant's existing Stripe account — evidence vault, dispute management, Radar optimization, account health monitoring, pre-dispute prevention (Verifi/Ethoca), PLUS Stripe can also serve as a payment processor through the same Custom Payment Provider
- **Architecture rule change:** "ScaleSafe observes, never processes" → "ScaleSafe processes payments through NMI and layers defense on top of Stripe. ScaleSafe never holds funds."

---

## 2. Target State

### The Dual-Rail Model

**NMI rail (processing-first):**
1. Merchant connects NMI account (security key + tokenization key)
2. ScaleSafe registers as Custom Payment Provider on their GHL location
3. All GHL payment surfaces (order forms, invoices, payment links) load ScaleSafe's checkout page
4. Checkout uses NMI Collect.js for card tokenization → transact.php for processing
5. Evidence captured at payment moment (IP, device, consent link)
6. Multi-MID routing via processor_id for merchants with multiple merchant accounts
7. Customer Vault for saved cards and recurring billing

**Stripe rail (defense-first):**
1. Merchant clicks "Connect Stripe" → OAuth via Stripe Connect
2. ScaleSafe registers webhooks on merchant's Stripe account
3. Evidence vault begins populating on ALL transactions (including ones not processed through ScaleSafe)
4. Dispute detection, triage scoring, and automated evidence submission activate immediately
5. Account health dashboard shows dispute rate, EFW count, VAMP/monitoring risk
6. Radar rules configured for high-ticket transaction patterns
7. Verifi (OI + RDR) and Ethoca alert management for pre-dispute prevention
8. Statement descriptor optimization to reduce "unrecognized charge" disputes
9. Stripe CAN also be used as checkout processor (Payment Intents via Stripe Elements)

**The value asymmetry (this is strategic):**
- NMI merchants get value when they PROCESS through ScaleSafe
- Stripe merchants get value THE MOMENT THEY CONNECT — even before processing a single transaction
- This makes Stripe the low-barrier entry point. Merchants see immediate value (dispute monitoring, evidence building)
- As dispute rate climbs, ScaleSafe surfaces the WholePay/NMI upgrade path organically

### From the merchant's perspective:
1. Install ScaleSafe from GHL Marketplace
2. Connect Stripe via OAuth (immediate defense value) AND/OR connect NMI (processing value)
3. Set a default processor if both are connected
4. Create offers — optionally override processor per offer
5. For NMI merchants with multiple MIDs: select which MID per offer
6. Stripe defense layer runs automatically in the background on all Stripe transactions
7. Account health dashboard shows unified view across both processors

### From the client's perspective:
1. Goes through enrollment Pages 1-3 (info, offer review, consent)
2. Page 4: GHL loads ScaleSafe's checkout page in an iframe
3. Checkout shows offer name, price, PIF vs Installments toggle
4. Client enters card info (Collect.js for NMI, Stripe Elements for Stripe)
5. Payment processes → success → enrollment complete

### From ScaleSafe's perspective:
1. Consent token from Page 3 verified at payment time (same session proof)
2. Device fingerprint + IP captured at payment moment (matches consent record)
3. Transaction processed through merchant's processor (NMI or Stripe)
4. For Stripe: metadata written to PaymentIntent (scalesafe_offer_id, terms_accepted, CE 3.0 fields)
5. Evidence logged with unbroken chain: consent → payment → confirmation
6. GHL receives success via postMessage → creates Order + Transaction
7. GHL fires webhook → ScaleSafe logs payment evidence + completes enrollment
8. queryUrl handles all backend operations (verify, refund, subscriptions, saved cards)
9. Stripe webhooks monitored continuously for disputes, EFWs, rate changes

---

## 3. Build Inventory

### A. Database Layer (Supabase)

| Component | Platform | Dependencies | Description |
|-----------|----------|--------------|-------------|
| `processor_configs` table | Supabase | merchants table | Stores NMI credentials (encrypted) + Stripe Connect tokens per merchant. Supports multiple NMI configs for multi-MID. |
| `merchants` table updates | Supabase | existing table | Add `default_processor` (enum: 'nmi', 'stripe'), `stripe_connected` (boolean), `stripe_user_id` (text) |
| `offers_mirror` table updates | Supabase | existing table | Add `processor_override` (nullable enum), `nmi_processor_id` (nullable text) |
| `payment_events` table | Supabase | enrollments table | Transaction log — already designed, needs migration. Extended with Stripe PaymentIntent ID mapping. |
| `payment_methods` table | Supabase | processor_configs | Stored card references: GHL contact → NMI vault ID or Stripe payment method ID |
| `dispute_events` table | Supabase | merchants, payment_events | Dispute lifecycle: created, updated, closed, funds_withdrawn, funds_reinstated. Reason code, triage score, evidence status, deadline. |
| `dispute_evidence_files` table | Supabase | dispute_events | Stripe File object IDs linked to dispute records — contracts, session logs, agreements uploaded via Stripe Files API |
| `account_health_snapshots` table | Supabase | merchants | Daily snapshots: dispute rate (Visa/MC), EFW count, recovery rate, evidence completeness, financial exposure |
| `efw_events` table | Supabase | merchants, payment_events | Early Fraud Warning records: charge ID, fraud type, response action, outcome |
| `stripe_radar_lists` table | Supabase | merchants | Tracks Stripe Value List IDs (blocked cards, verified customers) per merchant |

### B. Backend Services — Shared Infrastructure (Node.js/TypeScript)

| Component | Platform | Dependencies | Description |
|-----------|----------|--------------|-------------|
| `processor.interface.ts` | App | — | Shared interface: `charge()`, `refund()`, `saveCard()`, `listCards()`, `createSubscription()`, `cancelSubscription()`, `verifyTransaction()` |
| `processor.factory.ts` | App | both clients | Factory that returns the right client based on merchant's processor config for a given offer |
| `payment-provider.service.ts` | App | processor factory, GHL API | Registers ScaleSafe as custom payment provider on merchant's location during install |
| `query-url.controller.ts` | App | processor factory | Handles all queryUrl operations from GHL: verify, refund, list_payment_methods, charge_payment, create_subscription, cancel_subscription |
| `processor-config.service.ts` | App | Supabase | CRUD for processor credentials. NMI: encryption/decryption. Stripe: OAuth token management. Validation. |
| `payment.service.ts` | App | processor factory, evidence service | Payment event handling, evidence logging, enrollment completion |

### C. Backend Services — NMI Client

| Component | Platform | Dependencies | Description |
|-----------|----------|--------------|-------------|
| `nmi.client.ts` | App | processor interface | NMI API client: Collect.js token → transact.php sale/auth/capture/void/refund. Customer Vault. Recurring billing. Multi-MID via processor_id. |

### D. Backend Services — Stripe Client + Defense Layer (9 Modules)

| Component | Platform | Dependencies | Description |
|-----------|----------|--------------|-------------|
| `stripe.client.ts` | App | processor interface | Stripe Payment Intents, Customers, Payment Methods, Subscriptions — implements ProcessorInterface for checkout processing |
| `stripe-connect.service.ts` | App | processor-config.service | OAuth flow: authorize → token exchange → store access_token + stripe_user_id. Webhook registration per merchant account. |
| `stripe-evidence-vault.service.ts` | App | payment_events, Stripe Files API | **Module 1:** Captures evidence at charge time. Writes metadata to PaymentIntents. Uploads contracts/logs to Stripe Files API (purpose: dispute_evidence). |
| `stripe-dispute.service.ts` | App | dispute_events, evidence vault | **Modules 2+3:** Dispute detection via webhooks. Triage scoring (0-100). Deadline tracking (T-7, T-3, T-1). Automated evidence assembly + submission via `POST /v1/disputes/{id}`. Reason-code mapping. Staged vs auto-submit. |
| `stripe-radar.service.ts` | App | stripe_radar_lists | **Module 4:** Manages Radar Value Lists (blocked cards, verified customers). Configures metadata-driven rules. 3DS logic for new vs returning clients. |
| `stripe-efw.service.ts` | App | efw_events, dispute rate | **Module 5:** EFW detection via `radar.early_fraud_warning.created` webhook. Decision tree: evidence strength vs dispute rate threshold → hold or refund recommendation. |
| `stripe-health.service.ts` | App | account_health_snapshots | **Module 6:** Daily account health computation. Dispute rate (Visa: 0.65%/0.90% thresholds, MC: 0.75%/1.50%). EFW rate. Recovery rate. Evidence completeness. Financial exposure. WholePay upgrade trigger when Stripe rate > 0.65% AND evidence completeness < 70%. |
| `stripe-descriptor.service.ts` | App | merchants, offers_mirror | **Module 7:** Statement descriptor management. Merchant prefix + offer-specific suffix. Auto-applies on every PaymentIntent. |
| `stripe-webhook.controller.ts` | App | all Stripe services | Unified webhook receiver for: charge.dispute.created/updated/closed/funds_withdrawn/funds_reinstated, radar.early_fraud_warning.created, payment_intent.payment_failed |
| `stripe-prevention.service.ts` | App | stripe-health, stripe-dispute | **Module 9:** Verifi OI/RDR + Ethoca enrollment guidance. CE 3.0 eligibility tracking. RDR ruleset configuration interface. Ethoca 24hr alert response automation. |

### E. Frontend — Checkout Page (paymentsUrl)

| Component | Platform | Dependencies | Description |
|-----------|----------|--------------|-------------|
| Checkout page (`/checkout`) | App (public route) | NMI Collect.js, Stripe.js | Public HTML page loaded in GHL iframe. postMessage protocol. Renders NMI or Stripe card form based on merchant config. PIF/installment toggle. Consent verification. Device/IP capture. |
| postMessage handler | Checkout page | — | Listens for `payment_initiate_props` and `setup_initiate_props`. Sends `custom_provider_ready`, `custom_element_success_response`, `custom_element_error_response`. |
| Stripe metadata injection | Checkout page | stripe-evidence-vault | When processor is Stripe: writes CE 3.0 required fields, offer metadata, and ScaleSafe identifiers to PaymentIntent at charge time |

### F. Frontend — Merchant Settings (Vue SPA)

| Component | Platform | Dependencies | Description |
|-----------|----------|--------------|-------------|
| Processor Settings tab | App (Vue) | processor-config.service | NMI connection form (security key, tokenization key, processor IDs). Stripe Connect button (OAuth flow). Default processor toggle. Test connection. |
| Stripe Defense Dashboard | App (Vue) | stripe-health.service | Account health metrics. Dispute rate gauges. EFW alerts. Evidence completeness. WholePay upgrade prompt. |
| Dispute Management view | App (Vue) | stripe-dispute.service | Active disputes list. Triage scores. Evidence status. Fight/accept/refund actions. Deadline countdowns. |
| Offer form processor field | App (Vue) | offers_mirror updates | Processor override dropdown + NMI MID selector |
| Stripe onboarding checklist | App (Vue) | stripe-connect, stripe-prevention | Guided setup: Connect OAuth → enable OI → configure RDR rules → verify CE 3.0 field capture |

### G. GHL Integration

| Component | Platform | Dependencies | Description |
|-----------|----------|--------------|-------------|
| Provider registration on install | App → GHL API | payment-provider.service | On merchant install, register ScaleSafe as custom payment provider |
| Provider config (test/live) | App → GHL API | processor-config.service | After processor connected, register test/live credentials with GHL |

---

## 4. Architecture Decisions

### Decision 1: Custom Payment Provider, NOT White-Label
- **Choice:** Build a Custom Payment Provider
- **Why:** We control the checkout UI — PIF/installment toggle, consent verification, evidence capture at payment moment, Stripe metadata injection. White-Label uses GHL's native checkout where we have zero control.

### Decision 2: Stripe Connect OAuth, NOT Direct API Keys *(UPDATED from v1.0)*
- **Choice:** Stripe Connect OAuth flow. Merchant clicks "Connect Stripe" → authorizes ScaleSafe → we get read_write access to their account.
- **Previous decision (v1.0):** Direct API keys. Overridden by Stripe Defense Layer spec.
- **Stripe Connect configuration (set 2026-04-03):**
  - **Charge type: Direct** — charges created directly on merchant's Stripe account
  - **Loss liability: Stripe** — Stripe absorbs negative balances, not ScaleSafe
  - **Dashboard: Full** — merchants keep their own full Stripe dashboard
  - **Docs:** https://docs.stripe.com/connect/interactive-platform-guide?connect-charge-type=direct&connect-loss-liability-owner=stripe&connect-dashboard-type=full
- **Why Connect wins:**
  - No secret keys to store and manage
  - Merchant authorizes once, ScaleSafe gets full API access (disputes, charges, Radar, webhooks, files)
  - Professional onboarding experience (Stripe's OAuth consent screen)
  - ScaleSafe can register webhooks directly on merchant's account
  - Direct charges mean money never flows through ScaleSafe — clean liability model
  - Scales properly — Stripe Connect is designed for platforms managing multiple merchants
  - Required for the defense layer modules (need persistent API access to disputes, Radar, etc.)
- **Trade-off:** Requires Stripe partner application (IN PROGRESS). Token refresh handling.

### Decision 3: NMI Customer Vault for Saved Cards
- **Choice:** Store card tokens in NMI's Customer Vault. Store only the Vault ID locally.
- **Why:** PCI compliance. No raw card data in Supabase.
- **Stripe equivalent:** Stripe Customer + Payment Methods API (same concept).

### Decision 4: Processor Abstraction Layer (Asymmetric)
- **Choice:** Both NMI and Stripe implement `ProcessorInterface` for checkout operations. Stripe has ADDITIONAL services (defense layer) that NMI does not.
- **Why:** Checkout processing is symmetric (both can charge, refund, save cards). Defense is Stripe-only. The abstraction layer handles the symmetric part. Stripe defense services are standalone.

### Decision 5: Offer-Level Processor Override with Merchant-Level Default
- Same as v1.0. Merchants set a default, can override per offer, NMI supports per-offer MID routing.

### Decision 6: Architecture Rule Update
- **Old rule:** "ScaleSafe OBSERVES payments, it NEVER processes them."
- **New rule:** "ScaleSafe processes payments through NMI via Custom Payment Provider, and layers defense intelligence on Stripe accounts via Connect. ScaleSafe never holds funds."

### Decision 7: Stripe Defense Value as Acquisition Strategy *(NEW)*
- **Choice:** Stripe merchants get immediate value from the defense layer without processing through ScaleSafe. Defense modules activate on Stripe Connect, monitoring ALL transactions on their Stripe account.
- **Why:** Lower barrier to entry. Merchants see value in week 1 (dispute monitoring, evidence building) without changing their payment flow. When their Stripe account is at risk, the WholePay/NMI upgrade path is already built into the product.

---

## 5. Platform Decision Matrix

| Component | Platform | Reason | Risk if Wrong |
|-----------|----------|--------|---------------|
| NMI credential storage | Supabase (AES-256 encrypted) | Needs encryption, merchant isolation, CRUD | Key leak if encryption is weak |
| Stripe tokens | Supabase (encrypted) | Stripe Connect access_token + refresh_token per merchant | Token expiry breaks defense layer |
| Checkout page | App (public HTML route) | Must be a public URL for GHL iframe | If slow to load, checkout UX suffers |
| queryUrl backend | App (Express route) | Complex routing logic, processor abstraction | If unreliable, GHL marks transactions as failed |
| Stripe webhook receiver | App (Express route) | Must be fast, handle all dispute/EFW events | Missed webhook = missed dispute deadline |
| Provider registration | App → GHL API | Must happen during OAuth install flow | If registration fails, no payment surfaces work |
| Dispute triage scoring | App (in-memory compute) | Fast computation on webhook receive | Slow scoring delays merchant alerts |
| Account health snapshots | Supabase + scheduled job | Daily computation from Stripe API pulls | Stale data if job fails |
| Evidence file uploads | Stripe Files API | Files stored on Stripe, IDs stored in Supabase | If upload fails, evidence incomplete for dispute |
| Radar Value Lists | Stripe API | Lives on merchant's Stripe account | If sync fails, blocked cards not enforced |

---

## 6. Build Order

### Track 1: NMI Processing Rail (Phases A → B → D → E → G)
*This is the PRIMARY build track. Gets a working checkout first.*

### Track 2: Stripe Defense Layer (Phases A → C → S1–S4)
*This runs in parallel after Phase A. Defense value without checkout.*

### Track 3: Stripe as Checkout Processor (Phase C feeds into Phase E)
*Stripe checkout is a natural extension of Track 1 + Track 2.*

---

### Phase A: Foundation (Database + Processor Abstraction)
**Dependencies:** Existing merchants table, offers_mirror table
**Delivers:** Database schema, processor interface, factory pattern
**Feeds:** Both Track 1 and Track 2

1. Create `processor_configs` table with encryption for NMI keys + columns for Stripe Connect tokens
2. Create `payment_methods` table (stored card references)
3. Create `payment_events` table (already designed, needs migration)
4. Create `dispute_events` table
5. Create `dispute_evidence_files` table
6. Create `account_health_snapshots` table
7. Create `efw_events` table
8. Create `stripe_radar_lists` table
9. Add `default_processor`, `stripe_connected`, `stripe_user_id` to `merchants` table
10. Add `processor_override` and `nmi_processor_id` to `offers_mirror`
11. Build `ProcessorInterface` TypeScript interface
12. Build `ProcessorFactory`
13. Build `processor-config.service.ts` (CRUD + encryption + validation)

**Testable:** Can store/retrieve encrypted configs. Factory resolves correct processor type.

### Phase B: NMI Client (Track 1)
**Dependencies:** Phase A
**Delivers:** Full NMI transaction processing

1. Build `nmi.client.ts` implementing ProcessorInterface
2. Implement: `charge()` — Collect.js payment_token → transact.php sale
3. Implement: `refund()` → transact.php refund
4. Implement: `saveCard()` → Customer Vault add
5. Implement: `listCards()` → Customer Vault query
6. Implement: `chargeStoredCard()` → Customer Vault charge (off-session)
7. Implement: `createSubscription()` → NMI recurring API
8. Implement: `cancelSubscription()` → NMI recurring API
9. Implement: `verifyTransaction()` → NMI query API
10. Multi-MID: Pass `processor_id` on all transactions when configured

**Testable:** Process a test transaction through NMI sandbox.

### Phase C: Stripe Client (Checkout Processing)
**Dependencies:** Phase A
**Delivers:** Stripe checkout processing through ProcessorInterface

1. Build `stripe.client.ts` implementing ProcessorInterface
2. Build `stripe-connect.service.ts` — OAuth flow, token exchange, token refresh, webhook registration
3. Implement: `charge()` — Payment Intents API (create + confirm), writes ScaleSafe metadata + CE 3.0 fields
4. Implement: `refund()` → Stripe Refunds API
5. Implement: `saveCard()` → Setup Intents + attach to Customer
6. Implement: `listCards()` → list Payment Methods for Customer
7. Implement: `chargeStoredCard()` → Payment Intent with off_session
8. Implement: `createSubscription()` → Stripe Subscriptions API
9. Implement: `cancelSubscription()` → cancel Subscription
10. Implement: `verifyTransaction()` → retrieve Payment Intent

**Testable:** Complete OAuth flow. Process a test transaction through Stripe test mode.

### Phase D: GHL Provider Registration + queryUrl Backend (Track 1)
**Dependencies:** Phase A, B (C optional — can add Stripe later)
**Delivers:** ScaleSafe registered as payment provider, backend operations working

1. Build `payment-provider.service.ts` — registers ScaleSafe as custom payment provider via GHL API
2. Build `query-url.controller.ts` at `POST /api/payments/query`
3. API key validation on all queryUrl requests
4. Build `POST /payments/custom-provider/connect` for test/live config
5. Update merchant install flow to include provider registration

**Testable:** GHL recognizes ScaleSafe as payment provider. queryUrl responds correctly.

### Phase E: Checkout Page (Track 1 + 3)
**Dependencies:** Phase B, optionally C, Phase D
**Delivers:** Working checkout in GHL iframe

1. Build public checkout page at `/checkout`
2. Implement postMessage protocol (custom_provider_ready, payment_initiate_props, success/error responses)
3. Processor detection: fetch merchant config → load correct card form
4. NMI mode: Collect.js inline fields → payment_token → backend → NMI
5. Stripe mode: Stripe Elements → PaymentIntent → confirm (with full metadata + CE 3.0 fields)
6. PIF vs Installments toggle from offer data
7. Consent verification via consent token
8. Evidence capture: IP, device fingerprint, browser, timestamp
9. Statement descriptor injection (Module 7) for Stripe transactions
10. Responsive design for GHL iframe (mobile + desktop)

**Testable:** Full payment through iframe on GHL order form.

### Phase S1: Stripe Evidence Vault + Webhook Foundation (Track 2)
**Dependencies:** Phase A, Phase C (stripe-connect.service)
**Delivers:** Evidence capturing on ALL Stripe transactions, webhook processing

1. Build `stripe-webhook.controller.ts` — unified receiver for all Stripe events
2. Build `stripe-evidence-vault.service.ts`:
   - On new PaymentIntent (from ScaleSafe checkout): write full metadata + CE 3.0 fields
   - On existing Stripe transaction (webhook): capture available evidence retroactively
   - Upload contracts/agreements to Stripe Files API (purpose: dispute_evidence)
   - Store file IDs in `dispute_evidence_files` table
3. CE 3.0 eligibility tracking: flag transactions with complete IP + email + address data
4. Transaction-to-evidence mapping: link every Stripe charge to ScaleSafe evidence vault entry

**Testable:** Webhook receives events. Evidence vault populates on new transactions. Files upload successfully.

### Phase S2: Dispute Detection + Triage + Evidence Submission (Track 2)
**Dependencies:** Phase S1
**Delivers:** Automated dispute handling

1. Build `stripe-dispute.service.ts`:
   - Detect disputes via `charge.dispute.created` webhook
   - Compute triage score (0-100) using evidence vault completeness + dispute characteristics
   - Store deadline from `evidence_details.due_by`
   - Fire alerts: T-7, T-3, T-1 day reminders
2. Evidence assembly: build reason-code-appropriate evidence packet from vault
3. Evidence submission via `POST /v1/disputes/{id}` — staged by default, auto-submit for pre-authorized merchants
4. Dispute outcome tracking: won/lost/expired → update stats
5. Build `stripe-efw.service.ts`:
   - Detect EFWs via `radar.early_fraud_warning.created`
   - Decision tree: evidence strength vs dispute rate → hold or refund recommendation
   - 72hr response window tracking

**Testable:** Dispute webhook triggers triage. Evidence assembles correctly. Submission works in Stripe test mode.

### Phase S3: Account Health + Radar (Track 2)
**Dependencies:** Phase S2
**Delivers:** Dashboard data + fraud prevention

1. Build `stripe-health.service.ts`:
   - Daily computation: dispute rate (Visa/MC), EFW rate, recovery rate, evidence completeness, financial exposure
   - VAMP threshold monitoring: 0.50% warning, 0.65% early warning, 0.90% program
   - Mastercard threshold monitoring: 0.75% warning, 1.50% program
   - WholePay upgrade trigger: rate > 0.65% AND evidence completeness < 70%
2. Build `stripe-radar.service.ts`:
   - Create/manage Value Lists (blocked cards, verified customers)
   - Add card fingerprints to blocked list after won fraud disputes
   - 3DS logic: request for new clients, skip for verified returning clients via `scalesafe_verified` metadata
3. Build `stripe-descriptor.service.ts`:
   - Merchant prefix + offer suffix formula
   - Auto-apply on every PaymentIntent

**Testable:** Health snapshots compute correctly. Radar lists sync. Descriptors apply.

### Phase S4: Pre-Dispute Prevention (Verifi/Ethoca) (Track 2)
**Dependencies:** Phase S3
**Delivers:** Full pre-dispute coverage

1. Build `stripe-prevention.service.ts`:
   - OI enrollment checklist (guided merchant walkthrough in UI)
   - CE 3.0 field validation on every transaction (flag missing fields)
   - RDR ruleset configuration interface
   - Ethoca alert detection (Mastercard disputes via webhook) + 24hr response automation
2. Network coverage dashboard: OI (Visa pre-filing) + RDR (Visa pre-chargeback) + Ethoca (Mastercard pre-chargeback)

**Testable:** Onboarding checklist works. CE 3.0 validation catches missing fields. Ethoca alerts detected.

### Phase F: Merchant Settings UI
**Dependencies:** Phase A (processor-config), Phase S1-S3 (defense services)
**Delivers:** Complete merchant configuration + defense dashboard

1. "Payment Processing" tab: NMI form + Stripe Connect button + default toggle + test connection
2. Stripe Defense Dashboard: account health gauges, dispute rate, EFW count, evidence completeness
3. Dispute Management view: active disputes, triage scores, evidence status, fight/accept actions, deadlines
4. Stripe Onboarding Checklist: Connect → OI → RDR rules → CE 3.0 verification
5. Offer form: processor override dropdown + NMI MID selector
6. WholePay upgrade prompt (contextual, triggered by health thresholds)

**Testable:** Full merchant settings workflow. Defense dashboard renders with real data.

### Phase G: Payment Evidence + Enrollment Integration
**Dependencies:** Phase D, E, S1
**Delivers:** Complete evidence chain from consent through payment

1. Build `payment.service.ts`:
   - Handle payment success from checkout page
   - Log Evidence Type 2 (Enrollment Payment)
   - Link consent record to payment record via consent token
   - Device/IP match between consent and payment
2. GHL payment webhook as backup evidence
3. Complete enrollment flow: consent → payment → enrollment record → pipeline opportunity → enrollment packet
4. For Stripe transactions: ensure evidence vault entry is created at charge time (not retroactively)
5. Evidence readiness scoring update

**Testable:** Full enrollment flow with unbroken evidence chain.

### Phase H: Testing + Hardening
**Dependencies:** All phases
**Delivers:** Production-ready dual-rail payment infrastructure

1. End-to-end: Create offer → enrollment → consent → NMI payment → enrollment complete
2. End-to-end: Same flow with Stripe as processor
3. NMI sandbox: sale, refund, void, recurring, multi-MID
4. Stripe test mode: payment intent, refund, subscription, 3DS
5. Stripe defense: simulate dispute → triage → evidence assembly → submission
6. Stripe defense: simulate EFW → alert → response
7. Account health computation with test data
8. PIF and installment flows for both processors
9. Saved card (card-on-file) flow for both
10. Error handling: declined cards, network failures, timeout
11. queryUrl operations from GHL
12. Evidence chain verification at every step
13. Checkout page load time < 2 seconds in iframe

---

## 7. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Stripe Connect partner application rejected/delayed | Low | High — blocks entire Stripe integration | Apply early. ScaleSafe's use case (dispute defense for marketplace app) is standard. Have direct API key fallback ready. |
| NMI Collect.js fails in GHL iframe (CORS, CSP) | Medium | High — checkout broken for NMI | Test iframe embedding early in Phase E. Collect.js designed for iframe use. |
| Stripe Elements fails in GHL iframe | Medium | High — checkout broken for Stripe | Same mitigation. Stripe Elements designed for iframe embedding. |
| GHL provider registration fails silently | Low | High — no payment surfaces work | Verify registration with GET call after POST. Alert merchant. Retry on login. |
| Stripe webhook endpoint overwhelmed | Low | Medium — missed disputes/EFWs | Queue-based processing. Webhook signature verification. Retry logic. |
| Dispute evidence deadline missed | Low | Critical — auto-loss | Deadline stored on creation. Multiple alerts (T-7, T-3, T-1). Auto-submit option. |
| Stripe rate limiting on daily health pulls | Medium | Low — stale dashboard data | Batch API calls. Cache results. Respect rate limits with exponential backoff. |
| Ethoca 24hr response window missed | Medium | Medium — dispute hits rate | Immediate webhook processing (not queued). SMS alert option for merchants. |
| Merchant switches processors mid-stream | Low | Medium — existing subscriptions orphaned | Warn merchant before switch. Document: existing subscriptions remain on old processor. New charges use new processor. |
| PCI compliance concerns | Medium | High — legal risk | NMI: Collect.js (card data never touches server). Stripe: Elements (same). No raw card data stored. AES-256 for API keys. |

---

## 8. Validation Questions

### Answered:
1. ✅ **Architecture shift approved** — ScaleSafe processes through NMI, layers defense on Stripe
2. ✅ **Build order: NMI first** — Get NMI working end-to-end, then layer Stripe
3. ✅ **App works without processor** — Payment features unlock once connected
4. ✅ **Stripe Connect OAuth** — Confirmed by Stripe Defense Layer spec (Module 8)

5. ✅ **Stripe Connect application:** Not yet started. Philip will register at dashboard.stripe.com/register and enable Connect platform mode. PRIORITY — do this ASAP, approval may take time.
6. ✅ **WholePay branding:** Keep generic in the UI. Use "dedicated merchant account" not "WholePay" in merchant-facing surfaces.
7. ✅ **RDR beta access:** Build the interface now (Phase S4). Be ready when merchants get access.
8. ⏳ **Defense layer pricing:** Pending — Philip building a module card and pricing communication doc.

---

## 9. Validation Results

**All architecture questions answered (2026-04-03):**
- Architecture shift: APPROVED — ScaleSafe processes through NMI, layers defense on Stripe
- Build order: NMI first, then Stripe
- Onboarding: App works without processor connected
- Stripe model: Stripe Connect OAuth (confirmed by spec)
- Stripe Connect application: NOT YET STARTED — Philip to register and enable Connect
- WholePay branding: Generic ("dedicated merchant account") in UI
- RDR: Build now, even though in Stripe beta
- Pricing: Pending separate doc from Philip

**STATUS: APPROVED FOR BUILDING** (pricing decision does not block implementation)

---

## 10. Execution Log

*[To be updated as each phase completes]*

---

## Appendix: Stripe Defense Layer Module Map

| Module | Service | Phase | Stripe API Surface |
|--------|---------|-------|--------------------|
| 1 — Evidence Vault | stripe-evidence-vault.service | S1 | PaymentIntents (metadata), Files API, Customers |
| 2 — Dispute Triage | stripe-dispute.service | S2 | Disputes (GET), charge details |
| 3 — Evidence Submission | stripe-dispute.service | S2 | Disputes (POST evidence), Files API |
| 4 — Radar Optimization | stripe-radar.service | S3 | Value Lists, Value List Items, PaymentIntents (3DS) |
| 5 — EFW Management | stripe-efw.service | S2 | Early Fraud Warnings (webhook + GET) |
| 6 — Account Health | stripe-health.service | S3 | Disputes, Charges, Balance Transactions, EFWs |
| 7 — Statement Descriptors | stripe-descriptor.service | S3 | PaymentIntents (statement_descriptor_suffix) |
| 8 — Stripe Connect | stripe-connect.service | C | OAuth, Webhook Endpoints |
| 9 — Verifi/Ethoca Prevention | stripe-prevention.service | S4 | Dispute Prevention (dashboard-guided), CE 3.0 field validation |
