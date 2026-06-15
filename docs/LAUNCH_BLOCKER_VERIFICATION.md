# Launch-Blocker Verification Runbook

> Execution steps for the three remaining launch blockers. Format follows the E2E SOP
> (`E2E_BETA_TESTING_ASSISTANT_SOP.md`): setup → steps → expected ScaleSafe / GHL / processor result →
> proof → pass/fail. Record results in `ScaleSafe_E2E_Beta_Testing_Tracker.xlsx`. Any double-charge is
> **P0** and escalates to Philip in Slack immediately.
>
> Code status as of this writing: the **Group B fix is shipped and now regression-tested**
> (`tests/unit/stripe.client.test.ts` → "createSubscription (Group B — no day-1 double-bill)"). The
> remaining work is **live processor verification**, which needs the running app + sandbox/portal access.

---

## Blocker 1 — Group B: no day-1 double-bill on recurring (Stripe sandbox)

**Owner:** Oke (Stripe sandbox). **Severity if it fails:** P0 (money charged twice).

**What the fix does (for reference).** On a recurring offer, ScaleSafe takes the upfront installment
once via `processor.charge()`, then creates the Stripe subscription with `billing_cycle_anchor` set to
the *next* cycle and `proration_behavior='none'` — so Stripe does **not** also fire a full
`subscription_create` invoice on day 1. (`src/clients/stripe.client.ts`, createSubscription.)

**Setup state**
- Stripe is connected in **test/sandbox** mode on the test sub-account (Settings → Payments).
  If it was previously live: **disconnect → reconnect** the sandbox account first (the disconnect-button
  fix is live).
- A recurring offer: **$0.50, weekly, 2 payments** (the PMG repro). New test client, Oke's email.

**Steps**
1. Run a full enrollment (or quick checkout) on the $0.50 / weekly / 2-pay offer with a Stripe test card.
2. Immediately check Stripe sandbox → Payments for the client.
3. Note the Stripe subscription ID and its `billing_cycle_anchor` / next invoice date.

**Expected — ScaleSafe**
- Exactly **one** `payment_events` row for day 1 (the upfront $0.50), `source` = checkout/enrollment.
- Enrollment shows `payments_made = 1`, `payments_remaining = 1`, a stored processor subscription ID.

**Expected — Stripe (sandbox dashboard, view-only)**
- **One** charge of **$0.50** dated today. **No** second $0.50 (and **no** $1.00) on day 1.
- A subscription whose **next invoice is ~7 days out**, not today.

**Expected — GHL**
- `ss_payment_received` fires **once** (one receipt).

**Proof to capture**
- Stripe charge count for day 1 (must be 1), the charge ID, the subscription ID + next-invoice date.
- ScaleSafe `payment_events` count for the client (must be 1 for day 1).
- One week later (or by advancing the sandbox clock if available): the **second** $0.50 fires as a
  `subscription_cycle` invoice and ScaleSafe records it once (`payments_made = 2`).

**Pass/Fail** — PASS only if day-1 has exactly one $0.50 in both ScaleSafe and Stripe and they agree.
Two charges, or a $1.00, on day 1 = **FAIL / P0**.

---

## Blocker 2 - Group F: NMI Query API permission (owner-only) - PASSED for current merchant

**Owner:** Philip (NMI portal + live NMI). **Severity:** blocks correct card metadata, not money movement.

**Current status:** passed for the current NMI merchant on 2026-06-15. Live proof showed subscription ID
`12190152581`, NMI vault `1035592018`, card brand `mc`, expiration `1/2028`, payment progress `1 of 4`,
and next billing date `2026-06-16`.

**Symptom.** NMI vaulted-card metadata (`****` last-four, brand, expiry) shows as `unknown` because the
NMI **Query API** returns an empty response for the stored `security_key`. ScaleSafe's charge path already
falls back to the transact response (code fix shipped), but full vault/transaction lookups need Query API.

**Steps**
1. In the **NMI merchant portal**, open the API/security-keys settings for the account whose
   `security_key` ScaleSafe uses (the location's processor config).
2. Enable **Query API** permission for that key (NMI: Security Keys → the key → allow `query.php`).
3. Re-vault a test card (run one small NMI transaction that saves a card) so a fresh vault entry is created.

**Expected**
- A `query.php` request for that key now returns a populated `<nm_response>` (not empty).
- New `payment_methods` rows show real last-four / brand / expiry instead of `unknown`.

**Proof**
- Before/after of a Query API response (non-empty), and a ScaleSafe `payment_methods` row with populated
  card fields after re-vaulting.

**Note** — pre-existing affected rows won't backfill; they self-heal only when those cards re-vault.

---

## Blocker 3 — E2E retest of the latest checkout / offer / client fixes

**Owner:** Oke (Stripe sandbox) + Philip (NMI live). Map each to the SOP tabs below.

**Why now.** The most recent shipped behavior changes were checkout **add-ons / order bumps /
pre-payment upsells** and **payment-provider repair** (commits `9143b6b`, `7131e52`, `4b9824d`,
`fd2de62`). These specific paths should be re-proven against the live app.

| Area to retest | SOP phase / tracker tab | Key cases |
|---|---|---|
| Offer with **order bump** + **pre-payment upsell** | Phase 2 / `Offer Tests` | Create + edit + **save & reload** an offer with an order bump and an upsell; confirm one-time add-on pricing is **not** charged recurring (regression of `4b9824d`); clone the offer. |
| **Full enrollment** with order bump / upsell | Phase 4 / `Checkout Tests` | Add-on selected → charged **once**, correct amount; line items appear in evidence; recurring still creates a subscription ID. |
| **Quick checkout** with order bump / upsell | Phase 5 / `Checkout Tests` | Same, plus **double-click protection** → only one processor transaction + one `payment_event`. |
| **Add-on save** correctness | Phase 2 / `Offer Tests` | Add-ons save without the prior "save error" (regression of `7131e52`); reload shows them persisted. |
| **Payment-provider repair / health** | Phase 1 & 7 / `Install Checklist` | Run provisioning/repair; confirm the optional GHL provider health copy is clear and repair succeeds (regression of `fd2de62`). |

**Expected (all):** changes persist after reload; no generic "unexpected error"; payment happens once;
ScaleSafe and Stripe agree on charge count and amounts; add-ons priced correctly (one-time vs recurring).

**Proof:** contact/offer/enrollment IDs, Stripe charge count + amounts per test, screenshots, and the
tracker row marked Pass/Fail with an Issue ID on any failure.

---

## Exit criteria

These blockers are cleared (or explicitly accepted as launch exceptions by Philip) when:
- Group B passes in both ScaleSafe and Stripe sandbox (one $0.50 day 1, second a week later).
- Group F: Query API enabled and a re-vaulted card shows populated metadata. **Current merchant passed
  2026-06-15; keep this as an onboarding check for every future NMI merchant.**
- The Blocker-3 retest matrix is Pass across the listed cases, with any P0/P1 fixed.
