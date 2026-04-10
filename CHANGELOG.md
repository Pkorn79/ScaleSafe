# Changelog

All notable changes to ScaleSafe are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)

---

## 2026-04-10

### Added
- **Enrollment Packet PDF** — auto-generated on enrollment via Puppeteer (HTML→PDF). Contains: client info, program details, full T&C with clause acceptance, consent forensics (timestamp, IP, device, scroll depth, signature), and payment confirmation
- `GET /api/enrollments/:id/packet` — SSO-gated endpoint serves enrollment packet PDF (inline or `?download=true`)
- `enrollment-packet.service.ts` — Puppeteer-based PDF generator with professional HTML template, reusable for defense packets
- Migration 036 adds `packet_pdf_path` column to enrollments for stored PDFs
- "Download Enrollment Packet" button on Client Detail page (visible for enrolled clients)
- Dockerfile updated with Chromium + shared libs for Alpine-based PDF rendering
- `puppeteer-core` + `@sparticuz/chromium` dependencies for lightweight containerized PDF generation

### Fixed
- Payment card list now shows real client names (from enrollment first_name/last_name/digital_signature), not email prefix
- Duplicate payment cards merged — customers with same email are grouped into one card with combined totals
- Evidence timeline shows time alongside date (e.g., "Apr 10, 2026 2:34 PM") for forensic precision
- Backfill endpoint parses digital_signature into first_name/last_name on old enrollments and re-upserts GHL contacts with correct names
- **GHL contacts now created with real names** — `first_name`/`last_name` columns added to enrollments (migration 035), parsed from digital signature at consent capture. GHL upsert uses enrollment name → signature parse → email prefix (last resort)
- `completeEnrollment` now inserts consent evidence (with signature, clauses, scroll depth, IP) alongside payment evidence — new enrollments get both records automatically
- Evidence insert try/catch blocks upgraded from `logger.warn` to `logger.error` with full stack traces and contactId context
- Checkout controller fallback GHL upsert uses same name priority (enrollment first_name → digital_signature → email prefix)
- Client names now show enrollment digital signature (e.g., "Philip Korniotes") instead of GHL email-prefix firstName (e.g., "p_korniotes")
- Consent evidence displays formatted summary (signature, clauses count, scroll depth, IP) instead of raw JSON
- `clauses_accepted` array no longer includes null values — filtered with `.filter(Boolean)` before saving

---

## 2026-04-09

### Fixed
- **Root cause: evidence records had empty contact_id** — `completeEnrollment` inserted evidence BEFORE GHL upsert resolved the contactId. Restructured: GHL contact resolution now step 2 (before evidence/payment inserts)
- **Browser cache fix:** `index.html` now served with `Cache-Control: no-cache` headers so deploys take effect immediately without hard refresh; hashed assets get 1-year immutable cache
- Clients list page now shows GHL contact names (batch lookup) instead of only email or empty string
- Payment search falls back to `payment_events` when `payment_customer_map` has no results (catches broken enrollment runs)
- Backfill endpoint now fixes evidence records, payment_events, and payment_customer_map with empty `contact_id`
- Client detail page shows client name/email, enrollment summary, and improved evidence timeline with formatted types and data summaries
- Payment management page shows client name/email instead of raw contact ID
- Clients table header changed from "Contact ID" to "Client"
- `GET /api/dashboard/client-info/:contactId` endpoint — returns client name, email, enrollment summary, and offer info
- Evidence repository now queries both `evidence_timeline` view and `evidence` table, merging and deduplicating results
- Added GHL upsert fallback in checkout controller — if completeEnrollment fails to save contactId, checkout does a direct upsert as safety net
- `GET /api/debug/backfill-contacts/:locationId` — backfills contactId on all enrolled records missing it
- Wrapped evidence insert, payment_event insert, and trigger fire in individual try/catch blocks so GHL contact creation always runs even if those tables don't exist
- Consolidated GHL contact creation: removed duplicate upsert block from checkout.controller.ts, single source of truth is now completeEnrollment in phase2Enrollment.service.ts
- Added `firstName` to GHL contact upsert (was missing, causing silent failures)
- Upgraded GHL sync error logging from warn to error with full stack traces
- Removed non-existent `client_name` column from all enrollment queries (dashboard, payment-management, health debug endpoints)
- evidence.repository.ts: `evidence_type` → `type`, `event_date` → `created_at` to match evidence_timeline view columns
- defense.service.ts, pdf.service.ts: same column name fixes for evidence timeline data
- enrollment-check diagnostic now performs actual GHL contact upsert and saves contactId to enrollment if missing
- payment_customer_map insert moved after GHL upsert block so resolved contactId is used instead of empty string
- enrollment-check diagnostic now tests GHL API operations (contact duplicate search, pipeline config)

