# Existing Funnel Integration Build Plan v1.0

**Feature:** Plug-Into-Existing-Funnels — universal integration for merchants who already have sales funnels
**Date:** March 30, 2026
**Status:** PLAN — Awaiting validation before build

---

## 1. Current State

Today, ScaleSafe's enrollment flow requires merchants to send clients through our 4-page enrollment funnel:
- Page 1: Welcome + offer details
- Page 2: Client info capture
- Page 3: Terms & conditions + consent signatures
- Page 4: GHL native order form (payment)

This works great for merchants starting fresh. But many merchants already have working sales funnels — built in GHL, ClickFunnels, Kartra, SamCart, ThriveCart, WordPress/WooCommerce, or other platforms. These funnels already handle the sales pitch, testimonials, bonuses, urgency, and conversion optimization. The merchant doesn't want to rebuild all of that. They want to keep their funnel and plug ScaleSafe in at the payment/consent capture point.

There is currently NO way to integrate ScaleSafe with an external funnel. No embeddable widgets, no hosted consent pages, no webhook handlers for non-GHL payment processors, and no way to map external product IDs to ScaleSafe offer records.

---

## 2. Target State

A merchant with an existing funnel on ANY platform can integrate ScaleSafe in one of two ways:

**Option A — Hosted Consent Page (simplest):**
The merchant replaces their final checkout link/button with a ScaleSafe enrollment link. The client clicks "Purchase Now" on the existing funnel → lands on a ScaleSafe hosted page that captures consent signatures and T&C acceptance → redirects to the merchant's original payment page (or to ScaleSafe's Page 4 for GHL-native payment). The merchant's funnel handles the selling, ScaleSafe handles the legal protection.

**Option B — Embeddable JavaScript Widget (seamless):**
The merchant drops a `<script>` tag and a `<div>` onto their existing checkout page. The ScaleSafe widget renders inline: consent checkboxes, T&C display, e-signature capture. When the client completes the widget AND submits the payment form, ScaleSafe captures all consent evidence. The payment still processes through whatever gateway the merchant already uses — ScaleSafe observes and logs, never processes.

From ScaleSafe's perspective, regardless of which option the merchant uses:
- Consent evidence (signatures, T&C acceptance, IP, device, timestamp) is captured and stored
- Payment events from the external processor are received via webhooks and logged as evidence
- The client gets an enrollment record with full evidence trail
- If a chargeback happens, ScaleSafe has everything needed for defense

### Real-World Scenarios This Must Handle

**Scenario 1: GHL Funnel + GHL Checkout**
Merchant has a GHL funnel with a GHL order form. They want ScaleSafe's consent capture + evidence logging.
→ Insert ScaleSafe consent page between last sales page and order form. OR embed consent widget on the page before the order form. Payment stays in GHL — ScaleSafe already handles GHL payment webhooks.

**Scenario 2: GHL Funnel + Stripe Embedded Checkout**
Merchant has a GHL funnel but uses Stripe for payment processing (Stripe Elements or Stripe Checkout embedded on a custom page).
→ Same consent capture approach. ScaleSafe needs a Stripe webhook handler to receive payment events and log them as evidence. The offer record maps the Stripe product/price ID to the ScaleSafe offer.

**Scenario 3: ClickFunnels / Kartra Funnel**
Merchant's entire funnel is in ClickFunnels or Kartra, including the checkout page.
→ Option A (hosted consent page) works: redirect from CF/Kartra to ScaleSafe consent page, then redirect to CF/Kartra checkout. Option B (widget) works if CF/Kartra allows custom JavaScript on checkout pages. Payment webhooks come from whatever processor CF/Kartra routes to (usually Stripe).

**Scenario 4: SamCart / ThriveCart Standalone Checkout**
Merchant uses SamCart or ThriveCart as their checkout tool (may or may not have a funnel in front of it).
→ Same approach. These tools allow custom code on thank-you pages or pre-checkout pages. The widget captures consent. Payment webhooks come from the cart's connected processor (Stripe or PayPal).

