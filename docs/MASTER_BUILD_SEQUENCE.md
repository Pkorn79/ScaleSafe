# ScaleSafe v2.1 — Master Build Sequence

**Version:** 1.0 — March 30, 2026
**Purpose:** Single source of truth for what gets built, in what order, by whom. Replaces reading 4 separate plans. Hand this to Claude Code as the build roadmap.

**Source Plans:** GHL_SNAPSHOT_PLAN.md, ORDER_BUMP_BUILD_PLAN.md, EXISTING_FUNNEL_INTEGRATION_BUILD_PLAN.md, PAYMENT_MIGRATION_BUILD_PLAN.md

---

## What's Already Built and Working

Before starting, here's what exists:
- OAuth callback → merchant provisioning in Supabase ✓
- SSO via postMessage handshake → loads in GHL iframe ✓
- Merchant provisioning: 50 custom fields + 3 custom values via GHL API ✓
- Offer creation with PIF + installment pricing, 11 clause slots ✓
- Public enrollment page renders at /enrollment?offerId=xxx ✓
- 76+ tests across 10+ suites ✓
- Deployed on Railway, health check passing, auto-deploys from main ✓

---

## Two Parallel Tracks

### TRACK A: Philip (GHL Marketplace Portal — Manual)
Register 18 custom triggers, build GHL workflows, configure the Snapshot. These are things Claude Code CANNOT do.

### TRACK B: Claude Code (App Code)
Build app services, endpoints, database tables, and frontend. This is where all the code lives.

The phases below show both tracks side by side. Some phases can overlap.

---

## PHASE 1: TRIGGER INFRASTRUCTURE
**Goal:** The app can fire custom workflow triggers into GHL, and GHL workflows can listen for them.

### Track A — Philip
- Register all 18 custom triggers in the GHL Marketplace developer portal
- Submit in priority batches (GHL reviews each one):
  - **Batch 1 (submit first):** enrollment_complete, ss_payment_received, ss_payment_failed, ss_cancellation_requested (4 triggers — critical path)
  - **Batch 2:** ss_session_logged, ss_session_noshow, ss_module_completed, ss_milestone_reached, ss_milestone_signedoff, ss_program_completed (6 triggers — core lifecycle)
  - **Batch 3:** ss_refund_processed, ss_client_at_risk, ss_client_reengaged, ss_chargeback_detected, ss_defense_ready, ss_evidence_milestone (6 triggers — risk/defense)
  - **Batch 4:** ss_chargeback_ratio_warning, ss_chargeback_ratio_critical (2 triggers — monitoring)
- **NOTE:** All keys use `ss_` prefix EXCEPT `enrollment_complete` (submitted before prefix convention was established). The key is immutable once submitted.
- Each trigger needs: name, key, icon, description, sample JSON payload, subscription URL

### Track B — Claude Code
**Build the trigger subscription handler and trigger firing service.**

1. **Trigger subscription endpoint:** POST /webhooks/ghl/triggers
   - GHL calls this when a merchant adds/removes a ScaleSafe trigger from a workflow
   - Store active trigger subscriptions in Supabase (new table: `trigger_subscriptions`)
   - Table: id, location_id, trigger_key, workflow_id, subscription_url, is_active, created_at
   - When a merchant activates a workflow using one of our triggers, GHL sends a subscription request. The app stores it. When the app wants to fire that trigger, it POSTs to the subscription URL.

2. **Trigger firing service:** `trigger.service.ts`
   - `fireTrigger(locationId, triggerKey, payload)` — looks up active subscriptions for this location + trigger, POSTs the payload to each subscription URL
   - Used by every other service when something happens (enrollment complete, payment received, etc.)
   - Retry logic: 3 attempts with backoff on failure
   - Logging: every trigger fire is logged for debugging

**Verification:** Create a test workflow in GHL that listens for `enrollment_complete`. Fire it from the app. Confirm the workflow executes.

**Dependencies:** None — this is foundation.

---

## PHASE 2: ENROLLMENT FUNNEL + PAYMENT WEBHOOKS
**Goal:** A client can actually sign up, pay, and become enrolled. This is the most critical missing piece.

