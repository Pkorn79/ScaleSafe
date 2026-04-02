# ScaleSafe v2.1 — Full Architecture Map

**Version:** 1.0 — March 30, 2026
**Purpose:** READ THIS BEFORE BUILDING ANYTHING. This document maps every Supabase table, every API endpoint, every service, and every webhook handler that will exist when ScaleSafe v2.1 is complete — including 3 major features that get built in later phases. Build every foundation piece with this full picture in mind so later features plug in cleanly without refactoring.

**Why this exists:** ScaleSafe is built in phases, but the architecture must accommodate ALL phases from day one. If you build a narrow enrollment table that doesn't have bump columns, you'll refactor later. If you build a payment webhook handler that only understands GHL, you'll rip it apart for Stripe. Build it right the first time.

---

## THE THREE FEATURES THAT AFFECT FOUNDATION ARCHITECTURE

These are built in later phases but their requirements MUST shape early decisions:

### Feature 1: Order Bumps (Phase 5)
Merchants can add 1-2 optional add-on products to any offer. Bumps appear as checkboxes on the checkout page. Affects: offers table (20 extra columns), evidence tables (bump acceptance tracking), payment webhook handler (multi-line-item parsing), enrollment packets, defense packets.

### Feature 2: Existing Funnel Integration (Phase 8)
Merchants with funnels on ClickFunnels, SamCart, WordPress, etc. can plug ScaleSafe in without rebuilding. Affects: new consent capture endpoints (hosted page + JS widget), new webhook handlers for Stripe and generic processors, new product mapping table, consent-to-payment linking logic.

### Feature 3: Payment Migration — Stripe to GHL (Phase 9)
Merchants can migrate existing Stripe subscriptions to GHL-native billing. Affects: new Stripe integration service, migration tables, migration payment page, evidence import from Stripe history, Stripe cancellation handling.

---

## COMPLETE SUPABASE SCHEMA

Every table that will exist. Tables marked with phase numbers — build the table when that phase arrives, but design relationships and foreign keys knowing ALL tables will exist.

### Core Tables (Phase 1-2)

