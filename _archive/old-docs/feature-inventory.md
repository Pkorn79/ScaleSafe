SCALESAFE — FEATURE INVENTORY & PRODUCT READINESS REVIEW  
March 2026

NOTE: A formatted Word document version of this inventory has been generated and is available for download. This Google Doc version is a text reference copy.

\=========================================

EXECUTIVE SUMMARY

This document provides a complete inventory of every ScaleSafe feature — what's built and working, what's planned but not yet built, and what we haven't discussed yet but should consider before going to market.

Bottom Line: The core evidence-collection engine is solid. Enrollment, payment processing, session/module/pulse logging, and the T\&C system all work. The gaps are in the "last mile" — milestone sign-offs, defense package compilation, merchant onboarding automation, and the features that make this feel like a complete product vs. a back-end system.

Status Legend: BUILT | PARTIAL | NOT BUILT | BRAINSTORM

\=========================================  
SECTION 1: BUILT & WORKING (\~35 features)  
\=========================================

MAKE.COM SCENARIOS:  
• S3 — Offer Creation: BUILT. Creates offer records in GHL Offers custom object.  
• S4 — Client Enrollment Prep: BUILT. Preps enrollment data, fetches offer, populates contact fields.  
• S5 — Offer Data Fetch: BUILT. Called by Page 2 of funnel to populate offer details.  
• S6 — Charge Processor: BUILT. Card \+ ACH via accept.blue. Multi-tenant with dynamic API key. Phase 4 refactored.  
• S7 — Post-Payment Handler: BUILT. Creates opportunity, copies offer data, initiates evidence trail. Phase 4 refactored.  
• S8 — Evidence Logger: BUILT. 7-route evidence router. Phase 4 refactored.  
• S8b — Evidence PDF Generator: BUILT. Generates formatted evidence PDFs. Fully dynamic.  
• OAuth Token Exchange: BUILT. Handles GHL OAuth callback, stores tokens.  
• Token Auto-Refresh: BUILT. Runs every 20 hours.

GHL COMPONENTS:  
• Client Milestones Pipeline: BUILT. 8 stages, opportunity-based.  
• Offers Custom Object: BUILT. Stores program definitions.  
• Contact Custom Fields (Offer- prefix): BUILT. All offer fields copied on enrollment.  
• Contact Custom Fields (SS- prefix): BUILT. System tracking fields.  
• Location Custom Values (SS- prefix): BUILT. 9 config keys created.  
• Evidence Module Toggles: BUILT. 5 enable/disable switches.  
• T\&C Clause Toggles: BUILT. 9 standard \+ 2 custom.  
• Incentive Program Config: BUILT. Toggle \+ 2 tier configs.  
• SYS2-07 Session Log Form: BUILT. Wired to S8.  
• SYS2-08 Module Progress Form: BUILT. Wired to S8 (not yet smoke-tested).  
• SYS2-09 Pulse Check Form: BUILT. Wired to S8.  
• SYS2-10 Payment Update Form: BUILT. Wired to S8.  
• SYS2-11 Cancellation Form: BUILT. Wired to S8.  
• No-Show Tracking Workflow (WF-01): BUILT.  
• Module Progress Workflow (WF-02): BUILT.

ENROLLMENT FUNNEL:  
• Page 1 — Client Info: BUILT.  
• Page 2 — Offer Review: BUILT. Fetches offer via S5.  
• Page 3 — T\&C Consent: BUILT. Updated code created, not yet pasted by Philip.  
• Page 4 — Payment: BUILT. Dynamic tokenization key. Updated code not yet pasted by Philip.

INFRASTRUCTURE:  
• GHL Custom App (OAuth): BUILT. Two-tier token model.  
• accept.blue Integration: BUILT. Card \+ ACH \+ tokenization.  
• Google Sheets Evidence Template: BUILT. 7 tabs.  
• Google Drive Folder Structure: BUILT.  
• Apps Script Bridge: BUILT.  
• Multi-Tenant Dynamic Routing: BUILT. Modules 100-103 chain.  
• Error Handling: BUILT. All scenarios.  
• T\&C Clause Library Datastore: BUILT. DS 82333\.  
• T\&C Page (/terms-page): BUILT.  
• Merchant Operating Manual v1.0: BUILT.

\=========================================  
SECTION 2: PARTIALLY BUILT (10 items)  
\=========================================

• Consent Evidence Tab: Tab exists. S8 route built. Not tested end-to-end.  
• Enrollment Evidence Tab: Tab exists. S7 direct-write code not yet added (Decision 12).  
• Payments Evidence Tab: Tab exists. accept.blue webhook for ongoing payments not wired.  
• SYS2-08 Module Form: Built but needs end-to-end smoke test.  
• Funnel Page 3 Code: Updated code generated. Philip needs to paste.  
• Funnel Page 4 Code: Updated code generated. Philip needs to paste.  
• Dynamic Merchant Logo: Custom value created. JS snippet not written.  
• Drive Folder ID Custom Values: Created but not populated.  
• accept.blue Webhook Signature: Custom value created but not populated.  
• Manual Touchpoints Form: Approach decided (GHL form via S8). Not built.

