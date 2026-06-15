# ScaleSafe — Launch Readiness Checklist

> **Purpose.** The go-live gate for ScaleSafe. Nothing ships to general availability until every
> **Blocker** is checked. This is the single source of truth for "are we safe to launch?" — it
> supersedes scattered notes in the CHANGELOG and session handoffs.
>
> **How to use.** Copy the relevant section into the PR/release description and check each box with
> evidence (a link, a command output, a screenshot). A box is only "done" when verified, not when
> "should work." Owner: Philip. Last structural update: 2026-06-15.

Legend: 🔴 **Blocker** (must pass to launch) · 🟡 **Should-fix** (launch with a tracked exception) ·
🟢 **Nice-to-have**

---

## 0. Pre-deploy gate (run on EVERY deploy, not just launch)

ScaleSafe auto-deploys from GitHub `main` to Railway. Because migrations and code deploy
independently, **a code deploy that lands before its migrations will throw on live traffic.**

- [ ] 🔴 **Apply all migrations referenced in the current CHANGELOG `Unreleased` section to Supabase
  BEFORE merging/deploying that code.** As of this writing the Unreleased batch requires
  `072_payment_events_unique_txn`, `073_record_recurring_payment`, `074_enrollment_billing_setup_status`,
  `077_decrement_payments_made`, and `078_dispute_events_whop_processor`. Without them, live recurring
  webhooks, refunds, and dunning retries throw (they call `record_recurring_payment` /
  `decrement_enrollment_payments_made`). **Always re-read the live CHANGELOG Unreleased block — this
  list drifts.** (See `supabase/migrations/` for the latest: 079/080 also land checkout add-ons + dual-pricing.)