```sql
-- Already exists
merchants (
  id UUID PRIMARY KEY,
  location_id TEXT UNIQUE NOT NULL,
  company_id TEXT,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  business_name TEXT,
  support_email TEXT,
  is_active BOOLEAN DEFAULT true,
  installed_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
)

-- Phase 1
trigger_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id TEXT NOT NULL,
  trigger_key TEXT NOT NULL,         -- e.g. 'enrollment_complete', 'ss_payment_received'
  subscription_url TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
)

-- Phase 2 — DESIGN WITH BUMPS IN MIND (Phase 5 adds bump columns)
offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id TEXT NOT NULL,
  merchant_id UUID REFERENCES merchants(id),

  -- Program basics
  program_name TEXT NOT NULL,
  program_description TEXT,
  price DECIMAL(10,2),
  payment_type TEXT,                 -- 'pif' or 'installment'
  installment_amount DECIMAL(10,2),
  installment_frequency TEXT,        -- 'weekly', 'biweekly', 'monthly'
  installment_count INTEGER,
  pif_price DECIMAL(10,2),
  pif_discount_enabled BOOLEAN DEFAULT false,
  delivery_method TEXT,
  refund_window_text TEXT,

  -- Milestones 1-8 (name, delivers, client_does = 24 fields)
  milestone_1_name TEXT, milestone_1_delivers TEXT, milestone_1_client_does TEXT,
  milestone_2_name TEXT, milestone_2_delivers TEXT, milestone_2_client_does TEXT,
  milestone_3_name TEXT, milestone_3_delivers TEXT, milestone_3_client_does TEXT,
  milestone_4_name TEXT, milestone_4_delivers TEXT, milestone_4_client_does TEXT,
  milestone_5_name TEXT, milestone_5_delivers TEXT, milestone_5_client_does TEXT,
  milestone_6_name TEXT, milestone_6_delivers TEXT, milestone_6_client_does TEXT,
  milestone_7_name TEXT, milestone_7_delivers TEXT, milestone_7_client_does TEXT,
  milestone_8_name TEXT, milestone_8_delivers TEXT, milestone_8_client_does TEXT,

  -- Clause slots 1-11 (title + text = 22 fields)
  clause_1_title TEXT, clause_1_text TEXT,
  clause_2_title TEXT, clause_2_text TEXT,
  clause_3_title TEXT, clause_3_text TEXT,
  clause_4_title TEXT, clause_4_text TEXT,
  clause_5_title TEXT, clause_5_text TEXT,
  clause_6_title TEXT, clause_6_text TEXT,
  clause_7_title TEXT, clause_7_text TEXT,
  clause_8_title TEXT, clause_8_text TEXT,
  clause_9_title TEXT, clause_9_text TEXT,
  clause_10_title TEXT, clause_10_text TEXT,
  clause_11_title TEXT, clause_11_text TEXT,

  -- Compiled output
  compiled_tc_html TEXT,

  -- GHL integration
  ghl_product_id TEXT,               -- GHL Product ID (created by app)
  ghl_price_id TEXT,                 -- GHL Price ID for main pricing
  ghl_co_record_id TEXT,             -- Offers Custom Object record ID
  redirect_slug TEXT,

  -- *** PHASE 5: ORDER BUMP FIELDS (add these columns in Phase 5 migration) ***
  -- bump_1_enabled BOOLEAN DEFAULT false,
  -- bump_1_name TEXT,
  -- bump_1_description TEXT,
  -- bump_1_price DECIMAL(10,2),
  -- bump_1_price_type TEXT,          -- 'one_time' or 'recurring'
  -- bump_1_recurring_interval TEXT,
  -- bump_1_recurring_count INTEGER,
  -- bump_1_display_text TEXT,
  -- bump_1_product_id TEXT,          -- GHL Product ID for bump
  -- bump_1_price_id TEXT,            -- GHL Price ID for bump
  -- bump_2_enabled through bump_2_price_id (same 10 fields)

  -- *** PHASE 8: EXTERNAL FUNNEL FIELDS (add in Phase 8 migration) ***
  -- external_checkout_url TEXT,      -- redirect after consent capture

  -- System
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
)

-- Phase 2
enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,          -- GHL contact ID
  offer_id UUID REFERENCES offers(id),
  merchant_id UUID REFERENCES merchants(id),

  status TEXT NOT NULL DEFAULT 'pending',
  -- Statuses: 'pending', 'consent_captured', 'enrolled', 'active',
  --           'at_risk', 'cancelled', 'completed'

  -- Consent data
  consent_token TEXT UNIQUE,         -- Links consent event to payment
  consent_captured_at TIMESTAMPTZ,
  consent_ip TEXT,
  consent_device TEXT,
  consent_browser TEXT,
  tc_version_hash TEXT,

  -- Payment data
  payment_amount DECIMAL(10,2),
  payment_type TEXT,                 -- 'pif' or 'installment'
  payment_transaction_id TEXT,
  payments_made INTEGER DEFAULT 0,
  payments_total INTEGER,            -- null = ongoing, number = fixed installments

  -- *** PHASE 5: BUMP ACCEPTANCE (add in Phase 5 migration) ***
  -- bump_1_accepted BOOLEAN DEFAULT false,
  -- bump_1_name TEXT,
  -- bump_1_amount DECIMAL(10,2),
  -- bump_2_accepted BOOLEAN DEFAULT false,
  -- bump_2_name TEXT,
  -- bump_2_amount DECIMAL(10,2),
  -- total_with_bumps DECIMAL(10,2),

  -- *** PHASE 9: MIGRATION SOURCE (add in Phase 9 migration) ***
  -- migration_source TEXT,           -- 'stripe', null for native enrollments
  -- migration_record_id UUID,        -- links to migration_records table

  -- Pipeline tracking
  pipeline_opportunity_id TEXT,      -- GHL opportunity ID
  current_milestone INTEGER DEFAULT 0,

  -- Defense
  defense_readiness_score INTEGER DEFAULT 0,
  risk_score INTEGER DEFAULT 0,

  -- Timestamps
  enrolled_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
)

-- Phase 2-3
evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  enrollment_id UUID REFERENCES enrollments(id),
  merchant_id UUID REFERENCES merchants(id),

  evidence_type TEXT NOT NULL,
  -- Types: 'enrollment_consent', 'enrollment_payment', 'session_attended',
  --   'session_noshow', 'module_completed', 'milestone_reached',
  --   'milestone_signedoff', 'pulse_check', 'payment_received',
  --   'payment_failed', 'cancellation_request', 'communication_sent',
  --   'reengagement_attempt',
  -- *** PHASE 5 adds: 'enrollment_bump' ***
  -- *** PHASE 8 adds: 'payment_external_initial', 'payment_external_recurring',
  --     'payment_external_refund', 'dispute_external' ***
  -- *** PHASE 9 adds: 'payment_history_import', 'migration_completed' ***

  -- Flexible data storage
  data JSONB NOT NULL DEFAULT '{}',  -- Evidence-type-specific structured data

  -- *** PHASE 8: PROCESSOR TRACKING (add in Phase 8 migration) ***
  -- processor TEXT,                  -- 'ghl', 'stripe', 'samcart', 'generic'
  -- processor_transaction_id TEXT,

  -- Common metadata
  ip_address TEXT,
  device_info TEXT,
  browser_info TEXT,

  created_at TIMESTAMPTZ DEFAULT now()
)
```