\=========================================  
SECTION 3: PLANNED BUT NOT BUILT (\~18 features)  
\=========================================

PHASE 5 — MERCHANT PROVISIONING (S1):  
• S1 Merchant Setup Scenario: NOT BUILT.  
• Evidence Sheet Cloning: NOT BUILT.  
• Drive Folder Creation: NOT BUILT.  
• Custom Value Auto-Population: NOT BUILT.

PHASE 6.1 — AI DISPUTE DEFENSE (S11):  
• S11 AI Defense Compiler: NOT BUILT.  
• Defense Package PDF Export: NOT BUILT.  
• Chargeback Alert Trigger: NOT BUILT.  
• Defense Tracking Dashboard: NOT BUILT.

PHASE 6.2 — MILESTONE SIGN-OFF (S9 \+ S10):  
• S9 Serve Sign-Off Page: NOT BUILT.  
• S10 Handle Submission: NOT BUILT.  
• Merchant Sign-Off Trigger Form: NOT BUILT.  
• Follow-Up Reminder System: NOT BUILT.  
• Sign-Off Evidence Tab logging: NOT BUILT.

PHASE 6.3 — DISENGAGEMENT TRACKING:  
• Disengagement Detection: NOT BUILT.  
• Re-Engagement Workflows: NOT BUILT.  
• Engagement Scoring: NOT BUILT.

OTHER:  
• GHL Snapshot Package: NOT BUILT (deferred).  
• Merchant Portal: NOT BUILT.  
• S2 Merchant Configuration: DEFERRED.

\=========================================  
SECTION 4: BRAINSTORM — NEW IDEAS (\~28 ideas)  
\=========================================

EVIDENCE GAPS:  
• 3rd Party Login/Usage Tracking (Philip flagged)  
• Post-Meeting Feedback Capture (Philip flagged)  
• Email/SMS Communication Log  
• Payment Receipt Evidence  
• Client Portal Access Logging  
• Resource Delivery Receipts

MERCHANT EXPERIENCE:  
• Merchant Onboarding Wizard  
• Evidence Health Dashboard  
• Merchant Notifications  
• Multi-Offer Client Support  
• Bulk Evidence Export  
• White-Label Funnel Styling

CHARGEBACK DEFENSE ENHANCEMENTS:  
• Reason Code Mapping  
• Win/Loss Tracking (Philip flagged)  
• Pre-Chargeback Alerts  
• Client Risk Scoring  
• Defense Template Library  
• Time-to-Respond Tracker

PAYMENT & SUBSCRIPTION MANAGEMENT:  
• Payment Dashboard in GHL (Philip flagged)  
• Failed Payment Recovery Flow  
• Refund Processing  
• Subscription Pause/Resume  
• Payment History Timeline

SCALABILITY & OPERATIONS:  
• Make.com Operation Monitoring  
• Merchant-Level Billing/Usage  
• Data Retention Policy  
• Backup & Recovery  
• Multi-Staff Support  
• GDPR/Privacy Compliance

\=========================================  
SECTION 5: SUGGESTED PRIORITY ORDER  
\=========================================

TIER 1 — MUST-HAVE FOR LAUNCH:  
1\. Finish partial items (paste code, populate values, test SYS2-08)  
2\. S1 Merchant Provisioning  
3\. Enrollment Evidence \+ Consent Evidence completion  
4\. S9 \+ S10 Milestone Sign-Off  
5\. S11 AI Defense Compiler  
6\. GHL Snapshot

TIER 2 — SHOULD-HAVE FOR COMPETITIVE PRODUCT:  
1\. Evidence Health Dashboard  
2\. Manual Touchpoints Form  
3\. Disengagement Tracking  
4\. Merchant Notifications  
5\. Follow-Up Reminders for Milestone Sign-Offs  
6\. Failed Payment Recovery Flow

TIER 3 — NICE-TO-HAVE / FUTURE PHASES:  
1\. Merchant Portal  
2\. 3rd Party Login/Usage Tracking  
3\. Post-Meeting Feedback  
4\. Reason Code Mapping  
5\. Win/Loss Tracking  
6\. White-Label Funnel Styling  
7\. Multi-Staff Support  
8\. Client Risk Scoring

\=========================================  
SECTION 6: OPEN QUESTIONS FOR DISCUSSION  
\=========================================

