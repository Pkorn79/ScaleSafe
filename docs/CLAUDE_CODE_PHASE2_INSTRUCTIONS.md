# Claude Code Instructions — Phase 2: Enrollment + Payment Webhooks

**Context:** Read these docs before writing any code:
1. **FULL_ARCHITECTURE_MAP.md** — The complete system map. Phase 2 tables and services are detailed there. Build with future phases in mind (bumps in Phase 5, external processors in Phase 8, migration in Phase 9).
2. **SCALESAFE_APP_BLUEPRINT_v2.1.md** — Section 3 covers the enrollment flow in detail.
3. **MASTER_BUILD_SEQUENCE.md** — Phase 2 overview and dependencies.

**Phase 1 is complete.** trigger.service.ts, trigger.repository.ts, trigger.controller.ts, and the /webhooks/ghl/triggers route all exist and are tested (93 tests passing). You MUST use `triggerService.fireTrigger()` to fire triggers — do NOT create a new trigger mechanism.

**What you're building:** The enrollment backend and payment webhook handler — the pieces that make a client able to consent, pay, and become enrolled. After Phase 2, the full funnel works: client fills out form → consents to T&C → pays → enrollment record created → evidence logged → GHL workflow fires.

---

## WHAT TO BUILD

### 1. Supabase Migration: enrollments table

```sql
CREATE TABLE IF NOT EXISTS enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  offer_id UUID REFERENCES offers(id),
  merchant_id UUID REFERENCES merchants(id),

  status TEXT NOT NULL DEFAULT 'pending',
  -- Lifecycle: 'pending' → 'consent_captured' → 'enrolled' → 'active' →
  --            'at_risk' → 'cancelled' OR 'completed'

  -- Consent data (captured on Page 3)
  consent_token TEXT UNIQUE,
  consent_captured_at TIMESTAMPTZ,
  consent_ip TEXT,
  consent_device TEXT,
  consent_browser TEXT,
  tc_version_hash TEXT,

  -- Payment data (populated by payment webhook)
  payment_amount DECIMAL(10,2),
  payment_type TEXT,                 -- 'pif' or 'installment'
  payment_transaction_id TEXT,
  payments_made INTEGER DEFAULT 0,
  payments_total INTEGER,            -- null = ongoing, number = fixed installments

  -- Pipeline tracking
  pipeline_opportunity_id TEXT,
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
);

CREATE INDEX idx_enrollments_location ON enrollments(location_id);
CREATE INDEX idx_enrollments_contact ON enrollments(contact_id);
CREATE INDEX idx_enrollments_offer ON enrollments(offer_id);
CREATE INDEX idx_enrollments_consent_token ON enrollments(consent_token);
CREATE INDEX idx_enrollments_status ON enrollments(location_id, status);
```

**IMPORTANT — Future-proofing notes (DO NOT build these columns yet, but DO NOT design in a way that prevents them):**
- Phase 5 adds: bump_1_accepted, bump_1_name, bump_1_amount, bump_2_accepted, bump_2_name, bump_2_amount, total_with_bumps
- Phase 9 adds: migration_source, migration_record_id

### 2. Supabase Migration: evidence table

```sql
CREATE TABLE IF NOT EXISTS evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  enrollment_id UUID REFERENCES enrollments(id),
  merchant_id UUID REFERENCES merchants(id),

  evidence_type TEXT NOT NULL,
  -- Phase 2 types: 'enrollment_consent', 'enrollment_payment'
  -- Phase 3 adds: 'session_attended', 'session_noshow', 'module_completed',
  --   'milestone_reached', 'milestone_signedoff', 'pulse_check',
  --   'payment_received', 'payment_failed', 'cancellation_request',
  --   'communication_sent', 'reengagement_attempt'
  -- Phase 5 adds: 'enrollment_bump'
  -- Phase 8 adds: 'payment_external_initial', etc.
  -- Phase 9 adds: 'payment_history_import', 'migration_completed'

  data JSONB NOT NULL DEFAULT '{}',

  ip_address TEXT,
  device_info TEXT,
  browser_info TEXT,

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_evidence_enrollment ON evidence(enrollment_id);
CREATE INDEX idx_evidence_location ON evidence(location_id);
CREATE INDEX idx_evidence_contact ON evidence(contact_id);
CREATE INDEX idx_evidence_type ON evidence(evidence_type);
```

### 3. Supabase Migration: payment_events table

