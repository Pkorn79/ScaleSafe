# Changelog

All notable changes to ScaleSafe are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)

## Unreleased - Defense letter advocacy fix (2026-07-18)

### Changed
- Defense letters no longer announce evidence gaps to the dispute reviewer. When no service-delivery evidence exists, the letter is built entirely on the evidence on file (consent forensics, accepted terms and policies, client engagement) and simply omits delivery claims; internal gap notes are now explicitly marked as drafting constraints the model must never quote or allude to in the letter. Merchant-facing review warnings and the accept recommendation are unchanged.

## Unreleased - Marketplace billing entitlements (2026-07-17)

### Added
- HighLevel Marketplace plan and billing-status persistence for the $99 Standard and conditional $59 WholePay plans.
- ScaleSafe HQ approval and revocation controls for WholePay-provisioned NMI merchants.
- Backend processor capability enforcement across offers, public checkout, Quick Manual Sale, saved-card charges, GHL custom-provider charges, and NMI setup.
- Merchant-facing plan status and clear locked states for pending WholePay approval, failed billing, and unknown plans.

### Security
- Marketplace plan truth comes from signed HighLevel install, plan-change, and payment-status events; browser payloads cannot select a plan or NMI entitlement.
- Existing installations are explicitly grandfathered by migration 102, while new unrecognized installs fail closed.

## Unreleased - Reviewer enrollment evidence and branding (2026-07-16)

### Fixed
- Client-facing enrollment, checkout configuration, and payment-confirmation surfaces now prefer the merchant's DBA/brand name while signed packets retain the legal entity name when it differs.
- Enrollment packets now map semantic click-wrap identifiers to the clauses actually accepted instead of displaying every current clause as unaccepted.
- Full and quick checkout customer maps now retain the public program name and the buyer's resolved payment choice rather than an absent GHL product label or stale request value.
- Completion-time consent and enrollment-payment evidence now retain the resolved merchant ID, including enrollments whose merchant link was backfilled after consent capture.

### Documentation
- Expanded the installation runbook with merchant-profile setup, ScaleSafe-hosted terms, stable logo storage, subdomain and sending-domain setup, exact workflow proof, and a full evidence-linked checkout certification sequence.
- Updated the Marketplace reviewer script to use the certified reviewer offer, public program name, funnel URL, branding checks, and canonical terms URL.

### Verified
- Reviewer Stripe sandbox checkout created one linked client, enrollment, payment, consent record, enrollment-payment record, and private signed packet; the receipt and welcome emails were received.
- Focused enrollment/checkout/packet regression suites pass 52 tests; the full suite passes 165 suites and 1,348 tests.
- TypeScript typecheck, production build, root and UI production dependency audits, diff check, and redacted tracked-tree secret scan pass.

## Unreleased - Beta surface and recovery cleanup (2026-07-14)

### Fixed
- Dual-option Quick Checkout now creates a completed, non-recurring PIF enrollment when the buyer chooses paid in full. The payment stays attached to the client and offer without inheriting the offer's installment label, next billing date, saved recurring plan, or processor subscription.
- Stripe dispute routes now require a real Stripe dispute ID and Stripe processor scope. Locally compiled defense rows no longer appear in the Stripe active-dispute queue or expose impossible Stripe actions.
- Merchant views use an offer's internal label while client-facing enrollment, message, and workflow surfaces continue using the public program name.
- Offers now support a separate internal name without changing the existing client-facing offer name or historical enrollment records.
- Merchant roadmap pages now list future work only; working features no longer carry stale beta, setup, preview, or coming-soon treatment.
- Unreleased integrations and FanBasis checkout controls stay hidden until they are actually released for the tenant.
- Workflow setup displays Required, Recommended, or Optional instead of internal beta-priority terms.
- Offer processor labels identify Whop correctly instead of falling back to Default.
- Client next-payment summaries ignore stale dates, completed plans, paused billing, failed setup, and plans with visible billing issues.
- Payment Management no longer presents a fully paid installment plan as an actionable recurring plan solely because a stale processor subscription ID remains on the enrollment.
- Open merchant sessions recover once from stale lazy-loaded assets after a Railway deployment instead of leaving the route blank until a manual refresh.
- Installment progress no longer counts order bumps or upgrades as scheduled plan principal; checkout extras remain visible as separate line items.
- The legacy standalone offer preview no longer presents enrollment as a coming-soon feature.

### Added
- An encrypted off-platform Supabase database and Storage backup toolkit, stale-backup health check, scratch-only restore verifier, and daily systemd timer under `ops/recovery`.
- A beta closeout execution plan separating agent-owned verification from owner-only Marketplace and recovery credential actions.
- Focused regression coverage for recurring-payment visibility and hosted-checkout processor labels.

## Unreleased - Live Stripe payment integrity fixes (2026-07-13)

### Fixed
- Defense packet detail now loads and displays the latest persisted letter version on every open or refresh instead of resetting the label to Version 1.
- Defense milestone/signoff exhibits now use stable UTC dates, identify UTC on the operator surface, and rebuild signoff summaries from source timestamps rather than retaining environment-local legacy text.
- Dashboard at-risk scans now deduplicate concurrent requests, cache completed location results for five minutes, and cap evidence-query fan-out at three contacts so background risk reads cannot starve payment, webhook, or defense traffic.
- Dashboard at-risk reads no longer run the side-effecting disengagement action, update GHL fields, or create evidence simply because a merchant opened the page. Risk sources load concurrently with bounded contact concurrency; explicit administrative checks retain the write path.
- Enrollment-scoped pulse responses now appear in defense exhibits as client-engagement evidence, including the client's score, feedback, and follow-up request. Pulse responses remain communication evidence and cannot alone satisfy a service-delivery readiness gate.
- Defense compilation now preserves the selected payment's processor ID and transaction date when the UI also supplies its enrollment, and rejects conflicting transaction/enrollment/offer combinations instead of blending evidence.
- Exact-enrollment defense packets no longer admit contact-wide, date-only, offer-only, or offer-name-only activity. Inferred legacy scope remains explicitly reviewable, while repeated enrollments in the same offer stay isolated.
- The selected disputed payment is now a first-class exhibit with its processor references, amount, status, installment sequence, and order-bump/upsell line items.
- Defense offer context recognizes the live `installments` value and no longer describes installment purchases as paid in full.
- Generic lifecycle/custom-event notes no longer count as service-delivery evidence unless they carry an approved delivery, access, deliverable, or milestone proof role.
- Pending defense detail pages poll compilation status and replace the stale `Pending` screen automatically when the asynchronous letter and bundle finish.
- Recurring-payment and subscription lifecycle workflows now refresh the exact enrollment's program and payment fields before firing. If lifecycle fields cannot be synchronized, ScaleSafe suppresses the customer notification instead of sending a message for the wrong program.
- Finite Stripe installment plans now cancel exactly on the full billing-cycle boundary. The previous one-hour early `cancel_at` prorated the final installment (a live `$1.00` daily installment settled for `$0.96`).
- Whop subscription actions now validate the exact membership before mutation and confirm the resulting Whop state before ScaleSafe writes enrollment, evidence, or workflow state. Completed and non-recurring memberships are rejected instead of producing false local pause/resume/cancel records.
- Resuming a Whop recurring membership now restores the verified `renewal_period_end` as the enrollment's next billing date; immediate cancellation uses Whop's confirmed cancellation timestamp when available.
- Whop refunds now reserve the requested amount and wait for the signed `refund.created` event instead of treating Whop's returned `pay_...` Payment object as a refund record. The webhook links the canonical `rf_...` row to the exact payment and refund claim, while reconciliation can no longer mistake the original sale for its refund or send the refund workflow twice.
- Payment Management presents a Whop-accepted refund awaiting signed confirmation as a successful processing state instead of a red recording error.
- Payment Management now derives each charge's remaining refundable balance from linked refund/void rows and active processor refund claims. Fully refunded charges no longer offer another refund, and partial refunds are capped to the amount still available.
- Whop Quick Manual Sale now reconciles its embedded checkout against an authenticated, tenant-scoped ScaleSafe status endpoint, so webhook-confirmed payments replace the hosted form with a clear success state even when Whop does not invoke its browser callback.
- The Whop browser completion callback is now only a progress hint; it cannot mark a payment successful before the server confirms the exact enrollment.
- Quick Manual Sale refreshes client/payment data behind the modal after success but leaves the confirmation visible with one `Done` action instead of closing before the merchant can see the result.
- Client-profile Quick Manual Sale now refreshes both enrollment/payment records and the client summary, keeping Total Charged and Last Payment consistent with the newest payment row.
- Pay-first payment evidence now resolves later consent through the exact tenant-scoped enrollment ID when the payment predates the consent token; missing payment IP remains an explicit evidence gap.
- Paid-enrollment consent completion now starts private packet generation and evidence-chain verification independently of GHL workflow delivery, so a stale trigger retry cannot strand the enrollment's core evidence.
- Public enrollment clauses now preserve semantic standard-clause IDs. Paid-in-full enrollments omit the installment-billing acknowledgment, and accepted standard clauses can map to their intended GHL click-wrap fields.
- Client program payment totals now prefer exact enrollment IDs and unique processor subscription or Whop membership IDs; an ambiguous legacy same-offer payment is no longer copied across repeat enrollments.
- Whop Quick Manual Sale now preserves the pay-first consent boundary: payment creates a `paid_pending_enrollment`, sends the paid-enrollment link, and does not generate the final packet or fire `enrollment_complete` until the client signs.
- Stripe `charge.succeeded` events now preserve the PaymentIntent as the evidence-vault key and the Charge as the charge reference, so later dispute lookups do not lose transaction evidence.
- Stripe evidence-vault rows now retain offer, customer, terms, IP, billing, and CE 3.0 readiness fields whether the Charge or PaymentIntent webhook arrives first.
- Direct checkout now sends the resolved ScaleSafe offer name and program description to Stripe and replaces the old generic `ScaleSafe Payment` vault placeholder when richer metadata arrives.
- Standalone checkout idempotency now binds an attempt to the exact consent/enrollment context and clears it only after confirmed success, allowing legitimate repeat purchases in the same browser without weakening ambiguous-result protection.
- Stripe evidence-chain verification now tenant-scopes the vault through its real `merchant_id` key instead of querying a nonexistent `location_id` column.
- Whop embedded checkout now passes the collected phone value into session creation instead of failing in the browser with `custPhone is not defined`.
- Successful Stripe webhooks enrich the canonical payment row with settlement, Charge, and masked card metadata and update the linked enrollment's initial-payment state.
- Stripe evidence-vault persistence failures now return a retryable webhook failure instead of silently acknowledging lost evidence.
- Paid enrollment and GHL payment paths use the database-supported `sale` event type; checkout and settled ACH paths no longer attempt a redundant second ledger insert, and free enrollments no longer create payment rows.
- Checkout payment rows now retain processor Charge IDs, settlement timestamps, and whether consent was linked.
- Background packet generation logs no longer include signed private-file URLs.

### Live certification
- The exact Stripe Plan milestone and public client signoff produced one linked milestone row, one linked signoff row, correct GHL communications, and one delivery of each milestone workflow event. The regenerated Version 3 packet reached `complete` with eight exact-enrollment exhibits and no duplicate `ss_defense_ready` delivery.
- Regenerated defense packet `13971614-ca2d-4107-931e-41be587a5446` passed exact transaction metadata, installment language, sibling-enrollment isolation, four-exhibit parity, and `needs_review` gating without firing a second ready workflow.
- A full $1.50 Whop refund completed through ScaleSafe and produced one separate refund row; live review identified and repaired the original row's stale Refund action before any duplicate attempt was made.
- A fresh $1.50 Whop QMS payment stayed pending until consent, generated its private packet after signature, omitted installment terms for PIF, and produced a verified exact-enrollment consent/payment chain with the expected merchant-entered-payment IP gap.
- A new $1.00 Stripe paid-in-full enrollment produced one settled `sale` row, a correctly keyed PaymentIntent/Charge vault row, enrollment-scoped consent and payment evidence, a private enrollment packet, daily pulse scheduling, and successful receipt and welcome deliveries.
- The post-fix Railway deployment emitted no signed storage URL or token during packet generation.

### Verified
- Full test suite: 149 suites / 1,283 tests; focused defense-scope suites: 96 tests; focused Whop lifecycle suites: 21 tests.
- TypeScript typecheck, production build, and production dependency audit pass.

## Unreleased - Live walkthrough reliability fixes (2026-07-12)

### Fixed
- Defense packet detail now renders the exhibits frozen in the packet evidence snapshot instead of always showing zero exhibits; legacy packets report their preserved PDF exhibit count without mislabeling old contact-wide timeline rows as exhibits.
- Regenerating a defense letter now replaces the legacy evidence snapshot with the exact scoped exhibit set used by the new letter and rebuilt PDF.
- Merchant Settings tracks the fields that can actually be saved and no longer reports unsaved changes immediately after loading.
- Provisioning Health uses the full pulse diagnostic report, separating the app event delivered to GHL, observed outbound communication, and client submission timestamps.
- Missing, incomplete, or legacy Stripe health classifications display as Unknown instead of presenting untrusted Visa and Mastercard status as Safe.
- Quick Manual Sale enters its loading state before offer and processor configuration requests begin, preventing a false no-processor message during startup.

---

## Unreleased — Packet PDF upload: bypass stripe-node multipart (2026-07-12)