1\. accept.blue Webhooks: Are we getting payment event webhooks for ongoing subscriptions?  
2\. Chargeback Notification: How does the merchant know a chargeback happened?  
3\. Defense Package Delivery: Once S11 compiles defense, where does it go?  
4\. Pricing Model: Per merchant/per transaction/per chargeback?  
5\. Merchant Portal Scope: Separate web app? GHL page?  
6\. 3rd Party Integrations Priority: Which course platforms do target merchants use?  
7\. Data Migration: Can merchants import historical evidence?  
8\. Make.com Plan: When do we upgrade to Pro?  
9\. Onboarding Process: What does merchant onboarding look like beyond snapshot \+ S1?  
10\. Beta Merchants: Who's first for a real deployment?

\=========================================  
SUMMARY COUNTS:  
• BUILT & WORKING: \~35 features  
• PARTIALLY BUILT: 10 items to finish  
• NOT BUILT (PLANNED): \~18 features  
• BRAINSTORM (NEW IDEAS): \~28 ideas to evaluate  
\=========================================

This document is a starting point for our product review meeting. Every item is on the table.

\=========================================  
STATUS UPDATE — March 10, 2026  
\=========================================

The following items have changed status since the initial inventory was written:

MOVED FROM "NOT BUILT" TO "BUILT":  
• S1 Merchant Provisioning: NOW BUILT. Scenario 4606347, ACTIVE. Creates merchant subfolder, clones evidence template, creates defense packets folder, auto-populates 3 GHL custom values (Evidence Sheet ID, Drive Folder ID, Defense Folder ID). Webhook: https://hook.us1.make.com/i5l3p72t2gpu49s5s3qbsk8m49te05hp  
• Evidence Sheet Cloning: NOW BUILT. Part of S1 (Module 4 — Google Drive Copy File).  
• Drive Folder Creation: NOW BUILT. Part of S1 (Modules 2 and 3 — creates merchant folder \+ Defense Packets subfolder).  
• Custom Value Auto-Population: NOW BUILT. Part of S1 (Modules 7, 8, 9 — sets all 3 custom values via GHL API).  
• S9 External Integration Catcher: NOW BUILT. Scenario 4602645, ACTIVE. Generic webhook receiver for 3rd party integrations, bridges to S8 with API key auth. NOTE: This is NOT the Milestone Sign-Off "S9" listed in Phase 6.2 — that's a different feature.

MOVED FROM "PARTIAL" TO "BUILT":  
• Consent Evidence Tab: NOW COMPLETE. S8 Route 8 deployed. Tab exists on template and PMG sheet. End-to-end wired from Page 3 consent gate.  
• Enrollment Payment Evidence Tab: NOW COMPLETE. S8 Route 9 deployed. Tab exists on template and PMG sheet. End-to-end wired from Page 4 payment flow (17 fields verified).  
• Funnel Page 4 Code: NOW COMPLETE. Version 39\. Includes evidence webhook firing, window.\_ss\* variable setters, surcharge handling, consent timestamp passthrough. All evidence fields mapped and verified.  
• Drive Folder ID Custom Values: Will be auto-populated by S1 when it runs for a merchant.

CORRECTIONS TO COUNTS:  
• S8 Evidence Logger: Now has 9 routes (was listed as 7). Routes: SYS2-06 Milestone, SYS2-07 Session, SYS2-08 Module, SYS2-09 Pulse, SYS2-10 Payment, Sessions \+ No-Show, Module Log, Enrollment Consent, Enrollment Payment.  
• Google Sheets Evidence Template: Now has 9 tabs (was listed as 7). Added: Consent, Enrollment Payment.

STILL PARTIAL (unchanged):  
• Payments Evidence Tab: accept.blue webhook for ongoing scheduled payments still not wired.  
• SYS2-08 Module Form: Still needs end-to-end smoke test.  
• Dynamic Merchant Logo: JS snippet WRITTEN (Doc 1wdzltllL4qQsr1TKJeU9wpGB2QaxrJOU--7tngYZh0A). Philip needs to paste into funnel pages and set SS Merchant Logo URL custom value.  
• accept.blue Webhook Signature: Custom value still not populated.  
• Manual Touchpoints Form: Still not built.  
• Funnel Page 3 Code: Philip needs to paste updated code.

UPDATED SUMMARY COUNTS:  
• BUILT and WORKING: \~42 features (was \~35)  
• PARTIALLY BUILT: 6 items (was 10\)  
• NOT BUILT (PLANNED): \~13 features (was \~18, minus the 5 now built)  
• BRAINSTORM: \~28 ideas (unchanged)

NEXT TIER 1 PRIORITIES:  
1\. Milestone Sign-Off system (formerly listed as S9 \+ S10 in Phase 6.2) — this is the next major feature to build  
2\. S11 AI Defense Compiler — architecture TBD  
3\. GHL Snapshot packaging — deferred until all features built

TEMP MAKE.COM TOOLS TO CLEAN UP (manual deletion needed):  
Tool IDs: 4605304, 4605313, 4605355, 4605357, 4605359  
These were used for one-time setup tasks (adding tabs and headers to sheets). No longer needed.

\=========================================  
STATUS UPDATE \#2 — March 10, 2026  
\=========================================

