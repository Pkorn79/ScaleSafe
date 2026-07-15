# ScaleSafe Controlled Beta Launch Checklist

Reconciled: 2026-07-15 CDT
Deployed SHA: `a04205c2b90b3cb99410d4396bb666faf193c007`
Production schema: `101`
Detailed current status: `docs/user-guide/OPEN_REMEDIATION_REGISTER.md`

This checklist is for the first controlled beta merchant and the GoHighLevel Marketplace review package. Historical findings remain in the certification ledger; fixed items are not repeated as open work here.

## 1. Hard Launch Gates

- [ ] **Encrypted recovery is proven.** Create one off-platform encrypted database and private-Storage snapshot, verify its completion marker and hashes, and complete one isolated scratch restore. Supabase managed backups alone do not satisfy this gate.
- [x] **Production health soak is complete.** From 2026-07-15 4:46:45 PM through 5:47:42 PM CDT, Railway recorded 134 HTTP requests, zero 4xx/5xx, zero requests over three seconds, a 1.536-second maximum, and zero application warning/error lines. Ten closing `/health` probes all reported app/Supabase/schema `ok`.
- [ ] **Reviewer Snapshot is clean.** Certify the approved V2 asset allowlist in the dedicated `ScaleSafe` GHL sub-account; obsolete SYS2/model-specific/duplicate assets are absent or explicitly removed from the submitted Snapshot.

## 2. Marketplace Submission Package

- [ ] Record the end-to-end video: install, connect, create/use an offer, client enrollment, payment, evidence, and defense review.
- [ ] Record the scope video: show each retained GHL scope in actual use and explain the data boundary.
- [ ] Provide reviewer GHL credentials through the Marketplace form, never the repository.
- [ ] Confirm the reviewer user can access all beta-review features without agency-owner privileges that a normal merchant would not have.
- [ ] Paste the reviewer notes and exact test script from `docs/user-guide/REVIEWER_TEST_SCRIPT.md`.
- [ ] Export and save the final least-privilege Marketplace scope list and explanations.
- [ ] Confirm the attached Snapshot is the certified V2 Snapshot, not a PMG development snapshot.
- [ ] Deploy the prepared public help/legal pages and confirm privacy, terms, support, guide, FAQ, and troubleshooting URLs serve their own content without authentication. Current live paths return `200` but fall back to the generic landing page.

## 3. Production Environment And Schema

- [x] `NODE_ENV=production` in Railway.
- [x] `PROCESSOR_ENCRYPTION_KEY`, `PUBLIC_ACTION_TOKEN_SECRET`, Stripe secrets, Supabase service key, GHL app credentials, and Turnstile keys are present in Railway.
- [x] `ALLOW_LEGACY_PUBLIC_ACTION_LINKS` is absent/false.
- [x] Supabase is on Pro and managed daily backups are enabled with seven-day retention.
- [x] Production schema RPC reports version `101`.
- [x] `/health` currently reports app, Supabase, and schema `ok`.
- [ ] Confirm `VITE_ENABLE_DAILY_TEST_BILLING` is disabled before live merchant billing begins. It may remain enabled only while the documented daily test cycle is intentionally running.
- [ ] Confirm Stripe is in the intended environment for the reviewer account and live processing is not accidentally enabled for review tests.

## 4. Processor And Money Safety

- [x] Stripe paid-in-full checkout records one payment, enrollment, consent packet, receipt, and welcome delivery.
- [x] Stripe finite recurring test completed the exact two-payment schedule at the full amount, with a one-time add-on charged only on payment one and no next billing after payment two.
- [x] Stripe recurring receipt payload names the exact enrollment and payment number.
- [x] Stripe and NMI refunds have passed live tests.
- [x] Whop hosted checkout, PIF/installment choice, add-on capture, QMS pay-first consent, and refund lifecycle have live proof in PMG.
- [x] Durable money-operation and refund claims protect duplicate processor calls.
- [x] Checkout amounts are server-recalculated and processors receive integer cents.
- [ ] Certify the NMI official signed/verified webhook callback for every NMI configuration offered in beta.
- [ ] If saved-method NMI charging is in beta scope, prove one fresh method displays the authorized last four before an owner-approved charge.
- [ ] After the current branch deploys, prove a dual-option Quick Checkout paid-in-full selection creates no recurring enrollment or subscription.

## 5. GHL Installation And Workflows

