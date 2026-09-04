# ScaleSafe Beta Closeout Execution Plan

Date: July 14, 2026

## Goal

Reach a controlled beta state with reliable core payment and evidence paths, truthful UI status, a reproducible GHL reviewer account, and proven recovery. This is not a requirement to finish every roadmap item before beta.

## Completed in the Current Cleanup

- Removed stale merchant-facing `Coming Soon`, old beta, and roadmap-preview treatment from working features.
- Rebuilt the Roadmap so it contains future work only.
- Hid unreleased integrations and FanBasis controls from normal merchant setup surfaces.
- Relabeled workflow importance as Required, Recommended, or Optional instead of exposing internal beta-priority language.
- Corrected Whop offer processor labels.
- Prevented stale, completed, paused, or billing-broken plans from supplying the dashboard's next-payment date.
- Separated scheduled installment progress from order bumps and upgrades in client payment display.
- Added focused regression tests for recurring-payment visibility and processor labels.
- Added the encrypted off-platform database and Storage backup toolkit under `ops/recovery`.

## Deliberately Deferred

- Dashboard Attention Center with dismissible Defense, Pulse, and Milestone tabs.
- Scheduled milestone delivery windows and dashboard milestone completion actions.
- FanBasis checkout until provider account approval and certification.
- Named evidence integrations beyond currently released connections.
- Program-level evidence readiness scoring and Pulse follow-up alerts.

These remain roadmap items. They are not represented as available beta functionality.

## Codex Execution Queue

### 1. Verify and Deploy This Cleanup

- Run the complete unit test suite, typecheck, and production build.
- Review the final diff for unrelated-file contamination.
- Commit only the roadmap, payment-display, recovery, and closeout files from this batch.
- Push and allow Railway to deploy.
- Inspect Railway deploy and HTTP logs for build/runtime regressions.

### 2. Live UI Verification

- Confirm Roadmap shows only future work.
- Confirm Settings has no stale preview cards or internal beta-priority labels.
- Confirm Offers does not show FanBasis until it is released.
- Confirm Evidence Connections shows only native, connected, or presently connectable providers.
- Confirm Whop offers identify Whop rather than Default.
- Confirm a completed or stale recurring plan does not become the client's Next Scheduled Payment.
- Confirm order bumps and upgrades appear as checkout extras rather than installment principal.

### 3. Reviewer and Training Package

- Finish the end-to-end user guide and FAQ from the verified interface.
- Produce a GHL reviewer test script with exact expected results and no NMI dependency.
- Keep the fresh `ScaleSafe` GHL sub-account distinct from the internal `PMG Merchant Consulting` development account.
- Capture screenshots only after the cleanup deploy is visually verified.
- Create the video shot list for installation, connection, offer setup, enrollment, payment, evidence, and defense.

### 4. Targeted Live Smoke Proof

- GHL install and SSO in the `ScaleSafe` reviewer sub-account.
- Stripe sandbox full checkout, quick checkout, and QMS.
- Enrollment link, consent, receipt, welcome, milestone, Pulse, evidence, and defense packet.
- Whop checkout and lifecycle only where the provider test account supports it.
- No NMI charge without the owner's explicit low-dollar test approval.
- Review Railway logs after each workflow, not only the browser result.

### 5. Recovery Certification

- Guide the owner through the off-site bucket, age key, Supabase S3 credential, and VPS setup.
- Run the first encrypted snapshot.
- Verify backup age and completion JSON.
- Restore one explicit snapshot into a brand-new disconnected Supabase scratch project.
- Compare critical row counts, Storage inventory, and sample PDF hashes.
- Record proof and only then close the recovery blocker.

## Owner-Only Actions

- Create or approve the separate off-site storage account and immutable retention policy.
- Generate and physically retain the offline age private identity.
- Generate production and scratch Supabase S3 credentials when prompted.
- Confirm reviewers install ScaleSafe in their own HighLevel test sub-account and enter through GHL SSO; do not supply shared GHL credentials.
- Record the Marketplace installation/end-to-end video and scope-justification video.
- Submit the Marketplace publication request.
- Decide when Stripe moves from reviewer sandbox operation to live merchant onboarding.
- Approve any live NMI charge/refund test and final merchant-facing legal/marketing claims.

## Beta Blockers

- No valid encrypted off-platform backup plus verified scratch restore.
- Cross-tenant installation or SSO ambiguity.
- Duplicate or incorrect money movement.
- A core processor path that cannot reconcile payment state.
- Enrollment, evidence, or defense attached to the wrong client/program.
- Required GHL workflows lacking live proof.
- Reviewer account cannot complete the documented Stripe sandbox journey.

## Non-Blocking Beta Items

- Future dashboard attention layout.
- Broader integration catalog waves.
- Advanced outcome analytics.
- Further visual polish that does not obscure state or block a workflow.
- Automated Guardian reporting after deterministic backup proof exists.

## Controlled Beta Exit Test

ScaleSafe is ready for its first controlled beta merchant when all beta blockers above have proof, the reviewer account follows the published runbook, the latest deployment is green, the backup health check is current, and every known limitation is either fixed or explicitly excluded from the beta offer.