MOVED FROM "NOT BUILT" TO "BUILT":  
• S11 AI Defense Compiler: NOW BUILT. Scenario 4606792, ACTIVE. 12-module flow: Webhook → Token Exchange → GET customValues → Set Variables (evidence sheet, defense folder, merchant name) → GET contact → Sheets batchGet (all 10 evidence tabs) → AI prompt assembly → Anthropic Claude API call → Google Drive Doc upload → GHL contact field update (defense\_packet\_url \+ last\_defense\_date) → Webhook respond. Webhook: https://hook.us1.make.com/4pw2apo4rlol9jyczqoeaticyn7kjg0t  
  NOTE: Requires Philip to set actual Anthropic API key in Make.com Key credential ID 85742\.

MOVED FROM "NOT BUILT" TO "BUILT":  
• Sign-Off Evidence Tab: NOW BUILT. Tab exists on template (sheetId 1986703189\) and PMG sheet (sheetId 202395054). S8 Route 10 deployed (ModuleID 18). Headers: contact\_id, timestamp, milestone\_number, milestone\_name, work\_summary, client\_signed, client\_ip, consent\_text.  
• Milestone Sign-Off Page: NOW BUILT. Page at https://wholepay.co/milestone-approval-page. Code doc: 1CoqNhpiFOu-9lNQH-oAfV2D9L3jJbRCUoFn7TFubUdA. Philip needs to re-paste updated code with template syntax fixes.

MOVED FROM "PARTIAL" TO "BUILT":  
• S8 Evidence Logger: Now has 10 routes (was 9 in last update). Added: Route 10 Milestone Sign-Off (ModuleID 18).  
• Google Sheets Evidence Template: Now has 10 tabs (was 9). Added: Sign-Off.

NEW GHL CUSTOM FIELDS CREATED (contact-level):  
• SS Last Defense Date (fieldKey: contact.ss\_last\_defense\_date) — for S11 tracking  
• SS Chargeback Reason Code (fieldKey: contact.ss\_chargeback\_reason\_code) — for S11 tracking  
• SS Sign-Off Milestone Number (fieldKey: contact.ss\_signoff\_milestone\_number) — for sign-off  
• SS Sign-Off Milestone Name (fieldKey: contact.ss\_signoff\_milestone\_name) — for sign-off  
• SS Sign-Off Work Summary (fieldKey: contact.ss\_signoff\_work\_summary) — for sign-off  
• SS Defense Packet URL (fieldKey: contact.ss\_defense\_packet\_url) — for S11 defense link

STILL PENDING (Philip action items):  
• Set Anthropic API key value in Make.com → Keys → "Anthropic Claude API Key" (ID 85742\)  
• Re-paste milestone sign-off page code from doc into funnel page  
• Re-paste Page 3 code (consent page) from doc into funnel page

UPDATED SUMMARY COUNTS:  
• BUILT and WORKING: \~46 features (was \~42)  
• PARTIALLY BUILT: 5 items (was 6\)  
• NOT BUILT (PLANNED): \~10 features (was \~13)  
• BRAINSTORM: \~28 ideas (unchanged)

TEMP MAKE.COM TOOLS TO CLEAN UP (updated list):  
Tool IDs: 4605304, 4605313, 4605355, 4605357, 4605359, 4606376, 4606451, 4606988

BRAINSTORM — NEW IDEA (added March 10, 2026):  
• Ask AI / Agent Studio Integration: Build a custom GHL Agent Studio agent that wraps the S11 webhook, allowing merchants to trigger chargeback defense compilations conversationally through GHL's Ask AI workspace (e.g., "compile a defense for John Smith's chargeback"). Could also be auto-provisioned during S1 onboarding via the Conversation AI API. Requires Agent Studio setup \+ API call tool node pointed at S11 webhook. Phase 2 feature — after core end-to-end testing complete. Reference: GHL Ask AI \+ Agent Studio integration docs.

\---

\#\# UPDATE 2026-03-10: S7 Post-Payment Handler — Recurring Payment Support Added

\*\*Scenario:\*\* S7 Post-Payment Handler (4579182) — ACTIVE  
\*\*Status:\*\* UPDATED and DEPLOYED

\*\*New Capabilities:\*\*  
1\. S7 now handles BOTH enrollment payments AND recurring scheduled payments from accept.blue webhook 1566  
2\. Top-level router splits traffic based on presence/absence of offer\_id (invoice\_number)  
3\. Enrollment route: unchanged existing flow \+ NEW customer mapping storage (Module 18, datastore:AddRecord to DS 83038\)  
4\. Recurring route (NEW): Modules 30-35 — looks up customer mapping, gets OAuth tokens, fetches GHL contact, logs evidence to S8 as "Recurring Payment", adds tag "ss-recurring-payment"

\*\*New Data Stores:\*\*  
\- AB Customer Map Data Structure: ID 270454 (8 fields: contact\_id, location\_id, offer\_id, program\_name, client\_name, payment\_type, installment\_amount, installment\_frequency)  
\- AB Customer Map Data Store: ID 83038 (1MB, key \= accept.blue customer\_id)

