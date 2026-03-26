SCALESAFE — PAYMENT LIFECYCLE BUILD PLAN v1.0  
Date: 2026-03-20  
Status: DRAFT — Pending LLM validation (GPT, Gemini, Manus)  
Author: Claude (directed by Philip Korniotes)

PURPOSE  
This document is the complete build plan for all payment lifecycle features in ScaleSafe. It covers 48 functions across 8 categories (documented in Feature Inventory Section 7). Before building, this plan will be validated by multiple LLMs to confirm the architecture is sound, the build order is optimized, and GHL-vs-Make decisions are correct.

Nothing gets built until this plan is approved.

\=========================================  
SECTION 1: CURRENT STATE — WHAT EXISTS TODAY  
\=========================================

INFRASTRUCTURE:  
\- accept.blue processes all payments (card \+ ACH)  
\- accept.blue webhook 1566 sends ALL transaction events to S7 (Post-Payment Handler)  
\- accept.blue webhook 1620 sends installment events to S10 (Installment Logger)  
\- S7 (Scenario 4622727\) has 4 routes: Enrollment, Recurring, Refund, Failed  
\- S7 is 54 modules — bloated due to duplicated auth chains across routes  
\- AB Customer Map (DS 83038\) links accept.blue customer\_id to GHL contact\_id, location\_id, offer\_id  
\- 19 payment-related custom fields exist on GHL contacts (created 2026-03-20)  
\- SS Payment Status dropdown has: Current, Past Due, Failed, Cancelled, Completed  
\- Supabase stores all evidence records (migrated from Google Sheets 2026-03-16)

WHAT WORKS:  
\- Enrollment payments (PIF and Installment) — charges, creates opportunities, logs evidence  
\- Recurring schedule creation — accept.blue recurring schedule created on installment enrollment  
\- Recurring payment logging — S7 Route 2 catches recurring charges, logs to Supabase, tags contact  
\- Refund handling — S7 Route 3 catches refund webhooks, logs evidence, updates 3 contact fields  
\- Failed payment route — S7 Route 4 exists but is UNTESTED

WHAT DOESN'T WORK:  
\- None of the 19 payment custom fields are being POPULATED by scenarios (they exist but are empty)  
\- No dunning/retry on failed recurring payments  
\- No merchant or client notifications for payment events  
\- No pause/resume/cancel capability  
\- S10 installment logger shows $0.00 and "Unknown" (P1 bug)  
\- Page 3 timing fix and Page 4 PIF/installment toggle still broken (P0)

\=========================================  
SECTION 2: ARCHITECTURE DECISIONS  
\=========================================

DECISION 1: WHERE DOES EACH FUNCTION LIVE?

The principle: "Build in GHL over Make, unless Make has a clear advantage."

GHL is better for:  
\- Sending emails and SMS to merchants and clients  
\- Pipeline stage changes  
\- Internal notifications and task assignment  
\- Simple conditional logic (if/then on contact fields)  
\- Delay/wait steps (e.g., "wait 3 days then retry")

Make.com is better for:  
\- Calling external APIs (accept.blue, Supabase)  
\- Processing webhook payloads  
\- Complex data transformation  
\- Multi-step API chains (OAuth → token → API call)  
\- Writing to Supabase evidence tables

DECISION 2: HOW DO MAKE AND GHL COMMUNICATE?

Current: Make.com writes to GHL via API (contact updates, tags)  
Problem discovered: GHL "Contact Tag Added" trigger only fires on FIRST tag add. Recurring payments add the same tag each month — workflow won't re-fire.

SOLUTION: Use GHL Internal Webhook trigger instead of tag triggers for recurring events. Make.com calls a GHL webhook URL with payment data, GHL workflow processes it. This gives us:  
\- Reliable triggering every time (not dependent on tag state)  
\- Payment data passed directly to the workflow (amount, date, program name)  
\- GHL workflow handles notifications, pipeline updates, field math  
\- Make.com handles API calls, evidence logging, external integrations

For one-time events (enrollment, refund, cancellation), tag triggers are fine because the tag is new each time.

DECISION 3: SHOULD WE REFACTOR S7?

Current S7: 54 modules, 4 routes. The OAuth lookup → token exchange → fetch contact chain is duplicated across Recurring, Refund, and Failed routes (12 redundant modules).

PROPOSED REFACTOR: Create an inner router for non-enrollment events.

Current structure:  
  Webhook → Parse → SetVars → Router  
    → Enrollment (has offer\_id): own OAuth chain → sub-router (Installment / PIF)  
    → Recurring (no offer\_id, charge succeeded): own OAuth chain → log → tag  
    → Refund (subType=refund): own OAuth chain → log → update fields  
    → Failed (charge not succeeded): own OAuth chain → log → tag

Proposed structure:  
  Webhook → Parse → SetVars → Router  
    → Enrollment (has offer\_id): unchanged  
    → Non-Enrollment (no offer\_id): shared customer map → OAuth → token → fetch contact → Inner Router  
      → Recurring (charge succeeded): log evidence → update contact → call GHL webhook  
      → Refund (subType=refund/credit): log evidence → update refund fields → call GHL webhook  
      → Failed (charge declined): log evidence → update failed fields → call GHL webhook

Estimated savings: 54 → \~38 modules (30% reduction)  
Risk: HIGH — S7 is finally working. Rebuilding risks regression.

RECOMMENDATION: Build new features on current S7 first. Refactor AFTER all payment lifecycle features are tested and working. Refactoring is a Phase 3 optimization, not a Phase 1 requirement.

RATIONALE: We've lost too many days to S7 rebuilds. Adding 2-3 modules to working routes is lower risk than restructuring all routes. Once everything works end-to-end, we can refactor with confidence because we'll have test cases to validate against.

