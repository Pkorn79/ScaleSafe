# ScaleSafe Marketplace Update Guide for Oke

Purpose: update the GoHighLevel Marketplace listing fields safely without changing anything that could break the ScaleSafe app.

Use this guide for Marketplace copy, screenshots, support URLs, and public-review prep only.

## Source of Truth

Use these ScaleSafe files as the copy source:

- Marketplace copy: `docs/GHL_MARKETPLACE_LISTING.md`
- Public site URLs:
  - `https://scalesafe.app`
  - `https://scalesafe.app/privacy`
  - `https://scalesafe.app/terms`
  - `https://scalesafe.app/support`
  - `https://scalesafe.app/guide`
  - `https://scalesafe.app/troubleshooting`

The listing positioning is:

> Build the evidence trail before the dispute happens.

ScaleSafe is powered by Whole Pay:

> https://getwholepay.com

## Access and Navigation

1. Log in to the HighLevel Marketplace developer portal:
   - `https://marketplace.gohighlevel.com`
2. Go to **My Apps**.
3. Open the existing **ScaleSafe** app.
4. You should see three main areas:
   - **Build**
   - **Manage**
   - **Insights**
5. For this task, work only inside:
   - **Build > Profile**
   - **Build > Pricing**
   - **Build > Advanced Settings > Auth** only for reading/copying existing scopes
   - Any public-review/listing configuration screen if HighLevel prompts for it

Do not create a new app. Do not delete the existing app. Do not create a new version unless Philip explicitly asks you to.

## Safe Update Areas

### Build > Profile

Update only listing/public-facing fields:

- App name
- Tagline
- Short description
- Long description
- Category
- Company/publisher name if required
- Support email
- Privacy Policy URL
- Terms URL
- Support URL
- Screenshots / preview images
- Logo/icon if Philip provides one

### Build > Pricing

Set pricing as:

> Private beta / contact for access

If the UI requires a marketplace pricing option and does not allow free text, stop and ask Philip before choosing. Do not invent a monthly price.

### Build > Advanced Settings > Auth

Use this screen only to copy the current OAuth scopes into the tracker or listing worksheet.

Do not add, remove, or change scopes.

Do not change redirect URLs.

Do not change OAuth settings.

## Do Not Touch

These settings can break installs, SSO, workflow triggers, or payments. Do not edit them.

- OAuth client ID
- OAuth client secret
- Shared secret
- Redirect URLs
- SSO URL
- App home URL
- Webhook URLs
- Trigger URLs
- Payment provider URLs
- External authentication settings
- Marketplace modules
- Installed app version
- App type
- Target user
- Who can install
- Any setting under **Manage > Secrets**
- Any setting under **Advanced Settings > Webhooks**
- Any setting related to custom payment provider behavior

If HighLevel forces you into one of these screens to continue, stop and message Philip.

## Copy to Use

### App name

ScaleSafe

### Tagline

Build the evidence trail before the dispute happens.

### Short description

Evidence-ready payments and client records for high-ticket GoHighLevel businesses. Capture consent, payment, delivery, and refund proof before disputes happen.

### Long description

ScaleSafe helps high-ticket coaches, consultants, agencies, and service businesses build the evidence trail they need before a payment dispute happens.

Instead of scrambling through inboxes, contracts, screenshots, and CRM notes after a chargeback lands, ScaleSafe captures the key proof points throughout the client lifecycle: offer terms, click-wrap consent, payment events, enrollment status, communications, delivery milestones, pulse check-ins, refunds, and cancellation activity.

When a dispute or early-fraud warning needs attention, ScaleSafe organizes those records into a structured defense workflow so the merchant can respond with cleaner documentation and less manual digging.

ScaleSafe is powered by Whole Pay and runs inside GoHighLevel. It works with the merchant's own connected Stripe or NMI account. Payments settle directly to the merchant's processor account; ScaleSafe does not hold funds.

### Feature bullets

- Timestamped evidence capture across the client lifecycle
- Click-wrap consent and purchase-summary records for enrollment flows
- Payment, refund, recurring, and card-on-file visibility for Stripe and NMI
- Client evidence timelines with communications, milestones, pulse check-ins, and delivery proof
- Defense packet workflows for disputes and early-fraud warnings
- GoHighLevel workflow triggers for receipts, enrollment links, welcome/access, refunds, failed payments, reminders, and app events
- Merchant-facing dashboards for clients, offers, payments, evidence, and defense activity

