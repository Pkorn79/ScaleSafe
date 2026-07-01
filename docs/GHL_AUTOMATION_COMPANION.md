# GHL Automation Companion

**Version:** 1.0 - March 25, 2026
**Companion to:** SCALESAFE_APP_BLUEPRINT_v2.1.docx
**Purpose:** Exhaustive list of everything that must exist inside GHL for the ScaleSafe app to function. This includes custom triggers, workflows, forms, pipeline stages, custom fields, custom objects, custom values, and Snapshot package contents.

**Rule:** If it lives in GHL, it's documented here. If it lives in the app, it's in the blueprint.

> **2026-05-08 beta snapshot override:** this companion contains older V2 planning language. For current snapshot decisions, use `docs/GHL_BETA_SNAPSHOT_EXECUTION_PLAN.md` and `docs/WORKFLOW_FIELD_CONTRACT_MATRIX.md` first. Client Milestones pipeline and Offers Custom Object are deferred/excluded for beta. Current workflows win for beta: the app now creates/writes the workflow-compatible fields used by the existing templates, including `contact.offer_program_name`, `contact.offer_price_display`, `contact.offer_number_of_payments`, and `contact.offer_support_email`.

---

## 1. Snapshot Package (Auto-Installed on Merchant Install)

When a merchant installs ScaleSafe from the GHL Marketplace, the app pushes a Snapshot that pre-configures their GHL sub-account. Everything below gets installed automatically - no manual merchant setup.

### 1A. Pipeline: Client Milestones

8-stage visual tracker for client progress through program milestones.

| Stage # | Stage Name | Purpose |
|---------|-----------|---------|
| 1 | Enrolled | Client has completed enrollment, payment confirmed |
| 2 | Milestone 1 | First program milestone (merchant-defined) |
| 3 | Milestone 2 | Second program milestone |
| 4 | Milestone 3 | Third program milestone |
| 5 | Milestone 4 | Fourth program milestone |
| 6 | Milestone 5 | Fifth program milestone |
| 7 | Milestone 6 | Sixth program milestone |
| 8 | Completed | All milestones done, program complete |

**App interaction:** App creates an Opportunity in this pipeline when enrollment completes. App moves Opportunity through stages as milestone evidence is logged.

**Open question:** Merchants define up to 8 milestones per offer. If an offer has fewer than 8, do unused stages get hidden or just stay empty? Recommendation: Leave all 8 stages visible, only create Opportunities for configured milestones.

### 1B. Custom Object: Offers

Stores program/offer definitions. Already exists in the test location.

**Key fields (from ghl-offers-custom-object-schema.md):**
- Offer name, description, price, payment type (PIF/installment)
- Installment amount, frequency, number of payments
- Up to 11 custom clause slots (title + text pairs)
- Up to 8 milestone definitions (name + description pairs)
- Module tracking configuration
- Business name, T&C URL

**App interaction:** App writes to this Custom Object when merchant creates/edits an offer. App reads from it during enrollment to populate funnel pages and create GHL Products.

### 1C. Contact Custom Fields (6 Key Fields - v2.1)

These are the core SS contact-level fields the app actively maintains. Offer bridge fields are listed separately below. All other data lives in Supabase unless a current workflow explicitly needs the GHL field.

| Field Key | Display Name | Type | Updated By | Purpose |
|-----------|-------------|------|-----------|---------|
| contact.ss_enrollment_status | SS Enrollment Status | TEXT | App | Current enrollment state (active, paused, cancelled, completed) |
| contact.ss_evidence_score | SS Evidence Score | NUMERICAL | App | Contact-level evidence readiness indicator for this client; not a dispute win prediction |
| contact.ss_last_evidence_date | SS Last Evidence Date | TEXT | App | Date of most recent evidence logged |
| contact.ss_chargeback_status | SS Chargeback Status | TEXT | App | Chargeback state (none, disputed, defending, won, lost) |
| contact.ss_defense_status | SS Defense Status | TEXT | App | Defense packet state (none, preparing, ready, submitted) |
| contact.ss_engagement_status | SS Engagement Status | SINGLE_OPTIONS | App | Active/At Risk engagement state for re-engagement workflows |

**NOTE:** Older PMG docs mention ~352 custom fields including many SS- and Offer-prefix fields from earlier Make.com/GHL iterations. Live PMG returned 118 custom fields on 2026-05-07. Use the field contract matrix before deleting or adding fields.

