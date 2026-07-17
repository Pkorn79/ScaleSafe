# ScaleSafe Website Build Brief

Status: Design and implementation source of truth for the ScaleSafe public website rebuild.

## Objective

Build a polished, product-led website for ScaleSafe that explains the product accurately, earns trust with high-ticket service businesses, and moves qualified prospects into the ScaleSafe private beta. The site must look like a real operational product, not a generic AI/SaaS landing page.

The canonical marketing site will live at `https://scalesafe.app`. The application remains at `https://dashboard.scalesafe.app`.

## Product

ScaleSafe is a GoHighLevel Marketplace application for high-ticket and mixed-ticket service businesses. It helps merchants reduce avoidable chargeback risk by collecting and organizing evidence throughout the complete client relationship, then uses the disputed transaction and reason code to assemble a focused defense packet for merchant review.

ScaleSafe connects:

1. Offer terms, clickwrap consent, signatures, and payment authorization.
2. Payment, refund, cancellation, recurring billing, and processor records.
3. Client communications and support history.
4. Milestones, milestone sign-off, pulse responses, appointments, attendance, service access, course activity, and delivered resources.
5. Enrollment-scoped evidence and reason-code-aware chargeback response.

ScaleSafe runs inside one merchant's GoHighLevel sub-account. Merchant data must remain isolated by sub-account.

## Audience

Primary audiences:

- High-ticket coaches and consultants.
- Agencies and done-for-you service providers.
- Masterminds, communities, course creators, and content businesses.
- Mixed-ticket businesses selling paid-in-full offers, installments, retainers, memberships, or SaaS access.

The audience is operationally sophisticated but not necessarily technical. They understand the pain of disputes, scattered proof, processor fees, failed installments, and account-health risk.

## Positioning

Primary promise:

> Build the evidence trail before the dispute happens.

Supporting proposition:

> ScaleSafe connects consent, payment, fulfillment, communication, and client engagement to the exact program and transaction, so merchants can see problems earlier and respond to chargebacks with organized, relevant evidence.

Approved language:

- Reduce avoidable chargebacks.
- Improve dispute readiness.
- Build and organize evidence before a dispute.
- Connect the client journey to the disputed transaction.
- Compile a reason-code-aware evidence packet and draft response for merchant review.
- Funds settle through the merchant's connected processor or hosted checkout provider.

Do not claim:

- ScaleSafe prevents every chargeback.
- ScaleSafe guarantees wins, reversals, or processor-account protection.
- AI alone wins disputes.
- Evidence is court-grade, bank-grade, tamper-proof, or legally dispositive.
- ScaleSafe is a merchant of record, law firm, collection agency, processor, acquirer, card network, or bank.
- Every integration or roadmap provider is currently available.

## Primary Conversion

Primary CTA: `Request private beta access`

Secondary CTA: `See how ScaleSafe works`

The primary CTA should submit to GoHighLevel so the prospect enters the correct pipeline and follow-up workflow. A beta request form should collect only the information needed to qualify and contact the prospect.

## Pricing

- NMI plan: `$59/month`.
- Stripe plan: `$99/month`.
- Custom setup may apply when the merchant needs fulfillment systems, external evidence sources, processor configuration, or business-specific onboarding connected.
- Setup pricing is scoped with the merchant and should be presented as implementation support, not an arbitrary fee.

Pricing and beta availability remain subject to final owner approval before the production-domain switch.

## Product Boundaries

Active beta payment channels:

- Stripe.
- NMI.
- Whop hosted checkout.

FanBasis is deferred and must not be marketed as available.

Active or staged evidence sources:

- Native GoHighLevel fulfillment activity.
- Zoom connection and event pipeline; public copy must not describe Zoom attendance as certified until a real participant event has passed final live certification.
- Universal Custom Software Evidence API.
- Additional named integrations are released in stages and must be labeled accurately.

## Information Architecture

### Home

- ScaleSafe is the first-viewport signal.
- Use a real, sanitized product state as the hero visual.
- Explain the before-during-after client evidence lifecycle.
- Show evidence, operational alerts, defense, payments, and integrations.
- Include pricing and private-beta CTA without turning the page into a long feature dump.

### Product / How It Works

- Offer and consent.
- Payment and enrollment.
- Fulfillment and client engagement.
- Pulse, milestone, and attention signals.
- Enrollment-scoped evidence.
- Defense packet review and supported submission paths.

### Evidence and Defense

- Explain enrollment-scoped evidence and why contact-wide noise is unsafe.
- Show evidence timeline, evidence sources, packet structure, reason-code handling, `Needs Review`, and merchant control.
- Clearly state that the issuing bank decides the outcome.

### Payments

- Stripe, NMI, and Whop roles.
- Paid in full, installments, subscriptions, refunds, lifecycle actions, ACH, and dual pricing where supported.
- Funds do not settle to ScaleSafe.
- Avoid presenting all processors as having identical capabilities.

### Stripe Defense

- Stripe Risk Health.
- Early Fraud Warnings and dispute-alert guidance.
- Reason-code-aware evidence compilation.
- Supported Stripe evidence-submission workflow.
- Radar and 3D Secure guidance only where appropriate for public or unattended checkout.

