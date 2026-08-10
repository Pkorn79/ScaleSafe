# Marketplace Billing And Entitlements

This document is the operational source of truth for ScaleSafe's HighLevel Marketplace plans.

## Plans

| Marketplace plan | Price | Available processors | Eligibility |
| --- | ---: | --- | --- |
| ScaleSafe Test Access | Free | Stripe, Whop, and NMI | Marketplace review and approved beta testing |
| ScaleSafe Standard | $99/month | Stripe and Whop | Any approved ScaleSafe merchant |
| WholePay Approved Merchant | $59/month | Stripe, Whop, and NMI | Active NMI merchant account established through WholePay and verified by ScaleSafe HQ |

The $59 plan is conditional pricing, not a conventional upgrade or downgrade. A merchant cannot unlock it merely by choosing the cheaper plan in HighLevel.

Current HighLevel plan IDs:

- Test Access: `6a79e1a07f2a3778d481f0ad`
- Standard: `6a5aaf8e77d47a4f4f207bcb`
- WholePay: `6a5aafc2d91fdf0b8aace176`

The code contains these IDs as defaults. The optional Railway variables `GHL_MARKETPLACE_TEST_PLAN_ID`, `GHL_MARKETPLACE_STANDARD_PLAN_ID`, and `GHL_MARKETPLACE_WHOLEPAY_PLAN_ID` are needed only if HighLevel replaces the plan IDs.

## Enforcement

- HighLevel remains the source of truth for the installed Marketplace plan and paid app billing status.
- ScaleSafe HQ remains the source of truth for WholePay/NMI eligibility.
- Test Access grants full functionality without paid-billing enforcement for Marketplace review and approved beta locations.
- Standard permits new Stripe and Whop activity and blocks new NMI setup and charges.
- WholePay permits ScaleSafe access only after HQ approval, then permits Stripe, Whop, and NMI.
- A failed paid Marketplace subscription or an unknown plan fails closed.
- Installations that existed before Marketplace billing are marked `legacy` by migration 102 and remain fully enabled.
- Existing processor webhooks, recurring reconciliation, and processor-side subscription state continue running when interactive access is locked. The entitlement gate must never delete processor configuration or historical records.

The backend enforces processor capability. Disabled UI controls are explanatory only and are not the security boundary.

## WholePay Approval

1. Confirm the merchant selected the WholePay plan in HighLevel.
2. Confirm the merchant has an active NMI merchant account established through WholePay.
3. Open ScaleSafe HQ and select the merchant's exact GHL location.
4. Record the NMI/WholePay merchant reference and click **Approve WholePay Merchant**.
5. Reopen ScaleSafe from that sub-account and confirm NMI setup is available.
6. If eligibility ends, revoke approval in HQ and move the merchant to Standard in HighLevel. Revocation is audit logged.

Never approve the WholePay plan from a merchant-supplied location ID or NMI claim alone. Verify the exact tenant and processor account first.

## HighLevel Configuration

The Marketplace app must send these signed events to `https://dashboard.scalesafe.app/webhooks/ghl`:

- AppInstall
- AppUninstall
- PlanChange
- AppPaymentStatus

ScaleSafe reads `planId` on install/OAuth, `newPlanId` on PlanChange, and `newStatus` on AppPaymentStatus. HighLevel's signed webhook is authoritative; a browser request cannot select its own plan.

## Deployment Order

1. Apply `supabase/migrations/102_marketplace_entitlements.sql`, followed by `supabase/migrations/103_marketplace_test_access_plan.sql`.
2. Verify `select scalesafe_schema_version();` returns `103`.
3. Deploy the entitlement code.
4. Enable PlanChange and AppPaymentStatus in the HighLevel Marketplace app.
5. Test one Test Access location, one Standard location, and one unapproved WholePay location.
6. Approve the WholePay test location in HQ and certify NMI setup plus a small payment.
7. Confirm legacy PMG/reviewer locations still open and retain all existing processor behavior.

Do not deploy the code before the migration. Do not change a live merchant's Marketplace plan while a payment test is in progress.

## Required Proof

- Standard: app opens; Stripe and Whop remain available; NMI setup and new NMI charges are blocked by the backend.
- Test Access: app opens without a charge or paid-billing gate; Stripe, Whop, and NMI remain available.
- WholePay pending: app explains that HQ approval is required; no merchant data from another location is exposed.
- WholePay approved: app opens; Stripe, Whop, and NMI are available.
- Billing failed: app access is held with a billing-attention message.
- Plan change: the new plan appears in ScaleSafe after the signed HighLevel event.
- Existing subscription: processor webhooks and reconciliation continue without duplicate or deleted records.