### Added
- `GET /api/debug/enrollment-check/:consentToken` diagnostic endpoint — returns full enrollment record, GHL token validity, pipeline config, and payment events
- Detailed `POST-PAYMENT:` logging throughout checkout.controller.ts GHL block — every step now logs with full context, all catch blocks upgraded to logger.error with stack traces

### Fixed
- Payment customer search now enriches from enrollments table and payment_events as fallback when GHL API is unavailable
- Customer cards display client name/email instead of raw GHL contact IDs
- Added `lastPaymentDate` and `programName` to payment customer response
- Refund/charge endpoints now resolve merchantId from locationId when `req.merchantId` is not set (root cause of "unexpected error" on refund)
- Clients tab now includes enrollments with status enrolled/consent_captured/completed, even if no GHL contact_id exists yet
- Clients table shows displayName (client name or email) instead of truncated contact ID

---

## 2026-04-05

### Added — Phase L: Send Enrollment Link
- `POST /api/enrollment/send-link` (SSO-gated) — sends enrollment link to client via GHL email/SMS
- Upserts GHL contact, writes enrollment URL + offer name to contact custom fields, fires `ss_send_enrollment_link` trigger
- "Send Link" button + modal in Offers list — first name, email, phone, send via email/SMS toggles
- `ss_send_enrollment_link` trigger key added to trigger-keys.ts
- 7 unit tests for send-link controller

### Added — Phase K: UI/UX Polish
- Tailwind CSS v4 installed via PostCSS plugin
- Lucide Vue icons added to sidebar navigation (LayoutDashboard, Package, Users, CreditCard, Shield, Activity, Settings)
- Lucide icons added to Offers list buttons (Plus, Link2, Send, Edit, Copy)
- App.vue sidebar refactored to Tailwind utility classes with Inter font
- SSO loading/error screens converted to Tailwind
- Global CSS refined: updated borders, shadows, and color tokens to Slate palette
- Inter web font loaded from Google Fonts
- `cn()` utility (clsx + tailwind-merge) added for class merging

### Added — Phase J: Product Enhancements
- **Light Checkout Mode**: `checkout_mode` toggle on offers — `full_enrollment` (4-page funnel) or `quick_checkout` (compact single page with inline consent)
- Quick Checkout page (`GET /quick-checkout`) — standalone/GHL iframe with offer summary, NMI/Stripe payment, consent checkbox, postMessage protocol
- Offer form "Checkout Experience" section with radio cards, consent text customization, show/hide toggles
- **Clone Offer**: `POST /api/offers/:id/clone` — duplicates offer with "(Copy)" suffix, null GHL IDs, inactive status
- Clone button in Offers list with confirm dialog, auto-navigates to edit the copy
- **Payment Management UI**: customer search (`/payments`) + payment detail view (`/payments/:contactId`)
- Payment management controller: `GET customers`, `GET customer/:id`, `GET customer/:id/methods`, `POST charge`, `POST refund`
- One-time charge modal (stored card), refund modal (full/partial with amount validation)
- "Payments" nav item in sidebar
- Migration `031_light_checkout_mode` — adds `checkout_mode`, `quick_checkout_consent_text`, `quick_checkout_show_description`, `quick_checkout_show_refund_policy` to offers_mirror
- 13 unit tests (checkout mode, clone offer, payment management)

### Added — Phase I: Enrollment Funnel Web Widgets + API
- `POST /api/enrollment/device-capture` — public endpoint for Page 1 device/browser evidence capture
- `GET /api/enrollment/offer/:offerId/public` — public endpoint returning enrollment-relevant offer details (no internal IDs)
- `POST /api/enrollment/consent` — updated to generate `consent_token` (UUID v4) with full forensics: T&C version hash, digital signature, clause acceptance, scroll depth, device info
- Device capture widget (`/widgets/device-capture/`) — invisible iframe widget, collects IP/userAgent/fingerprint/screen/timezone
- Offer review widget (`/widgets/offer-review/`) — displays program name, pricing, milestones, refund policy, merchant contact
- Consent capture widget (`/widgets/consent-capture/`) — scrollable T&C, per-clause checkboxes, electronic signature, scroll depth tracking, consent_token handoff to Page 4
- `enrollmentPublicLimiter` — 100 req/min per IP for public enrollment widget endpoints
- Migration `030_enrollment_funnel_columns` — adds `email`, `device_evidence`, `digital_signature`, `clauses_accepted`, `scroll_depth` to enrollments table
- 14 unit tests for enrollment funnel (service + controller)