### Track A — Philip
- Build the 4-page enrollment funnel in the PMG GHL location:
  - Page 1: Client info form (name, email, phone) → creates GHL contact
  - Page 2: Offer review (uses custom code to call app API, render offer details dynamically)
  - Page 3: T&C consent capture (custom code calls app API — captures timestamp, IP, device, browser, T&C hash)
  - Page 4: GHL native order form with the offer's GHL Product attached
- Build 3 enrollment communication workflows (Welcome Sequence, Payment Receipt, Bump Confirmation) — these fire on the `enrollment_complete` trigger from Batch 1

### Track B — Claude Code
**Build the enrollment backend and payment webhook handler.**

3. **Enrollment service:** `enrollment.service.ts`
   - `createEnrollment(contactId, offerId, locationId, consentData, paymentData)` — creates enrollment record in Supabase, logs consent evidence, logs payment evidence, fires `enrollment_complete` trigger
   - Consent data includes: timestamp, IP, device, browser, T&C version hash, signature
   - Payment data comes from the GHL payment webhook

4. **Consent capture endpoint:** POST /api/enrollment/consent
   - Called by Page 3 JavaScript when client agrees to T&C
   - Stores consent evidence in Supabase with full forensics (IP, device, browser, timestamp)
   - Returns a consent_token that links this consent to the upcoming payment

5. **GHL payment webhook handler:** POST /webhooks/ghl/payment
   - Receives GHL order/payment webhooks (order.completed, subscription.created, payment.success, payment.failed, refund)
   - Matches payment to pending consent via consent_token or contact email + offer mapping
   - On successful payment: completes enrollment, logs payment evidence, fires `enrollment_complete` trigger
   - On failed payment: logs failure, fires `payment_failed` trigger
   - Parses ALL line items (main product + bumps) — don't assume single product

6. **Enrollment evidence logging:**
   - Evidence type: enrollment_consent (from Page 3)
   - Evidence type: enrollment_payment (from payment webhook)
   - Each captures full metadata for chargeback defense

7. **Supabase tables:**
   - `enrollments` — id, contact_id, offer_id, location_id, status (consent_captured, enrolled, active, cancelled, completed), consent_token, consent_data (JSONB), payment_data (JSONB), created_at, updated_at
   - `evidence` — id, enrollment_id, location_id, contact_id, evidence_type, data (JSONB), created_at
   - `trigger_subscriptions` — (from Phase 1)

**Verification:** Walk through the full funnel in PMG: create offer → get enrollment link → fill out Pages 1-3 → pay on Page 4 → verify enrollment record created, evidence logged, welcome workflow fires.

**Dependencies:** Phase 1 (trigger service must exist to fire enrollment_complete).

---

## PHASE 3: EVIDENCE COLLECTION + PIPELINE
**Goal:** Every client interaction generates evidence. Sessions, modules, milestones all get tracked.

### Track A — Philip
- Update existing GHL workflows: change webhook URLs from Make.com to app endpoint on WF-01, WF-02, and form workflows for SYS2-07/08/09/10/11
- Build 4 session/delivery communication workflows (Session Reminder, Session Follow-Up, No-Show Follow-Up, Module Completion Congrats)
- Build 3 milestone communication workflows (Sign-Off Request, Sign-Off Confirmation, Program Completion)
- These fire on triggers from Batch 2 (session_logged, session_noshow, module_completed, milestone_reached, milestone_signedoff, program_completed)

### Track B — Claude Code
**Build form webhook handler, evidence services, and pipeline management.**

8. **Form webhook handler:** POST /webhooks/ghl/forms
   - Receives form submission webhooks from SYS2-07 through SYS2-11
   - Routes by form ID to the correct evidence handler:
     - SYS2-07 → session evidence (attendance, duration, topics)
     - SYS2-08 → module progress evidence
     - SYS2-09 → pulse check evidence
     - SYS2-10 → manual payment confirmation evidence
     - SYS2-11 → cancellation request evidence
   - Each handler: stores evidence in Supabase, updates enrollment record, fires appropriate trigger

9. **Milestone service:** `milestone.service.ts`
   - Track milestone progression per enrollment
   - `reachMilestone(enrollmentId, milestoneNumber)` — logs evidence, fires `milestone_reached`
   - `signOffMilestone(enrollmentId, milestoneNumber, signatureData)` — logs sign-off evidence with signature, fires `milestone_signedoff`
   - `completeProgram(enrollmentId)` — fires `program_completed` when final milestone signed and all payments complete

