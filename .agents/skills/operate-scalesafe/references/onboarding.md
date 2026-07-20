# Merchant Onboarding

Use this runbook for one new GHL sub-account. When guiding a person, give one numbered step at a time and wait for the result before continuing.

## Intake Record

Record without storing secrets:

- Agency, sub-account, and location ID.
- Legal name, DBA/brand, description, industry, service type, timezone, and currency.
- Website, address, support phone, support email, forwarding inbox, and sender name.
- Logo and favicon files.
- Recognizable statement descriptor.
- Merchant slug and requested custom domain, if any.
- Processor launch scope and test/live state.
- Terms, refund/cancellation policy, privacy/legal URLs, and support owner.
- Required workflows, evidence connections, and access policies.

## Installation Gates

1. Open the exact GHL sub-account.
2. Install ScaleSafe from Marketplace into that location.
3. Review and confirm the attached ScaleSafe Snapshot resources.
4. Open ScaleSafe from that same location.
5. Verify it opens without an account chooser and contains no other merchant's data.

Stop immediately on cross-tenant data or missing trusted location context. Do not choose another sub-account as a workaround.

## Standard Domains

Use the standard hosted shape unless a paid custom-domain setup is approved:

- Funnel: `<merchant-slug>.scalesafe.app`
- Sending: `mail-<merchant-slug>.scalesafe.app`

For the funnel hostname:

1. Add the domain in GHL **Settings > Domains & URL Redirects**.
2. Connect it to the ScaleSafe onboarding funnel.
3. Add the exact GHL-provided CNAME in Cloudflare.
4. Keep the GHL funnel record DNS-only unless proxying has been separately certified.
5. Verify the public HTTPS funnel.

For the sending domain:

1. Add it in GHL **Settings > Email Services > Dedicated Domain And IP**.
2. Add every GHL-provided SPF, DKIM, tracking, MX, and DMARC record to Cloudflare exactly.
3. Verify all records in GHL.
4. Add and save the merchant's real forwarding inbox.
5. Send one test email and prove delivery.

Use Cloudflare Email Routing separately for approved receiving aliases. Do not treat the GHL sending subdomain as a normal inbox or add a catch-all without approval.

## GHL Business Profile

1. Enter business identity, email, phone with country code, website, address, timezone, and currency.
2. Upload logo and favicon.
3. Confirm sender name, sender email, forwarding address, and compliance footer.
4. Save, reload, and verify persistence in this location only.

## ScaleSafe Merchant Setup

Complete before Provisioning Health:

1. Enter legal name, DBA/brand, support email, descriptor, website, city/state, industry, service type, and description.
2. Upload the logo with ScaleSafe's upload control. Do not use a Drive or Dropbox share URL as the logo URL.
3. Enter the approved enrollment funnel URL.
4. Enable only evidence modules the merchant will use.
5. Save, reload, and verify the logo and values persist.

The GHL logo and ScaleSafe logo are separate and both must be verified.

## Terms And Consent

1. Choose ScaleSafe merchant terms, approved custom terms, or an HTTPS merchant terms document.
2. Verify `https://dashboard.scalesafe.app/terms/<location-id>` shows the correct merchant.
3. Use only offer acknowledgments that actually apply.
4. For baseline PIF certification, default to Purchase Summary and Cardholder Authorization unless another clause is being tested.
5. Verify the public funnel logo, terms link, price, policy, and acknowledgments.

Do not build duplicate static terms pages into the Snapshot. Signed enrollment packets remain frozen records; test changed terms with a new enrollment.

## Plans And Processors

- Standard permits Stripe and Whop.
- WholePay permits Stripe, Whop, and NMI only after the location's WholePay-provisioned NMI account is approved.
- FanBasis remains unavailable until separately released.

1. Confirm Marketplace entitlement and any WholePay approval.
2. Connect only merchant-owned processors in launch scope.
3. Record test/live state and default processor.
4. Verify ownership before creating an offer.

Never place merchant processor credentials in Railway, GHL workflows, custom values, screenshots, or notes.

## Provisioning And Workflows

1. Open **Settings > Provisioning Health** after setup and processor connection.
2. Verify merchant, OAuth, workflow auth, required fields/values, processor, and in-scope trigger subscriptions.
3. Use only approved repair controls; do not delete/recreate assets speculatively.
4. Confirm required Snapshot workflows are published and use current ScaleSafe triggers and scalar merge fields.
5. Prove each in-scope workflow through: ScaleSafe delivery, GHL execution, outbound message, and recipient delivery.

Same-key trigger subscriptions may be intentional. Verify workflow purpose before removing anything.

## Evidence Connections

1. Confirm GHL Fulfillment appears as the native location-bound source.
2. Connect each released provider from inside the merchant's ScaleSafe account.
3. Authorize the merchant's own provider account.
4. Distinguish Connected, Event observed, and Evidence published.

## Final Certification

Run `certification.md`. Handoff only when identity, domains, email, terms, processor scope, Provisioning Health, required workflows, checkout, evidence, support owner, and open warnings are documented and proven.