```sql
CREATE TABLE IF NOT EXISTS payment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  enrollment_id UUID REFERENCES enrollments(id),

  event_type TEXT NOT NULL,          -- 'payment_success', 'payment_failed', 'refund'
  processor TEXT NOT NULL DEFAULT 'ghl',
  -- Phase 8 adds: 'stripe', 'samcart', 'generic'

  processor_transaction_id TEXT,
  amount DECIMAL(10,2) NOT NULL,
  currency TEXT DEFAULT 'usd',

  payment_number INTEGER,
  payments_remaining INTEGER,

  failure_reason TEXT,
  attempt_count INTEGER DEFAULT 1,

  raw_webhook_payload JSONB,

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_payment_events_enrollment ON payment_events(enrollment_id);
CREATE INDEX idx_payment_events_location ON payment_events(location_id);
CREATE INDEX idx_payment_events_processor_txn ON payment_events(processor, processor_transaction_id);
```

**IMPORTANT:** Include the `processor` column NOW even though Phase 2 only handles 'ghl'. This avoids a migration later. Every payment_events query should include processor in the WHERE clause as a habit.

---

### 4. Enrollment Repository: `enrollment.repository.ts`

Standard CRUD following the pattern from trigger.repository.ts:
- `create(data)` → insert enrollment, return record
- `findById(id)` → get single enrollment
- `findByConsentToken(token)` → lookup by consent_token (used to link payment to consent)
- `findByContactAndOffer(contactId, offerId, locationId)` → fallback matching
- `updateStatus(id, status, additionalData?)` → update status + optional fields
- `listByLocation(locationId, filters?)` → list with optional status filter

### 5. Evidence Repository: `evidence.repository.ts`

- `create(data)` → insert evidence record
- `findByEnrollment(enrollmentId)` → list all evidence for an enrollment
- `findByType(enrollmentId, evidenceType)` → filter by type
- `countByEnrollment(enrollmentId)` → count for defense readiness

### 6. Payment Event Repository: `paymentEvent.repository.ts`

