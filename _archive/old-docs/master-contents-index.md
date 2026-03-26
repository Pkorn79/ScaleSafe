SCALESAFE — MASTER CONTENTS INDEX  
Last Updated: 2026-03-20 (v3 — added CURRENT/SUPERSEDED/REFERENCE-ONLY status labels, fixed stale content in Section 1, Section 3, and Operating Manual)  
Purpose: Fast-lookup directory for every component in the ScaleSafe build. When Claude needs info on any component, check HERE FIRST, then pull only the specific doc/section needed.  
Update Rule: This index MUST be updated at the end of every session after build docs and phase docs are updated.

\================================================================  
HOW TO USE THIS INDEX  
\================================================================

Each entry below tells you:  
\- WHAT it is (component name \+ ID)  
\- WHERE the details live (doc name \+ section)  
\- STATUS (current state)

To find something: Ctrl+F the component name, scenario number, field name, or ID.

\================================================================  
MAKE.COM SCENARIOS  
\================================================================

S1 — Merchant Provisioning (Scenario 4606347\)  
  Webhook: https://hook.us1.make.com/i5l3p72t2gpu49s5s3qbsk8m49te05hp  
  Status: ACTIVE  
  Details: Build Guide Section 4 → Section G (Scenario Registry)  
  Feature Inventory → Status Update \#2 (moved to BUILT)  
  Phase Tracker → Phase 5 (future enhancements)

S3 — Offer Creation (Scenario 4575869\)  
  Webhook: hook via GHL form submission  
  Status: ACTIVE  
  Details: Build Guide Section 3 → Section C (Offer Data Architecture)  
  Build Guide Section 4 → Section G (Scenario Registry)  
  Phase Tracker → Session 3/4 (clause migration notes)  
  Clause-per-offer instructions: Doc 1ZTuiMPPyijo6NIYS421zfS\_kZtSNqS3VOyvGw4sxOqw

S4 — Client Enrollment Prep (Scenario 4576733\)  
  Status: ACTIVE — filtered, error-handled  
  Details: Build Guide Section 4 → Section G  
  Phase Tracker → 1.1 (fix history), Session 3/4 (Fix A: Module 9 added)

S5 — Offer Data Fetch (Scenario 4578929\)  
  Status: ACTIVE  
  Details: Build Guide Section 4 → Section G  
  Build Guide Section 4 → Smoke Test \#2 (Fix D, E, F)  
  Phase Tracker → Session 3/4

S6 — Charge Processor (Scenario 4579164\)  
  Status: ACTIVE — dynamic API key (Phase 4.1 complete)  
  Details: Build Guide Section 4 → Section G  
  Phase Tracker → 4.1 (multi-tenant conversion)  
  accept.blue API Reference: Doc 1e0Oj5\_VU7NiwYKs1J4pfQKavDHq1zqsRz23dGGGepcg

S7 — Post-Payment Handler (Scenario 4579182\)  
  Webhook: accept.blue webhook 1566  
  Status: ACTIVE — dynamic API key (Phase 4.2 complete), Route 3 refund deployed  
  Module chain Route 2: 10→11→13→14→17→12  
  Module chain Route 3 (refund): 60→61→62→63→67→64→65→66  
  Details: Build Guide Section 4 → Section G  
  Phase Tracker → 4.2, Session 3/5 (Module 17 addition), 2.15 (Route 3 refund)  
  Feature Inventory → Update 2026-03-10 (recurring payment support)  
  accept.blue Webhooks Reference: Doc 1RhYod\_m6U8BdcHO3kzLv8LonuK9lSzGHTo4UD\_myf\_I  
  KNOWN PENDING: Page 3 timing fix (P0), Page 4 PIF/installment toggle (P0), S7 error handling build (Priority 1\)

S8 — Evidence Logger (Scenario 4544357\)  
  Webhook: https://hook.us1.make.com/yus91ripwrh4e1xa6w3pb0ospe84hftt (Hook 2604995\)  
  Status: ACTIVE — instant mode, 10 routes  
  Routes: SYS2-06 Milestone, SYS2-07 Session, SYS2-08 Module, SYS2-09 Pulse, SYS2-10 Payment, Sessions+NoShow, Module Log, Enrollment Consent, Enrollment Payment, Milestone Sign-Off  
  Details: Build Guide Section 4 → Section E \+ Section G \+ S8 Route Detail  
  Phase Tracker → 1.5, Session 3/5 (array handling fix, instant mode)  
  KNOWN PENDING: 7 unwired evidence routes, S8 error handling (Priority 2\)

