# GHL Snapshot Plan — ScaleSafe v2.1

**Version:** 1.0 — March 28, 2026
**Purpose:** Complete inventory of every GHL component needed in the ScaleSafe Snapshot, organized by: what we have, what to change, what to delete, and what to add. Cross-referenced against V1 Build Guide (Google Drive), v2.1 Blueprint, GHL Automation Companion, and real GHL API data from the PMG test location.

**Sources Used:**
- Real GHL data via Make.com MCP (352 custom fields, 53 custom values, 23 workflows, 27 forms, 63 offer records, 59 CO fields)
- Build Guide Section 2: GHL Foundations (forms, workflows, existing assets)
- Build Guide Section 3: Build Sections A-D (Offers CO schema, contact bridge fields, funnel architecture)
- Build Guide Section 4: Build Sections E-K (evidence collection, milestone system, scenario registry)
- SCALESAFE_APP_BLUEPRINT_v2.1.md (complete v2.1 build spec)
- GHL_AUTOMATION_COMPANION.md (v2.1 GHL component spec)
- Master Contents Index (V1 scenario registry, credential inventory)
- ghl-offers-custom-object-schema.md (59 CO fields — expanded from original 38)

---

## How the Snapshot Works

When a merchant installs ScaleSafe from the GHL Marketplace, two things happen:

1. **Snapshot auto-installs** GHL-side components that can't be created via API: pipeline, forms, workflows, enrollment funnel, and the Offers Custom Object.
2. **App provisions via API** components that CAN be created programmatically: 50 custom fields and 3 custom values (already working in production).

This document covers everything that goes into the Snapshot (category 1). The API-provisioned components (category 2) are already built and working.

---

## 1. WHAT WE HAVE (Exists in PMG — Keep As-Is for Snapshot)

These components exist in the PMG test location, are confirmed working, and can be packaged into the Snapshot without changes.

### 1A. Client Milestones Pipeline (8 stages)

| Stage | Name | Status |
|-------|------|--------|
| 1 | Enrolled | Exists ✓ |
| 2 | Milestone 1 | Exists ✓ |
| 3 | Milestone 2 | Exists ✓ |
| 4 | Milestone 3 | Exists ✓ |
| 5 | Milestone 4 | Exists ✓ |
| 6 | Milestone 5 | Exists ✓ |
| 7 | Milestone 6 | Exists ✓ |
| 8 | Completed | Exists ✓ |

**V1 Build Guide Reference:** Section F (Milestone Delivery & Sign-Off System) — "Milestone Tracker" single generic pipeline for ALL offers. Each client purchase creates one Opportunity that tracks through the pipeline independently.

**v2.1 Blueprint Reference:** Section 3 (Client Enrollment) — "Each enrollment creates a separate pipeline opportunity and separate evidence trail."

**Action:** Package as-is into Snapshot. Pipeline cannot be created via GHL API — MUST be in Snapshot.

### 1B. Offers Custom Object

**V1 Schema:** 38 fields originally specced in Build Guide Section A.
**Current PMG State:** 59 fields (expanded during v1 build to include clause slots, delivery method, refund window).
**v2.1 Schema (ghl-offers-custom-object-schema.md):** 59 fields confirmed.

Key field groups:
- Program basics: program_name, price, payment_type, installment details, pif_price, program_description
- Milestones 1-8: name, delivers, client_does (24 fields)
- Clause slots 1-11: title + text (22 fields)
- System fields: compiled_tc_html, redirect_slug, price_display, offer_created_date, active
- Options fields: payment_type, installment_frequency, pif_discount_enabled, active, delivery_method
- Additional: contact_id, refund_window_text

**Associations:** Contacts (many-to-many, ID: 699b8cbcb44f1833f8985b76), Opportunities (one-to-many, ID: 699b8ccf9f284d4f4cd76c8e)

**Action:** Package as-is. Note: Custom Object fields CANNOT be created via API (GHL UI only), so the Snapshot must include the full schema. The app reads/writes to this object but cannot create its structure.

### 1C. Pulse Check Cadence Workflow (SS--Pulse-Check-Cadence)

**V1 Build Guide:** "Pulse Check 30-day cadence — rolling loop from onboarding date"
**v2.1 GHL Companion:** Listed as existing, package as-is.
**Real GHL data:** Confirmed in workflow list.

**Action:** Package as-is into Snapshot. This is a pure GHL workflow — no webhook URLs to update.

### 1D. Evidence Forms (Core Set — Already Tested)

These forms exist and were tested during V1:

| Form | SYS2 ID | V1 Status | v2.1 Status |
|------|---------|-----------|-------------|
| Session Feedback | SYS2-07 | FULLY WIRED + TESTED | Keep — core evidence form |
| Module Completion | SYS2-08 | Form + sheet working | Keep — core evidence form |
| Monthly Pulse Check | SYS2-09 | FULLY WIRED + TESTED | Keep — core evidence form |

**Action:** Keep these 3 forms. They need webhook URL updates (see Section 2 below), but the form structures are correct.

---

## 2. WHAT TO CHANGE (Exists but Needs Updates for v2.1)

These components exist in PMG but need modifications before packaging into the Snapshot.

### 2A. Evidence Form Webhook URLs (SYS2-07, SYS2-08, SYS2-09, SYS2-10, SYS2-11)

