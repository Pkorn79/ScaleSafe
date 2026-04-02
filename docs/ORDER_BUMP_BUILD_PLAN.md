# Order Bump Build Plan v1.0

**Feature:** Order Bumps — 1-click add-ons on the checkout page
**Date:** March 28, 2026
**Status:** PLAN — Awaiting validation before build

---

## 1. Current State

The offer creation flow works like this today:
- Merchant fills out the Create Offer form in the ScaleSafe dashboard
- App creates a GHL Product via POST /products/ (productType: DIGITAL)
- App creates GHL Price(s) on that Product: one-time (PIF) and/or recurring (installments)
- Product ID and Price IDs stored on the offer record in Supabase
- Enrollment link generated with offerId as URL parameter
- Client goes through 4-page enrollment funnel → Page 4 is GHL native order form with the Product attached

There are NO bumps, add-ons, or upsell capabilities today. An offer is exactly one product with one pricing configuration.

---

## 2. Target State

When a merchant creates an offer, they can optionally configure up to 2 order bumps. Each bump is an add-on that appears as a checkbox on the checkout page (Page 4). The client sees the bump description, price, and a checkbox. If they check it, it adds to their total. One payment, one checkout — no extra pages, no re-entering anything.

From the merchant's perspective: "I'm selling my 12-Week Coaching Program for $2,997. I want to offer a Resource Pack add-on for $297 and a VIP Upgrade for $197/month for 3 months."

From the client's perspective: They see the checkout page with the main offer. Below the main price, there are 1-2 optional add-ons with checkboxes. They check what they want, enter their card once, click Pay. Done.

From ScaleSafe's perspective: Every bump acceptance is logged as evidence with full metadata (what was shown, what was checked, timestamp, IP, device). If the client later disputes the bump charge, we have proof they actively selected it.

---

## 3. Pricing Scenarios (ALL Must Work)

These are the real-world combinations merchants will use. Every one of these must be handled correctly.

### Scenario 1: PIF Main + One-Time Bump
**Example:** $2,997 coaching program (PIF) + $297 Resource Pack (one-time)
**What happens:** Single charge of $3,294
**GHL Products:** Product A (main, one-time price $2,997) + Product B (bump, one-time price $297)
**GHL Order:** One order with 2 line items, one total charge
**Evidence:** Enrollment payment evidence shows $3,294 total with bump line item detail

### Scenario 2: Installment Main + One-Time Bump
**Example:** $499/mo × 6 months coaching + $297 Resource Pack (one-time)
**What happens:** First payment = $499 + $297 = $796. Payments 2-6 = $499/mo.
**GHL Products:** Product A (main, recurring price $499/mo × 6) + Product B (bump, one-time price $297)
**GHL Order:** GHL processes the one-time bump on the first charge alongside the first installment. The recurring subscription continues for the main product only.
**Evidence:** First payment shows $796 with breakdown. Subsequent payments show $499 each.
**CRITICAL:** The bump must NOT create its own recurring subscription. It's a one-time add-on charged on the first payment.

### Scenario 3: PIF Main + Recurring Bump
**Example:** $2,997 coaching program (PIF) + $97/mo community access (ongoing)
**What happens:** First payment = $2,997 + $97 = $3,094. Then $97/mo ongoing.
**GHL Products:** Product A (main, one-time price $2,997) + Product B (bump, recurring price $97/mo)
**GHL Order:** Two separate subscriptions created — one completed immediately (PIF), one recurring.
**Evidence:** First payment shows full amount with breakdown. Subsequent $97 payments logged as recurring bump evidence.
**NOTE:** The bump's recurring subscription has NO totalCycles (it's ongoing until cancelled). This is different from the main offer's installment plan which has a fixed number of payments.

### Scenario 4: Installment Main + Recurring Bump
**Example:** $499/mo × 6 coaching + $97/mo community access (ongoing)
**What happens:** $596/mo for 6 months (main installment + bump), then $97/mo ongoing after main completes.
**GHL Products:** Product A (main, recurring $499/mo × 6 cycles) + Product B (bump, recurring $97/mo, no cycle limit)
**GHL Order:** Two separate recurring subscriptions. Main ends after 6 payments, bump continues.
**Evidence:** Each payment logged with breakdown showing which portion is main vs bump.