### Changed
- `payment_without_consent` structured warning log added to checkout controller when payment succeeds without consent_token
- Build script copies `src/widgets/` to `dist/widgets/` for production serving
- Widget static files served at `/widgets/` with CORS enabled for GHL iframe embedding

---

## 2026-04-03

### Added — Phase H: Integration Testing + Hardening
- 4 integration test suites: `payment-flow` (11 tests), `dispute-flow` (12 tests), `evidence-chain` (8 tests), `risk-audit` (24 tests) — 55 new tests covering end-to-end payment, dispute triage, evidence chain verification, and risk audit scoring
- Input validation middleware (`validateInput.ts`) — reusable `validateBody()` and `sanitizeBody()` for POST endpoints
- Checkout rate limiter (`checkoutLimiter`) — 10 requests/minute per IP, applied to `/api/checkout` endpoints

### Changed — Phase H: Integration Testing + Hardening
- Hardened checkout controller: added amount range validation (positive, max $999,999.99), payment token format check, email format validation on save-card
- Hardened queryUrl controller: added type/apiKey format validation
- Hardened stripe-health service: wrapped Stripe API `Promise.all` in try/catch with graceful fallback for EFW/balance APIs
- Hardened stripe-risk-audit service: wrapped Stripe API `Promise.all` in try/catch with graceful fallback for customer/PI APIs
- Hardened stripe-evidence-vault service: wrapped `createVaultEntryFromWebhook` in try/catch so webhook handler never throws unhandled errors
- Added structured logging (pino) to checkout payments, queryUrl refunds, dispute triage, and EFW processing with event type, merchant context, and timestamps

### Added — Phase F: Merchant Settings UI + Defense Dashboard
- `SettingsPayments.vue` — NMI connection form (security key, tokenization key, processor ID), Stripe Connect button, default processor toggle, dispute auto-submit toggle
- `DefenseDashboard.vue` — account health metrics (dispute rate, EFW count, recovery rate, evidence completeness, financial exposure, transaction count), VAMP/MC status, reason code breakdown, risk audit recommendations
- `DisputeManagement.vue` — active dispute list sorted by deadline urgency, triage scores with color-coded bars, fight/accept actions, evidence gap indicators, status badges
- `PreventionChecklist.vue` — 5-score risk audit profile (dispute rate, evidence coverage, refund policy, customer communication, billing clarity), prevention coverage items
- Offer form processor override dropdown (NMI/Stripe/Default) with NMI multi-MID selector
- 5 new routes: `/settings/payments`, `/defense/dashboard`, `/defense/disputes`, `/defense/prevention`
- Sidebar navigation: Health Dashboard sub-link under Defense, Payments sub-link under Settings

### Added — Phase S4: Account Health Monitor + Radar + Descriptors + Prevention
- `stripe-health.service.ts` — daily account health snapshots, VAMP/MC threshold monitoring, risk level computation, dispute rate bands
- `stripe-radar.service.ts` — Stripe Radar Value List management (create, add items, remove items), card blocking after won fraud disputes
- `stripe-descriptor.service.ts` — statement descriptor analysis, formatting validation, suffix recommendations
- `stripe-prevention.service.ts` — OI/RDR/Ethoca enrollment checklists, prevention coverage scoring, CE 3.0 readiness check
- `stripe-defense.routes.ts` — health/radar/descriptor/prevention API endpoints
- `daily-health-check.ts` job for scheduled health snapshots
- Migration 029: health/radar/prevention support tables
- S4 types added: AccountHealthSnapshot, EnrollmentChecklist, RadarListRecord, DescriptorAnalysis, PreventionCoverage, Ce30Readiness
- 56 unit tests covering health scoring, VAMP/MC thresholds, radar list ops, descriptor analysis, prevention checklists

