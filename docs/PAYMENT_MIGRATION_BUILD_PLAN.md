# Payment Migration Build Plan v1.0

**Feature:** Stripe-to-GHL Payment Migration — move existing recurring billing from Stripe to GHL-native processing
**Date:** March 30, 2026
**Status:** PLAN — Awaiting validation before build

---

## 1. Current State

Many merchants coming to ScaleSafe already have active clients being billed through Stripe — recurring subscriptions, installment plans, one-time charges. When a merchant installs ScaleSafe, their NEW clients go through the ScaleSafe enrollment flow with GHL-native payment processing. But their EXISTING clients — the ones already being billed through Stripe — are stuck in a no-man's land:

- Stripe payments aren't captured by ScaleSafe's evidence system
- No consent records exist for these legacy clients
- If one of these legacy clients files a chargeback, the merchant has no defense
- The merchant is essentially running two billing systems simultaneously

There is currently NO way to migrate existing Stripe subscriptions to GHL-native processing. No payment update links, no bulk migration tools, no Stripe import capability. The merchant has to manually cancel each Stripe subscription and hope the client re-enrolls — which means losing clients and revenue.

This is a deal-killer for merchant adoption. If ScaleSafe can't handle their existing book of business, switching isn't worth it.

---

## 2. Target State

A merchant can migrate their existing Stripe billing to GHL-native processing through ScaleSafe, either one client at a time or in bulk. The migration flow:

**For the merchant:**
1. Connect their Stripe account to ScaleSafe (API key or OAuth)
2. ScaleSafe imports their active Stripe subscriptions — shows a list of clients, products, amounts, billing frequency
3. Merchant maps each Stripe product to a ScaleSafe offer (or creates new offers)
4. Merchant triggers migration — either individual or bulk
5. ScaleSafe sends payment update links to clients (email + SMS, staggered for bulk)
6. As clients update their payment method, ScaleSafe creates GHL subscriptions and auto-cancels the Stripe subscription
7. Migration dashboard shows progress: migrated, pending, failed

**For the client:**
1. Receives an email/SMS: "We're upgrading our billing system. Please update your payment method to continue your subscription."
2. Clicks the link → lands on a ScaleSafe-hosted page showing their current subscription details
3. Enters their new card info on a GHL-native payment form
4. Clicks submit → new subscription created, old Stripe subscription auto-cancelled
5. No gap in service, no double-billing, no confusion

**For evidence and defense:**
- ScaleSafe imports the client's Stripe payment history as evidence records (proves they've been a paying customer)
- The migration event itself is logged as evidence (proves the client actively agreed to the billing change)
- The new GHL payment captures fresh consent + payment method authorization
- Future chargebacks can reference the FULL payment history (Stripe + GHL combined)

---

## 3. Migration Scenarios

### Scenario 1: Simple Recurring — Same Amount
**Example:** Client pays $497/mo on Stripe. Migrating to $497/mo on GHL.
**Flow:** Send payment update link → client enters card → GHL creates $497/mo subscription → Stripe subscription cancelled.
**Timing:** Use GHL `trialPeriod` to sync the new subscription start with the old subscription's next billing date. If Stripe's next charge is in 12 days, set a 12-day trial on the GHL subscription. Zero gap, zero overlap.
**Evidence:** Import Stripe payment history. Log migration event. New GHL subscription starts evidence trail.

### Scenario 2: Installment Plan — Partially Complete
**Example:** Client is on payment 4 of 6 at $499/mo on Stripe. Migrating to GHL.
**Flow:** Same as Scenario 1, but GHL subscription is configured with `totalCycles: 2` (remaining payments, not restarting).
**Calculation:** App reads Stripe subscription's `current_period_count` or calculates from invoice history. Remaining = original total - completed payments.
**Evidence:** Import full Stripe history (payments 1-4). New GHL subscription picks up at payment 5. Evidence shows continuous payment chain.

