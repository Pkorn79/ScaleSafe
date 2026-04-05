# ScaleSafe — Phase A: Payment Infrastructure Foundation
## Claude Code Precision Prompt

---

## BEFORE YOU WRITE ANY CODE

### Step 0: Organize the workspace

The docs folder has accumulated old build prompts and plans that are now superseded. Organize as follows:

**Create `docs/archive/` folder and move these files into it:**
- `docs/CLAUDE_CODE_PHASE1_INSTRUCTIONS.md` (superseded by this prompt)
- `docs/CLAUDE_CODE_PHASE2_INSTRUCTIONS.md` (superseded by this prompt)
- `docs/CLAUDE_CODE_FIX_OAUTH_REINSTALL.md` (completed fix)
- `docs/ORDER_BUMP_BUILD_PLAN.md` (future phase, not needed now)
- `docs/EXISTING_FUNNEL_INTEGRATION_BUILD_PLAN.md` (superseded by Custom Payment Provider)
- `docs/PAYMENT_MIGRATION_BUILD_PLAN.md` (superseded — accept.blue migration no longer relevant)
- `docs/GHL_SNAPSHOT_PLAN.md` (future phase)
- `docs/PROJECT_STATUS_2026_03_31.md` (outdated status)
- `docs/MASTER_BUILD_SEQUENCE.md` (superseded by CUSTOM_PAYMENT_PROVIDER_BUILD_PLAN.md)
- `docs/CURSOR_CLAUDE_CODE_STRATEGY.md` (process doc, not build doc)
- `docs/GHL_MARKETPLACE_RESEARCH_AND_STRATEGY.md` (research, not build reference)
- `docs/PRODUCT_POSITIONING.md` (marketing, not build reference)

**Also move these from the root into `docs/archive/`:**
- `CLAUDE_CODE_PROMPT.md` (superseded by this prompt)
- `CLAUDE_CODE_FIX_OFFER_FORM_AND_TC.md` (completed fix)
- `CLAUDE_CODE_FIX_ROUND_2.md` (completed fix)
- `CLAUDE_CODE_BULLETPROOF_SNAPSHOT.md` (future phase)
- `CURSOR_AGENT_STALE_V1_AUDIT.md` (completed audit)
- `PROJECT_SETUP.md` (superseded)
- `scalasafe-primer.skill` (Cowork skill file, not for Claude Code)

**Move these root files into `docs/` (they are active references):**
- `CLAUDE_CODE_ENROLLMENT_FUNNEL.md` → `docs/ENROLLMENT_FUNNEL_PROMPT.md` (rename — still partially relevant for Pages 1-3)

**Keep in `docs/` (these are your active reference documents):**
- `SCALESAFE_APP_BLUEPRINT_v2.1.md` — master spec (READ FIRST)
- `FULL_ARCHITECTURE_MAP.md` — database schema + data flows
- `CUSTOM_PAYMENT_PROVIDER_BUILD_PLAN.md` — the build plan you're executing
- `STRIPE_DEFENSE_LAYER_SPEC.md` — Stripe defense layer (9 modules)
- `GHL_AUTOMATION_COMPANION.md` — GHL workflow/trigger reference
- `ghl-custom-fields-reference.md` — 352 custom field IDs
- `ghl-custom-values-reference.md` — custom value IDs + names
- `ghl-offers-custom-object-schema.md` — Offers object field keys
- `ENROLLMENT_FUNNEL_BUILD_PLAN.md` — enrollment funnel details (Pages 1-3 still valid)
- `ENROLLMENT_FUNNEL_PROMPT.md` — enrollment page implementation details

**Keep in root:**
- `CLAUDE.md` — your operating rules (READ THIS FIRST, always)

### Step 1: Read these documents IN THIS ORDER before writing any code

1. `CLAUDE.md` — operating rules, critical constraints, what NOT to do
2. `docs/CUSTOM_PAYMENT_PROVIDER_BUILD_PLAN.md` — the FULL build plan. You are executing **Phase A: Foundation**. Read the ENTIRE plan so you understand where Phase A fits.
3. `docs/FULL_ARCHITECTURE_MAP.md` — existing database schema designs (lines 140-244 especially: enrollments, evidence, payment_events tables)
4. `docs/SCALESAFE_APP_BLUEPRINT_v2.1.md` — master spec. Read sections on payment data flow (lines 625-698) and enrollment (lines 136-196)
5. `docs/STRIPE_DEFENSE_LAYER_SPEC.md` — Stripe defense module specs. Phase A creates the database tables these modules need.