### 1D. Offer-Prefix Contact Fields (Written Once at Enrollment)

These get copied from the ScaleSafe app's offer record to the contact record when a client enrolls. Written once, not updated. For beta, this does not depend on the deferred GHL Offers Custom Object.

| Field Key Pattern | Purpose |
|-------------------|---------|
| contact.offer_business_name | Merchant business name |
| contact.offer_name | Name of the program enrolled in |
| contact.offer_price | Total program price |
| contact.offer_payment_type | PIF or Installment |
| contact.offer_installment_amount | Per-payment amount (if installment) |
| contact.offer_installment_frequency | Payment frequency |
| contact.offer_num_payments | Total number of payments |
| contact.offer_clause_slot_[1-11]_title | Custom clause titles |
| contact.offer_clause_slot_[1-11]_text | Custom clause text |
| contact.offer_milestone_[1-8]_name | Milestone names |
| contact.offer_milestone_[1-8]_description | Milestone descriptions |

Do **not** use or create these stale workflow aliases for beta:

- `contact.offer_program_name` - use `contact.offer_name`
- `contact.offer_price_display` - use `contact.offer_price`
- `contact.offer_number_of_payments` - use `contact.offer_num_payments`
- `contact.offer_support_email` - use `{{ custom_values.merchant_support_email }}`

### 1E. Evidence Collection Forms

GHL workflow Custom Webhook actions that post evidence events to ScaleSafe should include this static request header:

| Header | Value |
|--------|-------|
| `x-scalesafe-webhook-secret` | Merchant-specific secret from ScaleSafe Settings > Workflow Webhooks |

**Rollout state:** The app currently runs this validation in observe mode unless `REQUIRE_WEBHOOK_SECRET=true` is set in the backend environment. Observe mode logs missing, invalid, and tenant-mismatched webhook secrets without blocking existing workflows. Enforcement should only be enabled after active merchant workflows have been updated.

**Why it matters:** `/webhooks/ghl/forms` receives workflow/form evidence posts that include `locationId` and `contactId`. The shared secret binds each workflow post to the merchant that owns that `locationId`, preventing a third party from fabricating evidence for another tenant once enforcement is enabled.

These forms are filled out by merchants (or auto-submitted by workflows) to log evidence. Each form submission fires a webhook to the ScaleSafe app.

| Form ID | Name | Submitted By | Data Captured | Evidence Type |
|---------|------|-------------|---------------|---------------|
| SYS2-07 | Session Delivery Log | Merchant | Session date, duration, topics, delivery method, notes, no-show flag | Session Delivery |
| SYS2-08 | Module Completion Log | Merchant | Module name, completion date, assessment score, time spent | Module Completion |
| SYS2-09 | Pulse Check-In | Merchant | Check-in date, client sentiment (1-5), feedback text, follow-up flag | Pulse Check-In |
| SYS2-10 | Payment Update | Auto/Merchant | Payment received, amount, date, running total, payments remaining | Payment Confirmation |
| SYS2-11 | Cancellation Request | Merchant | Cancellation date, reason, refund eligibility, status at cancellation | Cancellation Request |

**App interaction:** App receives form submission webhooks at `/webhooks/ghl/forms`, parses the payload, and logs evidence to Supabase.

### 1F. Workflows (GHL-Side Automations)

These workflows run inside GHL and either: (a) send data to the app via webhook, or (b) handle notifications triggered by the app.

| Workflow ID | Name | Trigger | What It Does | Sends Data To App? |
|------------|------|---------|-------------|-------------------|
| WF-01 | No-Show Logger | Missed appointment event | Logs no-show to contact, fires webhook to app with attendance data | Yes - POST /webhooks/ghl/forms |
| WF-02 | Module Progress Logger | SYS2-08 form submission | Fires webhook to app with module progress data | Yes - POST /webhooks/ghl/forms |
| WF-D1 | Client Onboarding Prep | Enrollment completed (custom trigger) | Sets up initial pipeline opportunity, sends welcome sequence | No - pure GHL |
| SS--Pulse-Check-Cadence | Pulse Check Cadence | Timer/schedule per contact | Sends periodic check-in request (email/SMS) to client | No - pure GHL |

### 1G. Custom Values (Location-Level Settings)

Custom Values store location-level configuration that GHL workflows and forms can reference.

