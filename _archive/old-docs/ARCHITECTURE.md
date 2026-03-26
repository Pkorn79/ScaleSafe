# ScaleSafe — Architecture Guide

Last Updated: 2026-03-24 (Phase 1)

## What Is This App?

ScaleSafe is a chargeback defense system for coaching businesses. It runs as a GHL (GoHighLevel) Marketplace app — merchants install it into their GHL sub-account, and it:

1. **Collects evidence** of service delivery (sessions, milestones, payments, T&C consent, etc.)
2. **Stores evidence** in Supabase (structured PostgreSQL database)
3. **Compiles defense packets** using AI (Claude API) when chargebacks occur
4. **Generates PDFs** ready for submission to banks/processors

## How The App Is Organized

```
src/
├── index.ts          → Starts the server
├── app.ts            → Creates the Express app with all middleware and routes
├── config.ts         → Loads and validates environment variables
│
├── middleware/        → Express middleware (runs on every request or specific routes)
│   ├── errorHandler  → Catches all errors, returns proper HTTP responses
│   ├── requestLogger → Logs every request with timing
│   └── ssoAuth       → Decrypts GHL SSO keys for merchant authentication
│
├── routes/           → HTTP endpoint definitions (URL → controller)
│   ├── health        → /health and /ready endpoints
│   └── auth          → OAuth callback and SSO decryption
│
├── clients/          → Wrappers for external APIs
│   ├── ghl           → GoHighLevel API (OAuth, contacts, custom objects)
│   ├── acceptblue    → accept.blue payment processing (charges, refunds, recurring)
│   └── supabase      → Database client
│
├── repositories/     → Database query layer (Supabase CRUD operations)
│   └── merchant      → Read/write merchant records + token storage
│
├── utils/            → Shared utilities
│   ├── logger        → Structured logging (pino)
│   ├── errors        → Custom error classes (BadRequest, NotFound, etc.)
│   └── crypto        → HMAC verification + SSO decryption
│
└── ui/               → Vue 3 frontend (merchant portal, served as static files)
```

## Key Architecture Patterns

### 1. Layered Architecture
```
Route → Controller → Service → Repository → Supabase
                       ↓
                    Client → External API (GHL, accept.blue, Claude)
```

- **Routes** define URLs and HTTP methods
- **Controllers** (Phase 2+) validate input and call services
- **Services** (Phase 2+) contain all business logic
- **Repositories** handle database queries
- **Clients** wrap external API calls

### 2. Multi-Tenant Isolation
Every database query includes `location_id` (the GHL sub-account ID). This ensures one merchant can never see another merchant's data. The `tenantContext` middleware extracts the location_id from SSO or webhook payloads and attaches it to the request.

### 3. Token Management
GHL OAuth tokens are stored in the Supabase `merchants` table (not in memory). The GHL client automatically refreshes expired tokens on 401 responses. This replaces the template's in-memory storage, which would lose tokens on server restart.

### 4. Webhook Security
accept.blue webhooks are verified using HMAC-SHA256. The raw request body is preserved during JSON parsing specifically for this verification step.

## External Services

| Service | Purpose | Auth Method |
|---------|---------|-------------|
| GHL API | CRM operations (contacts, custom objects, pipelines) | OAuth 2.0 Bearer token |
| accept.blue | Payment processing (charges, refunds, recurring) | Basic Auth (source key) |
| Supabase | Evidence database + merchant config | Service role key |
| Claude API | AI defense letter generation (Phase 4) | API key |

## What's Built (Phase 1)

- Express app with middleware stack (logging, error handling, JSON parsing)
- GHL OAuth flow (authorize → exchange code → store tokens in Supabase)
- SSO decryption for embedded GHL pages
- accept.blue API client with per-merchant Basic Auth
- Supabase client (singleton)
- Health check endpoints (/health, /ready)
- Environment validation (fails fast on missing config)
- Structured logging (pino)

## What's Built (Phase 2)

### Webhook Flow
```
accept.blue event → POST /webhooks/acceptblue
  → Idempotency check (skip if duplicate)
  → Identify merchant via ab_customer_map (Phase 3)
  → Verify HMAC signature
  → Route by type/subType → payment handler
  → Log evidence to Supabase
  → Respond 200

GHL form submission → POST /webhooks/ghl
  → Extract form_id from payload
  → Route to evidence table by form ID
  → Log evidence to Supabase
  → Respond 200

External tool → POST /webhooks/external
  → Validate payload (source, event_type, location_id, contact)
  → Route by event_type to evidence table
  → Log evidence to Supabase
  → Respond 200
```

