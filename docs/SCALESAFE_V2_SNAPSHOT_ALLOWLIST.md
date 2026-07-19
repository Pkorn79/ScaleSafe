# ScaleSafe V2 Snapshot Allowlist

**Status:** Certified clean post-review Snapshot package  
**Source of truth:** Current application code, trigger contracts, PMG workflow contracts, and the installed reviewer inventory  
**Packaging rule:** Nothing ships unless it appears below or is an unavoidable GHL dependency of an approved asset.

## Isolated Build Accounts

- Snapshot source: `ScaleSafe Snapshot Source`
- GHL location ID: `v2gyDbuTLoUWZccwuuFq`
- Created from the current `ScaleSafe` Snapshot with sample data disabled.
- Purpose: build and refresh the clean V2 package without modifying PMG, the ScaleSafe reviewer account, or the Marketplace version currently under review.
- Marketplace attachment remains unchanged until the clean package passes the scratch-install certification gate below.

## Certified Package

- Snapshot name: `ScaleSafe V2 Clean Certified 2`
- Snapshot ID: `uaDpnwOK1ikPkjI14i96`
- Source sub-account: `ScaleSafe Snapshot Source` (`v2gyDbuTLoUWZccwuuFq`)
- Certification sub-account: `ScaleSafe V2 Certification Final` (`TwFLyWtJSjzY9KdULPIu`)
- Certified on: July 19, 2026
- Snapshot load history: completed successfully for one sub-account with zero failed or pending loads.
- Certified package count: 32 assets total.
- Workflow count: 26 approved workflows, with no missing or extra workflows.
- Form count: 5 approved evidence forms.
- Funnel count: 1 `Client Onboarding` funnel with 5 steps.
- Custom fields and custom values in Snapshot: 0. ScaleSafe provisioning remains responsible for the 90 managed fields and 21 managed values.

The original Marketplace-attached `ScaleSafe` Snapshot was not modified during this build. `ScaleSafe V2 Clean Certified` without the trailing `2` is a superseded test package that contained only one workflow and must not be attached to the Marketplace app.

## Package Boundary

The Snapshot provides the GHL-native workflows, forms, and funnel assets that ScaleSafe cannot reliably create through the API. ScaleSafe provisioning remains responsible for merchant records, secrets, payment-provider registration, managed custom fields, managed custom values, and trigger subscriptions.

The clean package must not contain PMG contacts, opportunities, payments, calendars, merchant credentials, processor settings, historical test data, or merchant-specific branding.

## Approved Workflows

Package these 26 published workflows:

1. `SS - Cancellation Acknowledgment`
2. `SS - Chargeback Alert`
3. `SS - Chargeback Ratio Critical`
4. `SS - Chargeback Ratio Warning`
5. `SS - Client Re-Engage`
6. `SS - Defense Ready`
7. `SS - Enrollment Packet Workflow`
8. `SS - Enrollment Payment Receipt`
9. `SS - Evidence Milestone Celebration`
10. `SS - Milestone Sign-Off Confirmation`
11. `SS - Milestone Sign-Off Request`
12. `SS - Module Completion`
13. `SS - No-Show Follow-Up`
14. `SS - Payment Failed - Escalation`
15. `SS - Payment Failed - First Attempt`
16. `SS - Program Completion`
17. `SS - Re-Engagement Outreach`
18. `SS - Recurring Payment Reciept`
19. `SS - Refund Processed`
20. `SS - Send Enrollment Link Delivery`
21. `SS - Session Follow-Up`
22. `SS - Subscription Paused`
23. `SS - Subscription Resumed`
24. `SS - Welcome Sequence`
25. `SS- Payment Reminder`
26. `SS--Pulse-Check-Cadence`

`SS--Pulse-Check-Cadence` is the one approved pulse workflow despite its legacy name. It must use the `ScaleSafe App Event` trigger filtered to `Event Type = Pulse Check Due`. Do not package a second pulse workflow.

## Deferred Workflow Templates

Do not activate or package these in the beta Snapshot until separately certified:

- `SS - Defense Deadline Reminder (3 days)`
- `SS - Post Payment Actions`
- `SS - Session Reminder`

## Approved Evidence Forms

Package only:

1. `SYS2-07: Session Feedback`
2. `SYS2-08: Module Completion`
3. `SYS2-09: Monthly Pulse`
4. `SYS2-10: Payment Update`
5. `SYS2-11: Cancellation`

Each form workflow must post to `https://dashboard.scalesafe.app/webhooks/ghl/forms`, pass the merchant webhook secret, and include a resolvable contact plus `enrollment_id` whenever available.

## Approved Funnel

Package the current `Client Onboarding` funnel and its required dependencies only. The expected steps are:

1. Client Welcome
2. Details
3. Clauses
4. Payment
5. Complete