### Scenario 5: PIF Main + Two Bumps (Mixed Types)
**Example:** $4,997 program (PIF) + $497 toolkit (one-time) + $47/mo membership (ongoing)
**What happens:** First payment = $4,997 + $497 + $47 = $5,541. Then $47/mo ongoing.
**GHL Products:** Product A (main) + Product B (bump 1, one-time) + Product C (bump 2, recurring)
**Evidence:** Full breakdown logged for every charge.

### Scenario 6: Bump Declined
**Example:** $2,997 program offered with $297 bump. Client does NOT check the bump.
**What happens:** Client pays $2,997 only. Bump not charged.
**Evidence:** We still log that the bump was OFFERED but declined. This is evidence that the checkout page was transparent about all options.

---

## 4. Build Inventory

### 4A. Supabase Schema Changes (App owns)

**Add columns to `offers` table:**

```
bump_1_enabled          BOOLEAN DEFAULT false
bump_1_name             TEXT
bump_1_description      TEXT          -- Short description shown on checkout
bump_1_price            DECIMAL(10,2)
bump_1_price_type       TEXT          -- 'one_time' or 'recurring'
bump_1_recurring_interval    TEXT     -- 'day', 'week', 'month', 'year' (null if one_time)
bump_1_recurring_count       INTEGER  -- number of payments (null = ongoing, number = fixed)
bump_1_display_text     TEXT          -- Checkbox label text on checkout page
bump_1_product_id       TEXT          -- GHL Product ID (set by app after creation)
bump_1_price_id         TEXT          -- GHL Price ID (set by app after creation)

bump_2_enabled          BOOLEAN DEFAULT false
bump_2_name             TEXT
bump_2_description      TEXT
bump_2_price            DECIMAL(10,2)
bump_2_price_type       TEXT
bump_2_recurring_interval    TEXT
bump_2_recurring_count       INTEGER
bump_2_display_text     TEXT
bump_2_product_id       TEXT
bump_2_price_id         TEXT
```

**Add to `evidence_enrollment_payment` table:**
```
bump_1_accepted         BOOLEAN DEFAULT false
bump_1_name             TEXT
bump_1_amount           DECIMAL(10,2)
bump_2_accepted         BOOLEAN DEFAULT false
bump_2_name             TEXT
bump_2_amount           DECIMAL(10,2)
total_with_bumps        DECIMAL(10,2)
```

**Dependencies:** None — this is foundation work.

### 4B. Offer Service Updates (App owns)

**Modify `offer.service.ts` → `create()` method:**

After creating the main GHL Product and Price, check if bump_1_enabled or bump_2_enabled. For each enabled bump:

1. Call POST /products/ to create a GHL Product for the bump
   - name: `[Main Offer Name] — [Bump Name]` (keeps it identifiable in GHL)
   - productType: 'DIGITAL'
   - locationId: merchant's locationId

2. Call POST /products/{productId}/price to create the Price
   - If bump_price_type === 'one_time':
     - type: 'one_time'
     - amount: bump_price (in cents)
   - If bump_price_type === 'recurring':
     - type: 'recurring'
     - amount: bump_price (in cents)
     - interval: bump_recurring_interval
     - intervalCount: 1
     - totalCycles: bump_recurring_count (null/0 = ongoing)

3. Store the product_id and price_id back on the offer record

**Modify `offer.service.ts` → `update()` method:**

If bump configuration changes:
- If bump was enabled and now disabled: don't delete the GHL Product (it may have active subscriptions). Just mark bump_X_enabled = false on the offer.
- If bump pricing changes: create a NEW GHL Price on the existing Product. Mark the old price as inactive. Never modify an existing Price that may have active subscriptions.
- If bump is newly enabled: create Product + Price as in create().