---

## WHAT YOU ARE BUILDING: Phase A — Foundation

Phase A creates the database layer and processor abstraction that EVERYTHING else depends on. No UI. No API routes (except health check). Just schema + TypeScript interfaces + factory + config service.

### Architecture context you MUST understand:

**Dual-rail model:**
- **NMI = processing rail.** ScaleSafe processes payments through merchant's NMI account via GHL Custom Payment Provider.
- **Stripe = defense + optional processing rail.** ScaleSafe connects via Stripe Connect OAuth (direct charges, Stripe-owned loss liability, full merchant dashboard). Defense modules monitor ALL Stripe transactions. Stripe can also be used as checkout processor.

**Stripe Connect configuration (already set up):**
- Charge type: Direct (charges on merchant's Stripe account, not ScaleSafe's)
- Loss liability: Stripe (Stripe absorbs negative balances)
- Dashboard: Full (merchants keep their own Stripe dashboard)
- OAuth flow: `connect.stripe.com/oauth/authorize` → code exchange → access_token + stripe_user_id

**ProcessorInterface is ASYMMETRIC:**
- Both NMI and Stripe implement the same checkout interface (`charge`, `refund`, `saveCard`, etc.)
- Stripe has ADDITIONAL defense services (evidence vault, dispute management, Radar, etc.) that NMI does not
- The abstraction layer handles the symmetric checkout part. Stripe defense services are standalone.

---

## PHASE A DELIVERABLES

### A1. Database migrations (Supabase SQL)

Create migration files in `supabase/migrations/` with timestamp prefixes. Each migration must be idempotent (use IF NOT EXISTS).

**Table: `processor_configs`**
```sql
-- Stores processor credentials per merchant. Supports multiple NMI configs (multi-MID).
-- NMI: encrypted security_key + tokenization_key
-- Stripe: stripe_user_id + access_token + refresh_token from Connect OAuth
CREATE TABLE processor_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL,
  processor_type TEXT NOT NULL CHECK (processor_type IN ('nmi', 'stripe')),
  label TEXT, -- human-friendly name, e.g. "Main NMI Account" or "High-Ticket MID"

  -- NMI fields (encrypted)
  nmi_security_key_encrypted TEXT,
  nmi_tokenization_key TEXT, -- tokenization key is publishable, doesn't need encryption
  nmi_processor_id TEXT, -- for multi-MID routing

  -- Stripe Connect fields
  stripe_user_id TEXT, -- from OAuth: stripe_user_id (the connected account ID, starts with acct_)
  stripe_access_token_encrypted TEXT, -- from OAuth token exchange
  stripe_refresh_token_encrypted TEXT,
  stripe_publishable_key TEXT, -- from OAuth response
  stripe_token_expires_at TIMESTAMPTZ,
  stripe_webhook_endpoint_id TEXT, -- ID of the webhook endpoint registered on merchant's account

  is_active BOOLEAN DEFAULT true,
  is_default BOOLEAN DEFAULT false, -- only one per processor_type per merchant should be default
  last_verified_at TIMESTAMPTZ, -- last successful test connection
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(merchant_id, processor_type, nmi_processor_id) -- prevent duplicate MID configs
);

CREATE INDEX idx_processor_configs_merchant ON processor_configs(merchant_id);
CREATE INDEX idx_processor_configs_location ON processor_configs(location_id);
```

**Table: `payment_methods`**
```sql
-- Stored card references. Links GHL contact to NMI vault ID or Stripe payment method.
CREATE TABLE payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL,
  contact_id TEXT NOT NULL, -- GHL contact ID
  processor_type TEXT NOT NULL CHECK (processor_type IN ('nmi', 'stripe')),

  -- NMI Customer Vault
  nmi_customer_vault_id TEXT,

  -- Stripe
  stripe_customer_id TEXT,
  stripe_payment_method_id TEXT,

  -- Display info (safe to store — no raw card data)
  card_last_four TEXT,
  card_brand TEXT, -- visa, mastercard, amex, discover
  card_exp_month INTEGER,
  card_exp_year INTEGER,

  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_payment_methods_contact ON payment_methods(location_id, contact_id);
```