10. **Session service:** `session.service.ts`
    - `logSession(enrollmentId, sessionData)` — stores session evidence, fires `session_logged`
    - `logNoShow(enrollmentId, scheduledDate)` — stores no-show evidence, fires `session_noshow`

11. **Risk scoring service:** `risk.service.ts`
    - Calculates "defense readiness score" per enrollment based on evidence collected
    - Calculates "disengagement risk" based on inactivity, missed sessions, failed payments
    - Fires `client_at_risk` when risk threshold crossed
    - Fires `client_reengaged` when at-risk client shows new activity
    - Fires `evidence_milestone` when readiness score hits key thresholds (25, 50, 75, 90)

**Verification:** Submit each form type in GHL → verify evidence stored in Supabase → verify corresponding trigger fires → verify GHL communication workflow sends the right email/SMS.

**Dependencies:** Phase 2 (enrollments must exist for evidence to attach to).

---

## PHASE 4: PAYMENT LIFECYCLE + DUNNING
**Goal:** Recurring payments are tracked, failed payments trigger dunning, refunds and cancellations are handled.

### Track A — Philip
- Build 5 payment lifecycle communication workflows (Recurring Payment Receipt, Payment Failed First, Payment Failed Escalation, Refund Processed, Cancellation Acknowledgment)
- These fire on triggers from Batch 1 (payment_received, payment_failed) and Batch 3 (refund_processed, cancellation_requested)

### Track B — Claude Code
**Build payment lifecycle tracking, dunning logic, and cancellation handling.**

12. **Payment tracking service:** `payment.service.ts`
    - Processes recurring payment webhooks from GHL
    - Tracks: payment count vs total expected, running total paid, next payment date
    - Logs each payment as evidence (amount, date, transaction ID, payments remaining)
    - Fires `payment_received` trigger on success
    - Fires `payment_failed` trigger on failure (includes attempt_count for escalation logic)