### Evidence Tables (10 total)
| Table | Source | What It Stores |
|-------|--------|----------------|
| evidence_sessions | SYS2-07 form, Calendly/Zoom | Coaching session records |
| evidence_modules | SYS2-08 form, Teachable/Kajabi | Module/course completion |
| evidence_milestones | SYS2-06 form, sign-off page | Milestone delivery sign-offs |
| evidence_pulse | SYS2-09 form, surveys | Client satisfaction checks |
| evidence_payments | SYS2-10 form, accept.blue | Payment events |
| evidence_enrollment | Enrollment flow | T&C consent + first payment |
| evidence_cancellation | SYS2-11 form | Cancellation requests |
| evidence_noshow | GHL workflow | Missed sessions |
| evidence_refund_activity | accept.blue refund webhook | Refund tracking |
| evidence_service_access | Kajabi/Skool/Teachable | Platform access logs |

### Idempotency
accept.blue retries failed webhook deliveries. The idempotency system tracks each event by `(event_id, source)` in the `idempotency_keys` table. If the combination already exists, the handler is skipped. The `withIdempotency()` wrapper makes this transparent to handlers.

## What's Built (Phase 3)

### Enrollment Flow (the core business loop)
```
Client sees offer → Page 2 calls GET /api/enrollment/offer/:offerId
  → Returns offer with milestones, T&C, pricing

Client accepts T&C → Page 3 captures consent (timestamp, IP, user agent)

Client pays → Page 4 calls POST /api/enrollment/charge
  → Validate consent
  → Charge via accept.blue (Basic Auth with merchant's source key)
  → If installments: create recurring schedule in accept.blue
  → Store AB customer mapping (for future recurring payment lookups)
  → Log enrollment evidence to Supabase
  → Set consent + payment fields on GHL contact
  → Return success

accept.blue fires webhook → POST /webhooks/acceptblue
  → Resolve customer via ab_customer_map → get locationId + contactId
  → Verify HMAC signature
  → Idempotency check
  → Route to handler (succeeded/declined/refund/error/ACH)
  → Log evidence
  → Update 19 payment fields on GHL contact
  → Trigger GHL notification workflow
```

### Offer System
Offers are stored in GHL Custom Objects with 66 fields. When created, the T&C clause system compiles 11 clause slots into clickwrap HTML. The HTML is stored on the offer and displayed to clients at enrollment.

### Payment Field Source of Truth
Payment counts (payments remaining, next payment date) come from accept.blue's recurring schedule API, NOT from incrementing GHL fields. This prevents drift if a webhook is missed.

### Milestone Sign-Offs
Clients click a link → view milestone details → confirm completion (clickwrap). The sign-off is logged as evidence with IP and timestamp. This is legally powerful — the client explicitly acknowledged receiving the service.

## What's Built (Phase 4)

### AI Defense Compilation Pipeline
```
POST /api/defense/compile { contactId, reasonCode, amount, date }
  → Create defense_packets record (status: pending)
  → Return 202 { defenseId }  (client polls GET /api/defense/:id/status)

  [Background — runs asynchronously]
  → Set status: processing
  → Fetch merchant info from Supabase
  → Fetch contact details from GHL API
  → Fetch ALL evidence from evidence_timeline view
  → Freeze evidence snapshot on the packet
  → Build 12-section structured prompt
  → Call Claude API (claude-sonnet-4-20250514, 4096 max tokens, 2min timeout)
  → Generate defense PDF (HTML → PDF → Supabase Storage)
  → Set status: complete, save letter text + PDF URL + token usage
  → Update contact: ss_defense_packet_url, ss_defense_pdf_url, ss_last_defense_date
```

### Merchant Provisioning
On OAuth callback → `merchant.service.provision()` fetches all GHL Custom Values (accept.blue credentials, business info, module toggles, incentive config) and stores them in the merchants table. Idempotent on re-install.

