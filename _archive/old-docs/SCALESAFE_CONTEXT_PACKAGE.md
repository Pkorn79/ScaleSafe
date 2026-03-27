# ScaleSafe — Complete Context Package for Claude Code
## Version: 2026-03-24 | Prepared by: Claude (Cowork) for Claude Code handoff

---

## HOW TO USE THIS DOCUMENT

You are Claude Code, working in a Node.js project repository for ScaleSafe. This document is your complete briefing. Read it fully before writing any code or making any architectural decisions.

**Your role:** Senior full-stack engineer and product architect. Philip Korniotes (non-technical founder) is directing the build. He relies on you to think like an experienced developer AND product manager. Give solid feedback, question assumptions, and propose better approaches when you see them.

**Your freedom:** The business logic documented here was proven in a Make.com prototype. You should treat it as "validated requirements" — the WHAT is correct, but the HOW is entirely up to you. If there's a better architectural approach in Node.js, propose it. If something should be a GHL native automation instead of app code, say so. You are not recreating Make.com scenarios — you are building a production SaaS application.

**Google Drive docs:** Philip's Google Drive contains all historical build documentation. Key doc IDs are listed in Section 11. When you need deep detail on any component, ask Philip to fetch the specific doc, or reference it by ID.

---

## SECTION 1: WHAT IS SCALESAFE

ScaleSafe is a **chargeback defense SaaS** for high-ticket coaching businesses.

**The problem:** When a coaching client disputes a credit card charge (files a chargeback), the coach has 7-10 days to prove they delivered the service. Most coaches have no organized evidence and lose by default — losing the revenue PLUS a $25-100 chargeback fee. In the high-ticket coaching space ($3K-$25K programs), a single lost chargeback can cost $5K-$25K+.

**The solution:** ScaleSafe automatically collects evidence of service delivery throughout the client relationship — session logs, milestone sign-offs, satisfaction pulse checks, payment records, T&C consent — and stores it in a structured database. When a chargeback occurs, ScaleSafe uses AI (Claude API) to compile all evidence into a professional defense packet ready for submission.

**Think of it as:** An automated security camera system for coaching businesses that's always recording proof of service delivery, plus an AI lawyer that writes your defense when you need it.

**Target market:** High-ticket coaching businesses ($3K+ programs) using GoHighLevel (GHL) as their CRM.

**Business model:** SaaS subscription — merchants install ScaleSafe as a GHL Marketplace app in their sub-account.

---

## SECTION 2: HOW IT WORKS (THE FLOW)

### Merchant Setup
1. Merchant installs ScaleSafe from GHL Marketplace
2. System provisions their evidence database, folder structure, and configuration
3. Merchant enters their accept.blue payment credentials and business info

### Offer Creation
1. Merchant creates a coaching "offer" (program definition): name, price, payment terms, milestones, T&C clauses
2. System stores the offer in GHL's Custom Objects with all metadata

### Client Enrollment
1. Client arrives at enrollment page, sees offer details and T&C
2. Client accepts terms (clickwrap consent — timestamped, IP-logged)
3. Client enters payment info (card or ACH)
4. Payment processes through accept.blue
5. If installments: recurring schedule created in accept.blue
6. Contact record populated with offer data, opportunity created in pipeline
7. Enrollment evidence logged to Supabase

### Ongoing Evidence Collection (automatic)
- **Session logs:** Coach submits form after each session → logged to Supabase
- **Module progress:** Client completes course module → logged
- **Milestone sign-offs:** Client acknowledges milestone completion → logged
- **Pulse checks:** Periodic satisfaction check-ins → logged
- **Payment events:** Every payment success/failure → logged
- **No-shows:** Missed sessions tracked → logged
- **External integrations:** Calendly, Zoom, Kajabi data → logged via webhook

### Payment Lifecycle (recurring clients)
- accept.blue processes recurring charges automatically
- Each payment event fires a webhook → app routes to appropriate handler
- Success: log evidence, update contact fields
- Failure: log evidence, update status, initiate dunning sequence
- Refund: log evidence, update fields, flag for defense

### Chargeback Defense
1. Chargeback filed → triggers defense compilation
2. AI Defense Compiler pulls ALL evidence for the disputed client from Supabase
3. Claude API analyzes evidence and writes a professional defense letter
4. Defense packet generated as PDF with supporting evidence attached
5. Ready for submission to processor/bank