COUNTERARGUMENT FOR EARLY REFACTOR: If we refactor first, every new feature benefits from the cleaner architecture. But the risk of breaking what works outweighs this benefit right now.

DECISION 4: ACCEPT.BLUE DATA LIMITATIONS

The recurring payment webhook sends transaction data ONLY. It does NOT include:  
\- Payments remaining (num\_left)  
\- Next payment date (next\_run\_date)  
\- Total scheduled payments  
\- Recurring schedule ID

To get this data, we must call: GET /customers/{customer\_id}/recurring-schedules  
This returns all schedules for a customer, including num\_left and next\_run\_date.

DECISION: Add one accept.blue API call to the Recurring route to fetch schedule details. This gives us accurate payment counts instead of trying to calculate from GHL field math (which is fragile if a payment is missed or a field gets corrupted).

DECISION 5: WHAT ABOUT THE P0 SHOWSTOPPERS?

Page 3 timing fix and Page 4 PIF/installment toggle are P0 items that block real client enrollment. The payment lifecycle features (B3, B4, G4, etc.) enhance EXISTING payment flows that already work.

RECOMMENDATION: Fix P0s first, then build payment lifecycle. OR work them in parallel since they're independent codepaths (funnel code vs. Make.com scenarios). Philip decides.

\=========================================  
SECTION 3: BUILD ORDER (PHASED)  
\=========================================

PHASE A: FOUNDATION (Get data flowing to existing fields)

A1. Add accept.blue schedule lookup to S7 Recurring route  
    WHERE: Make.com (S7, new module after Module 30\)  
    WHAT: GET /customers/{customer\_id}/recurring-schedules → extract num\_left, next\_run\_date  
    WHY: Gives us accurate payment counts for all downstream features  
    DEPENDS ON: Nothing — additive to existing route  
    RISK: Low — one new HTTP module, well-understood API pattern

A2. Add contact field update to S7 Recurring route  
    WHERE: Make.com (S7, new module after contact fetch)  
    WHAT: PUT to GHL contacts API updating: ss\_last\_payment\_date, ss\_last\_payment\_amount, ss\_payment\_status="Current", ss\_payments\_remaining (from schedule lookup), ss\_next\_payment\_date (from schedule lookup), ss\_successful\_payment\_count (+1), ss\_payments\_made (+1), ss\_total\_paid (+amount)  
    WHY: Merchant sees payment status on every contact without leaving GHL  
    DEPENDS ON: A1 (needs schedule data)  
    RISK: Medium — incrementing fields requires reading current values first. Module 33 (fetch contact) already returns custom field values. Need to extract current counts from the response, add to them, and write back.  
    ALTERNATIVE: Use accept.blue schedule data for remaining/next, and use a SetVariables module to calculate totals from (total\_scheduled \- num\_left) instead of incrementing.

A3. Add contact field update to S7 Refund route  
    WHERE: Make.com (S7, enhance existing Module 65 or add new module)  
    WHAT: Update ss\_payment\_status="Refunded", keep existing refund field updates  
    DEPENDS ON: Nothing  
    RISK: Low — route already works, just adding one more field to existing update

A4. Add contact field update to S7 Failed route  
    WHERE: Make.com (S7, enhance existing or add new module)  
    WHAT: Update ss\_payment\_status="Past Due", ss\_failed\_payment\_count (+1), ss\_last\_failed\_payment\_date  
    DEPENDS ON: Nothing — but Route 4 needs testing first (currently untested)  
    RISK: Medium — need to test Route 4 works at all before enhancing it

A5. Add contact field update to S7 Enrollment route  
    WHERE: Make.com (S7, new module in enrollment flow)  
    WHAT: Set initial values on enrollment: ss\_payment\_status="Current", ss\_subscription\_start, ss\_billing\_frequency, ss\_total\_contract\_value, ss\_total\_scheduled, ss\_payments\_remaining, ss\_next\_payment\_date (for installment), ss\_payments\_made=1, ss\_total\_paid=(first payment amount)  
    DEPENDS ON: Nothing  
    RISK: Low — enrollment route is well-tested

PHASE B: NOTIFICATIONS (GHL workflows for merchant/client alerts)

B1. GHL Webhook receiver workflow for recurring payment events  
    WHERE: GHL (Oke builds)  
    WHAT: Internal webhook trigger. Receives payment data from Make.com. Actions: send merchant email "Payment received for \[Client Name\] \- \[Program Name\]", update pipeline stage if needed.  
    TRIGGER: GHL Internal Webhook (called by Make.com after successful recurring charge)  
    DEPENDS ON: Phase A complete (Make.com sends the webhook)

B2. GHL Workflow for enrollment confirmation  
    WHERE: GHL (Oke builds or verify existing)  
    WHAT: Verify the existing "SS: Offer Created \- Notify Merchant" workflow fires correctly on enrollment. Add client confirmation email if not present.  
    DEPENDS ON: Nothing — may already work  
    RISK: Low

B3. GHL Workflow for refund notification  
    WHERE: GHL (Oke already building — Workflow 9\)  
    WHAT: When refund tag added → email merchant with refund details  
    DEPENDS ON: Oke's current work  
    RISK: Low — tag trigger works for refunds (one-time event per refund)

B4. GHL Workflow for failed payment notification  
    WHERE: GHL (Oke builds)  
    WHAT: When ss\_payment\_status changes to "Past Due" → email client "Your payment failed, please update your card." When ss\_payment\_status changes to "Failed" (after dunning exhausted) → email merchant "\[Client\] payment failed after 3 attempts."  
    TRIGGER: Contact Changed on ss\_payment\_status field  
    DEPENDS ON: Phase A (fields being populated) and Phase C (dunning sets the status)

PHASE C: DUNNING SEQUENCE (Failed recurring payment retry)

