# FanBasis Integration Build Plan v1.0

**Date:** 2026-06-10
**Author:** Cowork (research) — implementation plan to be produced by Claude Code in plan mode
**Status:** APPROVED FOR BUILD (2026-06-15) — Philip's Section 8 decisions recorded. Next step: Claude Code plan-mode pass (validation Section 9 + Whop Model B verification) before implementation.

---

## 1. Current State

- **ScaleSafe is the processor** via GHL Custom Payment Provider. ProcessorInterface routes to NmiClient or StripeClient. Per-offer processor override exists (postMessage-based config-by-product endpoint).
- **Whop precedent (decided 2026-05-08):** Whop is a Merchant of Record (MoR), NOT a peer processor, so it was architected as **Model B** — an embedded checkout option separate from ProcessorInterface. Per-offer `checkout_type` field (`direct` / `whop`), embedded checkout component on funnel Page 4 and Quick Checkout, per-merchant Whop credentials, webhook handler at `/webhooks/whop` with metadata matching, no basis-points markup (ScaleSafe not in the money flow).
  - ⚠️ **Verify before building:** Whop has no FEATURE_LEDGER row. Philip reports it as integrated; confirm actual deployed state with Claude Code/Codex before reusing its components.
- **BNPL rails roadmap** (Klarna T1, Denefits T2, Elavon Avvance T3) is DEFERRED until after beta. FanBasis's 7+-provider BNPL suite could substitute for much of this roadmap through one integration.
- **Defense:** Native evidence engine + defense packets work for all merchants. NMI path = manual submission; Stripe path = automated API submission.
- **Monetization direction (2026-05-08):** lead with platform subscription; don't push MoR per-transaction monetization. Three-tier suggestion: Starter (1 processor) / Pro (all processors + MoR checkouts) / optional Stripe bps markup.

## 2. Target State

From the merchant's perspective:

1. Merchant creates an offer in ScaleSafe exactly as today. Nothing about the offer lives in FanBasis.
2. In Settings, merchant pastes their FanBasis API key once (same UX as the NMI key). If they don't have a FanBasis account, ScaleSafe shows a referral signup link (revenue to ScaleSafe — see Section 4, Decision D4).
3. On the offer form, merchant toggles FanBasis on as a payment option (alongside or instead of NMI/Stripe — pending Decision D1).
4. At checkout, the client either pays by card through the merchant's existing rail (NMI/Stripe) or chooses a FanBasis-powered method (cards, Apple Pay, Google Pay, Cash App, BNPL where enabled on the merchant's FanBasis account).
5. FanBasis fires `payment.succeeded` to ScaleSafe's webhook endpoint with ScaleSafe's `metadata` echoed back (enrollment ID, offer ID, location ID). Enrollment completes, evidence logs, triggers fire — identical downstream lifecycle to NMI/Stripe payments.
6. Disputes on FanBasis transactions arrive via `dispute.created` webhooks, create dispute_events, and feed the existing Defense module. Evidence submission is manual through the FanBasis Resolution Center (same posture as the NMI path).

Pitch this enables: "Keep your Stripe. Keep your NMI. Keep your FanBasis. Attach whichever provider you want to each offer — one platform connects to every payment processor you have."

## 3. Verified API Research (from https://apidocs.fan, fetched 2026-06-10)

All facts below were read from the live FanBasis API reference — not guessed.

**Identity:** FanBasis is the **Merchant of Record** on every transaction. Handles processing, compliance, card-network relationships, OFAC screening. Card network programs (Visa VAMP) evaluate FanBasis at platform level, shielding individual sellers.

**Auth:** `x-api-key` header. All endpoints under `https://www.fanbasis.com/public-api/` (exception: Subscription Proration API at `/api/seller/v1/`). Sandbox at `https://qa.dev-fan-basis.com` with test API key and test card numbers; Embedded Checkout SDK environment string is `'sandbox'`.

**Checkout — two styles:**