### Complete API Surface (30 endpoints)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | /health | none | Liveness check |
| GET | /ready | none | Readiness + Supabase check |
| GET | /authorize-handler | none | GHL OAuth callback → provision |
| POST | /decrypt-sso | none | SSO decryption |
| POST | /webhooks/acceptblue | HMAC | accept.blue payment events |
| POST | /webhooks/ghl | none | GHL form/workflow events |
| POST | /webhooks/external | none | Third-party tool events |
| POST | /webhooks/service-access | none | Platform access events |
| GET | /api/evidence/:contactId | SSO | Unified evidence timeline |
| GET | /api/evidence/:contactId/summary | SSO | Evidence count per type |
| GET | /api/evidence/:contactId/:type | SSO | Evidence filtered by type |
| GET | /api/offers | SSO | List offers |
| POST | /api/offers | SSO | Create offer |
| GET | /api/offers/clauses | SSO | Standard T&C clause list |
| GET | /api/offers/:id | SSO | Get offer |
| PUT | /api/offers/:id | SSO | Update offer |
| GET | /api/offers/:id/tc-preview | SSO | Preview compiled T&C |
| GET | /api/enrollment/offer/:id | public | Offer data for enrollment page |
| POST | /api/enrollment/prepare | SSO | Prep enrollment (populate fields) |
| POST | /api/enrollment/charge | public | Process payment |
| GET | /api/milestones/signoff/:contactId | public | Sign-off page data |
| POST | /api/milestones/signoff | public | Submit sign-off |
| POST | /api/defense/compile | SSO | Trigger defense compilation |
| GET | /api/defense/:id/status | SSO | Poll compilation status |
| GET | /api/defense/:id/download | SSO | Download defense PDF |
| GET | /api/defense/contact/:contactId | SSO | List defense packets |
| GET | /api/merchants/config | SSO | Get merchant settings |
| PUT | /api/merchants/config | SSO | Update merchant settings |
| POST | /api/merchants/sync-credentials | SSO | Refresh AB keys from GHL |
| POST | /api/merchants/onboard | SSO | Handle onboarding funnel |

| POST | /api/admin/reconciliation/run | SSO | Trigger payment reconciliation |
| POST | /api/admin/idempotency/cleanup | SSO | Purge old idempotency keys |
| POST | /api/admin/subscriptions/pause | SSO | Pause installment schedule |
| POST | /api/admin/subscriptions/resume | SSO | Resume paused schedule |
| POST | /api/admin/subscriptions/cancel | SSO | Cancel schedule |
| GET | /api/admin/subscriptions/:contactId | SSO | Get live subscription status |

## What's Built (Phase 5)

### Database Migrations
6 SQL files in `supabase/migrations/` — run these in order in Supabase SQL Editor:
1. `001_merchants.sql` — merchants + ab_customer_map tables
2. `002_idempotency.sql` — idempotency_keys table
3. `003_defense_packets.sql` — defense_packets table
4. `004_evidence_service_access.sql` — new evidence table
5. `005_evidence_timeline_view.sql` — unified evidence view (10 tables)
6. `006_storage_bucket.sql` — Supabase Storage bucket for PDFs

### Rate Limiting
In-memory per-IP rate limiting with two tiers:
- `/api/*` — 100 requests / 15 minutes (normal usage)
- `/webhooks/*` — 500 requests / 15 minutes (accept.blue can burst during settlements)

### Payment Reconciliation
Daily safety net that compares what we received (idempotency_keys) vs what we logged (evidence_payments). Flags gaps where a webhook was processed but evidence was not recorded. Also cleans up idempotency keys older than 90 days.

### Subscription Management
Full lifecycle: pause → resume → cancel. Each action calls accept.blue API, logs evidence, and updates the contact's payment status in GHL.

## What's Remaining (Post-MVP)

### Ready to deploy now:
- Run Supabase migrations
- Set environment variables
- Deploy to Render/Railway
- Register as GHL Marketplace app
- Test OAuth flow with GHL test location

### Future enhancements:
- Puppeteer for full HTML → PDF rendering (currently stores HTML as placeholder)
- BullMQ for queuing defense compilation (currently uses setImmediate)
- Sentry or similar for error alerting
- Redis-backed rate limiting for multi-server deployments
- Dunning automation (failed payment retry scheduling)
- Vue 3 merchant portal views (currently has backend API only)
- Unit + integration test suite

## File Count Summary

| Layer | Files | Purpose |
|-------|-------|---------|
| Entry + Config | 3 | index.ts, app.ts, config.ts |
| Middleware | 6 | Error handling, logging, SSO, webhooks, rate limiting, tenant context |
| Routes | 11 | Health, auth, webhooks, evidence, offers, enrollment, milestones, defense, merchants, admin |
| Controllers | 6 | Webhook, offer, enrollment, milestone, defense, merchant |
| Services | 12 | Evidence, payment, enrollment, offer, T&C, milestone, defense, PDF, merchant, notification, reconciliation, subscription, idempotency |
| Clients | 4 | GHL, accept.blue, Supabase, Anthropic |
| Repositories | 5 | Merchant, evidence, customer-map, idempotency, defense |
| Constants | 6 | Contact fields, offer fields, custom values, forms, T&C clauses, evidence types |
| Types | 1 | Express augmentation |
| Utils | 3 | Logger, errors, crypto |
| SQL Migrations | 6 | All Supabase tables + view + storage |
| **Total** | **58 TS + 6 SQL** | |