- [x] PMG and the dedicated reviewer sub-account complete trusted, location-bound SSO.
- [x] The reviewer sub-account shows tenant-isolated empty data rather than PMG records.
- [x] Enrollment link, payment receipt, welcome, upcoming payment reminder, pulse, milestone, and milestone-signoff paths have live proof.
- [x] Deleted GHL trigger subscriptions are automatically deactivated after a terminal GHL response.
- [x] Pulse app-event delivery, workflow execution, URL/interval fields, client submission, evidence, and dashboard follow-up state have been observed.
- [ ] Confirm pause/resume/cancel email templates render scalar program and lifecycle fields, never `[object Object]`.
- [ ] Run Provisioning Health in the final reviewer Snapshot and save sanitized proof.
- [ ] Confirm exactly one app-event pulse workflow and no competing tag/timer cadence workflow.
- [ ] Complete one harmless enrollment-linked direct message after the current fix and verify the GHL echo remains on the selected enrollment.

## 6. Evidence, Connectors, And Defense

- [x] Enrollment consent, payment, communication, appointment, milestone, signoff, and pulse evidence are enrollment-scoped when a defensible exact match exists.
- [x] Ambiguous contact activity remains client-level and is excluded from exact-enrollment defense packets.
- [x] GHL appointment evidence distinguishes scheduled engagement from attended/completed delivery.
- [x] Evidence Connections history loads with source, event state, client/program target, and match method.
- [x] Zoom OAuth is tenant-isolated and health separates authorization, observed event, and published evidence.
- [ ] Prove one real non-host Zoom participant event publishes once to the correct enrollment before calling Zoom attendance certified.
- [x] Defense regeneration runs in the background, preserves the selected transaction, and stays `needs_review` when delivery proof is absent.
- [x] A `needs_review` packet does not fire `ss_defense_ready`.
- [x] Current defense output identifies evidence gaps, includes pulse follow-up facts, and does not assert service delivery that was not proved.
- [ ] After the current branch deploys, verify local/manual defense rows do not appear in Stripe Active Disputes.

## 7. Reviewer Documentation

- [x] Working merchant guide exists at `docs/user-guide/README.md`.
- [x] FAQ exists at `docs/user-guide/FAQ.md`.
- [x] Workflow reference exists at `docs/user-guide/WORKFLOW_REFERENCE.md`.
- [x] Deep test protocol exists at `docs/user-guide/DEEP_DIVE_TEST_PLAN.md`.
- [x] Reviewer test script, installation guide, and troubleshooting guide are complete.
- [ ] Complete the sanitized screenshot set using `docs/user-guide/REVIEWER_ASSET_MANIFEST.md`; PMG engineering captures are not submission assets.
- [ ] Ensure screenshots contain no real client PII, card/bank data, processor secrets, webhook secrets, access tokens, or signed private-file URLs.
- [x] Public claims use “reduce chargebacks” and “organize evidence,” not guaranteed prevention or guaranteed wins.

## 8. Engineering Release Checks

- [x] `git diff --check` passes.
- [x] `npm run typecheck` passes.
- [x] `npm test -- --runInBand` passes: 164 suites and 1,346 tests.
- [x] `npm run build` passes.
- [x] `npm audit --omit=dev` reports zero production vulnerabilities.
- [x] Tracked-tree secret scan passes; `.env`, `scripts/.dbpass`, temporary evidence exports, and recovery credentials remain untracked/ignored.
- [ ] CI is green for the exact release SHA.
- [x] Changelog describes the release changes; this branch requires no new migration.
- [ ] Railway deploys the intended SHA and rollback to the preceding known-good deployment is recorded.

## 9. Controlled-Beta Owner Decisions

- [ ] Protect `main` and require green CI/owner approval, or record a temporary controlled-beta exception with rollback proof.
- [ ] Confirm whether the GitHub repository should remain public.
- [ ] Accept the measured Railway `us-west2` to Supabase `us-east-1` topology for controlled beta or schedule regional alignment.
- [ ] Explicitly list beta-supported processor actions and keep unsupported/deferred controls hidden.
- [ ] Keep FanBasis disabled until provider approval and separate certification.

## Launch Decision

ScaleSafe is a **NO-GO for the first real beta merchant** while any item in Section 1 remains open. Marketplace submission also requires Sections 2 and 7. Other unchecked items require completion or a written owner-approved controlled-beta exception before launch.
