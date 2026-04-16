# Defense Module Rebuild — Build Plan v1.0

**Created:** 2026-04-15
**Status:** Phase 1 SCOPE complete. All 8 product decisions locked. Ready for Phase 2 RESEARCH (Claude Code).
**Trigger:** Defense feature works after Bug B fix but is not production-ready. Output is on-screen Markdown (not PDF), single transient record (no dashboard), won/lost on compilation screen (wrong timing — bank outcomes come 30-90 days later), AI letter content has accuracy and tone problems that would damage real submissions.

---

## 1. Current State

**Working:**
- `defense_packets` table with full schema (migration 002 + migration 043 added offer_id)
- `defense.repository.ts` + `defense.service.ts` + `defense.controller.ts` all functional after Bug B fix
- `POST /api/defense/compile` accepts chargeback details (reason code, amount, dispute date, deadline, case number, optional offer_id), creates a packet row, fires `ss_chargeback_detected`, triggers async AI letter compilation
- AI letter generation runs (Claude or similar) and produces a Markdown letter using evidence timeline + enrollment data
- Defense History endpoint (`GET /api/dashboard/defense-history`) returns past packets
- `ss_chargeback_detected` and `ss_defense_ready` triggers fire with `processor` field (Stripe vs NMI distinction)
- Oke building SS - Defense Deadline Reminder workflows (T-7 and T-3 tied to GHL task)

**Broken / Missing:**
- AI letter output is rendered on-screen as Markdown — no PDF generated
- Single record displayed at compilation time — no persistent dashboard view of all packets
- Won/Lost decision buttons live on the compilation screen — wrong placement (outcomes come 30-90 days after submission)
- AI letter content quality issues identified by testing (2026-04-15):
  - Mischaracterizes cancellation events as "ongoing service engagement"
  - Placeholders (`[CASE NUMBER]`, `[Current Date]`) not substituted
  - Claims service days based on cancellation events
  - Doesn't directly reference the signed enrollment packet PDF (strongest evidence)
  - Generic "Issuing Bank" addressee
  - Defensive tone instead of clinical/factual
  - No numbered exhibit/appendix list
- No bundled PDF combining defense letter + signed enrollment packet + evidence timeline + milestone signoffs as exhibits
- No status lifecycle (Pending Submission → Submitted → Won/Lost/Withdrawn)
- Outcome data not feeding chargeback ratio monitoring (the data exists in dispute_events but no closed-loop)

## 2. Target State

**Defense Dashboard** at a top-level nav item:
- Lists ALL defense packets (active + historical) as cards
- Each card shows: client name, chargeback amount, reason code, dispute date, response deadline, days until deadline, status badge, won/lost outcome if set
- Filter: All / Active / Pending Outcome / Won / Lost
- Sort: by deadline (default, soonest first), date created, amount

**Compile flow:**
- Merchant opens "New Defense" form, enters chargeback details, submits
- Backend creates packet, AI generates clinical/factual letter referencing actual evidence accurately
- Letter compiles into a PDF that bundles: defense letter + signed enrollment packet + numbered evidence exhibits + milestone signoffs
- Status set to "Pending Submission"
- Merchant downloads the PDF, submits to their processor (manually for NMI; for Stripe, optionally auto-submit via Stripe API)

**Packet detail view** (clicking a card):
- Shows packet metadata, deadline countdown, generated PDF download
- Shows the AI letter inline (read-only Markdown view of the generated text)
- "Mark Submitted" button → status changes to Submitted, submission timestamp recorded
- After submission, "Record Outcome" section becomes available with Won / Lost / Withdrawn buttons
- Won/Lost recorded with optional notes field, amount recovered (if Won), processor fee/timeline

**AI letter quality:**
- Factual/clinical tone — no argumentative language
- Accurate event characterization — distinguishes service delivery from cancellation events
- No unfilled placeholders — all merge fields resolved
- Specific addressee when known (processor or bank reps)
- Numbered exhibits cross-referenced ("Exhibit A: Signed enrollment packet dated 2026-04-11, Exhibit B: Session log 2026-04-13...")

**Outcome → chargeback ratio loop:**
- Won/Lost outcomes update `dispute_events` status
- Daily chargeback ratio monitoring (already built) reads outcomes for both Stripe and NMI rails
- Won disputes don't count against the ratio (per card brand rules)

## 3. Build Inventory