THIS IS THE MOST COMPLEX PIECE. Here's why:

accept.blue handles retry automatically IF configured. Check: Does accept.blue's recurring schedule system have built-in retry/dunning? If yes, we just need to LISTEN for the results. If no, we need to build retry logic.

RESEARCH NEEDED: Check accept.blue recurring schedule settings for:  
\- Auto-retry on failure  
\- Retry count configuration  
\- Retry interval configuration  
\- What webhook events fire on retry vs. final failure

IF ACCEPT.BLUE HAS BUILT-IN RETRY:  
    C1. Configure retry settings in accept.blue (2 retries, 3-day interval)  
    C2. S7 Route 4 catches each failure → increments ss\_failed\_payment\_count  
    C3. When ss\_failed\_payment\_count reaches 3 → set ss\_payment\_status \= "Failed"  
    C4. GHL workflow on "Failed" status → notify merchant  
    ADVANTAGE: No Make.com scheduling needed. accept.blue does the heavy lifting.

IF WE NEED TO BUILD RETRY:  
    C1. S7 Route 4 catches failure → logs it → sets ss\_payment\_status \= "Past Due"  
    C2. New Make.com scenario (S15) runs on schedule → finds contacts with "Past Due" status → checks if retry count \< 3 and last failure was 3+ days ago → calls accept.blue to charge again  
    C3. If S15 charge succeeds → update status to "Current", reset failed count  
    C4. If S15 charge fails again → increment failed count  
    C5. If failed count \= 3 → set status to "Failed" → GHL workflow notifies merchant  
    DISADVANTAGE: New scenario, scheduled polling, more complexity

RECOMMENDATION: Research accept.blue retry first. If they support it, use it. Much simpler.

PHASE D: SUBSCRIPTION MANAGEMENT

D1. Pause installment schedule  
    WHERE: Make.com (new tool/scenario) triggered from GHL  
    WHAT: GHL form or button → webhook to Make.com → PATCH accept.blue recurring schedule (active=false) → update ss\_payment\_status="Paused" → log evidence to Supabase  
    DEPENDS ON: Phase A (field infrastructure)

D2. Resume installment schedule  
    WHERE: Same as D1 but sets active=true, status="Current"  
    DEPENDS ON: D1

D3. Cancel installment schedule  
    WHERE: Make.com triggered from GHL  
    WHAT: DELETE accept.blue recurring schedule → update fields → log evidence → trigger S12 cancellation flow  
    DEPENDS ON: Phase A, S12 working

D4. Update payment method  
    WHERE: Needs a client-facing page (like the enrollment funnel) where client enters new card → tokenize → update accept.blue payment method on recurring schedule  
    COMPLEXITY: HIGH — requires new funnel page, new scenario  
    RECOMMENDATION: Phase 3 — not needed for launch

D5. One-time ad hoc charge  
    WHERE: Make.com scenario triggered by GHL form  
    WHAT: Merchant fills form with contact, amount, description → Make.com calls accept.blue charge API using stored payment method → logs transaction  
    DEPENDS ON: AB Customer Map having payment\_method\_id (currently not stored — need to add)  
    RECOMMENDATION: Phase 2

PHASE E: EVIDENCE RECORDING GAPS

E1. Log failed payment attempts to evidence  
    WHERE: Make.com (S7 Route 4 → Supabase)  
    WHAT: Log to evidence\_transaction\_detail with status="declined", decline reason from webhook  
    DEPENDS ON: Route 4 testing

E2. Log pause/resume events  
    WHERE: Make.com (within D1/D2 flows → Supabase)  
    WHAT: New evidence type or use existing evidence\_transaction\_detail with source="pause"/"resume"  
    DEPENDS ON: D1/D2

E3. Log payment method updates  
    WHERE: Make.com (within D4 flow → Supabase)  
    DEPENDS ON: D4

\=========================================  
SECTION 4: DEPLOYMENT STRATEGY  
\=========================================

S7 CHANGES (Phases A, C, E1):  
Given the confirmed MCP limitation (scenarios\_update strips nested routes from blueprints \>40 modules), ALL S7 changes must be deployed via file import in Make.com UI.

Process:  
1\. Fetch current blueprint via scenarios\_get  
2\. Modify blueprint JSON locally  
3\. Validate: all module IDs unique, all upstream refs valid, all datastores have parameters  
4\. Save as file  
5\. Philip imports via Make.com UI (Scenarios → Import Blueprint)  
6\. Verify: scenarios\_get to confirm module count and structure  
7\. Test with real webhook or replay

GHL WORKFLOWS (Phases B, D partial):  
Oke builds in GHL UI. Claude provides exact specifications:  
\- Trigger type and configuration  
\- Each action step with field names and values  
\- Conditional logic  
\- Email/SMS templates

NEW SCENARIOS (Phase C if needed, Phase D):  
Standard Make.com build via API. These are small (\<15 modules) so MCP deploy is safe.

\=========================================  
SECTION 5: BUILD PRIORITY AND TIMELINE  
\=========================================

WEEK 1: PHASE A (Foundation)  
\- A5: Enrollment field population (sets initial values — everything downstream depends on this)  
\- A1: Schedule lookup in Recurring route  
\- A2: Recurring field update  
\- A3: Refund field update  
\- A4: Failed field update (after Route 4 test)  
\- Oke: B2 (verify enrollment notification)

WEEK 2: PHASE B (Notifications) \+ PHASE C RESEARCH  
\- Research accept.blue retry/dunning capabilities  
\- B1: GHL recurring payment webhook workflow (Oke)  
\- B3: Refund notification (Oke — already in progress)  
\- B4: Failed payment notification workflow (Oke)  
\- C1-C4: Dunning sequence (approach depends on accept.blue research)