---

## SECTION 3: TECH STACK

### Current (Prototype — Make.com)
- **CRM:** GoHighLevel (GHL) — contacts, pipelines, forms, workflows, custom objects, custom fields, custom values
- **Automation:** Make.com — 11+ scenarios handling all business logic
- **Payments:** accept.blue — card + ACH processing, recurring schedules, webhooks
- **Evidence DB:** Supabase (PostgreSQL) — structured evidence tables
- **AI:** Claude API (Anthropic) — defense letter compilation
- **Documents:** Google Docs/Drive (being eliminated — replaced by programmatic PDF generation)

### Target (Production — Node.js App)
- **Runtime:** Node.js 18+ with Express.js (from GHL Marketplace App Template)
- **Frontend:** Vue 3 (from GHL template) — for merchant portal/settings pages within GHL
- **GHL Integration:** @gohighlevel/api-client (official SDK) — OAuth, API calls, token management
- **Payments:** accept.blue REST API — direct HTTP calls with HMAC-SHA256 webhook verification
- **Evidence DB:** Supabase — continue using existing tables (already production-ready)
- **AI:** Claude API via @anthropic-ai/sdk — defense compilation
- **PDF Generation:** Use a Node.js library (pdfkit, puppeteer, or docx+pdf) — replaces Google Docs entirely
- **Hosting:** TBD (Render, Railway, Vercel, or similar)
- **Repo:** https://github.com/Pkorn79/ScaleSafe

### GHL Marketplace App Requirements
- OAuth 2.0 flow (handled by GHL template)
- SSO decryption for embedded custom pages
- Webhook handling for GHL events
- Distribution: Sub-account target, Both Agency and Sub-account install rights, Bulk install enabled
- Official SDK: `@gohighlevel/api-client` (wraps all REST endpoints, handles token rotation)

---

## SECTION 4: GHL DATA MODEL

### Custom Objects
**Offers** (custom_objects.offers)
- Stores program definitions: name, price, payment type (PIF/installment), frequency, number of payments
- Up to 8 milestones per offer, each with: name, deliverables, client responsibilities
- T&C clause selections (9 standard + 2 custom per offer)
- Refund policy reference

### Contact Custom Fields (on each enrolled client)
**Offer-prefix fields** (copied from offer at enrollment):
- Offer Program Name, Offer Price, Offer Payment Type, Offer Frequency
- Offer Installment Amount, Offer Number of Payments
- Milestone 1-8 Name, Milestone 1-8 Description
- T&C clause selections

**SS-prefix fields** (system tracking):
- SS Subscription Start, SS Payment Status, SS Last Payment Date
- SS Total Paid, SS Payments Made, SS Payments Remaining
- Current Milestone Name, Current Milestone Number
- SS Subscription ID (accept.blue recurring schedule ID)

**19 Payment custom fields** (created 2026-03-20, NOT YET POPULATED by code):
- Payment Status dropdown: Current, Past Due, Failed, Cancelled, Completed
- Various payment tracking fields that need to be written to on each payment event

### Location Custom Values (per-merchant config)
**Payment Processing:**
- SS Accept.blue API Key
- SS Accept.blue Tokenization Key
- SS Accept.blue Webhook Signature

**System Config:**
- Evidence Sheet ID (legacy — Supabase replaced this)
- Merchant Business Name, Support Email, Descriptor
- TC Document URL, TC Has Own

**Evidence Module Toggles:**
- Module Session Tracking, Module Milestone Tracking, Module Pulse Check
- Module Payment Tracking, Module Course Progress

**Incentive Program:**
- Incentive Program Enabled, Tier 1/2 Description, Tier 1/2 Threshold

### Pipeline: Client Milestones
- Stages: New Client → M1 → M2 → M3 → M4 → M5 → M6 → M7 → M8
- Each stage = a milestone from the client's offer
- Stage transitions logged as evidence

### GHL Forms (evidence collection triggers)
- SYS2-07: Session Log (coaching session records)
- SYS2-08: Module Progress (course module completion)
- SYS2-06: Milestone Sign-Off (client acknowledges milestone)
- SYS2-09: Pulse Check (satisfaction snapshots)
- SYS2-10: Payment Update (payment event notes)
- SYS2-11: Cancellation (cancellation requests)