**The Problem:** All evidence forms currently fire webhooks to Make.com URLs (e.g., `https://hook.us1.make.com/yus91ripwrh4e1xa6w3pb0ospe84hftt`). In v2.1, these must point to the ScaleSafe app.

| Form | Current Webhook Target | New Webhook Target |
|------|----------------------|-------------------|
| SYS2-07 Session Log | Make.com S8 Route 5 | `https://scalesafe-production.up.railway.app/webhooks/ghl/forms` |
| SYS2-08 Module Progress | Make.com S8 Route 6 | Same app endpoint |
| SYS2-09 Pulse Check | Make.com S8 Route 7 | Same app endpoint |
| SYS2-10 Payment Update | Make.com S8 Route 8 | Same app endpoint |
| SYS2-11 Cancellation | Make.com (not yet wired) | Same app endpoint |

**V1 Reference:** Build Guide Section E — Evidence Collection Workflows. S8 (Evidence Logger, Scenario 4544357) routed all form submissions to Google Sheets via Make.com. That entire pipeline is deprecated.

**v2.1 Blueprint:** Pattern A — "GHL workflow fires → Workflow sends webhook to ScaleSafe app → App logs evidence to Supabase"

**Action:** Update the GHL workflow attached to each form so the webhook URL points to the app endpoint instead of Make.com. The form structures stay the same — only the workflow webhook destination changes.

**IMPORTANT:** The actual webhook URL in the Snapshot should use a placeholder or the app's production URL. When a merchant installs, the app should verify/update these URLs to point to the correct app instance.

### 2B. WF-01 No-Show Logger

**V1 Build Guide:** "Session Log (3-branch) — Evidence logging + Make.com webhook"
**Current State:** Fires webhook to Make.com for evidence logging.
**v2.1 Requirement:** Fire webhook to app at `/webhooks/ghl/forms` with attendance data.

**Action:** Update webhook URL from Make.com to app endpoint. Keep the 3-branch workflow logic intact — just change the destination.

### 2C. WF-02 Module Progress Logger

**V1 Build Guide:** Build Guide Section 4, Phase Tracker 2.1
**Current State:** Fires webhook to Make.com when SYS2-08 form is submitted.
**v2.1 Requirement:** Fire webhook to app endpoint.

**Action:** Update webhook URL from Make.com to app endpoint.

### 2D. SYS2-10 Payment Update Form

**V1 Build Guide:** "Needs audit for accept.blue alignment"
**Current State:** Built for accept.blue payment flow.
**v2.1 Requirement:** ScaleSafe is now payment-processor-agnostic. Payment tracking comes from GHL payment webhooks, not a manual form. However, the form still has value as a manual payment logging option.

**Action:** Review form fields. Remove any accept.blue-specific fields. Keep as a manual payment confirmation form that merchants can optionally use. The primary payment evidence will come from GHL payment webhooks (Pattern C in v2.1 blueprint), not this form.

### 2E. SYS2-11 Cancellation Request Form

**V1 Build Guide:** "Decision needed" on how to wire this form.
**Current State:** Built, workflow partially done (Oke was building the GHL Workflow 9 and SYS2-11 Cancellation workflow per Phase Tracker).
**v2.1 Requirement:** Evidence Type 7 — captures cancellation date, reason, refund eligibility, status at cancellation. Webhook to app.

**Action:** Verify form has all required fields per v2.1 spec. Wire workflow to send webhook to app endpoint. This is a "change" not "add" because the form exists — it just needs proper wiring.

### 2F. WF-D1 Client Onboarding Prep

**V1 Build Guide:** Multiple workflows existed for different business models (WF-SYS2-01a Agency, 01b Coaching, 01c Course). These are all obsolete.
**v2.1 GHL Companion:** "WF-D1 Client Onboarding Prep — Sets up initial pipeline opportunity, sends welcome sequence. No webhook — pure GHL."
**Current State:** Needs verification against v2.1 enrollment flow.

**Action:** Rebuild this workflow for v2.1. It should trigger when the app fires an enrollment-complete signal (custom trigger or tag). Actions: create pipeline opportunity (if not done by app), send welcome email/SMS sequence. Must be universal (not business-model-specific).

---

## 3. WHAT TO DELETE (Legacy — Do NOT Include in Snapshot)

These exist in the PMG location but are artifacts of the V1 Make.com build. They should NOT be packaged into the Snapshot.

### 3A. ~300 Legacy Custom Fields

**What they are:** The PMG location has 352 custom fields total. The v2.1 app only manages 5 SS- prefix fields (created via API) plus writes Offer- prefix fields once at enrollment. The remaining ~300 fields are from the V1 build:

- **V1 Click-Wrap Toggles (9 fields):** Created by Manus in Delta4. Replaced by clause slots on the Offers Custom Object.
- **V1 Incentive Program fields (5 fields):** Created by Manus in Delta4. Not in v2.1 spec.
- **V1 Custom Clauses contact fields (6 fields):** Created by Manus in Delta3. Replaced by CO clause slots.
- **V1 Module Toggles (5 fields):** Created by Manus in Delta3. Module tracking now lives in Supabase.
- **V1 Opportunity Snapshot Fields (38 fields):** Full copy of offer data frozen at purchase time. In v2.1, this data lives in Supabase, not duplicated on GHL Opportunity records.
- **V1 Contact Bridge Fields (12 fields):** "Offer Bridge — Client Onboarding" folder. Written by Make.com S4 to render funnel pages via merge tags. In v2.1, the app serves enrollment pages directly — no merge tag bridge needed.
- **V1 Evidence Tracking fields (various):** SS-prefix fields beyond the 5 managed in v2.1.
- **V1 Refund fields (3 fields):** ss_refund_amount, ss_refund_date, ss_refund_transaction_id. Refund data lives in Supabase in v2.1.
- **V1 Defense fields (4 fields):** ss_defense_packet_url, ss_defense_pdf_url, ss_last_defense_date, ss_chargeback_reason_code. Defense data lives in Supabase.
- **V1 Sign-off fields (3 fields):** ss_signoff_milestone_number, ss_signoff_milestone_name, ss_signoff_work_summary. Sign-off data lives in Supabase.

**Action:** Do NOT include any of these in the Snapshot. The 5 app-managed fields (ss_enrollment_status, ss_evidence_score, ss_last_evidence_date, ss_chargeback_status, ss_defense_status) are created by the app via API during provisioning — they don't need to be in the Snapshot either.

**In the PMG location:** Do NOT delete these fields. They contain historical data from V1 testing. Just don't package them.

### 3B. Obsolete Forms

| Form | SYS2 ID | Reason for Removal |
|------|---------|-------------------|
| Merchant Onboarding Configuration | SYS2-01 | Superseded by app-based merchant onboarding. Merchants configure via the ScaleSafe dashboard, not a GHL form. |
| Evidence Export Request | SYS2-02 | Evidence PDFs now generated by the app, not triggered via a GHL form checkbox. |
| Agency Onboarding | SYS2-03 | Obsolete — replaced by universal enrollment funnel. V1 had per-business-model forms. |
| Coaching Onboarding | SYS2-04 | Obsolete — same reason. |
| Course Onboarding | SYS2-05 | Obsolete — same reason. |
| Milestone Sign-Off | SYS2-06 | Redesigned as app-served external page (not a GHL form). V1 Build Guide confirms "replaced by Make.com-served external form." In v2.1, the app serves sign-off pages directly. |

**V1 Build Guide Reference:** Section 2 clearly labels SYS2-03/04/05 as "OBSOLETE — replaced by universal Client Onboarding Funnel."

**Action:** Do not include these 6 forms in the Snapshot.

### 3C. Obsolete Workflows

| Workflow | V1 Purpose | Why Remove |
|----------|-----------|------------|
| WF-SYS2-01a Agency Onboarding Sequence | Per-model onboarding | Obsolete — universal enrollment replaces model-specific sequences |
| WF-SYS2-01b Coaching Onboarding Sequence | Per-model onboarding | Same |
| WF-SYS2-01c Course Onboarding Sequence | Per-model onboarding | Same |
| WF-SYS2-02 Evidence Export Trigger | Fired webhook to Make.com for evidence PDF | App handles evidence PDF generation now |
| Offer Builder → S3 trigger | Form submission → webhook to Make.com S3 | Offer creation now handled entirely by the app |
| Page 1 → S4 trigger | Client onboarding → webhook to Make.com S4 | Enrollment now handled by app, not Make.com bridge |
| SS: Post-Payment Actions | Triggered by Make.com S7 post-payment | Payment handling now via GHL webhooks → app |

**V1 Build Guide Reference:** Section 2 — 8 workflows listed. Several are explicitly marked as "may be obsolete."

**Real GHL Data:** 23 workflows total in PMG. Many are V1 artifacts. Only the ones listed in Section 1 (keep) and Section 2 (change) go into the Snapshot.

**Action:** Do not include these in the Snapshot. Do NOT delete from PMG — just don't package them.

### 3D. Legacy Custom Values

**Real GHL Data:** 53 custom values exist in PMG.
**v2.1 Requirement:** Only 3 custom values needed, created by the app via API:
- SS--Business-Name
- SS--Support-Email
- SS--TC-URL

**V1 custom values to DROP from Snapshot:**
- Clickwrap 1-9 (9 values) — replaced by CO clause slots
- Incentive Program — not in v2.1
- Custom Clauses — replaced by CO clause slots
- Module toggles — module config in Supabase
- Milestone 1-8 (8 values) — replaced by CO milestone fields
- ss_acceptblue_api_key — accept.blue deprecated
- ss_acceptblue_tokenization_key — accept.blue deprecated
- ss_acceptblue_webhook_signature — accept.blue deprecated
- ss_apps_script_url — Google Apps Script deprecated (evidence in Supabase now)
- ss_drive_merchant_folder_id — Google Drive automation deprecated
- ss_drive_evidence_folder_id — same
- ss_drive_defense_folder_id — same
- evidence_sheet_id — Google Sheets evidence deprecated
- Website Base URL — not needed in v2.1
- Compiled Terms HTML — T&C compiled by app now

**Action:** None of these go into the Snapshot. The 3 needed values are created by the app via API.

### 3E. Make.com Data Stores