S8b — Evidence PDF Generator (Scenario 4551267\)  
  Status: ACTIVE  
  Details: Build Guide Section 4 → Section G

S9 — External Integration Catcher (Scenario 4602645\)  
  Status: ACTIVE  
  Details: External Integration Guide: Doc 1Pe-U\_tHy3J-PtT4eyF62HaxOS6BAHoiwedQnPLyjcNk  
  Feature Inventory → Status Update \#2

S10 — Installment Logger (Scenario 4609066\)  
  Webhook: accept.blue webhook 1620  
  Status: ACTIVE — migrated to Supabase (2026-03-16)  
  Details: Phase Tracker → 2.7 (Supabase migration)  
  KNOWN PENDING: showing $0.00 and "Unknown" for all records (P1 bug)

S11 — AI Defense Compiler (Scenario 4606792\)  
  Webhook: https://hook.us1.make.com/4pw2apo4rlol9jyczqoeaticyn7kjg0t (Hook 2643829\)  
  Status: ACTIVE — Supabase RPC, 12-section prompt, E2E passing  
  Module flow: 1→11→100→101→3→4→5→60→62→31→41→7→70→8→9→10  
  Details: Phase Tracker → 2.7 (full pipeline), 2.8 (PDF export \+ E2E test), 2.9 (HTML format)  
  Feature Inventory → Status Update \#2 \+ \#5  
  KNOWN PENDING: PDF markdown formatting issue, multi-reason-code testing

S12 — Refund/Cancel Handler (Scenario 4617815\)  
  Webhook: https://hook.us1.make.com/3gag0kx144wrg7qadus5j6zwxsfbxpur  
  Status: ACTIVE — 0 executions, needs GHL workflow connection \+ testing  
  Routes: refund → evidence\_refund\_activity, cancel → evidence\_cancellation  
  Details: Phase Tracker → 2.11, 2.14

S13 — Service Access Listener (Scenario 4618339\)  
  Webhook: https://hook.us1.make.com/p6g3lkpnjfl99xktzynj5cjh5cyo71p0  
  Status: ACTIVE — tested  
  Details: Phase Tracker → 2.12

S14 — Daily Comms Logger (Scenario 4618346\)  
  Status: ACTIVE — scheduled every 24h, single-location (PMG)  
  Details: Phase Tracker → 2.13  
  KNOWN PENDING: multi-location support

\================================================================  
MAKE.COM DATA STORES  
\================================================================

OAuth Tokens — DS 82801  
  Key: location\_id  
  Used by: S7 (modules 100, 31, 41, 61), S11 (module 100\)

AB Customer Map — DS 83038  
  Key: accept.blue customer\_id  
  Structure ID: 270454 (8 fields)  
  Used by: S7 (modules 18, 30, 40, 60\)  
  Details: Feature Inventory → Update 2026-03-10

T\&C Clause Library — DS 82333  
  Key: clause\_id  
  Used by: S3 (clause compilation)

\================================================================  
GHL CUSTOM VALUES (LOCATION-LEVEL)  
\================================================================

merchant\_business\_name — populated for PMG  
support\_email — phil@getwholepay.com  
descriptor — populated for PMG  
tc\_document\_url — https://wholepay.co/terms-page (DRn473kax3uBo0oPgJ0y)  
evidence\_sheet\_id — set for PMG  
ss\_acceptblue\_api\_key (lxPxOglGHMieOiK5bUwM) — EMPTY, needs population  
ss\_acceptblue\_tokenization\_key (xtPiKYYbcfNowiOipbCH) — EMPTY, needs population  
ss\_acceptblue\_webhook\_signature (MswKqTl2UPSneAxp9IMN) — EMPTY, needs population  
ss\_apps\_script\_url (2YT7JLf3GGSqmX5pDjDt) — EMPTY  
ss\_drive\_merchant\_folder\_id (juT9f5UAIBG1M5qLhcWL) — EMPTY  
ss\_drive\_evidence\_folder\_id (o6xkJa92qxxfQaofDr8U) — EMPTY  
ss\_drive\_defense\_folder\_id (6Ze4RdQJmkb9uaE7hXlj) — EMPTY  
Details: Phase Tracker → 2.3, Build Guide Section 1