\*\*Module Count:\*\* S7 now has 27 modules total (was \~17)

\*\*New Module IDs in S7:\*\*  
\- Module 18: Store AB Customer Map (datastore:AddRecord, DS 83038\)  
\- Module 20: Top-level Router "Enrollment vs Recurring"  
\- Module 30: Lookup AB Customer Map (datastore:GetRecord, DS 83038\)  
\- Module 31: Get OAuth Token for recurring (datastore:GetRecord, DS 82801\)  
\- Module 32: Get Location Token for recurring (http:MakeRequest)  
\- Module 33: Fetch Contact for recurring (http:MakeRequest)  
\- Module 34: Log Recurring Payment Evidence to S8 (http:ActionSendData)  
\- Module 35: Add Recurring Payment Tag (http:MakeRequest)

\=========================================  
STATUS UPDATE \#3 — March 10, 2026  
\=========================================

CUSTOM OBJECT FIELD INVESTIGATION:

Analyzed the 5 "missing" Custom Object fields (tc\_has\_own, tc\_document\_url, enabled\_clause\_keys, refund\_window\_text, delivery\_method). Findings:  
\- tc\_has\_own: ALREADY EXISTS as location-level Custom Value "TC Has Own" (ID: DofNxxWQB1IljnnajmCw). No need to duplicate on the Custom Object.  
\- tc\_document\_url: ALREADY EXISTS as location-level Custom Value "TC Document URL" (ID: DRn473kax3uBo0oPgJ0y). No need to duplicate on the Custom Object.  
\- enabled\_clause\_keys: NOT NEEDED on Custom Object. Clause toggles are at the location level, and the compiled HTML already reflects which clauses are enabled.  
\- refund\_window\_text: GENUINELY NEEDED per-offer. Different programs may have different refund policies. Type: Large Text. → PHILIP MUST ADD MANUALLY IN GHL UI.  
\- delivery\_method: GENUINELY NEEDED per-offer. Type: Single Option (Online, In Person, Hybrid, Self-Paced). → PHILIP MUST ADD MANUALLY IN GHL UI.

REASON FOR MANUAL ADD: GHL's Custom Fields API only supports "contact" and "opportunity" models. Custom Object fields cannot be created via API — confirmed after testing 6 different endpoint variations. This is a GHL API limitation as of March 2026\.

CHARGEBACK TRIGGER INVESTIGATION:

Thoroughly searched all build docs, including:  
\- Feature Inventory (this doc)  
\- Build Guide Section 4  
\- SYS2-STAB-01 spec (198x3OwZXOEX547acwfJtZ\_2WLHvrcaltAz9B58\_ttg4)  
\- Full text search of Google Drive for "chargeback trigger"

RESULT: Chargeback trigger was NEVER built. The Feature Inventory already lists it as "NOT BUILT" under Phase 6.1. The SYS2-STAB-01 spec describes a conceptual Risk Scoring Engine and evidence logging system, but no actual chargeback trigger implementation exists. Philip's recollection was likely about spec/design work, not an actual built feature.

Philip stated: "this should really be built from a simple function in the app." — This should be designed as a future build item.

MANUAL TOUCHPOINTS FORM:

Confirmed NOT BUILT per Build Guide Section 4 and Feature Inventory.  
Philip stated: "Manual touchpoints should be built in the app."

TEMP MAKE.COM TOOLS TO CLEAN UP (updated list, adding tools created this session):  
Tool IDs: 4605304, 4605313, 4605355, 4605357, 4605359, 4606376, 4606451, 4606988, 4607279, 4607280, 4607292, 4607294, 4607295, 4607296, 4607300, 4607302, 4607303

PHILIP ACTION ITEMS (accumulated):  
1\. Add "Refund Window Text" field to Offers Custom Object (Large Text type)  
2\. Add "Delivery Method" field to Offers Custom Object (Single Option: Online, In Person, Hybrid, Self-Paced)  
3\. Re-paste Page 4 code from doc 17GmvPzFuVi3O0NyXWYjAQMPenyDStOtvDy0LJNjqEEM (surchargeAmt fix)  
4\. Paste Page 3 consent code from doc 1w-KydTNhgQj52xmQ6\_0vswNVdSjQqBUi7NkBifYBy4c  
5\. Paste Milestone Sign-Off page code from doc 1CoqNhpiFOu-9lNQH-oAfV2D9L3jJbRCUoFn7TFubUdA  
6\. Confirm Anthropic API key is set in Make.com Key credential ID 85742

UPDATED SUMMARY COUNTS:  
• BUILT and WORKING: \~46 features (unchanged)  
• PARTIALLY BUILT: 5 items (unchanged)  
• NOT BUILT (PLANNED): \~10 features (unchanged)  
• BRAINSTORM: \~28 ideas (unchanged)  
• Custom Object fields: 58 existing, 2 to add manually