**Table: `payment_events`**
```sql
-- Transaction log. Every payment, refund, void, failure.
-- Schema from FULL_ARCHITECTURE_MAP.md lines 205-230, extended for dual-rail.
CREATE TABLE payment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id),
  location_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  enrollment_id UUID REFERENCES enrollments(id),

  event_type TEXT NOT NULL CHECK (event_type IN ('sale', 'auth', 'capture', 'void', 'refund', 'payment_failed', 'subscription_created', 'subscription_cancelled', 'subscription_payment')),
  processor TEXT NOT NULL CHECK (processor IN ('nmi', 'stripe', 'ghl')),

  -- Processor references
  processor_transaction_id TEXT, -- NMI transactionid or Stripe PaymentIntent ID
  processor_subscription_id TEXT, -- NMI subscription_id or Stripe Subscription ID

  -- Financial
  amount NUMERIC(10,2) NOT NULL,
  currency TEXT DEFAULT 'usd',

  -- Payment tracking (for installments)
  payment_number INTEGER,
  payments_total INTEGER,

  -- Failure info
  failure_reason TEXT,
  failure_code TEXT,
  attempt_count INTEGER DEFAULT 1,

  -- Evidence linkage
  consent_token TEXT, -- links payment to consent record
  evidence_id UUID, -- FK to evidence table once evidence is logged

  -- Forensics
  ip_address TEXT,
  device_info TEXT,
  browser_info TEXT,

  -- Raw data
  raw_webhook_payload JSONB,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_payment_events_enrollment ON payment_events(enrollment_id);
CREATE INDEX idx_payment_events_contact ON payment_events(location_id, contact_id);
CREATE INDEX idx_payment_events_processor_tx ON payment_events(processor_transaction_id);
CREATE INDEX idx_payment_events_consent ON payment_events(consent_token);
```

**Table: `dispute_events`** (for Stripe defense layer)
```sql
CREATE TABLE dispute_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id),
  location_id TEXT NOT NULL,
  contact_id TEXT,
  payment_event_id UUID REFERENCES payment_events(id),

  -- Stripe dispute fields
  stripe_dispute_id TEXT NOT NULL,
  stripe_charge_id TEXT,
  stripe_payment_intent_id TEXT,

  -- Dispute details
  reason TEXT, -- fraudulent, product_not_received, not_as_described, credit_not_processed, unrecognized, etc.
  status TEXT NOT NULL CHECK (status IN ('needs_response', 'under_review', 'won', 'lost', 'warning_closed', 'charge_refunded')),
  amount NUMERIC(10,2) NOT NULL,
  currency TEXT DEFAULT 'usd',

  -- Triage
  triage_score INTEGER, -- 0-100, computed by stripe-dispute.service
  triage_recommendation TEXT CHECK (triage_recommendation IN ('fight', 'review', 'accept')),

  -- Evidence
  evidence_submitted BOOLEAN DEFAULT false,
  evidence_submitted_at TIMESTAMPTZ,
  evidence_auto_submitted BOOLEAN DEFAULT false,

  -- Deadlines
  evidence_due_by TIMESTAMPTZ,
  alert_t7_sent BOOLEAN DEFAULT false,
  alert_t3_sent BOOLEAN DEFAULT false,
  alert_t1_sent BOOLEAN DEFAULT false,

  -- Outcome
  outcome TEXT, -- won, lost
  outcome_at TIMESTAMPTZ,
  net_financial_impact NUMERIC(10,2), -- negative = loss, positive = recovery

  -- Network info
  card_network TEXT, -- visa, mastercard, amex, discover
  is_ce30_eligible BOOLEAN DEFAULT false,

  raw_dispute_object JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_dispute_events_merchant ON dispute_events(merchant_id);
CREATE INDEX idx_dispute_events_stripe ON dispute_events(stripe_dispute_id);
CREATE INDEX idx_dispute_events_status ON dispute_events(status);
```

**Table: `dispute_evidence_files`**
```sql
CREATE TABLE dispute_evidence_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_event_id UUID NOT NULL REFERENCES dispute_events(id) ON DELETE CASCADE,
  merchant_id UUID NOT NULL REFERENCES merchants(id),

  stripe_file_id TEXT NOT NULL, -- Stripe File object ID (file_xxx)
  file_purpose TEXT DEFAULT 'dispute_evidence',
  file_type TEXT, -- contract, session_log, communication, terms, other
  description TEXT,

  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_evidence_files_dispute ON dispute_evidence_files(dispute_event_id);
```