- `create(data)` → insert payment event
- `findByEnrollment(enrollmentId)` → list payments for enrollment
- `findByTransactionId(processor, transactionId)` → idempotency check (don't double-process same webhook)

---

### 7. Consent Service: `consent.service.ts`

Handles consent capture from Page 3 of the enrollment funnel.

```typescript
async captureConsent(params: {
  offerId: string;
  locationId: string;
  contactId: string;      // GHL contact ID (created on Page 1)
  contactEmail: string;
  contactName: string;
  ip: string;
  device: string;
  browser: string;
  tcVersionHash: string;
  signatureText: string;  // Typed signature
}): Promise<{ consentToken: string; enrollmentId: string }>
```

**What it does:**
1. Generate a consent_token (crypto.randomUUID())
2. Create an enrollment record with status 'consent_captured', consent data populated, consent_token set
3. Log evidence: type 'enrollment_consent', data contains all consent forensics:
   ```json
   {
     "signature_text": "John Smith",
     "tc_version_hash": "abc123",
     "consent_checkboxes": ["terms_accepted", "refund_policy_accepted"],
     "timestamp": "2026-03-30T14:30:00Z",
     "page_url": "https://..../enrollment?offerId=xxx"
   }
   ```
4. Return the consent_token and enrollment ID

**The consent_token is CRITICAL.** It's the thread that links consent → payment → enrollment. The payment webhook handler uses it to match an incoming payment to a consent event.

### 8. Enrollment Service: `enrollment.service.ts`

Handles enrollment completion after payment succeeds.

```typescript
async completeEnrollment(params: {
  enrollmentId: string;
  locationId: string;
  contactId: string;
  paymentAmount: number;
  paymentType: string;         // 'pif' or 'installment'
  transactionId: string;
  paymentsTotal: number | null; // null for PIF, number for installments
}): Promise<void>
```

**What it does:**
1. Update enrollment: status → 'enrolled', payment fields populated, enrolled_at = now()
2. Log evidence: type 'enrollment_payment', data contains payment details + transaction ID
3. Create a payment_events record (event_type: 'payment_success', processor: 'ghl')
4. Fire trigger: `triggerService.fireTrigger(locationId, 'enrollment_complete', payload)`
   - Payload: contact_id, offer_id, offer_name (fetched from offer record), amount, payment_type, bump_1_accepted: false, bump_2_accepted: false
   - NOTE: bump fields default to false for now. Phase 5 will populate them.

```typescript
async getEnrollmentDetails(enrollmentId: string, locationId: string): Promise<EnrollmentWithEvidence>
```

Returns enrollment + all evidence records + payment events. Used by dashboard and defense compiler.

### 9. Consent Capture Endpoint: POST /api/enrollment/consent

Called by JavaScript on enrollment funnel Page 3 when the client accepts T&C.

**Request body:**
```json
{
  "offerId": "uuid",
  "contactId": "ghl_contact_id",
  "contactEmail": "client@email.com",
  "contactName": "John Smith",
  "tcVersionHash": "sha256_of_tc_html",
  "signatureText": "John Smith",
  "consentCheckboxes": ["terms_accepted", "refund_policy_accepted"]
}
```

**What this endpoint does:**
1. Validate: offerId exists, contactId not empty
2. Extract IP from request headers (x-forwarded-for or req.ip)
3. Extract device/browser from User-Agent header
4. Call consent.service.captureConsent()
5. Return: `{ success: true, consentToken: "xxx", enrollmentId: "yyy" }`

**Auth:** This is a PUBLIC endpoint (called from a GHL funnel page via JavaScript). No merchant auth. But validate that the offerId belongs to a valid, active offer.

**Rate limit:** Limit to 10 requests per IP per minute to prevent abuse.

### 10. GHL Payment Webhook Handler: POST /webhooks/ghl/payment

This endpoint ALREADY EXISTS as a stub. Flesh it out to handle real GHL payment webhooks.

**GHL sends these webhook events:**
- `OrderCompleted` — one-time or first payment of a subscription
- `SubscriptionPaymentSuccess` — recurring payment succeeded
- `SubscriptionPaymentFailed` — recurring payment failed
- `OrderRefunded` — refund processed

**For OrderCompleted (enrollment payment):**

1. Parse the webhook payload — extract:
   - contactId (from contact object)
   - locationId (from location object)
   - amount (total charged)
   - transactionId
   - line items (array of products purchased) — **Parse ALL line items, not just the first.** Phase 5 bumps will add additional line items.
   - Payment metadata — look for consent_token in metadata or custom fields

2. Match to a pending enrollment:
   - **Primary match:** consent_token from payment metadata → enrollmentRepository.findByConsentToken()
   - **Fallback match:** contactId + offerId (from line item product mapping) + status='consent_captured' → enrollmentRepository.findByContactAndOffer()
   - **If no match:** Log a warning but do NOT fail. Create a payment_event record with enrollment_id=null. This could be a payment for a non-ScaleSafe product.

3. If match found: call enrollmentService.completeEnrollment()

4. Return 200 OK immediately. Always return 200 to GHL even if processing fails internally (log the error). GHL will retry on non-200 responses and we don't want duplicate processing.

**For SubscriptionPaymentSuccess (recurring installment):**

1. Parse webhook — extract contactId, locationId, amount, transactionId, subscription details
2. Find the enrollment by contactId + offerId (match product from subscription)
3. Create payment_event record (event_type: 'payment_success', payment_number, payments_remaining)
4. Update enrollment: payments_made += 1
5. Log evidence: type 'payment_received'
6. Fire trigger: `triggerService.fireTrigger(locationId, 'ss_payment_received', { contact_id, amount, transaction_id, payments_remaining, running_total })`

**For SubscriptionPaymentFailed:**

1. Parse webhook — extract contactId, locationId, amount, failure reason
2. Find enrollment
3. Create payment_event record (event_type: 'payment_failed', failure_reason, attempt_count)
4. Log evidence: type 'payment_failed'
5. Fire trigger: `triggerService.fireTrigger(locationId, 'ss_payment_failed', { contact_id, amount, failure_reason, attempt_count, next_retry_date })`

**For OrderRefunded:**

1. Parse webhook — extract contactId, locationId, refund amount, original transaction
2. Find enrollment
3. Create payment_event record (event_type: 'refund')
4. Log evidence: type 'refund_processed'
5. Fire trigger: `triggerService.fireTrigger(locationId, 'ss_refund_processed', { contact_id, amount, refund_type, reason })`

**IDEMPOTENCY:** Before processing ANY webhook, check paymentEventRepository.findByTransactionId(). If a record already exists for this transaction, skip processing and return 200. GHL may send duplicate webhooks.

### 11. Enrollment List Endpoint: GET /api/enrollments

**Auth:** Merchant auth required (from SSO session). Scoped to merchant's location_id.

**Query params:** status (optional filter), page, limit

**Returns:** List of enrollments with basic offer info (name, amount). Used by dashboard.

### 12. Enrollment Detail Endpoint: GET /api/enrollments/:id

**Auth:** Merchant auth required. Verify enrollment belongs to merchant's location_id.

**Returns:** Full enrollment record + all evidence records + all payment events. Used by dashboard detail view and eventually by defense compiler.

---

## WHAT NOT TO DO

- Do NOT build form webhook handling (SYS2-07 through SYS2-11) — that's Phase 3
- Do NOT build milestone tracking — Phase 3
- Do NOT build risk scoring or disengagement detection — Phase 3
- Do NOT build dunning logic (consecutive failure tracking, escalation) — Phase 4
- Do NOT build cancellation handling — Phase 4
- Do NOT build bump columns or bump parsing — Phase 5. BUT parse ALL line items in the webhook and log them. Just don't try to match bumps to offers yet.
- Do NOT build defense compilation — Phase 6
- Do NOT build Stripe or generic webhook handlers — Phase 8
- Do NOT send emails or SMS from the app — the app fires triggers, GHL workflows handle comms
- Do NOT create GHL pipeline opportunities from the app — GHL workflows handle that via the enrollment_complete trigger
- Do NOT hardcode 'ghl' as the only processor — use the processor column/parameter even though it's the only value for now

---

## WHAT TO VERIFY BEFORE BUILDING

1. **Check existing offer.service.ts** — understand how offers are created and stored. The enrollment and payment webhook need to look up offers by their GHL product_id.
2. **Check existing webhook.routes.ts** — the /webhooks/ghl/payment route already exists as a stub. Flesh it out, don't create a duplicate.
3. **Check the existing auth middleware** — understand how merchant auth works so enrollment list/detail endpoints use the same pattern.
4. **Check how the existing /enrollment page works** — it already renders offer details. The consent capture endpoint needs to work with whatever Page 3 JavaScript will call it.
5. **Follow the exact same repository → service → controller pattern** established in Phase 1 (trigger.repository → trigger.service → trigger.controller).

---

## GHL PAYMENT WEBHOOK PAYLOAD REFERENCE

GHL's payment webhook sends payloads like this. DO NOT guess at field names — use these:

**OrderCompleted:**
```json
{
  "type": "OrderCompleted",
  "locationId": "abc123",
  "contactId": "contact_xyz",
  "orderId": "order_123",
  "amount": 2997.00,
  "currency": "USD",
  "source": "funnel",
  "items": [
    {
      "productId": "prod_abc",
      "priceId": "price_xyz",
      "name": "12-Week Coaching Program",
      "amount": 2997.00,
      "quantity": 1
    }
  ],
  "subscription": {
    "id": "sub_123",
    "status": "active",
    "interval": "month",
    "intervalCount": 1
  },
  "metadata": {}
}
```

**IMPORTANT:** The exact GHL webhook payload format may vary. Before building the handler, make a test purchase in GHL and inspect the actual webhook payload. Log the raw payload on every webhook hit so you can debug field mapping issues. Store raw_webhook_payload on every payment_event record.

**If you cannot make a test purchase:** Build the handler to log the full raw payload first, then parse known fields. Add a TODO for field mapping verification once a real webhook is received.

---

## WHAT SUCCESS LOOKS LIKE

1. Three new Supabase tables: enrollments, evidence, payment_events
2. Consent capture endpoint works: POST /api/enrollment/consent creates enrollment + evidence + returns consent_token
3. Payment webhook handler processes all 4 event types (OrderCompleted, SubscriptionPaymentSuccess, SubscriptionPaymentFailed, OrderRefunded)
4. Payment webhook matches to enrollment via consent_token (primary) or contactId+offerId (fallback)
5. Enrollment completion fires the `enrollment_complete` trigger
6. Recurring payments fire `ss_payment_received` trigger
7. Failed payments fire `ss_payment_failed` trigger
8. Refunds fire `ss_refund_processed` trigger
9. Idempotency: duplicate webhooks don't create duplicate records
10. GET /api/enrollments and GET /api/enrollments/:id return correct data with auth
11. All new tests pass. All existing 93 tests still pass.

---

## FILES TO CREATE/MODIFY

**New files (expected):**
- supabase/migrations/009_enrollments.sql
- supabase/migrations/010_evidence.sql
- supabase/migrations/011_payment_events.sql
- src/repositories/enrollment.repository.ts
- src/repositories/evidence.repository.ts
- src/repositories/paymentEvent.repository.ts
- src/services/consent.service.ts
- src/services/enrollment.service.ts
- src/controllers/enrollment.controller.ts
- tests/unit/consent.service.test.ts
- tests/unit/enrollment.service.test.ts
- tests/unit/enrollment.controller.test.ts
- tests/integration/enrollment.integration.test.ts

**Existing files to modify:**
- src/routes/webhook.routes.ts — flesh out /ghl/payment handler
- src/controllers/webhook.controller.ts — implement ghlPayment method
- src/routes/index.ts — register enrollment routes

---

*Phase 2 complete when: consent capture works, payment webhook processes all event types, enrollment completion fires triggers, and enrollment list/detail endpoints return data. Then move to Phase 3 (evidence collection from forms + milestones).*