| | Hosted payment link | Embedded checkout |
|---|---|---|
| Endpoint | `POST /public-api/checkout-sessions` | `POST /public-api/checkout-sessions/embedded` |
| FanBasis product needed? | **No — product title + price inline** | **Yes — requires `product_id`** |
| Returns | `payment_link` | `checkout_session_secret` (reusable across products) |
| Render | Redirect/link | iframe: `https://embedded.fanbasis.io/session/{handle}/{product-id}/{secret}` |
| Payment method control | Account-level settings | `metadata.allowed_payment_methods` per-session allow-list (e.g. `["card","cashapp"]`) |

**Hosted session body params (verified):** `product.title` (req), `product.description`, `amount_cents` (req), `type` (req: `subscription` / `onetime_reusable` / `onetime_non_reusable`), `application_fee` (optional platform/affiliate fee), `metadata` (echoed in webhooks), `expiration_date`, `success_url`, `webhook_url` (per-session override), `subscription.frequency_days`, `subscription.auto_expire_after_x_periods`, `subscription.free_trial_days`, `subscription.initial_fee`, `subscription.initial_fee_days`.

**Offer-type mapping:**

| ScaleSafe offer type | FanBasis session |
|---|---|
| PIF (enrollment link, single buyer) | `onetime_non_reusable` |
| Installments | `subscription` + `frequency_days` (30/90/365) + `auto_expire_after_x_periods` = installment count |
| Subscription (ongoing) | `subscription`, no expiry |
| Deposit + recurring | `subscription.initial_fee` + `initial_fee_days` |

**Webhooks (signature-validated):** `payment.succeeded`, `payment.failed`, `subscription.created/renewed/canceled`, `dispute.created/updated` (envelope format with `due_by` deadline, `dispute_fee` ~$15, processor `dispute_id`), `refund.*`. Metadata from the session is echoed back — enrollment correlation rides in metadata, mirroring the Whop Model B metadata-matching design.

**Disputes:** flow into FanBasis Resolution Center. RDR/Ethoca auto-resolution for eligible low-value disputes. **No API for evidence submission — dashboard only.** ScaleSafe defense packets = compile-for-manual-submission (NMI posture).

**Payment methods:** cards, Apple Pay, Google Pay, Cash App Pay confirmed in docs; BNPL suite ("7+ providers") marketed at enterprise level — **provider list, eligibility, amount limits, and whether BNPL appears for a given seller account are NOT documented in the public API reference. Must be confirmed with FanBasis directly before promising BNPL.** (Docs note allow-lists are "intersected with the creator's account-level settings, amount limits, service-type rules".)

**Pricing:** not published; sales-led. Reviews suggest ~4% standard, ~8% financed transactions. Confirm on discovery call.

**Restrictions (Merchant Acceptance Policy):** digital content/subscriptions/coaching allowed; crypto/forex/investment products excluded; account holds possible for high dispute/refund rates. ScaleSafe merchants must individually pass FanBasis acceptance.

## 4. Architecture Decisions (proposed — Philip approves)

**D1 — FanBasis follows the Whop Model B pattern, not ProcessorInterface.**
Reason: FanBasis is MoR (like Whop), not a gateway rail (like NMI/Stripe). ScaleSafe never touches the card; FanBasis owns vault, payout, and dispute filing. Extending the existing `checkout_type` concept (`direct` / `whop` / `fanbasis`) reuses a designed pattern.
Risk if wrong: forcing it into ProcessorInterface would imply capabilities (charge saved card, pause/resume via our cron, refund via our UI) that need re-mapping to FanBasis's own subscription/refund APIs anyway. Note: FanBasis DOES have cancel-subscription, refund-transaction, extend-subscription, and charge-customer endpoints — richer than a pure link generator — so some lifecycle controls CAN be wired in a later phase.

**D2 — "Just a payment": offers stay 100% in ScaleSafe.**
Phase 1 uses **hosted payment-link sessions** created on the fly from the ScaleSafe offer (title + amount_cents + type) at checkout time. No FanBasis product, no FanBasis dashboard interaction by the merchant.
Phase 2 (optional, for seamless iframe UX on funnel Page 4): embedded checkout requires a FanBasis `product_id` — ScaleSafe auto-creates/syncs a FanBasis product via API when the merchant toggles FanBasis on the offer (invisible, same pattern as GHL Product auto-creation today). Claude Code to verify the products endpoint capabilities during plan mode.

