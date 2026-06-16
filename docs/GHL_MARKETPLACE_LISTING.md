# ScaleSafe - GoHighLevel Marketplace Listing

> Marketplace submission source of truth. This copy is evidence-first and private-beta
> oriented. Do not submit until the live GHL Marketplace app scopes, legal URLs,
> screenshots, and Philip's final copy approval are complete.

---

## App identity

- **App name:** ScaleSafe
- **Tagline (<= ~60 chars):** Build the evidence trail before the dispute happens.
- **Category:** Payments / Finance
- **Secondary category:** Sales & CRM tooling
- **GHL Pricing setting:** Free for beta. Do not create billing meters or paid/freemium plans until Philip approves Marketplace-managed billing.
- **Business note:** Private beta / contact for access.
- **Powered by:** Whole Pay - https://getwholepay.com

## Short description (~140 chars)

> Evidence-ready payments and client records for high-ticket GoHighLevel businesses.
> Capture consent, payment, delivery, and refund proof before disputes happen.

## Long description

ScaleSafe helps high-ticket coaches, consultants, agencies, and service businesses
build the evidence trail they need before a payment dispute happens.

Instead of scrambling through inboxes, contracts, screenshots, and CRM notes after a
chargeback lands, ScaleSafe captures the key proof points throughout the client
lifecycle: offer terms, click-wrap consent, payment events, enrollment status,
communications, delivery milestones, pulse check-ins, refunds, and cancellation
activity.

When a dispute or early-fraud warning needs attention, ScaleSafe organizes those
records into a structured defense workflow so the merchant can respond with cleaner
documentation and less manual digging.

ScaleSafe is powered by Whole Pay and runs inside GoHighLevel. It works with the
merchant's own connected Stripe or NMI account. Payments settle directly to the
merchant's processor account; ScaleSafe does not hold funds.

**What you get**

- Timestamped evidence capture across the client lifecycle
- Click-wrap consent and purchase-summary records for enrollment flows
- Payment, refund, recurring, and card-on-file visibility for Stripe and NMI
- Client evidence timelines with communications, milestones, pulse check-ins, and delivery proof
- Defense packet workflows for disputes and early-fraud warnings
- GoHighLevel workflow triggers for receipts, enrollment links, welcome/access, refunds, failed payments, reminders, and app events
- Merchant-facing dashboards for clients, offers, payments, evidence, and defense activity

## Key features

1. **Evidence timeline** - capture consent, payment, communication, delivery, refund, and cancellation records in one place.
2. **Defense workflow** - organize the evidence a merchant needs when a dispute or early-fraud warning appears.
3. **Processor-direct payments** - use connected Stripe or NMI accounts; ScaleSafe does not hold merchant funds.
4. **Recurring payment visibility** - track installment/subscription progress, payment reminders, refunds, pauses, resumes, and cancellations.
5. **Native GHL workflow automation** - fire purpose-built Marketplace triggers for receipts, enrollment links, welcome/access, refunds, failed payments, and app events.

## App permissions / scope review note

External Authentication should remain OFF. ScaleSafe does not use a separate third-party OAuth step during GHL app installation.

The selected GHL app permissions/scopes still matter for review, but they do not need to be turned into a public listing section unless HighLevel specifically asks for permission justifications during review.

If HighLevel asks for permission/scope justifications, copy the exact selected names from the live Marketplace app configuration and use this working table:

| Live GHL scope | Why ScaleSafe needs it |
|---|---|
| Copy exact selected scope only if GHL asks | Read and update the installed location so ScaleSafe can provision merchant settings, custom values, and workflow-ready records. |
| Copy exact selected scope only if GHL asks | Read and update contacts so ScaleSafe can attach offers, enrollment/payment fields, evidence status, and workflow context to the right client. |
| Copy exact selected scope only if GHL asks | Read custom fields/custom values so ScaleSafe can verify provisioning health and keep workflow merge fields mapped. |
| Copy exact selected scope only if GHL asks | Register and execute Marketplace workflow triggers used for receipts, enrollment links, welcome/access, payment failures, refunds, chargebacks, and app events. |
| Copy exact selected scope only if GHL asks | Read relevant CRM activity such as conversations, appointments, notes, tasks, opportunities, and invoice events for evidence timelines where enabled. |

Remove any row that is not actually requested by the app.

## Screenshots / media plan

Capture screenshots with realistic, non-PII demo data. Use the same sample merchant,
offer, and test client across the set.

1. Dashboard / provisioning health showing the app is installed and workflow health is visible.
2. Offer setup showing checkout mode, pricing, terms, milestones, pulse cadence, and add-ons.
3. Checkout or enrollment flow showing the client-facing purchase summary and consent/payment path.
4. Client evidence timeline showing consent, payment, communications, milestone, and pulse records.
5. Payments view showing recurring progress, saved payment method, and processor subscription ID.
6. Defense workflow showing a dispute/early-fraud warning packet or evidence assembly screen.

## Support & compliance

- **Support email:** support@scalesafe.app
- **Privacy policy URL:** https://scalesafe.app/privacy.html
- **Terms URL:** https://scalesafe.app/terms.html
- **Support / help URL:** https://scalesafe.app/support.html

## Pre-submission checklist

- [ ] Every feature claim verified against the live app.
- [ ] External Authentication remains OFF.
- [ ] If GHL review asks for permission/scope justifications, exact selected permissions/scopes are copied from the Marketplace app config and justified without changing app settings.
- [ ] Screenshots captured with non-PII sample data and approved by Philip.
- [ ] Privacy policy, terms, and support/help URLs hosted and linked.
- [ ] GHL Pricing is set to Free for beta; no billing meters or paid/freemium plans created unless Philip approves Marketplace-managed billing.
- [ ] Group B Stripe sandbox double-bill verification is passed or explicitly waived by Philip.
- [ ] Fresh install on a clean sub-account passes end-to-end.
- [ ] Philip signs off on final copy before submission.