### Payment & Dispute Tables (Phase 4, 6)

```sql
-- Phase 4
payment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  enrollment_id UUID REFERENCES enrollments(id),

  event_type TEXT NOT NULL,          -- 'payment_success', 'payment_failed', 'refund'
  processor TEXT NOT NULL DEFAULT 'ghl',
  -- *** PHASE 8: processor can be 'stripe', 'samcart', 'generic' ***

  processor_transaction_id TEXT,
  amount DECIMAL(10,2) NOT NULL,
  currency TEXT DEFAULT 'usd',

  -- For recurring tracking
  payment_number INTEGER,            -- Which payment in the sequence
  payments_remaining INTEGER,

  -- Failure details
  failure_reason TEXT,
  attempt_count INTEGER DEFAULT 1,

  -- *** PHASE 5: BUMP ATTRIBUTION (add in Phase 5 migration) ***
  -- line_item_type TEXT,             -- 'main', 'bump_1', 'bump_2'
  -- subscription_id TEXT,            -- GHL subscription ID for recurring attribution

  raw_webhook_payload JSONB,         -- Full webhook body for evidence

  created_at TIMESTAMPTZ DEFAULT now()
)

-- Phase 6
chargebacks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  enrollment_id UUID REFERENCES enrollments(id),

  amount DECIMAL(10,2) NOT NULL,
  reason_code TEXT,                  -- Visa/MC reason code
  dispute_date DATE NOT NULL,
  response_deadline DATE,            -- Calculated: dispute_date + 21 days

  status TEXT NOT NULL DEFAULT 'open',
  -- Statuses: 'open', 'defense_compiling', 'defense_ready',
  --           'submitted', 'won', 'lost'

  defense_packet_url TEXT,
  defense_compiled_at TIMESTAMPTZ,
  evidence_count INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
)

-- Phase 7
chargeback_ratio_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id TEXT NOT NULL,

  window_days INTEGER NOT NULL,      -- 30, 60, or 90
  transaction_count INTEGER NOT NULL,
  dispute_count INTEGER NOT NULL,
  ratio DECIMAL(5,4) NOT NULL,       -- e.g. 0.0052 = 0.52%
  trend TEXT,                        -- 'rising', 'stable', 'falling'

  alert_level TEXT,                  -- null, 'warning', 'critical'
  alert_fired_at TIMESTAMPTZ,

  calculated_at TIMESTAMPTZ DEFAULT now()
)
```

### Phase 8: External Funnel Integration Tables

```sql
-- Phase 8
offer_product_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id UUID REFERENCES offers(id),
  location_id TEXT NOT NULL,

  processor TEXT NOT NULL,           -- 'ghl', 'stripe', 'samcart', 'thrivecart', 'woocommerce', 'generic'
  external_product_id TEXT NOT NULL,
  external_price_id TEXT,
  mapping_type TEXT NOT NULL,        -- 'main', 'bump_1', 'bump_2'

  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(processor, external_product_id, external_price_id, location_id)
)

-- Phase 8
processor_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id TEXT NOT NULL,

  processor TEXT NOT NULL,           -- 'stripe', 'samcart', etc.
  api_key_encrypted TEXT,            -- Encrypted API key
  account_id TEXT,                   -- Processor's account identifier
  webhook_signing_secret TEXT,       -- For webhook signature verification
  webhook_api_key TEXT,              -- For generic webhook auth

  is_active BOOLEAN DEFAULT true,
  connected_at TIMESTAMPTZ DEFAULT now(),
  last_verified_at TIMESTAMPTZ
)
```