**2026-06-18 caveat — product sync must be proven before build.**
Public FanBasis docs clearly show embedded checkout requires `creator_id` + `product_id`, but product creation may be dashboard-only. Do **not** assume ScaleSafe can create FanBasis products by API. During plan mode, verify whether a documented create/update product endpoint exists. If it does not, the beta fallback is **not** merchant-pasted product IDs. The fallback is hosted payment-link checkout created from the ScaleSafe offer at checkout time, passing product title + price inline and using FanBasis's returned `payment_link`. This preserves the evidence chain because Pages 1-3 still capture and freeze consent before Page 4 redirects to FanBasis, but it is less polished than embedded iframe UX.

**D3 — Mixed payment options at one checkout (answers "NMI card + FanBasis BNPL?").**
Technically feasible: ScaleSafe owns the checkout page, so Page 4 can render the merchant's direct rail (NMI/Stripe card fields) AND a "More payment options" / "Buy Now, Pay Later" button that opens the FanBasis session. `metadata.allowed_payment_methods` can restrict a FanBasis session to specific methods, so a session could exclude plain cards to avoid double-offering card payments (exact BNPL method strings must be confirmed with FanBasis — not in public docs).
Consequence to accept: one offer's payments then split across two money flows (NMI payout to merchant account vs FanBasis MoR payout), two dispute paths, and two refund paths. Reconciliation report and payment ledger already display per-processor context, but enrollment records must carry per-transaction rail attribution.
Decision needed: per-offer either/or (simpler, matches Whop design) vs. both-at-checkout (stronger pitch, more surface area). Recommend either/or for Phase 1, both-at-checkout as Phase 3.