---

## SECTION 5: ACCEPT.BLUE INTEGRATION

### Authentication
- REST API with API key authentication
- Each merchant has their OWN accept.blue account and API key
- API key stored in GHL Custom Values per location

### Webhook Events
All events send to a single endpoint. Filter by `type` and `subType`.

| Event | type | subType | Use |
|-------|------|---------|-----|
| Charge succeeded | succeeded | charge | Log payment, update contact |
| Recurring succeeded | succeeded | charge | Log installment, update payment count |
| Refund succeeded | succeeded | refund | Log refund, flag for defense |
| Transaction declined | declined | charge/refund/etc | Log failure, trigger dunning |
| Transaction error | error | charge/etc | Log error, alert merchant |
| ACH status update | status | settled/returned/etc | ACH-specific handling |
| Batch closed | closed | (batch event) | Reconciliation trigger |

### Webhook Verification
- Header: `X-Signature`
- Method: HMAC-SHA256 of request body using merchant's webhook signature key
- MUST verify on every webhook

### Idempotency
- Each event has a unique `id` field
- MUST track processed event IDs to prevent duplicate handling
- Current implementation uses a datastore; Node.js app should use Supabase or Redis

### Current Webhook Endpoints (Make.com — will be replaced)
- Webhook 1566 → Post-Payment Handler (all transaction events)
- Webhook 1620 → Installment Logger (installment-specific)
- These will be replaced by Express routes in the Node.js app

### Key accept.blue API Operations
- Create charge (one-time payment)
- Create recurring schedule (installment plans)
- Get transaction details
- Get recurring schedule details
- Create/manage customers
- Process refunds

---

## SECTION 6: SUPABASE EVIDENCE DATABASE

### Evidence Tables (existing — continue using)
Each evidence type has its own table. All tables include: contact_id, location_id, timestamp, and type-specific fields.

- **evidence_sessions** — Coaching session records (date, duration, topics, notes)
- **evidence_modules** — Module/course completion records
- **evidence_milestones** — Milestone delivery sign-offs
- **evidence_pulse** — Client satisfaction pulse checks
- **evidence_payments** — Payment events (success, failure, refund)
- **evidence_enrollment** — Enrollment consent + payment records
- **evidence_cancellation** — Cancellation requests
- **evidence_noshow** — Missed session records
- **evidence_refund_activity** — Refund tracking for defense

### Key Design Decisions
- All evidence is immutable (append-only audit trail)
- Every record tied to contact_id + location_id for multi-tenant isolation
- Timestamps are server-side (not client-submitted)
- This data is what the AI Defense Compiler reads to build defense packets

---

## SECTION 7: WHAT'S BUILT AND WORKING (Proven in Make.com)

These features have been tested and confirmed working. The business logic is validated — implement equivalents in the Node.js app.

### Scenarios (Business Logic — translate to Express routes/services)
1. **Merchant Provisioning** — Creates evidence DB structure for new merchant
2. **Offer Creation** — Saves offer to GHL Custom Objects with all metadata
3. **Client Enrollment Prep** — Fetches offer data, populates contact fields
4. **Offer Data Fetch** — Returns offer details for payment page
5. **Charge Processor** — Processes card/ACH via accept.blue (multi-tenant with dynamic API key)
6. **Post-Payment Handler (Dispatcher Pattern):**
   - Payment Router — receives all accept.blue webhooks, routes by type
   - Enrollment Handler — first payment, creates opportunity, initiates evidence trail
   - Recurring Payment Handler — installment payments, logs evidence, updates contact
   - Refund Handler — logs refund evidence, updates 3 contact fields
   - Failed Payment Handler — logs failure, updates status
7. **Evidence Logger** — 7-route evidence router (receives GHL form data, writes to Supabase)
8. **Evidence PDF Generator** — Generates formatted evidence PDFs
9. **External Integration Catcher** — Universal webhook for third-party tools (Calendly, Zoom, etc.)
10. **Installment Logger** — Tracks recurring payment schedule

### GHL Components (Keep as-is — these live in GHL)
- Client Milestones Pipeline (8 stages)
- Offers Custom Object
- All Contact Custom Fields (Offer- and SS- prefixes)
- Location Custom Values (SS- prefix config keys)
- Evidence collection forms (SYS2-06 through SYS2-11)
- Workflows that fire forms → webhook to app
- T&C Clause system (9 standard + 2 custom per offer)
- Incentive Program config