- [ ] 🔴 Confirm the migration actually applied (query the new object in Supabase, don't assume).
- [ ] 🔴 CHANGELOG updated for the release (project rule — every commit has an entry).
- [ ] 🟡 Rollback plan noted: previous Railway deploy is one-click redeploy; migrations are
  forward-only — confirm each new migration is additive/safe to leave in place if code is rolled back.

---

## 1. Payments correctness — open verification items (🔴 Blockers)

These are the two known-open items from the last session handoff. Both must be closed before
onboarding real merchants who take live payments.

- [ ] 🔴 **Group B — no day-1 double-bill (recurring).** In a **test-mode** Stripe account, run a
  fresh 2-pay weekly enrollment and confirm: `$0.50` charges day 1 (upfront only, via
  `processor.charge()`), then a second `$0.50` fires one week later as a `subscription_cycle`
  invoice — **not** two charges on day 1. Verifies the `billing_cycle_anchor` +
  `proration_behavior='none'` fix. (Disconnect → reconnect test-mode Stripe on Settings → Payments first.)
- [ ] 🔴 **Group F — NMI Query API permission.** Confirm the merchant's NMI `security_key` has
  **Query API permission enabled** in the NMI portal, so vaulted-card metadata (`****`/brand/exp)
  populates instead of staying `unknown`. Affected legacy `payment_methods` rows only self-heal on
  re-vault. Document this as an onboarding step for every NMI merchant.
- [ ] 🔴 Run the full payment-flow integration suite green:
  `npx jest --testPathPattern="payment-flow|dispute-flow"`.
- [ ] 🟡 Spot-check one real end-to-end on each rail: NMI charge + vault, Stripe Connect direct
  charge, refund (reverses the ledger), pause/resume/cancel.

---

## 2. Ship-quality / engineering gates

- [ ] 🔴 `npm run typecheck` clean.
- [ ] 🔴 `npm test` (jest) green.
- [ ] 🔴 `npm run build` succeeds (note: Windows `copy-build-assets` step is cosmetic; CI runs on
  Linux and completes fully).
- [ ] 🔴 CI workflow exists and runs on push to `main` (typecheck + jest + build + `npm audit --omit=dev`).
- [ ] 🔴 Launch-critical routes have test coverage: checkout, quick manual sale, offer save/clone,
  payment-provider repair/provisioning, dispute/EFW, refund, pause/resume/cancel, webhook idempotency.
- [ ] 🟡 `npm audit --omit=dev` reviewed; no unpatched **high/critical** in the payments dependency
  surface (`stripe`, `pg`, `axios`, `express`, `multer`, `body-parser`).
- [ ] 🟢 Dependabot (or scheduled audit) enabled.

---

## 3. Security & multi-tenancy (🔴 Blockers)

ScaleSafe is multi-tenant from day one and holds encrypted processor credentials — these are
non-negotiable.

- [ ] 🔴 Every data query filters by `location_id` (per CLAUDE.md). No cross-merchant leakage.
- [ ] 🔴 Processor credentials encrypted at rest: `processor_configs` uses AES-256-GCM
  (`src/utils/field-encryption.ts`); `PROCESSOR_ENCRYPTION_KEY` set in Railway prod and **never** logged.
- [ ] 🔴 RLS lockdown migration (`046_rls_lockdown`) + public-schema hardening (`059`) applied in prod.
- [ ] 🔴 Webhook signature verification enforced in prod for GHL, NMI silent-post, and Stripe.
  Confirm `ALLOW_UNSIGNED_GHL_WEBHOOKS` is **not** set in production.
- [ ] 🔴 No secrets in the repo or in committed `.env`. `.env.example` is the only env file tracked.
- [ ] 🟡 Run `/security-review` on the current branch before launch; triage findings.
- [ ] 🟡 Rate limiting active on public/checkout routes (`rateLimiter` middleware).
- [ ] 🟡 Public checkout/action pages pass XSS/CSP tests (`public-route-xss`, `public-widget-csp`).

---

## 4. OAuth / install / provisioning

- [ ] 🔴 Fresh GHL install on a clean sub-account completes: OAuth → SSO handshake → merchant
  provisioned → SS contact fields + custom values created.
- [ ] 🔴 Post-provision GHL state verified via Make.com MCP: `read_all_custom_values`,
  `list_ghl_custom_fields`, `list_offer_records`, `get_co_schema_v_2_fresh` — no schema drift, no
  missing field IDs.
- [ ] 🟡 Re-install / token-refresh path tested (GHL tokens encrypted per migration `068`).

---

## 5. Product / UX readiness

- [x] 🟡 Error feedback is visible to merchants — toast system added; failed actions (post/put/del)
  auto-toast. (Views can adopt `toast.success(...)` for positive confirmation incrementally.)
- [ ] 🟡 Key flows have loading states (dashboard, long forms) — no dead-air on slow loads. *(skeletons
  not yet added)*
- [ ] 🟡 **WCAG contrast — KNOWN FINDING (needs brand decision).** Primary CTA is white text on
  emerald-500 `#10b981` ≈ **2.54:1**, below AA's 4.5:1 for normal text. emerald-600 ≈ 3.8:1 (still
  fails); **emerald-700 `#047857` ≈ 5.5:1 passes.** Fix = darken `.btn-primary` background (or enlarge/
  bolden text to qualify as "large text" at 3:1). Brand-owner call — not changed unilaterally.
- [ ] 🟡 Keyboard navigation works for `Tabs.vue` / `Modal.vue`; mobile/responsive checked.
- [ ] 🟢 Empty states present on every list view (clients, payments, offers, disputes).

---

## 6. Go-to-market

- [ ] 🟡 GHL Marketplace listing complete: name, description, screenshots, scopes justification,
  support contact.
- [ ] 🟡 Landing page live with SEO + AEO (structured data, answer-engine-ready copy).
- [ ] 🟡 Merchant onboarding content / help center covers the chargeback-defense value loop and the
  NMI Query-API enable step (from §1).
- [ ] 🟢 Incident/support runbook + status page.

---

## 7. Operations & monitoring

- [ ] 🔴 `/health` endpoint green in prod; Railway health check passing (3-retry config).
- [ ] 🟡 Error monitoring/alerting on payment + webhook handlers (a silent recurring-webhook failure
  is a money bug — Stripe webhook now returns 5xx so failures are retried; confirm they're also alerted).
- [ ] 🟡 A way to see, per merchant, that recurring billing is actually firing (reconciliation/audit).
- [ ] 🟢 Backup/restore of Supabase validated.

---

### Sign-off

Launch is approved only when all 🔴 Blockers are checked and every 🟡 Should-fix is either done or
has a written, owner-acknowledged exception.

| Gate | Owner | Date | Evidence |
|---|---|---|---|
| Payments correctness (§1) | | | |
| Security & tenancy (§3) | | | |
| OAuth/provisioning (§4) | | | |
| Final go/no-go | Philip | | |
