# ScaleSafe Changelog

## Phase 5: Production Hardening — 2026-03-24

### Built
- **Supabase migrations** (`supabase/migrations/`) — 6 SQL files ready to run:
  - `001_merchants.sql` — merchants table + ab_customer_map table + auto-update triggers + RLS
  - `002_idempotency.sql` — idempotency_keys table with unique constraint on (event_id, source)
  - `003_defense_packets.sql` — defense_packets table with status tracking + evidence snapshots
  - `004_evidence_service_access.sql` — new evidence table for platform access events
  - `005_evidence_timeline_view.sql` — UNION ALL view across all 10 evidence tables
  - `006_storage_bucket.sql` — Supabase Storage bucket for defense PDFs
- **Rate limiting** (`src/middleware/rateLimiter.ts`) — in-memory per-IP rate limiter:
  - API endpoints: 100 requests / 15 min
  - Webhook endpoints: 500 requests / 15 min (higher for accept.blue settlement bursts)
  - Sets X-RateLimit-Limit/Remaining/Reset headers
  - Auto-cleanup of expired entries every 5 minutes
- **Payment reconciliation** (`src/services/reconciliation.service.ts`) — daily safety net:
  - Compares idempotency_keys (what we received) vs evidence_payments (what we logged)
  - Checks ALL active merchants with AB credentials
  - Flags gaps where events were received but evidence is missing
  - Includes idempotency key cleanup (purge > 90 days)
- **Subscription management** (`src/services/subscription.service.ts`) — pause/resume/cancel:
  - `pause()` — PATCH accept.blue schedule (active=false), log evidence, set status "Paused"
  - `resume()` — PATCH accept.blue schedule (active=true), log evidence, set status "Current"
  - `cancel()` — DELETE accept.blue schedule, log evidence, set status "Cancelled"
  - `getStatus()` — fetches live schedule from accept.blue (payments remaining, next date)
- **Admin routes** (`src/routes/admin.routes.ts`) — 6 new endpoints:
  - `POST /api/admin/reconciliation/run` — trigger daily reconciliation
  - `POST /api/admin/idempotency/cleanup` — purge old idempotency keys
  - `POST /api/admin/subscriptions/pause` — pause installment schedule
  - `POST /api/admin/subscriptions/resume` — resume paused schedule
  - `POST /api/admin/subscriptions/cancel` — cancel schedule permanently
  - `GET /api/admin/subscriptions/:contactId` — get live subscription status