---

## SECTION 8: WHAT NEEDS TO BE BUILT

### App Infrastructure (NEW — doesn't exist yet)
- [ ] Express.js app from GHL Marketplace template
- [ ] OAuth flow for GHL Marketplace
- [ ] SSO for embedded custom pages
- [ ] Webhook receiver for accept.blue events (replaces Make.com webhooks)
- [ ] Webhook receiver for GHL form/workflow events (replaces Make.com webhooks)
- [ ] GHL SDK integration for all API calls
- [ ] Supabase client for evidence read/write
- [ ] accept.blue API client with per-merchant credentials
- [ ] Claude API client for defense compilation
- [ ] PDF generation service (replaces Google Docs)
- [ ] Idempotency tracking (Redis or Supabase)
- [ ] Error handling and alerting
- [ ] Merchant portal UI (Vue 3 — settings, evidence viewer, defense status)

### Payment Lifecycle (48 functions specced, 19 built, 29 NOT BUILT)
**Categories of unbuilt functions:**
1. **Dunning/retry** — Automated retry on failed recurring payments (3 attempts, configurable intervals, escalation)
2. **Subscription management** — Pause, resume, cancel, modify recurring schedules via accept.blue API
3. **Card update flow** — When client's card expires/fails, send them a secure link to update payment method
4. **Merchant notifications** — Email/SMS to merchant on: payment success, failure, refund, chargeback
5. **Client notifications** — Email/SMS to client on: payment receipt, upcoming charge, failed payment, card expiring
6. **Payment field population** — Write to all 19 payment custom fields on each payment event (fields exist but are empty)
7. **Payment reconciliation** — Daily check: compare accept.blue transactions against Supabase evidence to catch missed webhooks
8. **Reporting** — Payment summary dashboard for merchants

### AI Defense Compiler (S11 — partially designed, not fully built)
- Pulls ALL evidence for a contact from Supabase
- Sends to Claude API with defense prompt template
- Claude writes professional defense letter
- Output saved as PDF
- **NOTE:** In Make.com this had a timeout risk (40s limit vs 30-60s Claude response). In Node.js this is solved — no timeout constraint.

### Merchant Onboarding Automation
- Automated provisioning when merchant installs from GHL Marketplace
- Currently manual process with form + scenario

---

## SECTION 9: ARCHITECTURAL DECISIONS FOR YOU TO MAKE

These are decisions that should be made during planning. The Make.com prototype made certain choices due to platform constraints. You are free to redesign.

### 1. GHL Automations vs App Code
**Question:** Some functions (notifications, pipeline stage changes, simple field updates) might be better as GHL native workflows triggered by your app, rather than coded in Node.js. Where's the line?

**Guidance:** GHL workflows are good for: sending emails/SMS, internal notifications, simple pipeline moves. Your app should handle: payment processing, evidence logging, API integrations, complex logic, anything requiring external API calls.

### 2. Evidence Storage Architecture
**Question:** Continue with per-type Supabase tables, or consolidate into a single events table with a `type` column?

**Current:** Separate tables (evidence_sessions, evidence_modules, etc.)
**Consider:** A single `evidence_events` table might simplify queries for the AI Defense Compiler, which needs ALL evidence for a contact regardless of type.

### 3. Webhook Architecture
**Question:** Single webhook endpoint that routes internally, or multiple dedicated endpoints?

**Current Make.com approach:** Separate webhooks per event type
**Consider:** Single `/webhooks/acceptblue` endpoint with internal routing might be simpler

### 4. Multi-Tenant Token Management
**Question:** How to store and manage per-merchant GHL OAuth tokens and accept.blue API keys?

**GHL template approach:** File-based token storage
**Consider:** Supabase `merchants` table or Redis for production token management

### 5. Queue vs Direct Processing
**Question:** Should webhook events be processed immediately (direct) or queued (BullMQ/Redis)?

**Consider:** For production at scale (100+ merchants), queuing prevents webhook timeout and enables retry. For MVP, direct processing is simpler.

### 6. PDF Generation Approach
**Question:** How to generate evidence defense packets?