**Modify `offer.service.ts` → `generateLink()` method:**

No change needed. The enrollment link still uses offerId. The bump products are resolved at checkout time from the offer record.

**Dependencies:** 4A (schema) must be complete first.

### 4C. Offer API Endpoint Updates (App owns)

**Modify POST /api/offers request body validation:**

Add optional bump fields to the Joi/Zod schema:
```typescript
bump_1_enabled: boolean (optional, default false)
bump_1_name: string (required if bump_1_enabled)
bump_1_description: string (required if bump_1_enabled)
bump_1_price: number (required if bump_1_enabled, > 0)
bump_1_price_type: enum('one_time', 'recurring') (required if bump_1_enabled)
bump_1_recurring_interval: enum('day','week','month','year') (required if bump_1_price_type === 'recurring')
bump_1_recurring_count: number or null (optional, null = ongoing)
bump_1_display_text: string (required if bump_1_enabled)
// Same for bump_2
```

**Modify GET /api/offers/:id response:**

Include bump data in the response so the frontend and enrollment funnel can read it.

**Dependencies:** 4A + 4B must be complete.

### 4D. Dashboard UI — Offer Form (App owns — Vue frontend)

**Add "Order Bumps" section to the Create/Edit Offer form:**

Below the main pricing section, add:
- "Add Order Bump" button (toggles bump_1 section visible)
- Bump 1 section:
  - Name (text input)
  - Description (textarea — keep short, this shows on checkout)
  - Price (number input)
  - Price Type: radio buttons — "One-Time" / "Recurring"
  - If Recurring: Frequency dropdown (Weekly, Bi-Weekly, Monthly), Payment Count (number, blank = ongoing)
  - Display Text (text input — the checkbox label, e.g. "Yes! Add the Resource Pack for $297")
  - Remove button (sets bump_1_enabled = false)
- "Add Another Bump" button (only shows if bump_1 exists, toggles bump_2)
- Bump 2: same fields as bump 1

**Display guidance:**
Show a preview of how the bump will appear on the checkout page. Something like:
```
☐ Yes! Add the Resource Pack for $297
  Includes templates, worksheets, and video library access.
```

**Dependencies:** 4C (API) must be complete.

### 4E. Enrollment Funnel Page 4 — Order Form Configuration (GHL + App)

**THIS IS THE KEY INTEGRATION POINT.**

When the enrollment funnel's Page 4 loads, it needs to know which GHL Products to display on the order form. The flow:

1. Page 4 JavaScript reads offerId from URL parameter
2. Calls GET /api/offers/:offerId (public endpoint, no auth needed for offer details)
3. Response includes: main product_id + price_id, bump_1_product_id + bump_1_price_id (if enabled), bump_2 same
4. Page 4 configures the GHL order form with main product + bump products

**VERIFICATION NEEDED:** How does a GHL order form on a funnel page accept bump products dynamically?

Option A: GHL order forms have a bump configuration in the page editor. If the form supports dynamic product loading via JavaScript, we set the bump products programmatically.

Option B: If GHL order forms require static product configuration, we may need the app to create/update the order form configuration via GHL Funnels API when the offer is created.

Option C: If neither works, the alternative is custom HTML on Page 4 that renders the bump checkboxes ourselves, adds the bump amounts to the total, and the order form only handles the main product charge. The app then charges the bumps separately via GHL's Payments API after the main payment succeeds.

**Option A is strongly preferred** — it's the cleanest and uses GHL native bump behavior. Option C is the fallback but adds complexity.

**THIS MUST BE RESEARCHED AND VERIFIED BEFORE BUILDING.** Check:
1. Can GHL order form bump products be set via JavaScript on the page?
2. Can the GHL Funnels/Pages API configure order form products programmatically?
3. Does GHL's order webhook include bump line items in the payload?

**Dependencies:** 4B (offer service with bump product IDs) must be complete. GHL research must be done first.

### 4F. Payment Webhook Handler Updates (App owns)

**Modify the GHL order/payment webhook handler:**

When the app receives a GHL order webhook after a successful payment:

1. Parse the order payload for ALL line items (not just the first one)
2. Match each line item's product_id against the offer record:
   - Match to main product_id → existing enrollment flow
   - Match to bump_1_product_id → log as bump 1 accepted
   - Match to bump_2_product_id → log as bump 2 accepted
   - No match → log warning, don't fail
3. Create the enrollment record with bump acceptance data:
   - bump_1_accepted: true/false
   - bump_1_name: from offer record
   - bump_1_amount: from webhook line item
   - Same for bump 2
   - total_with_bumps: sum of all line items
4. Log enrollment payment evidence with full bump breakdown

**For recurring payment webhooks (subsequent installments):**
- If the recurring charge matches a bump's product_id (Scenario 3/4), log it as bump recurring payment evidence
- If it matches the main product_id, log as regular installment evidence

**IMPORTANT:** A single enrollment may generate MULTIPLE recurring subscriptions (main + bump). The webhook handler must correctly attribute each payment to the right subscription.

**Dependencies:** 4E (order form) must be working so webhooks actually fire with bump data.

### 4G. Evidence Logging Updates (App owns)

**New evidence sub-type: Bump Acceptance**

When a bump is accepted at checkout, log an evidence record:
```
evidence_type: 'enrollment_bump'
contact_id: client's contact ID
location_id: merchant's location
offer_id: the offer being purchased
data: {
  bump_number: 1 or 2,
  bump_name: 'Resource Pack',
  bump_price: 297.00,
  bump_price_type: 'one_time',
  bump_display_text: 'Yes! Add the Resource Pack for $297',
  accepted: true,
  timestamp: ISO timestamp,
  ip_address: from Page 4,
  device_info: from Page 4,
  browser_info: from Page 4
}
```

Also log when a bump was OFFERED but declined:
```
evidence_type: 'enrollment_bump'
data: {
  bump_number: 1,
  bump_name: 'Resource Pack',
  bump_price: 297.00,
  accepted: false,
  // Still capture timestamp, IP, device — proves it was shown
}
```

**Why log declined bumps?** If a client disputes and claims "I didn't see any options" or "I was tricked into paying more," the evidence shows the checkout was transparent — options were presented and they made a choice.

**Defense Readiness Score update:**
- Bump acceptance evidence adds 2-3 points to the score (additional proof of informed consent)
- Bump decline evidence adds 1 point (proves transparent checkout)

**Dependencies:** 4F (webhook handler) provides the bump acceptance data.

### 4H. GHL Custom Object Sync (App owns)

**Add bump fields to the Offers Custom Object record in GHL:**

When syncing an offer to the GHL Custom Object (for CRM visibility), include:
- bump_1_name, bump_1_price, bump_1_price_type (if enabled)
- bump_2_name, bump_2_price, bump_2_price_type (if enabled)

**VERIFICATION NEEDED:** The current CO schema has 59 fields. Adding 6 more bump fields requires creating them on the Custom Object first. Check if the CO field limit allows this. If not, bumps may only live in Supabase (acceptable — CO sync is for CRM convenience, not critical path).

**Dependencies:** 4B complete. CO field creation may need to happen in the Snapshot or via provisioning.

### 4I. Enrollment Packet Updates (App owns)

**Update the Enrollment Packet PDF to include bump details:**

The enrollment packet is the legal snapshot of what the client agreed to. If bumps were accepted, the packet must include:
- Bump name, description, and price
- Whether it was one-time or recurring (and if recurring, the terms)
- That it was selected by the client (checkbox evidence)

If bumps were offered but declined, note that bumps were available and not selected.

**Dependencies:** 4G (evidence logging with bump data).

### 4J. Defense Packet Updates (App owns)

**Update the AI Defense Compiler to use bump evidence:**

When compiling a defense for a disputed charge that includes bumps:
- Itemize the main offer charge and each bump charge separately
- Show that the bump was a clearly presented option (not hidden)
- Include the checkbox display text as evidence of what was shown
- If the dispute is only for the bump amount, focus defense on bump selection evidence

