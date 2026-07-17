# ScaleSafe Installation Guide

This runbook installs ScaleSafe into one GoHighLevel sub-account. Repeat it independently for every merchant location. A merchant installation never uses another merchant's location, processor credentials, or evidence.

## Before Installation

Record these values in the onboarding worksheet:

- GHL agency and sub-account names.
- GHL location ID.
- Merchant legal name, DBA/brand name, business description, industry, and primary service type.
- Business website, city/state, timezone, currency, support email, forwarding inbox, and support phone.
- Merchant logo file and the approved sender name used in client communications.
- Payment descriptor the client should recognize on a bank statement.
- Merchant checkout subdomain or approved funnel domain.
- Intended processors and whether each is test or live.
- Refund/cancellation policy, standard terms, and any required legal or privacy URLs.
- Whether Zoom or another evidence connection is in launch scope.

Do not place a merchant location ID, processor credential, or provider token in Railway. Railway contains app-level credentials only. Merchant setup is stored against the GHL location in ScaleSafe.

## Install The Marketplace App And Snapshot

1. Sign in to GHL and open the exact merchant sub-account.
2. Open Marketplace and install ScaleSafe for that sub-account.
3. Select the intended sub-account when GHL asks where to install it.
4. Review the attached Snapshot resources, type `confirm` when GHL requests confirmation, and finish the installation.
5. Return to the same sub-account and open ScaleSafe from its custom menu item.

Expected result:

- ScaleSafe opens without an agency-wide account chooser.
- The dashboard belongs only to the selected location.
- A new location starts with its own offers, clients, payments, evidence, and settings.

Stop if ScaleSafe displays data from another location. Do not continue setup or attempt to repair it by selecting another account.

## Configure The Standard ScaleSafe Subdomains

Use this standard setup unless the merchant pays for a custom-domain installation:

- Funnel host: `<merchant-slug>.scalesafe.app`
- Sending domain: `mail-<merchant-slug>.scalesafe.app`

The slug must be unique, short, and recognizable. Record it in the onboarding worksheet before creating DNS records.

### Connect The Funnel Host

1. In the merchant's GHL sub-account, open **Settings > Domains & URL Redirects**.
2. Add `<merchant-slug>.scalesafe.app` and connect it to the ScaleSafe client-onboarding funnel.
3. In Cloudflare DNS for `scalesafe.app`, add the exact CNAME target GHL provides for that hostname.
4. Set the record to **DNS only**. Do not proxy a GHL funnel hostname through Cloudflare unless that behavior has been separately certified.
5. Return to GHL and confirm the domain is connected and the public funnel URL loads.

### Connect The Sending Domain

1. In the same GHL sub-account, open **Settings > Email Services > Dedicated Domain And IP**.
2. Add `mail-<merchant-slug>.scalesafe.app`.
3. Copy every DNS record GHL provides into the central Cloudflare `scalesafe.app` zone. This normally includes SPF, DKIM, tracking CNAME, two Mailgun MX records, and DMARC.
4. Keep the tracking CNAME and every other merchant DNS record **DNS only**.
5. Compare the host, value, record type, and MX priority against GHL before saving.
6. Return to GHL and click **Verify Domain**. Do not continue until every record reports **Verified**.
7. Open **Email Services > Reply & Forward Settings**. Add the merchant's real external inbox under **Forwarding Address**, press Enter to create the address chip, and save.
8. Confirm GHL reports `Successfully Updated Forward Settings`.

The external forwarding inbox cannot use the same GHL sending domain. Replies should remain visible in GHL Conversations and also forward to the merchant's normal inbox.

### Configure Business Email Routing

The GHL sending domain authenticates outbound mail; it is not a normal inbox. If ScaleSafe is providing a business alias for the installation, configure that alias separately through Cloudflare Email Routing.

1. Add the merchant's real external inbox as a Cloudflare verified destination.
2. Have the merchant click Cloudflare's verification message before creating a route.
3. Add only the approved aliases, such as `support@scalesafe.app` or another recorded address, and route them to the verified destination.
4. Send a test message to each alias and confirm it reaches the external inbox.
5. Record the alias, destination, verification date, and delivery proof in the onboarding worksheet.