### Fixed
- **Packet PDF attach to Stripe disputes**: `stripe.files.create` returned Stripe's generic
  "Invalid request (check your POST parameters)" for a valid PDF (stripe-node's multipart
  upload path has runtime-specific regressions — see stripe-node #2538/#2420). The upload now
  POSTs directly to files.stripe.com via Node's built-in fetch + FormData on the merchant's
  connected account; failures surface Stripe's real message + param.

---

## Unreleased — Stripe dispute E2E fixes: ingestion, CE 3.0 payloads, submission resilience (2026-07-11)

> Found via the first live Stripe-dispute end-to-end test. Migration
> `097_dispute_events_unique_stripe_id.sql` was already applied manually in production
> on 2026-07-11 (guarded — safe to re-run).

### Fixed
- **Stripe dispute webhooks failed since inception**: the ingest upsert uses
  `ON CONFLICT (stripe_dispute_id)` but no migration ever created the required unique
  constraint (017 made a plain index) — every `charge.dispute.*` webhook 500'd. Migration 097
  adds the constraint.
- **CE 3.0 eligibility was stripped by old webhook endpoints**: payloads render at the
  endpoint's pinned API version (2022-11-15 predates CE 3.0). Disputes are now re-fetched via
  the SDK's modern version before storing, so `enhanced_eligibility_types` survives.
- **Text in file-only evidence fields 400'd submissions**: the vault evidence mapper put
  policy/communication TEXT into `refund_policy` / `cancellation_policy` /
  `customer_communication` (file-id-only fields). Text now goes to the `*_disclosure` fields /
  `uncategorized_text`; non-`file_` ids are dropped at the source AND sanitized again before
  submission.
- Raw Stripe errors leaked as generic "unexpected error" (they carry a statusCode, defeating
  the AppError passthrough check) — merchants now see the real message incl. the offending param.
- Stale PDF after a letter edit: the packet view now fully refetches (the edit rebundles the
  PDF server-side).

### Changed
- **Packet PDF upload failure no longer blocks submission**: near a deadline, the letter +
  structured evidence still reach Stripe; the attach failure is logged with Stripe's full
  diagnostics (type/param/request id) and recorded on the packet.
- Webhook triage failures are non-fatal (the dispute row is already persisted; a triage error
  must not force endless Stripe retries).

---

## Unreleased - Zoom Beta Catalog Release (2026-07-11)

> **Deploy ordering:** apply migration `094_enable_zoom_beta_catalog.sql` to expose the Zoom Connect button.

### Fixed
- Released the implemented Zoom OAuth integration as a Beta catalog option for every ScaleSafe sub-account. Each merchant still connects an isolated Zoom authorization stored against that merchant's GHL location; no per-merchant Railway variable is used.
- Zoom OAuth now refreshes the Evidence Connections catalog when the authorization popup closes. The setup no longer depends solely on `window.opener.postMessage`, which can be unavailable after Zoom's cross-origin authorization flow, and proceeds to the meeting-to-offer mapping step reliably.
- Removed merchant-managed Zoom meeting-to-offer mapping. OAuth now activates the tenant connection immediately; attendance resolves automatically using participant identity, exact enrollment eligibility, meeting-topic/offer matches, and unique live-virtual enrollment context. Ambiguous events quarantine for ScaleSafe HQ instead of asking merchants to repair them or guessing across programs.
- Added a provider-neutral scheduling bridge for deterministic attendance matching. GHL appointment webhooks now preserve the booking contact, calendar, meeting URL/ID, scheduled time, and enrollment match; Zoom attendance uses that signed booking record before email or offer-name inference. The same ledger is ready for future Calendly, Google Calendar/Meet, Acuity, SavvyCal, and Microsoft integrations.

## Unreleased - Integration Catalog and Access Gating Foundation (2026-07-11)

> **Deploy ordering:** apply migration `092_integration_catalog_and_access_gating.sql` before deploying this code.

### Added
- Merchant-facing Evidence Connections catalog covering coaching, course, agency delivery, support, files, checkout, and reporting providers with honest release and capability labels.
- Database-controlled provider/sub-account rollout, encrypted authorization storage contract, OAuth state ledger, external commerce ledger, per-offer delivery modes, and entitlement reconciliation state.
- Offer controls for evidence-only, ScaleSafe checkout with managed access, ScaleSafe consent with provider checkout, and provider checkout import. Controls appear only for active, approved provider resources with the required capabilities.
- Provider adapter contract for resource discovery, signed webhooks, commerce normalization, and access grant/revoke/reconciliation.

### Changed
- Removed `EVIDENCE_CONNECTOR_AUTOMATION_LOCATION_IDS`; Railway now contains only the global emergency switch. Provider rollout is tenant-bound in Supabase.
- Merchant connector management now exposes catalog, health, safe connection disablement, and the supported custom API credential flow while keeping raw mapper and replay tools in ScaleSafe HQ.

### Security
- External commerce records cannot mutate ScaleSafe payment truth.
- Access policies never revoke on partial refunds or the first failed installment; ambiguous events cannot change entitlements.

---

## Unreleased — Stripe Defense MVP-4: Visa Compelling Evidence 3.0 (2026-07-10)

> **Deploy ordering:** migration `091_ce3_vault_fingerprints.sql` must be applied in Supabase
> BEFORE this deploys — the evidence vault writes the new fingerprint columns on every payment.

### Added
- **Visa CE 3.0 on eligible fraud disputes**: when Stripe marks a 10.4 "unauthorized charge"
  dispute CE 3.0-eligible, Submit to Stripe automatically attaches prior-transaction proof —
  exactly 2 prior undisputed Stripe transactions from the same client sharing identity elements
  (IP/device fingerprint + email), shifting liability back to the issuing bank. Standard evidence
  stays attached as fallback. New matching engine `stripe-ce3.service.ts` with the integrity rule:
  candidates come only from payment_events rows tied to the same contact — never guessed.
- **CE 3.0 surfacing**: packet page shows an eligibility panel (pre-submit explainer,
  post-submit qualified/not_qualified, and "why not" reasons when proof can't be assembled);
  dispute queue rows get a CE 3.0 badge.
- **Capture hardening (migration 091)**: `stripe_evidence_vault` gains `card_fingerprint`
  (from charge webhooks — verifies same-payment-method priors, feeds future Radar blocking) and
  `customer_device_fingerprint` (checkout already sends it; now stored per transaction as a
  CE 3.0 main identity element). Late-arriving webhook fills gaps on existing entries.

### Changed
- Evidence pipeline accepts nested `enhanced_evidence` (was flat string map).

---

## Unreleased — Stripe Defense MVP-3: self-closing outcomes + setup instructions (2026-07-10)

### Added
- **Stripe verdicts auto-record on the defense packet**: when Stripe reports a dispute won or
  lost (`charge.dispute.closed`), the linked packet's outcome is recorded automatically
  (outcome row, lifecycle, GHL contact status) — no more manual Won/Lost clicks for Stripe-rail
  disputes. Manual buttons remain as fallback with a "Stripe reports this automatically" caption.
  Idempotent: skips packets that already have a terminal outcome.
- **RDR/Ethoca first-contact detector**: disputes that arrive or close already resolved log a
  stable `possible_rdr_or_ethoca_resolution` marker (raw payload already stored) so the first
  live auto-resolution self-documents for future flag bookkeeping.
- Prevention checklists: explicit "click **Activate**, then set your parameters" step for RDR and
  Ethoca, and a new step to enable Stripe's own dispute notification emails (Communication
  preferences) — replaces any need for ScaleSafe push notifications. Settings → Payments card
  carries the same instructions.

### Fixed
- **Dismissed inquiries were counted as losses**: `charge.dispute.closed` with `warning_closed`
  (inquiry ended without escalating) or `charge_refunded` recorded outcome `lost`; now recorded
  as `withdrawn` so win-rate stats aren't corrupted.

---

## Unreleased — Stripe Defense MVP-2: pre-dispute refunds + visibility (2026-07-10)

### Added
- **Early Fraud Warnings queue** on Stripe Risk Health: lists issuer fraud reports with the
  triage recommendation (+reason), 72-hour response deadline, and **Refund** / **Hold** actions
  wired to the existing respond endpoint (Refund issues a real Stripe refund; confirm explains
  it usually prevents the dispute + fee but the fraud report still counts toward Visa VAMP).
  EFW metric tile now shows an "awaiting your response" link into the queue.
- **Dispute Prevention card** in Settings → Payments (Stripe connected): explains RDR (Visa)
  and Ethoca (Mastercard) auto-refund rules with a deep link to the Stripe Dashboard
  dispute-prevention page, plus links to the Prevention Checklist and EFW queue.
- **Unmatched Stripe disputes on the dashboard**: open disputes with no defense packet (contact
  couldn't be resolved) now appear on the Open Disputes card pointing to the dispute queue —
  previously they were invisible outside the queue page.
- **Deadline urgency banner** on the dashboard: "N disputes due within 3 days" across packets
  and unmatched disputes.

### Fixed
- **Prevention Checklist rendered empty**: the view called `/api/stripe/prevention/:locationId`
  (path param) and read `.items` — the real route takes no param and returns
  `{visa, mastercard, overallCoverage}`; the `.catch` hid the 404. The RDR/Ethoca/Order Insights
  enrollment checklists (written long ago server-side) now actually render.
- Webhook skips defense auto-prepare for disputes that arrive already resolved
  (won/lost/charge_refunded/warning_closed — e.g. RDR/Ethoca auto-refunds).

### Changed
- RDR checklist copy is dashboard-first (enable at dashboard.stripe.com/settings/disputes;
  beta email only as fallback) and explains the auto-resolve rule trade-off.
- Removed the disabled "Dispute Submission Helpers (coming soon)" placeholder in Settings —
  replaced by the Dispute Prevention card.

---

## Unreleased - Automatic evidence connection and enrollment binding (2026-07-10)

### Added
- Operator-managed ScaleSafe HQ setup for draft connections, one-time credentials, safe raw-payload previews, approved resource mappings, exact-enrollment tests, activation, rotation, disabling, and idempotent replay.
- Server-only enrollment-link and subject-binding APIs that derive tenant ownership from the connector credential and bind stable outside identities to one exact ScaleSafe enrollment.
- Migration 090 with short-lived encrypted enrollment contexts, hashed bearer tokens, atomic context claims, automatic subject identity binding, activation state, mapping approval metadata, and expiration cleanup.
- Context propagation through full-enrollment widgets and quick checkout for Stripe, NMI, Stripe ACH, and Whop. QMS remains unchanged.

### Changed
- Merchant Evidence Connections is now read-only and shows source health, last evidence, published count, affected programs, and needs-attention state.
- Operator-managed connectors cannot accept public events until a credential, approved offer mapping, and successful exact-enrollment test exist.

### Security
- Merchant SSO can no longer create or rotate connector credentials, edit raw mappings, enumerate subject references, run tests, activate connections, or replay quarantined events.
- Enrollment context URLs contain only an opaque token; tenant, external contact, and external enrollment identifiers remain server-side.

---

## Unreleased - Universal external evidence connector (2026-07-10)

### Added
- Tenant-bound canonical evidence API and configurable raw-webhook connections with hashed credentials, HMAC support, secret rotation, persistent idempotency, PostgreSQL-leased processing, and exact enrollment resolution.
- Private external evidence attachments with signed upload preparation, HTTPS/domain/network validation, file signature checks, immutable storage paths, and defense-bundle inclusion.
- Merchant Evidence Connections settings and ScaleSafe HQ health diagnostics for connections, resource mappings, synthetic tests, event delivery, quarantine, and credential controls.
- Enrollment-scoped external sessions, access, assignments, resources, approved custom activity, pulse, and supplemental payment evidence now use the shared defense evidence contract.

### Security
- The legacy `/webhooks/external` route now always requires a valid merchant webhook secret and feeds the enrollment-safe event ledger; payload tenant identifiers can no longer select another sub-account.
- Connector test events, rejected mappings, unresolved events, and provider-supplied defense classifications can never enter a defense packet.

---

## Unreleased — Stripe queue + submission clarity fixes (2026-07-10)

### Changed
- Stripe dispute queue now shows only Stripe disputes (processor filter); NMI/manual
  chargeback rows stay in the Defense tab where they are worked.
- Submission actions are rail-aware: Stripe-linked packets say **"Submit to Stripe"** with an
  explainer and a confirm describing exactly what is sent (letter + packet PDF, locked after);
  manual rails keep "Mark Submitted" / "Have you submitted this to the bank yet?".
  New `isStripeDispute` flag on packet and defense-history responses.
- Accept-dispute confirmation spells out the consequence: permanent concession, cardholder
  keeps the funds, counts as a loss.
- Sidebar: Stripe Risk Health now sits under Defense (was visually nested under Roadmap).

### Fixed
- Dead `/defense/dashboard` links in DisputeManagement, PreventionChecklist, and
  SettingsPayments opened a broken packet-detail view (route falls through to `/defense/:id`).
- A failed dispute_events write after successful Stripe evidence submission was silently
  ignored; it is now logged loudly (the double-submit guard depends on that flag).

---

## Unreleased — Stripe MVP-1: gated dispute evidence submission (2026-07-10)

### Added
- **Mark Submitted now pushes evidence to Stripe** for Stripe-rail packets: the reviewed
  defense letter, the bundled packet PDF (uploaded via Stripe Files, recorded in
  `dispute_evidence_files`), the offer description, client identity, and enrollment date
  are submitted through the Disputes API. Hard safeguard gates — all failures abort with
  the packet left pending: refuses contact-wide packets (no enrollment link), refuses the
  automatic fallback draft (must regenerate/edit first), refuses double submission
  (idempotent), and enforces Stripe's ~4.5MB evidence-file limit.
- **Webhook auto-prepare**: `charge.dispute.created` now auto-prepares a defense packet
  through the normal review pipeline (exact payment-intent match only — no contact
  guessing; prefers the card network reason code over Stripe's coarse reason string).
  The old score-gated **auto-submit of raw vault evidence is removed** — evidence only
  reaches Stripe through a reviewed packet.
- `POST /api/disputes/:merchantId/:disputeId/prepare` — on-demand "Prepare Defense" from
  the dispute queue, sharing the same gated builder (422 when no contact match).
- Dispute list API now attaches `defense_packet_id` so the queue links to the packet flow.

### Changed
- `POST /api/disputes/:merchantId/:disputeId/submit` (ungated direct vault submit) is
  deprecated: returns 409 `USE_DEFENSE_PACKET_FLOW` with the packet id.
- Dispute queue UI: Submit button replaced with **Review & Submit** (links to the packet)
  or **Prepare Defense**; Accept fixed to the real 3-segment route.
- `submitEvidence` records `evidence_submitted_mode` ('auto'/'manual') alongside the
  existing auto-submit flag.

### Fixed
- Dispute queue UI called `/api/disputes/:id/submit-evidence` and `/api/disputes/:id/accept`
  (2-segment paths that 404) — now uses the real tenant-scoped routes.
- `StripeRiskHealth`, `PreventionChecklist`, and `SettingsPayments` called
  `/api/stripe/health/:locationId` and `/api/stripe/risk-audit/:locationId` — the real
  routes take no param, so health/risk data silently never loaded.
- Dispute amounts rendered as $0.00: UI read `amount_cents` but `dispute_events.amount`
  stores dollars.
- Gate failures now surface actionable messages to the merchant (typed 400/409/502 errors
  instead of a generic "unexpected error").

---

## Unreleased — Hotfix: white screens after chooser removal (2026-07-09)

### Fixed
- **All data views rendered blank** after the sub-account-chooser removal: `useApi()`'s
  return object still referenced the deleted `selectSsoLocation`, throwing a ReferenceError
  in every view that calls `useApi()` (Roadmap alone survived — it makes no API calls).
  Vite builds don't type-check, so the dangling reference shipped silently.

---

## Unreleased — GHL install fix + fail-closed SSO (2026-07-09)

> **Deploy ordering:** migration `088_merchant_token_columns_nullable.sql` must be applied in
> Supabase for new merchant installs to succeed (root cause of the INTERNAL_ERROR install
> failure: `encryptTokenUpdates` nulls the plaintext token columns, but migration 068 never
> dropped 001's NOT NULL on them — every new-merchant insert since the encryption change
> failed with 23502).

### Fixed (Marketplace install)
- **Migration 088**: `merchants.ghl_access_token` / `ghl_refresh_token` are now nullable
  (encrypted columns are canonical; plaintext kept for legacy reads).
- `encryptTokenUpdates` no longer encrypts empty-string tokens (INSTALL-webhook stubs stay
  valid on pre-088 schemas).
- **Per-target isolation in the OAuth callback:** one sub-account's DB failure no longer
  aborts the whole multi-location install; the response reports installed vs failed
  locations, and step-tagged logging identifies the failing location and step.

### Added (install architecture)
- **GHL Marketplace INSTALL/UNINSTALL webhook handling** on the default `/ghl` route
  (previously logged as "Unhandled"): per-location INSTALL upserts a merchant row
  (token-less stub until OAuth supplies tokens; reactivates uninstalled merchants),
  UNINSTALL marks the merchant uninstalled. Makes installs visible to ScaleSafe even when
  the OAuth callback fails, and scales to bulk agency installs.

### Security (fail-closed SSO — merchant sessions are single-location)
- **Removed the merchant-facing "Choose Sub-Account" screen.** A merchant session is bound
  to exactly one GHL sub-account. Agency-context launches (SSO payload without a
  locationId) now fail closed with a clear "open ScaleSafe from the sub-account" screen —
  no chooser, no single-merchant auto-pick, and `selectedLocationId` is no longer accepted.
- `ssoAuth` no longer lets an agency-context payload select a company location via the
  `x-location-id` header; sessions bind only to the payload's own locationId. Cross-merchant
  access remains exclusive to the HQ admin console (separate admin auth).

---

## Unreleased — Pulse merchant alerting (2026-07-08)

### Added
- **Dashboard "Pulse check-ins" card** (`GET /api/dashboard/pulse-checkins`): recent client
  pulse submissions from ScaleSafe's own `evidence_pulse_checkins` data (never dependent on
  GHL email delivery) — client name, program name resolved through the check-in's OWN
  enrollment, satisfaction score badge, submitted time, feedback snippet, click-through to
  the client profile.
- **Needs-attention warning:** `follow_up_needed` (the client checked the follow-up box) or
  satisfaction ≤ 2/5 renders a red "needs attention" badge with the reason; attention items
  sort first and the card header shows an attention count.
- **Evidence integrity preserved:** legacy rows without an enrollment link show
  "Not linked to a program — review" instead of guessing; the submit path (token-resolved
  enrollment, ambiguity rejected upstream) is untouched; pulse email trigger path unchanged.
- Launch checklist pulse-alerting item annotated with the implementation + manual retest steps.

---

## Unreleased — Dispute lifecycle prompts on cards + dashboard (2026-07-07)

### Added
- **"Have you submitted this to the bank yet?" on the defense card.** Ready packets
  (complete or needs_review, not expired) show a Mark Submitted button on the list card —
  merchants don't reopen a packet after downloading it, so the lifecycle question lives
  outside. Submitting still locks the letter, hence the confirm. (Deliberately NOT
  auto-marking on download: downloads happen for review too, and submission locks
  editing/regeneration. Stripe integration can auto-submit programmatically later.)
- **Open Disputes on the dashboard.** New card listing up to 5 actionable disputes —
  ready-but-unsubmitted packets ("Submitted to the bank?" → Mark Submitted) and
  submitted packets awaiting a decision ("Heard back?" → Won / Lost) — so outcomes get
  recorded from the place merchants actually visit. Rows link to the packet.

---

## Unreleased — Defense UX: stale-status refresh, deadline edit, list workflow (2026-07-07)

### Fixed
- **Stale needs_review callout after regeneration (UI half of the bug).** The regenerate
  button patched the letter text locally and never refetched the packet, so the server's
  freshly-recomputed status/error_message (shipped 2026-07-06) never reached the screen.
  Regeneration now refetches the full packet.

### Added
- **Editable response deadline (pre-submission).** `PATCH /api/defense/:id/deadline` +
  an Edit control on the deadline strip — the defaulted deadline may not match the
  processor's actual due date, and the merchant is the one who knows it. The optimistic-
  deadline caution now points at the Edit control. Rejected after submission.
- **Defense list workflow rework:** default filter is now "Open" (was All) with expired
  chargebacks excluded; default sort is newest-first (was deadline-soonest — the exact
  opposite of triage order); new "Expired" tab (pending packets whose deadline passed);
  countdown shows "Time expired" instead of counting overdue days, and only for
  unsubmitted packets; search box (client name, reason code, case number, amount).
- **One-click Won/Lost from the list card.** Submitted packets show "Heard back from the
  bank? Mark Won / Mark Lost" — records the outcome via the existing endpoint without
  opening the packet, so won chargebacks actually get tracked.

---

## Unreleased — Defense letters explain WHAT WAS SOLD (2026-07-06)

### Added
- **Offer context in the letter prompt.** The letter previously knew only the program's
  NAME; it now receives the frozen offer terms from enrollment (`getOfferContext` via
  `offers_mirror`): description, delivery method, price + payment structure, refund
  policy, and the milestone definitions (deliverables + client responsibilities). New
  required letter section — "What the client purchased" — describes the program in plain
  language a reviewer with no context understands, before any evidence is argued.
- **Reason-code-specific usage of the offer:** delivery disputes measure delivered items
  against the promised deliverables (for self-paced/on-demand programs, provisioned
  access to the promised materials IS delivery); description disputes compare the offer
  as accepted vs. delivered; billing disputes state the expressly authorized payment
  structure; fraud disputes tie enrollment identity to post-purchase engagement.
- **Evidence-variety guidance:** merchants capture different evidence per setup —
  enrollment/consent, milestones, sign-offs, pulse check-ins, inbound client replies,
  sessions, external-platform activity. The letter uses whatever is present (inbound
  engagement is strongest against "no value received") and never invents missing types.
- Fallback letter includes the program description/delivery/price when resolvable.
  Degrades gracefully when no offer resolves (contact-only scope path unchanged).

---

## Unreleased — Defense letter voice + 4855 output quality (2026-07-06, from regenerated-packet review)

### Changed (letter voice & structure)
- **Letters are now written in the merchant's first-person voice.** The system prompt
  previously mandated third person ("The merchant provided..."); it now requires a plain
  human opening ("We received chargeback case N for $X and we are disputing it because...")
  and first-person prose throughout — a letter FROM a merchant, not a report ABOUT one.
- **No tool attribution anywhere in bank-facing output.** The prompt bans mentioning
  ScaleSafe/software/systems as the author; the letter PDF footer now reads "Prepared and
  submitted by {merchant}"; the fallback letter drops "assembled by ScaleSafe" and the
  "requires merchant review before submission" sentence (workflow state never belongs in a
  submitted document); the enrollment-packet footer is reworded brand-neutrally.
- **Required letter sections added:** precise disputed-transaction identification in the
  opening (transaction date + processor transaction ID now passed in DISPUTE DETAILS) and
  an explicit "Request" section stating what the merchant asks the reviewer for. Exhibit
  index lines must state what each exhibit PROVES.
- **Milestone exhibits tell the full delivery story** (name, completion date, deliverables,
  client responsibility) — a thin `defense_summary` ("Access to ScaleSafe") no longer
  replaces the composed summary. The 4855 strategy now instructs connecting milestones to
  their notification emails and stating sign-off status factually.

### Added (strategy & review-state correctness)
- **Refund-before-dispute strategy flag.** Readiness now receives the dispute amount/date;
  a refund record predating the dispute holds the packet for review with a
  credit-already-issued recommendation, and a refund *communication* alone triggers a
  verify-with-processor warning (a merchant email is weak refund proof — per
  docs/CHARGEBACK_DEFENSE_OPTIMIZATION_RESEARCH.md). New prompt rule: a pre-dispute refund
  covering the disputed amount must lead the letter and the Request, never be buried.
- **Successful regeneration re-evaluates review state** via a shared `evaluateReviewState`
  (used by compile + regen): stale "AI draft was unavailable" reasons clear, genuine
  reasons persist, `ss_defense_ready` is never fired from regeneration.
- **Unrendered-template communications are excluded from exhibits**
  (`looksLikeUnrenderedTemplate`: raw {{merge_tags}}, orphaned punctuation, split-template
  label values — matches the live broken payment reminders, keeps real emails).
- **Deadline caution in the packet UI** when the stored deadline exceeds the dispute date
  + 20-day operational window (flag, never rewrite — it may be a real processor date).

---

## Unreleased — AI letter generation fix: adaptive-thinking response parsing (2026-07-06)

### Fixed
- **Every AI defense letter was failing with "Anthropic: Unexpected response format".**
  `claude-sonnet-5` runs adaptive thinking by default when the `thinking` parameter is
  omitted, so responses lead with a `thinking` block — `content[0]` is no longer the text
  block. The old guard required `content[0].type === 'text'` and threw on every response,
  silently dropping all letters (including the original live-test packet) into the
  deterministic fallback. `callClaude` now collects text blocks wherever they appear,
  handles `stop_reason: "refusal"` explicitly (thrown as a content outcome — never
  model-fallback across a refusal), and logs the response shape (stop_reason + block
  types) when no text is found. Letter `max_tokens` raised 8192 → 16000 since thinking
  tokens now share the output budget.

---

## Unreleased — Defense live-test fixes (packet a2d357fa, 2026-07-06)

> **Deploy ordering:** migration `086_defense_live_test_fixes.sql` was applied in Supabase by Philip
> on 2026-07-06 BEFORE this deploy (in chunks, with a live schema diagnostic in between — the file
> documents what ran). It re-applies migration 048's columns (never applied live), backfills
> `enrollment_id` from `raw_payload`, aligns `evidence_consent`/`evidence_enrollment_payment` with
> the code's write paths (live drift — consent and enrollment-payment evidence inserts were failing),
> widens `defense_letter_versions.generated_by` to allow `'system'`, and adds
> `defense_packets.internal_debug`.

### Fixed (live defense packet failures, 2026-07-06)
- **Evidence source query failures are no longer silently swallowed.** Supabase returns
  `{ data, error }` without throwing; the defense exhibit builder ignored `error` on every source
  query, so a schema mismatch (live `evidence_milestones.enrollment_id` missing) silently dropped
  all milestone evidence. Every source query now records failures into `ExhibitList.sourceErrors`
  (error-level log), and any source error forces `needs_review` and suppresses `ss_defense_ready`.
- **Fallback letters are now versioned.** `defense_letter_versions.generated_by` rejected
  `'system'` and the insert error was invisible — fallback letters never got a version row. The
  CHECK now allows `'system'`, inserts check their error and log loudly, and fallback versions carry
  an explanatory note.
- **True AI failure reason preserved.** The packet's `error_message` stays merchant-facing; the
  provider failure (message, HTTP status, per-model attempts) and any exhibit source errors are
  written to `defense_packets.internal_debug` (degrades to a warn log if the column is missing).
- **Legacy milestone scoping.** `scopedRows` now also reads `raw_payload.enrollment_id`/
  `enrollmentId` (in addition to `defense_metadata`), so pre-048 rows scope to the disputed
  enrollment even without the backfill.
- **Date-only display no longer shifts a day.** `response_deadline` (`2026-08-16`) rendered as
  Aug 15 in US timezones (`new Date('YYYY-MM-DD')` parses UTC midnight). New `parseDateValue`/
  `formatCalendarDate` in `humanize.ts` treat date-only values as local calendar dates; DefenseView,
  DefenseDetailView, and the days-remaining countdowns use them.
- **Merchant-safe deadline defaults.** The compile form no longer defaults the response deadline to
  the card network's maximum (MC 45d); defaults are capped at a 20-day operational window
  (`OPERATIONAL_RESPONSE_DAYS`, mirrored in `reason-codes.ts`), with copy telling the merchant to
  use their processor's actual due date when known.
- **Defense packet noise.** Internal readiness-score threshold events (`custom_event` rows with
  `event_type: evidence_milestone` / `readiness_score`) are excluded from exhibits — they are
  bookkeeping, not service-delivery proof. Unlinked communications now sort after all other
  exhibits (they led the live packet as Exhibits A–E), and the signed enrollment packet leads when a
  reason code's priority list has no consent key (per-code ordering like 13.6's refund-first is
  unchanged).

### Added (AI model fallback, 2026-07-06)
- **Ordered model fallback in `anthropic.client.ts`.** `ANTHROPIC_MODEL_PRIMARY` +
  `ANTHROPIC_MODEL_FALLBACKS` (comma-separated). Transient errors (429/5xx/network) retry the same
  model with backoff; the next model is tried only on 404 (retired/unknown model), 403 (model
  access), or exhausted transient retries. 400/401/refusals/format errors throw immediately —
  falling back there would hide product bugs. Every attempt is recorded (`modelAttempts`) and
  surfaced on success and on thrown errors; the letter version row records the model actually used.

### Tests
- New: fallback letters get a version row; AI failure internals in `internal_debug` with clean
  merchant-facing text; source-error → `needs_review` (no ready fire); legacy raw_payload milestone
  inclusion; milestones schema failure recorded + logged; internal score-event exclusion; packet
  leads/unlinked comms demoted for 4855-style priorities; date-only rendering without timezone
  shift; model fallback on 404/403/transient-exhaustion only; ready fired exactly once.
  Full suite: 109 suites / 925 tests green.

## Unreleased — Defense optimization Phase 1 (reason-code-aware packets)

> **Deploy ordering:** migration `085_seed_expanded_reason_codes.sql` should be applied in Supabase
> with (or before) this deploy. Code works without it (new codes fall back to category strategy with
> default exhibit order), but per-code evidence priorities and strategy guidance come from the seed.

### Fixed (defense output honesty, 2026-07-05)
- **Removed a false Visa CE 3.0 claim from Stripe evidence submissions.** `stripe-dispute.service`
  asserted "prior non-disputed transactions with matching IP … CE 3.0 pre-dispute block criteria met"
  based only on having IP+email+description on file. Fraud evidence now states only captured facts
  (purchase IP, email, terms-acceptance timestamp). `stripe_evidence_vault.ce30_eligible` is now
  always written false until a real eligibility engine exists (`ce30_fields_complete` remains the
  data-completeness flag; triage scoring uses it).
- **Unknown reason codes no longer silently defended as "services not provided."** Unrecognized codes
  map to a `general` category and force `needs_review` with an explanatory reason.
- **Enrollment packet PDF robustness:** long unbroken values (T&C hash, transaction IDs) now wrap
  inside their table cells; device-info separator switched to ASCII (middle dot rendered as
  replacement glyphs in some PDF font subsets). Duplicate cancellation exhibits deduped (earliest
  record per enrollment — the one with legal weight).

### Added (reason-code-aware defense, 2026-07-05)
- **`src/constants/reason-codes.ts`** — registry of ~40 codes across Visa/Mastercard/Amex/Discover
  with network, dispute category, and per-network response windows (Visa 30d, MC 45d, Amex 20d,
  Discover 20d). New categories: `canceled_recurring`, `misrepresentation`, `canceled_services`,
  `duplicate_processing` — each with its own AI strategy block in `buildSystemPrompt`.
- **Migration `085`** seeds `reason_code_strategies` for all new codes (evidence priorities +
  strategy guidance; `historical_win_rate` left NULL — no invented numbers).
- **Per-code exhibit ordering.** Exhibits are re-sorted by the reason code's `evidence_priorities`
  and re-lettered (refund record leads for 13.6, cancellation ledger for 13.2, consent forensics for
  fraud). The PDF bundler derives the same priorities from the packet's reason code, so letters stay
  identical across compile/regenerate/manual-edit rebundles.
- **`src/services/defense-readiness.service.ts`** — reason-code missing-evidence checks and
  "don't fight this" red flags: no delivery evidence for a services-not-provided dispute, no consent
  forensics for fraud, and billed-after-cancellation (cancellation record predates the disputed
  charge — generally indefensible). Red flags mark the packet `needs_review` with an explicit
  "consider accepting" recommendation; `ss_defense_ready` is not fired.
- **Transaction timeline.** Chronological table (date → event → exhibit ref) with disputed-charge and
  chargeback-filed markers, derived from the exhibit list: included in the AI letter (structure item 3)
  and server-rendered in the bundled PDF's exhibits page. `DisputeScope` now carries `transactionDate`.
- **Prior Undisputed Transactions is now conditional** — included only for fraud/authorization/
  canceled-recurring disputes where it has evidentiary weight, omitted as filler elsewhere.
- **UI:** reason-code dropdown expanded to all four networks (grouped); deadline auto-derives from the
  selected code's network window instead of a hardcoded +21 days (which silently overshot Amex's 20-day
  window); the network window is shown under the selector.