WEEK 3: PHASE D (Management) \+ PHASE E (Evidence)  
\- D1/D2: Pause/Resume  
\- D3: Cancel  
\- E1: Failed payment evidence  
\- E2: Pause/resume evidence  
\- G4: Payment status tags (ss-payment-current, ss-payment-past-due, etc.)

FUTURE: D4 (card update page), D5 (ad hoc charges), S7 refactor

\=========================================  
SECTION 6: GHL vs MAKE DECISION MATRIX  
\=========================================

| Function | GHL | Make | Decision | Reasoning |  
|----------|-----|------|----------|-----------|  
| Update payment fields on contact | | X | MAKE | Needs accept.blue \+ Supabase API calls in same flow |  
| Send merchant payment notification | X | | GHL | Email/SMS is GHL's strength |  
| Send client payment receipt | X | | GHL | Email/SMS is GHL's strength |  
| Increment payment counts | | X | MAKE | Can do in same API call that sets other fields |  
| Pipeline stage changes | X | | GHL | Native GHL workflow action |  
| Dunning retry charge | | X | MAKE | Needs accept.blue API call |  
| Dunning schedule/timing | ? | ? | DEPENDS | If accept.blue has built-in retry: neither. If not: Make.com scheduled scenario |  
| Pause/Resume schedule | | X | MAKE | Needs accept.blue API call |  
| Cancel schedule | | X | MAKE | Needs accept.blue API \+ Supabase logging |  
| Evidence logging | | X | MAKE | All evidence goes to Supabase |  
| Payment status tags | | X | MAKE | Applied in same flow as field updates |  
| Smart lists/filtering | X | | GHL | Native GHL contact filtering |  
| Ad hoc charges | | X | MAKE | Needs accept.blue API |  
| Update payment method | | X | MAKE | Needs accept.blue API \+ tokenization |

SUMMARY: Make.com handles data processing and external APIs. GHL handles notifications and contact management UI. They communicate via GHL internal webhooks (Make → GHL) and GHL workflow webhooks (GHL → Make).

\=========================================  
SECTION 7: RISKS AND MITIGATIONS  
\=========================================

RISK 1: S7 gets more complex  
MITIGATION: Limit additions to 2-3 modules per route. Refactor later.

RISK 2: GHL "Contact Changed" trigger fires too often  
MITIGATION: Use specific field change triggers, not broad contact change. Test with real data.

RISK 3: accept.blue recurring schedule lookup adds latency  
MITIGATION: One additional API call per recurring payment (\~200ms). Acceptable.

RISK 4: Field math drift (counts get out of sync)  
MITIGATION: Use accept.blue schedule data as source of truth for remaining payments rather than incrementing a GHL field. If accept.blue says num\_left=5, set ss\_payments\_remaining=5 regardless of what GHL currently shows.

RISK 5: Dunning complexity  
MITIGATION: Research accept.blue built-in retry FIRST. Only build custom dunning if needed.

RISK 6: MCP deploy limitation  
MITIGATION: All S7 changes via file import. Never use scenarios\_update for S7.

\=========================================  
SECTION 8: QUESTIONS FOR VALIDATION  
\=========================================

When submitting this plan to GPT/Gemini/Manus for review, ask:

1\. Is the GHL-vs-Make split correct? Are there functions assigned to one platform that would be better in the other?

2\. Is the build order optimized? Are there dependencies we missed? Should anything move earlier or later?

3\. Is the "refactor S7 later" decision correct, or should we refactor first given we're about to add modules?

4\. For the dunning sequence: is the accept.blue-first approach correct, or should we always build our own retry logic for control?

5\. Are there payment lifecycle scenarios we haven't considered? (chargebacks from processor, ACH returns, card network disputes, etc.)

6\. Is the GHL Internal Webhook approach for Make→GHL communication the right pattern, or is there a better way?

7\. For field math (incrementing payment counts): is reading current value → adding → writing back reliable, or should we use accept.blue as source of truth and just SET absolute values each time?

8\. Anything in this plan that would break at scale (50+ merchants, 1000+ clients)?

\=========================================  
SECTION 9: FIELD REFERENCE (Quick Lookup)  
\=========================================

PAYMENT STATUS FIELDS (contact-level):  
  ss\_last\_payment\_date | TEXT | nATlf8t2tePNX3UUU2o5  
  ss\_last\_payment\_amount | MONETORY | vzwyRaNBAeNDvT1GHPvo  
  ss\_payments\_made | NUMERICAL | D95Aw9yPL2epoVfWz5fd  
  ss\_payments\_remaining | NUMERICAL | IHnJQ43z9a8rxgZZaTYH  
  ss\_total\_scheduled | NUMERICAL | EKIdq5Wosw24GXR69kvU  
  ss\_total\_contract\_value | MONETORY | IQYR3WMeoIi4SkdkEb4l  
  ss\_payment\_status | SINGLE\_OPTIONS | p68mR1Khyusaa18EvL4z  
  ss\_successful\_payment\_count | NUMERICAL | gv8N35VHKq8rTFCocHy1  
  ss\_failed\_payment\_count | NUMERICAL | MxygucLglbZK0AftFqOy  
  ss\_last\_failed\_payment\_date | TEXT | gLeQ0N7PRi6klBRSD5vJ  
  ss\_billing\_frequency | SINGLE\_OPTIONS | TQND8rFCdsmTenW8StR4  
  ss\_subscription\_start | TEXT | ekNPiHgn4oFIZs0oZvIq  
  ss\_payment\_grace\_period\_end | TEXT | Qb5gPFCYYZ67glv5JxPC  
  ss\_total\_paid | MONETORY | XHN25syeO46t4yXhECEn  
  ss\_remaining\_balance | MONETORY | dKyLgyZRHulnOL9y8WYS  
  ss\_next\_payment\_date | TEXT | NbVGvae1gc60e9UO2Pbu