\================================================================  
GHL CUSTOM FIELDS (CONTACT-LEVEL)  
\================================================================

Refund fields:  
  ss\_refund\_amount (eORyRt0Fd8kliP8Fmqem)  
  ss\_refund\_date (Hv8oYaNU1cobRqqQ2JyT)  
  ss\_refund\_transaction\_id (pcTtpZyVshitn1vl6sO0)  
  Details: Phase Tracker → 2.15

Defense fields:  
  ss\_defense\_packet\_url — for S11 defense link  
  ss\_defense\_pdf\_url — Google Docs export URL  
  ss\_last\_defense\_date  
  ss\_chargeback\_reason\_code  
  Details: Phase Tracker → 2.8, Feature Inventory → Status Update \#2

Sign-off fields:  
  ss\_signoff\_milestone\_number  
  ss\_signoff\_milestone\_name  
  ss\_signoff\_work\_summary  
  Details: Feature Inventory → Status Update \#2

Full field list: Build Guide Section 3 → Section A (38 Offers CO fields), Section A item 2 (8 contact bridge fields)

\================================================================  
GHL WORKFLOWS  
\================================================================

Full inventory (22 workflows): Build Guide Section 4 → GHL Workflow Inventory  
WF-01 — No-Show Tracking: Build Guide Section 4 → Section E  
WF-02 — Module Progress Logger (e4115381): Phase Tracker → 2.1  
Workflow 9 — SS: Refund Notification: Phase Tracker → 2.15 (Oke building)  
SS: Post-Payment Actions: Build Guide Section 4 → H9 Update  
SYS2-11 Cancellation Workflow: Phase Tracker → 2.14 (Oke building)

\================================================================  
GHL FORMS  
\================================================================

Full inventory (10 forms): Build Guide Section 4 → GHL Form Inventory  
SYS2-06 Milestone Sign-Off: RETIRED (replaced by S9/S10)  
SYS2-07 Session Log: TESTED ✓  
SYS2-08 Module Progress: Built, needs smoke test  
SYS2-09 Pulse Check: TESTED ✓  
SYS2-10 Payment Update: TESTED ✓  
SYS2-11 Cancellation (s9LDdMzizx1VljRv2E3J): Built, Oke wiring workflow

\================================================================  
CLIENT ENROLLMENT FUNNEL (4 PAGES)  
\================================================================

Page 1 — Client Info: BUILT  
Page 2 — Offer Review (fetches offer via S5): BUILT  
Page 3 — T\&C Consent: Code needs re-paste by Philip  
  Code doc: Doc 1w-KydTNhgQj52xmQ6\_0vswNVdSjQqBUi7NkBifYBy4c  
  KNOWN PENDING: timing fix (P0 showstopper)  
Page 4 — Payment: Code needs re-paste by Philip  
  Code doc: Doc 17GmvPzFuVi3O0NyXWYjAQMPenyDStOtvDy0LJNjqEEM  
  KNOWN PENDING: PIF/installment toggle missing (P0)  
Details: Build Guide Section 3 → Section D, Build Guide Section 5C → Files Index

\================================================================  
SUPABASE EVIDENCE TABLES (16 types)  
\================================================================

Migrated from Sheets (2026-03-16):  
  1-sessions, 2-modules, 3-consent, 4-enrollment\_payment, 5-signoff  
  6-milestone\_detail, 7-session\_feedback, 8-module\_detail, 9-pulse\_survey  
  10-payment\_auth  
Built new in Supabase:  
  11-transaction\_detail, 12-communications, 13-program\_completion  
  14-service\_access, 15-refund\_activity, 16-cancellation  
RPC: get\_defense\_evidence (returns all 16 types in one call for S11)  
Details: Phase Tracker → 2.5.1 through 2.5.4, Phase Tracker → 2.7

\================================================================  
GOOGLE DRIVE STRUCTURE  
\================================================================