**Dependencies:** 4G + 4I complete.

---

## 5. Platform Decision Matrix

| Component | Platform | Reason | Risk if Wrong |
|-----------|----------|--------|---------------|
| Bump schema/storage | Supabase | Complex data, offer history, evidence trail | Low risk — straightforward DB columns |
| Bump Product/Price creation | App → GHL API | Must call GHL Products API, same pattern as main offer | Medium — depends on Price API supporting all configurations |
| Bump display on checkout | GHL Order Form (native) | GHL handles bump UI natively, simplest for merchants | HIGH — if GHL order forms can't be configured dynamically, need fallback |
| Bump evidence logging | App → Supabase | Evidence is app's core domain, needs structured storage | Low risk |
| Bump payment attribution | App webhook handler | Need to match line items to offers, complex logic | Medium — depends on GHL webhook payload including bump line items |
| Enrollment packet PDF | App | Already generating PDFs in app | Low risk |
| Defense compilation | App | Already AI-powered in app | Low risk |

---

## 6. Build Order

**Phase 1: Schema + Research (Day 1)**
- 4A: Run Supabase migration to add bump columns
- RESEARCH: Verify GHL order form bump configuration options (API? JavaScript? Static only?)
- RESEARCH: Verify GHL order webhook payload structure with multiple products

**Phase 2: Offer Service + API (Day 1-2)**
- 4B: Update offer.service.ts create/update methods
- 4C: Update API validation schemas
- TEST: Create an offer with bumps, verify GHL Products and Prices are created correctly for all 6 scenarios

**Phase 3: Frontend (Day 2)**
- 4D: Add bump section to Create/Edit Offer form
- TEST: Create offers with various bump configurations through the UI

**Phase 4: Checkout Integration (Day 2-3)**
- 4E: Configure Page 4 order form with bump products
- TEST: Complete a checkout with bump selected, verify GHL processes the correct total
- TEST: Complete a checkout with bump declined, verify only main amount charged

**Phase 5: Webhook + Evidence (Day 3)**
- 4F: Update payment webhook handler to parse bump line items
- 4G: Add bump evidence logging (accepted + declined)
- TEST: Verify evidence records are created correctly for all 6 scenarios

**Phase 6: Documents + Defense (Day 3-4)**
- 4H: Sync bumps to Custom Object (if CO field limit allows)
- 4I: Update enrollment packet PDF with bump details
- 4J: Update defense compiler with bump evidence usage
- TEST: Generate enrollment packet with bumps, verify content

---

## 7. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| GHL order form can't dynamically load bump products | Medium | HIGH — blocks the entire feature | Research FIRST. Fallback: custom HTML bump checkboxes + separate charge via Payments API |
| GHL order webhook doesn't include bump line items | Low | HIGH — can't attribute payments | Research by creating a test order with bumps manually in GHL and inspecting the webhook payload |
| GHL Price API doesn't support all recurring configurations | Low | Medium — limits bump types | Test all 6 scenarios with actual API calls before building the full service |
| Recurring bump + recurring main creates payment attribution confusion | Medium | Medium — evidence logging gets wrong amounts | Use GHL subscription IDs to map each recurring charge to its product. Store subscription_id on the offer record alongside product_id |
| Client disputes only the bump portion of a charge | Low | Low — defense still works | Enrollment packet separates main and bump charges. Defense compiler can target specific line items |
| CO field limit hit (59 + 6 = 65 fields) | Low | Low — CO sync is convenience | Bumps stored in Supabase regardless. CO sync is optional |

---

## 8. Architecture Decisions

### Decision 1: Bumps as offer fields, NOT separate linked offers
**Choice:** Bump configuration lives as columns on the offers table, not as separate offer records linked by a join table.
**Alternatives:** Separate offers_bumps table with foreign keys. Separate offer records with a parent_offer_id.
**Why this wins:** A bump is not an independent offer — it has no enrollment funnel, no standalone link, no separate evidence trail. It's a pricing option ON an offer. Keeping it on the same record simplifies queries, evidence attribution, and the enrollment flow. Max 2 bumps means 20 columns, not a scaling concern.
**Trade-off:** If we ever need 5+ bumps, we'd need to refactor to a separate table. 2 is enough for now.