### Integrations

- GoHighLevel as the native operating environment.
- Zoom, Custom Software API, and staged catalog.
- Explain exact-enrollment matching, tenant isolation, and why ambiguous events stay out of defense evidence.
- Clearly separate `Available`, `Beta`, and `Planned`.

### Pricing

- NMI and Stripe plans.
- What is included.
- How custom setup is scoped.
- Private-beta availability.

### Security and Trust

- Location-bound tenant isolation.
- Processor-hosted or tokenized payment methods.
- Sensitive credentials encrypted or hashed as appropriate.
- Signed public action links and server-side verification.
- Merchant review safeguards for defense packets.
- No unsupported compliance certifications.

### Resources

- Product guide.
- FAQ.
- Troubleshooting.
- Support.
- Webinar or demo registration when available.

### Legal

- Privacy Policy.
- Terms of Service.
- Support contact.
- Future subprocessors/DPA material when completed.

## Visual Direction

Use the existing WholePay design system as the family foundation while keeping ScaleSafe distinct and product-focused.

- Quietly confident, precise, and operational.
- Product screenshots and evidence artifacts should carry the design.
- Use real interface states, legible crops, and strong captions.
- Avoid generic stock photography, abstract security shields, circuit-board imagery, decorative orbs, bokeh, and purple SaaS gradients.
- Avoid an all-navy or all-emerald one-note palette. Use deep ink, white, brand green/teal, and a limited warm attention color.
- Keep page sections full-width and structured rather than stacking decorative cards.
- Cards are for repeated items or product records only, with an 8px maximum radius.
- Do not put the hero copy inside a card.
- The homepage hero should use an actual product image as an immersive background or stage, with copy over a controlled contrast area.
- Show a visible hint of the next section in the first viewport.
- Use small, clear product headings inside compact screenshots and panels.
- Mobile layouts must preserve screenshot readability and never overlap text or controls.
- Use familiar icons, preferably Lucide, with labels or tooltips where needed.
- Respect reduced-motion settings.

## Product Story

The website should communicate this sequence visually:

1. The merchant defines the offer, payment structure, terms, delivery, milestones, and pulse cadence.
2. The client reviews the offer, accepts responsibilities and terms, signs, and pays.
3. ScaleSafe records payment and enrollment while GoHighLevel workflows deliver receipts, welcome, reminders, and follow-up.
4. Fulfillment, communication, pulse, milestones, appointments, attendance, access, and connected-system activity accumulate under the correct enrollment.
5. The merchant sees attention items while the relationship is active.
6. If a dispute occurs, ScaleSafe resolves the disputed transaction to the correct enrollment, prioritizes relevant evidence, and produces a packet for review.

## Approved Media

Public-safe repository images are cataloged in:

- `docs/user-guide/SCREENSHOT_CATALOG_2026-07-17.md`
- `docs/user-guide/REVIEWER_ASSET_MANIFEST.md`
- `docs/user-guide/assets/reviewer-2026-07-17/`

PMG screenshots and defense outputs may contain names, emails, transaction IDs, unrealistic test data, or signed URLs. They are design references only unless they are independently sanitized or recreated with a fictional reviewer record.

## Technical Shape

- Build the canonical website as a source-controlled static site, preferably Astro.
- Host on Cloudflare Pages with Git-based preview deployments.
- Keep the marketing-site deployment independent from the ScaleSafe application deployment.
- Use GoHighLevel for lead forms, calendars, chat, webinar registration, and follow-up workflows.
- Do not paste complete generated pages into GHL custom-code blocks.
- Use GHL funnels for temporary campaigns and experiments, not as the canonical product-site source.
- Preserve stable public paths for `/privacy`, `/terms`, `/support`, `/guide`, `/faq`, and `/troubleshooting`; redirects from existing `.html` paths may be added.
- Start without a CMS. Keep product content in version-controlled Markdown or structured data until editing frequency justifies a CMS.

## Quality Requirements

- Responsive desktop, tablet, and mobile behavior.
- WCAG-conscious color contrast, keyboard navigation, visible focus, semantic headings, and form labels.
- Fast image delivery and optimized screenshots.
- Descriptive metadata, Open Graph images, sitemap, canonical URLs, and structured organization/software data.
- No external scripts without a documented purpose.
- No secrets, private identifiers, processor IDs, signed storage URLs, or real client PII in public assets.
- Every CTA, form, legal link, and mobile navigation path tested before launch.
- Current live site remains unchanged until the Cloudflare preview is approved.

## Design Deliverable

First produce one coherent homepage direction at desktop and mobile widths. It must include:

- Header and mobile navigation.
- Product-led hero using an approved ScaleSafe interface image.
- Evidence lifecycle section.
- Operational attention and pulse/milestone section.
- Defense packet section.
- Payment and processor section.
- Integrations section.
- Pricing preview.
- Private-beta CTA.
- Resource/legal footer.

After the homepage direction is approved, extend the same system to the supporting pages. Do not invent new product capabilities, customer testimonials, logos, statistics, certifications, or outcome claims.