13. **Dunning logic:**
    - Track consecutive failed payment attempts per enrollment
    - First failure: fire trigger with attempt_count=1 (merchant's workflow sends gentle reminder)
    - Second+ failure: fire trigger with attempt_count>=2 (merchant's workflow sends escalation)
    - App does NOT send communications directly — it fires triggers, GHL workflows handle messaging

14. **Refund handler:**
    - Receives refund webhooks from GHL
    - Logs refund evidence (amount, type, reason)
    - Updates enrollment status if full refund
    - Fires `refund_processed` trigger

15. **Cancellation handler:**
    - Receives SYS2-11 form data (from Phase 3 form handler)
    - Logs cancellation evidence (date, reason, refund eligibility, enrollment status at cancellation)
    - Updates enrollment status to 'cancelled'
    - Fires `cancellation_requested` trigger

**Verification:** Simulate the full payment lifecycle: successful recurring payment → failed payment → second failure → refund → cancellation. Verify each event creates evidence and fires the correct trigger.

**Dependencies:** Phase 2 (payment webhook handler exists), Phase 3 (form handler for SYS2-11).

---

## PHASE 5: ORDER BUMPS
**Goal:** Merchants can add 1-2 optional checkout add-ons to any offer.

### Track A — Philip
- **CRITICAL RESEARCH (do before Claude Code builds):**
  - Test in GHL: Can order form bump products be configured via JavaScript on a funnel page?
  - Test in GHL: Does the order webhook include bump line items in the payload?
  - Test in GHL: Does a recurring bump create a separate subscription from the main product?
- Update the enrollment funnel Page 4 to display bump checkboxes (method depends on research results)

### Track B — Claude Code
**Build bump support into offers and evidence. Full spec in ORDER_BUMP_BUILD_PLAN.md.**

16. **Schema:** Add 20 bump columns to `offers` table, 7 bump columns to evidence tables

17. **Offer service updates:** When creating an offer with bumps enabled, create separate GHL Products + Prices for each bump. Store product_id and price_id on the offer record.

18. **Payment webhook updates:** Parse ALL line items in order webhooks. Match each to main product or bump products. Log bump acceptance/decline as evidence.

19. **Evidence updates:** Log both accepted AND declined bumps. Accepted bumps add 2-3 points to defense readiness. Declined bumps add 1 point (proves transparent checkout).

20. **Dashboard UI:** Add "Order Bumps" section to Create/Edit Offer form.

21. **Enrollment packet + defense packet updates:** Include bump details in legal documents.

**Verification:** Create an offer with 2 bumps. Walk through checkout. Test all 6 pricing scenarios from the Order Bump plan. Verify evidence for accepted AND declined bumps.

**Dependencies:** Phase 2 (enrollment + payment must work), Phase 4 (recurring payment tracking for recurring bumps). GHL research MUST be done first.

---

## PHASE 6: AI DEFENSE + CHARGEBACK
**Goal:** When a chargeback happens, ScaleSafe compiles a defense packet using all collected evidence.

### Track A — Philip
- Build 5 risk/defense communication workflows (Re-Engagement Outreach, Chargeback Alert, Defense Ready, Defense Deadline Reminder, Evidence Milestone Celebration)
- These fire on triggers from Batch 3 (client_at_risk, chargeback_detected, defense_ready, evidence_milestone)

### Track B — Claude Code
**Build AI defense compilation and chargeback handling.**

22. **Defense compiler service:** `defense.service.ts`
    - Gathers all evidence for an enrollment: consent, payments, sessions, milestones, communications, bumps
    - Calls Claude API to generate a defense narrative tailored to the chargeback reason code
    - Generates defense packet PDF with evidence attachments
    - Fires `defense_ready` trigger

23. **Chargeback handler:**
    - Receives chargeback notification (manual entry or webhook)
    - Logs chargeback evidence
    - Fires `chargeback_detected` trigger
    - Automatically starts defense compilation
    - Tracks response deadline, fires reminder triggers at 7 days and 3 days before deadline

24. **Enrollment packet service:** `enrollmentPacket.service.ts`
    - Generates the legal snapshot PDF of what the client agreed to at enrollment
    - Includes: offer details, T&C text, consent signatures, payment details, bump details
    - Stored in Supabase, linked to enrollment

**Verification:** Create a full enrollment with evidence → trigger a chargeback → verify defense packet generated with correct evidence chain → verify all communication workflows fire.

**Dependencies:** Phase 3 (evidence must be collected), Phase 5 (bump evidence if applicable).

---

## PHASE 7: CHARGEBACK RATIO MONITORING
**Goal:** Merchants get warned before they hit Visa/Mastercard chargeback thresholds.

### Track A — Philip
- Build 2 ratio monitoring communication workflows (Chargeback Ratio Warning, Chargeback Ratio Critical)
- These fire on triggers from Batch 4 (chargeback_ratio_warning, chargeback_ratio_critical)

### Track B — Claude Code
**Build ratio calculation and monitoring.**

25. **Ratio monitoring service:** `ratioMonitoring.service.ts`
    - Scheduled job (daily): calculates chargeback-to-transaction ratio per merchant
    - Rolling windows: 30, 60, 90 days
    - Warning threshold: 0.5% → fires `chargeback_ratio_warning`
    - Critical threshold: 0.75% → fires `chargeback_ratio_critical`
    - Dashboard widget: current ratio with green/yellow/red indicator and trend arrow

**Verification:** Seed test data with known ratios. Verify triggers fire at correct thresholds. Verify dashboard shows accurate numbers.

**Dependencies:** Phase 4 (payment data must exist), Phase 6 (chargeback data must exist).

---

## PHASE 8: EXISTING FUNNEL INTEGRATION
**Goal:** Merchants with existing funnels on other platforms can plug ScaleSafe in without rebuilding.

### Track B — Claude Code
**Full spec in EXISTING_FUNNEL_INTEGRATION_BUILD_PLAN.md.**

26. **Hosted consent page:** GET /consent/:offerId — standalone page for T&C + consent capture, redirects to merchant's existing checkout page.

27. **Embeddable consent widget:** JavaScript bundle at /widget/consent.js — drops into any external page, captures consent inline.

28. **Stripe webhook handler:** POST /webhooks/stripe — receives Stripe payment events, normalizes them, links to consent records.

29. **Generic webhook handler:** POST /webhooks/payment — accepts standardized payment data from any processor (SamCart, WooCommerce, etc.), API key authenticated.

30. **Offer-to-product mapping:** New `offer_product_mappings` table + service. Maps external product IDs (Stripe, SamCart, etc.) to ScaleSafe offers.

31. **Integration setup UI:** Dashboard section for connecting external funnels/processors.

**Verification:** Full flow: consent captured via widget on external page → Stripe payment webhook received → matched to consent → enrollment created with evidence.

**Dependencies:** Phase 2 (enrollment must work), Phase 4 (payment tracking must work).

---

## PHASE 9: PAYMENT MIGRATION (STRIPE → GHL)
**Goal:** Merchants can migrate existing Stripe subscriptions to GHL-native billing through ScaleSafe.

### Track B — Claude Code
**Full spec in PAYMENT_MIGRATION_BUILD_PLAN.md.**

32. **Stripe integration service:** Connect merchant's Stripe account, import subscriptions, import payment history.

33. **Migration service:** Create migration batches, generate payment update links, process new card submissions, auto-cancel Stripe on success.

34. **Migration payment page:** GET /migrate/:token — hosted page where client enters new card, shows current subscription details + price change disclosure.

35. **Migration communications:** Send staggered email + SMS via GHL workflows, 3-reminder sequence (day 1, day 3, day 7).

36. **Migration dashboard:** Stripe connection UI, import & map view, batch management, progress tracking.

37. **Evidence import:** Pull Stripe payment history as evidence records. Log migration event as evidence.

38. **Stripe cancellation safety net:** Retry failed cancellations, daily verification cron job, double-billing detection.

**Verification:** Connect test Stripe account → import subscriptions → map to offers → send migration link → complete payment on new card → verify Stripe cancelled, GHL subscription created, evidence chain complete.

**Dependencies:** Phase 4 (GHL subscription handling), Phase 8 (Stripe webhook handler).

---

## PHASE 10: SNAPSHOT PACKAGING + CLEAN INSTALL TEST
**Goal:** Everything packaged and tested as a fresh install.

### Track A — Philip
- In GHL Marketplace console, create the Snapshot package containing:
  - 1 pipeline (Client Milestones, 8 stages)
  - 1 Custom Object (Offers, 59 fields)
  - 5 forms (SYS2-07 through SYS2-11, webhook URLs updated)
  - 26 workflows (4 existing updated + 22 new)
  - 1 enrollment funnel (4 pages)
- Install on a BRAND NEW sub-account (not PMG)
- Verify: all components deploy, app provisioning works, full lifecycle test passes

### Track B — Claude Code
- Verify app handles fresh installs correctly (provisioning, trigger subscriptions, default config)
- Fix any issues found during clean install test

---

## TIMELINE ESTIMATE

| Phase | Effort | Can Overlap With |
|-------|--------|-----------------|
| 1 — Trigger Infrastructure | 1-2 days code, trigger review ongoing | — |
| 2 — Enrollment + Payment | 3-4 days | Phase 1 Track A (trigger registration) |
| 3 — Evidence + Pipeline | 2-3 days | Phase 2 Track A (GHL workflows) |
| 4 — Payment Lifecycle | 2-3 days | Phase 3 Track A (more workflows) |
| 5 — Order Bumps | 2-3 days | Needs GHL research first |
| 6 — AI Defense | 3-4 days | Phase 5 can overlap |
| 7 — Ratio Monitoring | 1-2 days | Phase 6 can overlap |
| 8 — Funnel Integration | 4-5 days | After Phase 4 |
| 9 — Payment Migration | 5-6 days | After Phase 8 |
| 10 — Snapshot Packaging | 2-3 days | After all phases |

**Estimated total:** 25-35 days of build work, compressed by parallel tracks.

---

## WHAT CLAUDE CODE SHOULD READ BEFORE EACH PHASE

- **Every phase:** SCALESAFE_APP_BLUEPRINT_v2.1.md (the master spec)
- **Phase 5:** ORDER_BUMP_BUILD_PLAN.md
- **Phase 8:** EXISTING_FUNNEL_INTEGRATION_BUILD_PLAN.md
- **Phase 9:** PAYMENT_MIGRATION_BUILD_PLAN.md
- **GHL interactions:** GHL_AUTOMATION_COMPANION.md

---

## PHILIP'S ACTION ITEMS (Do Now)

1. **TODAY:** Start registering triggers in GHL Marketplace portal. Batch 1 first (enrollment_complete, payment_received, payment_failed, cancellation_requested).
2. **This week:** Research GHL order form bump configuration (Phase 5 blocker).
3. **When triggers are approved:** Start building GHL communication workflows in PMG, starting with enrollment workflows.

---

*End of Master Build Sequence v1.0*
