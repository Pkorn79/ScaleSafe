# ScaleSafe Bug-Hunt Triage — 2026-05-29

Source: codebase-wide adversarial bug hunt (146 agents, 45 candidates, 32 confirmed,
13 refuted), re-triaged against the current product decision and re-verified against
live code. **This is the accepted working plan.**

## Product-decision overlay (authoritative)

- Recurring/installment billing must come from **processor-native subscriptions + live
  webhooks**. NMI, Stripe, and future Whop.
- **No fallback billing.** ScaleSafe must never silently charge a saved card as a fallback,
  and never silently import NMI history as the live payment path.
- A recurring enrollment missing `processor_subscription_id` is a **setup failure to surface
  clearly** — not a reason to run fallback billing.
- NMI history sync stays a **manual diagnostic/repair tool** only.
- Manual saved-card charging is allowed only on **explicit merchant action**.

## Corrections to the original hunt

- **#1 (recurring cron unscheduled)** — product-decision conflict. `index.ts:29-36`
  deliberately omits `runRecurringBilling` / `runNmiRecurringSync`. **Do not reschedule.**
  Real residual is the narrower Batch H.
- **#24 (evidence-chain `consent_token`)** — STALE/FALSE. Current code queries
  `payment_events.consent_token` (added in migration 022, which holds it). Drop.
- **#25** — duplicate of #8. Drop.
- **#28 (Whop chargeback)** — worse than reported: `'chargeback'` is not in the
  `payment_events_event_type_check_v2` CHECK (migration 026), so the insert *fails* — Whop
  disputes are never recorded.
- **#8 residual** — `phase2Enrollment.handleRecurringPayment` is now deterministic +
  location-scoped, but `webhook.controller.ts:481-488 findEnrollmentForGhlPayment` still
  guesses via `.in('status',['enrolled','active']).limit(2)` — the pattern to remove.

## Classification

| Class | Findings |
|-------|----------|
| 1 — Valid, fix | #2 #3 #4 #5 #6 #7 #8 #9 #10 #11 #12 #13 #14 #15 #16 #17 #18 #19 #20 #21 #22 #23 #26 #27 #28 #29 #30 #31 #32 |
| 2 — Valid, deferrable (low priority) | #20 #21 (manual/display drift), #26 #32 (cosmetic FE), #29 (feature degradation) |
| 3 — Product conflict, do not fix as proposed | #1 |
| 4 — Stale / duplicate | #24, #25 |
| 5 — Needs verification (now done — see Batch H) | reframed #1 |

## Fix batches

### Batch A — Payment idempotency & atomicity (highest priority)
#3 #2 #8 #14. Natural unique constraint as the sole dedupe; one atomic RPC inserts the
ledger row then increments, skipping increment on conflict. No key-claim-before-side-effect
(avoids poisoning retries). SQL below.

### Batch B — Enrollment ledger accounting symmetry
#5 #6 #7 #20 #21. `decrement_enrollment_payments_made` RPC; dunning success increments +
advances; dunning failure initiates even if the ledger insert fails; refund reverses;
`next_billing_date` anchored to prior schedule, not `now()`.

### Batch C — Stripe processor-client correctness
#9 (`chargeStoredCard` not `charge()`), #10 (token from pm row, not DB UUID), #11 (treat
`pending` refund as accepted), #15 (`retrieve(id, undefined, this.acct)`), #16 (calendar
`cancel_at` math).

### Batch D — Webhook reliability & dispute recording
#4 (return 5xx / dead-letter on throw, check dispute upsert error), #28 (route Whop disputes
to `dispute_events`, or allow `'chargeback'` type + negative amount + `eventStatus` case),
#23 (insert NMI `account_health_snapshots` row so the crossing-guard works).

### Batch E — Evidence vault & chain correctness
#12 (vault has no `contact_id` column — add one and filter on it, or translate GHL contact →
`stripe_customer_id`; verify rows affected), #17 (propagate `terms_file_id` to vault or join
`offers_mirror` in gap/score logic). #24 dropped.

### Batch F — Multi-tenant scope & offer integrity
#18 / #19 (add `.eq('location_id', locationId)`), #13 / #31 (clone `skipKeys` += whop_* and
tracking_id), #8 residual (deterministic enrollment match; stop guessing among active rows).

### Batch G — Frontend
#22 / #26 (`:key="$route.fullPath"` on `<router-view>` in `App.vue:81`), #32 (request-seq
guard), #30 (wire or hide auto-submit), #29 (write disengagement evidence row), #27 (clamp
before `String.fromCodePoint`).

