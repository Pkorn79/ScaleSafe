# ScaleSafe Chargeback Reduction Positioning and Roadmap

This document records the current product position for chargeback reduction and defense readiness. It is the reference point for marketing copy, beta readiness, and future defense-roadmap work.

## Positioning

ScaleSafe helps merchants reduce chargeback risk by building the evidence trail before a dispute happens. It should not be positioned as preventing all chargebacks or guaranteeing dispute wins.

The strongest value is lifecycle evidence capture tied to a client and enrollment: consent, payment, delivery, communication, milestones, pulse check-ins, refunds, cancellation history, and program activity.

Payment rail does not inherently weaken the evidence story. Stripe, NMI, Whop, FanBasis, ACH, and future rails can all support the same defense record when ScaleSafe reliably links payment events, processor IDs, refunds, cancellations, and webhook events to the right enrollment.

The rail-specific risk is operational: webhook coverage, transaction identifiers, refund/cancel support, dispute-event visibility, and whether the processor exposes useful dispute data automatically.

## Current Assets

- Contact-level evidence readiness scoring exists, but it should be treated as a rough client evidence indicator, not a dispute win prediction.
- Pulse cadence exists through `ss_app_event` with `event_type = pulse_check_due`, and pulse submissions can become evidence.
- GHL communication/activity tracking includes timestamps and can support the evidence timeline when the merchant uses GHL communication channels.
- External evidence ingestion exists for sessions, modules, milestones, pulse checks, payment updates, service access, course completion, assignment submissions, and custom events.
- Defense logic includes reason-code-aware evidence prioritization for authorization, payment history, communication, service delivery, and refund/cancellation evidence.
- The broader defense-response experience still needs deeper production hardening before it should be marketed as automated expert representment.

## MVP Beta Requirements

- Public copy must use "reduce chargebacks," "build the evidence trail," and "improve dispute readiness." Avoid "prevent chargebacks," "win every chargeback," and guarantee-style claims.
- Evidence readiness should be labeled as contact-level readiness until program/enrollment-level scoring ships.
- Pulse must be smoke-tested end to end before it is treated as beta-proven: due event sent, GHL workflow delivered, client submitted, evidence linked to the enrollment.
- Defense packets should be positioned as organized evidence packets and draft response support, not guaranteed automated representment.
- Communication evidence must show readable message content, direction/channel when available, and timestamps.
- Payment, refund, pause, resume, cancel, and recurring evidence must be proven per active processor.
- WholePay processor setup can include Ethoca, Verifi, RDR, descriptor, and 3DS/Radar guidance, but ScaleSafe should not imply native network-alert automation until it is actually integrated and tested.

## Roadmap

- Enrollment-level evidence score: score each program/enrollment by evidence buckets such as authorization, accepted terms, delivery, communication, satisfaction, refund/cancel history, and payment history.
- Reason-code evidence readiness: show gaps by reason category, such as fraud/authorization, unrecognized charge, services not provided, not as described, and credit not processed.
- Pulse v2: ask stronger structured questions about what the client received, satisfaction with progress, needed help, billing/refund/cancellation concerns, and follow-up request.
- Negative pulse alerts: alert merchants when pulse responses show low satisfaction, billing concern, refund/cancel intent, or follow-up need.
- Support SLA evidence: calculate first-response time, unresolved complaint age, refund/cancel request age, and last merchant touch using GHL communication timestamps.
- Network alert dashboard: future optional integration/import for Ethoca Alerts, Verifi Order Insight, Verifi RDR, Stripe Early Fraud Warnings, and alert outcomes if WholePay or a processor/provider makes access practical.
- Order Insight / Consumer Clarity playbooks: provide setup guidance first; direct integration only if access, cost, and operational value justify it.
- Radar / 3DS recommendations: provide processor-side setup guidance and optional rule recommendations; do not make this beta-critical.
- External activity SDK/webhook v2: package the existing external webhook pattern into a simple guide for Zoom, Meet, course platforms, SaaS logins, downloads, and service usage.
- Outcome analytics: track dispute outcomes by reason code, offer, source/closer, processor, evidence completeness, refund timing, and network-alert coverage.

## External Product Clarifications

- Verifi Order Insight shares richer purchase details with issuers so cardholders and issuer agents can recognize transactions before filing disputes.
- Verifi Rapid Dispute Resolution resolves eligible pre-disputes using merchant-defined rules, usually by issuing a refund before a formal chargeback is created.
- Ethoca Alerts provides near-real-time issuer dispute/fraud alerts so merchants can refund, stop fulfillment, or take action before the dispute becomes a formal chargeback.
- Ethoca Consumer Clarity shares richer purchase details in issuer channels to reduce confusion-driven disputes.
- Visa CE 3.0 can block or reject eligible Visa fraud disputes when the required historical transaction evidence is available.
- Statement descriptors help transaction recognition on the card statement. Order Insight and Consumer Clarity provide richer issuer-side purchase context and are not the same thing as descriptors.