| Value Name | Purpose | Set By |
|-----------|---------|--------|
| SS--Business-Name | Merchant business name for templates | App (during onboarding) |
| SS--Support-Email | Support email for client communications | App (during onboarding) |
| SS--TC-URL | Terms & conditions document URL | App (during offer setup) |

**Note:** Most configuration now lives in Supabase `merchants` table, not GHL Custom Values. These are only the values that GHL workflows/forms need to reference directly.

---

## 2. Custom Workflow Triggers (18 Total - ALL REGISTERED AND APPROVED)

All 18 triggers were registered in the GHL Marketplace developer portal on 2026-03-30 and approved. All keys use `ss_` prefix EXCEPT `enrollment_complete` (submitted before prefix convention). The app fires these triggers; GHL workflows listen for them.

**ENROLLMENT (2):**
| Trigger Name | Key | Fired When | Data Payload |
|-------------|-----|-----------|-------------|
| Enrollment Complete | `enrollment_complete` | Client completes terms/signature and enrollment is finalized; welcome/access can send | contact_id, enrollment_id, offer_id, offer_name, payment_type, send_receipt=false, send_welcome=true, access_ready=true |
| Cancellation Requested | `ss_cancellation_requested` | Client requests cancellation | contact_id, offer_id, reason, refund_eligibility, enrollment_date |

**SESSION & DELIVERY (4):**
| Trigger Name | Key | Fired When | Data Payload |
|-------------|-----|-----------|-------------|
| Session Logged | `ss_session_logged` | Session recorded | contact_id, session_date, duration, topics, no_show_flag |
| Session No-Show | `ss_session_noshow` | Client misses session | contact_id, scheduled_date, follow_up_action |
| Module Completed | `ss_module_completed` | Client completes module | contact_id, module_name, progress_pct, completion_date |
| Program Completed | `ss_program_completed` | All milestones + payments done | contact_id, offer_id, offer_name, total_sessions, total_milestones, total_payments, total_amount, enrollment_date, completion_date |

**MILESTONE (2):**
| Trigger Name | Key | Fired When | Data Payload |
|-------------|-----|-----------|-------------|
| Milestone Reached | `ss_milestone_reached` | Client reaches milestone | contact_id, milestone_number, milestone_name, offer_id |
| Milestone Signed Off | `ss_milestone_signedoff` | Client confirms milestone | contact_id, milestone_number, milestone_name, signature_timestamp, ip_address |

**PAYMENT (3):**
| Trigger Name | Key | Fired When | Data Payload |
|-------------|-----|-----------|-------------|
| Payment Received | `ss_payment_received` | Successful payment; receipt only | contact_id, enrollment_id, offer_id, amount_display, transaction_id, payment_kind, payment_source, payment_timing, send_receipt=true, send_welcome=false |
| Payment Failed | `ss_payment_failed` | Payment attempt fails | contact_id, amount, failure_reason, attempt_count, next_retry_date |
| Refund Processed | `ss_refund_processed` | Refund issued | contact_id, amount, refund_type, reason |

**RISK & DEFENSE (5):**
| Trigger Name | Key | Fired When | Data Payload |
|-------------|-----|-----------|-------------|
| Client At Risk | _(field update)_ | Disengagement detected | Writes `ss_engagement_status = 'At Risk'` on GHL contact. GHL Contact Field Changed trigger drives workflow. |
| Client Re-Engaged | _(field update)_ | At-risk client returns | Writes `ss_engagement_status = 'Active'` on GHL contact. GHL Contact Field Changed trigger drives workflow. |
| Chargeback Detected | `ss_chargeback_detected` | Dispute filed | contact_id, amount, reason_code, dispute_date, processor |
| Defense Ready | `ss_defense_ready` | Defense packet compiled | contact_id, packet_url, evidence_count, readiness_score, processor |
| Evidence Milestone | `ss_evidence_milestone` | Evidence threshold hit | contact_id, milestone_type, evidence_count, readiness_score |

**SUBSCRIPTION (2):**
| Trigger Name | Key | Fired When | Data Payload |
|-------------|-----|-----------|-------------|
| Subscription Paused | `ss_subscription_paused` | Merchant pauses subscription | contact_id, offer_name, pause_reason, pause_resume_date, payments_remaining |
| Subscription Resumed | `ss_subscription_resumed` | Merchant resumes subscription | contact_id, offer_name, next_billing_date, payments_remaining, days_paused |