The installed scripts must load ScaleSafe's current location-bound widgets and preserve `offerId`, paid-enrollment context, and evidence-context parameters.

Do not package the obsolete `MileStone Sign off` funnel. Do not package unrelated A2P or merchant-onboarding funnels. Include a client-facing evidence page only when one of the five approved evidence forms requires it and the page has been verified against the current app-owned action-link contract.

## Managed Custom Fields

The approved field contract is exactly `BETA_CUSTOM_FIELD_REGISTRY` in `src/constants/ghl-fields.ts`:

- 6 ScaleSafe status fields.
- 7 canonical offer fields.
- 6 workflow-compatible offer fields.
- 18 payment/refund fields.
- 4 pulse fields.
- 5 milestone/signoff fields.
- 3 defense fields.
- 3 session/evidence fields.
- 22 clause-slot fields.
- 16 milestone-slot fields.

Total: **90 managed custom fields**.

The app provisions and repairs these fields. If GHL requires them as workflow dependencies, package only these 90. Do not package old model-specific, Accept.blue, Make.com, opportunity, or unused SYS2 fields.

## Managed Custom Values

Package or allow ScaleSafe to provision only the 21 values in `CUSTOM_VALUE_REGISTRY`:

- Business Legal Name
- DBA / Brand Name
- Merchant Support Email
- Merchant Descriptor
- Business Website
- Business City
- Business State
- Industry / Niche
- Primary Service Type
- SS Merchant Logo URL
- Short Business Description
- TC Has Own
- TC Document URL
- Website Base URL
- Module Session Tracking
- Module Milestone Tracking
- Module Pulse Check
- Module Payment Tracking
- Module Course Progress
- ScaleSafe Webhook Secret
- ScaleSafe Pulse Workflow Webhook URL

Secret values must be blank in the Snapshot and populated by provisioning.

## Conditional Dependencies

Include only when an approved workflow or funnel references them:

- ScaleSafe email templates.
- The ScaleSafe contact-detail view.
- Form/funnel dependencies automatically selected by GHL.

Do not package a PMG design kit or merchant-specific branding.

## Explicit Exclusions

- `SYS2-01: Merchant Onboarding`
- `SYS2-02: Evidence Export`
- `SYS2-06: Milestone Sign-Off`
- Model-specific agency, coaching, or course onboarding forms/workflows.
- `WF-SYS2` legacy workflow folders.
- `Evidence Logger System` duplicates that are not one of the approved workflows.
- Make.com, Google Sheets, or Drive evidence-export automation.
- Accept.blue fields, values, workflows, or payment assets.
- Old tag/timer pulse workflows.
- Offers Custom Object.
- Client Milestones pipeline.
- GHL products/prices copied from PMG.
- Calendars, appointment calendars, courses, memberships, campaigns, opportunities, contacts, conversations, or test records.
- A2P lead forms.
- PMG domains, email services, phone settings, processor credentials, or business branding.

## Certification Gate

Before the package replaces the attached Marketplace Snapshot:

1. Install it in a new scratch sub-account.
2. Confirm the allowlisted asset counts and names.
3. Confirm no excluded asset is present.
4. Install ScaleSafe and complete location-bound SSO.
5. Run Merchant Setup and Provisioning Health.
6. Verify all 20 Marketplace trigger subscriptions expected by the current trigger registry.
7. Verify enrollment link, receipt, welcome, milestone, pulse, refund, and defense-ready workflows.
8. Confirm a full enrollment and quick checkout remain tied to the correct tenant and enrollment.
9. Confirm no PMG data or merchant-specific value appears.
10. Refresh the existing Marketplace-attached Snapshot only after this scratch certification passes.

## Refresh Procedure

1. Make and test approved GHL asset changes in PMG.
2. Move only the approved change into `ScaleSafe Snapshot Source`.
3. Reconfirm the source account contains the exact workflow, form, and funnel allowlists above.
4. Create or refresh the clean Snapshot using exact asset selections.
5. Confirm the load screen reports exactly:
   - `Workflow (26/26)`
   - `Forms (5/5)`
   - `Funnels & Websites (1/1)`
   - 32 total linked assets
   - 0 custom fields and 0 custom values
6. Push the package to a new scratch sub-account with sample data disabled.
7. Confirm all 26 workflow names, all 5 form names, and the 5 funnel steps.
8. Confirm the Snapshot load history is completed with no failed or pending sub-accounts.
9. Only after certification, refresh or replace the Marketplace-attached Snapshot.

Do not search for and select the generic word `Workflow` in GHL's Snapshot builder. That search matches `SS - Enrollment Packet Workflow` as one asset; it does not select the workflow category. Select the 24 workflows matching `SS -`, then select `SS- Payment Reminder` and `SS--Pulse-Check-Cadence` separately, or select all 26 exact names individually.