### Phase 9: Payment Migration Tables

```sql
-- Phase 9
stripe_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id TEXT NOT NULL UNIQUE,
  stripe_api_key_encrypted TEXT NOT NULL,
  stripe_account_id TEXT,
  last_sync_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  connected_at TIMESTAMPTZ DEFAULT now()
)

-- Phase 9
migration_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id TEXT NOT NULL,
  batch_name TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  -- Statuses: 'draft', 'in_progress', 'completed', 'cancelled'
  total_clients INTEGER DEFAULT 0,
  migrated_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  pending_count INTEGER DEFAULT 0,
  stagger_batch_size INTEGER DEFAULT 25,
  stagger_interval TEXT DEFAULT 'daily',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
)

-- Phase 9
migration_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID REFERENCES migration_batches(id),
  location_id TEXT NOT NULL,
  contact_id TEXT,
  offer_id UUID REFERENCES offers(id),

  -- Stripe source data
  stripe_subscription_id TEXT NOT NULL,
  stripe_customer_id TEXT NOT NULL,
  stripe_product_id TEXT,
  stripe_price_id TEXT,
  client_email TEXT NOT NULL,
  client_name TEXT,
  client_phone TEXT,
  stripe_amount INTEGER NOT NULL,    -- cents
  stripe_interval TEXT NOT NULL,
  stripe_payments_made INTEGER,
  stripe_payments_total INTEGER,     -- null = ongoing
  remaining_payments INTEGER,

  -- Migration config
  target_amount INTEGER,             -- May differ from stripe_amount
  amount_changed BOOLEAN DEFAULT false,

  -- Status tracking
  status TEXT NOT NULL DEFAULT 'pending',
  -- Statuses: 'pending', 'link_sent', 'reminder_1', 'reminder_2',
  --           'completed', 'failed_card', 'failed_other', 'stalled', 'cancelled'
  migration_link_token TEXT UNIQUE,
  migration_link_url TEXT,
  link_sent_at TIMESTAMPTZ,
  reminder_1_sent_at TIMESTAMPTZ,
  reminder_2_sent_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Result
  ghl_subscription_id TEXT,
  stripe_cancelled_at TIMESTAMPTZ,
  failure_reason TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
)
```

---

## COMPLETE API ENDPOINT MAP

Every endpoint that will exist. Build routers with this full map in mind — group routes logically so later additions don't require restructuring.

### Webhook Endpoints (all receive external data)

```
POST /webhooks/ghl/triggers         -- Phase 1: trigger subscription lifecycle
POST /webhooks/ghl/payment          -- Phase 2: GHL payment events (orders, subscriptions, failures, refunds)
POST /webhooks/ghl/forms            -- Phase 3: form submission webhooks (SYS2-07 through SYS2-11)
POST /webhooks/stripe               -- Phase 8: Stripe payment events
POST /webhooks/payment              -- Phase 8: generic payment events (SamCart, WooCommerce, etc.)
```

### API Endpoints — Offers

```
POST   /api/offers                  -- Phase 2: create offer (+ GHL Product/Price)
GET    /api/offers                  -- Phase 2: list offers for merchant
GET    /api/offers/:id              -- Phase 2: get offer detail
PUT    /api/offers/:id              -- Phase 2: update offer
GET    /api/offers/:id/public       -- Phase 8: public offer data (no auth, for consent widget)
```

### API Endpoints — Enrollment

```
POST   /api/enrollment/consent      -- Phase 2: consent capture from Page 3 (returns consent_token)
GET    /enrollment                  -- Phase 2: public enrollment page (existing)
```

### API Endpoints — Consent (Phase 8: External Funnel Integration)

```
GET    /consent/:offerId            -- Phase 8: hosted consent page for external funnels
POST   /api/consent/capture         -- Phase 8: consent submission (shared with enrollment/consent)
GET    /widget/consent.js           -- Phase 8: embeddable JavaScript widget bundle
```

### API Endpoints — Evidence & Defense

```
GET    /api/evidence/:enrollmentId  -- Phase 3: list evidence for enrollment
POST   /api/evidence                -- Phase 3: manually log evidence (internal use)
GET    /api/defense/:enrollmentId   -- Phase 6: get/compile defense packet
POST   /api/chargebacks             -- Phase 6: report a chargeback
```