These are NOT GHL components, but noting for completeness since they supported V1:
- OAuth Tokens (DS 82801) — token management now in Supabase
- AB Customer Map (DS 83038) — accept.blue deprecated
- T&C Clause Library (DS 82333) — clause library will live in Supabase or app

**Action:** No Snapshot impact. These will be decommissioned during Make.com transition.

---

## 4. WHAT TO ADD (Build New for Snapshot)

These components do not exist in PMG and must be created for the v2.1 Snapshot.

### 4A. Complete Communication Workflow Inventory (20 Workflows)

These are ALL the GHL workflows needed for v2.1 automated communications. Every outbound communication is also logged as evidence — the email/SMS itself proves the merchant was actively engaged. V1 had no custom triggers and almost no automated communications.

**Prerequisite:** All 16 custom workflow triggers (see 4C below) must be registered in the GHL Marketplace developer portal FIRST. These are configured at the app level, then Snapshot workflows listen for them.

#### ENROLLMENT COMMUNICATIONS (3 workflows)

| # | Workflow Name | Trigger | Client Gets | Merchant Gets | Tags/Actions |
|---|-------------|---------|-------------|---------------|-------------|
| 1 | **Welcome Sequence** | Enrollment Complete | Welcome email: program details, what to expect, first session info. Welcome SMS: short confirmation. | Email: new client enrolled — name, offer, amount, payment type | Add tag "enrolled", create pipeline opportunity task |
| 2 | **Enrollment Payment Receipt** | Enrollment Complete | Email receipt: transaction ID, amount, payment structure, next payment date (if installments) | (included in #1 notification) | — |
| 3 | **Bump Acceptance Confirmation** | Enrollment Complete (with bumps) | Email confirming bump add-on: what they added, price, terms | Email: client added [bump name] for [amount] | — |

#### SESSION & DELIVERY COMMUNICATIONS (4 workflows)

| # | Workflow Name | Trigger | Client Gets | Merchant Gets | Tags/Actions |
|---|-------------|---------|-------------|---------------|-------------|
| 4 | **Session Reminder** | Scheduled (before appointments) | Email/SMS: upcoming session reminder with date, time, prep notes | — | Pure GHL workflow, no custom trigger needed |
| 5 | **Session Follow-Up** | Session Logged | Email: "Thanks for your session — here's what we covered" with session summary | — | Evidence: outreach logged |
| 6 | **No-Show Follow-Up** | Session No-Show | Email/SMS: "We missed you — let's reschedule" with rebooking link | Email: "[Client] missed their session — automated follow-up sent" | Add tag "missed-session", evidence: re-engagement attempt logged |
| 7 | **Module Completion Congrats** | Module Completed | Email: "Congrats on completing [module]! Here's what's next." | Optional email: progress update | Evidence: engagement touchpoint logged |

#### MILESTONE COMMUNICATIONS (3 workflows)

| # | Workflow Name | Trigger | Client Gets | Merchant Gets | Tags/Actions |
|---|-------------|---------|-------------|---------------|-------------|
| 8 | **Sign-Off Request** | Milestone Reached | Email/SMS with sign-off link: "Please review and confirm [milestone] completion" | Email: "[Client] reached [milestone] — sign-off request sent" | — |
| 9 | **Sign-Off Confirmation** | Milestone Signed Off | Email: "Thanks for confirming [milestone] — here's what's coming next" | Email: "[Client] signed off on [milestone] — evidence logged" | Move pipeline stage |
| 10 | **Program Completion** | Program Completed | Email: celebration + summary of everything accomplished, # sessions, # milestones, timeline | Email: "[Client] completed [program] — full evidence trail logged" | Add tag "program-complete", move to pipeline Complete stage |

#### PAYMENT LIFECYCLE COMMUNICATIONS (5 workflows)

| # | Workflow Name | Trigger | Client Gets | Merchant Gets | Tags/Actions |
|---|-------------|---------|-------------|---------------|-------------|
| 11 | **Recurring Payment Receipt** | Payment Received | Email: payment receipt — amount, date, payments remaining, running total | Optional email: "[Client] payment of [amount] received" | Evidence: payment confirmation logged |
| 12 | **Payment Failed — First Attempt** | Payment Failed (attempt_count = 1) | Email: "Your payment didn't go through — please update your payment method" + update link | Email: "[Client] payment failed — [reason]" | Add tag "payment-failed" |
| 13 | **Payment Failed — Escalation** | Payment Failed (attempt_count >= 2) | Email/SMS (more urgent): "Important — your payment is past due. Update now to keep your access." | Email/SMS: ALERT — [Client] has [N] consecutive failed payments | Add tag "payment-past-due" |
| 14 | **Refund Processed** | Refund Processed | Email: refund confirmation — amount, timeline, reason | Email: "Refund of [amount] processed for [client]" | Add tag "refund-processed", evidence: refund logged |
| 15 | **Cancellation Acknowledgment** | Cancellation Requested | Email: cancellation received — what happens next, refund eligibility per T&C | Email: "[Client] requested cancellation — reason: [reason]" | Add tag "cancellation-requested" |

#### RISK & DEFENSE COMMUNICATIONS (5 workflows)

| # | Workflow Name | Trigger | Client Gets | Merchant Gets | Tags/Actions |
|---|-------------|---------|-------------|---------------|-------------|
| 16 | **Re-Engagement Outreach** | Client At Risk | Email/SMS: "Hey [name], we noticed you haven't been around. How are things going? We're here to help." | Email: "[Client] flagged at-risk — signals: [risk_factors]. Automated re-engagement sent." | Add tag "at-risk", evidence: re-engagement attempt logged (THIS IS TIER 1 DEFENSE EVIDENCE) |
| 17 | **Chargeback Alert** | Chargeback Detected | NOTHING (do not contact client during active dispute) | Email (URGENT): "CHARGEBACK FILED — [client] for [amount]. Reason: [code]. Deadline: [date]. Defense compilation starting." SMS: same. | Add tag "chargeback-active", create task with deadline, remove from active pipeline |
| 18 | **Defense Ready** | Defense Ready | NOTHING | Email: "Defense packet ready for [client] — [evidence_count] evidence items compiled. Download: [link]" | Add tag "defense-ready" |
| 19 | **Defense Deadline Reminder** | Scheduled (7 days and 3 days before deadline) | NOTHING | Email: "REMINDER — [N] days until chargeback response deadline for [client]. Submit your defense packet." | — |
| 20 | **Evidence Milestone Celebration** | Evidence Milestone | — | Email: "Great news — [client]'s defense readiness just hit [score]/100. [milestone_type] logged." | — |

#### CHARGEBACK RATIO MONITORING (2 workflows)

| # | Workflow Name | Trigger | Client Gets | Merchant Gets | Tags/Actions |
|---|-------------|---------|-------------|---------------|-------------|
| 21 | **Chargeback Ratio Warning** | Chargeback Ratio Warning | NOTHING | Email: "Your chargeback ratio is at [X]%. Visa's threshold is 0.9%. You have [N] disputes out of [M] transactions in the last [window] days. Here's what to do." | Add tag "ratio-warning" |
| 22 | **Chargeback Ratio Critical** | Chargeback Ratio Critical | NOTHING | Email (URGENT) + SMS: "CRITICAL — Your chargeback ratio is at [X]%, approaching Visa VDMP program threshold. [N] days at this rate and your processor may take action. Immediate steps: [recommended_actions]. Contact ScaleSafe support." | Add tag "ratio-critical", create urgent task |

**Why these matter:** Visa's VDMP (Visa Dispute Monitoring Program) kicks in at 0.9% dispute rate. Mastercard's Excessive Chargeback Program starts at 1.5%. Getting placed in these programs means fines ($25K-$75K), increased processing fees, mandatory remediation plans, and potential account termination. Most merchants don't even know their ratio until it's too late. ScaleSafe has all the data — every payment and every dispute — to calculate this in real time and warn merchants before they cross the line.

**App-side requirement:** The app needs a scheduled job (daily or weekly) that calculates chargeback ratios per merchant over rolling 30/60/90-day windows and fires the appropriate trigger when thresholds are crossed. This is a `reconciliation.service.ts` or new `ratio-monitoring.service.ts` task.

**Dashboard widget:** The merchant dashboard should show current chargeback ratio with a visual indicator (green/yellow/red) and trend arrow. This is a separate app build task, not a Snapshot component.

**Why 22 workflows instead of 6:** Every one of these outbound communications serves double duty — it's both operational (keeping people informed) AND evidentiary (every email/SMS the merchant sends or ScaleSafe sends on their behalf is proof of active engagement, transparent billing, and good-faith service delivery). The communications ARE the evidence.

**Action:** Build all 20 workflows in the PMG location. Each needs email templates with merge fields for dynamic content. Package into Snapshot. Merchants can customize the templates after install.

### 4B. Enrollment Funnel (4 Pages — Complete Rebuild)

**V1 State:** A client onboarding funnel existed (Pages 1-4) but relied on Make.com bridge fields and accept.blue payment processing. Build Guide Section 2 marks it as "NEEDS REBUILD."

**v2.1 Architecture (Blueprint Section 3):**

| Page | Purpose | Data Source | Key Change from V1 |
|------|---------|-------------|-------------------|
| Page 1 | Client info capture | GHL form | Similar to V1 — collects name, email, phone. Creates GHL contact. |
| Page 2 | Offer review | App API | V1 used merge tags from contact bridge fields. V2.1 uses JavaScript to call the app API and render offer details dynamically. No bridge fields needed. |
| Page 3 | T&C consent | App API | V1 used merge tags + custom code. V2.1 uses JavaScript to fetch T&C from app and capture consent (timestamp, IP, device, browser, hash) via app API call. |
| Page 4 | Payment | GHL native order form | **MAJOR CHANGE:** V1 used accept.blue hosted tokenization (custom code). V2.1 uses GHL's native order form with a GHL Product attached. No custom payment code. GHL handles processing through whatever processor the merchant has connected. |

**V1 Code References (Google Drive — for reference only, NOT reused):**
- Page 3 Consent Code v4: Doc `1w-KydTNhgQj52xmQ6_0vswNVdSjQqBUi7NkBifYBy4c`
- Page 4 Payment Code: Doc `17GmvPzFuVi3O0NyXWYjAQMPenyDStOtvDy0LJNjqEEM`

**Open Decision (from Blueprint):** Single funnel template where Page 4 dynamically loads the correct GHL Product based on URL offer ID, OR clone the funnel per offer? **Recommendation: Single template with dynamic loading.** This means ONE funnel in the Snapshot, and the app generates enrollment links with `?offerId=xxx` parameter.

**Action:** Build the complete 4-page funnel in the PMG location. Page 4 must use GHL's native order form component. Pages 2-3 need custom code sections that call the ScaleSafe app API. Package into Snapshot.

### 4C. Eighteen Custom Workflow Triggers (Marketplace Portal Config)

These are NOT Snapshot components — they're registered at the app level in the GHL Marketplace developer portal. But they're listed here because the Snapshot workflows (4A) depend on them. Expanding from the original 5 to 18 gives merchants full automation capability over every ScaleSafe event, including proactive chargeback ratio monitoring.

**ENROLLMENT TRIGGERS (2):**

| # | Trigger Name | Key | Fired When | Data Payload |
|---|-------------|-----|-----------|-------------|
| 1 | Enrollment Complete | `enrollment_complete` | Client completes payment on Page 4 | contact_id, offer_id, offer_name, amount, payment_type, bump_1_accepted, bump_2_accepted |
| 2 | Cancellation Requested | `ss_cancellation_requested` | Merchant submits SYS2-11 | contact_id, offer_id, reason, refund_eligibility, enrollment_date |

**SESSION & DELIVERY TRIGGERS (4):**

| # | Trigger Name | Key | Fired When | Data Payload |
|---|-------------|-----|-----------|-------------|
| 3 | Session Logged | `ss_session_logged` | Merchant submits SYS2-07 | contact_id, session_date, duration, topics, no_show_flag |
| 4 | Session No-Show | `ss_session_noshow` | WF-01 fires with no-show status | contact_id, scheduled_date, follow_up_action |
| 5 | Module Completed | `ss_module_completed` | Merchant submits SYS2-08 with completion | contact_id, module_name, progress_pct, completion_date |
| 6 | Program Completed | `ss_program_completed` | Final milestone signed off, all payments complete | contact_id, offer_id, offer_name, total_sessions, total_milestones, enrollment_date, completion_date |

**MILESTONE TRIGGERS (2):**

| # | Trigger Name | Key | Fired When | Data Payload |
|---|-------------|-----|-----------|-------------|
| 7 | Milestone Reached | `ss_milestone_reached` | Pipeline stage changes to next milestone | contact_id, milestone_number, milestone_name, offer_id |
| 8 | Milestone Signed Off | `ss_milestone_signedoff` | Client completes sign-off page | contact_id, milestone_number, milestone_name, signature_timestamp, ip_address |

**PAYMENT TRIGGERS (3):**

| # | Trigger Name | Key | Fired When | Data Payload |
|---|-------------|-----|-----------|-------------|
| 9 | Payment Received | `ss_payment_received` | GHL payment webhook — successful charge | contact_id, amount, transaction_id, payments_remaining, running_total |
| 10 | Payment Failed | `ss_payment_failed` | GHL payment webhook — failed charge | contact_id, amount, failure_reason, attempt_count, next_retry_date |
| 11 | Refund Processed | `ss_refund_processed` | Refund event from GHL/processor | contact_id, amount, refund_type (full/partial), reason |

**RISK & DEFENSE TRIGGERS (5):**

| # | Trigger Name | Key | Fired When | Data Payload |
|---|-------------|-----|-----------|-------------|
| 12 | Client At Risk | `ss_client_at_risk` | Disengagement scoring flags client | contact_id, risk_score, risk_factors[], days_inactive, last_activity_date |
| 13 | Client Re-Engaged | `ss_client_reengaged` | At-risk client shows new activity | contact_id, reengagement_type, previous_risk_score |
| 14 | Chargeback Detected | `ss_chargeback_detected` | Merchant or processor reports chargeback | contact_id, amount, reason_code, dispute_date |
| 15 | Defense Ready | `ss_defense_ready` | AI defense packet compiled | contact_id, packet_url, evidence_count, readiness_score |
| 16 | Evidence Milestone | `ss_evidence_milestone` | Major evidence threshold hit | contact_id, milestone_type, evidence_count, readiness_score |

**CHARGEBACK RATIO MONITORING TRIGGERS (2):**

| # | Trigger Name | Key | Fired When | Data Payload |
|---|-------------|-----|-----------|-------------|
| 17 | Chargeback Ratio Warning | `ss_chargeback_ratio_warning` | Merchant's dispute-to-transaction ratio hits warning threshold (0.5%) | location_id, current_ratio, threshold, dispute_count, transaction_count, rolling_window_days, trend (rising/stable/falling) |
| 18 | Chargeback Ratio Critical | `ss_chargeback_ratio_critical` | Merchant's ratio hits critical threshold (0.75% — approaching Visa's 0.9% VDMP limit) | location_id, current_ratio, threshold, dispute_count, transaction_count, rolling_window_days, days_until_program_risk, recommended_actions[] |