### Added — Phase S3: Dispute Triage + Evidence Assembly + Submission + EFW Management
- `stripe-dispute.service.ts` — dispute triage scoring (0-100), recommendation engine (fight/review/accept), evidence assembly by reason code (5 Stripe reason codes mapped), evidence submission via Stripe Disputes API (staged + auto-submit modes), deadline alert calculation (T-7, T-3, T-1)
- `stripe-efw.service.ts` — EFW management with hold/refund decision tree based on evidence score and dispute rate, 72-hour response deadline tracking, dispute rate computation from Stripe API, EFW response action (refund via Stripe Refunds API or hold)
- `dispute.routes.ts` — merchant-facing dispute API: `GET /api/disputes/:merchantId`, `GET /api/disputes/:merchantId/:disputeId` (with evidence packet), `POST .../submit`, `POST .../accept`
- `efw.routes.ts` — merchant-facing EFW API: `GET /api/efws/:merchantId`, `POST /api/efws/:merchantId/:efwId/respond`
- Replaced stub `handleDisputeEvent` in `stripe-webhook.controller.ts` with full implementation handling all 5 dispute event types (created, updated, closed, funds_withdrawn, funds_reinstated) with auto-submit on triage score >= 60
- Replaced stub `handleEfwEvent` in `stripe-webhook.controller.ts` with full EFW service integration
- Migration 028: new columns on `dispute_events` (recommendation_reason, evidence_gaps, evidence_score, alert timestamps, funds tracking, RDR/Ethoca resolution flags), `efw_events` (recommendation, response tracking), `merchants` (dispute_auto_submit)
- Phase S3 types added to `stripe-defense.types.ts`: `DisputeTriageResult`, `DisputeRecommendation`, `EvidencePacket`, `EfwRecommendation`
- 36 unit tests covering triage scoring, recommendation logic, deadline tracking, evidence assembly for all 5 reason codes, evidence submission, and EFW decision tree

### Added — Phase A: Payment Infrastructure Foundation
- **8 new database migrations** (015-022): `processor_configs`, `payment_methods`, `dispute_events`, `dispute_evidence_files`, `account_health_snapshots`, `efw_events`, `stripe_radar_lists`, plus ALTER extensions to `merchants`, `offers_mirror`, and `payment_events`
- `ProcessorInterface` — shared checkout interface (charge, refund, saveCard, listCards, chargeStoredCard, createSubscription, cancelSubscription, verifyTransaction, testConnection)
- `ProcessorFactory` — resolves merchant + offer → correct processor type and config
- `processor-config.service.ts` — CRUD for NMI/Stripe credentials with AES-256-GCM encryption
- `ProcessorError` custom error class for processor-related failures
- `processor.types.ts` — TypeScript types for all payment operations + DB row shapes
- `PROCESSOR_ENCRYPTION_KEY` env var support in config.ts

### Added — Phase B: NMI Client
- `NmiClient` (`src/clients/nmi.client.ts`) — full NMI payment gateway client implementing all 9 `ProcessorInterface` methods: charge, refund, saveCard, listCards, chargeStoredCard, createSubscription, cancelSubscription, verifyTransaction, testConnection
- `src/utils/nmi.utils.ts` — NMI response parser, XML query parser, cents-to-dollars conversion, date formatting
- `ProcessorFactory` wired to instantiate `NmiClient` with decrypted credentials for NMI configs
- 34 unit tests for NMI client and utilities (`tests/unit/nmi.client.test.ts`)
- `fast-xml-parser` dependency for NMI Query API XML responses

### Added — Phase G: Payment Evidence + Enrollment Integration
- `evidence-chain.service.ts` — verifies unbroken consent → payment → evidence vault chain with strength scoring (0-100)
- Migration 028: extends payment_events and enrollment_packets with evidence/consent linkage columns
- Evidence chain API: `GET /api/evidence/chain/:paymentEventId`
- 5 unit tests for chain strength computation and verification

### Added — Phase S2: Evidence File Upload System
- 4 file upload methods: offer terms PDF, signed contracts, session logs, communication trails
- PDF generation via `pdf-lib`: offer terms, session summaries, communication exports
- Stripe Files API integration (purpose: dispute_evidence) on connected accounts
- Evidence completeness scoring refresh on every upload
- Evidence gap detection (identifies missing files per transaction)
- Evidence status endpoint: `GET /api/evidence/status` (aggregate scores + distribution)
- Upload endpoints: `POST /api/evidence/upload-contract`, `log-session`, `upload-communication` (multer for multipart)
- `stripe_terms_file_id` column on offers_mirror (migration 027)
- `append_session_file_id` PostgreSQL RPC function for array append
- `pdf-lib` and `multer` dependencies installed
- 8 unit tests for PDF generation, evidence gaps, and score refresh