\--- Status Update \#4 — 2026-03-10 \---

FIXES DEPLOYED:

1\. S7 Post-Payment Handler (Scenario 4579182\) — Module 14 URL Fix  
   \- Changed Association API URL from /objects/associations to /associations/ (correct GHL endpoint)  
   \- Added builtin:Ignore error handler to prevent cascade failures  
   \- Status: DEPLOYED and ACTIVE

2\. S5 Offer Data Fetch (Scenario 4578929\) — Module 6 Backslash Sanitization  
   \- Added toString(92) backslash stripping to all 57 replace() chains in the WebhookRespond body  
   \- Chains upgraded from 4-level to 5-level sanitization  
   \- Fixes Page 4 "Unterminated string in JSON at position 158" error  
   \- Status: DEPLOYED and ACTIVE

REMAINING LOOSE ENDS:  
\- Philip: Add 2 Custom Object fields manually in GHL UI (Refund Window Text, Delivery Method)  
\- Philip: Re-paste Page 4 code from doc after confirming fix works  
\- Philip: Paste Page 3 consent code  
\- Philip: Paste Milestone Sign-Off page code  
\- Temp tool cleanup: 4607333 (Test S5 Response) still exists  
\- Next up: S11 AI Defense Compiler build

\--- Status Update \#5 — 2026-03-10 \---

S11 — AI Defense Compiler (Scenario 4606792\)  
Status: DEPLOYED — Needs Testing  
Webhook: https://hook.us1.make.com/4pw2apo4rlol9jyczqoeaticyn7kjg0t  
Hook ID: 2643829

What was done:  
\- Reviewed full 12-module blueprint and identified 3 critical issues (bad API key reference, wrong model name, missing error handlers)  
\- Fixed Module 8 (Claude API call): proper apiKey auth with keychain 85742, corrected model to claude-sonnet-4-5-20250929, added error handler  
\- Fixed Module 6 (Sheets batchGet): added error handler for graceful failure  
\- Populated all module content: AI defense specialist prompt with reason code strategies, file naming, GHL contact field updates, webhook response body  
\- Deployed successfully — isActive: true, isinvalid: false

Module Flow:  
1 (Webhook) → 100 (OAuth DS lookup) → 101 (Location token exchange) → 3 (GET customValues) → 4 (Extract sheet\_id, folder\_id, merchant\_name) → 5 (GET contact) → 6 (batchGet all 10 evidence tabs) → 7 (Build AI prompt) → 8 (Claude API call) → 9 (Upload defense doc to Google Drive) → 10 (Update GHL contact fields) → 11 (Webhook response)

Expected webhook payload:  
{  
  "contact\_id": "...",  
  "location\_id": "...",  
  "reason\_code": "product\_not\_received|not\_as\_described|unauthorized|credit\_not\_processed|general\_fraud",  
  "disputed\_amount": "...",  
  "disputed\_date": "...",  
  "transaction\_id": "...",  
  "processor\_case\_id": "...",  
  "respond\_by\_date": "...",  
  "merchant\_notes": "..."  
}

Testing risk: Make.com API key 85742 must be configured in Make.com UI to send via "x-api-key" header for Anthropic API compatibility. If configured differently, Module 8 will fail.

Also completed this session:  
\- Deleted temp tool 4607333 (Test S5 Response)  
\- Decision Log updated with Decision 21 (S11 fixes and deployment)

\=========================================  
SECTION 7: COMPLETE PAYMENT LIFECYCLE SPEC  
Added: 2026-03-20  
Status: SPEC — needs build prioritization  
\=========================================

This is the master list of every payment scenario ScaleSafe needs to handle. Each item is one discrete function. Context: ScaleSafe is a GHL marketplace app. Merchants have multiple clients. All payment processing runs through accept.blue. Most merchants don't want to log into the gateway — so ScaleSafe needs to surface payment info inside GHL where they already work.

\--- A. CHECKOUT (Client Enrolls on Page 4\) \---

A1. Successful PIF payment — Client pays in full. S6 charges card, S7 creates opportunity, logs evidence, starts evidence trail. BUILT.

A2. Successful first installment payment — Client pays first installment. S6 charges card, S7 creates opportunity AND creates recurring schedule in accept.blue for remaining payments. BUILT (fixed 2026-03-20).

A3. Failed payment at checkout — Client's card declines on Page 4\. Page shows error message, client can retry with same or different card. Currently handled client-side only.

A4. 3 failed checkout attempts → notify merchant — After 3 declines on the same enrollment attempt, send the merchant an email/SMS alert: "\[Client Name\] tried to enroll in \[Program Name\] but payment failed 3 times." Merchant can follow up manually. NOT BUILT.

A5. One-time ad hoc charge — Merchant needs to charge a client outside of an offer enrollment (e.g., materials fee, makeup session, add-on). Needs a simple way to run a one-time charge against a stored payment method. NOT BUILT.