### Batch H — Quick Pay / manual-sale recurring subscription setup (TRACED — CONFIRMED BROKEN)

**Trace:** synthetic enrollment inserted at `checkout.controller.ts:727-747` with
`status:'enrolled'`, `payments_made:1`, real future `next_billing_date` — before any
subscription. `createSubscription` runs at `:945` only if a long chain holds. Every failure
branch leaves the enrollment untouched (future `next_billing_date`, no sub id):
`:1028` no contactEmail, `:1016` saveCard throws, `:987` sub create fails, `:1000` sub create
throws, `:967` sub created but ID not saved (processor **will** bill — reconciliation case),
`:944` `subAmountCents<=0` silently skipped (no issue flagged). The failure is surfaced only
in the synchronous HTTP `billingIssue` (`:1064`), never persisted. `payment-reminder-check.ts:65-73`
selects `status IN ('enrolled','active')` + `next_billing_date` and ignores
`processor_subscription_id`, so broken enrollments send reminders for charges that never happen.

**Fix (no fallback billing):**
- Add `billing_setup_status` + `billing_setup_error` to `enrollments` (SQL below).
- Insert synthetic enrollment as `pending`; flip to `ok` only after sub create + ID save.
- On any failure branch: set `failed` (or `needs_reconciliation` for `:967`) and **null
  `next_billing_date`**.
- Exclude non-`ok` from reminder/active queries; surface non-`ok` on dashboard; optionally
  fire a merchant trigger.
- Skip subscription setup when `quickPayBillingComplete` (avoids false `missing_schedule`).

## Sequencing

A → B → C/D → F → E → G, with H alongside A/B (shares the enrollment/ledger surface).

---

## Final SQL (review before applying — not yet run)

### Step 0 — duplicate pre-check (run FIRST; resolve any rows before creating the index)
```sql
SELECT location_id, processor, processor_transaction_id, count(*) AS n,
       array_agg(id ORDER BY created_at) AS event_ids
FROM payment_events
WHERE processor_transaction_id IS NOT NULL AND processor_transaction_id <> ''
GROUP BY location_id, processor, processor_transaction_id
HAVING count(*) > 1
ORDER BY n DESC;
```
If any rows return, review each manually before proceeding (do not auto-delete — payment_events
rows feed the ledger and chargeback evidence).

### Migration 072 — partial unique index (primary dedupe)
```sql
-- 072_payment_events_unique_txn.sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_events_location_processor_txn
  ON payment_events (location_id, processor, processor_transaction_id)
  WHERE processor_transaction_id IS NOT NULL AND processor_transaction_id <> '';
```