### Key features

1. Evidence timeline - capture consent, payment, communication, delivery, refund, and cancellation records in one place.
2. Defense workflow - organize the evidence a merchant needs when a dispute or early-fraud warning appears.
3. Processor-direct payments - use connected Stripe or NMI accounts; ScaleSafe does not hold merchant funds.
4. Recurring payment visibility - track installment/subscription progress, payment reminders, refunds, pauses, resumes, and cancellations.
5. Native GHL workflow automation - fire purpose-built Marketplace triggers for receipts, enrollment links, welcome/access, refunds, failed payments, and app events.

### Support and compliance fields

- Support email: `support@scalesafe.app`
- Privacy Policy URL: `https://scalesafe.app/privacy`
- Terms URL: `https://scalesafe.app/terms`
- Support URL: `https://scalesafe.app/support`
- User guide URL if requested: `https://scalesafe.app/guide`
- Troubleshooting URL if requested: `https://scalesafe.app/troubleshooting`
- Powered by Whole Pay: `https://getwholepay.com`

## OAuth Scope Inventory

HighLevel requires exact OAuth scopes and a reason for each one.

Steps:

1. Go to **Build > Advanced Settings > Auth**.
2. Find the selected scopes.
3. Copy the exact scope names into the tracker or listing worksheet.
4. For each scope, write a plain-English reason using the pattern below.

Reason examples:

- Contact scopes: needed to attach offers, enrollment/payment fields, evidence status, and workflow context to the right client.
- Location scopes: needed to provision the installed merchant account and verify setup health.
- Custom field/custom value scopes: needed to create, map, and verify ScaleSafe workflow fields and custom values.
- Workflow/trigger scopes: needed to register and execute ScaleSafe Marketplace triggers for receipts, enrollment links, welcome/access, refunds, failed payments, chargebacks, and app events.
- Conversation/activity scopes: needed to capture client communications and activity records as evidence when enabled.
- Product/payment scopes: needed to support offer/payment setup and processor-related payment workflow visibility where configured.

Do not guess scope names. Copy the exact text from HighLevel.

## Screenshot Requirements

HighLevel public review expects listing assets such as screenshots. Capture 3-6 clean screenshots with fake/non-PII data.

Recommended screenshots:

1. Dashboard / provisioning health
2. Offer setup with checkout mode, pricing, terms, milestones, pulse cadence, and add-ons
3. Checkout or enrollment purchase summary
4. Client evidence timeline
5. Payments view with recurring progress and processor subscription ID
6. Defense workflow / evidence assembly screen

Screenshot rules:

- Use fake clients only.
- Hide or blur real phone numbers, emails, transaction IDs, processor keys, secrets, and personal data.
- Do not show live NMI credentials.
- Do not show Stripe/NMI secret keys.
- Do not show internal Railway/Supabase/GitHub screens.
- Use consistent browser size.
- Save screenshots in a shared folder and paste the folder link into the tracker.

## Public Review / Submission

HighLevel's public-review path may show a button such as **Start Public (listed) review** from **My Apps**.

Do not submit for public review until Philip confirms:

- Listing copy reviewed
- Screenshots approved
- Privacy/Terms/Support links tested
- OAuth scopes and justifications completed
- Group B Stripe sandbox double-bill test completed
- Fresh install/provisioning health has no unexplained critical warnings
- Philip gives explicit "submit" approval

If you see a **Submit for review** button, do not click it until Philip explicitly approves.

## Proof Required

After completing updates, send Philip:

- Screenshot of **Build > Profile** fields after update
- Screenshot of support/legal URL fields
- Screenshot or copied list of selected OAuth scopes
- Link to screenshot folder
- Confirmation that no auth/secrets/webhook/payment-provider settings were changed
- Any warning or validation message HighLevel shows

## If Something Looks Wrong

Stop and ask Philip before changing anything if:

- The app asks you to regenerate credentials
- The app asks you to change a redirect URL
- The app asks you to change scopes
- You cannot find the existing ScaleSafe app
- You see multiple ScaleSafe apps and are unsure which is current
- The listing requires a paid price
- The listing requires screenshots you do not have
- The app prompts for public review submission

Do not solve those by guessing.