**Options:** HTML template → Puppeteer → PDF, or docx template → pdf, or pdfkit direct generation
**Consider:** HTML → PDF via Puppeteer is most flexible and allows rich formatting

---

## SECTION 10: KNOWN RISKS AND GOTCHAS

1. **accept.blue webhook retry behavior** — Failed webhook deliveries are retried, but exact retry schedule is undocumented. Must handle idempotently.

2. **GHL OAuth token expiry** — Tokens expire and must be auto-refreshed. The official SDK handles this, but storage must be persistent.

3. **GHL rate limits** — API has rate limits per location. Batch operations need throttling.

4. **Supabase row-level security** — Ensure multi-tenant data isolation. Each merchant should only access their own evidence.

5. **Claude API latency** — Defense compilation can take 30-60s. Must be async (not blocking webhook handlers).

6. **GHL Custom Object field keys** — Field keys use full paths like `custom_objects.offers.program_name`. The GHL SDK may handle this differently than the CuratedConnector modules did.

7. **accept.blue per-merchant accounts** — Each merchant has their own accept.blue account. API keys are stored in GHL Custom Values per location. No shared processing.

8. **Evidence immutability** — Evidence records must never be updated or deleted. Append-only for legal defensibility.

---

## SECTION 11: GOOGLE DRIVE DOCUMENT MAP

These are the key reference docs in Philip's Google Drive. Reference by ID when you need deep detail.

### Current Documents (use these)
| Document | Google Doc ID | What It Contains |
|----------|---------------|------------------|
| Master Contents Index | 1k-wyzU5sjOT9JcwBkepzZXpXXzHmePBH5e45PhiGSmk | Fast-lookup directory for every component |
| Phase Tracker (Trimmed) | 13zxlz_uCrH5BF99LUAZPeaUeOy8MZGyE2WiZ0_7Bt6M | Current phase, pending items, what's next |
| Feature Inventory | 1gC93vmpqIwaWjwTc0l1Y9VbzHJ5gGULGAhs0roeKWj0 | Complete inventory: built vs not-built vs brainstorm |
| Payment Lifecycle Build Plan | 1kjC-m83xRAJykhYLdTq_0c8iyvNzTQf8-J3Utihlmp4 | 48 functions across 8 categories, architecture decisions |
| Plain English System Guide | 1pqv0grldcNLK5F8siDY12VJeWcDq753rV3gCK5fAIM8 | What each piece does in normal words |
| Merchant Operating Manual | 1rawSCBEuYIJQIxn06sWcFtuA64yHlVkTiilBUQcrfrU | How merchants use ScaleSafe |
| accept.blue Webhooks Reference | 1RhYod_m6U8BdcHO3kzLv8LonuK9lSzGHTo4UD_myf_I | Webhook events, verification, event types |
| External Integration Guide | 1Pe-U_tHy3J-PtT4eyF62HaxOS6BAHoiwedQnPLyjcNk | How third-party tools feed evidence into ScaleSafe |
| Session Archive | 16UfNxYMtKWbBdD94tNNlEyss3ufkvtiCGZJi0mu_Y2M | Historical record of all completed session work |
| Audit Package (2026-03-24) | 1SW8EMsI1hq_T81AJogxqaH1fBnymwR1B-mJ-zo-wWdo | Full systems audit prepared for external LLM review |
| Merchant Onboarding Instructions | 137NqST4u5lFAu2KhWW8Lz2FZrprSnO_nN-VGaE-cO6s | Funnel build specs (4-page structure) |
| Problem Validation Doc | 1AdrupYu3W1d3BCHCMQmNACNVlA5tg5-TKkmOHLCkrTk | Market research, ICP pain points, validation data |
| Offer Form Build Instructions | 18QsH5xGYBDC5hp8a6u5y9tdXX4aGcbFVSEquWgF8jSQ | 2-step funnel specs |