REFUND FIELDS (contact-level):  
  ss\_refund\_amount | TEXT | eORyRt0Fd8kliP8Fmqem  
  ss\_refund\_date | TEXT | Hv8oYaNU1cobRqqQ2JyT  
  ss\_refund\_transaction\_id | TEXT | pcTtpZyVshitn1vl6sO0

SS PAYMENT STATUS OPTIONS: Current, Past Due, Failed, Cancelled, Completed  
NEEDED: Add "Paused" and "Refunded" options (Oke — GHL UI task)

DATASTORES:  
  AB Customer Map: DS 83038 (key \= accept.blue customer\_id)  
  OAuth Tokens: DS 82801 (key \= location\_id)

SCENARIOS:  
  S7 Post-Payment Handler: 4622727 (54 modules, 4 routes)  
  S10 Installment Logger: 4609066 (Supabase, has $0.00 bug)  
  S12 Refund/Cancel Handler: 4617815 (0 executions, needs testing)

ACCEPT.BLUE WEBHOOKS:  
  1566 → S7 (all transaction events)  
  1620 → S10 (installment events)

ACCEPT.BLUE API ENDPOINTS NEEDED:  
  GET /customers/{id}/recurring-schedules — fetch schedule details (num\_left, next\_run\_date)  
  PATCH /recurring-schedules/{id} — pause/resume (active flag)  
  DELETE /recurring-schedules/{id} — cancel schedule

\=========================================  
END OF PLAN — SUBMIT FOR VALIDATION  
\=========================================

\=========================================  
ADDENDUM: ACCEPT.BLUE DUNNING RESEARCH (2026-03-20)  
\=========================================

METHODOLOGY: Queried accept.blue API v2 directly. Fetched a live recurring schedule (ID 172353\) to inspect all available fields.

RECURRING SCHEDULE OBJECT — ALL FIELDS:  
  id (integer) — schedule ID  
  customer\_id (integer) — accept.blue customer  
  title (string) — schedule name  
  created\_at (datetime) — when created  
  frequency (string) — daily/weekly/biweekly/monthly/etc.  
  amount (decimal) — charge amount  
  subtotal (decimal) — subtotal before surcharge  
  prev\_run\_date (date) — last successful run date  
  next\_run\_date (date) — next scheduled run date  
  transaction\_count (integer) — total number of successful transactions run  
  num\_left (integer) — remaining scheduled payments (0 \= unlimited/ongoing)  
  active (boolean) — whether schedule is active  
  status (string) — "active" observed; other values unknown  
  payment\_method\_id (integer) — payment method used  
  receipt\_email (string) — email for receipts

FINDING 1: NO BUILT-IN DUNNING OR RETRY  
accept.blue recurring schedules have NO retry/dunning configuration fields. There is no:  
\- retry\_count or max\_retries  
\- retry\_interval or retry\_days  
\- dunning\_enabled flag  
\- grace\_period setting  
\- failure\_action configuration

The recurring schedule simply fires a charge on schedule. If a charge fails, accept.blue fires a "declined" webhook event. The schedule presumably advances to the next run date. There is no automatic retry.

CONCLUSION: We MUST build our own dunning sequence. This confirms the "build our own" path from Phase C in the plan.

FINDING 2: ACCEPT.BLUE IS SOURCE OF TRUTH FOR PAYMENT COUNTS  
The recurring schedule object provides:  
\- transaction\_count \= exact number of successful payments (replaces incrementing ss\_payments\_made)  
\- num\_left \= exact remaining payments (replaces decrementing ss\_payments\_remaining)  
\- next\_run\_date \= exact next payment date (no calculation needed)  
\- prev\_run\_date \= last payment date

This means the S7 Recurring route should:  
1\. Receive webhook for successful charge  
2\. Call GET /customers/{customer\_id}/recurring-schedules to get schedule details  
3\. SET contact fields to absolute values from the schedule (not increment/decrement)

This eliminates field math drift entirely. If a field gets corrupted, the next successful payment auto-corrects it.

FINDING 3: SCHEDULE LOOKUP REQUIRES CUSTOMER ID (NOT SCHEDULE ID)  
The webhook payload includes customer\_id but NOT schedule\_id. We call:  
  GET /customers/{customer\_id}/recurring-schedules  
This returns an array. If a customer has multiple schedules, we need to match by amount or title.  
For ScaleSafe, each customer should have at most one installment schedule, so taking the first active schedule is safe.

UPDATED PHASE C ARCHITECTURE (Dunning — Must Build Our Own):

C1. S7 Route 4 catches failed charge webhook → logs to Supabase → updates contact:  
    \- ss\_payment\_status \= "Past Due"  
    \- ss\_failed\_payment\_count \+ 1  
    \- ss\_last\_failed\_payment\_date \= today

C2. New scenario S15 (Dunning Retry) — runs on schedule (every 6 hours):  
    \- Queries Supabase for contacts with payment\_status \= "Past Due" AND failed\_payment\_count \< 3  
    \- For each: checks if last\_failed\_date was 3+ days ago  
    \- If yes: looks up AB Customer Map → gets payment\_method\_id → calls accept.blue charge API  
    \- If charge succeeds: update status to "Current", reset failed count, log evidence  
    \- If charge fails: increment failed\_count, update last\_failed\_date

C3. When ss\_failed\_payment\_count reaches 3:  
    \- Set ss\_payment\_status \= "Failed"  
    \- GHL workflow triggers on "Failed" status → notifies merchant

C4. Client notification on each failure:  
    \- GHL workflow triggered by "Past Due" status or by S15 calling a GHL internal webhook  
    \- Sends email: "Your payment of $X for \[Program\] failed. Please update your card."