## Unreleased — needs_review UI treatment

### Added (defense packet review UX, 2026-07-05)
- **Clear visual treatment for `needs_review` defense packets** (UI only — no generation logic changes).
  - New global `badge-orange` class; `needs_review` renders orange, distinct from `pending` (yellow),
    `processing` (blue), `complete` (green), and `failed` (red).
  - Defense packet list cards now show a compilation-status badge whenever status ≠ `complete`
    (needs_review / failed / processing / pending), alongside the lifecycle badge.
  - Defense detail page shows a prominent callout under the deadline strip when a packet is
    `needs_review`, explaining review is required before submission and listing the stored
    review reasons (from `error_message`).
  - "Mark Submitted" is now available for `needs_review` packets (backend already permitted it —
    the UI previously only offered it for `complete`, which would have stranded reviewed packets).

## Unreleased — Defense packet regression fix (transaction-scoped evidence)

> **Deploy ordering:** migration `084_defense_needs_review_status.sql` MUST be applied in Supabase
> **before** this code deploys. `runCompilation` now writes `status = 'needs_review'`, which the
> existing `defense_packets_status_check` constraint rejects until 084 widens it.

### Fixed (defense packet regression, 2026-07-03)
- **Defense output is now scoped to the disputed transaction/enrollment instead of dumping every
  contact-wide evidence row.** Root causes were (1) the retired `claude-sonnet-4-20250514` model with
  no retry, which silently dropped every letter into the generic fallback, and (2) an empty
  `enrollmentId` from the UI combined with an open exhibit-scoping default that returned all contact
  evidence.
  - `src/clients/anthropic.client.ts`: default model moved to `claude-sonnet-5` (overridable via
    `ANTHROPIC_MODEL`); `callClaude` now retries transient failures (429/500/502/503/504/529 + network
    timeouts) with exponential backoff + jitter, up to 3 attempts, before falling back.
  - `src/services/dispute-scope.service.ts` (new): `resolveDisputeScope()` resolves a disputed
    transaction to a specific enrollment/program (via enrollmentId → paymentEventId → inference) and
    returns a scope with `scopeConfidence` (`exact` | `inferred` | `contact_only`) and `gaps[]`.
  - `src/services/defense-exhibits.service.ts`: missing enrollment no longer means "include everything";
    contact-wide rows are only returned under explicit `contact_only` scope (and tagged
    `unverifiedScope`). Unlinked communications capped at 5. `scopedRows` exported for testing.
  - `src/services/defense.service.ts`: threads resolved scope through exhibit building, prior-payment
    scoping, prompt building, and PDF bundling. On AI failure after retries it now emits a **structured**
    fallback letter (Transaction/program, Authorization, Service delivery, Payment/refund/cancellation,
    Prior payment, Evidence gaps, Exhibit index) instead of the generic "found X evidence records"
    paragraph. Fallback **and** contact-only packets are marked `needs_review` and do **not** fire
    `ss_defense_ready`. Regenerate and manual-edit rebundle paths re-resolve scope for consistency.
  - `src/services/payment.service.ts`: `getUndisputedPayments()` accepts an optional `enrollmentId` and
    orders same-enrollment payments first (primary), others after (secondary relationship evidence).
  - `src/ui/src/views/DefenseView.vue`: warns when the selected transaction isn't linked to a program,
    instead of silently sending an empty `enrollmentId`.
  - Migration `084_defense_needs_review_status.sql`: adds `needs_review` to the `defense_packets.status`
    CHECK constraint.
  - Tests: anthropic retry/backoff, dispute-scope resolution, exhibit scoping fail-safe, enrollment-scoped
    prior payments, and defense-service needs_review/fallback gating.