### Added — Phase S1: Risk Audit Engine + Webhook Controller + Evidence Vault
- `stripe-risk-audit.service.ts` — 5-score risk audit engine (dispute rate, evidence readiness, descriptor quality, repeat client rate, Radar data quality) with module recommendations
- `stripe-evidence-vault.service.ts` — creates evidence vault entries for ScaleSafe-processed and external Stripe transactions, evidence completeness scoring (0-100)
- `stripe-webhook.controller.ts` — unified webhook receiver for all Stripe events, signature verification via rawBody, event routing (payment success → evidence vault, disputes/EFW → stub handlers for S3)
- `risk_audit_results` table (migration 025) — stores audit scores, raw data, and recommendations
- `stripe_evidence_vault` table (migration 026) — per-transaction evidence metadata with CE 3.0 tracking
- `stripe-defense.types.ts` — shared types for all defense modules
- Risk audit triggers asynchronously after Stripe OAuth callback
- Risk audit API: `GET/POST /api/stripe/risk-audit`
- Stripe webhook route: `POST /webhooks/stripe`
- 23 unit tests for evidence scoring, dispute rate bands, radar quality, module recommendations

### Added — Phase E: Checkout Page (paymentsUrl)
- Standalone checkout page at `/checkout` — GHL iframe with postMessage protocol (`custom_provider_ready`, `payment_initiate_props`, `setup_initiate_props`, `custom_element_success_response`)
- Dynamic card form: NMI Collect.js (inline fields) or Stripe Elements, loaded based on merchant's processor
- PIF vs Installments toggle when product has both pricing options
- Card-on-file setup flow (`setup_initiate_props` → save card → success)
- Evidence capture: device fingerprint, browser info, timezone, timestamps (IP captured server-side)
- Consent token verification against enrollments table before processing
- Checkout controller (`src/controllers/checkout.controller.ts`): `GET /api/checkout/config`, `POST /api/checkout/process-payment`, `POST /api/checkout/save-card`
- Transaction mappings + payment event logging on every checkout
- CE 3.0 metadata written to every Stripe PaymentIntent (offer_id, terms, IP)
- `STRIPE_PUBLISHABLE_KEY` env var for Stripe Elements initialization
- CORS for `/api/checkout` endpoints
- SPA catch-all excludes `/checkout` route
- 9 unit tests for checkout controller

### Added — Phase D: GHL Custom Payment Provider Registration + queryUrl Backend
- `queryUrl` controller (`src/controllers/query-url.controller.ts`) — handles all 6 GHL payment operations: verify, list_payment_methods, charge_payment, create_subscription, cancel_subscription, refund
- `payment-provider.service.ts` — GHL provider registration, API key generation/lookup, config connection
- `ghl-webhook.service.ts` — sends subscription/payment lifecycle events to GHL webhook endpoint
- `transaction_mappings` table (migration 023) — maps GHL ↔ processor transaction/subscription IDs
- `provider_api_key` + `provider_publishable_key` columns on merchants (migration 024)
- `card-brands.ts` utility — card brand image URLs and titles for GHL list_payment_methods response
- `payment-provider.routes.ts` — `POST /api/payments/query` endpoint
- Provider registration integrated into merchant provisioning flow
- Dollar-to-cents conversion on all GHL → ProcessorInterface calls, cents-to-dollars on responses
- 10 unit tests for queryUrl controller

### Added — Phase C: Stripe Client + Connect OAuth
- `StripeClient` (`src/clients/stripe.client.ts`) — full Stripe checkout client implementing all 9 `ProcessorInterface` methods via Stripe Connect direct charges with `stripeAccount` header
- `stripe-connect.service.ts` — OAuth flow (generateAuthUrl → handleCallback → saveConnection), webhook registration on connected accounts, disconnect, verify
- `stripe-connect.routes.ts` — OAuth routes: `GET /auth/stripe/connect`, `GET /auth/stripe/callback`, `POST /api/stripe/disconnect`
- `ProcessorFactory` wired to instantiate `StripeClient` from `stripe_user_id`
- Config.ts: `STRIPE_SECRET_KEY`, `STRIPE_CLIENT_ID`, `STRIPE_WEBHOOK_SECRET`, `APP_URL` env vars
- 23 unit tests for StripeClient and StripeConnectService
- `stripe` npm dependency (v22)
- CE 3.0 metadata on every PaymentIntent (scalesafe_offer_id, terms_accepted, ce30_eligible)
- Simplified Stripe config — only `stripe_user_id` stored (no encrypted tokens needed for Standard Connect)
- Payment infrastructure columns added to `MerchantRecord` type