**Table: `account_health_snapshots`**
```sql
CREATE TABLE account_health_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id),
  location_id TEXT NOT NULL,
  processor TEXT NOT NULL CHECK (processor IN ('stripe', 'nmi')),

  -- Dispute rates
  dispute_rate_visa NUMERIC(6,4), -- e.g., 0.0065 = 0.65%
  dispute_rate_mastercard NUMERIC(6,4),
  dispute_rate_overall NUMERIC(6,4),

  -- Counts (rolling 30 days)
  transaction_count INTEGER,
  dispute_count INTEGER,
  efw_count INTEGER,

  -- Rates
  efw_rate NUMERIC(6,4),
  recovery_rate NUMERIC(6,4), -- disputes_won / disputes_fought
  evidence_completeness NUMERIC(5,2), -- percentage 0-100

  -- Financial
  financial_exposure NUMERIC(12,2), -- sum of open dispute amounts

  -- Thresholds
  visa_alert_level TEXT CHECK (visa_alert_level IN ('healthy', 'warning', 'early_warning', 'program')),
  mastercard_alert_level TEXT CHECK (mastercard_alert_level IN ('healthy', 'warning', 'program')),

  -- WholePay upgrade trigger
  upgrade_prompt_eligible BOOLEAN DEFAULT false,

  snapshot_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(merchant_id, processor, snapshot_date)
);

CREATE INDEX idx_health_snapshots_merchant ON account_health_snapshots(merchant_id, snapshot_date);
```

**Table: `efw_events`**
```sql
CREATE TABLE efw_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id),
  location_id TEXT NOT NULL,

  stripe_efw_id TEXT NOT NULL,
  stripe_charge_id TEXT,
  stripe_payment_intent_id TEXT,

  fraud_type TEXT, -- made_with_stolen_card, made_with_counterfeit_card, etc.
  amount NUMERIC(10,2),

  -- Response
  action_taken TEXT CHECK (action_taken IN ('pending', 'refunded', 'held', 'ignored')),
  action_taken_at TIMESTAMPTZ,
  auto_action BOOLEAN DEFAULT false,

  -- Context
  evidence_score INTEGER, -- triage score at time of EFW
  dispute_rate_at_time NUMERIC(6,4),

  raw_efw_object JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_efw_events_merchant ON efw_events(merchant_id);
```

**Table: `stripe_radar_lists`**
```sql
CREATE TABLE stripe_radar_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id UUID NOT NULL REFERENCES merchants(id),
  location_id TEXT NOT NULL,

  list_alias TEXT NOT NULL, -- e.g., 'scalesafe_blocked_cards', 'scalesafe_verified_customers'
  stripe_value_list_id TEXT NOT NULL, -- Stripe Value List ID (rsl_xxx)
  item_type TEXT NOT NULL, -- card_fingerprint, email, ip_address, etc.
  item_count INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(merchant_id, list_alias)
);
```

**ALTER existing tables:**
```sql
-- Add payment infrastructure columns to merchants
ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS default_processor TEXT CHECK (default_processor IN ('nmi', 'stripe')),
  ADD COLUMN IF NOT EXISTS stripe_connected BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_user_id TEXT,
  ADD COLUMN IF NOT EXISTS payment_provider_registered BOOLEAN DEFAULT false;

-- Add processor override to offers_mirror
ALTER TABLE offers_mirror
  ADD COLUMN IF NOT EXISTS processor_override TEXT CHECK (processor_override IN ('nmi', 'stripe')),
  ADD COLUMN IF NOT EXISTS nmi_processor_id TEXT;
```

**IMPORTANT:** Check that the `merchants` table and `offers_mirror` table and `enrollments` table EXIST before running ALTER statements. If they don't exist yet, create them per the schema in `docs/FULL_ARCHITECTURE_MAP.md`. The migration must be runnable on a fresh database.

---

### A2. TypeScript interfaces and types