| Item | Platform | Depends On |
|---|---|---|
| Status lifecycle field on `defense_packets` (enum: pending_submission / submitted / won / lost / withdrawn) — migration if not already present | Supabase | — |
| AI letter prompt rewrite — clinical tone, accurate event interpretation, exhibit references, no placeholders | App (backend) | Existing prompt audit |
| PDF generation for defense letter (Puppeteer pattern, mirror enrollment-packet.service.ts) | App (backend) | Letter content stable |
| Exhibit assembly — bundle defense letter PDF + signed enrollment packet PDF + evidence timeline export + milestone signoff records into one combined PDF | App (backend) | PDF generation working |
| Storage path + signed URL pattern (Supabase storage, mirror enrollment packets) | Supabase + App | Combined PDF generated |
| Defense Dashboard view — list packets as cards with filter/sort | App (frontend) | Defense history endpoint enriched |
| Defense Dashboard endpoint enrichment — return packets with deadline countdown, status, outcome | App (backend) | Status field exists |
| Packet detail view — metadata, PDF download, letter inline, Mark Submitted action, Record Outcome section | App (frontend) | Status lifecycle |
| Mark Submitted endpoint + status transition | App (backend) | Status field |
| Record Outcome endpoint — won/lost/withdrawn + optional notes/amount recovered | App (backend) | Status field |
| Outcome → dispute_events status update + ratio monitoring integration | App (backend) | Outcome endpoint |
| Optional: auto-submit to Stripe Dispute Evidence API for Stripe-rail merchants | App (backend) | Stripe Defense Layer scope |
| Defense top-level nav item in main app sidebar (currently the only entry is via individual client profile?) | App (frontend) | Dashboard view exists |

## 4. Product Decisions (Locked 2026-04-15)

1. **Status lifecycle:** `pending_submission → submitted → won / lost / withdrawn`. Four lifecycle states. No separate `expired` state for MVP.
2. **PDF format:** ONE combined bundle per packet = defense letter + signed enrollment packet + evidence timeline + milestone signoffs, all numbered as exhibits.
3. **Auto-submit to Stripe:** Manual for MVP. Merchant downloads bundled PDF, submits to their processor. Auto-submit-to-Stripe deferred to the future Stripe Defense Layer slice (Phases S1-S4).
4. **Letter editing:** Editable Markdown textarea after AI generation. Merchant reviews, edits, then generates the PDF from the edited version. Once packet is marked Submitted, the letter and PDF are locked.
5. **Letter regeneration:** Regenerate button available before Submit. All versions stored in history for audit. Submitted version is the final locked version.
6. **Outcome detail:** Won/Lost + amount recovered (when Won) + decision date + optional bank notes. Captures full picture for ratio tracking and defense analytics.
7. **Defense Dashboard placement:** Top-level nav item alongside Clients / Offers / Settings. Primary surface for merchant awareness of all active disputes.
8. **Withdrawn:** A status, not a delete. Packet stays in dashboard with Withdrawn status. History preserved.

## 5. Platform Decision Matrix (Phase 3)

Every item in §3 Build Inventory lives in the **App** for this rebuild. No GHL workflow changes, no Make.com changes, no Marketplace portal changes. Documenting explicitly so the "is this really an app-only slice?" question doesn't resurface mid-build.