IMPORTANT: S15 needs access to payment\_method\_id to retry charges. This field is NOT currently stored in the AB Customer Map datastore. MUST ADD payment\_method\_id to the datastore structure and have S7 enrollment route save it.

TEMP MAKE.COM TOOLS TO DELETE:  
  4628386 — Get AB Recurring Schedule  
  4628388 — List AB Customer Recurring Schedules  
  4628390 — List All AB Recurring Schedules

═══════════════════════════════════════════════════════════════  
SECTION 9: VALIDATION RESULTS (v2.0 — March 20, 2026\)  
═══════════════════════════════════════════════════════════════

Validated by: GPT-4, Gemini, Manus (Senior Systems Architect persona)  
Date: March 20, 2026  
Status: ALL THREE REVIEWS COMPLETE — Changes incorporated below

───────────────────────────────────────────────────────────────  
9A. CONSENSUS FINDINGS (All 3 reviewers agreed)  
───────────────────────────────────────────────────────────────

1\. accept.blue has NO built-in dunning/retry — confirmed via API and all reviewers  
2\. GHL should be a PROJECTION LAYER, not the source of truth for payment data  
3\. Supabase should be the canonical payment ledger (deduped event log)  
4\. accept.blue is source of truth for schedule state (num\_left, next\_run\_date)  
5\. Never read-then-increment GHL fields — always SET absolute values  
6\. Idempotency is required BEFORE any field population work  
7\. P0 bugs must be fixed before extending lifecycle logic  
8\. GHL Internal Webhook is the correct Make→GHL communication pattern for events

───────────────────────────────────────────────────────────────  
9B. CRITICAL GAPS IDENTIFIED  
───────────────────────────────────────────────────────────────

GAP 1: IDEMPOTENCY (Manus \+ GPT)  
accept.blue explicitly retries webhooks on non-2xx responses. Without a dedup check, S7 will double-write to Supabase, double-update GHL, and double-fire workflows.  
FIX: Add processed event ID log (Supabase or Make datastore). First module in S7 checks if incoming transaction ID was already processed. If yes, return 200 and stop.

GAP 2: ACH RETURNS (Manus)  
accept.blue sends "subType: returned" for ACH payments that succeed initially then fail days later when the bank returns the money. No handler exists.  
FIX: Add handler in S7 that catches transaction status updates with subType=returned. Must reverse enrollment/recurring logic: set ss\_payment\_status to "Past Due", adjust counts, trigger dunning.

GAP 3: WEBHOOK SIGNATURE VERIFICATION (Manus)  
accept.blue sends X-Signature header (HMAC-SHA256). We're not verifying it. Anyone who knows the Make.com webhook URL can inject fake payment events.  
FIX: Add signature verification as first module in S7.

GAP 4: OAUTH TOKEN CONTENTION (Manus)  
GHL refresh tokens are single-use. If two S7 executions for the same merchant both try to refresh simultaneously, the second one fails permanently.  
FIX: Add locking mechanism in OAuth datastore — check lock flag before refreshing, set lock, refresh, store new token, release lock.

GAP 5: PARTIAL REFUNDS (GPT \+ Manus)  
Current refund handling treats refunds as a single event. Partial refunds would overwrite ss\_refund\_amount instead of accumulating.  
FIX: Use Supabase to sum all refund transactions for a contact, then SET the total into GHL.

GAP 6: CHARGEBACK/DISPUTE LIFECYCLE (GPT \+ Manus)  
No handler for disputes. Chargebacks have response deadlines (7-10 days). Need: ss\_payment\_status \= "Disputed", merchant notification, evidence logging, schedule pause.  
FIX: Confirm with accept.blue whether they send chargeback webhooks. Add dispute route if so.

GAP 7: MULTI-SUBSCRIPTION CONTACTS (GPT)  
Contact-level fields assume one active payment lifecycle per contact. Breaks when a client has two offers, an upsell, or a restart.  
FIX (v2): GHL Custom Objects for Subscription/Payment Plan. Not blocking for v1 launch but must be planned.

GAP 8: ss\_remaining\_balance HAS NO POPULATION LOGIC (Manus)  
Field was created (dKyLgyZRHulnOL9y8WYS) but no phase populates it.  
FIX: Add calculation step in Recurring and Refund routes: ss\_remaining\_balance \= ss\_total\_contract\_value \- ss\_total\_paid.

───────────────────────────────────────────────────────────────  
9C. ARCHITECTURE CHANGES ACCEPTED  
───────────────────────────────────────────────────────────────

CHANGE 1: DUNNING ARCHITECTURE — REVERSED  
OLD: S15 Make.com polling scenario checks GHL for "Past Due" contacts on a schedule  
NEW: GHL owns the dunning state machine (Wait steps, delays, branching). Make.com only executes charges when GHL fires a webhook.  
WHY: Make.com is an execution engine, not a state machine. Polling GHL at scale is expensive and rate-limit-consuming. GHL's native Wait steps are purpose-built for time-based state management.

CHANGE 2: DATA AUTHORITY MODEL  
OLD: GHL fields maintained via read-then-increment  
NEW: Three-tier source of truth:  
  — accept.blue \= schedule state (num\_left, next\_run\_date, active)  
  — Supabase \= canonical payment ledger (deduped events, cumulative counts)  
  — GHL \= projection/UI layer (SET absolute values, never increment)

CHANGE 3: S7 REFACTOR TIMING  
OLD: Defer refactor until after features work  
NEW: Refactor S7 BEFORE adding Phase A modules  
WHY: Adding to three duplicated OAuth chains means doing the work 3x. Refactoring at 54 modules with existing webhook replays for validation has a smaller regression surface than refactoring at 70+ modules later.

