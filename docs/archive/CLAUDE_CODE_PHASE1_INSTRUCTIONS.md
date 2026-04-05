# Claude Code Instructions — Phase 1: Trigger Infrastructure

**Context:** You are building ScaleSafe v2.1, a GHL Marketplace app. Before writing any code, read these docs in order:
1. **FULL_ARCHITECTURE_MAP.md** — CRITICAL. Shows every table, endpoint, and service that will eventually exist. You MUST build Phase 1 with this full picture in mind so later features plug in cleanly.
2. **SCALESAFE_APP_BLUEPRINT_v2.1.md** — Full v2.1 spec.
3. **MASTER_BUILD_SEQUENCE.md** — Overall phased plan.

This is Phase 1.

**What you're building:** The system that lets ScaleSafe fire custom workflow triggers into GHL, so merchants' GHL workflows can react to ScaleSafe events (enrollment complete, payment received, etc.).

**Why the architecture map matters for Phase 1:** The webhook handler pattern, service structure, and route organization you establish NOW will be the template for 8 more phases. Build it clean.

---

## WHAT TO BUILD

### 1. Supabase Table: `trigger_subscriptions`

```sql
CREATE TABLE trigger_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id TEXT NOT NULL,
  trigger_key TEXT NOT NULL,
  subscription_url TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_trigger_subs_location_key ON trigger_subscriptions(location_id, trigger_key);
CREATE UNIQUE INDEX idx_trigger_subs_unique ON trigger_subscriptions(location_id, trigger_key, subscription_url);
```

This table stores which GHL workflows are listening for which triggers at which merchant location.

### 2. Trigger Subscription Endpoint: POST /webhooks/ghl/triggers

GHL calls this endpoint when a merchant adds or removes a ScaleSafe trigger from a GHL workflow. This is part of GHL's Custom Trigger Lifecycle.

**Request from GHL (subscription created):**
```json
{
  "type": "subscribe",
  "locationId": "abc123",
  "triggerKey": "enrollment_complete",
  "subscriptionUrl": "https://services.leadconnectorhq.com/hooks/...",
  "workflowId": "wf_xxx"
}
```

**Request from GHL (subscription removed):**
```json
{
  "type": "unsubscribe",
  "locationId": "abc123",
  "triggerKey": "enrollment_complete",
  "subscriptionUrl": "https://services.leadconnectorhq.com/hooks/..."
}
```

**What to do:**
- On "subscribe": upsert into trigger_subscriptions (location_id, trigger_key, subscription_url, is_active=true)
- On "unsubscribe": set is_active=false for matching record
- Return 200 OK with `{ "success": true }`
- Log every subscription event for debugging

**IMPORTANT:** The subscription_url is a GHL-internal URL. When we fire a trigger, we POST the event payload TO this URL. We don't construct it — GHL gives it to us.

### 3. Trigger Firing Service: `trigger.service.ts`

```typescript
// Method signature
async fireTrigger(locationId: string, triggerKey: string, payload: Record<string, any>): Promise<void>
```

**What it does:**
1. Query trigger_subscriptions for all active subscriptions matching locationId + triggerKey
2. For each subscription: POST the payload to subscription_url
3. Retry logic: 3 attempts with exponential backoff (1s, 5s, 30s) on failure
4. Log every trigger fire (success or failure) — include locationId, triggerKey, subscription count, response status

**The payload format GHL expects:**
```json
{
  "contact_id": "ghl_contact_id",
  "offer_id": "uuid",
  "offer_name": "12-Week Coaching Program",
  "amount": 2997.00,
  "payment_type": "pif"
}
```

The specific fields vary per trigger (enrollment_complete has different fields than payment_failed). The calling service builds the payload — the trigger service just delivers it.

**DO NOT** create any triggers in the GHL Marketplace portal. That's Philip's manual task. This code only handles the subscription lifecycle and firing.

### 4. Valid Trigger Keys (for validation)

The app should validate that trigger_key is one of these 18 values:

```typescript
const VALID_TRIGGER_KEYS = [
  'enrollment_complete',           // NOTE: no ss_ prefix (submitted before prefix convention)
  'ss_cancellation_requested',
  'ss_session_logged',
  'ss_session_noshow',
  'ss_module_completed',
  'ss_program_completed',
  'ss_milestone_reached',
  'ss_milestone_signedoff',
  'ss_payment_received',
  'ss_payment_failed',
  'ss_refund_processed',
  'ss_client_at_risk',
  'ss_client_reengaged',
  'ss_chargeback_detected',
  'ss_defense_ready',
  'ss_evidence_milestone',
  'ss_chargeback_ratio_warning',
  'ss_chargeback_ratio_critical',
] as const;
```

Reject any subscription request with an unrecognized trigger_key (return 400).

---

## WHAT NOT TO DO

- Do NOT build any GHL workflow logic — workflows live in GHL, not in the app
- Do NOT build the enrollment service, payment handler, or evidence service yet — those are Phase 2-3
- Do NOT try to register triggers via API — there is no API for this, Philip does it manually
- Do NOT guess the GHL trigger subscription webhook format — use what's documented above
- Do NOT create any communication services (email, SMS) — GHL handles all communication via workflows

---

## WHAT TO VERIFY BEFORE BUILDING

1. Check the existing codebase for any webhook handler patterns — follow the same Express route structure, middleware, error handling
2. Check if a Supabase migration system is already in place — use it for the new table
3. Check if there's an existing HTTP client/axios instance with retry logic — reuse it for trigger firing instead of building from scratch

---

## WHAT SUCCESS LOOKS LIKE

1. A new route POST /webhooks/ghl/triggers that handles subscribe/unsubscribe
2. trigger_subscriptions table exists in Supabase
3. trigger.service.ts can fire a trigger to all active subscriptions for a location+key
4. Unit tests for: subscription handler (subscribe, unsubscribe, invalid key), trigger firing (success, retry, no subscribers)
5. Integration test: subscribe → fire → verify POST was made to subscription URL

---

## FILES TO CREATE/MODIFY

**New files (expected):**
- src/services/trigger.service.ts
- src/routes/webhooks/triggers.ts (or add to existing webhooks router)
- src/migrations/xxx_create_trigger_subscriptions.ts (or .sql)
- src/tests/trigger.service.test.ts
- src/tests/webhooks/triggers.test.ts

**Existing files to check/modify:**
- src/routes/index.ts (register new route)
- src/config/constants.ts (add VALID_TRIGGER_KEYS)

---

*Phase 1 complete when: trigger subscription handling works and trigger firing service is tested. Then move to Phase 2 (CLAUDE_CODE_PHASE2_INSTRUCTIONS.md).*