| # | Item | Platform | Why it lives there | Risk if wrong |
|---|---|---|---|---|
| 1 | `defense_packets.lifecycle_status` column + `submitted_at` + migration to widen `defense_outcomes.outcome` CHECK | Supabase migration | Schema lives in Supabase. Must precede any backend that writes the new states. | If the migration runs after the backend deploys, the API will throw `defense_packets_lifecycle_status_check` violations on every Mark Submitted / Record Outcome call until the migration runs. **Run the migration first.** |
| 2 | `defense_packets.dispute_event_id` FK | Supabase migration | Q2 locked: explicit FK from packet → dispute_event. NMI path creates the `dispute_events` row server-side at compile time. | If the migration ships without a backfill plan, existing PMG defense packets will have `dispute_event_id = NULL` forever. They're test data — accept the loss, don't backfill. |
| 3 | `defense_letter_versions` table | Supabase migration | New parent-child table mirrors a 1-to-N relationship. Simpler than overloading `defense_packets.defense_letter_text` with version history JSONB. | Schema design risk is low — pattern matches `evidence_milestones`/`evidence_signoffs`. |
| 4 | AI letter prompt rewrite (clinical tone, semantic event grouping, exhibit references, no placeholders, addressee handling) | App — backend (`src/services/defense.service.ts`) | Pure prompt engineering. No external API change, no schema change. The model client (`anthropic.client.ts`) stays as-is. | **Highest content-quality risk.** A bad prompt change could regress to the same "cancellation as engagement" failure mode Philip caught. Mitigate by testing against a known-bad fixture (the test enrollment that produced the original failure) before merging — see §7 Risk A. |
| 5 | Pre-letter exhibit list builder | App — backend (`src/services/defense.service.ts` or new `defense-exhibits.service.ts`) | Pure data shaping over the existing `evidenceRepository.getFullSnapshot()`. Server-side so the LLM and the PDF assembler see the same numbered list in the same order. | If the prompt's exhibit numbering drifts from the PDF assembly numbering, citations will be wrong. Single source of truth: build the exhibit list once, pass it to BOTH the prompt builder and the PDF bundler. |
| 6 | Defense letter PDF renderer | App — backend (new `src/services/defense-letter-pdf.service.ts`) | HTML→PDF via Puppeteer mirrors the proven `enrollment-packet.service.ts` pattern. Extract `renderHtmlToPdf` to a shared util. | Low — Puppeteer pattern is battle-tested in production for enrollment packets. |
| 7 | Bundled PDF assembler (defense letter + exhibits + signed enrollment packet) | App — backend (new `src/services/defense-bundle.service.ts`) | `pdf-lib` is already in `package.json`. The signed enrollment packet is loaded from `scalesafe-files` storage and merged AS-IS to preserve consent forensics. | Re-rendering the enrollment packet would destroy forensic integrity. **Architectural decision below: never re-render. Always merge from storage.** |
| 8 | Storage path + signed URL | App — backend | Mirror `enrollment-packets/{locationId}/{enrollmentId}.pdf` pattern. New path: `defense-packets/{locationId}/{defenseId}.pdf`. Persist on `defense_packets.pdf_storage_path` + `pdf_url` (columns already exist). | Low — pattern proven by enrollment packets. |
| 9 | New backend endpoints: regenerate letter, save edit, mark submitted, record outcome | App — backend (`src/controllers/defense.controller.ts` + `defense.service.ts`) | All thin layers over the new schema + existing `defenseRepository`. Mark Submitted locks the latest letter version. Record Outcome writes BOTH `defense_outcomes` AND propagates to the linked `dispute_events`. | If the FK isn't populated (older packets), Record Outcome should still write `defense_outcomes` and just skip the `dispute_events` propagation. Defensive code in the controller. |
| 10 | NMI compile path: server-side `dispute_events` row creation | App — backend (`defense.service.ts compileDefense`) | Q2 locked: NMI compile creates the `dispute_events` row first, then links via FK. The `dispute_events` table has `stripe_dispute_id NOT NULL` per migration 017 — must be relaxed to NULLABLE in the same migration as Sub-phase A. | If we skip this and let `stripe_dispute_id` be required, NMI defense compile will fail on the dispute_events insert. Migration must allow NULL or have a sentinel value. See Risk D. |
| 11 | Defense Dashboard list view | App — frontend (`src/ui/src/views/DefenseView.vue` rewrite) | Card layout + filter buttons + sort dropdown. Compile modal migrated to `<Modal>` from Slice 2. | Low — UI rewrite over an existing endpoint. |
| 12 | Packet detail view with tabs | App — frontend (`src/ui/src/views/DefenseDetailView.vue` rewrite) | Q5 locked: 4 tabs (Letter / Exhibits / History / Outcome) using `<ProfileTabs>` from Slice 2. Letter tab is editable Markdown before Submit, locked after. Outcome tab gated on `lifecycle_status === 'submitted'`. PDF inline preview via `<iframe>` per Q9. | Iframe sandboxing risk: Supabase signed URLs typically work in iframes but check for `Content-Security-Policy` / `X-Frame-Options` headers. Mitigated by allowing direct download as fallback. |
| 13 | Compile form: addressee field with processor default | App — frontend + backend | Q7 locked. Default depends on processor type — Stripe = `"Stripe Disputes Team"`, NMI = `"Sponsor Bank — Chargeback Department"` (until merchant overrides). Field added to compile form, passed in the API call, stored on `defense_packets.addressee`. | Low — small field add. |
| 14 | Compile form: dispute_event picker for Stripe path | App — frontend | When merchant clicks "Defend this dispute" from a `dispute_events` row, the compile form pre-fills with that dispute_event's data and links via FK. When merchant clicks "New Defense" from the Defense Dashboard, they manually enter chargeback details (NMI path or unmatched Stripe). | Low — additive UX. The "New Defense" button uses the existing manual-entry form. |
| 15 | Stripe Risk Health page rename + route move | App — frontend (`src/ui/src/App.vue` nav, route registration) | Q4 locked: rename to "Stripe Risk Health," move route to `/risk-health`. The new Defense Dashboard owns `/defense`. | Tiny — string + route swap. |
| 16 | Outcome → dispute_events propagation | App — backend | When `recordOutcome` runs, look up the linked `dispute_events` row via FK and update its `outcome`, `outcome_at`, `status` (mapping `won → 'won'`, `lost → 'lost'`). The daily chargeback ratio job (`daily-health-check.ts`) reads `dispute_events` for Stripe and now reads `defense_packets` directly for NMI (Q3 locked). | If the daily job's NMI ratio query is wrong, NMI ratio monitoring will be silently incorrect. Test path: mark a test NMI packet as Won, run the daily job manually, verify the ratio counts the win correctly. |
| 17 | Move `DEFENSE_REBUILD_PLAN.md` → `docs/` | docs | Q10 locked. Cosmetic. **Already done as part of writing this section.** | None. |

### Architecture decisions recorded inline

