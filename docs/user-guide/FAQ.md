# ScaleSafe Frequently Asked Questions

Status: Working draft. Answers are expanded as live workflows are verified.

## General

### What is ScaleSafe?

ScaleSafe helps high-ticket and mixed-ticket service businesses collect enrollment, payment, fulfillment, communication, and client-engagement evidence throughout the customer relationship. It organizes that evidence for operational visibility and chargeback response.

### Does ScaleSafe guarantee that a merchant will avoid or win every chargeback?

No. A customer can still file a chargeback, and the issuing bank decides the outcome. ScaleSafe helps reduce avoidable disputes and improves the merchant's ability to present organized, relevant evidence.

### Does ScaleSafe replace GoHighLevel?

No. ScaleSafe runs inside a GoHighLevel sub-account and uses GHL for selected workflows, contacts, communication, and fulfillment activity.

## Installation

### Is ScaleSafe installed once per agency or once per sub-account?

Each merchant installation is bound to a specific GHL sub-account. ScaleSafe must not combine or expose records across sub-accounts.

### Can an agency install ScaleSafe for multiple sub-accounts?

Yes. Each installation remains independently tenant-bound even when several sub-accounts belong to the same agency.

### Why does an already-installed account show Unable to Connect?

The message can mean that the installation or GHL authorization is missing, but the current beta screen can also appear when ScaleSafe's database or another required service is temporarily unavailable. Do not immediately uninstall the app. First confirm the GHL sub-account, ScaleSafe service health, Railway error trace, and merchant binding. Reinstall only after ScaleSafe support confirms that the location binding or authorization is actually missing or revoked.

## Payments

### Which payment channels does ScaleSafe support?

The active beta channels are Stripe, NMI, and Whop. Available actions differ by processor and by the identifiers returned from that processor.

### Does ScaleSafe store complete card numbers?

No. ScaleSafe uses processor-hosted or tokenized payment methods and displays only appropriate masked payment details.

### Can a merchant issue refunds from ScaleSafe?

Eligible Stripe, NMI, and Whop payments can be refunded when ScaleSafe has the processor identifier required for that action. ScaleSafe records the refund only after the processor confirms it.

### How should a merchant choose between two saved NMI methods with the same label?

Do not guess. A saved method must show enough masked identity, such as the last four digits, to confirm the authorized card. The current certification account contains historical NMI methods that both display as `NMI mc` and whose stored last four is unavailable. No saved-method charge should be attempted from those entries until the UI and data can identify the intended method safely.

### What is Payment Reconciliation?

Reconciliation flags records that are difficult to prove against processor truth, such as missing subscription IDs, overdue billing, unassigned payments, processor mismatches, duplicates, and recent failures. It is a diagnostic view; it does not silently repair or charge anything.

### Why is a payment listed as unassigned?

ScaleSafe received or recorded the payment but could not tie it to one exact program enrollment. The payment remains visible, but it should not be presented as proof for an unrelated enrollment.

## Evidence

### What evidence can ScaleSafe collect?

Evidence may include consent, accepted terms, payment history, milestones, pulse responses, appointments, attendance, messages, files, service access, course progress, deliverables, refunds, cancellations, and verified third-party activity.

### Is every appointment proof that a service was delivered?

No. A scheduled appointment is engagement evidence. Attendance or completion is stronger delivery evidence.

### Why must evidence be linked to a program or enrollment?

A defense packet must explain the disputed transaction and the client journey associated with that transaction. Contact-wide activity should not be presented as though it belongs to an unrelated program.

### What does Link to Program mean?

The activity belongs to the client, but ScaleSafe does not yet have a safe, unique enrollment match. The record remains client-level context until it can be linked defensibly. ScaleSafe does not choose the newest enrollment merely because it is newest.

### How is an email sent from the client profile linked to a program?

ScaleSafe includes the selected enrollment with the outbound message. It can use the sole eligible enrollment; when several programs are eligible, the merchant chooses the intended program. General client correspondence can remain client-level and should not be presented as proof for an unrelated enrollment.

### Are old test communications part of evidence?

Captured communications remain in the historical timeline. Test accounts can therefore contain outdated templates or test messages that should not be used as public demonstrations or relied on in a real defense packet.

## Defense

### What does Needs Review mean?

ScaleSafe could not safely treat the packet as submission-ready. This may happen when the transaction cannot be tied to one exact enrollment, required evidence is missing, or the AI draft was unavailable. The merchant must review the packet before submission.

### Does ScaleSafe submit every defense automatically?

No. Submission behavior depends on processor support and the merchant's authorized workflow. A packet may be compiled without being submitted.

### Is the displayed response deadline always the processor deadline?

No. ScaleSafe may initialize a deadline using the card network's maximum window. The processor can require an earlier response, so the merchant should enter the exact due date shown in the processor portal.

### What happens after a packet is submitted?

The merchant records the submission state and later records the bank's outcome. ScaleSafe uses the outcome for operational reporting; it does not control the bank's decision.

## Pulse and Fulfillment

### What happens when a client requests follow-up in a pulse response?

The dashboard surfaces the response as needing attention so the merchant can follow up. The response remains part of the enrollment's evidence timeline.

### Can ScaleSafe collect evidence from outside GHL?

Yes. Evidence Connections support verified external activity. Named integrations and the universal evidence connector must resolve events to the correct merchant and enrollment before publishing evidence.

### Does a merchant need to repair every unmatched integration event?

No. ScaleSafe is designed to automate matching when there is one defensible enrollment. Ambiguous events stay out of enrollment evidence and should be handled as an integration-health issue, not as a recurring merchant cleanup task.

## Stripe Risk Health

### Why can a sandbox dispute rate look extreme?

Test accounts often contain very few transactions and many deliberate dispute tests. A small denominator can produce a rate that would not represent a live merchant. Read the page as connected-account test data, not as a prediction.

### Can merchants rely on Stripe Risk Health scores?

The page now reads Stripe-scoped health data and the normalized prevention audit. It is an operational summary, not a card-network ruling or prediction. Stripe remains the source of truth for the connected account, and sandbox/test-heavy rates should not be interpreted as normal live performance.

### Does Run Check in Payment Reconciliation change payment records?

No. The verified check recalculates diagnostic warnings and may read connected processor data, but it does not silently charge, refund, cancel, or repair a record.

## Evidence Connections

### Why can a connected source show no published evidence?

Connected proves authorization, not activity. The source must send an event, ScaleSafe must observe it, and the event must match one exact enrollment before it becomes evidence. Ambiguous or test events remain diagnostic and do not publish to the client timeline.

## Security

### Can one merchant see another merchant's information?

No. ScaleSafe derives the merchant location from trusted authentication and keeps tenant-owned queries scoped to that location.

### Are integration credentials shown to merchants after connection?

Sensitive credentials are encrypted or hashed as appropriate and are not displayed in normal merchant workflows.
