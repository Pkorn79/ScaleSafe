---
layout: ../layouts/ArticleLayout.astro
title: Frequently Asked Questions
description: Clear answers about ScaleSafe installation, payments, evidence, defense, pulse, fulfillment, integrations, and security.
eyebrow: Product resources
updated: September 3, 2026
---

## General

### What is ScaleSafe?

ScaleSafe helps high-ticket and mixed-ticket service businesses collect enrollment, payment, fulfillment, communication, and client-engagement evidence throughout the customer relationship. It organizes that evidence for operational visibility and chargeback response.

### Who is ScaleSafe built for?

ScaleSafe is designed for coaches, consultants, agencies, course businesses, communities, masterminds, and other service providers that sell paid-in-full, installment, or recurring offers.

### How does ScaleSafe work with GoHighLevel?

ScaleSafe runs inside the merchant's GoHighLevel sub-account. It uses the merchant's contacts, workflows, communications, appointments, and selected fulfillment activity as part of the client record.

## Installation

### Is ScaleSafe installed once per agency or once per sub-account?

Each merchant installation is bound to a specific GHL sub-account, with its own records, integrations, credentials, and configuration.

### Can an agency install ScaleSafe for multiple sub-accounts?

Yes. Each installation remains independently tenant-bound even when several sub-accounts belong to the same agency.

### What happens during onboarding?

Onboarding covers the Marketplace installation, merchant settings, branding, subdomain, processor connection, workflow setup, provisioning health, offer configuration, and a controlled test checkout.

### Who can install ScaleSafe?

An authorized HighLevel agency user installs ScaleSafe in the correct sub-account. If the business receives HighLevel through an agency, that agency must complete the installation. A funnel builder or VA can finish the remaining setup with the right permissions.

### I installed ScaleSafe and see Approval Needed. What should I do?

Send the business and exact HighLevel sub-account name to [ScaleSafe support](/support). We will verify the installation and approved access for that sub-account.

### Do I need a domain?

Full Enrollment uses a subdomain connected to the installed Client Onboarding funnel. Quick Checkout creates its own hosted link. See [Getting Started](/getting-started) for the setup sequence.

### What is the difference between Full Enrollment and Quick Checkout?

Full Enrollment guides the client through information, offer review, consent, and payment. Quick Checkout provides a shorter hosted checkout when the complete enrollment experience is not needed.

### Can my GHL agency or funnel builder complete the setup?

Yes. The agency or builder can install the Snapshot, connect the domain, review workflows, and configure the offer. The business owner connects the payment account and approves the offer terms. Share [Getting Started](/getting-started) with everyone involved.

### Should I uninstall and reinstall if setup fails?

No. Record the exact sub-account, page, action, date, time, timezone, and visible error, then contact [ScaleSafe support](/support). Reinstalling rarely fixes a configuration problem and can complicate installation and entitlement records.

## Automations

### What does ScaleSafe send automatically?

Depending on the offer and account settings, ScaleSafe can send enrollment links, receipts, welcome messages, payment reminders, failed-payment notices, milestone sign-offs, pulse check-ins, re-engagement messages, and merchant alerts. See [What ScaleSafe Sends Automatically](/automations) for the complete reference.

### Can I edit or turn off the ScaleSafe workflows?

You can edit client-facing message copy. Keep workflow names, triggers, filters, and required workflows intact. Review the specific workflow before disabling it, especially when an existing automation sends at the same moment.

### Will ScaleSafe replace my existing HighLevel automations?

No. The installed ScaleSafe workflows remain separate from the automations already in the sub-account. Review both sets before launch so the client receives one message at each moment.

## Payments

### Which payment channels does ScaleSafe support?

The active beta channels include connected Stripe accounts, WholePay merchant processing, and Whop hosted checkout. ScaleSafe brings supported checkout, payment, refund, and account activity into the client-program record.

### How does ScaleSafe handle payment details?

ScaleSafe uses processor-hosted or tokenized payment methods. Merchant records display masked payment details and the processor references needed to manage the payment.

### Can a merchant issue refunds from ScaleSafe?

Eligible payments can be refunded when ScaleSafe has the provider identifier required for that action. ScaleSafe records the refund only after the provider confirms it.

### What is Payment Reconciliation?

Payment Reconciliation highlights records that need attention, including missing subscription IDs, overdue billing, unassigned payments, processor mismatches, duplicates, and recent failures.

### Why is a payment listed as unassigned?

An unassigned payment is recorded at the client level because it has not yet been connected to a specific program enrollment. It remains visible in Payment Management for review.

## Evidence

### What evidence can ScaleSafe collect?

Evidence may include consent, accepted terms, payment history, milestones, pulse responses, appointments, attendance, messages, files, service access, course progress, deliverables, refunds, cancellations, and verified third-party activity.

### How are appointments used in the evidence timeline?

A scheduled appointment records client engagement. Attendance and completion records add stronger fulfillment detail to the same timeline.

### Why is evidence linked to a program or enrollment?

Program-level linking lets ScaleSafe build a defense around the exact agreement, payment, delivery record, and client journey associated with the disputed transaction.

### What does Link to Program mean?

The activity belongs to the client and is currently stored as client-level context. The merchant can connect it to the appropriate program when the enrollment is known.

### How is an email sent from the client profile linked to a program?

ScaleSafe includes the selected enrollment with the outbound message. When several programs are active, the merchant chooses the program the message concerns. General correspondence remains available in the client timeline.

## Defense

### What does Needs Review mean?

Needs Review highlights a packet that requires merchant attention. The packet workspace shows the review reason and provides options to complete the record, edit the response, or regenerate the draft.

### How does defense submission work?

ScaleSafe compiles the reason-specific response and exhibits for merchant review. The merchant approves the packet and then uses the available processor submission path.

### Where does the response deadline come from?

ScaleSafe can initialize the deadline from the dispute information and card-network window. The merchant can update it to match the date shown in the processor portal.

### What happens after a packet is submitted?

ScaleSafe records the submission state, deadline, and reported outcome so the merchant can track the case from preparation through the bank's decision.

## Pulse and Fulfillment

### What happens when a client requests follow-up in a pulse response?

The dashboard surfaces the response as needing attention so the merchant can follow up. The response remains part of the enrollment's evidence timeline.

### How does ScaleSafe collect evidence from outside GHL?

Evidence Connections bring verified external activity into ScaleSafe. Named integrations and the universal evidence connector match that activity to the merchant and client program.

### How are integration events matched?

ScaleSafe uses merchant authorization, client identity, program timing, resource mappings, and enrollment references to connect activity automatically. Connection Health shows the operator when a setup needs attention.

## Stripe Risk Health

### What does Stripe Risk Health show?

Stripe Risk Health brings dispute rate, evidence coverage, open exposure, repeat-client history, reason trends, and recommended actions into one operating view.

### What does Run Check do in Payment Reconciliation?

Run Check refreshes reconciliation findings and reads available processor data so the merchant can review the latest payment status.

## Evidence Connections

### Why can a connected source show no published evidence?

Connected means the merchant has authorized the source. Published evidence appears after the source sends activity that ScaleSafe can match to a client program.

## Security

### How is merchant data isolated?

ScaleSafe derives the merchant location from trusted authentication and keeps records, integrations, credentials, and queries scoped to that GoHighLevel sub-account.

### Are integration credentials shown to merchants after connection?

Sensitive credentials are encrypted or hashed as appropriate. Merchant workflows display connection status and safe account details.