## Unreleased — Bug-hunt Batches A–H (complete; pending review/merge)

> **Deploy ordering:** migrations `072`/`073`/`074` (pushed) + `077` MUST be applied in Supabase **before**
> this code is deployed. `handleRecurringPaymentSuccess` calls `record_recurring_payment`, the
> dunning-retry/refund paths call `record_recurring_payment`/`decrement_enrollment_payments_made`;
> without the migrations, live recurring webhooks, refunds, and dunning retries will throw.

### Added (FanBasis integration — Phase F1 foundation, 2026-06-19)
> **Deploy ordering:** migration `081_fanbasis_checkout_channel.sql` (applied 2026-06-19) must be in Supabase
> before this code deploys — `fanbasis-config.service` reads/writes the new `fanbasis_configs` table.

- **FanBasis "Model B" checkout channel — foundation only.** Mirrors the Whop integration; FanBasis is a
  Merchant-of-Record provider kept entirely separate from the NMI/Stripe `ProcessorInterface`.
  - Migration `081` (additive only): new `fanbasis_configs` table (per-merchant, encrypted API key +
    webhook secret) and additive `fanbasis_*` columns on `offers_mirror`/`enrollments`. No existing
    constraint altered — `checkout_type`/processor CHECK widenings are deferred to F2.
  - `src/clients/fanbasis.client.ts` (shell), `src/services/fanbasis-config.service.ts`,
    `src/controllers/fanbasis-config.controller.ts`, and `/api/processor-config/fanbasis` routes
    (get/save/test/disconnect). Credentials encrypted with the same AES-256-GCM util as NMI/Whop.
  - Settings → Payments **FanBasis credential card** (Save/Disconnect only — the Test Connection button is
    deferred to F2 pending sandbox endpoint confirmation; the backend `/fanbasis/test` route exists but is
    not surfaced). Offer form shows a **disabled "FanBasis — Coming soon"** checkout radio. `featureCatalog`
    entry added as `coming_soon`.
  - Tests: `fanbasis.client`, `fanbasis-config.service` (real-crypto encryption round-trip),
    `fanbasis-config.controller` (+18 tests; suite 97 suites / 818 tests). No Stripe/NMI/ProcessorInterface
    behavior changed. F2 (embedded/hosted checkout + webhooks) is gated on the documented sandbox checks.

### Added (Launch readiness — CI + go-live gate, 2026-06-15)
- **GitHub Actions CI** (`.github/workflows/ci.yml`) — runs on push to `main` and on PRs:
  `typecheck`, the full Jest suite (88 suites / 736 tests), a backend+UI `build`, and an advisory
  `npm audit --omit=dev`. Report-only at first (no required status checks) so it never blocks the
  direct-push-to-main flow; promote `quality`/`build` to required once consistently green. ESLint is
  intentionally deferred (warning mode only, later) to avoid drowning CI in style noise.
- **`docs/LAUNCH_READINESS_CHECKLIST.md`** — the single go-live gate: pre-deploy migration ordering,
  the open Group B (day-1 double-bill) / Group F (NMI Query API permission) verification items,
  security/multi-tenancy gates, OAuth/provisioning verification, UX, GTM, and ops sign-off.