WholePay Operations Root: 1oEUONmB9QdmqNmnd2ju\_XyriHPtpTrU2  
ScaleSafe Project: 1aEffRMqSrKneMLV7\_a-KcN\_tuqrmMzJ8  
Build Guide Folder: 1xG5hlURViWF2gXvZGS9WP8gKl9x0w5kG  
Code Snapshots: 1kuFsE4II\_DMetbICWfot05UuGefQl734  
Marketing: 1SaZygjdX-xuhW3EmiQOWb0hNqYzQU3s8  
PMG Evidence Sheet: 1dvhkSie9OUPCaHlSAl1Z7xLJgdsp9nETu0h0Q1soKbw  
Evidence Template: 18OjmS8-zsRK1xQDlumGqpWORjORSP0VMuSJylxd30Mc  
Full Drive Registry: Doc 1KfS2whl\_IhixL22OT0IGtatYzsJVv3IUa0nVQzwDrFU

\================================================================  
CREDENTIALS (QUICK REF)  
\================================================================

GHL Company: kYqQRVFPk2CGCMCIFWU8  
GHL Location (PMG): 274dtgl30b7x2HG8hn69  
GHL App Client: 69a9e83d6ee4e35bd4a5f32a-mmdxk9c2  
GHL PIT: pit-df594c5b-67cd-40c7-b833-d7d64f44da45  
GHL Connection (CuratedConnector): 4679047  
Make.com Team: 352208 | Org: 878210  
accept.blue API Key: mq36KlykP57UZtLYlJur38MNcmC1nfRJ  
accept.blue Token Key: pk\_xXZxeTovbVT4X1CaH0yRhtRIgf5hV  
AB Webhook 1566 → S7 | Signature: izlQXv0Hg1EbSZef5fPrvDANPdjyHQ0u  
AB Webhook 1620 → S10 | Signature: 1NeUdlrmySBvNNPvYvGhtNEC6Oabkfh9  
Anthropic API Key credential: Make.com Key ID 85742  
Slack VA Channel: \#wholepay-ghl-build (C0AK3T7D82H)

\================================================================  
DOCUMENT DIRECTORY  
\================================================================