- **Status field structure (Q1 locked):** `defense_packets.status` keeps its original AI pipeline meaning (`pending → processing → complete → failed`). New column `defense_packets.lifecycle_status` (`pending_submission → submitted → won → lost → withdrawn`). Frontend renders both — the Letter tab shows compilation state, the Outcome tab shows lifecycle state. Different concerns, different columns.
- **Linkage (Q2 locked):** `defense_packets.dispute_event_id UUID NULL REFERENCES dispute_events(id)`. **Stripe path:** `dispute_events` row exists first (from webhook), merchant clicks "Defend this dispute" → compile flow links via FK. **NMI path:** compile flow creates the `dispute_events` row server-side first, then the `defense_packets` row, FK linked. **Side effect:** `dispute_events.stripe_dispute_id` must be relaxed to NULLABLE so NMI rows can insert without a Stripe ID. New column `dispute_events.processor TEXT NOT NULL DEFAULT 'stripe'` discriminates the two rails.
- **Letter version model (Q6 locked):** `defense_letter_versions` is append-only. Latest version is always shown. Regenerate creates a new row. Edit-then-save creates a new row. No manual rollback to past versions in v1. The version that was current when Mark Submitted fired gets `is_submitted_version = true` AND the entire packet becomes read-only (letter editing disabled, regeneration disabled).
- **PDF assembly (locked):** Use `pdf-lib` for the merge. Defense letter rendered fresh as HTML → PDF via Puppeteer (reuses extracted `renderHtmlToPdf` util). Exhibits page rendered fresh as HTML → PDF. Signed enrollment packet PDF loaded from `scalesafe-files` storage and merged **AS-IS** — never re-rendered. This preserves the original consent-time forensics that make it the strongest exhibit.
- **Single exhibit-list source of truth:** `defenseExhibitsService.buildExhibitList(locationId, contactId)` returns `[{ letter: 'A', name: 'Signed enrollment packet', source: 'storage', path: '...' }, { letter: 'B', name: 'Session log #1', source: 'evidence_sessions', id: '...' }, ...]`. The same list is passed to BOTH the prompt builder (so the LLM cites correctly) AND the PDF bundler (so the assembly order matches the citations). One source of truth — no drift.
- **Tab body file structure:** New Defense tab views live as siblings of `DefenseView.vue` in `src/ui/src/views/defense/` — `LetterTab.vue`, `ExhibitsTab.vue`, `HistoryTab.vue`, `OutcomeTab.vue`. Mirrors the Slice 2 pattern of `client-profile/` siblings.
- **Per-tab fetch ownership:** `DefenseDetailView.vue` owns the packet metadata fetch (header data). Each tab owns its own additional fetches (history tab fetches the version list, outcome tab is a write-only form). No cross-tab prop drilling beyond the packet object.
- **Engineering choices taken without further Philip input** (per captain rule):
  - Default tab on detail view open: **Letter** (the highest-frequency thing the merchant looks at).
  - Letter editor: **plain `<textarea>` with monospace font** in v1. No rich Markdown editor — out of scope.
  - History tab presentation: chronological list, latest at top, click to view (read-only). No diff view in v1 — flag if Philip wants it later.
  - Empty state copy when a packet has 0 versions (defensive only — impossible by design): "No letter generated yet."
  - PDF iframe height: viewport - 200px fixed, with a download button always visible above.

## 6. Build Order — Phased (Phase 3)

Per the meta-pattern locked in Slice 2: ships as **one release** for the merchant — no half-states where some tabs work and others don't — but **internally phased across 4 sub-phases** to fail fast on the riskiest pieces. Each sub-phase ends with something internally testable on a feature branch; only the final sub-phase merges.

### Sub-phase A — Schema + backend foundations (no user-visible changes)

**Goal:** land all migrations and the new server-side primitives. Fail fast on the Q1 + Q2 schema decisions. Verify the AI prompt rewrite produces clinical/factual output BEFORE building any UI on top of it.

**Deliverables:**

1. **Migration `044_defense_lifecycle.sql`:**
   - `ALTER TABLE defense_packets ADD COLUMN lifecycle_status TEXT DEFAULT 'pending_submission' CHECK (lifecycle_status IN ('pending_submission', 'submitted', 'won', 'lost', 'withdrawn'))`
   - `ALTER TABLE defense_packets ADD COLUMN submitted_at TIMESTAMPTZ`
   - `ALTER TABLE defense_packets ADD COLUMN dispute_event_id UUID REFERENCES dispute_events(id)`
   - `ALTER TABLE defense_packets ADD COLUMN addressee TEXT`
   - `ALTER TABLE defense_outcomes DROP CONSTRAINT defense_outcomes_outcome_check; ALTER TABLE defense_outcomes ADD CONSTRAINT defense_outcomes_outcome_check CHECK (outcome IN ('won', 'lost', 'pending', 'expired', 'withdrawn'))`
   - `ALTER TABLE dispute_events ALTER COLUMN stripe_dispute_id DROP NOT NULL`
   - `ALTER TABLE dispute_events ADD COLUMN processor TEXT NOT NULL DEFAULT 'stripe' CHECK (processor IN ('stripe', 'nmi'))`
   - Index: `CREATE INDEX idx_defense_packets_lifecycle ON defense_packets (lifecycle_status, response_deadline)` (powers the Defense Dashboard sort-by-deadline + filter-by-status)
2. **Migration `045_defense_letter_versions.sql`:**
   - New `defense_letter_versions` table per §6 of the research report (defense_packet_id FK, version_number, letter_text, generated_at, generated_by, model_used, prompt_tokens_used, response_tokens_used, is_submitted_version, notes)
   - Unique constraint on `(defense_packet_id, version_number)`
   - Index on `(defense_packet_id, version_number DESC)`