CHANGE 4: GHL CONTACT CHANGED TRIGGER (GPT)  
GPT confirmed that GHL "Contact Changed" trigger now fires each time a tracked field changes, not just on first change. This means ss\_payment\_status field changes can reliably trigger GHL workflows without needing Internal Webhooks for every event.  
DECISION: Use Contact Changed for persistent state-driven workflows (status changes). Use Internal Webhook only when transient payload values (amount, program, date) are needed in the workflow.

───────────────────────────────────────────────────────────────  
9D. DISAGREEMENTS BETWEEN REVIEWERS  
───────────────────────────────────────────────────────────────

TOPIC: S7 Refactor Timing  
  — Manus: Refactor NOW (before Phase A). Smaller regression surface, avoid 3x duplication.  
  — GPT: Refactor AFTER features work. Do minimal hardening now.  
  — OUR DECISION: Refactor now (Manus position). The compounding complexity argument is stronger.

TOPIC: Internal Webhook as Primary Communication Pattern  
  — Manus: Yes, correct pattern, but address failure modes.  
  — GPT: Use for transient payloads only. Direct API updates for persistent state. GHL Inbound Webhook is premium and fragile if payload structure changes.  
  — OUR DECISION: Hybrid (GPT position). Direct API for state updates, Internal Webhook for notification payloads only.

TOPIC: Custom Objects for Multi-Subscription  
  — GPT: Plan for Custom Objects now as v2 data model.  
  — Manus: Not mentioned.  
  — OUR DECISION: Defer to v2, but document the limitation. Contact-level fields are acceptable for v1 launch.

═══════════════════════════════════════════════════════════════  
SECTION 10: REVISED BUILD ORDER (v2.0)  
═══════════════════════════════════════════════════════════════

PHASE 0 — FOUNDATION HARDENING (Before anything else)  
  0.1 Fix S10 $0.00 / "Unknown" bug (field path mismatch in webhook payload)  
  0.2 Fix Page 3 timing issue  
  0.3 Fix Page 4 PIF/installment toggle  
  0.4 Add "Paused" and "Refunded" options to ss\_payment\_status dropdown (GHL — Oke task)  
  0.5 Add idempotency gate to S7 (check transaction ID in Supabase before processing)  
  0.6 Add webhook signature verification to S7 (X-Signature HMAC-SHA256)  
  0.7 Add payment\_method\_id to AB Customer Map datastore structure  
  Dependencies: None — these are prerequisites for everything  
  Estimated: 3-4 days

PHASE 1 — S7 REFACTOR  
  1.1 Backup current S7 blueprint (already done: s7\_backup\_2026\_03\_20.json)  
  1.2 Refactor to shared inner router: single OAuth chain serving all non-enrollment routes  
  1.3 Target: 54 modules → \~38 modules  
  1.4 Validate with existing webhook replays for all 4 routes  
  1.5 Deploy via file import (NOT MCP — confirmed limitation with nested routes)  
  Dependencies: Phase 0 complete (idempotency gate must survive refactor)  
  Estimated: 2-3 days

PHASE 2 — FIELD POPULATION (on clean S7)  
  2.1 A5: Enrollment field population (ss\_total\_scheduled, ss\_billing\_frequency, etc.)  
  2.2 A1: Recurring schedule lookup — GET from accept.blue, SET absolute values into GHL  
  2.3 A2: Recurring payment field updates (ss\_payments\_made, ss\_total\_paid, ss\_next\_payment\_date)  
  2.4 A3: Refund field updates (ss\_refund\_amount from Supabase sum, ss\_payment\_status)  
  2.5 A4: Failed payment field updates (ss\_failed\_payment\_count, ss\_payment\_status)  
  2.6 Populate ss\_remaining\_balance in Recurring and Refund routes  
  Dependencies: Phase 1 complete (clean S7 architecture)  
  Estimated: 3-4 days

PHASE 3 — NOTIFICATIONS  
  3.1 B1: Merchant payment received notification (GHL workflow, Contact Changed trigger on ss\_payment\_status)  
  3.2 B2: Client payment confirmation (GHL workflow, Internal Webhook for transient payload)  
  3.3 B3: Merchant refund alert (GHL workflow)  
  3.4 B4: Failed payment merchant alert (GHL workflow)  
  3.5 B5: Failed payment client notification (first failure — GHL workflow)  
  Dependencies: Phase 2 complete (fields must be populated for notifications to reference)  
  Estimated: 2-3 days

PHASE 4 — DUNNING (GHL-driven state machine)  
  4.1 Design GHL dunning workflow: failed payment → Wait 3 days → check status → retry or escalate  
  4.2 Build Make.com retry charge endpoint (receives GHL webhook, calls accept.blue POST /transactions/charge)  
  4.3 Wire GHL workflow to Make.com retry endpoint  
  4.4 After 2 failed retries: pause accept.blue schedule, set ss\_payment\_status \= "Failed", notify merchant  
  4.5 Add OAuth token locking mechanism for concurrent execution safety  
  Dependencies: Phase 3 complete (notification patterns established)  
  Estimated: 3-4 days

PHASE 5 — MANAGEMENT \+ EVIDENCE \+ EDGE CASES  
  5.1 D1: Pause subscription (GHL action → Make.com → accept.blue)  
  5.2 D2: Resume subscription  
  5.3 D3: Cancel subscription (verify S12 works)  
  5.4 D5: Payment method update flow  
  5.5 ACH return handler (subType: returned → reverse enrollment/recurring logic)  
  5.6 Chargeback/dispute handler (if accept.blue confirms webhook support)  
  5.7 E1-E4: Evidence gap fills (refund evidence, failed payment evidence, recurring evidence)  
  Dependencies: Phase 4 complete  
  Estimated: 4-5 days

TOTAL ESTIMATED: 18-23 working days