**CHARGEBACK RATIO MONITORING (2):**
| Trigger Name | Key | Fired When | Data Payload |
|-------------|-----|-----------|-------------|
| Chargeback Ratio Warning | `ss_chargeback_ratio_warning` | Ratio hits threshold | location_id, processor, current_ratio, threshold, dispute_count, transaction_count, rolling_window_days, trend |
| Chargeback Ratio Critical | `ss_chargeback_ratio_critical` | Ratio hits critical | location_id, processor, current_ratio, threshold, dispute_count, transaction_count, rolling_window_days, trend |

**PAYMENT REMINDERS (1):**
| Trigger Name | Key | Fired When | Data Payload |
|-------------|-----|-----------|-------------|
| Upcoming Payment Reminder | `ss_app_event` with `event_type = upcoming_payment_reminder` | 3 days before scheduled payment and again inside the next-24-hour window | contact_id, amount, next_billing_date, payments_remaining, offer_name |

**Subscription URL (all triggers):** `https://dashboard.scalesafe.app/webhooks/ghl/triggers`

**Who builds the response workflows?** The Snapshot includes default notification workflows for each trigger (22 total - see GHL_SNAPSHOT_PLAN.md Section 4A). Merchants can customize these workflows in GHL after install.

---

## 3. Enrollment Funnel

A 4-page funnel that clients go through to enroll in a merchant's program.

| Page | Purpose | Data Source | Key Interactions |
|------|---------|-------------|-----------------|
| Page 1 | Client Information | GHL form | Collects name, email, phone. Creates or updates GHL contact. |
| Page 2 | Offer Review | App API call | Displays offer details, deliverables, milestones, pricing. Fetched from Offers Custom Object. |
| Page 3 | Terms & Consent | App API call | Displays T&C and custom clauses. Captures consent with timestamp, IP, device, browser, digital signature hash. |
| Page 4 | Payment | GHL native order form | GHL Product attached. Client selects PIF or installment. GHL processes payment through merchant's connected processor. |

**Open decision (from blueprint):** Should this be a single funnel template where Page 4 dynamically loads the correct Product based on URL offer ID, or clone the funnel per offer? Recommendation: Single template with dynamic loading.

**App interaction:**
- App creates the GHL Product + Prices when merchant saves the offer
- Pages 2-3 call the app API to fetch offer data and record consent
- Page 4 is pure GHL native checkout - app does not touch it
- After payment success, GHL fires webhook → app completes enrollment

---

## 4. GHL API Scopes Required

The app needs these GHL OAuth scopes to function:

| Scope | Why |
|-------|-----|
| contacts.readonly | Read contact data for evidence matching |
| contacts.write | Update 5 SS- contact fields |
| opportunities.write | Create/move pipeline opportunities |
| forms.readonly | Receive form submission webhooks |
| workflows.readonly | List workflows for configuration |
| custom_objects.readonly | Read Offers Custom Object |
| custom_objects.write | Write to Offers Custom Object |
| custom_fields.readonly | Read custom field definitions |
| custom_fields.write | Create/update SS- contact fields |
| custom_values.readonly | Read location custom values |
| custom_values.write | Set location custom values during onboarding |
| products.write | Create GHL Products and Prices for offers |
| products.readonly | Read product data |
| payments.readonly | Read order/subscription/transaction data |
| locations.readonly | Read location info during onboarding |
| oauth.readonly | Token management |

**Note:** Exact scope names should be verified against GHL Marketplace developer docs during Phase 1. GHL updates scopes periodically.

---

## 5. Notification Workflows (Triggered by App Custom Triggers)

These are the GHL workflows that respond to the custom triggers the app fires. Installed via Snapshot, customizable by merchant.

### 5A. Chargeback Alert Workflow
- **Trigger:** Chargeback Detected
- **Actions:**
  1. Send email to merchant: "Chargeback filed for [Client Name] - $[Amount] - Reason: [Code]"
  2. Send SMS to merchant: "URGENT: Chargeback filed. Check ScaleSafe dashboard."
  3. Add tag "chargeback-active" to contact
  4. Create task for merchant: "Review defense packet by [deadline]"

### 5B. Defense Ready Workflow
- **Trigger:** Defense Ready
- **Actions:**
  1. Send email to merchant with defense packet download link
  2. Send SMS: "Defense packet ready for [Client Name]. Download now."
  3. Add tag "defense-ready" to contact