3. **Extract Puppeteer renderer:** new `src/services/pdf-renderer.service.ts` exporting `renderHtmlToPdf(html)`. Update `src/services/enrollment-packet.service.ts` to import from it. No behavior change — pure refactor.
4. **New `src/services/defense-exhibits.service.ts`:** exposes `buildExhibitList(locationId, contactId, opts?)`. Returns ordered exhibit list with letter, name, source type, content reference. Pre-groups evidence by semantic category (Service Delivery / Payments / Termination / Consent / Communication). This is the single source of truth that both the prompt and the bundler read from.
5. **Rewrite `defense.service.ts buildSystemPrompt` and `buildUserMessage`:**
   - System prompt: clinical tone instruction, hard rule about termination events, exhibit citation rules, never-leave-placeholders rule, addressee handling
   - User message: pre-grouped evidence sections, exhibit list inline, current date as a real value, all merge fields explicit, addressee resolved
   - Add support for `addressee` field on `CompileDefenseInput`
6. **Rewrite `defense.service.ts compileDefense`:** add NMI dispute_events creation path + FK linkage. Stripe path unchanged (FK populated from caller).
7. **Rewrite `defense.service.ts runCompilation` to write the letter to `defense_letter_versions`** as version 1, then mirror to `defense_packets.defense_letter_text` for fast read.
8. **New `src/services/defense-letter-pdf.service.ts`:** `generateLetterPdf(letterText, packet, exhibitList)` returns a Buffer. Uses extracted `renderHtmlToPdf`.
9. **New `src/services/defense-bundle.service.ts`:** `bundleDefensePdf(packetId)` orchestrates: fetch packet + latest letter version + exhibit list, render letter PDF, render exhibits PDF, load enrollment packet PDF from storage, merge via pdf-lib, upload to storage, return signed URL. Updates `defense_packets.pdf_storage_path` + `pdf_url`.

**Dependencies:** None — entry point.

**Testable behavior (internal, no user-visible change yet):**

- Run the AI letter generation against the test enrollment that produced Philip's original failure (cancellation → "engagement" bug). Expected: clinical letter, accurate event characterization, no placeholders, exhibits cited correctly.
- Manually call `bundleDefensePdf` for an existing PMG packet. Verify the merged PDF opens, the signed enrollment packet section is byte-identical to what's in storage (use `sha256sum` to compare).
- All migrations apply cleanly + reverse cleanly.

**Exit criteria to move to B:** AI prompt regression test passes against the known-bad fixture. Merged PDF integrity verified. No type errors.

---

### Sub-phase B — Compile flow + lifecycle endpoints

**Goal:** wire the server-side state transitions so the merchant can compile, regenerate, edit, mark submitted, and record outcome. Frontend still uses the old views during this phase.

**Deliverables:**

1. **New endpoints in `defense.controller.ts` + `defense.routes.ts`:**
   - `POST /api/defense/:id/regenerate` — calls `runCompilation` again, inserts new version, mirrors to `defense_letter_text`, refreshes the bundled PDF
   - `PUT /api/defense/:id/letter` — accepts `{ letter_text }`, inserts a new version with `generated_by='manual_edit'`, mirrors to `defense_letter_text`, refreshes the bundled PDF
   - `POST /api/defense/:id/submit` — sets `lifecycle_status='submitted'`, sets `submitted_at`, marks the latest letter version as `is_submitted_version=true`, locks further regeneration
   - `POST /api/defense/:id/outcome` — accepts `{ outcome: 'won'|'lost'|'withdrawn', amount_recovered?, resolved_at?, notes? }`. Writes to `defense_outcomes`, sets `defense_packets.lifecycle_status` to `outcome`. **If `dispute_event_id` is set, also writes `dispute_events.outcome`, `dispute_events.outcome_at`, and maps `dispute_events.status`.**
   - `GET /api/defense/:id/versions` — returns the version history for the History tab
   - `POST /api/defense/:id/rebundle` — manual PDF regeneration trigger (defensive, in case bundle generation failed during compile or regenerate)
2. **Extend `defense.controller.ts compile` (existing endpoint):** accept the new `addressee` field, populate `lifecycle_status='pending_submission'` on insert, populate `dispute_event_id` if provided, create the dispute_events row server-side if NMI + no dispute_event_id provided.
3. **Update `defense.service.ts shapePacketResponse`** (the helper added in commit `9849bb9`) to expose `lifecycle_status`, `submitted_at`, `addressee`, `dispute_event_id`, and the latest version's `version_number` on the packet response.
4. **Daily health check NMI ratio update:** `src/jobs/daily-health-check.ts` — extend the chargeback ratio query to also count NMI defense_packets (where `dispute_events.processor='nmi'`). Won packets don't count against the ratio (per card brand rules). Ensure both rails surface a separate ratio number.
5. **Lock-after-submit guards:** all letter mutation endpoints (`/regenerate`, `PUT /letter`) check `lifecycle_status !== 'submitted'` and throw `ValidationError` if violated. Defense in depth.
6. **Auto-rebundle hook:** every successful `/regenerate`, `PUT /letter`, and `/submit` synchronously calls `defenseBundleService.bundleDefensePdf()` before returning. Storage path includes a version suffix so signed URLs invalidate cleanly.

**Dependencies:** Sub-phase A complete. New migrations run.

**Testable behavior:** via curl / Postman / Railway logs:

- Compile a defense (NMI path) — verify dispute_events row created, FK populated.
- Compile a defense (Stripe path) with a real dispute_event_id — verify FK populated.
- Regenerate letter — verify new version row, latest version returned.
- Edit letter — verify new version row with `generated_by='manual_edit'`.
- Mark Submitted — verify status transition, version lock, future regenerate calls return 400.
- Record Outcome (Won) — verify `defense_outcomes` row, `defense_packets.lifecycle_status='won'`, AND `dispute_events.outcome='won'` if FK present.
- Daily health check picks up NMI Won packet correctly.

**Exit criteria to move to C:** all 6 endpoints return correct status codes + payloads. Manual end-to-end via API works. No regressions in existing `compile` endpoint.

---

### Sub-phase C — Defense Dashboard + Detail view (frontend)

**Goal:** rebuild the frontend over the working backend. Fail fast on the iframe PDF preview compatibility (Risk B).

**Deliverables:**

1. **New tab body files** in `src/ui/src/views/defense/`:
   - `LetterTab.vue` — Markdown textarea (editable until submit, read-only after) + Regenerate button + Save button + word/char count + last-modified timestamp
   - `ExhibitsTab.vue` — list of exhibits with letter (A/B/C…) + name + source + view-snippet expand
   - `HistoryTab.vue` — chronological list of letter versions with view (read-only) + token counts + generated-by badge
   - `OutcomeTab.vue` — read-only summary if outcome already recorded, otherwise the form (gated on `lifecycle_status === 'submitted'`)
2. **Rewrite `DefenseDetailView.vue`:**
   - Sticky header (Slice 2 pattern): client name, chargeback amount, reason code + category, deadline countdown ("3 days remaining" — colored red if <7 days)
   - Action buttons: Download PDF (always), Mark Submitted (if `pending_submission`), back to dashboard
   - PDF inline preview via `<iframe :src="packet.pdf_url" />` (Q9 locked) with a prominent download button above the iframe
   - `<ProfileTabs>` from Slice 2 wrapping the 4 tab body components
   - Active tab persists to URL hash (mirrors Slice 2 ClientDetailView pattern)
3. **Rewrite `DefenseView.vue` → `DefenseDashboard.vue`:**
   - Card layout (not table) per §4 decision
   - Summary cards stay at top: Total / Won / Win Rate / Value Saved
   - Filter buttons: All / Active (lifecycle_status IN pending_submission, submitted) / Pending Outcome (submitted) / Won / Lost / Withdrawn
   - Sort dropdown: Deadline (default, soonest first) / Date Created / Amount
   - Each card: client name, amount, reason code badge, dispute date, deadline countdown, lifecycle status badge, outcome badge if set
   - "New Defense" button opens compile modal (migrated to `<Modal>` from Slice 2)
4. **Compile modal:** add Addressee field with processor-based default. Migrate inline modal to `<Modal>` component.
5. **Stripe Risk Health page move** (Q4): rename `DefenseDashboard.vue` → `StripeRiskHealth.vue`, move route from `/defense/dashboard` to `/risk-health`, update nav in `App.vue`. Remove the sub-link from under Defense.
6. **Add "Defend this dispute" button** to the existing Stripe dispute_events list view (if one exists — verify in sub-phase) so merchants can launch the compile flow with the dispute_event_id pre-filled. If no list view exists today, defer this entry point — they'll still be able to compile manually from the Defense Dashboard.

**Dependencies:** Sub-phase B complete.

**Testable behavior:** all 4 tabs render, lifecycle transitions work end-to-end through the UI, PDF preview displays in the iframe, Stripe Risk Health route accessible at new path.

**Exit criteria to move to D:** PMG walkthrough of the full flow (compile → review letter → regenerate → edit → mark submitted → record won) succeeds. No console errors. Iframe PDF preview displays.

---

### Sub-phase D — Polish + chargeback ratio loop verification

**Goal:** loose ends, manual testing of the outcome → ratio loop, polish, CHANGELOG. Final smoke before merge.

**Deliverables:**

1. Loading skeletons per tab.
2. Empty state copy: dashboard with 0 packets, history tab with 1 version, outcome tab pre-submission, exhibits tab with 0 exhibits.
3. Deadline countdown formatting: "3 days" vs "3 days remaining" vs "Overdue by 2 days" (red).
4. Mobile responsive: dashboard cards reflow to 1-column on phone width. Detail view tabs use the bottom-nav from `<ProfileTabs>` if mobile.
5. **Chargeback ratio loop manual test:** create a test NMI packet → mark submitted → record won → run `daily-health-check` manually → verify NMI ratio number reflects the win (or correctly excludes it per card brand rules).
6. **AI letter regression test fixture:** save the test enrollment that produced the original "cancellation as engagement" failure as a permanent fixture. Document the expected output characteristics. Re-run before any future prompt change.
7. CHANGELOG entry covering all 4 sub-phases.
8. Type check + Vite build.

**Exit criteria for merge:** Philip walks through the full flow on PMG, on desktop + mobile. AI letter regression fixture passes. Daily health check NMI ratio confirmed correct. No unresolved issues.

## 7. Risk Register (Phase 3)

One entry per genuine risk. Sub-phase column tells you when it's most likely to surface. Blast radius = who/what is affected if it goes wrong. Fix-forward = the cheapest path to recovery.