BUILD DOCS (in Build Guide folder 1xG5hlURViWF2gXvZGS9WP8gKl9x0w5kG):

  Build Guide Section 1: Rules & Architecture \[CURRENT\]  
    Doc ID: 1HqGJEyQSRBINSawanzSWFlBV-c0hxS8\_zhXVVbHvZeY  
    URL: https://docs.google.com/document/d/1HqGJEyQSRBINSawanzSWFlBV-c0hxS8\_zhXVVbHvZeY/edit  
    Contains: Build rules, 13 architectural decisions (L1-L13), payment architecture, funnel architecture, evidence architecture, multi-tenant strategy

  Build Guide Section 2: GHL Foundations \[CURRENT\]  
    Doc ID: 1AxjVHJWqALereUcOZGzaNmP3WIjmh1CXruAgKlOlho0  
    URL: https://docs.google.com/document/d/1AxjVHJWqALereUcOZGzaNmP3WIjmh1CXruAgKlOlho0/edit  
    Contains: GHL sub-account existing assets, 11 forms inventory (SYS2 numbering), form status/relevance audit

  Build Guide Section 3: Build Sections A-D \[CURRENT\]  
    Doc ID: 1hZLw2TA2ve5Dn0mSvg0sIAfligbZowp6JOJXXdFectc  
    URL: https://docs.google.com/document/d/1hZLw2TA2ve5Dn0mSvg0sIAfligbZowp6JOJXXdFectc/edit  
    Contains: Section A (Offer Data Architecture, 38 CO fields, associations), Section B (Client Funnel), Section C (Offer Builder), Section D (Post-Payment Enrollment)

  Build Guide Section 4: Build Sections E-K \+ Updates \[CURRENT\]  
    Doc ID: 1rfRTb9J8J37Xcs4EFvro7XmsiDG06tsizpkS5ybnnho  
    URL: https://docs.google.com/document/d/1rfRTb9J8J37Xcs4EFvro7XmsiDG06tsizpkS5ybnnho/edit  
    Contains: Section E (Evidence Workflows), Section F (Milestone System), Section G (Scenario Registry \+ S8 routes), Section H (Google Sheets \+ Apps Script), Section I (Dispute Defense), Section J (Disengagement), Section K (Testing)  
    Also contains: H1-H10 Updates, Smoke Tests \#1-2, Sections L-S (new feature specs)

  Build Guide Section 5A: Multi-Tenant Architecture (L1-L10) \[CURRENT\]  
    Doc ID: 1Gnh4QB1Hl0e3geESOrETBRAklxhn3b\_WaGiEe0fIEQM  
    URL: https://docs.google.com/document/d/1Gnh4QB1Hl0e3geESOrETBRAklxhn3b\_WaGiEe0fIEQM/edit  
    Contains: Centralized model decision (Option B), dynamic routing by location\_id, per-scenario multi-tenant analysis, cost projections, OAuth token management

  Build Guide Section 5B: Build Sequence \+ Provisioning (L11-L15) \[CURRENT\]  
    Doc ID: 1BaXoKLsJRIRowf7VJN6CfoZjmq0qdXnl36phL1R2aLg  
    URL: https://docs.google.com/document/d/1BaXoKLsJRIRowf7VJN6CfoZjmq0qdXnl36phL1R2aLg/edit  
    Contains: Strategic build sequence (Phase 1-4), S1 merchant provisioning spec, Drive folder automation, credential management

  Build Guide Section 5C: Patterns \+ Files Index \[CURRENT\]  
    Doc ID: 1o2aoxhxw0xdnzJwIDAh\_DUOUEMrk09xSZZrkycIdXiE  
    URL: https://docs.google.com/document/d/1o2aoxhxw0xdnzJwIDAh\_DUOUEMrk09xSZZrkycIdXiE/edit  
    Contains: 35 architectural patterns, complete files index

  Decision Log (Section 5D) \[CURRENT\]  
    Doc ID: 1MPYtb5Zx6o7ieNDa5fDPda2JbF5VBdp2RHx3WTBrgro  
    URL: https://docs.google.com/document/d/1MPYtb5Zx6o7ieNDa5fDPda2JbF5VBdp2RHx3WTBrgro/edit  
    Contains: All architecture decisions from 2026-02-20 onward. Check BEFORE making any new decision.

  Decision Log Part 1 (Feb 20-25) \[SUPERSEDED — contained in full Decision Log\]  
    Doc ID: 1UZSuHk2PcwOGejM4t9d0zRoKuc8m\_0CA-j5owq2pBCM  
    URL: https://docs.google.com/document/d/1UZSuHk2PcwOGejM4t9d0zRoKuc8m\_0CA-j5owq2pBCM/edit  
    Contains: Early decisions (clause library, funnel order, custom objects, milestones)

  Phase Tracker (FULL — with complete history) \[REFERENCE-ONLY\]  
    Doc ID: 1le1\_MuCpbDyFikDgZauNsKK\_dJ1QSMFRkQRWP2-oAFE  
    URL: https://docs.google.com/document/d/1le1\_MuCpbDyFikDgZauNsKK\_dJ1QSMFRkQRWP2-oAFE/edit  
    Contains: Full session history, all phase checklists, all manual action items. Use trimmed version for daily work; this one for deep historical reference.

  Session Archive \[CURRENT\]  
    Doc ID: 16UfNxYMtKWbBdD94tNNlEyss3ufkvtiCGZJi0mu\_Y2M  
    URL: https://docs.google.com/document/d/16UfNxYMtKWbBdD94tNNlEyss3ufkvtiCGZJi0mu\_Y2M/edit  
    Contains: Completed session logs moved from Phase Tracker (2026-02-27 through current)

  Phase Tracker (TRIMMED — working version) \[CURRENT\]  
    Doc ID: 13zxlz\_uCrH5BF99LUAZPeaUeOy8MZGyE2WiZ0\_7Bt6M  
    URL: https://docs.google.com/document/d/13zxlz\_uCrH5BF99LUAZPeaUeOy8MZGyE2WiZ0\_7Bt6M/edit  
    Contains: Active/pending items ONLY. Use this as daily working doc. Session start/end protocol, manual actions, P0/P1/P2 priorities.

  Feature Inventory & Product Readiness \[CURRENT\]  
    Doc ID: 1gC93vmpqIwaWjwTc0l1Y9VbzHJ5gGULGAhs0roeKWj0  
    URL: https://docs.google.com/document/d/1gC93vmpqIwaWjwTc0l1Y9VbzHJ5gGULGAhs0roeKWj0/edit  
    Contains: Complete feature inventory with 5 status updates. \~46 built, 5 partial, \~10 not built, \~28 brainstorm

  Master Contents Index (THIS DOCUMENT)  
    Doc ID: 1k-wyzU5sjOT9JcwBkepzZXpXXzHmePBH5e45PhiGSmk  
    URL: https://docs.google.com/document/d/1k-wyzU5sjOT9JcwBkepzZXpXXzHmePBH5e45PhiGSmk/edit

