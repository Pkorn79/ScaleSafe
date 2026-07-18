# ScaleSafe Project Decisions

This file records product and launch decisions that should not be re-litigated unless Philip explicitly reopens them.

## Client / Contact Behavior

- Duplicate client email should resolve to the existing contact/client.
- Do not hard-block the user for duplicate email.
- The UI should clearly show that an existing client was found and used, so the merchant understands what happened.

## Marketplace / GHL App Review

- GHL External Authentication stays OFF.
- ScaleSafe does not use an extra third-party OAuth step during GHL app installation.
- Marketplace billing uses a $99 Standard plan for Stripe/Whop and a conditional $59 WholePay plan for Stripe/Whop/NMI.
- The $59 plan requires an active NMI merchant account established through WholePay and ScaleSafe HQ approval; choosing the cheaper plan alone does not unlock ScaleSafe.
- Existing pre-billing installs remain grandfathered as legacy locations.
- Permission/scope justifications are only prepared if HighLevel specifically asks during review.

## Testing / QA Workflow

- Do not treat an unchanged stale sheet row as a confirmed retest.
- When a fix is shipped, add the affected case to the Retest Queue with the fix/deploy context.
- Mark a case as retested only when Oke or Philip adds new proof, date, and result.
- NMI live-money tests are owner-only.
- Oke owns Stripe sandbox, GHL setup, offer/client/workflow/evidence/defense tests.

## Security / Launch Hardening

- Historical secret exposure in git history is handled by credential rotation, not by rewriting git history, unless Philip explicitly decides otherwise later.
- Supabase rotation requires updating downstream runtime variables, especially Railway production variables, followed by a redeploy/health check.
- Rate-limit gap fixes, at-risk dashboard N+1 work, and money-route P2 hardening are queued in the launch checklist. Do not start those while Oke/Philip retests are still stabilizing unless a live symptom makes one urgent.

## Payment / Billing

- No fallback billing.
- Recurring/installment billing should be processor-native through Stripe, NMI, or future Whop.
- If processor subscription setup fails, ScaleSafe should surface the issue clearly and avoid pretending billing is healthy.
- Payment reminder workflows must use trigger payload fields, not stale contact fields, for payment-specific values.
- Stripe platform-controlled pricing is deferred until ScaleSafe has at least five paying Stripe merchants and at least $100,000 in combined monthly Stripe payment volume for two consecutive months.
- At that trigger, contact Stripe Connect about IC+ network-cost passthrough, WholePay-controlled merchant pricing, retained processing markup, Stripe-managed risk, and treatment of existing Standard OAuth connected accounts. Use `docs/STRIPE_CONNECT_PRICING_OUTREACH.md`.
- Until Stripe approves a different commercial structure, Stripe monetization remains the ScaleSafe subscription plus any Stripe Connect revenue share for which the platform qualifies. Do not add transaction application fees by default.

## UI / UX

- Sticky/minimizable left navigation has shipped and should be considered accepted unless a new UI bug is reported.
- Sticky/minimizable navigation is not a launch blocker.

## Future Defense Response Enhancements

- When we do a deeper defense-response-system pass, organize defense packets around the practical Stripe/processor evidence buckets: authorization, signed terms/MSA/SOW, billing/refund policy, service delivery, client communication/satisfaction, refund/cancellation history, and dispute letter.
- Add or strengthen a rendered checkout/terms/billing-policy snapshot exhibit if the current packet does not clearly show what the customer saw and accepted at purchase.
- Keep public/marketplace copy evidence-first. Do not claim ScaleSafe guarantees dispute wins.
- Position ScaleSafe as helping merchants reduce chargebacks and improve dispute readiness, not as preventing chargebacks outright.
- Treat the current readiness score as a contact-level evidence indicator, not a dispute win prediction. Program/enrollment-level scoring is a roadmap item.
- Payment rail does not inherently weaken the evidence story. The real risk is whether the rail gives ScaleSafe reliable transaction IDs, webhooks, refund/cancel events, and dispute visibility.
- WholePay/processor-side Ethoca, Verifi, RDR, descriptor, Radar, and 3DS setup can be part of onboarding guidance, but ScaleSafe should not claim native network-alert automation until it is integrated and tested.
- Pulse is legitimate evidence when it asks concrete progress, satisfaction, help-needed, and billing-concern questions. It still needs end-to-end proof before being treated as beta-proven.
- Full positioning and roadmap reference: `docs/CHARGEBACK_REDUCTION_POSITIONING_AND_ROADMAP.md`.

