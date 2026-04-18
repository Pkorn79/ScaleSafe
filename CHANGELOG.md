# Changelog

All notable changes to ScaleSafe are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)

---

## 2026-04-17

### Added
- **Add Client button.** Client list page has "Add Client" button with modal (name, email, phone). Creates a GHL contact + minimal enrollment record with status `manual_add`. Client appears in Active list with no programs; merchant can later assign an offer.
- **Assign Offer to client.** Client profile has "Assign Offer" button. Directly enrolls the client in a program — no funnel, no consent, no payment. Creates enrollment with `payment_type: 'manual'`. For situations where agreement was handled outside ScaleSafe.
- **Free offers ($0).** Offers with $0 price now skip the checkout page entirely. After consent capture (Page 3), the enrollment is completed directly with `payment_type: 'free'`. The API returns `freeOffer: true` so the funnel can redirect to completion.
- **Quarterly + annual billing frequencies.** Migration 051 expands the `installment_frequency` CHECK constraint. New options in offer form frequency dropdowns. NMI uses `month_frequency: 3/12`. Stripe uses `interval: month/year` with `interval_count: 3/1`. Next billing date calculations, processor types, and checkout interval mapping all updated.

### Fixed
- **Quick Pay T&C link.** Quick checkout consent label now shows a clickable "Terms and Conditions" link when the offer has a `tc_url`. Falls back to custom consent text if set, otherwise default static text. Added `tcUrl` + `quickCheckoutConsentText` to the public offer API response.
- **Quick Pay offer save error.** Saving a one-time (Quick Pay) offer with processor override failed with CHECK constraint violation. Root cause: `installment_frequency` was sent as empty string `''` which violates `CHECK (installment_frequency IN ('weekly', 'bi_weekly', 'monthly'))`. Fixed: empty strings now converted to null via `|| null` in both create and update paths.
- **Send Offer email — use `html` field.** GHL Conversations API rejects emails with only `message` field ("no message or attachments"). Email type requires `html` (and optionally `subject`). SMS uses `message` and works fine.
- **CRITICAL: GHL customField → customFields migration.** Every GHL contact update was silently failing (422: "property customField should not exist"). GHL V2 API requires `customFields` (plural, array of `{key, field_value}`) not `customField` (singular object). Added a request interceptor in `ghl.client.ts` that auto-transforms the old format — fixes all 20+ call sites without touching each file.
- **trigger_subscriptions table noise eliminated.** `getActiveSubscriptions()` was throwing on every trigger fire because the table doesn't exist. Now returns empty array on error instead of throwing.
- **NMI Collect.js card field styling (black bar fix).** Updated `customCss` in both checkout `CollectJS.configure()` calls to match the working `payment-update.routes.ts` pattern: added `border: none`, `height: 100%`, `width: 100%`, changed `background-color` from `transparent` to `#ffffff`, added `invalidCss`. Removed conflicting `data-variant` script tag attribute (already set in configure). These properties target the INPUT element inside the Collect.js iframe.
- **Send Offer payload format.** Removed `subject` field from GHL Conversations API email payload — the working `dashboard.sendClientMessage()` doesn't use it and it may cause silent failures. Added full GHL error response logging (`response.data`) for both email and SMS paths.
- **Profile header status priority.** `clientInfo()` was still picking the most recent enrollment by `created_at DESC`, showing "cancelled" even when active enrollments exist. Now uses the same status-priority logic as `client_list_view` (migration 050): active > paused > pending > completed > cancelled.
- **Send Offer direct delivery.** Send Offer from client profile now sends email/SMS directly via GHL Conversations API instead of only firing a trigger. Previously relied on a GHL workflow being configured to listen for the `ss_send_enrollment_link` trigger — if no workflow existed, the message never arrived. Now sends directly AND fires the trigger (for workflow automation). Includes error logging for both email and SMS paths.
- **Cancel no longer archives client with other active enrollments.** Two fixes: (1) `client_list_view` SQL now orders by status priority (active > paused > pending > completed > cancelled) instead of just `enrolled_at DESC`, so a cancelled enrollment doesn't hide active ones. (2) `cancelSubscription()` now checks for remaining active enrollments before setting GHL contact status to 'cancelled' — only updates GHL if ALL enrollments are cancelled.
- **Card metadata extraction — Stripe expand fix + NMI diagnostics.** Stripe: added `expand: ['latest_charge']` to PaymentIntent create params. Without this, `pi.latest_charge` was a string (charge ID), not an expanded object, so `typeof pi.latest_charge === 'object'` was always false and card details were never extracted. This was the actual root cause of card metadata showing "unknown / **** / 0/0" for Stripe. NMI: added diagnostic logging at every step of vault query and card metadata extraction to trace failures in production.
- **NMI Collect.js card field visibility.** Card input fields showed black lines — characters typed were invisible. Added `customCss` to both Collect.js `configure()` calls (enrollment funnel + quick checkout) to explicitly set text color (#1f2937), font, and background inside the sandboxed iframes.
- **Per-offer processor override reaching checkout tokenizer (REAL fix).** The previous urlParams-based fix was wrong — the `/checkout` page is a GHL Custom Payment Provider iframe that gets data via postMessage, not URL params. Fixed: checkout now extracts the GHL product ID from `productDetails[0]._id` (postMessage data), calls new `/api/checkout/config-by-product/:ghlProductId` endpoint which looks up the offer by `ghl_product_id` and passes `processor_override` to `resolveProcessor()`. Also fixed: `processPayment()` now passes the offer hint to `resolveProcessor()` so the charge uses the same processor as the tokenizer.
- **Cancel enrollment error response.** Cancel returned "An unexpected error occurred" despite succeeding because `evidenceService.logEvidence()` calls in `cancelSubscription()` were not wrapped in try/catch. The enrollment was cancelled in the DB but the evidence logging failure propagated as a 500. Both calls now wrapped in try/catch (non-fatal).
- **Cancel/pause/complete scoped to single enrollment.** Previously these actions filtered by `contact_id + status` which affected ALL active enrollments for a contact. Added `enrollmentId` to `SubscriptionParams` and all three methods now filter by `.eq('id', enrollmentId)` when available.
- **Card on file metadata extraction.** Stripe: extract card details from the PaymentIntent's `latest_charge.payment_method_details.card` instead of a separate API call. NMI: added fallback extraction from the charge response (`cc_number`, `cc_type`, `cc_exp`) when vault query fails, plus diagnostic logging.
- **Checkout performance — subscription creation moved to fire-and-forget.** `createSubscription()` (~1-2s) now runs in background after the checkout response is sent. Evidence inserts in `completeEnrollment()` parallelized with `Promise.allSettled()` instead of sequential awaits.

### Added
- **Processor column on offers list.** Shows "Default" / "NMI" / "Stripe" per offer with color-coded badges.
- **NMI connection status + default processor selector on Settings page.** Settings now shows both Stripe and NMI connection status. When both are connected, a dropdown lets the merchant set the default processor.

---

## 2026-04-16

### Fixed
- **Stripe atomic vault during charge.** Stripe charges now use `setup_future_usage: 'off_session'` + customer attachment when recurring billing is needed — same atomic pattern as the NMI vault fix. `shouldVaultDuringCharge` is now processor-agnostic (works for both NMI and Stripe). Fixes Stripe "No card on file" and enables Stripe subscription creation.
- **Client data scoping to ScaleSafe enrollments.** Payment summary and payment history queries now filter by `.not('enrollment_id', 'is', null)` to only show payments tied to ScaleSafe-created enrollments. Previously showed all payment history for a contact_id including pre-ScaleSafe data from GHL contact dedup.
- **Checkout performance (~12s → ~6-7s).** Split `completeEnrollment()` into critical-path (enrollment update, GHL contact resolution, evidence inserts) and fire-and-forget (trigger firing, GHL field updates, opportunity creation, PDF generation, evidence chain verification). The background work runs after the function returns so the checkout response is faster.
- **Checkout loading wrong tokenizer (NMI vs Stripe).** The checkout config endpoints used `processor_configs.is_default` to pick which tokenizer to load, ignoring `merchants.default_processor` and per-offer `processor_override`. Switching the merchant default to Stripe in settings had no effect on checkout — it always loaded NMI Collect.js. Fixed by replacing the manual config lookup with `resolveProcessor()` which respects: (1) offer-level processor override, (2) merchant default_processor, (3) single-connected-processor fallback.
- **Per-offer processor override not persisting.** The offer form sent `processorOverride` and `nmiProcessorId` on save, but the offer service never wrote them to the database — the fields were missing from `CreateOfferInput` interface and both `create()`/`update()` record builders. The DB columns existed (migration 022) and `resolveProcessor()` already knew how to use them. Fixed by adding the fields to the interface, create record, update handler, and `OfferRecord` type.
- **NMI atomic vault + charge — single-use token fix.** NMI Collect.js payment tokens are single-use. The checkout was calling `charge()` first (consuming the token), then `saveCard()` which failed because the token was spent. Fixed by adding `customer_vault=add_customer` to the NMI charge API call when recurring billing is needed — this vaults and charges atomically in one call. The checkout controller now detects `vaultedCustomerId` on the charge result and skips the separate `saveCard()` call. Stripe path is unaffected (multi-use tokens). Also fixes "No card on file" display after NMI checkout.
- **Enrollment status DB sync for pause/resume/cancel.** Previously these actions updated the GHL contact field but never updated `enrollments.status` in the database, causing permanent divergence. Now: pause sets `status='paused'`, resume sets `status='enrolled'`, cancel sets `status='cancelled'` + `cancelled_at`. All three work with or without a processor subscription.
- **Per-program installment progress on Payments tab.** Previously showed a single combined summary when a client had multiple active enrollments. Now renders each active installment/subscription enrollment as a separate progress card with program name, payments made/total, amount collected, next billing date, and a progress bar. Backend `clientEnrollments` endpoint now includes `next_billing_date` in the response.
- **Processor identification on Recent Payments table.** Added Processor column (NMI / Stripe / GHL badge) to the Recent Payments table on the client profile Payments tab. The `processor` field was already stored correctly in `payment_events` and returned by the payment history API — it just wasn't displayed.

### Added
- **`badge-purple` CSS class** for Stripe processor badge styling.
- **PIF auto-completion cron** (`pif-completion-check.ts`) — daily job checks PIF enrollments against offer `program_duration_value` + `program_duration_unit`. When `enrolled_at + duration <= today`, marks enrollment as `completed`, logs evidence, fires `ss_program_completed` trigger, and updates GHL contact.
- **Manual enrollment status controls** — new `POST /api/payments/lifecycle/enrollment/status` endpoint accepts `action: pause|resume|cancel|complete` with optional reason. New `completeEnrollment()` method on payment-lifecycle service handles manual completion with evidence, triggers, and processor subscription cleanup.
- **ProgramsTab action buttons** — each enrollment card now shows Pause/Resume/Cancel/Complete buttons based on current status. Confirmation modals with reason input for pause and cancel. Program end date displayed when offer has a duration set.
- **Client list Active/Archive tabs** — default view now shows only active clients (enrolled, active, paused, pending). Archive tab shows completed and cancelled. "All" tab shows everything. Status dropdown filter still works within each tab.
- **Processor-native recurring billing.** After first payment for installment/subscription offers, ScaleSafe now creates a recurring schedule at the processor level (NMI `add_subscription` or Stripe Subscription). The processor manages all future charges. Migration 049 adds `processor_subscription_id` to enrollments.
  - **Shared recurring-payment service** (`recurring-payment.service.ts`) — extracted success/failure handling from the daily cron into reusable functions called by the cron, Stripe webhooks, and NMI Silent Post.
  - **Stripe webhook handlers** — `invoice.payment_succeeded`, `invoice.payment_failed`, `customer.subscription.deleted`, `customer.subscription.updated` events now update enrollment state, log evidence, and fire triggers.
  - **NMI Silent Post endpoint** (`POST /webhooks/nmi/silent-post`) — receives NMI recurring billing notifications, verifies transactions, and processes payments.
  - **Pause/resume support** — Stripe uses `pause_collection` (keeps subscription alive); NMI cancels and recreates (no native pause). `pauseSubscription()` and `resumeSubscription()` added to ProcessorInterface and both clients.
  - **Cron backward compat** — daily job now skips enrollments with `processor_subscription_id` set. Legacy enrollments continue to be charged by the cron. If subscription creation fails at checkout, the cron handles billing as fallback.

---

## 2026-04-15

### Fixed
- **NMI checkout rendering + submission bugs on both full-funnel and Quick Pay surfaces.** When NMI is the default processor, Collect.js inline iframes were rendering as dark lines / black boxes and the Pay button was permanently disabled. Five fixes applied:
  - **Quick Pay pay button deadlock broken** — the gate `paymentToken !== null` blocked the button from ever enabling because the Collect.js callback only fires on `startPaymentRequest()` which requires the button click. Changed to allow the button to enable when consent is checked (matching Stripe behavior); the submit handler's existing `startPaymentRequest()` fallback path handles tokenization at click time.
  - **GHL iframe tokenization key validation** — now shows "NMI is not fully configured. The tokenization key is missing." instead of rendering a broken form when the key is empty/null.
  - **GHL iframe pay button gate** — button starts disabled ("Enter card details...") and only enables after Collect.js's `fieldsAvailableCallback` fires confirming fields rendered successfully.
  - **`fieldsAvailableCallback` + `timeoutCallback`** added to both surfaces — Collect.js now logs field render success and surfaces timeout errors instead of failing silently.
  - **Quick Pay NMI-specific error message** — when tokenization key is missing, shows "NMI is not fully configured" instead of the generic "not fully configured" message (which merchants couldn't act on).
  - Stripe path is unaffected by all 5 changes — every fix is gated on `processorType === 'nmi'`.

### Added
- **Evidence enrichment for 5 critical defense types (Problem 2).** Migration 048 adds `description TEXT` + `enrollment_id UUID` columns to `evidence_consent`, `evidence_enrollment_payment`, `evidence_signoffs`, `evidence_cancellation` (milestones already had description). Write paths enriched:
  - `evidence_consent` — now populates: `contact_name`, `contact_email`, `tc_version`, `consent_method`, `raw_payload`, `enrollment_id`, and a server-rendered `description` sentence.
  - `evidence_enrollment_payment` — now populates: `currency`, `payment_timestamp`, `processor_ref`, `contact_name`, `contact_email`, `raw_payload`, `enrollment_id`, `description`.
  - `evidence_milestones` — now populates: `contact_name`, `enrollment_id` (description/notes already enriched in commit ed19b55).
  - `evidence_signoffs` — now populates: `work_summary` (from offer m{n}_delivers + m{n}_client_does), `device_fingerprint`, `browser`, `contact_name`, `contact_email`, `raw_payload`, `enrollment_id`, `description`.
  - `evidence_cancellation` — now populates: `contact_name`, `contact_email`, `enrollment_id`, and a server-rendered `description` that pre-frames the event as a termination with the active service period calculated server-side (e.g., "Merchant-initiated cancellation on April 20, 2026. Active service period: March 15 to April 20, 2026 (36 days).").
  - `evidence_subscription_changes` — now wired in `payment-lifecycle.service.ts` pause/resume/cancel handlers with `initiated_by`, `previous_status`, `new_status` fields populated (table existed since migration 003 but was never written to).
  - Forward-only: old rows stay sparse. New enrollments / milestones / signoffs / cancellations get enriched rows going forward.
- **Transaction selector on defense compile form.** The "New Defense" modal now shows a transaction dropdown after a customer is selected. Fetches the customer's payment_events from `GET /api/defense/transactions/:contactId` (new endpoint) and displays each as `"{date} — ${amount} — {offerName} — {transactionId}"`. Selecting a transaction auto-fills the dispute amount and stores `payment_event_id` + `enrollment_id` on the defense_packets row (new columns via migration 047). Evidence queries in `defense-exhibits.service.ts buildExhibitList()` now accept an optional `enrollmentId` filter — when present, the exhibit list is scoped to that enrollment's evidence only (instead of pulling all evidence for the contact). Manual entry fallback remains available when no transactions are found.

### Fixed
- **Customer name on defense dashboard cards.** `defenseHistory` handler now batch-resolves contact names from enrollments (first_name + last_name, digital_signature fallback, email fallback) and returns `contactName` per packet. Defense Dashboard cards show the resolved name instead of a truncated GHL UUID.

### Security
- **RLS lockdown: dropped 44 overly-permissive policies that gave the Supabase anon key unrestricted read/write access.** Every table had `CREATE POLICY "Service role full access" ... FOR ALL USING (true) WITH CHECK (true)` with no `TO` clause — this applies to ALL roles including `anon`, effectively making RLS a no-op. Migration 046 drops all 44 policies. With RLS enabled and no matching policy for anon, PostgreSQL's default-deny kicks in — anon gets zero access. The backend uses `SUPABASE_SERVICE_KEY` which bypasses RLS entirely, so the app is completely unaffected. Verified: no `@supabase/supabase-js` import exists in the frontend; all queries go through the backend. Tables covered: merchants, processor_configs, payment_methods, payment_events, enrollments, all 20 evidence tables, defense_packets, defense_outcomes, dispute_events, and 14 more.

### Added — Defense Module Rebuild
- **Defense Dashboard at `/defense`** — card layout replacing the old table, with summary cards (Total / Won / Win Rate / Value Saved), filter buttons (All / Active / Pending Outcome / Won / Lost / Withdrawn), sort dropdown (Deadline / Date Created / Amount), and a "New Defense" compile modal migrated to the `<Modal>` component from Slice 2. Each card shows client, amount, reason code, deadline countdown, lifecycle status badge, outcome badge.
- **Defense Packet Detail view with 4 tabs** — uses `<ProfileTabs>` from Slice 2: Letter / Exhibits / History / Outcome. Sticky header with deadline countdown (color-coded), lifecycle + compilation status badges, Download PDF + Mark Submitted buttons. PDF inline preview via `<iframe>` with prominent download fallback.
  - **Letter tab** — editable Markdown textarea before submission, locked read-only after. Regenerate + Save Edit buttons. Token count + version number displayed.
  - **Exhibits tab** — numbered exhibit cards (A/B/C…) with name, category badge, date, and server-rendered summary. Single source of truth from `defense-exhibits.service.ts`.
  - **History tab** — chronological version list from `defense_letter_versions` table. Each version shows AI/Manual badge, token counts, expand-to-view.
  - **Outcome tab** — gated on `lifecycle_status === 'submitted'`. Won/Lost/Withdrawn buttons, amount recovered, decision date, notes field. Propagates outcome to linked `dispute_events` row for chargeback ratio monitoring.
- **AI letter prompt rewrite** — clinical/factual tone (no argumentative language), pre-grouped evidence by semantic category (Consent / Service Delivery / Communication / Payments / Termination), hard rule that cancellation/refund events are TERMINATION events and must not be framed as engagement, numbered exhibit references (`(Exhibit A)` / `(see Exhibit C)`), never-leave-placeholders rule, addressee handling (default per processor, merchant override), current date always substituted.
- **Defense exhibits service** (`src/services/defense-exhibits.service.ts`) — single source of truth for the exhibit list. Reads from all 20 evidence tables + signed enrollment packet path from storage. Groups by category, assigns sequential exhibit letters, generates plain-English summaries server-side. The same list is passed to BOTH the AI prompt AND the PDF bundler so citations and assembly never drift.
- **Defense letter PDF renderer** (`src/services/defense-letter-pdf.service.ts`) — renders the AI letter as professional HTML→PDF via the shared Puppeteer `renderHtmlToPdf` util. Includes header, metadata table, letter body with Markdown→HTML conversion, and exhibit index table.
- **Defense bundle service** (`src/services/defense-bundle.service.ts`) — merges defense letter PDF + evidence exhibits PDF + signed enrollment packet PDF (loaded AS-IS from `scalesafe-files` storage to preserve consent-time forensic integrity) into one combined PDF via `pdf-lib`. Uploads to `scalesafe-files/defense-packets/{locationId}/{defenseId}-v{n}.pdf` with versioned key. Signed URL persisted on `defense_packets.pdf_url` + `pdf_storage_path`.
- **Shared PDF renderer** (`src/services/pdf-renderer.service.ts`) — extracted from `enrollment-packet.service.ts`. Used by enrollment packet, defense letter, and defense bundle services. No behavior change to enrollment packets.
- **6 new defense lifecycle endpoints** (all SSO-gated):
  - `POST /api/defense/:id/submit` — sets `lifecycle_status='submitted'`, locks the latest letter version (`is_submitted_version=true`), records `submitted_at`, updates linked `dispute_events.status='under_review'`.
  - `POST /api/defense/:id/outcome` — accepts `won/lost/withdrawn` + `amountRecovered` + `resolvedAt` + `notes`. Writes to `defense_outcomes`, updates `defense_packets.lifecycle_status`, propagates to linked `dispute_events` (outcome + status mapping + net_financial_impact).
  - `POST /api/defense/:id/regenerate` — re-runs the AI letter compilation, inserts a new `defense_letter_versions` row, mirrors to the fast-read column, rebundles the PDF. Pre-submit only (400 if already submitted).
  - `PUT /api/defense/:id/letter` — saves a manual text edit as a new version, mirrors + rebundles. Pre-submit only.
  - `GET /api/defense/:id/versions` — returns the full version history for the History tab.
  - `POST /api/defense/:id/rebundle` — manual PDF regeneration trigger (defensive, in case bundle generation failed).
- **Migration 044** (`044_defense_lifecycle.sql`):
  - `defense_packets.lifecycle_status` (pending_submission / submitted / won / lost / withdrawn)
  - `defense_packets.submitted_at`, `dispute_event_id` FK, `addressee`
  - `defense_outcomes.outcome` CHECK widened to include `'withdrawn'`
  - `dispute_events.stripe_dispute_id` relaxed to NULLABLE (enables NMI rows with no Stripe ID)
  - `dispute_events.processor` column added (discriminates 'stripe' vs 'nmi')
  - Index on `(lifecycle_status, response_deadline)` for dashboard filtering/sorting
- **Migration 045** (`045_defense_letter_versions.sql`): new `defense_letter_versions` table (defense_packet_id FK, version_number, letter_text, generated_at, generated_by, model_used, prompt_tokens_used, response_tokens_used, is_submitted_version, notes). Unique on `(defense_packet_id, version_number)`.
- **NMI dispute_events path** — when a merchant compiles a defense on the NMI rail (no Stripe dispute), `compileDefense` creates the `dispute_events` row server-side with `processor='nmi'` and links via FK. This ensures the chargeback ratio monitoring covers both rails.

### Changed
- **Stripe Risk Health moved** — renamed `DefenseDashboard.vue` → `StripeRiskHealth.vue`, route moved from `/defense/dashboard` to `/risk-health`, nav sub-link renamed from "Health Dashboard" to "Stripe Risk Health". The new Defense Dashboard now owns `/defense`.
- **Compile form** — now includes an optional Addressee field (default per processor: Stripe = "Stripe Disputes Team", NMI = "Sponsor Bank — Chargeback Department"). Compile modal migrated from inline `<div>` to `<Modal>` component.
- **`defense.service.ts recordOutcome`** — now accepts `won/lost/withdrawn` (was `won/lost` only). Propagates outcome to linked `dispute_events` via the FK (`dispute_event_id`).
- **`enrollment-packet.service.ts`** — refactored to import `renderHtmlToPdf` from the new shared `pdf-renderer.service.ts`. No behavior change.
- **`docs/DEFENSE_REBUILD_PLAN.md`** — file moved from repo root to `docs/`. Sections 5-7 (Platform Decision Matrix, Build Order, Risk Register) written as part of Phase 3 STRATEGIZE.

### Added
- **NMI Settings page wiring — merchants can now connect NMI alongside Stripe.** The Settings page UI was already built (form fields, Test Connection button, Default Processor toggle), but the four handlers (`connectNmi`, `testNmiConnection`, `disconnectNmi`, `setDefaultProcessor`) were stubbed with TODOs that surfaced "NMI connection is not yet available. Use Stripe for now." This wires them up. The NMI client, `processorConfigService.createNmiConfig()`, encryption flow, `processor.factory.ts` dual-rail support, and `processor_configs` schema all already existed and required no changes — this was purely finish-the-plumbing.
  - **New endpoints under `/api/processor-config/`** (`src/controllers/processor-config.controller.ts`, `src/routes/processor-config.routes.ts`):
    - `POST /nmi` — stores credentials via `processorConfigService.createNmiConfig()` (encrypts the security key with AES-256-GCM via `PROCESSOR_ENCRYPTION_KEY`); returns config metadata without the encrypted key.
    - `POST /nmi/test` — instantiates a one-shot `NmiClient` and calls `testConnection()` to validate credentials against the live NMI API without persisting them. Used by the Test Connection button.
    - `DELETE /nmi` — soft-disconnect: deactivates all active NMI configs for the merchant and clears `merchants.default_processor` if it pointed at NMI.
    - `POST /default` — sets `merchants.default_processor` to `nmi` or `stripe`. Validates that the chosen processor is actually connected before writing. Used when both rails are active so `processor.factory.ts:resolveProcessor()` knows which to use by default.
  - **`/api/merchants/config` now surfaces NMI status**: new fields `nmiConnected`, `nmiProcessorId`, `defaultProcessor` on the `getFullConfig()` response. The Settings page reads these to render the NMI badge + the "Default Processor" toggle (which only shows when both NMI and Stripe are connected). The lookup is wrapped in try/catch so a `processor_configs` query failure falls back to `nmiConnected=false` instead of breaking the whole Settings page.
  - **`SettingsPayments.vue` handlers wired to real endpoints** — the four TODO stubs replaced with actual `api.post` / `api.del` calls, plus a status loader update to read `nmiConnected` / `nmiProcessorId` / `defaultProcessor` from the config response. Front-end input validation prevents empty Test Connection / Connect NMI calls; failed `setDefaultProcessor` rolls back the local toggle to its previous value.
- **NMI and Stripe can be connected simultaneously per merchant** (architectural confirmation, no code change). `processor.factory.ts:resolveProcessor()` handles offer-level override → merchant default → single-connected-fallback resolution. The "Default Processor" toggle in Settings only renders when both are connected.

### Changed
- **Overview tab + summary strip — "Paid Lifetime" now shows two decimals** (was `.toFixed(0)` which rounded $0.50 → "$1" and read as the program total). The underlying backend value was always correct; this was a display rounding bug.
- **Overview tab "Next Billing" card — now an "Installment Progress" card** when the client is on a recurring payment type. Shows `1 of 2 paid` + `Next: <date>` instead of just the next date. PIF clients still see the simple Next Billing card.
- **Overview tab "Paid Lifetime" card — now shows `of $X program total`** as a sub-line for installment / subscription clients so the merchant immediately sees collected vs. agreed.
- **Payments tab installment progress block — now shows `paid · collected of total · Next: <date>`** in one compact line, with the per-installment price as a sub-line. Subscription block also gains the next billing date.
- **Mark Complete on milestones now shows a confirmation modal** before firing. Renders a merchant-friendly summary: "Mark this milestone complete for {firstName}? They'll receive a confirmation request to sign off." Plus the milestone name, what was delivered (`m{n}_delivers`), and what the client does (`m{n}_client_does`). Cancel returns to the page; Mark Complete fires the same backend action as before.

### Added
- **Recurring billing daily job** (`src/jobs/recurring-billing.ts`) — scans `enrollments` where `next_billing_date <= today` and `payment_type IN ('installments','installment','subscription')`, loads the saved card from `payment_methods` (`is_default = true`), resolves the merchant's processor + offer, calls `processor.chargeStoredCard()`, and on success: writes a `payment_events` row (`event_type='sale'`, `source='recurring_billing'`, `is_recurring=true`), increments `payments_made`, advances `next_billing_date` per `installment_frequency`, fires `ss_payment_received`, runs final-installment detection (sets `status='completed'` + fires `ss_program_completed`), logs evidence. On failure: writes a `payment_events` row (`event_type='payment_failed'`) and hands off to `paymentLifecycleService.initiateDunning()`. Wired into `src/index.ts` alongside the existing daily health check + payment reminder jobs (5 min after startup, then every 24 hours).

### Fixed
- **Card now persisted to `payment_methods` on installment / subscription enrollments.** `processPayment` previously only saved the card when the request body included `saveCard: true`, but the funnel checkout never sends that flag — meaning recurring enrollments completed the first charge but had no saved card to bill against for subsequent installments. Now `shouldSaveCard` is auto-derived from `paymentChoice` (any of `installments`, `installment`, `subscription` triggers it). The save block was also moved to AFTER the consent-token / Quick Pay contactId resolution branches so the new `payment_methods` row always has a real `contact_id` (previously the bare `contactId` from `req.body` was empty on the consent-token funnel path). Existing defaults are demoted (`is_default = false`) before inserting the new one to maintain the one-default-per-contact invariant. PIF enrollments are unaffected — they don't trigger the auto-save.
- **`clientInfo` endpoint surfaces `nextBillingDate`** (added to the enrollment SELECT + response JSON) so the Payments tab can display the next billing date without a second fetch.
- **Full enrollment funnel checkout no longer re-asks for name/email/phone or T&C.** Quick Pay hotfix `ee3a9ba` added the customer info section + consent checkbox to `quickCheckoutHtml()` to support direct Quick Pay links, but those fields rendered unconditionally — so when a client reached Page 4 of the full funnel they were forced to re-enter info already collected on Page 1 + re-accept terms already accepted on Page 3. Now the checkout detects consent-mode (`?consentToken=` present) and:
  - Hides `#customer-info-section` (the Your Information block) immediately on load.
  - Hides `#consent-row` (the T&C checkbox) immediately on load.
  - Pre-checks the hidden consent checkbox so `updatePayBtn()` ungates without user action — the actual T&C acceptance was logged at funnel Page 3 with full forensics (IP, device, scroll depth, signature).
  - Calls `/api/enrollment/consent-lookup/:token` and populates the (hidden) `cust-name` + `cust-email` fields with `firstName + lastName` (or `digital_signature` fallback) and `email` from the enrollment row, so the existing submit body keeps working unchanged.
  - Skips phone validation in the submit handler when consent-mode (phone was collected at Page 1 and is already on the GHL contact; backend `process-payment` doesn't read `contactPhone` on the consent-token path).
  - Quick Pay path (no consent token) is unchanged — fields visible, name/email/phone required, T&C checkbox required.
- **`GET /api/enrollment/consent-lookup/:token`** extended to return `firstName`, `lastName`, `contactId`, `digitalSignature` in addition to `email`, so the checkout can prefill the hidden fields without a second round trip.
- **Defense "New Defense" submission no longer 500s with "An unexpected error occurred."** Long-standing schema/code mismatch in the entire Defense subsystem. `defenseRepository.create()` was inserting columns named `reason_code`, `dispute_amount`, `dispute_date`, `deadline`, `offer_id` — but `defense_packets` (migration 002) actually has `chargeback_reason_code`, `chargeback_amount`, `chargeback_date`, `response_deadline`, and no `offer_id` column at all. Postgres was rejecting every insert with "column does not exist", which propagated up through `defense.service.ts` → `defenseController.compile`'s catch → global error handler. Fixed by:
  - **Migration 043** — `ALTER TABLE defense_packets ADD COLUMN IF NOT EXISTS offer_id UUID` + index, additive and idempotent.
  - **`src/repositories/defense.repository.ts`** — rewrote `DefensePacketRecord` interface to mirror the actual schema (renamed 5 fields, removed 6 fictional fields, added 12 missing real ones) and updated `create()` parameter shape to use the chargeback_* names.
  - **`src/services/defense.service.ts`** — fixed `compileDefense` insert payload (line 54) to use correct column names. Fixed `runCompilation`'s status update (line 142) to use `prompt_tokens_used` / `response_tokens_used` instead of `input_tokens` / `output_tokens` and to set `completed_at`. Fixed `recordOutcome` to read `packet.chargeback_amount` instead of `packet.dispute_amount` (was previously always recording $0 amount-saved). Added a `shapePacketResponse()` helper that aliases the actual DB columns onto legacy field names (`reason_code`, `dispute_amount`, `deadline`, `input_tokens`, `output_tokens`) so `DefenseDetailView.vue` keeps working unchanged.
  - **`src/controllers/dashboard.controller.ts`** — fixed `defenseHistory` Supabase select list to query the correct columns and added an explicit response mapping that aliases them to the legacy field names the `DefenseDashboard.vue` already reads. The Defense history dashboard had been silently broken in parallel.
  - **`src/services/pdf.service.ts`** — fixed `generateDefenseLetterPdf` to write `pdf_url` + `pdf_storage_path` instead of `defense_letter_url` (which doesn't exist on the table). Added an explicit error check on the update so future column drift surfaces as a warning instead of being silently swallowed.
- **Mark Complete on milestones no longer 500s after a successful evidence write.** `POST /api/dashboard/mark-milestone` was throwing "An unexpected error occurred" to the merchant whenever `triggerService.fireTrigger('ss_milestone_reached', …)` propagated a Supabase error from `triggerRepository.getActiveSubscriptions()` — but by that point the `evidence_milestones` row and `enrollments.current_milestone` update had already committed, so a refresh showed the milestone as completed despite the visible error. Trigger fire is now wrapped in try/catch (fire-and-forget; `postWithRetry` already handles delivery retries internally) and logs a warning on failure. Also tightened `.error` checks on the two writes so genuine DB failures surface clearly.
- **Enriched milestone evidence rows.** Now writes `description` (from offer `m{n}_delivers`), `notes` (from `m{n}_client_does`), `contact_email` (from enrollment), and `raw_payload` (full trigger payload) into `evidence_milestones`. Previously only 6 of 11 user-fillable schema fields were populated, leaving the row sparse for downstream defense compilation.

### Added — Slice 2: Client Profile Restructure
- **ClientDetailView rewritten as tab-based layout.** Sticky header (name, meta, status chip, actions) + summary strip (readiness, active programs, paid lifetime, next billing, last activity) + six tabs: **Overview / Programs / Payments / Evidence / Communications / Files**. Active tab persists to URL hash.
- **`<Modal>` component** (`src/ui/src/components/Modal.vue`) — reusable overlay with `v-model:open`, title prop, default + footer slots, ESC + click-outside close, body scroll lock, teleport to body, responsive bottom-sheet on mobile. Fixes broken Send Offer / Add Note / Send Message modals in ClientDetailView (the classes `.modal-overlay` / `.modal-card` were only defined in OffersView + PaymentManagement as `<style scoped>`, so CDV's modals rendered as inline panels at bottom of page).
- **`<ProfileTabs>` component** (`src/ui/src/components/ProfileTabs.vue`) — sticky tab nav on desktop, fixed bottom-nav on mobile with icons + labels. iOS-safe (`env(safe-area-inset-bottom)`), `100dvh`-ready, hides on keyboard open via `ss-profile-open` body class hook.
- **Tab components** in `src/ui/src/views/client-profile/`:
  - `OverviewTab.vue` — compact readiness score, quick stats, recent 5 activities, most recent note, at-risk/engaged pill
  - `ProgramsTab.vue` — enrollment cards lifted from old CDV, milestone progress + Mark Complete + Packet download
  - `PaymentsTab.vue` — card on file, totals, last 5 payments, deep link to standalone `/payments/:contactId`
  - `EvidenceTab.vue` — timeline with type filter + date range filter + Load More pagination
  - `CommunicationsTab.vue` — unified feed of GHL messages + notes with Manual/Automated source chips
  - `FilesTab.vue` — enrollment packets (downloadable) + signed milestone metadata rows
- **New backend endpoints** (all SSO-gated, `location_id`-scoped, in `dashboard.controller.ts` + `dashboard.routes.ts`):
  - `GET /api/dashboard/client-activity/:contactId?limit=5` — bundled overview data (recent activity + recent note + at-risk snapshot). Calls GHL `GET /contacts/:contactId/notes` for most-recent note.
  - `GET /api/dashboard/client-communications/:contactId?limit=50&offset=0&windowDays=30` — unified messages + notes feed. Pulls GHL `/conversations/search` + per-conv `/conversations/:id/messages` + `/contacts/:contactId/notes`. Marks outbound messages as `automated` (ScaleSafe-sent) or `manual` via cross-reference against `evidence_communication` rows where `source='app_triggered'`, matched by 5-minute timestamp buckets with ±1 neighbor tolerance for clock skew. Default 30-day window for rate-limit safety.
  - `GET /api/dashboard/client-files/:contactId` — enrollment packets metadata + `evidence_signoffs` rows. Packets download through existing `/api/enrollments/:id/packet` streaming route; signoffs are metadata-only (no PDF generation in this slice).
- **Evidence timeline endpoint filter support.** `GET /api/evidence/:contactId` now accepts `?type=`, `?from=`, `?to=`, `?limit=`, `?offset=` query params. Response shape changed from plain array to `{ rows, total }` — frontend handles both for backward-compat. Filters push down to Supabase via `evidenceRepository.getTimeline()` which applies them to both `evidence_timeline` view and unified `evidence` table in parallel.
- **Migration 042** — composite indexes `idx_evidence_location_contact_created (location_id, contact_id, created_at DESC)` and `idx_evidence_location_contact_type (location_id, contact_id, evidence_type)` on unified `evidence` table for filtered timeline perf.

### Changed
- **8 existing inline modals migrated to `<Modal>`**: Send Offer, Add Note, Send Message (ClientDetailView); Send Enrollment Link (OffersView); Charge, Refund, Pause, Cancel (PaymentManagement). Duplicate `.modal-overlay` / `.modal-card` scoped style blocks removed from OffersView and PaymentManagement.
- `evidenceRepository.getTimeline()` signature changed to `(locationId, contactId, opts)` where `opts = { limit, offset, type, from, to }`. Returns `{ rows, total }` instead of raw array. Internal callers (`getFullSnapshot`) updated.
- `evidenceService.getTimeline()` updated to thread `opts` through to the repository.

### Fixed
- **Broken modal rendering in ClientDetailView.** Previously the Send Offer / Add Note / Send Message modals rendered as unstyled divs flowing in document order ("panel at bottom of page" UX bug) because `.modal-overlay` and `.modal-card` classes were defined inside `<style scoped>` blocks in OffersView.vue and PaymentManagement.vue — scoping meant those classes didn't apply to CDV's elements. The new `<Modal>` component uses global `.ss-modal-*` classes on a teleported node, properly overlaying regardless of host view.

---

## 2026-04-13

### Added — Phase G Gap Fill: Payment Lifecycle Service
- **Dunning service** — `initiateDunning()` classifies soft/hard declines, sets retry schedule (3/7/14 days for soft declines), fires `ss_payment_failed` trigger with dunning context. `retryPayment()` charges saved card, resolves dunning on success or escalates after max retries. `escalateDunning()` marks contact delinquent, fires `ss_client_at_risk`.
- **Subscription management** — `pauseSubscription()`, `resumeSubscription()`, `cancelSubscription()` with evidence logging (subscription_change + cancellation types), GHL trigger firing, and contact status updates
- **Card management** — `listCards()`, `deleteCard()`, `updateDefaultCard()` as unified service consolidating scattered implementations
- **Payment notification helpers** — `notifyPaymentSuccess()`, `notifyPaymentFailed()`, `notifyRefundProcessed()` extracted from inline trigger-firing code
- API routes at `/api/payments/lifecycle/*`: subscription pause/resume/cancel, card CRUD, dunning retry (all SSO-gated)
- Migration 037: dunning tracking columns on payment_events (dunning_status, retry_count, next_retry, started_at, resolved_at, source)
- Types in `src/types/payment-lifecycle.types.ts`: DunningParams, SubscriptionParams, CardManagementParams

---

## 2026-04-12

### Added
- **Payment Update Widget** — client-facing page at `/payment-update?contactId=X&locationId=Y` for updating payment methods
- `GET /api/payment-update/config` — returns processor type + tokenization key for the widget
- `POST /api/payment-update/update-method` — saves new card via ProcessorFactory (NMI Collect.js or Stripe Elements)
- Dual-rail support: NMI (Collect.js inline fields) and Stripe (Elements CardElement) in one widget
- Evidence logging on every payment method update (type: payment_update)
- Previous payment methods marked non-default when new one is saved
- postMessage `ssPaymentMethodUpdated` sent to parent GHL iframe on success

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