REFERENCE DOCS:

  accept.blue API v2 Reference \[REFERENCE-ONLY\]  
    Doc ID: 1e0Oj5\_VU7NiwYKs1J4pfQKavDHq1zqsRz23dGGGepcg  
    URL: https://docs.google.com/document/d/1e0Oj5\_VU7NiwYKs1J4pfQKavDHq1zqsRz23dGGGepcg/edit

  accept.blue Webhooks v1 Reference \[REFERENCE-ONLY\]  
    Doc ID: 1RhYod\_m6U8BdcHO3kzLv8LonuK9lSzGHTo4UD\_myf\_I  
    URL: https://docs.google.com/document/d/1RhYod\_m6U8BdcHO3kzLv8LonuK9lSzGHTo4UD\_myf\_I/edit

  External Integration Guide (S9) \[REFERENCE-ONLY\]  
    Doc ID: 1Pe-U\_tHy3J-PtT4eyF62HaxOS6BAHoiwedQnPLyjcNk  
    URL: https://docs.google.com/document/d/1Pe-U\_tHy3J-PtT4eyF62HaxOS6BAHoiwedQnPLyjcNk/edit

  Merchant Operating Manual v1.0 \[CURRENT\]  
    Doc ID: 1rawSCBEuYIJQIxn06sWcFtuA64yHlVkTiilBUQcrfrU  
    URL: https://docs.google.com/document/d/1rawSCBEuYIJQIxn06sWcFtuA64yHlVkTiilBUQcrfrU/edit

  Plain English System Guide (latest — most detailed) \[CURRENT\]  
    Doc ID: 1pqv0grldcNLK5F8siDY12VJeWcDq753rV3gCK5fAIM8  
    URL: https://docs.google.com/document/d/1pqv0grldcNLK5F8siDY12VJeWcDq753rV3gCK5fAIM8/edit  
  Plain English System Guide (earlier versions) \[ALL SUPERSEDED\]:  
    v3: 195IrLwZCls2VxNneXX48B8boX0f31tEm0YjmNiOAmLI  
    v2: 1aFVL31ietdfp8cbHsnChHfkqPRSntRBPHKQEGq1W5Ko  
    v1: 1ufFEnv-BTpDv0gpTDoiJTeNYXC56XCrNLbvkpJjSgfI

BUILD INSTRUCTIONS:

  Merchant Onboarding Funnel (CORRECTED — 4 pages) \[CURRENT\]  
    Doc ID: 137NqST4u5lFAu2KhWW8Lz2FZrprSnO\_nN-VGaE-cO6s  
    URL: https://docs.google.com/document/d/137NqST4u5lFAu2KhWW8Lz2FZrprSnO\_nN-VGaE-cO6s/edit

  Merchant Onboarding Funnel (original — 3 pages) \[SUPERSEDED\]  
    Doc ID: 1daXYVQpn\_ee8g6M5CFY-heU14yTa6m9HakpIXAWdrhM  
    URL: https://docs.google.com/document/d/1daXYVQpn\_ee8g6M5CFY-heU14yTa6m9HakpIXAWdrhM/edit

  Offer Form Build Instructions v2 (2-step funnel) \[CURRENT\]  
    Doc ID: 18QsH5xGYBDC5hp8a6u5y9tdXX4aGcbFVSEquWgF8jSQ  
    URL: https://docs.google.com/document/d/18QsH5xGYBDC5hp8a6u5y9tdXX4aGcbFVSEquWgF8jSQ/edit

  Offer Form Update — Clause-Per-Offer \[SUPERSEDED — incorporated into v2 build spec\]  
    Doc ID: 1ZTuiMPPyijo6NIYS421zfS\_kZtSNqS3VOyvGw4sxOqw  
    URL: https://docs.google.com/document/d/1ZTuiMPPyijo6NIYS421zfS\_kZtSNqS3VOyvGw4sxOqw/edit