## Post-Beta Product Lane: NMI Billing Portal / Stripe-Shaped Billing API

- This is post-beta. Do not build before beta launch unless Philip explicitly promotes it.
- Product concept: ScaleSafe can offer an NMI-focused billing backend for merchants who sell software, memberships, coaching, agencies, or recurring services and want Stripe-like subscription management without using Stripe.
- Positioning: "Use ScaleSafe like Stripe Checkout + Stripe Billing Portal, but powered by NMI and evidence tracking."
- Primary lane is NMI/Whole Pay processing. Stripe support is optional later only if the premium value is evidence, GHL automation, cancellation proof, usage tracking, and dispute readiness. Do not prioritize Whop/FanBasis billing portals because those platforms already own their customer billing infrastructure.
- Developer experience should be Stripe-inspired, not a literal Stripe API clone. Use familiar concepts where useful: customer, offer/price, checkout session, subscription, billing portal session, webhook events.
- Example merchant integration:
  - Merchant creates ScaleSafe offers for software tiers.
  - Merchant app links signup buttons to ScaleSafe checkout sessions.
  - ScaleSafe creates the NMI subscription and sends a webhook to the merchant app.
  - Merchant app stores its own user ID mapped to ScaleSafe contact/enrollment/subscription IDs.
  - Customer later clicks Manage Billing inside the merchant app.
  - Merchant backend requests a short-lived ScaleSafe billing session for that customer/subscription.
  - ScaleSafe handles the billing action, logs evidence, updates NMI, and sends GHL/merchant webhooks.
- Security model:
  - Merchant apps must never receive raw card data, CVV, bank data, NMI keys, Supabase keys, or ScaleSafe service-role credentials.
  - Merchant browser must not directly create billing sessions by claiming a user ID. Merchant backend must authenticate the customer first, then request a ScaleSafe session.
  - Billing sessions should be short-lived, scoped to one merchant/customer/subscription, action-limited, and auditable.
  - ScaleSafe enforces ownership and policy before any pause, cancel, payment-method update, or plan action.
- V1 scope:
  - NMI only.
  - External merchant API keys, scoped and revocable.
  - External customer mapping.
  - Checkout session API.
  - Billing management session API.
  - Subscription status lookup.
  - Update payment method.
  - Cancel or request cancellation.
  - Pause/resume only if NMI support is reliable enough.
  - Merchant webhooks for payment succeeded, payment failed, subscription cancelled, subscription paused, subscription resumed, and payment method updated.
  - Evidence logging for all customer billing actions.
- Deferred:
  - Full SDK.
  - Embedded in-app widget.
  - Plan upgrades/downgrades.
  - Tax/Merchant-of-Record service integration research, such as Polar or a similar service for international tax/VAT/GST handling if ScaleSafe becomes billing infrastructure for SaaS merchants with global customers.
  - App activity event ingestion, such as login, module completion, feature usage, support ticket, onboarding completion, or milestone events.
  - Stripe premium evidence layer.
- Long-term SDK/API direction:
  - Start with a simple REST API and hosted billing sessions.
  - Later add a lightweight JavaScript helper so merchants can create checkout buttons and open billing sessions more easily.
  - Do not promise "drop-in Stripe replacement"; promise Stripe-like integration flow for NMI plus ScaleSafe evidence/GHL automation.