### 5C. Evidence Milestone Workflow
- **Trigger:** Evidence Milestone
- **Actions:**
  1. Send email to merchant: "Evidence milestone reached for [Client Name]"
  2. Optional: Internal notification only (lower urgency)

### 5D. Client At Risk Workflow
- **Trigger:** Client At Risk
- **Actions:**
  1. Send email to merchant: "[Client Name] flagged as at-risk. Risk score: [Score]"
  2. Send SMS to merchant: "At-risk alert: [Client Name]"
  3. Add tag "at-risk" to contact
  4. Suggest re-engagement: "Consider scheduling a check-in or pulse survey"

### 5E. Payment Failed Workflow
- **Trigger:** Payment Failed
- **Actions:**
  1. Send email to merchant: "Payment failed for [Client Name] - $[Amount]"
  2. Optionally notify client (merchant-configurable): "Your payment didn't go through"
  3. Add tag "payment-failed" to contact
  4. If repeat failure (attempt_count > 2): escalate notification

---

## 6. Build Phase Mapping

Which GHL components get built/configured in which phase:

| Phase | GHL Work |
|-------|----------|
| Phase 1: Infrastructure + Onboarding | Create Snapshot package, register OAuth scopes, register custom triggers on install, test Snapshot push |
| Phase 2: Offer Management + Enrollment | Enrollment funnel template, form webhook routing, GHL Product creation on offer save, Page 4 order form setup |
| Phase 3: Evidence Collection | Form webhooks (SYS2-07 through SYS2-11) pointed to app, WF-01 and WF-02 webhook URLs configured, contact field updates |
| Phase 4: Defense + Disengagement | Chargeback Detected workflow, Defense Ready workflow, Client At Risk workflow, Evidence Milestone workflow |
| Phase 5: Payments + Dunning | Payment Failed workflow, payment webhook routing, GHL subscription event handling |
| Phase 6: Dashboard + Polish | Final workflow tuning, merchant-facing configuration options for notification preferences |

---

## 7. Things That Do NOT Belong in GHL

For clarity, these are handled by the app or Supabase, NOT GHL:

- Evidence storage (Supabase)
- Defense packet generation (App + Claude API)
- Reason code mapping and strategy selection (App)
- Client evidence readiness calculation (App)
- Win/loss tracking (Supabase)
- Payment evidence logging (App listens to GHL webhooks, stores in Supabase)
- Enrollment packet PDF generation (App)
- Disengagement scoring algorithm (App)
- Daily reconciliation job (App)
- Merchant configuration storage (Supabase `merchants` table)
- OAuth token management (App)
- Multi-merchant tenant isolation (App + Supabase RLS)

---

## 8. Existing GHL Components (Test Location - PMG)

These already exist in the test GHL location from the Make.com era. They need to be evaluated and either kept (with webhook URL updates) or rebuilt for the Snapshot.

| Component | Status | Action Needed |
|-----------|--------|--------------|
| Client Milestones Pipeline | Exists | Package into Snapshot as-is |
| Offers Custom Object | Exists | Package into Snapshot. Verify schema matches v2.1 spec |
| SS- prefix contact fields (352 total in location) | Exists (many) | Reduce to 5 key fields for Snapshot. Legacy fields stay but aren't app-managed |
| Offer- prefix contact fields | Exists | Package into Snapshot for enrollment copy |
| Forms SYS2-07 through SYS2-11 | Exists | Ensure webhook URLs point directly to app endpoints and include `x-scalesafe-webhook-secret` where supported. Package into Snapshot |
| WF-01 No-Show Logger | Exists | Update webhook URL. Package into Snapshot |
| WF-02 Module Progress Logger | Exists | Update webhook URL. Package into Snapshot |
| WF-D1 Client Onboarding Prep | Needs verification | May need rebuild for v2.1 enrollment flow |
| SS--Pulse-Check-Cadence | Exists | Package into Snapshot as-is |
| Custom triggers | DO NOT EXIST | Must be registered by app on install (new in v2.1) |
| Notification response workflows | DO NOT EXIST | Must be built from scratch for Snapshot |
| Enrollment funnel | Needs rebuild | New 4-page flow with GHL native order form on Page 4 |

---

*End of GHL Automation Companion v1.0*