### Changed
- `CLAUDE.md` updated: payment architecture rule (was "observe only", now Custom Payment Provider), added Payment Processing section, updated file conventions and reference docs
- Archived 12 superseded docs into `docs/archive/`

---

## 2026-04-02

### Added
- `CUSTOM_VALUE_REGISTRY` — 23-value canonical registry with fieldKey patterns for cross-location matching
- Per-merchant `custom_value_ids` JSONB column — each location stores its own GHL custom value IDs
- Partial provisioning status — if some values fail, progress is saved and only failures are retried
- `CLAUDE.md` project rules file with architecture constraints, docs trust warning, post-deploy verification
- `CHANGELOG.md` backfilled from all git history
- Logo file upload to Supabase Storage with preview thumbnail (4463ec7)
- `POST /api/merchants/logo` endpoint with multer multipart handling (4463ec7)

### Changed
- `createCustomValues()` now discovers existing values by fieldKey pattern (not name), creates missing ones, and stores all IDs per-merchant in Supabase — scales to N merchants
- `syncConfigToGHL()` uses per-merchant stored IDs instead of hardcoded PMG-specific IDs
- `getFullConfig()` reads GHL values using per-merchant stored IDs
- Provisioning sets `partial` status when some custom values succeed but others fail

### Fixed
- T&C logic now additive: URL + clickwrap clauses show together, not either/or (4463ec7)
- Enrollment preview page shows program duration, refund policy, and compiled T&C (4463ec7)
- Provisioning recovery: snapshot error shown in UI, retry button, auto-retry on page load (4463ec7)
- Custom value provisioning no longer fails on name mismatches between locations

### Security
- Removed leaked database URI (`supabase/.temp/pooler-url`) from repo, added to `.gitignore` (348833d)

## 2026-04-01

### Added
- Merchant onboarding configuration service — Phase 3: full config read/write, GHL custom value sync, T&C clause management, module toggles (7f13c3e)

### Fixed
- Offer configurator: delivery method dropdown, auto-calculated installment amount, T&C clauses moved to per-offer, milestone labels, program duration (ac95ba9)
- Offer form build failure from missing field references (013d229)

## 2026-03-31

### Fixed
- OAuth reinstall: handle snake_case `locationId` from GHL, add `user_type=Location` to token request (6541bed)
- OAuth for agency-level installs: resolve locationId via `/oauth/installedLocations` when GHL returns companyId only (1e34096)
- `installedLocations` 422 error: added required `appId` parameter (682b6d2)
- Location resolution: switched to `/locations/search` since `/oauth/installedLocations` requires unavailable appId (bdd0cc9)
- SSO for agency-level access: try multiple locationId field names, fall back to companyId merchant lookup (8063bb3)

### Added
- Diagnostic debug output to OAuth callback for Railway-free debugging (6f09e9a)

## 2026-03-28

### Fixed
- Merchant provisioning: corrected GHL v2 API endpoints (807fdc7)
- Custom fields endpoint: use `/locations/{locationId}/customFields` for contacts (0e2a016)

## 2026-03-27

### Added
- Merchant provisioning service: pipeline detection, custom fields, custom values, workflow triggers (6447281)
- Friendly error page when SSO/tenant context is missing (a2c66cf)

### Fixed
- OAuth callback to provision merchants + evidence getCounts null safety (984d9c8)
- Auth callback route double-prefix issue (`/auth/auth/callback`) (bd2fb39)
- SSO auth: GHL sends `sso_key` (snake_case), not `ssoKey` (4fa18d8)
- SSO: switched to GHL postMessage handshake instead of query params (df065ce)
- Provisioning trigger, offer creation, and offer form completeness (20d1d6b)
- Provisioning trigger + public enrollment page (ea763e2)

### Changed
- Enrollment API refactored with improved error handling (b6de5e9)
- Offer form and provisioning features enhanced (9e6e23e)

## 2026-03-26

### Added
- ScaleSafe v2.1 complete backend + frontend build — all 6 phases (c7cbeda)
- Migration script, ran v2.1 migrations on Supabase (3901c67)
- Service-level tests for evidence, payment, defense, disengagement (eb20561)
- Railway deployment config: Dockerfile + railway.json (70f7e9c)

### Fixed
- `/auth/callback` route was double-prefixed (7f5240f)

### Security
- Removed exposed credentials from archived docs (a04be2f)

## 2026-03-24

### Added
- Initial context package and setup guide for Node.js app build (f9854ea)