**Scenario 5: WordPress / WooCommerce**
Merchant has a WordPress site with WooCommerce handling e-commerce.
→ Widget embeds on the WooCommerce checkout page or a pre-checkout page. WooCommerce has its own webhook system for order events. ScaleSafe needs a generic webhook handler that can accept WooCommerce's payload format.

---

## 3. Build Inventory

### 3A. Universal Consent Capture — Hosted Page (App owns)

**What it does:** A standalone web page hosted by ScaleSafe that captures consent, signatures, and T&C acceptance. Accessed via URL with offerId parameter. After consent capture, redirects to a configurable URL (merchant's payment page, ScaleSafe Page 4, or a custom thank-you page).

**Components:**
1. **Hosted consent page route:** GET /consent/:offerId renders a page showing:
   - Offer name and price summary (pulled from offer record)
   - Terms & conditions (pulled from offer's compiled_tc_html)
   - Consent checkboxes (same as enrollment funnel Page 3)
   - E-signature capture (typed name + checkbox)
   - "Continue to Payment" button
2. **Consent submission endpoint:** POST /api/consent/capture
   - Receives: offerId, client email/name/phone, consent data (signatures, checkboxes, timestamp, IP, device info)
   - Creates or updates a contact in GHL (via createOrUpdateAContact)
   - Creates a pending enrollment record in Supabase (status: consent_captured, awaiting_payment)
   - Logs consent evidence
   - Returns a consent_token (UUID) that links this consent event to the upcoming payment
   - Redirects to: the offer's configured redirect URL with consent_token as URL parameter
3. **Redirect URL configuration on offer:** New field `external_checkout_url` on the offers table. When set, the hosted consent page redirects here after consent capture instead of to ScaleSafe's Page 4.

**Platform:** App (Node.js + server-rendered HTML or lightweight frontend)
**Dependencies:** Offers table, evidence logging service, GHL contact service

### 3B. Universal Consent Capture — Embeddable Widget (App owns)

**What it does:** A JavaScript snippet that merchants drop onto their existing checkout page. Renders consent UI inline within the merchant's page design. Captures consent data and sends it to ScaleSafe's API before the payment form submits.

**Components:**
1. **Widget JavaScript bundle:** A single JS file hosted at `https://app.scalesafe.io/widget/consent.js`
   - Merchant embeds: `<script src="https://app.scalesafe.io/widget/consent.js" data-offer-id="xxx"></script>`
   - And places: `<div id="scalesafe-consent"></div>` where they want the widget to render
   - Widget fetches offer details from GET /api/offers/:offerId/public (no auth, consent-relevant fields only)
   - Renders: T&C text, consent checkboxes, e-signature input
   - Styled with minimal CSS that adapts to the host page (or merchant can override styles)
   - On submit: POST /api/consent/capture (same endpoint as hosted page)
   - Returns consent_token via JavaScript callback — merchant's payment form includes this token as metadata
2. **Widget configuration options (via data attributes):**
   - `data-offer-id` (required)
   - `data-theme` (optional: 'light' | 'dark' | 'auto')
   - `data-position` (optional: 'above-payment' | 'below-payment' | 'custom')
   - `data-redirect` (optional: URL to redirect after consent capture, for non-SPA pages)
   - `data-callback` (optional: JavaScript function name to call with consent_token)
3. **Public offer endpoint:** GET /api/offers/:offerId/public
   - Returns ONLY: offer name, price summary, T&C HTML, consent requirements
   - No auth required (this is embedded on external pages)
   - Rate limited per IP to prevent abuse
   - CORS configured to allow cross-origin requests

**Platform:** App (static JS bundle + API endpoints)
**Dependencies:** 3A's consent capture endpoint (shared), offers table

### 3C. Multi-Processor Webhook Handlers (App owns)

**What it does:** Receives payment event webhooks from multiple processors and normalizes them into a standard format that ScaleSafe's evidence logging can consume.

**Components:**

1. **GHL Payment Webhook (already exists):** POST /webhooks/ghl/payment
   - Already handles GHL native order events
   - Needs update: match consent_token from order metadata to pending enrollment record

2. **Stripe Webhook Handler (NEW):** POST /webhooks/stripe
   - Receives Stripe webhook events (checkout.session.completed, invoice.paid, charge.succeeded, charge.refunded, charge.dispute.created)
   - Verifies Stripe webhook signature (merchant provides their Stripe webhook signing secret during setup)
   - Normalizes the Stripe event into ScaleSafe's internal payment event format:
     ```
     {
       event_type: 'payment_success' | 'payment_failed' | 'refund' | 'dispute',
       processor: 'stripe',
       processor_transaction_id: Stripe charge ID,
       amount: in cents,
       currency: 'usd',
       customer_email: from Stripe customer object,
       product_id: Stripe product ID (mapped to ScaleSafe offer),
       price_id: Stripe price ID,
       subscription_id: if recurring,
       consent_token: from Stripe metadata (if widget was used),
       raw_payload: full Stripe event (stored for evidence)
     }
     ```
   - Routes normalized event to the enrollment/evidence pipeline

3. **Generic Payment Webhook Handler (NEW):** POST /webhooks/payment
   - Accepts a standardized payload format for any processor that doesn't have a dedicated handler
   - Used for: WooCommerce, SamCart (via Zapier/Make.com), PayPal IPN, or any custom integration
   - Required fields: amount, customer_email, transaction_id, consent_token
   - Optional fields: processor name, product_id, subscription details
   - API key authenticated (merchant gets a webhook API key during setup)
   - Normalizes and routes to the same pipeline as Stripe/GHL handlers

4. **Webhook Signature Verification Service (NEW):**
   - Validates Stripe signatures (stripe-signature header)
   - Validates GHL signatures (existing)
   - For generic webhooks: validates API key + optional HMAC signature

**Platform:** App (Express routes + service layer)
**Dependencies:** Evidence logging service, enrollment service, offer-to-product mapping (3D)

### 3D. Offer-to-Product Mapping Layer (App owns — Supabase)

**What it does:** Maps external product/price IDs from various processors to ScaleSafe offer records. This is how ScaleSafe knows which incoming payment belongs to which offer when the payment comes from Stripe, SamCart, or any non-GHL processor.

**Components:**

1. **New Supabase table: `offer_product_mappings`**
   ```
   id                  UUID PRIMARY KEY
   offer_id            UUID REFERENCES offers(id)
   location_id         TEXT NOT NULL
   processor           TEXT NOT NULL        -- 'ghl', 'stripe', 'samcart', 'thrivecart', 'woocommerce', 'generic'
   external_product_id TEXT NOT NULL        -- The product ID in the external system
   external_price_id   TEXT                 -- Price/variant ID if applicable
   mapping_type        TEXT NOT NULL        -- 'main', 'bump_1', 'bump_2'
   is_active           BOOLEAN DEFAULT true
   created_at          TIMESTAMPTZ DEFAULT now()
   updated_at          TIMESTAMPTZ DEFAULT now()

   UNIQUE(processor, external_product_id, external_price_id, location_id)
   ```

2. **Mapping service:** `productMapping.service.ts`
   - `createMapping(offerId, processor, externalProductId, externalPriceId, mappingType)` — links an external product to an offer
   - `findOfferByExternalProduct(processor, externalProductId, locationId)` — looks up which ScaleSafe offer an incoming payment belongs to
   - `listMappingsForOffer(offerId)` — shows all external integrations for an offer
   - `deactivateMapping(mappingId)` — soft-delete when a product is retired

3. **Dashboard UI — Integration tab on Offer detail page:**
   - Shows current product mappings for this offer
   - "Add Integration" button → select processor → enter external product ID
   - For Stripe: "Connect Stripe" button (OAuth flow or manual API key entry) → fetches Stripe products list → merchant selects which product maps to this offer
   - For others: manual entry of product ID + webhook configuration instructions
   - Shows the webhook URL the merchant needs to configure in their processor

4. **Auto-mapping for GHL products:**
   - When an offer is created with GHL Products/Prices (existing flow), automatically create a mapping record with processor='ghl'
   - This makes the GHL payment webhook handler use the same mapping lookup as external processors

**Platform:** Supabase (table) + App (service + API + UI)
**Dependencies:** Offers table, 3C webhook handlers need this to route payments

### 3E. Merchant Integration Setup Flow (App owns — Dashboard UI)

**What it does:** Guides the merchant through connecting their existing funnel to ScaleSafe. Different flow depending on which platform they use.

**Components:**

1. **"Integrate Existing Funnel" section in Dashboard:**
   - Available on each offer's detail page
   - Shows two options:
     - "Use Hosted Consent Page" → shows the URL, explains how to link it
     - "Embed Consent Widget" → shows the code snippet, explains where to paste it
   - Below: "Connect Payment Processor" → processor selection → setup flow

2. **Processor-specific setup guides (rendered in-app):**
   - **Stripe:** Enter Stripe API key (restricted key, read-only) OR connect via Stripe OAuth. App validates the key, fetches products list, merchant maps products to offers. App generates the webhook endpoint URL. Merchant adds this URL in Stripe dashboard → Webhooks. App stores the webhook signing secret.
   - **GHL (already connected):** Auto-configured. Show confirmation that payment webhooks are active.
   - **SamCart/ThriveCart:** Show the generic webhook URL + API key. Instructions to add as a webhook in SamCart's settings. Fields to map: transaction ID, amount, customer email.
   - **WooCommerce:** Show the generic webhook URL + API key. Instructions to add as a webhook in WooCommerce → Settings → Advanced → Webhooks. Explain the payload format.
   - **Other:** Generic instructions for any platform that supports outbound webhooks.

3. **Integration health check:**
   - After setup, show a "Test Integration" button
   - For Stripe: ping the Stripe API with the stored key to verify it's valid
   - For webhooks: show a test webhook payload the merchant can send to verify the endpoint responds
   - Dashboard shows integration status: Connected (green), Pending Setup (yellow), Error (red)

**Platform:** App (Dashboard Vue frontend + API endpoints)
**Dependencies:** 3C (webhook handlers), 3D (product mapping)

### 3F. Consent-to-Payment Linking (App owns)

**What it does:** Connects the consent event (captured on the hosted page or widget) to the subsequent payment event (received via webhook). This is the critical chain that proves: "the client consented to these terms, THEN paid."

**Components:**

1. **Consent token flow:**
   - Consent capture creates a `consent_token` (UUID) stored on the pending enrollment record
   - Hosted page: appends `?consent_token=xxx` to the redirect URL
   - Widget: returns consent_token via JavaScript callback for the merchant to include as payment metadata
   - For Stripe: merchant's checkout session includes `metadata.consent_token`
   - For GHL: consent_token stored as a contact custom field, included in the order form submission
   - For generic: consent_token included in the webhook payload

2. **Payment-consent matching logic:**
   When a payment webhook arrives:
   - First try: match by consent_token in the payment metadata
   - Fallback: match by customer email + offer product mapping + timestamp proximity (within 2 hours)
   - If no match found: create an "unmatched payment" record → alert merchant in dashboard → they can manually link it to a consent event

3. **Enrollment completion:**
   When a consent event + payment event are linked:
   - Update enrollment status from 'consent_captured' to 'enrolled'
   - Log the full evidence chain: consent evidence + payment evidence, linked by consent_token
   - Trigger the enrollment workflow (pipeline move, welcome communications, etc.)
   - Generate enrollment packet with both consent and payment evidence

**Platform:** App (enrollment service + evidence service)
**Dependencies:** 3A/3B (consent capture), 3C (payment webhooks), 3D (product mapping)

### 3G. Evidence Logging for External Payments (App owns)

**What it does:** Extends the evidence logging system to handle payments from non-GHL processors with the same rigor as GHL-native payments.

**Components:**

1. **New evidence sub-types:**
   - `payment_external_initial` — first payment from an external processor
   - `payment_external_recurring` — subsequent recurring payments from external processor
   - `payment_external_refund` — refund event from external processor
   - `dispute_external` — chargeback/dispute from external processor

2. **Evidence record structure for external payments:**
   ```
   evidence_type: 'payment_external_initial'
   processor: 'stripe' | 'samcart' | 'woocommerce' | 'generic'
   processor_transaction_id: original transaction ID from the processor
   amount: charge amount
   consent_token: linking back to consent evidence
   raw_webhook_payload: full webhook body (stored as proof)
   ip_address: from webhook metadata if available
   timestamp: payment timestamp from the processor
   ```

3. **Defense packet integration:**
   - External payment evidence is included in defense compilations the same as GHL payments
   - The processor name and transaction ID are included so the card network can verify the charge
   - The consent → payment chain is highlighted as the core defense narrative

**Platform:** App (evidence service extensions)
**Dependencies:** 3C (webhook handlers provide the data), 3F (consent linking)

---

## 4. Architecture Decisions

### Decision 1: Two integration modes (hosted page + widget), not one
**Choice:** Offer both a hosted consent page AND an embeddable widget.
**Alternatives:** Only the hosted page (simpler). Only the widget (more flexible).
**Why both:** Some platforms (ClickFunnels, Kartra) make it hard to embed external JavaScript on checkout pages but easily redirect to external URLs. Others (WordPress, custom sites) work great with embedded widgets. Having both covers all scenarios without forcing merchants into workarounds.
**Trade-off:** Two codepaths to maintain. But they share the same consent capture API endpoint, so the backend is unified.

### Decision 2: Consent-then-payment flow, NOT payment-then-consent
**Choice:** Always capture consent BEFORE payment, never after.
**Alternatives:** Capture consent on a thank-you page after payment.
**Why this wins:** For chargeback defense, the strongest position is: "the client read and agreed to the terms, THEN entered their payment info and paid." If consent comes after payment, it's weaker — "they agreed after they'd already been charged" doesn't hold up as well. The consent → payment sequence is the evidence chain.
**Trade-off:** Adds a step to the funnel (consent before checkout). This could reduce conversion slightly. But the legal protection is worth it — that's why merchants are using ScaleSafe in the first place.

### Decision 3: Observe external payments, NEVER process them
**Choice:** ScaleSafe receives payment webhooks and logs them as evidence. It never initiates charges, never stores card numbers, never touches the actual payment.
**Alternatives:** Proxy all payments through ScaleSafe (would give more control).
**Why this wins:** ScaleSafe is a protection platform, not a payment processor. Processing payments would require PCI Level 1 compliance, would make us liable for payment disputes, and would mean merchants have to change their payment setup. Observing via webhooks keeps us out of the payment flow entirely — zero PCI scope, zero liability, and the merchant's existing payment setup works unchanged.
**Trade-off:** We depend on the external processor sending accurate webhooks. If a webhook fails or is delayed, we have a gap in evidence. Mitigated by the daily reconciliation job (already planned in the v2.1 blueprint).

### Decision 4: Generic webhook handler for long-tail processors
**Choice:** Build dedicated handlers for GHL and Stripe (80% of use cases), plus one generic handler for everything else.
**Alternatives:** Build dedicated handlers for every platform (SamCart, ThriveCart, WooCommerce, PayPal, etc.).
**Why this wins:** SamCart/ThriveCart/WooCommerce each have different webhook formats, but they all boil down to the same information: transaction ID, amount, customer email, product. Building dedicated handlers for each is maintenance burden with diminishing returns. The generic handler accepts a standardized format — merchants (or their Zapier/Make.com integrations) normalize the data before sending it.
**Trade-off:** Generic handler puts more burden on the merchant (they need to format the webhook correctly). Mitigated by providing clear documentation and example Zapier/Make.com templates for popular platforms.

### Decision 5: Product mapping table, NOT hardcoded processor logic
**Choice:** A separate mapping table that links any external product ID to a ScaleSafe offer.
**Alternatives:** Store Stripe product IDs directly on the offers table. Use naming conventions to match.
**Why this wins:** A merchant might have the same offer sold through GHL AND Stripe AND SamCart (different funnels, different audiences). The mapping table supports many-to-one relationships (multiple external products → one ScaleSafe offer). It also supports future processors without schema changes.
**Trade-off:** Extra lookup on every payment webhook (query the mapping table to find the offer). Mitigated by indexing on (processor, external_product_id, location_id).

---

## 5. Platform Decision Matrix

| Component | Platform | Reason | Risk if Wrong |
|-----------|----------|--------|---------------|
| Hosted consent page | App (server-rendered) | Needs to be accessible from any external funnel via URL, must capture consent data | Low — straightforward web page |
| Embeddable consent widget | App (static JS bundle) | Must load on any external site, cross-origin capable | Medium — CORS and third-party cookie issues possible |
| Stripe webhook handler | App | Needs Stripe signature verification, complex event mapping | Low — Stripe's webhook format is well-documented |
| Generic webhook handler | App | Custom validation, API key auth, normalization logic | Low — simple REST endpoint |
| Product mapping table | Supabase | Relational data, needs indexing and joins | Low — straightforward table |
| Integration setup UI | App (Vue dashboard) | Multi-step wizard, processor-specific flows | Medium — UX complexity, many processor variations |
| Consent-to-payment linking | App (enrollment service) | Complex matching logic, fallback strategies | Medium — timing-based matching could produce false matches |
| External payment evidence | Supabase + App | Evidence is app's domain, structured storage | Low — extends existing evidence system |

---

## 6. Build Order

**Phase 1: Foundation — Schema + Consent Capture (Day 1-2)**
- 3D partial: Create offer_product_mappings table in Supabase
- Add `external_checkout_url` field to offers table
- 3A: Build hosted consent page (route + UI + POST endpoint)
- 3F partial: Implement consent_token generation and storage
- TEST: Visit hosted consent page, fill out consent, verify evidence record created and redirect works

**Phase 2: Widget (Day 2-3)**
- 3B: Build consent widget JavaScript bundle
- 3B: Build public offer endpoint (GET /api/offers/:offerId/public)
- Configure CORS for widget cross-origin requests
- TEST: Embed widget on a test HTML page, complete consent, verify evidence + consent_token returned

**Phase 3: Webhook Handlers (Day 3-4)**
- 3C: Build Stripe webhook handler with signature verification
- 3C: Build generic webhook handler with API key auth
- 3C: Build webhook signature verification service
- Update existing GHL webhook handler to use consent_token matching
- TEST: Send test Stripe webhook, verify it's received and normalized correctly
- TEST: Send test generic webhook, verify validation and normalization

**Phase 4: Product Mapping + Payment Linking (Day 4-5)**
- 3D complete: Build product mapping service + API endpoints
- 3D: Auto-create GHL mappings for existing offers
- 3F complete: Build consent-to-payment matching logic (token match + email fallback)
- 3F: Build enrollment completion flow for external payments
- TEST: Full flow — consent capture → Stripe payment webhook → matched → enrollment created

**Phase 5: Dashboard UI (Day 5-6)**
- 3E: Build integration setup section on offer detail page
- 3E: Build Stripe connection flow (API key entry, product fetch, mapping)
- 3E: Build generic webhook setup instructions (show URL, API key, payload format)
- 3E: Build integration health check
- TEST: Set up a Stripe integration through the UI, verify product mapping created correctly

**Phase 6: Evidence + Defense (Day 6-7)**
- 3G: Add external payment evidence types
- 3G: Update defense packet compiler to include external payment evidence
- 3G: Update enrollment packet to show external processor details
- TEST: Generate a defense packet for an enrollment that used external payment — verify all evidence included

---

## 7. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Third-party cookie restrictions block widget consent capture | Medium | HIGH — widget becomes unusable on some browsers | Widget uses first-party API calls (not cookies). Consent data sent via POST, not stored in browser. No cookie dependency. |
| Stripe webhook delivery delays cause consent-payment gap | Low | Medium — enrollment stuck in "pending" | Fallback matching by email + amount + time window. Dashboard shows unmatched payments for manual linking. Retry logic on Stripe's side (Stripe retries for up to 3 days). |
| Merchant misconfigures webhook URL | Medium | Medium — payments not received | Integration health check with test webhook. Clear error messages. Dashboard alert when expected payments stop arriving. |
| Consent token not included in payment metadata | Medium | HIGH — can't link consent to payment | Hosted page: consent_token in redirect URL (reliable). Widget: clear documentation + callback function. Fallback: email + offer + timestamp matching. |
| CORS issues on widget for specific platforms | Medium | Medium — widget fails on some sites | Configurable CORS policy. Fallback to hosted page. Pre-test on major platforms (ClickFunnels, WordPress, Shopify). |
| Rate limiting on public offer endpoint abused | Low | Low — endpoint returns minimal data | Rate limit per IP (100 req/min). Cache offer data aggressively (consent fields don't change often). |
| External processor webhook format changes | Low | Medium — handler breaks | Store raw_payload on every webhook. Dedicated handler for Stripe (monitor API version changes). Generic handler uses a stable, minimal schema. |

---

## 8. Validation Questions

1. **Consent Timing:** Is the consent-before-payment flow realistic for all funnel types? Some checkout pages (SamCart, ThriveCart) are single-page — the consent widget would need to block the payment button until consent is captured. Is this technically feasible without modifying the checkout platform's code?

2. **Widget Security:** The consent widget loads on external sites and calls our API. What prevents a bad actor from spoofing consent events? The consent_token links consent to payment, but could someone generate fake consent records? Should we add reCAPTCHA or proof-of-human verification to the widget?

3. **Stripe Integration Depth:** Should we support Stripe Connect (for merchants who use Stripe through a platform like Kajabi or Teachable), or only direct Stripe accounts? Stripe Connect would widen the funnel types we support but adds complexity to webhook verification.

4. **Consent-Payment Matching Confidence:** Our fallback matching (email + offer + time window) could produce false matches if a client has multiple pending consents. Should we require consent_token matching for external payments and reject payments without tokens? Or is the fallback important for user experience?

5. **Evidence Admissibility:** Does evidence from an external processor carry the same weight in chargeback defense as evidence from our own payment flow? Are there additional data points we should capture from the external webhook to strengthen the defense?

6. **Merchant Onboarding Complexity:** Setting up webhooks and product mappings requires technical knowledge. Should we build Zapier/Make.com templates that merchants can one-click install to handle the webhook forwarding? Would this reduce support burden enough to be worth building?

7. **Scope Boundary:** Should the embeddable widget also handle the order bump display (if bumps are configured on the offer), or should bumps ONLY work with ScaleSafe's native checkout? Bumps on external checkouts would add significant complexity.

8. **Multi-Processor Per Offer:** Can one offer realistically be sold through multiple processors simultaneously (e.g., GHL checkout for direct leads AND Stripe checkout for ClickFunnels leads)? If yes, the product mapping layer needs to handle this. If no, we can simplify to one processor per offer.

---

## 9. Validation Results

*(To be filled after review)*

---

## 10. Execution Log

*(Updated as each phase completes)*

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| 1 — Schema + Consent Capture | NOT STARTED | | |
| 2 — Widget | NOT STARTED | | |
| 3 — Webhook Handlers | NOT STARTED | | |
| 4 — Product Mapping + Linking | NOT STARTED | | |
| 5 — Dashboard UI | NOT STARTED | | |
| 6 — Evidence + Defense | NOT STARTED | | |

---

*End of Existing Funnel Integration Build Plan v1.0*