- **Route-level rate limiting** wired into Express: /webhooks/* gets webhook limiter, /api/* gets API limiter

### Database
- All tables have RLS enabled (service role policy — app enforces tenant isolation in code)
- merchants table has auto-update trigger for updated_at
- idempotency_keys has unique constraint preventing duplicate event processing
- evidence_timeline view provides single-query access to all evidence types

---

## Phase 4: Defense Compiler + Portal — 2026-03-24

### Built
- **Anthropic client** (`src/clients/anthropic.client.ts`) — direct HTTP calls to Claude Messages API. 2-minute timeout for long defense letters. Returns text + token usage for cost tracking.
- **Defense repository** (`src/repositories/defense.repository.ts`) — CRUD for defense_packets table. Tracks status (pending → processing → complete/failed), evidence snapshot, Claude output, PDF location, token costs.
- **PDF service** (`src/services/pdf.service.ts`) — generates defense packet PDFs from HTML templates. Includes defense letter + evidence summary appendix. Uploads to Supabase Storage, returns signed URL. HTML-to-PDF placeholder ready for Puppeteer in Phase 5.
- **Defense service** (`src/services/defense.service.ts`) — the full AI compilation pipeline:
  1. Creates defense_packets record (pending)
  2. Fetches merchant info + contact details from GHL
  3. Gathers ALL evidence via evidence_timeline view
  4. Freezes evidence snapshot on the packet
  5. Builds 12-section structured prompt (matching S11's proven format)
  6. Calls Claude API → gets defense letter + token usage
  7. Generates PDF → uploads to Supabase Storage
  8. Updates packet (complete) + contact defense fields in GHL
  - Runs asynchronously (returns defenseId immediately, compiles in background)
  - On failure: records error message, sets status to "failed"
- **Merchant service** (`src/services/merchant.service.ts`) — provisioning, config, credential sync, onboarding:
  - `provision()` — called on OAuth callback, fetches all GHL Custom Values (AB keys, business info, module toggles, incentive config), creates/updates merchants table
  - `getConfig()` / `updateConfig()` — settings management
  - `syncCredentials()` — re-fetches AB keys from GHL
  - `handleOnboardingSubmission()` — processes 4-page onboarding funnel (16 fields)
- **Defense controller + routes** — `POST /api/defense/compile` (returns 202), `GET /api/defense/:id/status`, `GET /api/defense/:id/download`, `GET /api/defense/contact/:contactId`
- **Merchant controller + routes** — `GET/PUT /api/merchants/config`, `POST /api/merchants/sync-credentials`, `POST /api/merchants/onboard`
- **OAuth provisioning** — wired merchant.service.provision() into /authorize-handler so merchants are auto-provisioned on app install

### Defense Prompt Structure (12 sections)
1. Merchant Information
2. Client Information
3. Chargeback Details (reason code, amount, date)
4. Terms & Conditions Consent (acceptance date, IP, clauses)
5. Payment History
6. Session Delivery Evidence
7. Course/Module Progress
8. Milestone Progress
9. Client Satisfaction / Engagement (pulse checks)
10. Enrollment Evidence
11. Attendance Record (no-shows)
12. Digital Platform Access

### Architecture Notes
- Defense compilation is async — HTTP returns 202 with defenseId, client polls status
- Evidence snapshot is frozen at compilation time (immutable even if new evidence arrives later)
- Token usage tracked per defense packet for cost monitoring
- Merchant provisioning is idempotent (re-install updates, doesn't duplicate)
- Sensitive fields (OAuth tokens, AB API keys) stripped before sending config to frontend

---

## Phase 3: Core Business Logic — 2026-03-24

### Built
- **Customer map repository** (`src/repositories/customer-map.repository.ts`) — maps accept.blue customer IDs to GHL contacts. Replaces Make.com DS 83038. Used to trace recurring payment webhooks back to the correct merchant and contact.
- **T&C service** (`src/services/tc.service.ts`) — compiles 11 clause slots (9 standard + 2 custom) into clickwrap HTML. Validates consent data (timestamp, IP, user agent). Builds accepted-clauses list for contact field storage.
- **Offer service** (`src/services/offer.service.ts`) — full CRUD for GHL Custom Objects (Offers). Maps normalized OfferData to GHL's flat 66-field structure. Auto-compiles T&C HTML on create/update. Replaces Make.com S3.
- **Payment service** (`src/services/payment.service.ts`) — master webhook dispatcher with 5 handlers:
  - `handleChargeSucceeded` — logs evidence, fetches accept.blue recurring schedule for accurate payment counts (num_left, next_run_date as source of truth), updates 19 payment contact fields
  - `handleChargeDeclined` — logs evidence, sets status to "Past Due", records failed payment date
  - `handleRefund` — logs to evidence_refund_activity, updates refund fields + status
  - `handleError` — logs processing errors
  - `handleACHStatus` — handles ACH-specific settled/returned/originated statuses
  - `resolveContactFromWebhook` — looks up ab_customer_map to identify merchant and contact from accept.blue customer_id
- **Enrollment service** (`src/services/enrollment.service.ts`) — 3-step orchestration replacing Make.com S4/S5/S6/S7:
  - `prepare()` — fetches offer, populates all Offer- prefix fields + milestone fields on contact
  - `processCharge()` — validates consent, charges via accept.blue, creates recurring schedule for installments, stores AB customer mapping, logs enrollment evidence, sets initial payment + consent fields
  - `handlePostEnrollment()` — creates pipeline opportunity in GHL
- **Milestone service** (`src/services/milestone.service.ts`) — serves sign-off page data, handles sign-off submission, logs evidence, updates contact tracking fields. Replaces Make.com milestone sign-off page + S8 Route 10.
- **Notification service** (`src/services/notification.service.ts`) — triggers GHL workflows via internal webhooks (recurring events) or tag adds (one-time events). Handles enrollment, payment, refund, and failure notifications.
- **Offer controller + routes** — `GET/POST /api/offers`, `GET/PUT /api/offers/:id`, `GET /api/offers/:id/tc-preview`, `GET /api/offers/clauses`
- **Enrollment controller + routes** — `GET /api/enrollment/offer/:offerId` (public), `POST /api/enrollment/prepare` (SSO), `POST /api/enrollment/charge` (public)
- **Milestone controller + routes** — `GET /api/milestones/signoff/:contactId` (public), `POST /api/milestones/signoff` (public)
- **Wired accept.blue webhook handler** — upgraded from Phase 2 placeholder to full routing: resolve customer → verify HMAC → idempotency check → payment.service dispatch → evidence + field updates

### Architecture Notes
- Payment field updates use accept.blue schedule data as source of truth (not incrementing GHL fields)
- Enrollment consent fields (7 fields) set atomically with initial payment fields at charge time
- Notification failures are logged but never block payment processing or webhook responses
- T&C HTML is compiled at offer creation time (not at enrollment) — faster page loads
- Dynamic imports used in enrollment.service to avoid circular dependency with offer.service

---

## Phase 2: Webhooks + Evidence — 2026-03-24

### Built
- **Webhook verification** (`src/middleware/webhookVerification.ts`) — HMAC-SHA256 signature verification for accept.blue webhooks using per-merchant secrets
- **Tenant context middleware** (`src/middleware/tenantContext.ts`) — extracts locationId from SSO, query params, or request body; loads merchant config from Supabase
- **Idempotency repository** (`src/repositories/idempotency.repository.ts`) — check/mark events in idempotency_keys table (unique on event_id + source)
- **Idempotency service** (`src/services/idempotency.service.ts`) — `withIdempotency()` wrapper: check → execute → mark. Returns null for duplicates.
- **Evidence repository** (`src/repositories/evidence.repository.ts`) — insert evidence to any of 10 tables, query timeline view, query by type, get summary counts
- **Evidence service** (`src/services/evidence.service.ts`) — routes evidence to correct table by source:
  - GHL forms (SYS2-06 through SYS2-11) → routed by form ID
  - External webhooks (Calendly, Zoom, Kajabi) → routed by event_type
  - Payment events → evidence_payments
  - Refund events → evidence_refund_activity
  - Enrollment → evidence_enrollment
  - Service access → evidence_service_access
- **Webhook controller** (`src/controllers/webhook.controller.ts`) — 4 handlers:
  - `handleAcceptBlueWebhook` — dispatches by type/subType, idempotency-wrapped (full routing wired in Phase 3)
  - `handleGhlWebhook` — dispatches by form_id to evidence service
  - `handleExternalWebhook` — validates payload schema, dispatches by event_type
  - `handleServiceAccessWebhook` — logs platform access events
- **Webhook routes** (`src/routes/webhook.routes.ts`) — 4 endpoints:
  - `POST /webhooks/acceptblue`
  - `POST /webhooks/ghl`
  - `POST /webhooks/external`
  - `POST /webhooks/service-access`
- **Evidence API routes** (`src/routes/evidence.routes.ts`) — SSO-authenticated:
  - `GET /api/evidence/:contactId` — unified timeline
  - `GET /api/evidence/:contactId/summary` — counts per type
  - `GET /api/evidence/:contactId/:type` — filtered by evidence type
- **Test fixtures** — 5 JSON files: accept.blue charge succeeded/declined/refund, GHL session form, external Calendly session

### Architecture Notes
- Webhooks respond 200 immediately to prevent retries, then process
- accept.blue webhooks use idempotency (event ID dedup) — GHL/external don't (form submissions aren't retried)
- accept.blue merchant identification via ab_customer_map will be fully wired in Phase 3
- Evidence is always append-only — no updates or deletes

---

## Phase 1: Foundation — 2026-03-24

### Built
- **Project scaffold** from GHL Marketplace App Template (cloned, restructured into layered architecture)
- **Express app** (`src/app.ts`) with middleware stack: request logging, JSON parsing with raw body preservation, static file serving, global error handler
- **Environment config** (`src/config.ts`) — validates all required env vars at startup, fails fast on missing
- **Structured logging** (`src/utils/logger.ts`) — pino with pretty-print in dev, JSON in production
- **Custom error classes** (`src/utils/errors.ts`) — BadRequest (400), Authentication (401), Forbidden (403), NotFound (404), Conflict (409), WebhookVerification (401), ExternalService (502)
- **GHL OAuth client** (`src/clients/ghl.client.ts`) — refactored from template, tokens stored in Supabase instead of in-memory, auto-refresh on 401
- **accept.blue client** (`src/clients/acceptblue.client.ts`) — Basic Auth with per-merchant source key, charge/refund/recurring/customer operations
- **Supabase client** (`src/clients/supabase.client.ts`) — singleton with service role key
- **Merchant repository** (`src/repositories/merchant.repository.ts`) — CRUD operations + TokenStore interface for GHL client
- **SSO middleware** (`src/middleware/ssoAuth.ts`) — decrypts GHL SSO keys, attaches tenant context
- **Crypto utilities** (`src/utils/crypto.ts`) — HMAC-SHA256 verification for accept.blue, SSO decryption from template
- **Auth routes** (`src/routes/auth.routes.ts`) — OAuth callback (/authorize-handler), SSO decryption (/decrypt-sso)
- **Health routes** (`src/routes/health.routes.ts`) — liveness (/health) and readiness (/ready with Supabase check)
- **TypeScript types** (`src/types/express.d.ts`) — Request augmentation for tenantContext and rawBody

### Architecture Decisions
- Tokens in Supabase (not in-memory) — survives server restarts
- Raw body preserved during JSON parse — needed for HMAC webhook verification
- Layered architecture: routes → controllers → services → repositories → clients
- Multi-tenant isolation via location_id on every query

### GHL Constants (typed, no magic strings)
- **Contact fields** (`src/constants/ghl-contact-fields.ts`) — All active ScaleSafe contact custom fields with IDs and keys: SS tracking (6), T&C consent (7), payment (16+3 refund), defense/chargeback (9), sign-off (3), offer-on-contact (14+24 milestones+22 clauses), onboarding (3+16 milestones+5 module toggles), misc (3)
- **Offer fields** (`src/constants/ghl-offer-fields.ts`) — All 66 Offers Custom Object fields: core (17), milestones (8×3=24), T&C clause slots (11×2=22), plus delivery_method and refund_window_text
- **Custom values** (`src/constants/ghl-custom-values.ts`) — All location-level config: accept.blue credentials (3), module toggles (5), business info (11), T&C config (7), incentive program (5), milestones (16), legacy/system (2)
- **T&C clauses** (`src/constants/tc-clauses.ts`) — 9 standard clause definitions with titles, toggle field keys, and default text
- **Form IDs** (`src/constants/ghl-forms.ts`) — SYS2-06 through SYS2-11 with form-to-evidence-table mapping
- **Evidence types** (`src/constants/evidence-types.ts`) — All 10 evidence table names + external event_type routing map

### Template Files Preserved (as .template reference)
- `src/index.ts.template` — original monolithic Express server
- `src/ghl.ts.template` — original GHL class with in-memory tokens
- `src/model.ts.template` — original in-memory token storage