**Why 18 triggers instead of 5:** The original 5 only covered risk and defense events. But merchants need automation hooks into the ENTIRE client lifecycle, plus proactive monitoring that can save their processing account. A merchant might want to: send a Slack notification when a new client enrolls, update a Google Sheet when a milestone is signed off, trigger a Zapier workflow when a payment fails, send a custom deliverable email when a module is completed. With 16 triggers, merchants can build ANY custom automation using the native GHL workflow builder — no coding needed.

**Action:** Configure all 16 triggers in the GHL Marketplace developer portal. Philip does this manually in the developer console. Each trigger needs: Name, Key (immutable), Icon, Description, Sample JSON payload, and a Subscription URL (the app endpoint that receives trigger lifecycle events). Submit for GHL review. **Do this ASAP — there may be a review queue.**

**App requirement:** The app needs a trigger subscription handler endpoint that GHL calls when a merchant adds/removes a trigger from a workflow. This is a build task for Claude Code.

### 4D. Order Bump Support on Enrollment Funnel

**New for v2.1:** The enrollment funnel's Page 4 (checkout) must support up to 2 order bumps — optional add-on checkboxes that appear on the checkout page alongside the main offer's payment form.

See **ORDER_BUMP_BUILD_PLAN.md** for the complete specification including all 6 pricing scenarios, data model, and build sequence.