\--- B. RECURRING PAYMENTS (Installment Schedule Runs) \---

B1. Successful recurring payment — accept.blue fires webhook, S7 Route 2 catches it, looks up customer mapping, logs evidence to Supabase, tags contact in GHL. BUILT.

B2. Successful recurring payment → client receipt — Client gets an email confirming their payment was processed: "Your payment of $X for \[Program Name\] was processed successfully. \[X\] payments remaining." accept.blue can send receipt\_email if configured. NEEDS VERIFICATION — we pass receipt\_email in the schedule but haven't confirmed delivery.

B3. Successful recurring payment → update GHL contact — Write last payment date, last payment amount, and payments remaining to contact custom fields so merchant can see payment status without leaving GHL. PARTIALLY BUILT (tag exists, custom fields not yet created).

B4. Failed recurring payment → dunning attempt 1 — When a scheduled payment fails, automatically retry after 3 days. Log the failure as evidence. Notify the client: "Your payment of $X for \[Program Name\] could not be processed. We'll retry in 3 days. Please update your card if needed." NOT BUILT.

B5. Failed recurring payment → dunning attempt 2 — Second retry 3 days after first retry fails. Same client notification with more urgency. NOT BUILT.

B6. Failed recurring payment → 2 retries exhausted → notify merchant — After 2 failed retries (3 total failures), alert the merchant: "\[Client Name\]'s payment for \[Program Name\] has failed 3 times. Manual intervention needed." Add a tag or pipeline stage change in GHL so merchant can see at a glance who has payment problems. NOT BUILT.

B7. Final installment payment completes — Last payment in the schedule runs successfully. Mark the installment plan as complete. Update contact fields. Optionally notify merchant: "\[Client Name\] has completed all payments for \[Program Name\]." NOT BUILT.

B8. Installment payment logged to offer record — Each recurring payment is tracked back to the original offer record via the AB Customer Map. Payment count, total paid so far, and remaining balance should be visible on the contact in GHL. PARTIALLY BUILT (mapping exists, display fields not created).

\--- C. REFUNDS \---

C1. Refund processed → log evidence — When a refund webhook fires (type: "succeeded", subType: "refund"), log it to evidence\_refund\_activity in Supabase with amount, date, transaction ID, reason. BUILT (S7 Route 3).

C2. Refund processed → update contact fields — Write refund amount, date, and transaction ID to contact custom fields (ss\_refund\_amount, ss\_refund\_date, ss\_refund\_transaction\_id). BUILT.

C3. Refund processed → notify merchant — Send merchant an alert: "A refund of $X was processed for \[Client Name\] on \[Program Name\]." Include whether it was a full or partial refund. PARTIALLY BUILT (GHL Workflow 9 being built by Oke).

C4. Partial refund tracking — If merchant issues a partial refund, track the partial amount separately. Update remaining balance on the contact. NOT BUILT (current fields only store one refund event).

C5. Void (same-day cancel before settlement) — If a transaction is voided before batch settlement, log it differently than a refund since no money actually moved. accept.blue sends type: "updated", subType: "void". NOT BUILT.

\--- D. SUBSCRIPTION MANAGEMENT \---

D1. Pause installment schedule — Merchant can pause a client's recurring payments (sets active=false on accept.blue recurring schedule via PATCH). Log the pause event as evidence. Update contact status in GHL. NOT BUILT.

D2. Resume installment schedule — Merchant resumes a paused schedule (sets active=true). Log the resume event. Update contact status. NOT BUILT.

D3. Cancel installment schedule — Merchant cancels remaining payments entirely (DELETE recurring schedule in accept.blue). Log cancellation as evidence. Update contact fields with final payment count and total collected. NOT BUILT.

D4. Update payment method — Client's card expired or replaced. Merchant (or client via a self-service page) updates the payment method on the recurring schedule. Log the update as evidence. NOT BUILT.

D5. Change payment amount or frequency — Merchant adjusts installment terms mid-plan (e.g., reduces monthly amount, extends schedule). PATCH the recurring schedule. Log the change. NOT BUILT.

\--- E. MERCHANT NOTIFICATIONS & ALERTS \---