### API Endpoints — Dashboard Data

```
GET    /api/dashboard/summary       -- Phase 7: merchant dashboard summary stats
GET    /api/dashboard/ratio         -- Phase 7: chargeback ratio widget data
GET    /api/enrollments             -- Phase 2: list enrollments for merchant
GET    /api/enrollments/:id         -- Phase 2: enrollment detail with evidence
```

### API Endpoints — Integration (Phase 8)

```
POST   /api/integrations/connect    -- Phase 8: connect external processor
GET    /api/integrations            -- Phase 8: list active integrations
POST   /api/integrations/mapping    -- Phase 8: create product-to-offer mapping
GET    /api/integrations/mapping/:offerId  -- Phase 8: list mappings for offer
DELETE /api/integrations/mapping/:id       -- Phase 8: deactivate mapping
POST   /api/integrations/test       -- Phase 8: test integration health
```

### API Endpoints — Migration (Phase 9)

```
POST   /api/migration/connect-stripe      -- Phase 9: connect Stripe account
GET    /api/migration/subscriptions        -- Phase 9: list imported Stripe subscriptions
POST   /api/migration/batches              -- Phase 9: create migration batch
GET    /api/migration/batches              -- Phase 9: list batches
GET    /api/migration/batches/:id          -- Phase 9: batch detail with records
POST   /api/migration/batches/:id/launch   -- Phase 9: start sending migration links
POST   /api/migration/batches/:id/cancel   -- Phase 9: cancel batch
GET    /migrate/:token                     -- Phase 9: hosted migration payment page
POST   /api/migration/process-payment      -- Phase 9: handle migration payment submission
```

### Auth & System Endpoints (existing)

```
GET    /health                       -- Existing: health check
GET    /auth/callback                -- Existing: OAuth callback
POST   /auth/sso                     -- Existing: SSO postMessage verification
```

---

## COMPLETE SERVICE MAP

Every service that will exist. When building early services, use consistent patterns (constructor injection, async/await, structured error handling, logging) so later services follow the same conventions.

### Core Services (Phase 1-2)
```
trigger.service.ts          -- Phase 1: fire triggers, manage subscriptions
offer.service.ts            -- Phase 2: CRUD offers, create GHL Products/Prices
                            --          Phase 5 ADDS: bump Product/Price creation
enrollment.service.ts       -- Phase 2: create enrollments, manage lifecycle
                            --          Phase 5 ADDS: bump acceptance tracking
                            --          Phase 8 ADDS: external payment enrollment completion
                            --          Phase 9 ADDS: migration-sourced enrollment creation
consent.service.ts          -- Phase 2: capture consent, generate tokens, link to payments
                            --          Phase 8 ADDS: hosted page + widget consent flows
```

### Evidence & Defense (Phase 3, 6)
```
evidence.service.ts         -- Phase 3: log evidence, query by enrollment
                            --          Phase 5 ADDS: bump evidence types
                            --          Phase 8 ADDS: external payment evidence types
                            --          Phase 9 ADDS: imported Stripe history evidence
session.service.ts          -- Phase 3: log sessions, no-shows
milestone.service.ts        -- Phase 3: track milestones, sign-offs, program completion
risk.service.ts             -- Phase 3: disengagement scoring, re-engagement detection
defense.service.ts          -- Phase 6: compile defense packets, AI narrative generation
enrollmentPacket.service.ts -- Phase 6: generate enrollment snapshot PDFs
```

### Payment (Phase 4, 7)
```
payment.service.ts          -- Phase 4: process payment webhooks, track recurring payments
                            --          Phase 5 ADDS: multi-line-item attribution (bumps)
                            --          Phase 8 ADDS: normalize external processor payments
chargeback.service.ts       -- Phase 6: manage chargebacks, track deadlines
ratioMonitoring.service.ts  -- Phase 7: calculate ratios, fire warning/critical triggers
```

### External Integration (Phase 8)
```
productMapping.service.ts   -- Phase 8: map external product IDs to ScaleSafe offers
processorConnection.service.ts -- Phase 8: manage external processor connections
webhookVerification.service.ts -- Phase 8: verify signatures (Stripe, HMAC, API key)
```