### Risk A — AI prompt rewrite regresses to inaccurate event characterization

**Sub-phase:** A
**What could go wrong:** the new prompt structure (semantic event grouping, exhibit references, clinical tone) is more complex than the current one, and a single bad rule could send Claude back to rationalizing cancellations as engagement, OR to over-citing exhibits, OR to refusing to write anything because the rules feel restrictive.
**Blast radius:** every defense letter generated post-merge. **Highest impact of any risk in this rebuild** — bad letters submitted to processors hurt merchant chargeback win rates and damage trust.
**Fix-forward:**
- Build a regression fixture (the test enrollment that produced the original failure) and run the new prompt against it BEFORE merging Sub-phase A. Output must: (a) characterize the cancellation correctly as a termination event, (b) substitute all merge fields with no `[BRACKET]` artifacts, (c) cite at least 3 numbered exhibits, (d) use clinical tone (no "we strongly contest" / "the cardholder is mistaken" type language).
- Save 3-5 known-good output fixtures from the new prompt as snapshots. Future prompt changes must regenerate the same outputs (or be intentionally different and the snapshots updated with a commit).
- If a real-world failure surfaces post-merge, the fix is iteration on the prompt — not a code rollback. Prompt changes are just text edits.
**Mitigation in the plan:** Sub-phase A exit criteria explicitly requires the regression fixture to pass before moving to B. Sub-phase D exit criteria saves the fixture permanently.

### Risk B — Iframe PDF preview blocked by browser CSP / X-Frame-Options

**Sub-phase:** C
**What could go wrong:** Supabase storage signed URLs are public by default but some browsers / iframe sandboxing may block PDF rendering inside an `<iframe>` if the response headers don't include the right `Content-Disposition` or the bucket is misconfigured. Result: empty iframe in the Packet Detail view.
**Blast radius:** PDF preview UX only. The download button still works.
**Fix-forward:**
- Test the iframe preview in PMG with a real bundled PDF on Day 1 of Sub-phase C. If it doesn't render, fall back to embedding the PDF via `pdfjs-dist` (would need to add as a dependency) OR drop the iframe and just show the download button as the primary action.
- Long-term: add a `Content-Disposition: inline` header on the storage bucket if Supabase allows it.
**Mitigation in the plan:** Sub-phase C exit criteria checks iframe preview specifically. The download button is always present so the worst case is "preview doesn't render but merchant can still download."

### Risk C — Bundled PDF exceeds processor upload size limits

**Sub-phase:** A (architecture) / D (validation)
**What could go wrong:** Stripe's evidence file upload limit is 4.5 MB per file. A merchant with extensive evidence (long signed enrollment packet + many exhibits + communication transcripts) could produce a bundled PDF over that limit, breaking auto-submit (when that future slice ships) and also being too big for some bank manual upload portals.
**Blast radius:** large-volume merchants only. A coach with 1 client touchpoint per week probably stays under 1 MB; a high-volume program with daily session logs over 6 months could exceed 4.5 MB.
**Fix-forward:**
- After bundling, check the buffer size. If >4 MB, log a warning and (a) compress the PDF via `pdf-lib`'s built-in Deflate, OR (b) generate a "summary" version with truncated communication transcripts, OR (c) split into multiple PDFs (defense letter + appendix). Pick (a) for v1 — simplest.
- Communicate the size in the UI: "Defense Packet: 2.3 MB" so merchants know what they're submitting.
**Mitigation in the plan:** Sub-phase D exit criteria checks bundled PDF size against PMG test data. If sizes are concerning, escalate to compression in the same sub-phase.

### Risk D — `dispute_events.stripe_dispute_id NOT NULL` constraint blocks NMI inserts

**Sub-phase:** A
**What could go wrong:** migration 017 created `dispute_events.stripe_dispute_id TEXT NOT NULL`. The Q2 NMI flow needs to insert dispute_events rows with no Stripe ID. The Sub-phase A migration drops the NOT NULL constraint AND adds a `processor` column to discriminate the rails — but if either part is forgotten OR the migration runs after the backend deploys, NMI compile will hard-fail with a constraint violation that surfaces as 500 to the merchant.
**Blast radius:** all NMI defense compilations. Stripe path unaffected.
**Fix-forward:**
- The migration itself is the fix. No second step.
- Defensive code in `compileDefense`: try the dispute_events insert, catch the constraint violation specifically, surface a clear error message ("dispute_events schema not migrated — run migration 044") so a future developer who forgets the migration order sees what's wrong immediately.
**Mitigation in the plan:** explicit migration step in Sub-phase A item 1, explicit Sub-phase A exit criteria that "all migrations apply cleanly."

### Risk E — Letter regeneration / edit triggers stale PDF download

