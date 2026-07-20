# New ScaleSafe Account Operator Checklist

Complete this checklist in order for each GHL location. Record sanitized proof and the owner of every unresolved item. Do not store secrets in this document.

## 1. Intake

- [ ] Agency and exact GHL sub-account recorded.
- [ ] Trusted location ID recorded.
- [ ] Legal name, DBA/brand, address, timezone, currency, industry, and service type recorded.
- [ ] Website, support email, forwarding inbox, phone, sender name, logo, and favicon received.
- [ ] Recognizable statement descriptor approved.
- [ ] Terms, refund/cancellation policy, and legal URLs approved.
- [ ] Processor scope and test/live state approved.
- [ ] Required workflows and evidence connections agreed.
- [ ] Merchant slug reserved.

## 2. Marketplace Installation

- [ ] Opened the exact merchant sub-account.
- [ ] Installed ScaleSafe into that location.
- [ ] Reviewed and confirmed the attached Snapshot.
- [ ] Opened ScaleSafe from that location.
- [ ] Verified no agency account chooser appears.
- [ ] Verified no other merchant's data appears.

**Stop condition:** Any cross-tenant data or untrusted location context.

## 3. Domains And Email

- [ ] Added `<merchant-slug>.scalesafe.app` to GHL and connected the onboarding funnel.
- [ ] Added the exact GHL CNAME in Cloudflare as DNS-only.
- [ ] Verified public HTTPS funnel.
- [ ] Added `mail-<merchant-slug>.scalesafe.app` in GHL Email Services.
- [ ] Added and verified every SPF, DKIM, tracking, MX, and DMARC record.
- [ ] Added and saved the real forwarding inbox.
- [ ] Configured only approved Cloudflare receiving aliases.
- [ ] Sent and received one test email.
- [ ] Recorded final funnel, sending, and forwarding values.

## 4. GHL Business Profile

- [ ] Business identity, email, phone with country code, website, address, timezone, and currency saved.
- [ ] Logo and favicon uploaded.
- [ ] Sender name, sender email, forwarding, and compliance footer checked.
- [ ] Reload confirmed all values persisted in this location.

## 5. ScaleSafe Merchant Setup

- [ ] Legal and public business names saved.
- [ ] Support details, descriptor, website, industry, service type, and description saved.
- [ ] ScaleSafe logo uploaded and previewed.
- [ ] Enrollment funnel URL saved.
- [ ] Only in-scope evidence modules enabled.
- [ ] Reload confirmed all settings and branding persisted.
- [ ] Canonical merchant terms page displays the correct merchant.

## 6. Billing Entitlement And Processors

- [ ] Marketplace plan confirmed.
- [ ] WholePay location approval confirmed when NMI pricing/access applies.
- [ ] Merchant-owned Stripe, Whop, or approved NMI account connected.
- [ ] Test/live state confirmed from processor truth.
- [ ] Default processor recorded.
- [ ] No credentials copied into notes, screenshots, workflows, or Railway.

## 7. Provisioning Health

- [ ] Merchant record passes.
- [ ] GHL OAuth and workflow authentication pass.
- [ ] Required ScaleSafe fields and values pass.
- [ ] Intended processor configuration passes.
- [ ] In-scope trigger subscriptions pass.
- [ ] Pulse/reminder diagnostics checked only when enabled.
- [ ] Every warning classified with owner and impact.
- [ ] Only approved repair controls used.

## 8. Workflow Proof

For every workflow in launch scope:

- [ ] ScaleSafe trigger accepted.
- [ ] Correct GHL workflow execution found.
- [ ] Action executed rather than waiting, skipped, or failed.
- [ ] Communication record created.
- [ ] Recipient received the correct message.
- [ ] Public program name, business identity, amount, links, and support details are correct.

At minimum prove enrollment link, receipt, welcome/access, refund, milestone, pulse, and reminder workflows that the merchant will use.

## 9. Evidence Connections

- [ ] Native GHL Fulfillment appears.
- [ ] Each released provider is authorized by this merchant.
- [ ] Connected status verified.
- [ ] One real event observed where required.
- [ ] One event published to the correct enrollment where required.
- [ ] No test event became production evidence.

## 10. Certification Transaction

- [ ] Created a Stripe test PIF full-enrollment offer with distinct internal/public names.
- [ ] Enabled only Purchase Summary and Cardholder Authorization for the baseline test.
- [ ] Added one simple milestone.
- [ ] Created a fictional test client using the approved inbox.
- [ ] Verified every public funnel page and the terms link.
- [ ] Completed one Stripe test payment.
- [ ] Verified exactly one processor payment, client, enrollment, payment event, and signed packet.
- [ ] Verified receipt and welcome delivery.
- [ ] Verified Programs, Payments, Evidence, Messages, and Files.
- [ ] Added one fulfillment evidence item to the exact enrollment.
- [ ] Compiled one defense and verified unsafe output is held for review.
- [ ] Checked Railway logs for unexpected errors, duplicate actions, and failed background work.

## 11. Handoff

- [ ] Merchant administrator and support owner identified.
- [ ] Domain, email, branding, processors, workflows, evidence connections, and exclusions documented.
- [ ] Open warnings have an owner, workaround, or approved scope exclusion.
- [ ] No secrets or private payment data appear in handoff materials.
- [ ] Merchant shown how to create offers, review clients/payments, respond to pulse follow-up, and review defenses.
- [ ] Installation certified for controlled beta.