### Scenario 3: Amount Mismatch — Price Change During Migration
**Example:** Client was paying $397/mo on Stripe. Merchant's current ScaleSafe offer for the same program is $497/mo (price went up).
**Flow:** Migration page clearly discloses: "Your subscription is being updated. New amount: $497/mo (previously $397/mo)." Client must actively acknowledge the price change before proceeding.
**Evidence:** The price change disclosure is captured as consent evidence. If the client disputes, we have proof they saw and agreed to the new amount.
**Merchant option:** The merchant can choose to honor the old price for migrated clients. This creates a custom price on the GHL product specifically for this migration batch.

### Scenario 4: Failed Card — Client Doesn't Complete
**Example:** Client clicks the payment update link but their card is declined (expired, insufficient funds, etc.).
**Flow:** Show a clear error message. Offer to try a different card. If they abandon, send a follow-up "try again" link via email/SMS after 24 hours and again after 72 hours.
**Merchant visibility:** Dashboard shows this client as "Migration Failed — Card Declined." Merchant can manually trigger another link or reach out directly.
**Stripe side:** Stripe subscription stays active until the client successfully migrates. No auto-cancel on failure.

### Scenario 5: Client Never Responds
**Example:** Client ignores the migration email/SMS entirely.
**Flow:** After 3 reminder attempts (day 1, day 3, day 7), mark as "Migration Stalled — No Response." Client stays on Stripe.
**Merchant visibility:** Dashboard shows count of non-responsive clients. Merchant decides next steps (personal outreach, accept they'll stay on Stripe, etc.).
**Important:** NEVER auto-cancel a Stripe subscription if the client hasn't completed migration. That's lost revenue.

### Scenario 6: Bulk Migration — 50+ Clients
**Example:** Merchant has 200 active Stripe subscriptions to migrate.
**Flow:** Merchant selects "Bulk Migrate" → confirms the client list → ScaleSafe staggers the migration emails/SMS over time (not all 200 at once) to avoid overwhelming support and to manage card processing volume.
**Staggering logic:** Send in batches of 20-30 per day. Merchant can adjust batch size and timing. Each batch gets the same 3-reminder sequence (day 1, day 3, day 7).
**SMS delivery:** Migration links are sent via BOTH email and SMS. SMS goes through GHL's messaging system. This significantly improves response rates — people check texts.

---

## 4. Build Inventory

### 4A. Supabase Schema (App owns)

**New table: `stripe_connections`**
```
id                  UUID PRIMARY KEY
location_id         TEXT NOT NULL UNIQUE
stripe_api_key      TEXT NOT NULL (encrypted)    -- Restricted key with read-only + subscription cancel scope
stripe_account_id   TEXT                         -- Stripe account ID (from API key validation)
connected_at        TIMESTAMPTZ DEFAULT now()
last_sync_at        TIMESTAMPTZ                  -- Last time subscriptions were imported
is_active           BOOLEAN DEFAULT true
```

**New table: `migration_batches`**
```
id                  UUID PRIMARY KEY
location_id         TEXT NOT NULL
batch_name          TEXT                         -- Merchant-assigned name ("March 2026 Migration")
status              TEXT NOT NULL                -- 'draft', 'in_progress', 'completed', 'cancelled'
total_clients       INTEGER DEFAULT 0
migrated_count      INTEGER DEFAULT 0
failed_count        INTEGER DEFAULT 0
pending_count       INTEGER DEFAULT 0
stagger_batch_size  INTEGER DEFAULT 25           -- How many to send per day
stagger_interval    TEXT DEFAULT 'daily'         -- 'daily', 'hourly'
created_at          TIMESTAMPTZ DEFAULT now()
updated_at          TIMESTAMPTZ DEFAULT now()
```

**New table: `migration_records`**
```
id                      UUID PRIMARY KEY
batch_id                UUID REFERENCES migration_batches(id)
location_id             TEXT NOT NULL
contact_id              TEXT                     -- GHL contact ID (created or matched)
offer_id                UUID REFERENCES offers(id)
stripe_subscription_id  TEXT NOT NULL
stripe_customer_id      TEXT NOT NULL
stripe_product_id       TEXT
stripe_price_id         TEXT
client_email            TEXT NOT NULL
client_name             TEXT
client_phone            TEXT
stripe_amount           INTEGER NOT NULL         -- Amount in cents (current Stripe billing)
stripe_interval         TEXT NOT NULL             -- 'month', 'year', etc.
stripe_payments_made    INTEGER                  -- How many payments completed so far
stripe_payments_total   INTEGER                  -- Total expected (null = ongoing)
remaining_payments      INTEGER                  -- Calculated: total - made (null = ongoing)
target_amount           INTEGER                  -- Amount for GHL subscription (may differ from stripe_amount)
amount_changed          BOOLEAN DEFAULT false    -- True if target_amount != stripe_amount
status                  TEXT NOT NULL             -- 'pending', 'link_sent', 'reminder_1', 'reminder_2', 'completed', 'failed_card', 'failed_other', 'stalled', 'cancelled'
migration_link_token    TEXT UNIQUE              -- Token for the payment update link
migration_link_url      TEXT                     -- Full URL sent to client
link_sent_at            TIMESTAMPTZ
reminder_1_sent_at      TIMESTAMPTZ
reminder_2_sent_at      TIMESTAMPTZ
completed_at            TIMESTAMPTZ
ghl_subscription_id     TEXT                     -- Set after successful migration
stripe_cancelled_at     TIMESTAMPTZ              -- Set after Stripe sub cancelled
failure_reason          TEXT
created_at              TIMESTAMPTZ DEFAULT now()
updated_at              TIMESTAMPTZ DEFAULT now()
```

**Add to `evidence_events` (or equivalent evidence table):**
```
-- New evidence types: 'migration_initiated', 'migration_completed', 'migration_payment_history_import'
```

**Dependencies:** None — this is foundation.

### 4B. Stripe Integration Service (App owns)

**New service: `stripe.service.ts`**

**What it does:** Connects to a merchant's Stripe account, imports subscription data, and manages Stripe subscription cancellations after successful migration.

**Methods:**
1. `connectStripeAccount(locationId, apiKey)` — validates the Stripe API key, stores it encrypted, fetches the account ID
2. `importSubscriptions(locationId)` — calls Stripe List Subscriptions API, returns active subscriptions with customer + product + pricing details
3. `getSubscriptionDetails(locationId, subscriptionId)` — fetches full subscription detail including payment history (invoices)
4. `importPaymentHistory(locationId, customerId)` — fetches all paid invoices for a customer, returns as structured payment records for evidence import
5. `cancelSubscription(locationId, subscriptionId)` — cancels the Stripe subscription (called ONLY after successful GHL payment)
6. `getCustomerDetails(locationId, customerId)` — fetches customer name, email, phone for contact matching

**Stripe API endpoints used:**
- GET /v1/subscriptions (list active subscriptions with expand[]=customer,plan.product)
- GET /v1/subscriptions/:id (detail)
- GET /v1/invoices?customer=:id&status=paid (payment history)
- DELETE /v1/subscriptions/:id (cancel — with `cancel_at_period_end: false` for immediate cancel)
- GET /v1/customers/:id (customer detail)

**API key scope requirements:** The restricted key needs: `subscriptions:read`, `subscriptions:write` (for cancel), `invoices:read`, `customers:read`, `products:read`, `prices:read`.

**Platform:** App (Node.js service using Stripe SDK)
**Dependencies:** 4A (stripe_connections table)

### 4C. Migration Service (App owns)

**New service: `migration.service.ts`**

**What it does:** Orchestrates the entire migration flow — from Stripe import to GHL subscription creation to evidence logging.

**Methods:**
1. `createBatch(locationId, name, config)` — creates a migration batch record
2. `importAndMapSubscriptions(batchId, stripeSubscriptions, offerMappings)` — creates migration_records for each subscription, maps to ScaleSafe offers, calculates remaining payments
3. `generateMigrationLink(migrationRecordId)` — generates a unique URL for the client's payment update page
4. `sendMigrationLinks(batchId, batchSize)` — sends the next batch of migration emails + SMS (respects stagger settings)
5. `processMigrationPayment(migrationToken, paymentData)` — called when client submits new card:
   a. Create GHL subscription with correct amount, interval, remaining cycles, and trial period (synced to Stripe billing date)
   b. If GHL payment succeeds: cancel Stripe subscription, update migration_record to 'completed', log evidence
   c. If GHL payment fails: update status to 'failed_card', do NOT cancel Stripe
6. `sendReminder(migrationRecordId, reminderNumber)` — sends reminder 1 or 2 for non-responsive clients
7. `getBatchProgress(batchId)` — returns migration progress stats for dashboard
8. `cancelMigration(migrationRecordId)` — cancels a pending migration (client stays on Stripe)

**Trial period calculation:**
```
nextStripeCharge = stripe_subscription.current_period_end
today = now()
trialDays = daysBetween(today, nextStripeCharge)
// GHL subscription: trialPeriod = trialDays, then first charge on the day Stripe would have charged
```

**Remaining payment calculation:**
```
if (stripe_payments_total is null) → ongoing subscription, no totalCycles on GHL
else → remainingPayments = stripe_payments_total - stripe_payments_made
        GHL subscription: totalCycles = remainingPayments
```

**Platform:** App (Node.js service)
**Dependencies:** 4A (migration tables), 4B (Stripe service), GHL Products/Prices API, GHL Subscriptions/Orders API

### 4D. Migration Payment Page (App owns)

**What it does:** A hosted page where the client enters their new payment method to complete the migration.

**Route:** GET /migrate/:token

**Page content:**
1. Header: "[Merchant Name] — Payment Update"
2. Current subscription details: "You're currently subscribed to [Product Name] at [$Amount/interval]"
3. If amount changed: clear disclosure banner — "Your subscription amount is updating from $[old] to $[new]/[interval]." With a checkbox: "I understand my billing amount is changing."
4. If remaining payments: "You have [N] payments remaining on your plan."
5. New amount summary: "New billing: $[Amount] / [interval] starting [next charge date]"
6. GHL order form (embedded) — captures new card details, processes the initial payment
7. Consent capture: "By submitting, I authorize [Merchant Name] to charge the card above according to the terms described."
8. Submit button

**After successful payment:**
- Show confirmation: "Your payment method has been updated. Your old billing has been cancelled. Your next charge of $[amount] will be on [date]."
- Migration service handles the Stripe cancellation in the background

**After failed payment:**
- Show clear error: "Your card was declined. Please try a different card."
- "Try Again" button (stays on page)
- Don't redirect — let them fix it immediately

**Platform:** App (server-rendered page with GHL order form embed)
**Dependencies:** 4C (migration service), GHL order form integration

### 4E. Migration Communication Templates (GHL workflows)

**What they do:** Send the migration emails and SMS messages through GHL's communication system.

**Templates needed:**

1. **Initial Migration Email:**
   Subject: "Action Required: Update Your Payment Method for [Program Name]"
   Body: Explains the billing system upgrade. Shows current subscription details. Clear CTA button to the migration link. Professional, reassuring tone — NOT "your payment is failing."

2. **Initial Migration SMS:**
   "[Merchant Name]: We're upgrading our billing. Please update your payment method: [short link]. Takes 2 minutes."

3. **Reminder 1 (Day 3) — Email + SMS:**
   Subject: "Reminder: Update Your Payment Method"
   Body: Gentle reminder with the same migration link. "If you've already done this, please disregard."

4. **Reminder 2 (Day 7) — Email + SMS:**
   Subject: "Final Reminder: Payment Method Update Needed"
   Body: Slightly more urgent. "To avoid any interruption to your [Program Name] access, please update your payment method."

5. **Migration Complete — Email:**
   Subject: "Payment Method Updated — You're All Set!"
   Body: Confirmation with new billing details. Next charge date. Who to contact with questions.

6. **Migration Failed — Try Again Email:**
   Subject: "Your Card Couldn't Be Processed — Try Again"
   Body: Non-alarming tone. "The card you entered couldn't be processed. Click here to try a different card." Link back to the same migration page.

**Platform:** GHL workflows triggered by the app via custom triggers
**Dependencies:** GHL custom trigger registration (manual), 4C (migration service triggers the sends)

### 4F. Migration Dashboard UI (App owns — Vue frontend)

**What it does:** Gives the merchant full visibility and control over their migration progress.

**Components:**

1. **Stripe Connection section:**
   - "Connect Stripe Account" button → enter API key → validation → connected status
   - Shows Stripe account name and active subscription count

2. **Import & Map view:**
   - Table of imported Stripe subscriptions: client name, email, product, amount, frequency, payments made/total
   - "Map to Offer" dropdown on each row → select ScaleSafe offer
   - Bulk actions: "Map All to [Offer]" for merchants with one product
   - Highlight amount mismatches in yellow with disclosure about price change

3. **Migration Batches view:**
   - List of migration batches with status, progress bar, counts (migrated/pending/failed/stalled)
   - "Create New Batch" → select clients → name the batch → set stagger configuration → launch
   - Active batch shows real-time progress

4. **Individual Migration Records view:**
   - Drill into a batch to see each client's migration status
   - Status column with visual indicators: green (completed), yellow (pending), orange (failed), red (stalled)
   - Actions: resend link, send reminder, cancel migration, view details
   - Details panel: full timeline (link sent, opened, payment attempted, completed/failed, Stripe cancelled)

5. **Migration Summary stats:**
   - Total migrated / total pending / total failed
   - Revenue migrated (monthly recurring, one-time)
   - Average migration completion time
   - Response rate by channel (email vs SMS)

**Platform:** App (Vue frontend + API endpoints)
**Dependencies:** 4A-4C (all backend services), 4E (communication templates)

### 4G. Evidence Import from Stripe (App owns)

**What it does:** Imports a client's Stripe payment history and creates ScaleSafe evidence records. This establishes evidence continuity — the defense narrative doesn't start at migration, it starts at the client's first payment.

**Components:**

1. **Stripe history import service:**
   - For each migrating client, fetch all paid invoices from Stripe
   - Create evidence records for each payment:
     ```
     evidence_type: 'payment_history_import'
     processor: 'stripe'
     processor_transaction_id: Stripe charge ID
     amount: payment amount
     date: payment date
     source: 'stripe_import'
     import_batch_id: migration batch ID
     ```
   - Import is non-destructive — if run twice, skip existing records (idempotent on processor_transaction_id)

2. **Migration event evidence:**
   - When migration completes, log:
     ```
     evidence_type: 'migration_completed'
     data: {
       from_processor: 'stripe',
       to_processor: 'ghl',
       stripe_subscription_id: old sub ID,
       ghl_subscription_id: new sub ID,
       old_amount: stripe amount,
       new_amount: ghl amount,
       amount_changed: boolean,
       client_consented_to_change: boolean,
       migration_link_clicked_at: timestamp,
       payment_submitted_at: timestamp,
       stripe_cancelled_at: timestamp,
       ip_address: from migration page,
       device_info: from migration page
     }
     ```

3. **Defense packet integration:**
   - When compiling a defense for a migrated client, the evidence chain includes:
     - Stripe payment history (proves long-standing customer relationship)
     - Migration consent (proves client actively agreed to the billing change)
     - GHL payment evidence (post-migration charges)
   - This is a powerful defense narrative: "This client has been paying $X/month for Y months. They actively migrated their billing to a new system on [date]. The charge they're disputing is consistent with their long payment history."

**Platform:** App (evidence service extensions)
**Dependencies:** 4B (Stripe service for history fetch), 4C (migration service), evidence logging system

### 4H. Stripe Cancellation Safety Net (App owns)

**What it does:** Ensures Stripe subscriptions are actually cancelled after migration, and handles edge cases where cancellation fails.

**Components:**

1. **Post-migration cancellation job:**
   - After `processMigrationPayment()` succeeds, immediately attempt Stripe cancellation
   - If cancellation fails (Stripe API error, timeout, etc.): mark migration_record with `stripe_cancel_failed: true`
   - Retry cancellation 3 times with exponential backoff (1 min, 5 min, 30 min)

2. **Cancellation verification cron job:**
   - Runs daily
   - Finds all migration_records where status = 'completed' AND stripe_cancelled_at IS NULL
   - Attempts cancellation again
   - If Stripe says subscription is already cancelled or doesn't exist → mark as cancelled
   - If still active → alert merchant in dashboard

3. **Double-billing prevention:**
   - If a Stripe charge comes in for a subscription that should have been cancelled (migration completed but cancel failed):
   - Log the duplicate charge as evidence
   - Alert the merchant: "Client [name] was charged on both Stripe and GHL. Stripe cancellation may have failed."
   - Merchant can issue a Stripe refund manually or through the dashboard

**Platform:** App (cron job + service)
**Dependencies:** 4B (Stripe service), 4C (migration service)

---

## 5. Architecture Decisions

### Decision 1: Auto-cancel Stripe after successful new payment
**Choice:** When the client successfully submits a new card and GHL creates the subscription, ScaleSafe automatically cancels the Stripe subscription.
**Alternatives:** Leave Stripe active and ask the merchant to cancel manually. Cancel Stripe before collecting new payment (risky).
**Why this wins:** Manual cancellation is error-prone — merchants will forget, leading to double-billing. Cancelling before new payment risks the client being unbilled if they don't complete the new card entry. Auto-cancel after success is the only safe sequence: new payment succeeds → old billing ends.
**Trade-off:** If the Stripe cancellation API call fails, the client could be double-billed. Mitigated by the cancellation safety net (4H) with retries and daily verification.

### Decision 2: Send "try again" link for failed cards, NOT an error page dead-end
**Choice:** When a card is declined on the migration page, show the error immediately and let them try another card. If they abandon, send a follow-up email/SMS with a fresh link.
**Alternatives:** Just show the error and leave it. Contact the merchant to handle it.
**Why this wins:** Card declines are common and usually fixable (expired card, wrong number). Making it easy to retry keeps the migration moving. The merchant shouldn't need to intervene for routine card issues.
**Trade-off:** Multiple retry attempts could flag fraud detection on the merchant's processing account. Mitigated by limiting to 3 attempts per session.

### Decision 3: Calculate remaining payments, NOT restart the plan
**Choice:** For installment plans, calculate how many payments the client has left and configure the GHL subscription accordingly.
**Alternatives:** Start the installment plan over from scratch. Charge the remaining balance as a lump sum.
**Why this wins:** The client already paid 4 of 6 installments — they'd rightfully be angry if they had to start over. This is a migration, not a new enrollment. The remaining payment count honors their existing agreement.
**Trade-off:** Requires accurate data from Stripe about how many payments have been made. If Stripe's invoice history is incomplete or the merchant manually adjusted charges outside of subscriptions, the count could be wrong. Mitigated by showing the merchant the calculated remaining payments during the mapping step — they can override if needed.

### Decision 4: Stagger bulk emails AND send via SMS
**Choice:** For bulk migrations, send links in batches (20-30/day) and use both email AND SMS channels.
**Alternatives:** Send all at once. Email only.
**Why this wins:** Sending 200 migration emails at once would flood the merchant's support inbox with confused clients. Staggering spreads the support load. SMS dramatically improves response rates — people open texts at 95%+ rates versus ~20% for email. The combination maximizes the chance clients actually complete the migration.
**Trade-off:** SMS costs money (GHL charges per segment). Migration takes longer with staggering. Mitigated by letting the merchant control batch size and timing. SMS cost is minimal compared to the revenue protected by completing migrations.

### Decision 5: Trial period for billing date sync, NOT immediate charge
**Choice:** Use GHL's `trialPeriod` to delay the first GHL charge until the date Stripe would have charged next.
**Alternatives:** Charge immediately on the GHL subscription (client pays early). Prorate the Stripe refund and charge full on GHL.
**Why this wins:** Zero gap AND zero overlap. The client pays the same amount on the same schedule — the only thing that changes is who processes the charge. This is the smoothest migration from the client's perspective. No surprise early charges, no refund complications.
**Trade-off:** The trial period means the first GHL charge is delayed, which is a brief window where the client has an active subscription but hasn't been charged by GHL yet. If they dispute during this window, there's nothing to dispute on GHL's side. Mitigated by the fact that Stripe's final charge covers up to that date.

### Decision 6: Import Stripe history as evidence, NOT just start fresh
**Choice:** Import the client's full Stripe payment history as evidence records in ScaleSafe.
**Alternatives:** Only track payments from migration forward. Ask the merchant to export and upload history manually.
**Why this wins:** In a chargeback defense, showing 6 months of consistent payments on Stripe followed by continued payments on GHL is a powerful narrative. It proves: (1) the client has a long-standing relationship with the merchant, (2) they've been willingly paying for this service, (3) the migration was a billing change, not a new charge. Starting evidence from zero at migration loses this history.
**Trade-off:** Importing potentially hundreds of invoices per client adds data volume and API calls to Stripe. Mitigated by running the import as a background job and rate-limiting Stripe API calls. Evidence records are small — storage isn't a concern.

---

## 6. Platform Decision Matrix

| Component | Platform | Reason | Risk if Wrong |
|-----------|----------|--------|---------------|
| Stripe connection + API calls | App (Stripe SDK) | External API integration with auth, complex logic | Low — Stripe SDK is mature and well-documented |
| Migration records + batches | Supabase | Relational data, needs querying/filtering/status tracking | Low — straightforward tables |
| Migration payment page | App (server-rendered) | Needs to embed GHL order form, capture consent, handle card errors | Medium — GHL order form embedding on a custom page needs verification |
| Migration email/SMS templates | GHL workflows | GHL handles email/SMS delivery, merchant can customize templates | Low — standard GHL communication |
| Stripe cancellation | App → Stripe API | Must happen programmatically after payment success, with retries | Medium — cancellation failures need safety net |
| Evidence import | App → Supabase | Batch processing, idempotent imports, structured evidence data | Low — extends existing evidence system |
| Migration dashboard UI | App (Vue frontend) | Complex progress tracking, real-time status updates, batch management | Medium — UX complexity |
| Billing date sync (trial period) | App → GHL API | Calculation logic + GHL subscription creation with trial days | Medium — need to verify GHL trialPeriod works as expected |

---

## 7. Build Order

**Phase 1: Schema + Stripe Connection (Day 1-2)**
- 4A: Run Supabase migrations (stripe_connections, migration_batches, migration_records)
- 4B partial: Build Stripe connection service (connect, validate key, store encrypted)
- 4B partial: Build subscription import (list active subscriptions)
- TEST: Connect a test Stripe account, import subscriptions, verify data

**Phase 2: Migration Service Core (Day 2-3)**
- 4C: Build migration service (createBatch, importAndMap, generateLink, remaining payment calculation, trial period calculation)
- 4B: Build Stripe payment history import
- TEST: Create a migration batch from imported subscriptions, verify remaining payments calculated correctly, verify trial days calculated correctly

**Phase 3: Migration Payment Page (Day 3-4)**
- 4D: Build the hosted migration page (GET /migrate/:token)
- 4D: Handle amount change disclosure
- 4C: Build processMigrationPayment (GHL subscription creation + Stripe cancel)
- TEST: Complete a test migration — new card → GHL subscription created → Stripe cancelled → timing synced

**Phase 4: Communications (Day 4-5)**
- 4E: Create GHL email/SMS templates for all 6 communication types
- Register migration-related custom triggers in GHL (manual)
- 4C: Build sendMigrationLinks with stagger logic
- 4C: Build sendReminder for day 3 and day 7 follow-ups
- TEST: Trigger a batch send, verify staggering, verify email + SMS delivery

**Phase 5: Dashboard (Day 5-7)**
- 4F: Build Stripe Connection UI section
- 4F: Build Import & Map view with product-to-offer mapping
- 4F: Build Batch Management view (create, launch, monitor)
- 4F: Build Individual Record view with timeline
- 4F: Build Migration Summary stats
- TEST: Full end-to-end through the UI — connect Stripe, import, map, launch batch, track progress

**Phase 6: Evidence + Safety Nets (Day 7-8)**
- 4G: Build Stripe history import as evidence records
- 4G: Build migration event evidence logging
- 4G: Update defense packet compiler to include migration evidence + imported Stripe history
- 4H: Build Stripe cancellation retry logic
- 4H: Build daily cancellation verification cron job
- 4H: Build double-billing detection and alerting
- TEST: Generate a defense packet for a migrated client, verify evidence chain includes Stripe history + migration + GHL payments

---

## 8. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Stripe API key has insufficient permissions | Medium | Medium — import fails or cancel fails | Validate key permissions on connect. Show clear error: "Your API key needs these permissions: [list]." |
| GHL trialPeriod doesn't work as expected for billing sync | Low | HIGH — double-billing or gap | Test with real GHL subscription before building full flow. Fallback: charge immediately and refund the prorated Stripe amount manually. |
| Stripe cancellation fails silently | Low | HIGH — double-billing | Safety net job (4H) catches this. Daily verification. Merchant alert. |
| Client disputes the migration charge as unauthorized | Medium | Medium — chargeback | Migration page captures full consent. Evidence chain shows client clicked link, entered card, agreed to terms. Defense packet includes all of this. |
| Merchant maps Stripe product to wrong ScaleSafe offer | Medium | Medium — wrong pricing or wrong program | Show clear confirmation before launching batch: "Client X currently pays $Y. They will be migrated to [Offer Name] at $Z." Require explicit confirmation for amount changes. |
| Bulk SMS costs alarm the merchant | Low | Low — support issue | Show estimated SMS cost before launching batch. Let merchant opt out of SMS channel. |
| Stripe rate limits hit during bulk import | Medium | Low — import slows down | Respect Stripe's rate limits (25 req/sec for test, 100 for live). Queue imports with rate limiting. Show progress indicator. |
| Client completes migration on different device than email | Low | Low — evidence gap for device info | Migration page captures its own device/IP info at submission time, not from the email click. Evidence is still valid. |

---

## 9. Validation Questions

1. **GHL Subscription Creation with Trial:** Can GHL's subscription API accept a `trialPeriod` (in days) that delays the first charge? Does the trial start from creation date or can we specify a start date? This is critical for billing date sync. MUST BE VERIFIED with actual API testing.

2. **GHL Order Form on Custom Page:** The migration payment page needs to collect card details and create a GHL subscription. Can we embed a GHL order form on a ScaleSafe-hosted page (not a GHL funnel page)? If not, does GHL have a Payments API that lets us create a subscription by passing card details? Or do we need to redirect to a GHL-hosted checkout?

3. **Stripe History Depth:** How far back does Stripe's Invoice API return data? If a merchant has been on Stripe for 3 years, can we import all 36 months of payment history? Are there pagination or data retention limits?

4. **Multi-Product Stripe Subscriptions:** Some merchants may have Stripe subscriptions with multiple line items (main product + add-on). How should we handle these? Map the entire subscription to one ScaleSafe offer? Split into separate migrations?

5. **Stripe Connect Accounts:** If the merchant uses Stripe through a platform (Kajabi, Teachable, Thinkific), do they have direct access to their Stripe API keys? Can we cancel subscriptions on a Connect sub-account? Or is this out of scope for v1?

6. **Evidence Admissibility of Imported History:** Do imported Stripe payment records carry weight in chargeback defense even though they're from a different processor? Should we include the raw Stripe invoice PDFs as attachments in the evidence record?

7. **Migration Consent Strength:** Is the consent captured on the migration page (new card entry + terms checkbox) strong enough for chargeback defense on the NEW charges? Or should migrating clients go through the full ScaleSafe enrollment funnel (Pages 1-4) to get the same level of consent evidence as new clients?

8. **Partial Migration Support:** Should we support migrating SOME of a merchant's Stripe subscriptions while leaving others active? (e.g., migrate "Coaching" clients but leave "Membership" clients on Stripe). The batch system supports this, but does the UX need to make it clear?

---

## 10. Validation Results

*(To be filled after review)*

---

## 11. Execution Log

*(Updated as each phase completes)*

| Phase | Status | Date | Notes |
|-------|--------|------|-------|
| 1 — Schema + Stripe Connection | NOT STARTED | | |
| 2 — Migration Service Core | NOT STARTED | | |
| 3 — Migration Payment Page | NOT STARTED | | |
| 4 — Communications | NOT STARTED | | |
| 5 — Dashboard | NOT STARTED | | |
| 6 — Evidence + Safety Nets | NOT STARTED | | |

---

*End of Payment Migration Build Plan v1.0*