Do not use the GHL Mailgun sending subdomain as an ordinary receiving mailbox, and do not create a catch-all route unless Philip explicitly approves it.

### Record The Final URLs

1. Enter `https://<merchant-slug>.scalesafe.app` in ScaleSafe **Settings > Merchant Setup** as the approved enrollment-funnel URL.
2. Record the GHL sending domain and forwarding inbox in the install worksheet.
3. Load the funnel host over HTTPS and send one test email before certification.

Do not add a merchant location ID, subdomain, or email credential to Railway. Cloudflare holds shared DNS; GHL and ScaleSafe hold each location's merchant-specific configuration.

## Complete Merchant Setup

### Complete The GHL Business Profile

1. In the exact merchant sub-account, open **Settings > Business Profile**.
2. Enter the legal/display name, business email, support phone with country code, website, physical address, timezone, and currency. A US phone should be entered as `+1...`; GHL may reject the whole General Information save with `INVALID_COUNTRY` when the country code is missing.
3. Upload the merchant logo and favicon where available.
4. Confirm the sender name, sender email, reply/forward destination, and compliance footer use the merchant's approved identity.
5. Save, reload, and confirm the values persisted in this sub-account only.

### Complete ScaleSafe Merchant Setup

1. In ScaleSafe, open **Settings > Merchant Setup** before running Provisioning Health.
2. Enter the exact **Business Legal Name** and client-facing **DBA / Brand Name**.
3. Enter the support email, recognizable payment descriptor, business website, city/state, industry/niche, primary service type, and short business description.
4. Upload the approved merchant logo through ScaleSafe's **Upload Logo** control and confirm the preview is correct. Do not paste a Google Drive, Dropbox, or other share link into the logo URL field; those hosts may block cross-origin funnel rendering.
5. Enter `https://<merchant-slug>.scalesafe.app` as the Enrollment Funnel URL.
6. Review the enabled Evidence Modules and leave off modules the merchant will not use.
7. Use the sticky **Save Settings** control and wait for **All changes saved**. Reload the page and confirm every value persisted, the merchant logo preview still renders, and the onboarding banner cleared.

The DBA/brand name and logo are client-facing. The legal name and payment descriptor must agree with the merchant and processor records closely enough that clients can recognize the charge and sender.

The GHL Business Profile logo and the ScaleSafe Merchant Setup logo are separate. Upload and verify both. ScaleSafe stores its uploaded logo in the public asset bucket and uses that stable URL in enrollment widgets, receipts, and packets.

### Configure Terms And Offer Consent

1. Decide whether the merchant will use ScaleSafe's default merchant terms, paste approved custom terms, or link to the merchant's own HTTPS terms document.
2. Do not create or duplicate a static terms page in the GHL Snapshot. The Snapshot installs the consent widgets; ScaleSafe serves the merchant-specific terms dynamically.
3. Open `https://dashboard.scalesafe.app/terms/<location-id>` and confirm the correct merchant name and terms load over HTTPS.
4. Stop if the customer-facing link uses a Railway deployment hostname, localhost, a temporary preview URL, or another merchant's location ID.
5. When creating an offer, enable only the acknowledgments that apply to that offer. Do not select every click-wrap clause as a generic default.
6. For a simple paid-in-full certification offer, use **Purchase Summary** and **Cardholder Authorization** unless another clause is specifically needed for the test.
7. Load the public funnel and confirm the logo appears, the terms link opens the canonical ScaleSafe or approved merchant URL, and the visible acknowledgments match the offer configuration.
8. Treat each generated enrollment packet as a frozen record of what that client accepted. Later offer edits must not rewrite an older signed packet; use a new test enrollment when certifying changed branding, terms, clauses, pricing, or program copy.

### Configure Payment Processors

1. Open the ScaleSafe payment processor settings.
2. Connect only the processors in this merchant's approved launch scope.
3. Record whether each connection is test or live; never infer this from the account name alone.
4. When more than one processor is connected, choose and record the default processor.
5. Confirm the processor account belongs to this merchant before creating an offer.

Processor ownership:

- Stripe reviewer testing uses the connected Stripe test account.
- NMI live credentials and MID routing are owner-controlled.
- Whop uses the merchant's connected Whop account and hosted checkout.
- FanBasis remains disabled until separately approved and certified.