### Migration (Phase 9)
```
stripe.service.ts           -- Phase 9: Stripe API integration (import subs, cancel, history)
migration.service.ts        -- Phase 9: orchestrate migration flow
migrationComms.service.ts   -- Phase 9: send migration links, reminders (via GHL triggers)
```

---

## CRITICAL ARCHITECTURE PATTERNS

These patterns MUST be consistent across all phases. Establish them in Phase 1-2 so everything built later follows the same conventions.

### Pattern 1: Webhook Handler → Service → Evidence → Trigger

Every webhook follows this flow:
```
Webhook received
  → Validate signature/auth
  → Parse and normalize payload
  → Call the appropriate service method
  → Service logs evidence to Supabase
  → Service fires the appropriate GHL trigger
  → Return 200 OK
```

This pattern is the same whether the webhook comes from GHL (Phase 2), Stripe (Phase 8), or a generic processor (Phase 8). Build the handler with a `processor` parameter from day one.

### Pattern 2: Evidence is JSONB

Evidence records use a `data JSONB` column for type-specific fields. This means new evidence types (bumps, external payments, imported history) can be added without schema migrations. The `evidence_type` field determines how to interpret the `data` blob.

### Pattern 3: Processor-Agnostic Payment Events

The `payment_events` table has a `processor` column from day one. Even though Phase 2-4 only handle GHL payments, the schema and service should accept a processor parameter. This avoids refactoring when Stripe and generic webhooks arrive in Phase 8.

### Pattern 4: Consent Token Links Everything

The `consent_token` is the thread connecting consent → payment → enrollment. It's generated during consent capture and must travel through the payment flow (as metadata on the GHL order, as a Stripe metadata field, as a URL parameter). Every payment handler must attempt to match by consent_token first, then fall back to email + offer + time window.

### Pattern 5: Trigger Keys Use ss_ Prefix

All trigger keys use the `ss_` prefix EXCEPT `enrollment_complete` (submitted to GHL before the prefix convention was established). The VALID_TRIGGER_KEYS constant in the codebase reflects this.

### Pattern 6: Services Never Send Communications

The app NEVER sends emails or SMS directly. It fires GHL triggers, and GHL workflows handle all communication. This keeps communication customizable by merchants and avoids the app needing email/SMS infrastructure.

### Pattern 7: Multi-Tenant from Day One

Every database query MUST filter by `location_id`. Every service method takes `locationId` as a parameter. There are no global queries. Even admin/debugging endpoints must scope to a merchant.

---

## WHAT THIS MEANS FOR EACH PHASE

### Phase 1 (Triggers)
- Establish the webhook handler pattern (validate → parse → process → respond)
- Use consistent Express route registration so Phase 2-9 endpoints plug in cleanly
- The trigger.service.ts becomes the model for how all services are structured

### Phase 2 (Enrollment + Payment)
- Build `enrollments` table WITHOUT bump columns but WITH the JSONB flexibility to add them later
- Build consent capture with `consent_token` generation — this same token system is reused in Phase 8
- Build payment webhook handler with a `processor` parameter even though it's only 'ghl' for now
- Build `payment_events` with the `processor` column from day one

### Phase 3 (Evidence)
- Build `evidence` table with JSONB `data` column — new evidence types plug in without migrations
- Build evidence.service with an `addEvidence(type, data)` pattern that's type-agnostic

### Phase 4 (Payment Lifecycle)
- Payment tracking must handle future multi-subscription scenarios (main + bump recurring)
- Store `subscription_id` on payment events even if we don't use it until Phase 5

### Phase 5 (Order Bumps)
- Adds columns to `offers` and `enrollments` via migrations
- Updates offer.service and enrollment.service — these services must be designed for extension
- Updates payment webhook handler to parse multiple line items

### Phase 8 (External Funnels)
- Adds new webhook routes (/webhooks/stripe, /webhooks/payment) alongside existing /webhooks/ghl/*
- Reuses consent.service.ts (same consent_token flow, different entry point)
- Adds product mapping layer between external product IDs and ScaleSafe offers

### Phase 9 (Migration)
- Adds entirely new tables and services — minimal impact on existing code
- Reuses evidence.service for imported Stripe history
- Reuses enrollment.service for migration-sourced enrollments

---

*End of Full Architecture Map v1.0*