CODE FILES (in Code Snapshots folder 1kuFsE4II\_DMetbICWfot05UuGefQl734):  
  Folder URL: https://drive.google.com/drive/folders/1kuFsE4II\_DMetbICWfot05UuGefQl734

  Milestone Sign-Off Page Code  
    Doc ID: 1CoqNhpiFOu-9lNQH-oAfV2D9L3jJbRCUoFn7TFubUdA  
    URL: https://docs.google.com/document/d/1CoqNhpiFOu-9lNQH-oAfV2D9L3jJbRCUoFn7TFubUdA/edit

  Dynamic Merchant Logo Snippet  
    Doc ID: 1wdzltllL4qQsr1TKJeU9wpGB2QaxrJOU--7tngYZh0A  
    URL: https://docs.google.com/document/d/1wdzltllL4qQsr1TKJeU9wpGB2QaxrJOU--7tngYZh0A/edit

  Page 3 Consent Code (v4 — CURRENT, field fix)  
    Doc ID: 1w-KydTNhgQj52xmQ6\_0vswNVdSjQqBUi7NkBifYBy4c  
    URL: https://docs.google.com/document/d/1w-KydTNhgQj52xmQ6\_0vswNVdSjQqBUi7NkBifYBy4c/edit  
  Page 3 Consent Code v5 (placeholder — code delivered as HTML file, not in Google Doc)  
    Placeholder docs: 1pt-LTQPAwkEAiXyQiebiqsRG2jIV7g\_nSjhiqye2m1Y, 1REF1PcacunYlCV1UAbu8xktlXVInERdtXR9\_WORy7kE

  Page 4 Payment Code (CURRENT — full code)  
    Doc ID: 17GmvPzFuVi3O0NyXWYjAQMPenyDStOtvDy0LJNjqEEM  
    URL: https://docs.google.com/document/d/17GmvPzFuVi3O0NyXWYjAQMPenyDStOtvDy0LJNjqEEM/edit  
  Page 4 Payment Code v3 (CLEAN — syntax verified, ready for GHL)  
    Doc ID: 1pLuKMfTglm\_YzcOkqxD7ecdAgvRCfqOU3TteRFLn8OU  
    URL: https://docs.google.com/document/d/1pLuKMfTglm\_YzcOkqxD7ecdAgvRCfqOU3TteRFLn8OU/edit  
  Page 4 Payment Code (earlier versions):  
    CLEAN copy: 1a5d9rLrSLowMegG7kHtTT-7GtfiPf3wo\_6fMUBvm3pU  
    March 11 copy: 1dFyEKV3qf9XN3iwEOqNpnWYA4ZnCBR0E1uTOgc3J3YI

ASSOCIATIONS:

  offers\_contacts: 699b8cbcb44f1833f8985b76  
  offers\_opportunities: 699b8ccf9f284d4f4cd76c8e

\================================================================  
KNOWN PENDING ITEMS (as of 2026-03-20)  
\================================================================

P0 — SHOWSTOPPERS:  
  \- Page 3 timing fix  
  \- Page 4 PIF/installment toggle missing

P1 — HIGH PRIORITY:  
  \- S10 installment logger $0.00 / "Unknown" bug  
  \- S7 Route 4 (failed payment) testing  
  \- S7 error handling build (CRITICAL)  
  \- S8 error handling build (HIGH)

P2 — NEXT UP:  
  \- Payment lifecycle Phase 2+ (dunning, card update, merchant tools)  
  \- 7 unwired S8 evidence routes  
  \- S11 defense packet PDF markdown issue  
  \- Multi-reason-code testing (13.1, 13.3, 13.6, 13.7)  
  \- S14 multi-location support  
  \- GHL Workflow 9 \+ SYS2-11 Cancellation (Oke building)

PHILIP MANUAL ACTIONS:  
  \- Populate accept.blue custom values for PMG  
  \- Re-paste Page 3 consent code  
  \- Re-paste Page 4 payment code  
  \- Add Refund Window Text \+ Delivery Method to Custom Object (GHL UI)  
  \- Delete temp Google Drive items (listed in Phase Tracker)  
  \- Delete temp Make.com tools (listed in Phase Tracker)