**Snapshot impact:** The enrollment funnel template must support bump product display. Whether this is native GHL order form bumps or custom HTML depends on GHL capability research (see Order Bump plan, Validation Question #1).

**Action:** Build bump support into the enrollment funnel template during funnel construction. Package into Snapshot.

---

## 5. SNAPSHOT COMPONENT SUMMARY

### What Goes IN the Snapshot:

| Category | Component | Status | Count |
|----------|-----------|--------|-------|
| Pipeline | Client Milestones (8 stages) | EXISTS — package as-is | 1 |
| Custom Object | Offers (59 fields + 2 associations) | EXISTS — package as-is | 1 |
| Form | SYS2-07 Session Feedback | EXISTS — update webhook URL | |
| Form | SYS2-08 Module Completion | EXISTS — update webhook URL | |
| Form | SYS2-09 Monthly Pulse Check | EXISTS — update webhook URL | |
| Form | SYS2-10 Payment Update | EXISTS — audit fields, update webhook | |
| Form | SYS2-11 Cancellation Request | EXISTS — verify fields, wire webhook | 5 forms |
| Workflow | WF-01 No-Show Logger | EXISTS — update webhook URL | |
| Workflow | WF-02 Module Progress Logger | EXISTS — update webhook URL | |
| Workflow | SS--Pulse-Check-Cadence | EXISTS — package as-is | |
| Workflow | WF-D1 Client Onboarding Prep | EXISTS — rebuild for v2.1 | 4 existing |
| Workflow | Welcome Sequence | NEW — enrollment comms | |
| Workflow | Enrollment Payment Receipt | NEW — enrollment comms | |
| Workflow | Bump Acceptance Confirmation | NEW — enrollment comms | |
| Workflow | Session Reminder | NEW — session/delivery comms | |
| Workflow | Session Follow-Up | NEW — session/delivery comms | |
| Workflow | No-Show Follow-Up | NEW — session/delivery comms | |
| Workflow | Module Completion Congrats | NEW — session/delivery comms | |
| Workflow | Sign-Off Request | NEW — milestone comms | |
| Workflow | Sign-Off Confirmation | NEW — milestone comms | |
| Workflow | Program Completion | NEW — milestone comms | |
| Workflow | Recurring Payment Receipt | NEW — payment comms | |
| Workflow | Payment Failed (First) | NEW — payment comms | |
| Workflow | Payment Failed (Escalation) | NEW — payment comms | |
| Workflow | Refund Processed | NEW — payment comms | |
| Workflow | Cancellation Acknowledgment | NEW — payment comms | |
| Workflow | Re-Engagement Outreach | NEW — risk/defense comms | |
| Workflow | Chargeback Alert | NEW — risk/defense comms | |
| Workflow | Defense Ready | NEW — risk/defense comms | |
| Workflow | Defense Deadline Reminder | NEW — risk/defense comms | |
| Workflow | Evidence Milestone Celebration | NEW — risk/defense comms | |
| Workflow | Chargeback Ratio Warning | NEW — ratio monitoring | |
| Workflow | Chargeback Ratio Critical | NEW — ratio monitoring | 22 new |
| Funnel | Enrollment Funnel (4 pages + bump support) | NEW — build from scratch | 1 |
| **TOTAL** | | | **1 pipeline, 1 CO, 5 forms, 26 workflows, 1 funnel** |

### What the APP Creates via API (NOT in Snapshot):

| Component | Count | Status |
|-----------|-------|--------|
| SS- prefix contact custom fields | 5 | WORKING — created during provisioning |
| Offer- prefix contact custom fields | ~45 | WORKING — created during provisioning |
| Custom values (Business Name, Support Email, TC URL) | 3 | WORKING — created during provisioning |
| GHL Products + Prices (per offer + bumps) | Dynamic | Created when merchant saves an offer |
| Trigger subscription handler endpoint | 1 | NOT YET BUILT — needed for custom triggers |

### What Gets Configured in Marketplace Portal (NOT in Snapshot):

| Component | Count | Status |
|-----------|-------|--------|
| Custom workflow triggers | 18 | NOT YET DONE — manual config by Philip, requires GHL review |
| OAuth scopes | 17 | DONE — configured in app settings |

---

## 6. BUILD SEQUENCE FOR SNAPSHOT

The recommended order for building the Snapshot:

**Step 1 — Register 18 Custom Triggers (Philip, manual — DO THIS FIRST)**
Register all 18 custom workflow triggers in the GHL Marketplace developer portal. Submit for GHL review. This may take days for approval, so start immediately. See 4C for complete trigger list with keys and payloads.

**Step 2 — App: Build Trigger Subscription Handler (Claude Code)**
Build the endpoint that GHL calls when a merchant adds/removes a ScaleSafe trigger from a workflow. This is required for the trigger registration in Step 1 (you provide this URL during trigger setup).

**Step 3 — Update Existing Workflows (PMG location)**
Update webhook URLs on WF-01, WF-02, and form workflows for SYS2-07/08/09/10/11 from Make.com to the app endpoint. Audit SYS2-10 fields, verify SYS2-11 fields.

**Step 4 — Build 20 New Communication Workflows (PMG location)**
Build all 20 workflows from the inventory in 4A, organized in this order:
- Enrollment comms first (3) — most critical for merchant experience
- Payment lifecycle (5) — revenue-related, high priority
- Session & delivery (4) — core evidence generation
- Milestone comms (3) — pipeline-driven
- Risk & defense (5) — last because they depend on other systems working

Each workflow needs: email template(s) with merge fields, SMS template(s) where applicable, tag actions, task creation where applicable.

**Step 5 — Rebuild WF-D1 Client Onboarding Prep (PMG location)**
Rebuild for v2.1 universal enrollment flow. Triggered by Enrollment Complete.

**Step 6 — Build Enrollment Funnel (PMG location)**
Build the 4-page enrollment funnel with:
- Page 1: contact capture
- Page 2: dynamic offer rendering via app API
- Page 3: T&C consent capture via app API
- Page 4: GHL native order form with bump support
See ORDER_BUMP_BUILD_PLAN.md for Page 4 bump requirements.

**Step 7 — End-to-End Testing (PMG location)**
Test the full lifecycle in PMG:
- Create an offer with bumps → enrollment link generated
- Walk through funnel → consent captured → payment processed (with bump)
- Verify: enrollment evidence logged, welcome emails sent, pipeline opportunity created
- Log a session → verify session follow-up sent
- Complete a milestone → verify sign-off request sent
- Simulate failed payment → verify escalation sequence
- Simulate chargeback → verify alert + defense compilation

**Step 8 — Package Snapshot (Marketplace Console)**
In the GHL Marketplace developer console, create the Snapshot package containing: pipeline, CO, 5 forms, 26 workflows, 1 funnel.

**Step 9 — Clean Install Test**
Install ScaleSafe on a brand new sub-account (not PMG). Verify:
- All Snapshot components deploy correctly
- App provisioning creates custom fields + values via API
- Enrollment funnel works end-to-end
- All 20 communication workflows fire correctly
- Bump checkout works

---

## 7. RISKS AND OPEN QUESTIONS

1. **Webhook URL in Snapshot:** When the Snapshot installs a workflow with a webhook URL, does it use a hardcoded URL or can it be dynamically set? If hardcoded, the app may need to update webhook URLs after install via API.

2. **GHL Product on Page 4:** The enrollment funnel's Page 4 uses a GHL native order form with a Product. But the Product is created by the app per-offer, not pre-existing. Can a GHL order form dynamically load a Product based on a URL parameter? This needs testing.

3. **GHL Order Form Bump Support:** Can GHL order form bump products be configured dynamically via JavaScript, or only statically in the page editor? This determines whether our single-template enrollment funnel can support bumps. See ORDER_BUMP_BUILD_PLAN.md validation questions.

4. **Custom Object in Snapshot:** GHL Custom Objects may not be packageable in Snapshots (GHL limitation). If not, the app may need to create the Offers CO via API during provisioning — but the API doesn't support creating CO fields. This needs verification with GHL docs.

5. **Trigger Registration Timing:** All 18 custom workflow triggers must be registered AND approved by GHL before the Snapshot goes live. The 22 communication workflows reference these triggers. If a merchant installs before triggers are approved, the workflows will be non-functional. **Start trigger registration immediately.**

6. **Trigger Review Queue:** GHL reviews each trigger version before it goes live. 18 triggers could take significant review time. Consider submitting in batches: enrollment + payment triggers first (most critical), then session/milestone, then risk/defense + ratio monitoring.

7. **Enrollment Funnel Template vs Clone:** Decision still open. Single template (recommended) requires dynamic Product loading on Page 4. If GHL doesn't support this, we may need the app to clone the funnel per offer — but GHL's Funnels API is READ-ONLY (can't create via API). Backup plan: single funnel, offer selection on Page 2.

8. **Email Template Customization:** The 20 communication workflows include stock email/SMS templates. Merchants will want to customize these. GHL allows workflow editing after Snapshot install — but if a merchant edits a workflow and we push a Snapshot update later, does it overwrite their customizations? Need to understand GHL Snapshot versioning behavior.

9. **Communication Volume:** 20 workflows sending emails + SMS for every event could hit GHL's sending limits for merchants on lower plans. Consider making non-critical communications (session follow-up, module congrats) optional via merchant config toggles in the ScaleSafe dashboard.

---

*End of GHL Snapshot Plan v1.0*