Never paste processor secrets into a GHL workflow, custom value, screenshot, or support note.

## Run Provisioning Health

After Merchant Setup and processor configuration:

1. Open **Settings > Provisioning Health**.
2. Run or refresh the check.
3. Confirm the merchant record, GHL OAuth connection, workflow authentication, required custom fields/values, and active processor configuration.
4. Confirm trigger subscriptions exist for the workflows included in the merchant's beta scope.
5. Confirm pulse/reminder diagnostics only when those features are enabled.
6. Save a sanitized screenshot and record every warning in the install worksheet.

A warning is not automatically a checkout blocker. Classify it by the exact health message and test the affected workflow. Do not delete or recreate GHL assets without owner approval.

## Verify Workflows And Client Communications

1. Confirm the required GHL workflows from the approved Snapshot are published.
2. Confirm each workflow uses the expected ScaleSafe trigger and current merge-field contract.
3. Confirm the enrollment-link, payment receipt, welcome/access, refund, milestone, pulse, and reminder workflows that are in this merchant's launch scope.
4. Send one proof event for each required workflow and capture both the GHL execution and received client message.
5. Check that the client sees the correct business name, program name, support email, link, amount, and sender identity.

GHL accepting an app event is not proof that an email or SMS was sent. Certification requires the workflow execution and outbound message proof separately.
More than one active subscription can be legitimate when separate initial-payment and recurring-payment workflows share `ss_payment_received`. Do not delete same-key subscriptions based on count alone. Verify the workflow intent and prove that each transaction produces exactly one applicable outbound receipt.

## Connect Evidence Sources

1. Open **Settings > Evidence Connections**.
2. GHL Fulfillment should appear as the native location-bound source.
3. Connect Zoom or another released provider from inside this merchant's ScaleSafe account.
4. Complete provider authorization as the merchant.
5. Confirm health distinguishes **Connected** from **Event observed** and **Evidence published**.

Each merchant authorizes their own provider account. No per-merchant provider value is added to Railway.

## Certification Smoke Test

Run the smoke test in this order:

1. Confirm Stripe is connected to the intended test account, not a live account.
2. Create one Stripe test paid-in-full offer with a public program name and a distinct internal name. Use only Purchase Summary and Cardholder Authorization for the baseline certification unless the test explicitly covers another clause.
3. Create one fictional client using the approved certification inbox.
4. Send the enrollment link.
5. Complete enrollment and Stripe test payment.
6. Before payment, confirm every funnel page shows the correct client-facing program name, merchant identity, stable logo, price, payment structure, refund language, and relevant acknowledgments.
7. Open the full terms link and confirm it uses the canonical ScaleSafe or approved merchant hostname, not the Railway deployment hostname.
8. Complete checkout, then confirm the payment, enrollment, signed packet, receipt, and welcome workflow.
9. Confirm the client record, enrollment, processor transaction, consent record, payment event, and evidence rows all use the same location, offer, contact, and enrollment.
10. Confirm the client Evidence tab links consent and payment to the exact program and does not pull records from another enrollment.
11. Confirm the received receipt and welcome message show the public program name, correct amount, merchant identity, and working links.
12. Run one milestone or GHL appointment evidence test if included in scope.
13. Compile one test defense and confirm unsafe/missing evidence produces **Needs Review** rather than an unquestioned ready state.
14. Review the matching Railway request/log sequence and confirm there is no unexpected 4xx/5xx, duplicate processor action, or failed background job.

Record browser, Railway, Supabase, GHL, and processor results using `DEEP_DIVE_TEST_PLAN.md`.

## Final Handoff

The location is ready only when:

- GHL Business Profile, ScaleSafe Merchant Setup, merchant logo, sender identity, and approved support routing are complete.
- The funnel subdomain, sending domain, HTTPS, forwarding address, and test email are proven.
- Provisioning Health has no unexplained blocker.
- The intended processors are identified as test or live.
- Required workflows have one successful proof.
- The checkout and evidence smoke test passes.
- The merchant has at least one administrator, an identified support contact, and a recorded handoff owner.
- Credentials, processor ownership, feature exclusions, and unresolved warnings are documented without storing secrets.
- Open warnings have an owner, workaround, or explicit scope exclusion.
- No credentials or private client data appear in the handoff document.