**Create `src/types/processor.types.ts`:**
```typescript
// Processor type enum
export type ProcessorType = 'nmi' | 'stripe';

// Charge request (used by checkout page → backend)
export interface ChargeRequest {
  amount: number; // in cents
  currency: string; // 'usd'
  paymentToken: string; // NMI payment_token from Collect.js OR Stripe PaymentMethod ID
  customerId?: string; // for returning customers
  description?: string;
  metadata?: Record<string, string>; // ScaleSafe metadata (offer_id, consent_token, etc.)
  statementDescriptorSuffix?: string; // max 22 chars total
  requestThreeDSecure?: boolean; // Stripe only
  processorId?: string; // NMI multi-MID routing
}

// Charge result
export interface ChargeResult {
  success: boolean;
  transactionId: string; // NMI transactionid or Stripe PaymentIntent ID
  chargeId?: string; // Stripe charge ID (for dispute reference)
  amount: number;
  currency: string;
  status: 'approved' | 'declined' | 'error' | 'pending_3ds';
  errorMessage?: string;
  errorCode?: string;
  avsResponse?: string;
  cvvResponse?: string;
  threeDSecureUrl?: string; // if 3DS redirect needed (Stripe)
  rawResponse?: Record<string, any>;
}

// Refund request
export interface RefundRequest {
  transactionId: string;
  amount?: number; // partial refund amount in cents. If omitted, full refund.
  reason?: string;
}

export interface RefundResult {
  success: boolean;
  refundId: string;
  amount: number;
  status: 'refunded' | 'pending' | 'failed';
  errorMessage?: string;
}

// Saved card operations
export interface SaveCardRequest {
  paymentToken: string;
  contactId: string; // GHL contact ID
  customerEmail: string;
  customerName?: string;
}

export interface SaveCardResult {
  success: boolean;
  paymentMethodId: string; // NMI vault ID or Stripe PaymentMethod ID
  customerId: string; // NMI vault customer_id or Stripe Customer ID
  cardLastFour: string;
  cardBrand: string;
  cardExpMonth: number;
  cardExpYear: number;
}

export interface StoredCard {
  paymentMethodId: string;
  customerId: string;
  cardLastFour: string;
  cardBrand: string;
  cardExpMonth: number;
  cardExpYear: number;
  isDefault: boolean;
}

// Subscription operations
export interface CreateSubscriptionRequest {
  paymentMethodId: string; // stored card reference
  customerId: string;
  planAmount: number; // in cents
  interval: 'weekly' | 'biweekly' | 'monthly';
  totalPayments: number;
  startDate?: string; // ISO date, default now
  description?: string;
  metadata?: Record<string, string>;
}

export interface SubscriptionResult {
  success: boolean;
  subscriptionId: string;
  status: 'active' | 'pending' | 'failed';
  nextPaymentDate?: string;
  errorMessage?: string;
}

// Verify transaction
export interface VerifyResult {
  success: boolean;
  transactionId: string;
  status: 'settled' | 'pending' | 'failed' | 'voided' | 'refunded';
  amount: number;
  settledAt?: string;
}
```

**Create `src/interfaces/processor.interface.ts`:**
```typescript
import {
  ChargeRequest, ChargeResult,
  RefundRequest, RefundResult,
  SaveCardRequest, SaveCardResult, StoredCard,
  CreateSubscriptionRequest, SubscriptionResult,
  VerifyResult
} from '../types/processor.types';

/**
 * ProcessorInterface — implemented by both NMI and Stripe clients.
 * All amounts are in CENTS (integer). Convert to dollars only at display layer.
 * All methods are async. All throw ProcessorError on unrecoverable failure.
 */
export interface ProcessorInterface {
  readonly processorType: 'nmi' | 'stripe';

  /** Process a one-time charge using a payment token from the checkout page */
  charge(request: ChargeRequest): Promise<ChargeResult>;

  /** Refund a transaction (full or partial) */
  refund(request: RefundRequest): Promise<RefundResult>;

  /** Save a card for future use (NMI Customer Vault / Stripe Customer + PaymentMethod) */
  saveCard(request: SaveCardRequest): Promise<SaveCardResult>;

  /** List saved cards for a customer */
  listCards(customerId: string): Promise<StoredCard[]>;

  /** Charge a stored card (off-session, for recurring or manual charges) */
  chargeStoredCard(customerId: string, paymentMethodId: string, request: ChargeRequest): Promise<ChargeResult>;

  /** Create a recurring subscription */
  createSubscription(request: CreateSubscriptionRequest): Promise<SubscriptionResult>;

  /** Cancel a subscription */
  cancelSubscription(subscriptionId: string): Promise<{ success: boolean; errorMessage?: string }>;

  /** Verify/retrieve a transaction's current status */
  verifyTransaction(transactionId: string): Promise<VerifyResult>;

  /** Test the connection with a lightweight API call (used by "Test Connection" button) */
  testConnection(): Promise<{ success: boolean; message: string }>;
}
```