═══════════════════════════════════════════════════════════════  
SECTION 11: REVIEWER-SPECIFIC NOTES  
═══════════════════════════════════════════════════════════════

FROM GPT:  
— GHL Custom Objects recommended for v2 multi-subscription support  
— "Contact Changed" trigger confirmed working for field value changes (not just first-time)  
— Recommends Supabase event ledger as THE canonical source, not just a logging layer  
— "Do not let contact fields become your payment ledger" — guiding principle accepted

FROM MANUS (Senior Systems Architect):  
— accept.blue docs confirm X-Signature HMAC-SHA256 header for webhook verification  
— accept.blue docs confirm subType: returned for ACH returns — critical gap  
— OAuth token contention is a "critical architectural flaw" at scale — locking required  
— Fan-out pattern recommended for S7 at 50+ merchants (webhook receiver → queue → processor)  
— Scale concern: 1000 concurrent webhooks \= 50-80 min queue at 3-5 sec/execution  
— Supabase indexes needed: evidence\_transaction\_detail on contact\_id, transaction\_id, created\_at

FROM GEMINI:  
— Confirmed plan is directionally sound  
— Scale concerns align with Manus but less specific  
— No unique findings not covered by GPT or Manus

VALIDATION STATUS: COMPLETE — Plan approved for execution with changes incorporated above.

═══════════════════════════════════════════════════════════════  
SECTION 12: CRITICAL PIVOT — CURATEDCONNECTOR RESTORATION (March 20, 2026\)  
═══════════════════════════════════════════════════════════════

STATUS: ACTIVE — This is now the \#1 priority before any payment lifecycle work.

───────────────────────────────────────────────────────────────  
12A. THE PROBLEM  
───────────────────────────────────────────────────────────────

During earlier build sessions, a previous Claude instance rebuilt working CuratedConnector modules as raw HTTP requests (http:MakeRequest). This means:

— Every GHL API call is now a manually constructed HTTP request with hardcoded headers, URLs, and auth tokens  
— A custom OAuth Token datastore (DS 82801\) and Token Refresh scenario were built to manage auth that CuratedConnector handled automatically  
— 4 scenarios have hardcoded location IDs baked into URLs instead of using dynamic multi-merchant connections  
— The entire OAuth chain (datastore lookup → token exchange → location token) is duplicated across every scenario

This is a significant architectural regression. CuratedConnector (and eventually CuratedAgency) handles authentication, multi-tenant connections, and pre-built actions out of the box. Rebuilding all of that as raw HTTP requests created unnecessary complexity, fragility, and blocked the path to multi-merchant scale.

IMPACT: 44 GHL-touching modules across 9 scenarios. Of those, 18 are OAuth plumbing that CuratedConnector eliminates entirely. 26 are "real work" modules (get contact, update contact, add tag, etc.) that need to be swapped to CuratedConnector equivalents.

───────────────────────────────────────────────────────────────  
12B. THE FIX  
───────────────────────────────────────────────────────────────

Swap all raw HTTP GHL modules back to CuratedConnector modules, one scenario at a time. Once proven on CuratedConnector, upgrade to CuratedAgency for multi-merchant scale.

APPROACH:   
— Start with Refund/Cancel Handler (4 real GHL actions, already uses dynamic location IDs)  
— Prove the pattern works  
— Roll through remaining scenarios  
— After all scenarios are on CuratedConnector, swap to CuratedAgency (should be drop-in)

MODULES TO SWAP PER SCENARIO:  
— Post-Payment Handler: 2 GHL modules (token exchange \+ custom values)  
— Charge Processor: 2 GHL modules  
— Enrollment Prep: 6 GHL modules (4 real \+ 2 OAuth)  
— Offer Data Fetch: 4 GHL modules (2 real \+ 2 OAuth)  
— Refund/Cancel Handler: 6 GHL modules (4 real \+ 2 OAuth)  
— Merchant Provisioning: 6 GHL modules (4 real \+ 2 OAuth)  
— Offer Creation: 8 GHL modules (6 real \+ 2 OAuth)  
— AI Defense Compiler: 6 GHL modules (4 real \+ 2 OAuth)  
— Daily Comms Logger: 4 GHL modules (2 real \+ 2 OAuth)  
— Installment Logger: 0 GHL modules (Supabase only — no changes needed)

TOTAL: \~26 real swaps \+ 18 OAuth modules to delete \= 44 modules touched

───────────────────────────────────────────────────────────────  
12C. REVISED PRIORITIES  
───────────────────────────────────────────────────────────────

PAYMENT LIFECYCLE BUILDOUT (Phases 0-5 from Section 10): ON PAUSE  
— All payment lifecycle work is paused until the CuratedConnector restoration is complete  
— The payment lifecycle build plan remains valid — it resumes after this fix  
— The validation results (Section 9\) still apply

NEW PHASE ORDER:  
1\. CuratedConnector Restoration (THIS — one scenario at a time)  
2\. CuratedAgency Upgrade (swap Connector → Agency once all scenarios are on Connector)  
3\. Resume Payment Lifecycle Build (Phases 0-5 from Section 10\)

───────────────────────────────────────────────────────────────  
12D. PROGRESS TRACKER  
───────────────────────────────────────────────────────────────

\[ \] Refund/Cancel Handler — FIRST (proving the pattern)  
\[ \] Installment Logger — SKIP (no GHL modules)  
\[ \] Post-Payment Handler — after pattern proven  
\[ \] Charge Processor  
\[ \] Enrollment Prep  
\[ \] Offer Data Fetch  
\[ \] Offer Creation  
\[ \] AI Defense Compiler  
\[ \] Merchant Provisioning  
\[ \] Daily Comms Logger  
\[ \] CuratedAgency upgrade (all scenarios)  
\[ \] Resume payment lifecycle buildout