### Superseded Documents (DO NOT USE for building)
- Doc 195IrLwZCls2VxNneXX48B8boX0f31tEm0YjmNiOAmLI — old Plain English Guide
- Doc 1aFVL31ietdfp8cbHsnChHfkqPRSntRBPHKQEGq1W5Ko — old Plain English Guide
- Doc 1ufFEnv-BTpDv0gpTDoiJTeNYXC56XCrNLbvkpJjSgfI — placeholder
- Doc 1qbe6At0RWKhWbchzdP-7zNELzG6LeQHuZ8TQ-PZQWCg — placeholder
- Doc 1daXYVQpn_ee8g6M5CFY-heU14yTa6m9HakpIXAWdrhM — old onboarding funnel (3-page, wrong)
- Doc 1ZTuiMPPyijo6NIYS421zfS_kZtSNqS3VOyvGw4sxOqw — old clause-per-offer (superseded)

---

## SECTION 12: PLANNING MODE INSTRUCTIONS

When you start in `/plan` mode, here's the recommended approach:

### Phase 1: Architecture Design
1. Read this entire context package
2. Design the app architecture: folder structure, module organization, service layers
3. Decide: what's app code vs GHL automation vs Supabase function
4. Design the database schema (merchants table, token storage, idempotency tracking)
5. Design the webhook routing architecture
6. Design the evidence compilation and PDF generation pipeline
7. Present the architecture to Philip for review

### Phase 2: Foundation Build
1. Clone and restructure the GHL Marketplace App Template
2. Set up: Express routes, middleware, error handling, logging
3. Implement: OAuth flow, SSO, GHL SDK initialization
4. Implement: Supabase client, accept.blue client
5. Implement: Webhook signature verification
6. Test: Basic app runs, OAuth flow works, can make GHL API calls

### Phase 3: Core Business Logic
1. Merchant provisioning (on app install)
2. Offer CRUD (create, read, update offers in GHL Custom Objects)
3. Enrollment flow (enrollment prep → charge → post-payment)
4. Payment webhook handling (all accept.blue events)
5. Evidence logging (all form submission → Supabase writes)

### Phase 4: Advanced Features
1. Payment lifecycle (dunning, subscription management, notifications)
2. AI Defense Compiler (Claude API integration → PDF output)
3. Payment reconciliation (daily safety net)
4. Merchant portal UI (Vue 3 — settings, evidence viewer)

### Phase 5: Production Hardening
1. Error handling and alerting
2. Rate limiting and queuing
3. Multi-tenant security audit
4. GHL Marketplace submission prep

---

## SECTION 13: KEY CREDENTIALS AND IDS (Development/Test)

**GHL Test Location (PMG):** 274dtgl30b7x2HG8hn69
**GHL Connection ID (Make.com — legacy):** 4679047

**Accept.blue test webhook signatures:**
[REMOVED — secrets should not be in repo]

**GHL App credentials:** Will need to be created in the GHL Developer Portal for the marketplace app (CLIENT_ID, CLIENT_SECRET, SSO_KEY)

**Supabase:** Existing project — credentials to be provided by Philip

**Claude API:** Key to be provided by Philip

**NOTE:** Never commit credentials to the repo. Use `.env` file (gitignored).

---

## SECTION 14: MAKE.COM SCENARIO IDS (Reference Only)

These are the existing Make.com scenarios. They contain proven business logic that should be translated (not copied) to Node.js. Reference only — they will be deactivated once the app is live.

| Scenario | Make.com ID | Webhook URL |
|----------|-------------|-------------|
| Merchant Provisioning | 4606347 | hook.us1.make.com/i5l3p... |
| Offer Creation | 4575869 / 4620342 | GHL form trigger |
| Client Enrollment Prep | 4576733 | GHL workflow trigger |
| Offer Data Fetch | 4578929 | HTTP call from Page 2 |
| Charge Processor | 4579164 | HTTP call from Page 4 |
| Payment Router | 4631641 | accept.blue webhook |
| Enrollment Handler | 4631642 | Internal from Router |
| Recurring Handler | 4631643 | Internal from Router |
| Refund Handler | 4631644 | Internal from Router |
| Failed Handler | 4631645 | Internal from Router |
| Evidence Logger | (S8) | GHL workflow triggers |
| Evidence PDF Generator | (S8b) | Internal trigger |
| External Integration Catcher | (S9) | Public webhook URL |
| Installment Logger | (S10) | accept.blue webhook 1620 |
| AI Defense Compiler | (S11) | Manual/chargeback trigger |

---

*End of context package. This document should be placed in the root of the ScaleSafe repository as `SCALESAFE_CONTEXT_PACKAGE.md` and referenced by Claude Code at the start of every session.*