**Create `src/errors/processor.error.ts`:**
```typescript
export class ProcessorError extends Error {
  constructor(
    message: string,
    public readonly processor: 'nmi' | 'stripe',
    public readonly code?: string,
    public readonly isRetryable: boolean = false,
    public readonly rawError?: any
  ) {
    super(message);
    this.name = 'ProcessorError';
  }
}
```

---

### A3. Processor Factory

**Create `src/services/processor.factory.ts`:**

The factory resolves which processor client to use for a given merchant + offer combination:
1. Check if the offer has a `processor_override` → use that
2. Otherwise, use the merchant's `default_processor`
3. If neither is set, check which processors are connected → use the only one
4. If both connected and no default, throw a config error

For NMI, also resolve the `nmi_processor_id` (MID routing):
1. Check if the offer has `nmi_processor_id` set → use that
2. Otherwise, use the default NMI config for the merchant

The factory returns an instance of `ProcessorInterface` (either NmiClient or StripeClient) configured with the correct credentials for that merchant.

---

### A4. Processor Config Service

**Create `src/services/processor-config.service.ts`:**

CRUD for processor credentials in Supabase. Must handle:
- **NMI:** Encrypt `security_key` before storing. `tokenization_key` is publishable (no encryption needed). Validate by making a test API call.
- **Stripe Connect:** Store `access_token` (encrypted), `refresh_token` (encrypted), `stripe_user_id`, `publishable_key`. Token refresh logic. Validate by calling Stripe API.
- **Encryption:** Use AES-256-GCM. Encryption key from `PROCESSOR_ENCRYPTION_KEY` environment variable. Never log decrypted keys.
- **Multi-NMI:** A merchant can have multiple NMI configs (different MIDs). Each has a unique `nmi_processor_id`. Only one can be `is_default = true`.
- **Single Stripe:** A merchant has at most one Stripe Connect config.

---

### A5. Update CLAUDE.md

After building Phase A, update the `CLAUDE.md` file at the project root:

**Replace this line:**
> **Critical architecture rule:** ScaleSafe NEVER processes payments.

**With:**
> **Payment architecture:** ScaleSafe processes payments through merchant's connected NMI or Stripe accounts via GHL Custom Payment Provider. ScaleSafe never holds funds — transactions settle directly to the merchant's processor account. NMI is the processing rail. Stripe is the defense + optional processing rail (connected via Stripe Connect OAuth with direct charges).

**Add to the "Key Architecture" section:**
> ### Payment Processing (Custom Payment Provider)
> - `processor_configs` table — NMI credentials (encrypted) + Stripe Connect tokens per merchant
> - `ProcessorInterface` — shared checkout interface (charge, refund, saveCard, etc.)
> - `ProcessorFactory` — resolves merchant + offer → correct processor client
> - `nmi.client.ts` — NMI Collect.js + transact.php + Customer Vault (Phase B)
> - `stripe.client.ts` — Stripe Payment Intents + Elements + Connect (Phase C)
> - Stripe Defense Layer — 9 modules for evidence, disputes, Radar, health monitoring (Phases S1-S4)

---

## VERIFICATION CHECKLIST

Before marking Phase A complete, verify:

1. `npx tsc --noEmit` — zero TypeScript errors
2. All migrations run successfully against a fresh Supabase database
3. `ProcessorInterface` has all 9 methods defined
4. `ProcessorFactory` correctly resolves processor from offer → merchant → default
5. `processor-config.service.ts` can encrypt/decrypt a test key
6. `processor-config.service.ts` enforces: only one default per processor_type per merchant
7. All tables have proper indexes and foreign keys
8. No secrets in the codebase (encryption key comes from env var)
9. `CLAUDE.md` updated with new payment architecture rule

---

## WHAT COMES NEXT (do NOT build these yet)

- **Phase B:** `nmi.client.ts` — full NMI transaction processing
- **Phase C:** `stripe.client.ts` + `stripe-connect.service.ts` — Stripe checkout + OAuth
- **Phase D:** GHL provider registration + queryUrl backend
- **Phase E:** Checkout page (paymentsUrl iframe)
- **Phases S1-S4:** Stripe defense layer modules

Full build plan: `docs/CUSTOM_PAYMENT_PROVIDER_BUILD_PLAN.md`