### Decision 2: One enrollment record per offer (bumps included), NOT separate enrollments per bump
**Choice:** When a client buys an offer with bumps, it creates ONE enrollment record that includes bump acceptance data.
**Alternatives:** Create separate enrollment records for the main offer and each bump.
**Why this wins:** The bump is part of the same purchase decision, same consent event, same checkout page. A chargeback on this transaction is ONE dispute, not separate disputes per line item. The defense packet should present it as one unified purchase with optional add-ons. Separate enrollments would create confusing duplicate pipeline opportunities and fragment the evidence trail.
**Trade-off:** If a bump has its own recurring subscription, the recurring payments need to be attributed back to the parent enrollment. This adds logic to the webhook handler but keeps the data model clean.

### Decision 3: Log BOTH accepted and declined bumps as evidence
**Choice:** When a bump is offered but not selected, log that as evidence too.
**Why:** Proves the checkout was transparent. If a client claims "I didn't know what I was paying for" or "they added charges without my knowledge," the evidence shows exactly what was presented and what the client chose. This is defensive evidence — it strengthens the case even when there's nothing to dispute about the bump itself.

### Decision 4: Never delete or modify a GHL Price with active subscriptions
**Choice:** When a merchant changes bump pricing on an offer, create a NEW Price and deactivate the old one. Never PUT/DELETE an existing Price.
**Why:** GHL Prices may have active subscriptions attached. Modifying the Price could change what existing clients are being charged. New clients get the new price; existing subscriptions continue at the old price until they complete.

---

## 9. Validation Questions

1. **GHL Order Form Configuration:** Can GHL order form bump products be set dynamically via JavaScript on a funnel page, or must they be configured statically in the page editor? This determines whether our single-template enrollment funnel can work with bumps. MUST BE VERIFIED.

2. **GHL Order Webhook Payload:** When a GHL order includes bump products, does the webhook payload include individual line items with product IDs and amounts? Or does it only send the total? We need line-item detail to log proper evidence. MUST BE VERIFIED.

3. **GHL Recurring Bump + Main Interaction:** When an order has a recurring main product AND a recurring bump product, does GHL create two separate subscriptions with independent lifecycle tracking? Or does it merge them? We need independent subscriptions for proper payment attribution.

4. **GHL Price API — One-Time + Recurring on Same Order:** When a one-time bump is on the same order as a recurring main product, does GHL charge the one-time amount on the first payment only? Or does it add a setupFee? The exact mechanics determine how we set up the Price.

5. **Evidence Architecture:** Is logging bump acceptance/decline as a sub-type of enrollment evidence the right approach, or should bumps be their own evidence type in the evidence_types enum? The bump evidence needs to be included in defense compilation.

6. **Consent Coverage:** Do the T&C presented on Page 3 need to explicitly reference that optional add-ons may be available on the next page? For chargeback defense, we need to prove the client was informed about the total possible charges before entering payment info.

7. **Installment + One-Time Bump Timing:** In Scenario 2, does GHL charge the one-time bump on the first installment, or can it be configured to charge immediately as a separate transaction? The payment timing affects evidence logging.

8. **Missing Scenarios:** Are there pricing combinations we haven't considered? What about: bump with a free trial period? Bump with a setup fee? Bump priced at $0 (free add-on for tracking purposes)?

---

## 10. Execution Log

*(Updated as each phase completes)*

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| 1 — Schema + Research | NOT STARTED | | |
| 2 — Offer Service + API | NOT STARTED | | |
| 3 — Frontend | NOT STARTED | | |
| 4 — Checkout Integration | NOT STARTED | | |
| 5 — Webhook + Evidence | NOT STARTED | | |
| 6 — Documents + Defense | NOT STARTED | | |

---

*End of Order Bump Build Plan v1.0*
