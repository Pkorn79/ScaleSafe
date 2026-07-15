# ScaleSafe Reviewer Snapshot Inventory

Read-only inventory of the GHL `ScaleSafe` reviewer sub-account after the Marketplace app and attached Snapshot were installed.

## Environment Boundary

- Reviewer sub-account: `ScaleSafe`
- GHL location: `BxiqLzUf4Rh5GXR6DUZ3`
- Role: clean Marketplace-review and future provisioning-certification environment
- Internal regression account: PMG Merchant Consulting
- Excluded account: Vine & Branch
- Inspection dates: 2026-07-14 inventory; 2026-07-15 SSO regression

ScaleSafe is installed successfully in this location. On July 15 the installed Custom Page completed trusted location-bound SSO and loaded an empty tenant-isolated dashboard with zero offers, clients, evidence records, or recovered value. PMG data did not appear. The earlier `SSO handshake timed out` result is retained in the historical certification ledger but is no longer the current reviewer state. Do not uninstall/reinstall this valid installation as a troubleshooting shortcut.

## Installed Workflow Inventory

The `ScaleSafe` workflow folder contains 29 visible workflows: 26 published and 3 draft. Every workflow currently reports zero enrollments, which is expected in the clean reviewer account.

| Workflow | Status |
|---|---|
| SS - Cancellation Acknowledgment | Published |
| SS - Chargeback Alert | Published |
| SS - Chargeback Ratio Critical | Published |
| SS - Chargeback Ratio Warning | Published |
| SS - Client Re-Engage | Published |
| SS - Defense Deadline Reminder (3 days) | Draft |
| SS - Defense Ready | Published |
| SS - Enrollment Packet Workflow | Published |
| SS - Enrollment Payment Receipt | Published |
| SS - Evidence Milestone Celebration | Published |
| SS - Milestone Sign-Off Confirmation | Published |
| SS - Milestone Sign-Off Request | Published |
| SS - Module Completion | Published |
| SS - No-Show Follow-Up | Published |
| SS - Payment Failed - Escalation | Published |
| SS - Payment Failed - First Attempt | Published |
| SS - Post Payment Actions | Draft |
| SS - Program Completion | Published |
| SS - Re-Engagement Outreach | Published |
| SS - Recurring Payment Reciept | Published |
| SS - Refund Processed | Published |
| SS - Send Enrollment Link Delivery | Published |
| SS - Session Follow-Up | Published |
| SS - Session Reminder | Draft |
| SS - Subscription Paused | Published |
| SS - Subscription Resumed | Published |
| SS - Welcome Sequence | Published |
| SS- Payment Reminder | Published |
| SS--Pulse-Check-Cadence | Published |

The legacy-named `SS--Pulse-Check-Cadence` workflow is not the obsolete timer/tag implementation in this reviewer install. Its live editor shows:

- Trigger: `ScaleSafe App Event`
- Filter: `Event Type is "Pulse Check Due"`
- Action: Email
- State: Published

Functionally, it is the required beta pulse workflow. Renaming it to `SS - Pulse Check Due` would reduce setup confusion, but creating a second workflow would risk duplicate sends.

The nested `WF-SYS2` and `Evidence Logger System` folders are also present. Their purpose and contents must be reconciled before the Snapshot is repackaged.

## Installed Funnel Inventory

No domain is connected, so GHL disables the funnel URLs until a reviewer/test subdomain is configured.

| Funnel | Steps |
|---|---|
| Client Facing Forms | Milestone Signoff; Session Feedback; Module Completion; SYS2-09 Monthly Pulse; Payment Update; Cancellation; terms; New Lead A2P |
| Client Onboarding | Client Welcome; Details; Clauses; Payment; complete |
| MileStone Sign off | Milestone Sign Off |

The duplicate milestone surface and the A2P/legacy-named steps require an owner review before repackaging. Do not delete them from PMG merely because they should not ship in the clean Snapshot.

## Installed Form Inventory

The Snapshot installed 27 forms across three folders.

### Client Onboarding Forms

- Client funnel - Submit pg 3
- Interested Client Form for A2P - tweak this for your own use

### Evidence Collection Forms

- Form 2A: Session Log
- SS-Module-Progress
- SYS2-02: Evidence Export
- SYS2-06: Milestone Sign-Off
- SYS2-07: Session Feedback
- SYS2-08: Module Completion
- SYS2-09: Monthly Pulse
- SYS2-10: Payment Update
- SYS2-11: Cancellation

### Merchant Onboarding Funnel Forms

- Branding & Service Delivery
- Merchant onboarding funnel - branding step
- Merchant Onboarding Funnel - business basics
- Merchant Onboarding Funnel - click wrapped clauses
- Merchant Onboarding Funnel - Clickwrap section
- Merchant Onboarding Funnel - Custom Clauses
- Merchant Onboarding Funnel - Evidence Modules
- Merchant Onboarding Funnel - Milestone setup
- Merchant Onboarding Funnel - T&C source
- Merchant onboarding funnel - terms and conditions
- Offer Builder
- Onboarding Funnel: Key Clauses
- Onboarding Funnel: New Client Onboarding
- Onboarding Funnel: Payment - NMI
- ScaleSafe - New Offer Configuration
- SYS2-01: Merchant Onboarding

The current beta plan explicitly excludes obsolete SYS2-01, SYS2-02, SYS2-06, old model-specific onboarding forms, and duplicate V1 assets. Their presence is tracked in FIND-073.

## Fields, Values, and Business Setup

- Custom fields: 160 total; 144 Contact, 10 Opportunity, 0 Business, and 6 in other object categories.
- Custom values: 22 total.
- The required webhook-secret custom value exists and is populated. Its value is intentionally excluded from this document and must never appear in screenshots, guides, or support messages.
- Merchant-specific custom values are largely blank before ScaleSafe Merchant Setup runs.
- No domain is connected.
- Business legal name, business email, currency, business type, and industry are not yet completed in GHL.

This validates the setup order:

1. Marketplace app and Snapshot install.
2. Complete the merchant's GHL business profile and connect the test/client subdomain.
3. Open ScaleSafe and complete `Settings > Merchant Setup`.
4. Run `Settings > Provisioning Health`.
5. Repair only items proven missing.
6. Verify workflow subscriptions and run the smoke certification.

## Before Marketplace Submission

- Reconfirm the installed Custom Page completes location-bound SSO after the final Snapshot is repackaged; do not reinstall this account as a diagnostic shortcut.
- Finish the production health soak and off-platform recovery proof documented in `OPEN_REMEDIATION_REGISTER.md`.
- Decide which three draft workflows belong in beta and document that decision.
- Rebuild the Snapshot from a clean V2 source so obsolete forms/folders do not ship.
- Preserve only one pulse workflow using the verified app-event/filter contract.
- Export and approve the exact least-privilege Marketplace scope list. The current draft reports 29 selected scopes and still includes capabilities previously identified as stale, including Products and Opportunities.
- Connect a reviewer/test domain.
- Complete merchant business/setup values, then run Provisioning Health.
- Reinstall the rebuilt Snapshot into a separate scratch sub-account before replacing this reviewer environment.