**D4 — Referral revenue.**
- FanBasis has a lifetime referral program (documented publicly: referrer earns a share of FanBasis's commission on referred-creator sales, for life; their Medium post cites 20% of FanBasis's commission). Current MoR-era terms must be confirmed on the discovery call — public material may reflect the older creator-platform model.
- Whop has a creator referral program: 30% of Whop's revenue from referred creators, for life.
- So yes: a "Don't have FanBasis/Whop? Sign up here" referral link in Settings can produce passive revenue with zero payment-flow involvement.
- **Bigger lever:** the hosted checkout session API has an `application_fee` parameter ("optional platform/affiliate fee") — ScaleSafe could take a direct per-transaction platform fee on FanBasis volume. This conflicts with the 2026-05-08 monetization direction (lead with subscription, don't push MoR monetization) — Philip decides whether to use it, at what rate, and whether it's disclosed in merchant pricing tiers.

**D5 — Defense posture for FanBasis transactions: NMI-style manual submission.**
`dispute.created` webhook → dispute_event → Defense module compiles packet → merchant submits through FanBasis Resolution Center before `due_by`. No automated submission (no API exists). RDR/Ethoca on FanBasis's side will auto-resolve some disputes before they ever reach ScaleSafe — defense dashboard copy should explain this.

## 5. Platform Decision Matrix

| Component | Platform | Reason | Risk if wrong |
|---|---|---|---|
| FanBasis API key storage + validation | App (Settings, merchants table) | Mirrors NMI key flow; per-merchant credential | Low |
| Offer toggle (`checkout_type` extension) | App (offer form + offers_mirror) | Per-offer, not per-merchant (Rule 4) | Low |
| Session creation at checkout | App (new fanbasis client/service) | External API call, error handling, metadata injection | Low |
| Checkout rendering (link/iframe) | App (checkout page) | We own the iframe; consent-before-payment sequence preserved | Medium — embedded style needs product sync (D2 Phase 2) |
| Webhook receiver `/webhooks/fanbasis` | App | Signature validation, enrollment completion, evidence logging | Medium — payload contract is documented; build to doc (contract is binding) |
| Dispute intake → Defense module | App | Reuses dispute_events + defense compile | Low |
| Lifecycle controls (cancel/refund/extend via FanBasis API) | App, later phase | Endpoints exist; map to existing lifecycle UI | Medium |
| Notification workflows on FanBasis payments | GHL (existing workflows) | Existing ss_payment_received etc. fire from app — no new GHL components expected | Low |
| Referral signup link | App (Settings UI) + FanBasis referral program | Static link, zero payment-flow involvement | Low |

No new GHL custom fields/values/triggers anticipated — existing trigger payloads already carry `processor`/`source`. Claude Code to confirm in plan mode.

## 6. Build Order

1. **Phase F1 — Foundation:** per-merchant FanBasis credentials (Settings), sandbox connectivity test, `checkout_type` extension on offers, DB columns for rail attribution on enrollments/payment_events. Confirm Whop Model B deployed state first and reuse its scaffolding.
2. **Phase F2 — Checkout path:** preferred path is embedded checkout if ScaleSafe can create/sync or otherwise programmatically resolve a FanBasis `product_id`; create embedded session (`checkout_session_secret`) from offer (all 3 offer types + metadata correlation); render iframe on funnel Page 4 + Quick Checkout (client stays in funnel, consent forensics complete before payment); webhook receiver with signature validation; enrollment completion + evidence + triggers. **Riskiest assumptions live here — test in sandbox first. First confirm FanBasis products endpoint supports auto-sync. If no documented product create/update API exists, implement hosted payment-link fallback using inline product title + price, not merchant-pasted product IDs.**
3. **Phase F3 — Disputes + refunds:** dispute.created/updated → dispute_events → Defense module; refund webhook → evidence + ledger; Resolution Center submission instructions in Defense UI.
4. **Phase F4 — (folded into F2)** Embedded checkout moved into beta scope per Philip 2026-06-15. Phase number retained for traceability; no separate work remains here.
5. **Phase F5 — Mixed-rail checkout (Decision D3, if approved):** direct rail + FanBasis BNPL button on one checkout.
6. **Phase F6 — Lifecycle + reporting:** cancel/extend/refund via FanBasis API from existing UI; ledger/reconciliation rail attribution polish; referral link in Settings.

## 7. Risk Register

| Risk | Blast radius | Fix-forward |
|---|---|---|
| BNPL availability per seller account is undocumented; may require FanBasis enterprise tier or per-account enablement | The headline BNPL pitch | Confirm on discovery call BEFORE building F5; F1–F3 are valuable regardless (cards/Apple Pay/Cash App + referral) |
| Merchant fails FanBasis Merchant Acceptance / account hold for dispute rate | That merchant's FanBasis rail goes dark mid-program | Detect API errors, surface account-status banner, offer stays payable on direct rail |
| Webhook delivery gaps (same class of bug as NMI Silent Post recurring gap, ledger row 87) | Silent unrecorded payments | Reconciliation report already exists; add FanBasis transactions endpoint polling as safety net (transactions API exists) |
| `payment_link` style leaves ScaleSafe's controlled checkout (redirect) | Consent forensics sequence must complete BEFORE redirect | Funnel order unchanged: Pages 1–3 consent capture, then Page 4 = FanBasis link/iframe; verify packet freezes before redirect |
| Fees (~4%/~8%) surprise merchants vs interchange-plus on NMI | Merchant trust | Show fee disclosure copy on the offer toggle; confirm real pricing first |
| Pending in-flight payment-truth work (ledger rows 87, reconciliation) collides with new rail | Payment reporting confusion | Sequence F1 after current payment-truth phases close, or have Codex/Claude Code confirm no conflict |
| Whop Model B actual deployed state unverified (no ledger row) | Reuse assumptions in F1 | First step of plan mode: Claude Code reports what Whop components actually exist |

## 8. Decisions — RESOLVED 2026-06-15 (Philip)

1. **D3 — RESOLVED: Per-offer either/or in Phase 1.** Each offer uses one rail (direct NMI/Stripe OR FanBasis). Mixed card+BNPL-on-one-checkout deferred to Phase F5.
2. **D4 — RESOLVED: Referral links only.** No `application_fee` per-transaction skim. Stays consistent with subscription-led monetization (2026-05-08). Referral signup link in Settings only.
3. **F4 embedded iframe — RESOLVED: preferred beta path, with hosted-link fallback.** Embedded checkout (iframe on funnel Page 4, client never leaves the consent-captured funnel) is the preferred beta experience. **Scope consequence:** embedded requires a FanBasis `product_id`. ScaleSafe should auto-create/sync a FanBasis product per offer only if FanBasis exposes a documented product create/update API. Claude Code must verify this during plan mode. If the API does not exist, the beta implementation should fall back to FanBasis hosted payment links created inline from the ScaleSafe offer, not merchant-entered product IDs. Hosted links redirect off the funnel on Page 4, but consent forensics remain valid because Pages 1-3 already captured and froze the packet before payment.
4. **Call timing — RESOLVED: Build now in parallel.** Start F1/F2 sandbox work immediately; book the FanBasis discovery call in parallel. The call only affects pricing, BNPL enablement, and referral/partner terms — none block sandbox build.

## 9. Validation Questions (for Claude Code plan mode / LLM review)

1. **Architecture:** Whop is Model B (separate from ProcessorInterface). FanBasis is also MoR. Is extending Model B to a generic "MoR checkout provider" abstraction right, or premature with n=2?
2. **Data flow:** Session created at checkout-time with metadata {enrollment_id, offer_id, location_id} → webhook echoes metadata → completeEnrollment. Race conditions vs the funnel `/complete` redirect? What happens if webhook arrives before redirect, or never arrives?
3. **Contract:** Webhook payloads are documented (envelope format for disputes/refunds, flat for payments). Build exactly to the documented contract — verify signature validation scheme during plan mode.
4. **Installments:** `auto_expire_after_x_periods` maps to installment count — but does FanBasis report per-renewal payment numbers sufficient for our installment progress UI (payments_made/payments_total)?
5. **Evidence:** Which of the 21 evidence types apply to FanBasis-rail payments, and does Evidence Type 2 (Enrollment Payment) capture processor_ref correctly from FanBasis transaction IDs?
6. **Monitoring:** How do we know the FanBasis rail is broken — webhook freshness check, transactions polling, both?
7. **Scale:** Per-merchant API keys mean N webhook configurations or one platform endpoint? (Docs show per-session `webhook_url` override — does that remove per-account webhook setup entirely?)
8. **Missing pieces:** What else bites us — currency, taxes (FanBasis collects buyer address but sales tax remains seller responsibility), payout timing visibility for merchants?
9. **Product ID path:** Embedded checkout requires `creator_id` + `product_id`. Does FanBasis expose a documented product create/update API that ScaleSafe can use for auto-sync? If yes, plan the product-sync service and embedded iframe path. If no, plan the beta fallback as hosted payment-link sessions created with inline ScaleSafe offer title + price. Do not build an assumed auto-sync path without a verified API contract, and do not make merchants manually paste product IDs as the fallback.

## 10. Execution Log

- 2026-06-10: Plan drafted from live FanBasis API docs research. Awaiting Philip decisions (Section 8) + validation.
- 2026-06-15: Philip resolved all 4 Section 8 decisions (either/or per offer; referral-only revenue; embedded iframe required for beta; build now in parallel with discovery call). Embedded-for-beta folds former Phase F4 product-sync work into core Phase F2. Status → APPROVED FOR BUILD. Next: Claude Code plan-mode pass (Section 9 validation + Whop Model B deployed-state verification) before writing code.
- 2026-06-18: Moved plan into repo `docs/` for Claude Code. Added product-ID caveat: FanBasis embedded checkout requires `product_id`, but product auto-creation by API must be verified before implementation. If no create/update product API exists, beta fallback is hosted payment-link checkout with inline title + price, not merchant-provided product IDs.