- **Launch-critical route tests** (additive; no production code changed) for the money-movement and
  chargeback-defense surfaces that previously had no dedicated coverage. Full suite now 94 suites /
  797 tests (was 88 / 736). New files:
  - Refund (`payment-management.refund.controller.test.ts`): validation, tenant scoping, refundable-
    event guard, **double-refund protection** (remaining-balance math), pending-refund-is-accepted (#11),
    no-ledger-row-on-hard-failure.
  - Quick manual sale (`dashboard.manual-sale.controller.test.ts`): tenant scoping, request→service
    param/amount mapping, passthrough, and ProcessorError→502 translation.
  - Offer create/update/clone (`offer.controller.test.ts`): tenant-scoped delegation, status codes,
    clone envelope, validation/error forwarding.
  - Payment-provider provisioning/repair (`processor-config.controller.test.ts`): **NMI credential
    encryption verified with the real crypto** (plaintext never persisted, round-trips, secret never
    echoed), connection-test pass/fail, disconnect scoping, default-processor gating.
  - Subscription lifecycle (`payment-lifecycle.routes.test.ts`): required-field validation, tenant +
    per-action status-whitelist scoping (pause/resume/cancel), service-throw → 500.
  - Dispute + EFW defense (`dispute-efw.routes.test.ts`): tenant-mismatch 403, evidence submit/accept,
    EFW respond routing, and **service-throw → 500 so a chargeback is never silently left unanswered**.
- **`.github/dependabot.yml`** — weekly grouped npm + github-actions dependency PRs (backend + UI);
  opens PRs only, never auto-merges.
- **Toast notification system** (UX polish). New `src/ui/src/composables/useToast.ts` (module-level
  singleton, same pattern as `ssoSession`) + `src/ui/src/components/ToastContainer.vue` (teleported,
  accessible with `role="alert"`/`status` + `aria-live`, `prefers-reduced-motion` aware, matches the
  brand token system). Mounted once in `App.vue`. `useApi` now auto-fires an error toast on any failed
  `post`/`put`/`del`, so a failed action (refund, save, disconnect, dispute submit) can no longer fail
  silently. Reads stay quiet (views already show inline load/error states). Views can call
  `toast.success(...)` to confirm actions. Verified: `vue-tsc` clean on all touched files, `vite build` passes.
- **Loading skeletons** (UX polish). New `src/ui/src/components/Skeleton.vue` (shimmer placeholder,
  `prefers-reduced-motion` aware). `DashboardView` first-load now renders a skeleton layout mirroring
  the real stat/content cards (with `aria-busy`) instead of a bare "Loading dashboard..." string.
- **Marketing landing page (first draft)** — `marketing/index.html`, a self-contained, deployable
  page (no app dependency) with an "evidence dossier" aesthetic: editorial Fraunces/Hanken Grotesk
  type, the brand emerald/navy/cream palette, a won-dispute hero timeline, accessible scroll-reveal as
  progressive enhancement (content visible if JS fails), and reduced-motion support. Stats are tagged
  `[PLACEHOLDER]` — no fabricated metrics or testimonials. Verified rendering across all sections via
  Chrome DevTools. Copy to be confirmed by the brand owner before publishing.
- **GHL Marketplace listing draft** — `docs/GHL_MARKETPLACE_LISTING.md`: name/tagline/short+long
  description, key features, an OAuth-scope-justification table to fill, a screenshots plan, and a
  pre-submission checklist. Claims to be verified against the live app; copy needs brand-owner sign-off.
- **Marketplace / GTM copy aligned for private beta** — `docs/GHL_MARKETPLACE_LISTING.md` and
  `marketing/index.html` now use the safer evidence-first positioning ("build the evidence trail before
  the dispute happens"), private-beta/contact pricing, no fabricated stats, and no guarantee-style
  "win every chargeback" claims. Launch docs also record Group F NMI Query API as passed for the
  current merchant based on the 2026-06-15 live NMI vault/subscription proof.
- **Public site support/legal pages** — added static `marketing/privacy.html`, `terms.html`,
  `support.html`, `guide.html`, `troubleshooting.html`, and `README.md` so `scalesafe.app` can host the
  Marketplace-required legal/support URLs plus a lightweight beta help center. Landing footer and the
  Marketplace listing now point at the intended `https://scalesafe.app/*` URLs.
- **Whole Pay attribution** — public site pages and the Marketplace listing now identify ScaleSafe as
  powered by Whole Pay and link to `https://getwholepay.com` without changing the processor-direct funds
  positioning.
- **Oke Marketplace update guide** — added `docs/OKE_MARKETPLACE_UPDATE_GUIDE.md`, a safe step-by-step
  handoff for updating the GHL Marketplace listing without touching OAuth credentials, redirect URLs,
  webhooks, payment-provider settings, or submission controls.
- **Marketplace pricing guidance corrected** — Oke's guide and the listing worksheet now match GHL's
  actual Pricing options: choose **Free** for beta and do not create billing meters, paid plans, or
  freemium plans unless Philip explicitly approves Marketplace-managed billing later.
- **Marketplace auth guidance clarified** — Oke's guide now separates GHL app permissions/scopes from
  the optional External Authentication toggle. External Authentication stays off, and permission/scope
  justifications are only prepared if HighLevel specifically asks during review.
- **Group B regression test** — `tests/unit/stripe.client.test.ts` now covers `createSubscription`'s
  day-1 double-bill guard: a future `startDate` sets `billing_cycle_anchor` + `proration_behavior='none'`;
  no/near-now `startDate` omits them. Locks the shipped fix against silent regression (suite now 800 tests).
- **`docs/LAUNCH_BLOCKER_VERIFICATION.md`** — step-by-step live-verification runbook (SOP format) for the
  three open blockers: Group B (Stripe-sandbox 2-pay), Group F (NMI Query API enablement), and the E2E
  retest matrix for the latest checkout add-on / order-bump / payment-repair fixes.

### Changed
- **Primary CTA contrast meets WCAG AA.** `.btn-primary`, `.btn-success` (App.vue) and `.ss-btn-primary`
  (Button.vue) moved from emerald-500 `#10b981` (white text ≈ 2.54:1, **fails** AA) to emerald-700
  `#047857` (≈ 5.5:1, passes), hover to emerald-800. Same brand hue, accessible depth. Funnel/secondary/
  tertiary variants unchanged (already compliant).

### Added
- **Atomic, idempotent recurring-payment recording.** New `record_recurring_payment` RPC
  (migration `073`) inserts the `payment_events` ledger row, increments `payments_made`, and
  advances `next_billing_date` in one transaction. Dedupe is enforced by a partial UNIQUE index
  on `payment_events(location_id, processor, processor_transaction_id)` (migration `072`); a
  duplicate webhook delivery returns `is_duplicate=true` and performs no increment. Closes the
  TOCTOU double-increment race across the NMI/Stripe/Whop/GHL recurring paths (bug hunt #3).
- **Schedule-source tracking.** `enrollments.next_billing_date_source` (`processor` |
  `estimated` | `complete`) records whether the next billing date came from the processor or an
  anchored fallback estimate; estimates are flagged for verification rather than treated as
  healthy (bug hunt #20). New `billing_setup_status` / `billing_setup_error` columns
  (migration `074`) prepare Batch H surfacing of failed processor-subscription setup.

### Changed
- **`handleRecurringPaymentSuccess` no longer computes `next_billing_date` from `now()`** and no
  longer performs a separate increment → manual insert → manual update sequence. The schedule is
  anchored to the prior date (or the processor-resolved date passed by the caller), never the
  processing timestamp.

### Fixed (Batch B — ledger accounting symmetry)
- **Refunds now reverse the enrollment ledger (#7).** `handleRefund` calls the new
  `decrement_enrollment_payments_made` RPC (migration `077`), floors `payments_made` at 0, clears
  `billing_completed_at`, and re-syncs `PAYMENTS_MADE`/`PAYMENTS_REMAINING` contact fields — so a
  refunded installment no longer overstates `TOTAL_PAID`/running-total defense evidence.
- **Dunning retry success now advances the schedule (#5).** A recovered installment is recorded
  via `record_recurring_payment` (insert + increment `payments_made` + advance `next_billing_date`)
  instead of a bare ledger insert, so the cron no longer re-bills it and reconciliation no longer
  flags it overdue.
- **Dunning now initiates even when the failed-payment insert fails (#6).** `initiateDunning`
  tolerates a null `paymentEventId`: the past-due workflow, card-update link, and
  `ss_payment_failed` trigger still fire (auto-retry is skipped without an event row).
- **GHL recurring `next_billing_date` is anchored to the prior schedule, not `now()` (#20).** Late
  or replayed GHL webhooks no longer drift the schedule forward; the estimate is marked
  `next_billing_date_source='estimated'`.
- **Dunning retry amount uses `Math.round` (#14)** and the retry is guarded by an atomic
  `dunning_status` claim that is released on failure (#2) — no concurrent double-charge, no poisoned
  retries. *(shipped with Batch A; noted here for completeness.)*

### Fixed (Batch C — Stripe processor-client correctness)
- **Stripe `subscriptions` cancel_at uses calendar arithmetic (#16).** `stripeCancelAtSeconds`
  adds real calendar months/years (not a 30-day approximation) so an installment plan can no
  longer overshoot into one extra invoice on short-month / end-of-month anchors.
- **`paymentIntents.retrieve` / `customers.retrieve` use the 3-arg form (#15)** so the
  `stripeAccount` is sent as the options arg (header), not serialized as params — verification &
  card listing on connected accounts no longer fail.
- **Manual "charge saved card" uses `chargeStoredCard` (#9)** instead of `charge()` with a vault
  id in `paymentToken` — manual collections now work on both NMI and Stripe.
- **GHL queryUrl charge/subscription derive the processor token from the payment-method row (#10)**
  instead of passing the ScaleSafe DB UUID as the Stripe `payment_method`.
- **Pending refunds are recorded, not reported as failures (#11).** A Stripe `pending` refund is
  treated as accepted (status `processing`), so the refundable balance reflects it and a re-issue
  cannot double-refund.

### Fixed (Batch D — webhook reliability + dispute recording)
- **Stripe webhook returns 5xx on handler failure (#4)** instead of always 200, so a transient
  failed write (missed recurring increment, unpersisted dispute) is retried by Stripe rather than
  lost. Safe because recurring recording is idempotent. The `charge.dispute.created` upsert error
  is now checked and thrown (was silently swallowed → missed dispute deadline).
- **Whop disputes are recorded in `dispute_events`, not `payment_events` (#28).** `'chargeback'`
  is not a valid `payment_events` event_type (the insert failed the CHECK and was lost); Whop
  disputes now persist to `dispute_events` with `processor='whop'` (migration `078` extends the
  processor CHECK) and a `needs_response` status.
- **NMI chargeback-ratio trigger fires once on crossing, not every day (#23).** `checkNmiRatio`
  now persists an `account_health_snapshots` row (`processor='nmi'`) before evaluating thresholds,
  so the crossing-guard compares against yesterday's rate instead of a perpetual 0.

### Fixed (Batch F — multi-tenant scope + offer integrity)
- **NMI diagnostics queries are location-scoped (#18).** `diagnostics()` adds `.eq('location_id', …)`
  to the `payment_events` and `nmi_silent_post_logs` lookups, closing a cross-tenant
  payment-metadata leak on NMI subscription-id collisions.
- **`assignOffer` scopes the offer lookup to the caller's location (#19)** — an authenticated
  merchant can no longer enroll a contact against another tenant's offer by guessing its UUID.
- **`cloneOffer` no longer copies processor-side IDs (#13/#31).** Whop `product_id`/`plan_id`/
  `sync_status` and `tracking_id` are excluded and nulled, so editing a clone no longer mutates the
  source's live Whop product/plan and per-offer tracking reports no longer conflate the two.

### Fixed (Batch E — evidence vault correctness)
- **Evidence vault lookups translate GHL contact id → Stripe customer id (#12).** Contract,
  session-log, and communication-trail uploads (and the client score refresh) were filtering the
  vault by `stripe_customer_id` using a GHL contact id, silently matching zero rows and dropping
  merchant-uploaded chargeback evidence. They now resolve the Stripe customer via `payment_methods`
  and log when an update matches no rows.
- **Offer-terms evidence is scored consistently (#17).** The client-side score refresh and
  `getVaultEntryForCharge`/`getEvidenceGaps` now read the offer's `stripe_terms_file_id`
  (terms live on `offers_mirror`, never on the vault row), so the "terms not uploaded" gap no
  longer always fires and `evidence_score` is deterministic.

### Fixed (Batch G — frontend)
- **Param-only navigation reloads money/defense screens (#22/#26).** `<router-view :key="$route.fullPath">`
  remounts the view on `/clients/A → /clients/B` (and payment-management contact switches), so a
  charge/refund/card action can no longer target the previously viewed customer.
- **Malformed numeric HTML entities no longer crash communication-evidence ingestion (#27).**
  `decodeHtmlEntities` clamps code points to the valid Unicode range before `String.fromCodePoint`,
  so a spam message like `&#9999999999;` can't drop a message's evidence or 500 the feed.
- **Scorer-flagged At Risk clients can auto-clear (#29).** `disengagement.service` writes a
  `disengagement_flagged` custom_event so the re-engagement detector recognises non-payment At Risk
  clients and fires the "Client Re-Engaged" workflow on their return.
- **Dispute Auto-Submit toggle is disabled until its endpoint exists (#30)** so merchants are not
  misled into believing strong-evidence disputes are auto-filed when they are not.
- **PaymentSearch ledger load has a request-sequence guard (#32)** so an out-of-order async response
  cannot show rows/totals that don't match the active filters.

## 2026-05-07

### Changed
- **Workflow field contract cleaned for beta Snapshot.** Added `docs/WORKFLOW_FIELD_CONTRACT_MATRIX.md` after auditing live PMG custom fields/custom values, app-written fields, and the original Claude/Oke workflow DOCX instructions. Canonical app fields now win: workflow templates should use `contact.offer_name`, `contact.offer_price`, `contact.offer_num_payments`, and `{{ custom_values.merchant_support_email }}` instead of stale/nonexistent aliases like `contact.offer_program_name`, `contact.offer_price_display`, `contact.offer_number_of_payments`, and `contact.offer_support_email`.
- **Enrollment contact sync stays ahead of workflow triggers without alias writes.** `phase2Enrollment.service.ts` keeps the useful pre-trigger GHL contact field sync, but no longer attempts to write the stale alias fields that do not exist in live PMG.
- **Trigger integration test aligned with normalized payloads.** The test now expects the current trigger payload contract (`event_type`, location aliases, and contact aliases) and mocks `trigger_delivery_logs`, keeping the full suite green.

### Documentation
- **Snapshot docs now block duplicate field drift.** Updated snapshot/provisioning docs and Cowork references so PMG workflow bodies must be corrected to canonical fields before beta Snapshot export, and older field references are marked historical.

---

## 2026-05-05

### Added
- **Quick Pay buyers now receive payment receipts.** A successful Quick Pay charge fires `ss_payment_received` with the new `payment_kind` field set to `one_off` (PIF Quick Pay), `installment`, or `subscription`. The PMG Recurring Payment Receipt workflow can branch on `payment_kind` to vary copy between one-off thank-you and installment "X of Y" framing. Existing recurring fire sites (`phase2Enrollment.handleRecurringPayment`, `recurring-payment.service.ts`, dunning recovery) also include `payment_kind` so the same workflow handles every receipt scenario from one trigger. Backwards compatible: workflows that ignore the field continue to work.
- **Quick Pay installments and subscriptions are now fully recurring.** When a Quick Pay buyer purchases an offer with `payment_type='installment'` or `'subscription'`, the app creates a synthetic enrollment row (`status='enrolled'`, `payments_made=1`, `payments_total` from `offer.num_payments`, `next_billing_date` from `offer.installment_frequency`). The existing `runRecurringBilling` daily cron then charges payments 2..N automatically and the existing `runPaymentReminderCheck` cron fires `ss_upcoming_payment_reminder` 3-day and 1-day before each cycle — no new triggers, no new crons. Idempotency: looks up existing enrollment by `payment_transaction_id` before insert.
- **Merchant-facing master toggle for engagement tracking.** New `engagement_enabled` boolean column on `merchants` (migration `055_engagement_enabled.sql`, default `true` to preserve current behavior). Settings now exposes an "Engagement Tracking" card between Evidence Modules and Dunning. When the toggle is OFF, the app skips every write to `ss_engagement_status` (`disengagement.service.ts checkAllClients`, `evidence.service.ts` re-engagement detector, `phase2Enrollment.service.ts` enrollment baseline, and the `checkout.controller.ts` Quick Pay baseline), so the `SS - Client Re-Engage` and `SS - Re-Engagement Outreach` workflows never fire. Risk scoring still runs so the at-risk dashboard remains accurate.

### Changed
- **Dunning escalation no longer writes `ss_engagement_status='At Risk'`.** Engagement state is now driven only by the multi-factor disengagement scorer, not raw payment failures. `paymentLifecycleService.escalateDunning` continues to set `ss_enrollment_status='delinquent'` and the `SS - Payment Failed` workflow continues to handle dunning comms unchanged. Payment failures still influence engagement risk through factor #5 of the scorer (recent failed payments contribute +15 risk), so a merchant with both signals firing still flags the contact via the proper aggregation path.

### Fixed
- **Standard enrollment now seeds `ss_engagement_status='Active'`.** `phase2EnrollmentService.completeEnrollment` was writing `ss_enrollment_status='enrolled'` but leaving `ss_engagement_status` blank, so the `SS - Client Re-Engage` workflow's Contact Field Changed trigger had no baseline value to fire from on later re-engagement. Standard consent-token enrollments now write the same `'Active'` baseline that the Quick Pay path already wrote at `src/controllers/checkout.controller.ts:506` (suppressed when the new engagement-tracking toggle is off).

---

## 2026-04-29

### Security
- **Workflow webhook secrets now scale through a GHL custom value.** Merchant provisioning now creates/maps `ScaleSafe Webhook Secret` (`{{ custom_values.scalesafe_webhook_secret }}`) and syncs the per-merchant `merchants.webhook_secret` into that value. GHL Snapshot workflows should use the merge field as the `x-scalesafe-webhook-secret` header value, so new client installs do not require manually pasting a unique secret into each workflow. Secret rotation also syncs the GHL custom value.
- **External webhooks now share merchant-secret observe-mode validation and stable replay keys.** `/webhooks/external` now uses the same `requireMerchantWebhookSecret` middleware as GHL workflow webhooks, so direct external integration posts can be logged/validated in observe mode before enforcement. External webhook idempotency no longer uses `Date.now()`; it now hashes the stable event identity/payload so identical replays produce the same event ID and can be deduplicated.
- **GHL workflow Custom Webhook shared-secret rollout added in observe mode.** Added nullable `merchants.webhook_secret` with a unique index, per-merchant generation/rotation helpers, a backfill script, SSO-protected Settings endpoints, and observe-mode middleware on `/webhooks/ghl/forms`. Existing workflows continue to pass while `REQUIRE_WEBHOOK_SECRET=false`, but missing/invalid/mismatched secrets are logged. When rollout is complete, setting `REQUIRE_WEBHOOK_SECRET=true` will reject unsigned workflow evidence posts.
- **Webhook verification tightened.** Official GHL marketplace webhook routes `/webhooks/ghl/triggers` and `/webhooks/ghl/payment` now verify `X-GHL-Signature` (Ed25519) with fallback to the legacy `X-WH-Signature` RSA header, following HighLevel's current webhook verification guidance. Production rejects missing/invalid signatures unless `ALLOW_UNSIGNED_GHL_WEBHOOKS=true` is deliberately set as an emergency compatibility switch. NMI Silent Post now fails closed for approved transaction posts when transaction verification throws or returns unsuccessful, preventing spoofed posts from advancing recurring payment state.
- **Public client action links now use signed action tokens.** Payment update links generated by `paymentLifecycleService.sendCardUpdateRequest` and Phase 2 payment-failure flows now use a signed `actionToken` instead of raw `contactId` + `locationId` query params. Public payment update, subscription cancellation, and milestone signoff APIs verify the token before exposing config data or accepting card update/cancel/signoff actions. Old raw-query links are accepted only outside production or when `ALLOW_LEGACY_PUBLIC_ACTION_LINKS=true` is deliberately set. Added optional `PUBLIC_ACTION_TOKEN_SECRET` env support with fallback to `GHL_APP_SSO_KEY`.

### Fixed
- **Provisioning Health is visible in Settings.** Settings now shows a Provisioning Health panel that calls `GET /api/merchants/provisioning-health` and reports pass/warn/fail install checks without requiring manual API calls.
- **Fresh-install provisioning health report added.** Added SSO-protected `GET /api/merchants/provisioning-health` to report merchant install health across merchant record status, webhook secret, payment provider registration, processor config, GHL Client Milestones pipeline, ScaleSafe contact fields, and ScaleSafe custom value mapping. This supports the GHL Snapshot beta gate by making fresh sandbox installs easier to verify.
- **Fresh installs now provision `SS Engagement Status`.** Merchant provisioning now creates the `ss_engagement_status` contact field alongside the other ScaleSafe-managed contact fields, matching the current workflow/constant set used by at-risk and re-engagement automations.
- **Top-level build now works cross-platform.** Replaced the Unix-only `mkdir -p` / `cp -r` asset packaging tail in `npm run build` with a Node-based `scripts/copy-build-assets.js`, so Windows `npm.cmd run build` can complete after TypeScript and Vite compilation.
- **Daily account health snapshots now include the required processor discriminator.** Production logs showed the daily health job failing to insert `account_health_snapshots` because `processor` was `NULL` while the database requires `stripe` or `nmi`. Stripe health snapshots now persist `processor: 'stripe'`, and ratio-threshold history lookups are scoped by processor.
- **NMI card-on-file display no longer renders placeholder metadata.** `NmiClient.saveCard()` now falls back to card metadata from the successful NMI vault-add transaction when the follow-up vault query fails, so new NMI test-mode cards can persist last4/brand/expiry instead of `****/unknown/0/0`. Payment Management and Client Profile card displays now hide placeholder values for older records and show a clean "NMI card on file" / "Card on file" label when details are unavailable.
- **Dashboard overview loads without waiting on heavier risk scanning.** The dashboard overview API now uses count-only queries for active offers, active clients, and evidence totals instead of fetching all evidence timeline rows just to count/dedupe. The Vue dashboard now renders overview stat cards as soon as `/api/dashboard/overview` returns and lets `/api/dashboard/at-risk` finish independently, so a slower disengagement scan no longer blocks the main boxes.
- **Payment Management copy-link no longer creates raw public links.** The copy action now asks the authenticated backend to create a signed card-update link and suppresses the GHL trigger side effect with `sendTrigger: false`, so copying a link does not also send a client workflow.

### Documentation
- **GHL beta Snapshot execution plan added.** Added `docs/GHL_BETA_SNAPSHOT_EXECUTION_PLAN.md` as the current beta-gate checklist for what belongs in the GHL Snapshot, what remains app-provisioned, what must not be packaged from V1, and the recommended next code assist for fresh-install verification.
- **External integration docs corrected away from Make.com.** Philip clarified that Make.com is not current architecture and is not a future option. Active repo/Cowork handoffs now treat Make.com references as V1/history only, and `docs/external-integration-guide.md` now describes direct/app-native posts to the ScaleSafe app endpoint with `x-scalesafe-webhook-secret`.
- **Post-beta feature and strategy docket added to Cowork feature ledger.** Added future roadmap items for multiple Stripe/NMI accounts per merchant, offer-level multi-MID routing, compliant surcharging/dual pricing, financing/BNPL, standalone non-GHL direction, and mobile/PWA direction. Added strategy-session topics for product positioning, ICP pain, marketplace strategy, fast iteration path, standalone path, mobile path, and defense-output review.
- **Tracking source-of-truth reconciled.** Cowork `docs/FEATURE_LEDGER.md` is now the product/status source of truth, repo `docs/CLAUDE_CODE_CODEX_LOG.md` remains the technical change log, and `CLAUDE_COWORK_CODEX_LOG.md` remains Cowork's plain-English awareness log. Session prompts now tell agents not to create new roadmap/status tracker systems unless Philip explicitly asks.

### Security
- **Legacy enrollment prep/offer endpoints now SSO-gated.** `src/routes/enrollment.routes.ts` had comments marking `/prep` and `/offer/:id` as SSO-gated, but the handlers were mounted without `ssoAuth`/`requireTenant`. Added both middlewares to those legacy merchant-facing endpoints. Public funnel endpoints remain public: `/device-capture`, `/offer/:offerId/public`, `/consent`, `/consent-lookup/:consentToken`, and the public enrollment page.
- **Dispute/EFW route compatibility hotfix.** The new tenant guard added in `f45c092` correctly required authenticated tenant ownership but only accepted the internal merchant UUID in the URL. Existing Vue screens call dispute routes with the GHL `locationId`. `src/routes/dispute.routes.ts` and `src/routes/efw.routes.ts` now accept either the authenticated tenant's merchant UUID or `location_id`, then normalize all queries/service calls to the verified merchant UUID. This preserves the security fix without breaking existing UI route calls.
- **`/api/debug/*` routes gated by admin token.** `src/routes/health.routes.ts` now mounts a `requireDebugToken` middleware on `/api/debug` that requires `DEBUG_ADMIN_TOKEN` (or `ADMIN_DEBUG_TOKEN`) to be set in env AND supplied via `x-admin-debug-token` header or `Authorization: Bearer …`. Returns `404` when no token is configured (debug surface fully hidden) and `401` on a wrong token. Documented in `.env.example`. Codex hardening.
- **`x-location-id` no longer accepted as auth in production.** `src/middleware/ssoAuth.ts` only honors the `x-location-id` header when `NODE_ENV !== 'production'` AND `ALLOW_DEV_LOCATION_AUTH=true`. Production paths must use the encrypted `x-sso-payload` from the GHL postMessage handshake. The Vue frontend's `authHeaders()` in `src/ui/src/composables/useApi.ts` and the logo upload path in `src/ui/src/views/SettingsView.vue` were both stripped of their `x-location-id` fallback — they now send only `x-sso-payload`. Tests opt into the dev shortcut via `ALLOW_DEV_LOCATION_AUTH=true` in `tests/setup-env.ts`. Codex hardening.
- **Dispute routes — SSO + tenant verification.** `src/routes/dispute.routes.ts` now mounts `ssoAuth` + `requireTenant` and every handler calls `requireMatchingMerchant` to look up the merchant by `tenantContext.locationId` and verify the URL `:merchantId` matches. Mismatch returns `403 Tenant mismatch` (logged with both IDs). Closes a pre-Codex IDOR where any caller could pass any merchantId in the URL and read/submit/accept that merchant's disputes.
- **EFW routes — same SSO + tenant verification pattern.** `src/routes/efw.routes.ts` mirrors the dispute lockdown. Closes the same IDOR class on `/api/efws/:merchantId` (list) and `/api/efws/:merchantId/:efwId/respond`.
- **Dashboard `totalValueSaved` cross-tenant aggregation closed.** `src/controllers/dashboard.controller.ts:45` (the `overview` handler) was selecting from `defense_outcomes` filtered only by `outcome='won'` with no tenant scope, so every merchant's overview saw the platform-wide total recovered. Added `.eq('location_id', locationId)`. The other `totalValueSaved` site at line 295 (`defenseHistory`) is already transitively scoped via `packetIds` derived from a tenant-filtered `defense_packets` query, so no change there.

### Fixed
- **Full Jest suite test drift cleared.** Updated stale unit/integration expectations for current V2 behavior: location-level T&C custom values were removed in favor of per-offer terms, defense prompt tests now use the exhibit-list contract, checkout config tests mock the shared `resolveProcessor` path, send-link trigger payload assertions use snake_case workflow fields, and enrollment integration mocks background GHL/PDF/chain work while awaiting async trigger dispatch. `npm.cmd test -- --runInBand` now passes 45/45 suites and 506/506 tests.
- **Constants tests aligned with current V2 triggers and SS fields.** Updated trigger key and GHL field unit tests to reflect the current 20 valid trigger keys and 6 managed SS contact fields, including `ss_engagement_status`.
- **Dashboard value recovered now uses the real defense outcome column.** `defense_outcomes` stores recovered value as `amount_recovered`, but dashboard reads and the defense outcome repository still referenced `amount_saved`. Updated dashboard overview/history totals and outcome inserts to use `amount_recovered`, included the required `location_id` when recording defense outcomes, and changed dashboard/defense UI labels from "saved" to "recovered".
- **Evidence integration test drift.** `tests/integration/evidence.routes.integration.test.ts` expected the legacy `evidenceRepository.getTimeline(locationId, contactId)` 2-arg signature returning a raw array, but the repository changed to `(locationId, contactId, opts) → { rows, total }` (CHANGELOG 2026-03-27). The test now mocks the `{ rows, total }` shape and asserts the 3-arg call with the route's normalized opts (`limit: 100, offset: 0, type/from/to: undefined` for an unfiltered request). Drift was pre-existing; surfaced after Codex's auth-bypass closure made the assertion line reachable.
- **Stripe Connect — popup OAuth flow keeps the SPA inside the GHL iframe.** Clicking "Connect with Stripe" was navigating `window.top` away from GHL to `/auth/stripe/connect` (the only way to escape the iframe so Stripe's OAuth page — which sets `X-Frame-Options: DENY` — would load), and the callback then `res.redirect`'d to `/?stripe_connected=true` at the top level. The SPA reloaded outside the iframe, `window.self === window.top` was true, the `useApi.ts` SSO init hit the dev-fallback branch, found no `location_id` URL param, and showed the misleading "Unable to Connect — Not running inside GHL iframe" page. The merchant was stranded outside GHL with no way back; on a Stripe-side failure (e.g. PMG today: "This account was previously disconnected as a v2 account and cannot be reconnected to any platform.") they couldn't even see the actual error reason. Replaced with a popup OAuth flow: `connectStripe()` in `src/ui/src/views/SettingsPayments.vue` and `src/ui/src/views/SettingsView.vue` now uses `window.open(...)` to launch OAuth in a popup window while the SPA stays in the GHL iframe with SSO intact, then listens for a `stripe_connect_result` `postMessage`. `src/routes/stripe-connect.routes.ts` GET `/callback` now always renders an HTML page that posts the result (`{ type, success, error }`) back to `window.opener` and self-closes — replacing all four `res.redirect('/?stripe_…')` exit paths (denied, token-exchange-failed, merchant-not-found, save-failed, success). Removed the corresponding URL-param-based result handlers in both Vue views' `onMounted` (now unreachable). The popup flow surfaces the real Stripe error inside the SPA on failure, confirms success without reloading, and works for every merchant on every install going forward.

---

## 2026-04-28

### Fixed
- **Stripe Connect routes — read `locationId` from `req.tenantContext` (set by `ssoAuth` middleware), not `req.locationId` (never set).** `src/routes/stripe-connect.routes.ts` POST `/api/stripe/disconnect` (L118), GET `/api/stripe/risk-audit` (L171), and POST `/api/stripe/risk-audit` (L193) all read from `(req as any).locationId`, but the `ssoAuth` middleware writes the resolved location to `req.tenantContext.locationId`. The fallback chain therefore always failed and threw `ValidationError('Missing locationId')` even when the SSO `x-location-id` header was correctly sent. User-visible symptom: clicking "Disconnect" on the Stripe card in Settings → Payments returned "Missing locationId". All three routes now read from `req.tenantContext?.locationId`, matching the rest of the codebase's tenant-scoped routes.
- **Recurring payment handler — surface `payment_events` insert errors instead of swallowing them.** `handleRecurringPaymentSuccess` and `handleRecurringPaymentFailure` in `src/services/recurring-payment.service.ts` were destructuring only `data` from the Supabase insert response. When the insert failed (notably on `enrollments.merchant_id IS NULL` rows hitting the `payment_events.merchant_id NOT NULL` constraint), the error was silently dropped and the function continued — `payments_made` advanced, `status='completed'` flipped on final installment, but no ledger row was written. Symptom in PMG: lucky@leppy.com and benny@blackstone.com showed `status='completed', payments_made=2` while only the original checkout `payment_events` row existed. Both functions now also destructure `error`, log a structured error if the insert failed, and continue (so enrollment state still reflects the processor's truth — the upstream charge did succeed). Companion fixes for the underlying `merchant_id` data integrity issue (Group C) and the cycle-invoice double-billing pattern (Group B) follow in separate commits.
- **Stripe SDK signature — `paymentMethods.retrieve` was being called with the wrong arity, dropping the connected-account scope.** `src/clients/stripe.client.ts` was calling `paymentMethods.retrieve(token, this.acct)` (two args) at lines 91 and 153. The Stripe Node SDK signature is `retrieve(id, params, options)`. With two args, `{ stripeAccount: '...' }` was placed in the `params` slot instead of `options` — Stripe API rejected with `"Received unknown parameter: stripeAccount"`, the catch block fired, and the fallback path lost card metadata. Compounding it, the catch block at lines 99–101 set `vaultedCardLastFour='****'` and `vaultedCardBrand='unknown'` but forgot to set `vaultedCardExpMonth` / `vaultedCardExpYear` — they remained `undefined` and downstream `|| 0` defaults wrote `card_exp_month=0, card_exp_year=0` to `payment_methods`. Both call sites now use the explicit 3-arg form `retrieve(id, undefined, this.acct)`, and the catch block now zeroes the exp fields explicitly. PMG symptom: `payment_methods` rows showing `**** / unknown / 0 / 0` for affected Stripe enrollments.
- **NMI subscriptions — set `redirect_url` on `add_subscription` so per-subscription Silent Post fires.** `src/clients/nmi.client.ts` `createSubscription` was relying on the gateway-level Silent Post URL configured in the NMI portal to deliver recurring-charge notifications. NMI's gateway-level Silent Post covers direct transactions only — it does NOT dispatch for transactions generated by the recurring engine. Confirmed against the PMG NMI portal: melly@yelly.com and bob@ross.com were both shown as "Completed" after 1 payment (matching `plan_payments=1` for a 2-pay offer where the upfront $0.50 went via `processor.charge()`), with valid recurring transactions (TX 11979026737, TX 11983051245), but our `/webhooks/nmi/silent-post` endpoint received zero inbound traffic. `add_subscription` now passes `redirect_url=${appUrl}/webhooks/nmi/silent-post`, matching how the gateway-level Silent Post posts direct charges. Existing subscriptions created before this fix will not get retroactive notifications — those rely on the daily recurring-billing cron as fallback.
- **`enrollments.merchant_id` propagation — backfill at completion + warning at consent capture.** `src/services/consent.service.ts` writes `merchant_id: merchant?.id || null` when `merchantRepository.findByLocationId` returns null (e.g., merchant not yet provisioned, transient lookup failure). `phase2Enrollment.completeEnrollment` then never backfilled it, so the row stayed at `merchant_id=null`. Downstream, `recurring-payment.service.ts` and other writers pass `merchant_id` forward into `payment_events`, which has a `NOT NULL` constraint on `merchant_id` (Postgres error 23502). The insert silently failed and (per Group D) the function continued with a corrupt enrollment update. Fix: (1) consent.service.ts now logs a structured warning when the merchant lookup is null at consent time (visibility); (2) phase2Enrollment.completeEnrollment now re-runs `merchantRepository.findByLocationId` and includes `merchant_id` in the `updateStatus` payload when the enrollment row currently has null. By completion time the merchant must exist (the upstream charge succeeded → ProcessorFactory found the merchant config), so the backfill is reliable. Production rows that still have `merchant_id=null` are corrected via the backfill SQL noted alongside this commit.
- **NMI card metadata — `queryVaultCard` now surfaces empty/failed responses so the charge transact-response fallback can populate card display fields.** `src/clients/nmi.client.ts` `queryVaultCard` previously caught its own exceptions internally and returned `{ lastFour: '****', brand: 'unknown', expMonth: 0, expYear: 0 }` whenever the Query API failed or returned zero records. That fallback masked the failure from `charge()`, which has a downstream catch block at lines 82–101 designed to extract `cc_number` / `cc_type` / `cc_exp` directly from the transact.php vault-add response — but the catch never fired because `queryVaultCard` never threw. `queryVaultCard` now throws a `ProcessorError(VAULT_EMPTY)` when the parser returns zero records or the inner postQuery throws. `charge()`'s existing fallback path then activates and uses the masked card number / brand / expiry that NMI returns on the transact response itself. `saveCard` (which has no transact-response fallback to chain to) catches the error and returns placeholder card metadata while still succeeding, so the vault add itself is not blocked. Live diagnostic on PMG (2026-04-28): the configured NMI security_key for location `274dtgl30b7x2HG8hn69` returned empty `<nm_response></nm_response>` for every Query API variant tried (single vault, full vault report, transaction lookup, date-range), suggesting the stored key has no Query API permission scope on this account — meaning `queryVaultCard` would fail for every NMI enrollment until that's resolved at the NMI portal level. The fix here ensures the symptom is hidden going forward by populating card metadata from the transact response instead.
- **Stripe subscriptions — defer first cycle to `startDate` via `billing_cycle_anchor` + `proration_behavior='none'` to stop double-billing on enrollment day.** `src/clients/stripe.client.ts` `createSubscription` was calling `subscriptions.create` without `billing_cycle_anchor`. Stripe's default is `billing_cycle_anchor=now`, which fires a full-amount `subscription_create` invoice on day 1 — and that invoice runs *in addition to* the upfront `processor.charge()` ScaleSafe already runs at checkout. PMG symptom: lucky@leppy.com and benny@blackstone.com were each charged $0.50 upfront via `processor.charge()` plus $0.50 again via Stripe's auto-bill on April 17, totalling $1.00 charged on enrollment day for a $0.50/2-pay offer. `createSubscription` now sets `billing_cycle_anchor = startDate` (the offer's `next_billing_date`, one interval after enrollment) and `proration_behavior='none'`. Stripe still creates a `subscription_create` invoice at subscription creation, but it is $0 because there is no prorated period to bill, and the existing webhook handler's `billing_reason !== 'subscription_cycle'` gate already filters it out. The first real billing fires at `startDate` via a `subscription_cycle` invoice. `cancel_at` math is unchanged: `startDate + (totalPayments * intervalSeconds)` still yields exactly `totalPayments` cycles starting at `startDate`. **Verification deferred** until Stripe environment is confirmed in test mode — code change is in place but the new flow is not yet exercised against a live processor.

---

## 2026-04-27

### Fixed
- **Per-page polish — Round 2 Phase 5.**
  - **OfferFormView duplicate save buttons removed.** The form had both an inline `Save / Cancel` row at the bottom and the `StickySaveBar` introduced in Phase 4 brand close-out. The inline pair was redundant — sticky bar is always visible and handles both actions. Single source of save now.
  - **OfferFormView milestones — progressive disclosure.** Was rendering all 8 milestone rows × 3 inputs = 24 fields, most empty, in front of the merchant. Now starts with 1 row; an `+ Add milestone` button reveals the next blank row only after the current one has a name. On edit, opens with `lastFilledMilestone + 1` rows visible. Caps at 8.
  - **ProgramsTab pluralization + frequency abbreviation.** Was rendering `1 weeks` / `1 months` (no singular/plural handling) and `$50/monthly` (showing the raw enum value where the design wanted an abbreviation). Added `formatDuration(value, unit)` for grammatical pluralization (`1 week` / `2 months`) and `shortFrequency(freq)` for abbreviated billing cadence (`mo`, `wk`, `2wk`, `qtr`, `yr`).
  - **CommunicationsTab — branded empty state + primary CTA.** Empty-state rendered as bare single line `<p>No messages or notes...</p>`. Replaced with `<EmptyState>` (icon + title + body + CTA). Made `Send Message` the primary action (`btn-primary`) since it's the dominant intent on this tab; `Add Note` stays secondary. Repointed inline `#374151` body color and `#f1f5f9` divider to brand `--ss-navy-800` / `--ss-navy-100` tokens.

### Changed
- **Tab standardization — Round 2 Phase 4 (`Tabs` component adopted across list views; `ProfileTabs` retoned).** `OffersView` (Active/Archived) and `ClientsView` (Active/Archive/All) now use the brand `Tabs` component in `segmented` variant — single rounded container with selected pill, replacing two different hand-rolled patterns (button-pair with primary/secondary toggle, custom `.status-tabs` underline). `DefenseView` filter chips moved to `pill` variant inside a `flex-between` row that keeps the sort dropdown anchored right. Active tab in `OffersView` now shows count badges via the `Tabs` `count` prop (was inline in label text). Removed the now-orphaned `.status-tabs/.status-tab` CSS from `ClientsView`. Bonus: `ProfileTabs` (used inside `ClientDetailView` + `DefenseDetailView`) had its active-state color hardcoded to pre-brand `#3b82f6` blue — repointed to brand teal tokens (`--ss-teal-500/700`) for visual consistency with `Tabs.vue` underline variant.

### Fixed
- **Vertical rhythm sweep — Round 2 Phase 3 (eliminate doubled card margins).** `.card` already declares `margin-bottom: 16px`, but 24 call sites were stacking an additional `mb-4` on top, producing 32px gaps under those cards while bare `<div class="card">` got 16px. Result: visible inconsistency in any view that mixed both forms (Settings page especially — six stacked cards). Removed the redundant `mb-4` from `<div class="card mb-4">` across 9 files (`StripeRiskHealth`, `SettingsView` ×6, `SettingsPayments`, `PaymentManagement`, `PreventionChecklist`, `client-profile/{Overview,Payments,Evidence,Files}Tab`). Every card now uses the global 16px gap. No intentional 32px gaps were lost — these were all accidental doubles.

### Changed
- **Page header pattern — Round 2 Phase 2 (`SectionHeader` adopted across top-level views).** `OffersView`, `ClientsView`, `DefenseView`, `SettingsView`, `SettingsPayments`, and `StripeRiskHealth` replaced bare `<h1 class="page-title">` rows with the existing `SectionHeader` component (small-caps emerald eyebrow → two-tone `<h2>` Manrope title → optional description, with `actions` slot for the page's primary CTA). Brings these views in line with `DashboardView`, which already used the pattern. No net new chrome — list/index views now look like one app instead of six. Detail/form views (`ClientDetailView`, `DefenseDetailView`, `OfferFormView`) keep their view-specific sticky headers.
- **Layout shell — Round 2 Phase 1 (page-shell wrapper + sticky-header pull-through).** `App.vue` now wraps `<router-view>` in a `.page-shell` container that gives every view a single content gutter — padding `32/32px` desktop, `24/24px` at ≤1024px, `20/16px` at ≤640px. No `max-width` cap: wide screens use the full available width so dashboards/tables/grids breathe instead of getting stranded inside a centered column. `<main>` keeps the scroll container; the page-shell only adds the gutter. Sticky headers that previously pulled through hard-coded `-24/-24` margins (`ClientDetailView .profile-header`, `DefenseDetailView .defense-header`) now use breakpoint-matched negative margins (`-32/-32` → `-24/-24` → `-20/-16`) so they continue to span gutter-to-gutter under the new shell. `FormLayout` aside, `StickySaveBar` (Teleport + fixed), and per-view `max-width` cards (`OfferFormView`, `PaymentSearch`) verified safe under the new shell.

---

## 2026-04-26

### Added
- **Click-Wrap clause acceptance write-through to GHL.** When a client accepts T&C clauses on Page 3 of the enrollment funnel, every accepted standard clause now sets the corresponding `Click-Wrap: <Clause>` CHECKBOX field on the GHL contact. Resolves the architectural-debt note from the cleanup-batch PR — the 9 `ghlFieldId` values in `src/constants/standard-clauses.ts` are no longer registry-only. New `ghlFieldKey` field added to each `STANDARD_CLAUSES` entry (e.g., `contact.clickwrap_purchase_summary`), used as the runtime write target via the existing `customField → customFields` interceptor in `ghl.client.ts`. Write piggybacks on the existing post-enrollment GHL contact update in `phase2Enrollment.service.ts` (no extra API round-trip), runs for both paid and free-offer paths. The CHECKBOX field_value is a single constant (`CLICK_WRAP_CHECKED_VALUE = 'Yes'`) — easily flipped to `['Yes']` or `true` if E2E reveals GHL prefers a different format. New regression test `tests/unit/standard-clauses.test.ts` (8 cases) guards the fieldKey pattern, ID format, and clause→fieldKey mapping.

### Fixed
- **SESSION.md cleanup batch (4 follow-up items from app sweep).**
  1. **Dashboard auto-refresh.** `DashboardView.vue` now auto-refreshes every 60s, pauses while the tab is in the background (via `visibilitychange`), and exposes a manual "Refresh" button in the section-header actions slot. Shows "Updated {relative}" beneath the title; an amber "Data may be stale" pill appears once the cache is older than 2 minutes (e.g., after a long sleep). No backend changes.
  2. **Plurality bug.** New `pluralize(count, unit)` helper in `src/ui/src/utils/humanize.ts` handles 0/1/2+, irregulars (child→children, person→people), and `-y → -ies`. Replaces 4 leak sites: `ProgramsTab.vue` ("1 weeks" → "1 week"), `DefenseDetailView.vue` and `DefenseView.vue` ("1 days remaining" → "1 day remaining"; "Overdue by 1 days" → "Overdue by 1 day"), `DisputeManagement.vue` (now also routes through helper for consistency). 11 new unit tests.
  3. **Toggle label flip.** `SettingsPayments.vue` Dispute Auto-Submit toggle no longer flips between "Auto-submit enabled" and "Manual review mode" (two competing mental models). Now reads "Auto-submit enabled — strong evidence packets are submitted automatically" / "Auto-submit disabled — review every packet before submission", matching the section title.
  4. **Standard clause `ghlFieldId` registry refreshed.** Live audit of PMG GHL via `list_ghl_custom_fields_via_cc` revealed that 7 of the 8 hardcoded IDs in `src/constants/standard-clauses.ts` (`eSINYX4MfsLhEbV0DlrO`, `uoQ47sqkamlkD07X6BL1`, `UYSsDeuKPKksUlxdyr8b`, `LgQjNE7ITUcFVtJJ7K5p`, `56Lqj6agUH8G7CWGWzoc`, `w7VhO2Apb12gm7CO1Lgv`, `8IdyOxOopSSDCK259dQd`) point to deleted fields. A newer `Click-Wrap: <Clause>` CHECKBOX pattern (fieldKey `contact.clickwrap_*`) already exists in PMG for all 9 clauses. All 9 `ghlFieldId` values updated to the live Click-Wrap IDs, including slot 9 (`feedback_checkin` → `7AoLipHuDcpC0PK2S6QN`) which had been blank.

### Notes
- `ghlFieldId` values in `standard-clauses.ts` are still PMG-specific and **not consumed by any service at runtime** (verified via grep across `src/`) — the field is a registry pointer only. Per-merchant clause-acceptance provisioning (adding `Click-Wrap: X` fields to `SS_FIELDS_TO_CREATE` in `merchant.service.ts`, key→ID resolution at enrollment) remains a deferred workstream.
- The legacy `## I Fields` section in `docs/ghl-custom-fields-reference.md` (lines ~376–435) lists the 7 stale IDs and their old "I confirm…" naming. Left in-place for this PR; standalone doc-cleanup pass to remove the stale section is queued separately.

### Changed
- **Phase 4 close-out (long-form sticky save + remaining view rebrands of brand-systematization workstream).** `OfferFormView` and `SettingsView` now mount a `StickySaveBar` (Teleport-to-body fixed-bottom save bar with dirty-state indicator and primary save button) so merchants don't have to scroll back to the bottom to save long forms. Inline blues retoned to brand tokens across `OfferFormView` (radio-card active/hover, accent-color, quick-checkout border-left), `SettingsView` (toggle track + checkbox accent-color), `PaymentsTab` (progress bar), `PaymentManagement` (checkbox accent), `LetterTab` (focus ring), `ExhibitsTab` (exhibit letter badge bg). Slug + reason-code humanization applied to `DefenseDetailView` (lifecycleStatus → "Pending Submission" etc., status humanized, reason code now shows code + adjacent humanized description) and `ClientDetailView` (enrollment status humanized in profile header). AI token counts and model-name debug data hidden from merchant view in `LetterTab` and `HistoryTab` — fields remain in the API response for support diagnostics. `ProgramsTab` and `EvidenceTab` empty states upgraded to `EmptyState` component (branded icon + body + CTA where applicable). Phase 4 complete; remaining drift items (T&C clause default-state, evidence-type dropdown progressive disclosure, the 9 pre-existing functional bugs from SESSION.md sweep) deferred to follow-up tickets.

### Changed
- **Mainline views rebranded (Phase 4a–4f of brand-systematization workstream).** Global utility CSS in `App.vue` repointed to brand tokens — `.btn-primary` blue → emerald (engagement CTA, pill shape), `.nav-active` blue → teal (sidebar active), `.form-input` focus blue → emerald, body bg slate → cream. This single edit propagates brand-correct buttons / badges / cards / tables / form inputs to every view that uses the global utility classes, without per-view template changes. Per-view component swaps where they add specific value: `DashboardView` uses `Stat` for the 4 KPIs (with accent stripes) and `SectionHeader` for two-tone section heads; `OffersView` and `ClientsView` use `EmptyState` (icon + brand-color + encouragement copy + CTA) instead of bare single-line empty messages; `DefenseView` swaps 4 KPIs to `Stat`, applies `humanizeEventType()` to lifecycle status (e.g. `pending_submission` → "Pending Submission"), `humanizeReasonCode()` to chargeback reason codes (e.g. `4855` → "Goods/Services Not Provided"), and `maskTransactionId()` to disputed-transaction IDs in the selector dropdown. `ClientsView` status tabs active state retoned to teal. `SettingsPayments` toggle and Stripe-callout color repointed to emerald.

### Added
- **Brand component primitives (Phase 2 of brand-systematization workstream).** Eight reusable components added under `src/ui/src/components/` so per-view rebuilds in Phase 4 are mechanical replacement work:
  - `Button.vue` — variants `primary` (emerald, in-app engagement) / `funnel` (orange, top-of-funnel only) / `secondary` (emerald outline) / `tertiary` (text) / `destructive` (red ghost). Pill shape, `sm`/`md`/`lg` sizes, loading state with spinner, optional left/right Lucide icons.
  - `Pill.vue` — replaces inline `.badge-*` classes. Tones: emerald, navy, teal, orange, red, amber, gray.
  - `Stat.vue` — single sizing for KPI cards across the app. Optional left-border accent stripe (emerald/navy/teal/orange) and trend delta with up/down/flat arrows.
  - `Tabs.vue` — generalizes `ProfileTabs.vue`. Variants: `underline` (default, teal active), `pill`, `segmented`. Optional count badge per tab.
  - `EmptyState.vue` — branded icon-in-circle + Manrope title + body + CTA slot. Replaces bare single-line empty messages.
  - `SectionHeader.vue` — implements brand pattern: small-caps emerald eyebrow → two-tone (navy + emerald) `<h2>` → optional description, with `actions` slot.
  - `StickySaveBar.vue` — Teleport-to-body fixed bottom save bar with dirty-state pulse dot. Pairs with long forms (Edit Offer, Settings).
  - `FormLayout.vue` — two-column form-left + `aside` slot right; collapses to single column under 1024px. Reclaims the unused viewport right of forms.
- **`humanize.ts` utility (Phase 3).** New `src/ui/src/utils/humanize.ts` exports `humanizeEventType()` (curated slug→label map for 28 event types, title-case fallback for the rest), `formatTimestamp()` (relative / absolute / short modes), `humanizeReasonCode()` (Visa / Mastercard / Amex chargeback codes including `4855 → Goods/Services Not Provided`), and `maskTransactionId()` (first-4 + ellipsis + last-4). 26 unit tests in `tests/unit/humanize.test.ts`. No view files touched in this phase.

### Changed
- **Brand token foundation (Phase 1 of brand-systematization workstream).** `ss-primary` Tailwind palette repointed from blue (`#3b82f6` family) to emerald (`#10b981` family) — every existing `bg-ss-primary-*` / `text-ss-primary-*` usage now resolves to brand-correct emerald. New sibling palettes added: `ss-funnel` (orange, top-of-funnel CTAs only — enrollment funnel, customer checkout), `ss-navy` (slate-900 ramp for structural surfaces), `ss-teal` (secondary accent), `ss-cream` (page background). Manrope display font loaded alongside Inter; `h1`–`h4` use Manrope, body uses Inter, page bg is `--ss-cream-50` (`#fafaf7`). CSS custom properties added in `src/ui/src/style.css` as parallel source for raw-CSS use inside `<style>` blocks. Semantic risk colors (`ss-safe`/`-moderate`/`-elevated`/`-high`/`-critical`) preserved. Phase 4 (per-view application), Phase 5 (sidebar repaint), Phase 6 (regression sweep) follow.

### Fixed
- **Feedback & Check-In T&C clause body text.** Slot 9 (`feedback_checkin`) was rendering Slot 5's "Digital Access" body text — copy-paste error in `src/constants/standard-clauses.ts` and the duplicated `standardClauses` array in `src/ui/src/views/OfferFormView.vue`. Slot 9 now reads "I understand that periodic check-ins, surveys, or progress reviews may be requested during the program to monitor my satisfaction and progress. I agree to respond to these check-ins in good faith and understand that the merchant may reference my responses as part of the program record." Pre-production — no `compiled_tc_html` backfill; existing test offers will pick up the new text on next save.

---

## 2026-04-18

### Changed
- **Domain cutover to dashboard.scalesafe.app.** Removed 2 hardcoded `scalesafe-production.up.railway.app` fallbacks from `payment-lifecycle.service.ts` and `phase2Enrollment.service.ts`. All URL generation now uses `APP_URL` env var via `config.appUrl`. Set `APP_URL=https://dashboard.scalesafe.app` in Railway.

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
