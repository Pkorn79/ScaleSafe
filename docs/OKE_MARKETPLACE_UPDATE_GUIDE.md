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
   - **Build > Pricing** only to verify it is already set to Free
   - App review/listing fields that HighLevel asks you to complete
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

Pricing is already set to Free for beta. Verify it only.

Do not change pricing, create billing meters, create paid/freemium plans, or set up HighLevel-managed billing unless Philip explicitly approves it later.

### App permissions / scopes

Do not open or change External Authentication for this task.

External Authentication should remain OFF. ScaleSafe does not use an extra third-party OAuth step during GHL app installation.

Oke does not need to define or justify internal selected app permissions/scopes unless HighLevel specifically asks during review.

If HighLevel asks for permission/scope justification, copy the selected permission/scope names exactly from the app's permissions/scopes area, send them to Philip, and wait for wording. Do not change selections.

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
- External Authentication toggle
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

When a dispute needs attention, ScaleSafe organizes those records into a structured defense workflow so the merchant can respond with cleaner documentation and less manual digging.

ScaleSafe is powered by Whole Pay and runs inside GoHighLevel. It works with the merchant's own connected Stripe or NMI account. Payments settle directly to the merchant's processor account; ScaleSafe does not hold funds.

### Feature bullets

- Timestamped evidence capture across the client lifecycle
- Click-wrap consent and purchase-summary records for enrollment flows
- Payment, refund, recurring, and card-on-file visibility for Stripe and NMI
- Client evidence timelines with communications, milestones, pulse check-ins, and delivery proof
- Defense packet workflows for disputes
- GoHighLevel workflow triggers for receipts, enrollment links, welcome/access, refunds, failed payments, reminders, and app events
- Merchant-facing dashboards for clients, offers, payments, evidence, and defense activity

### Key features

1. Evidence timeline - capture consent, payment, communication, delivery, refund, and cancellation records in one place.
2. Defense workflow - organize the evidence a merchant needs when a dispute appears.
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

## Permission / Scope Review Note

No action is needed here unless HighLevel specifically asks for selected permission or scope justifications during review.

If they do ask:

1. Copy the exact selected permission/scope names from the live Marketplace app.
2. Send them to Philip.
3. Wait for Philip/Codex to provide the exact wording.
4. Do not add, remove, or change any selected permissions/scopes.

Reason examples if GHL asks:

- Contact scopes: needed to attach offers, enrollment/payment fields, evidence status, and workflow context to the right client.
- Location scopes: needed to provision the installed merchant account and verify setup health.
- Custom field/custom value scopes: needed to create, map, and verify ScaleSafe workflow fields and custom values.
- Workflow/trigger scopes: needed to register and execute ScaleSafe Marketplace triggers for receipts, enrollment links, welcome/access, refunds, failed payments, chargebacks, and app events.
- Conversation/activity scopes: needed to capture client communications and activity records as evidence when enabled.
- Product/payment scopes: needed to support offer/payment setup and processor-related payment workflow visibility where configured.

Do not guess names. Do not use the External Authentication screen for this. If you cannot find a permissions/scopes list, leave this blank and ask Philip.

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
- Permission/scope justifications completed only if HighLevel review asks for them
- Group B Stripe sandbox double-bill test completed
- Fresh install/provisioning health has no unexplained critical warnings
- Philip gives explicit "submit" approval

If you see a **Submit for review** button, do not click it until Philip explicitly approves.

## Proof Required

After completing updates, send Philip:

- Screenshot of **Build > Profile** fields after update
- Screenshot of support/legal URL fields
- Only if HighLevel asks: screenshot or copied list of selected app permissions/scopes
- Link to screenshot folder
- Confirmation that no auth/secrets/webhook/payment-provider settings were changed
- Any warning or validation message HighLevel shows

## If Something Looks Wrong

Stop and ask Philip before changing anything if:

- The app asks you to regenerate credentials
- The app asks you to change a redirect URL
- The app asks you to change scopes
- You only see External Authentication and no permissions/scope list
- You cannot find the existing ScaleSafe app
- You see multiple ScaleSafe apps and are unsure which is current
- The listing requires a paid price
- The pricing screen is not already set to Free
- The pricing screen asks you to create billing meters or paid/freemium plans
- The listing requires screenshots you do not have
- The app prompts for public review submission

Do not solve those by guessing.