**Sub-phase:** B
**What could go wrong:** merchant clicks Regenerate, sees a new letter, clicks Download — but the PDF in storage is still the old version because the bundle wasn't regenerated. Or worse: the merchant marks Submitted with the old PDF still cached.
**Blast radius:** every regenerate / edit cycle if the PDF refresh hook is missing.
**Fix-forward:**
- Every `/regenerate`, `PUT /letter`, and `/submit` endpoint MUST trigger `defenseBundleService.bundleDefensePdf()` synchronously before returning. The new PDF URL is part of the response. Frontend reads the new URL and updates the iframe.
- Storage paths use a versioned key like `defense-packets/{locationId}/{defenseId}-v{n}.pdf` so a stale signed URL becomes invalid as soon as a new version is generated, forcing browsers to refetch.
**Mitigation in the plan:** Sub-phase B item 6 explicitly mentions "auto-rebundle hook" on every mutation endpoint. Sub-phase D smoke test should regenerate-then-download to verify the new content arrives.

### Risk F — Per-tab fetch ownership creates loading flash on tab switch

**Sub-phase:** C
**What could go wrong:** the History tab fetches the version list lazily. If the merchant clicks History before the fetch completes, they see a loading state, then the data flashes in. Acceptable for a slow first-click but not for tab switching after data is loaded.
**Blast radius:** detail view UX only. Cosmetic.
**Fix-forward:**
- Cache fetched data on the parent component (`DefenseDetailView.vue`). Each tab body reads from a shared object passed via prop. First click on a tab triggers the fetch and stores the result; subsequent clicks read from cache.
- Loading skeletons (Sub-phase D item 1) make the first-click flash less jarring.
**Mitigation in the plan:** Sub-phase C item 2 mentions "active tab persists to URL hash" — also persist fetched data so refresh / direct deep-link works. Sub-phase D loading skeletons.

### Risk G — Linked dispute_events row created for NMI but never reconciled

**Sub-phase:** B
**What could go wrong:** NMI compile creates a `dispute_events` row server-side with `processor='nmi'` and `stripe_dispute_id=NULL`. The merchant later realizes the chargeback details were wrong (wrong amount, wrong contact) and edits the defense_packet — but the linked dispute_events row stays stale. Or the merchant withdraws the defense (`lifecycle_status='withdrawn'`) but the dispute_events row still says `status='needs_response'`.
**Blast radius:** NMI chargeback ratio accuracy. Stale dispute_events skew the ratio.
**Fix-forward:**
- On `recordOutcome` with `outcome='withdrawn'`, also update the linked `dispute_events.status` (map to `warning_closed` — closest existing value — or add a `'withdrawn'` value to `dispute_events.status` CHECK in Sub-phase A migration).
- For NMI rows, the source of truth IS the defense_packet. The dispute_events row is a derived projection. If they drift, prefer the defense_packet. Edit endpoint should always update both.
- Document this invariant in the daily health check job: "for NMI dispute_events rows, the upstream is defense_packets — drift is a bug."
**Mitigation in the plan:** Sub-phase B item 4 (NMI ratio query) verifies the projection logic. Sub-phase B item 1 outcome endpoint explicitly handles the dispute_events propagation including `withdrawn`.

### Risk H — `defense_letter_versions` insert race during rapid regenerate clicks

**Sub-phase:** B
**What could go wrong:** merchant double-clicks Regenerate, two server-side inserts race for the next `version_number`. UNIQUE constraint on `(defense_packet_id, version_number)` prevents duplicate rows but the second insert throws a constraint violation that surfaces as "An unexpected error occurred."
**Blast radius:** rare, only on rapid double-clicks. Cosmetic at most.
**Fix-forward:**
- Compute `version_number` server-side using `SELECT MAX(version_number) FROM defense_letter_versions WHERE defense_packet_id = ...` then insert. Wrap in a transaction OR retry once on constraint violation with a fresh max query.
- Frontend disables the Regenerate button while the request is in flight (existing pattern from other modals).
**Mitigation in the plan:** Sub-phase B item 1 — both backend retry and frontend button-disable. Low-impact issue.

## 8. Validation Questions (Phase 4) — to be drafted

To be expanded in Phase 4. Will likely include:

- How do we test AI letter quality without filing a real chargeback? (Answer hint: regression fixtures from Sub-phase A — Risk A mitigation.)
- What's the worst-case content failure mode? (Answer hint: a letter that confidently states a wrong fact that contradicts evidence we DO have. Mitigate by mandating exhibit citations for every factual claim.)
- How do we ensure the bundled PDF doesn't exceed processor upload size limits? (Risk C — already addressed in §7.)
- How do we verify the AI letter was actually accurate after the merchant submits and waits 30-90 days for the bank decision? (Answer hint: outcome data feeds back via `recordOutcome`, win rate per reason code becomes the long-run quality signal.)
- What happens when a merchant tries to edit the letter after Submit? (Answer: blocked by `lifecycle_status !== 'submitted'` guard. Confirm by attempting it in PMG.)
- What happens if the bundled PDF generation fails mid-compile? (Answer: defense_packet still has the AI letter text. PDF download button shows "PDF generation failed — retry" with a button that calls `POST /api/defense/:id/rebundle`.)
- What happens if a merchant disconnects from NMI/Stripe between compile and submit? (Answer: addressee doesn't change, submission is manual anyway, no impact. The processor field on the dispute_event row is frozen.)
- Mobile usability — can the merchant compile and submit a defense from their phone? (Sub-phase D mobile test.)
- Does the `<iframe>` PDF preview work on mobile Safari? (Risk B — mobile is the most likely failure surface.)