### Migration 073 — atomic record_recurring_payment RPC
```sql
-- 073_record_recurring_payment.sql
CREATE OR REPLACE FUNCTION record_recurring_payment(
  p_enrollment_id     uuid,
  p_location_id       text,
  p_processor         text,
  p_transaction_id    text,
  p_amount            numeric,
  p_interval          text DEFAULT 'monthly',
  p_source            text DEFAULT NULL,
  p_next_billing_date date DEFAULT NULL,   -- processor's real date if known; else anchored
  p_raw_payload       jsonb DEFAULT NULL
)
RETURNS TABLE (
  is_duplicate         boolean,
  payment_event_id     uuid,
  payments_made        integer,
  payments_total       integer,
  is_final             boolean,
  billing_completed_at timestamptz,
  next_billing_date    date
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_enr       enrollments%ROWTYPE;
  v_event_id  uuid;
  v_new_made  integer;
  v_is_finite boolean;
  v_is_final  boolean := false;
  v_next      date;
  v_completed timestamptz;
BEGIN
  IF p_transaction_id IS NULL OR p_transaction_id = '' THEN
    RAISE EXCEPTION 'record_recurring_payment requires a non-empty transaction id (enrollment %)',
      p_enrollment_id;
  END IF;

  -- Lock the enrollment for the duration of the transaction.
  SELECT * INTO v_enr FROM enrollments e
   WHERE e.id = p_enrollment_id AND e.location_id = p_location_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'enrollment % not found for location %', p_enrollment_id, p_location_id;
  END IF;

  v_is_finite := v_enr.payment_type <> 'subscription' AND v_enr.payments_total IS NOT NULL;

  -- Primary dedupe: insert the ledger row first (ON CONFLICT against the partial unique index).
  INSERT INTO payment_events (
    merchant_id, location_id, contact_id, enrollment_id,
    event_type, processor, processor_transaction_id, processor_subscription_id,
    amount, currency, payment_number, payments_total, source, is_recurring, raw_webhook_payload
  ) VALUES (
    v_enr.merchant_id, p_location_id, v_enr.contact_id, p_enrollment_id,
    'sale', p_processor, p_transaction_id, v_enr.processor_subscription_id,
    p_amount, 'usd', COALESCE(v_enr.payments_made,0) + 1,
    CASE WHEN v_is_finite THEN v_enr.payments_total ELSE NULL END,
    p_source, true, p_raw_payload
  )
  ON CONFLICT (location_id, processor, processor_transaction_id)
    WHERE processor_transaction_id IS NOT NULL AND processor_transaction_id <> ''
  DO NOTHING
  RETURNING id INTO v_event_id;

  -- Duplicate delivery: ledger row already exists -> do NOT increment.
  IF v_event_id IS NULL THEN
    RETURN QUERY SELECT true, NULL::uuid, v_enr.payments_made, v_enr.payments_total,
      false, v_enr.billing_completed_at, v_enr.next_billing_date;
    RETURN;
  END IF;

  -- New payment: increment + advance schedule atomically.
  v_new_made := COALESCE(v_enr.payments_made,0) + 1;
  v_is_final := v_is_finite AND v_new_made >= v_enr.payments_total;

  IF v_is_final THEN
    v_next := NULL;
    v_completed := now();
  ELSE
    v_completed := v_enr.billing_completed_at;
    IF p_next_billing_date IS NOT NULL THEN
      v_next := p_next_billing_date;                       -- processor truth, preferred
    ELSE
      v_next := (COALESCE(v_enr.next_billing_date, CURRENT_DATE)::timestamp
        + CASE lower(p_interval)
            WHEN 'daily'     THEN interval '1 day'
            WHEN 'weekly'    THEN interval '7 days'
            WHEN 'bi_weekly' THEN interval '14 days'
            WHEN 'biweekly'  THEN interval '14 days'
            WHEN 'quarterly' THEN interval '3 months'
            WHEN 'annual'    THEN interval '1 year'
            ELSE interval '1 month'
          END)::date;
    END IF;
  END IF;

  UPDATE enrollments e
     SET payments_made = v_new_made,
         next_billing_date = v_next,
         billing_completed_at = v_completed,
         updated_at = now()
   WHERE e.id = p_enrollment_id AND e.location_id = p_location_id;

  RETURN QUERY SELECT false, v_event_id, v_new_made, v_enr.payments_total,
    v_is_final, v_completed, v_next;
END;
$$;

NOTIFY pgrst, 'reload schema';
```

Caller change (no code yet): `handleRecurringPaymentSuccess` becomes a thin wrapper around
this RPC and performs evidence logging / trigger firing only when `is_duplicate = false`. The
per-controller `SELECT payment_events` dedupe becomes redundant (the RPC is authoritative) and
may be kept only as a cheap early-out. The GHL empty-transactionId path (#8) must synthesize a
stable id (e.g. `ghl:{orderId}:{payment_number}`) before calling the RPC.

### Migration 074 — Batch H enrollment billing-setup state
```sql
-- 074_enrollment_billing_setup_status.sql
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS billing_setup_status TEXT DEFAULT 'ok';
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS billing_setup_error  TEXT;
-- values: 'ok' | 'pending' | 'failed' | 'needs_reconciliation'
NOTIFY pgrst, 'reload schema';
```

### Batch B/D/E SQL (drafts for later batches)
```sql
-- decrement RPC (Batch B)
CREATE OR REPLACE FUNCTION decrement_enrollment_payments_made(
  p_enrollment_id uuid, p_location_id text DEFAULT NULL
)
RETURNS TABLE (payments_made integer, payments_total integer,
               billing_completed_at timestamptz, next_billing_date date)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  UPDATE enrollments e
     SET payments_made = GREATEST(COALESCE(e.payments_made,0) - 1, 0),
         billing_completed_at = NULL,
         updated_at = now()
   WHERE e.id = p_enrollment_id
     AND (p_location_id IS NULL OR e.location_id = p_location_id)
  RETURNING e.payments_made, e.payments_total, e.billing_completed_at, e.next_billing_date;
END; $$;

-- vault contact_id (Batch E) — if choosing the column approach over translation
ALTER TABLE stripe_evidence_vault ADD COLUMN IF NOT EXISTS contact_id TEXT;
CREATE INDEX IF NOT EXISTS idx_evidence_vault_contact
  ON stripe_evidence_vault (merchant_id, offer_id, contact_id);
```
(Batch D #28 is preferably handled by routing Whop disputes to the existing `dispute_events`
table rather than altering the `payment_events` CHECK constraint.)