E1. Successful enrollment alert — Merchant gets notified when a new client enrolls: "\[Client Name\] enrolled in \[Program Name\] — \[PIF/Installment\]." PARTIALLY BUILT (GHL enrollment email workflow exists, needs verification it's working).

E2. Daily/weekly payment summary — Merchant gets a digest: X successful payments ($Y total), X failed payments, X refunds this period. NOT BUILT.

E3. Upcoming payment schedule view — Merchant can see which clients have payments coming up in the next 7/14/30 days. NOT BUILT.

E4. At-risk payment alert — If a client's card is expiring soon (accept.blue may provide this data), alert merchant before the next scheduled payment fails. NOT BUILT — need to verify if accept.blue exposes card expiry data.

\--- F. CLIENT-FACING NOTIFICATIONS \---

F1. Enrollment confirmation — Client gets email/SMS confirming their enrollment, payment amount, and if installment, their schedule. PARTIALLY BUILT (GHL workflow exists).

F2. Recurring payment confirmation — Client gets notified each time a scheduled payment processes successfully. See B2. NEEDS VERIFICATION.

F3. Failed payment notice — Client gets notified when their payment fails with instructions to update their card. See B4/B5. NOT BUILT.

F4. Payment plan completion — Client gets notified when all installments are paid. NOT BUILT.

F5. Refund confirmation — Client gets notified when a refund is processed to their account. NOT BUILT.

\--- G. GHL INTEGRATION (What Merchant Sees Without Leaving GHL) \---

G1. Contact-level payment status fields — Custom fields on each contact showing: last payment date, last payment amount, total paid, remaining balance, payments remaining, next payment date, payment status (current/past due/paused/complete). PARTIALLY BUILT (some fields exist, most not created).

G2. Payment activity in contact notes/timeline — Each payment event (charge, failure, refund, pause, resume) adds a note to the contact timeline so merchant can scroll through payment history. NOT BUILT.

G3. Pipeline stage updates — Payment events trigger pipeline stage changes: e.g., "Payment Failed" stage, "Payments Complete" stage, "Refunded" stage. NOT BUILT.

G4. Tag-based payment status — Tags like ss-payment-current, ss-payment-past-due, ss-payment-paused, ss-payment-complete, ss-refunded applied automatically based on payment events. PARTIALLY BUILT (ss-recurring-payment tag exists, others not created).

G5. Smart Lists for payment management — Merchant can filter contacts by payment status: "Show me everyone past due" or "Show me everyone with payments completing this month." Enabled by G1 fields \+ G4 tags. NOT BUILT (depends on G1 and G4).

\--- H. EVIDENCE RECORDING (What Gets Logged for Chargeback Defense) \---

Every payment event below is logged to Supabase with timestamp, contact\_id, location\_id, and offer\_id for chargeback defense evidence.

H1. Initial enrollment payment — Amount, method (card/ACH), last 4, auth code, transaction ID, PIF vs installment. BUILT (evidence\_transaction\_detail via S7).

H2. Each recurring payment — Amount, date, transaction ID, payment number in sequence, remaining count. BUILT (S7 Route 2 logs to Supabase).

H3. Failed payment attempts — Date, amount attempted, decline reason, retry count. Shows the system tried to collect. NOT BUILT.

H4. Refund events — Amount, date, transaction ID, full vs partial, reason if provided. BUILT (evidence\_refund\_activity via S7 Route 3).

H5. Cancellation events — Date, reason, payments completed vs total, amount collected vs total plan value. BUILT (evidence\_cancellation via S12).

H6. Pause/resume events — Date paused, date resumed, reason. Shows good faith if client needed a break. NOT BUILT.

H7. Payment method updates — Date, old last-4 vs new last-4. Shows client actively maintained their payment. NOT BUILT.

H8. Void events — Date, original amount, reason. NOT BUILT.

H9. Complete payment history summary — On-demand compilation of all payment events for a contact, formatted for defense packet. S11 already pulls from Supabase evidence tables, but needs the above event types logged first. PARTIALLY BUILT.

\=========================================  
BUILD STATUS SUMMARY:  
  BUILT: A1, A2, B1, C1, C2, H1, H2, H4, H5  
  PARTIALLY BUILT: B3, B8, C3, E1, F1, G1, G4, H9  
  NEEDS VERIFICATION: B2, F2  
  NOT BUILT: A3-A5, B4-B7, C4-C5, D1-D5, E2-E4, F3-F5, G2-G3, G5, H3, H6-H8  
  TOTAL: 48 functions (9 built, 8 partial, 2 verify, 29 not built)  
\=========================================

PRIORITY RECOMMENDATION:  
  Tier 1 (makes product feel complete for launch):  
    G1 — contact payment fields (merchant sees payment status in GHL)  
    G4 — payment status tags (enables smart lists)  
    B4/B5/B6 — dunning sequence (failed recurring → retry → alert merchant)  
    A4 — checkout failure alerts  
    B3 — update contact on each recurring payment  
    E1 — verify enrollment notification works

  Tier 2 (makes product feel professional):  
    B7 — installment completion handling  
    D1/D2/D3 — pause/resume/cancel  
    G2 — payment notes in timeline  
    F3 — client failed payment notice  
    E2 — daily payment summary for merchant  
    C3 — refund notification (Oke building)

  Tier 3 (future polish):  
    A5 — one-time ad hoc charges  
    D4/D5 — payment method update, schedule changes  
    E3/E4 — upcoming payments view, expiring card alerts  
    G3/G5 — pipeline stages, smart lists  
    H3/H6/H7/H8 — full evidence logging for all event types