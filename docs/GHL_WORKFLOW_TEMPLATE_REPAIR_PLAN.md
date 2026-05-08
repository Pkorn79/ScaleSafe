# GHL Workflow Template Repair Plan

**Created:** 2026-05-07
**Purpose:** Turn the Claude/Oke workflow instruction docs into a concrete beta snapshot repair list.

This file exists so Philip does not have to manually audit every workflow template. Codex extracted the merge fields from the source DOCX files, compared them to the app-written fields, and classified what needs to change before snapshot export.

## Sources Used

- `ScaleSafe_Communication_Workflows_Build_Guide.docx`
- `ScaleSafe_Workflows_Build_Guide_ADDENDUM.docx`
- `Oke_GHL_Workflow_Buildsheet.docx`
- `Oke_GHL_Form_Setup_Instructions.docx`
- `src/constants/ghl-fields.ts`
- `src/services/phase2Enrollment.service.ts`
- `src/services/recurring-payment.service.ts`
- `src/services/payment-lifecycle.service.ts`
- Live PMG GHL custom field/value inventory from location `274dtgl30b7x2HG8hn69`

HighLevel's Marketplace trigger docs confirm that trigger payload data can be defined as custom variables for workflow use, and filters/custom variables are configured from the trigger sample payload:

- https://marketplace.gohighlevel.com/docs/marketplace-modules/CustomTriggers/index.html
- https://help.gohighlevel.com/support/solutions/articles/155000001024-marketplace-workflow-triggers

## Plain English Decision

For beta, current workflows win. ScaleSafe now creates and writes the fields the existing workflow docs/templates expect, so Philip does not have to manually rebuild every email/SMS before snapshot.

The app writes both canonical offer fields and workflow-compatible aliases before `enrollment_complete` workflows fire.

For payment and refund events after enrollment, the 2026-05-08 implementation added app-side contact field sync immediately before firing the related workflow triggers. Milestone, defense, and some evidence-detail workflows still need runtime proof before those fields should be treated as beta-clean.

## Global Compatibility Rules

These fields can remain in workflow subject lines, emails, SMS, internal notifications, filters, or conditions because the app now provisions and writes them for beta.

| Field from docs | Beta status | App value |
|---|---|---|
| `{{contact.offer_program_name}}` | Keep for beta | Same as offer name. |
| `{{contact.offer_price_display}}` | Keep for beta | Same formatted value as offer price. |
| `{{contact.offer_number_of_payments}}` | Keep for beta | Same as offer num payments. |
| `{{contact.offer_support_email}}` | Keep for beta | Merchant support email copied to contact. |
| `{{contact.offer_refund_policy}}` | Keep for beta | Offer refund terms when available. |
| `{{contact.offer_tc_document_url}}` | Keep for beta | Merchant/location terms URL when available. |

Native contact fields are valid:

- `{{contact.first_name}}`
- `{{contact.last_name}}`
- `{{contact.email}}`
- `{{contact.phone}}`

## App-Written Contact Fields Confirmed

These are provisioned by the app and written by `phase2Enrollment.service.ts` before `enrollment_complete` triggers fire:

| Field | App write timing |
|---|---|
| `{{contact.offer_business_name}}` | Before enrollment complete workflows. |
| `{{contact.offer_name}}` | Before enrollment complete workflows. |
| `{{contact.offer_price}}` | Before enrollment complete workflows. |
| `{{contact.offer_payment_type}}` | Before enrollment complete workflows. |
| `{{contact.offer_installment_amount}}` | Before enrollment complete workflows. |
| `{{contact.offer_installment_frequency}}` | Before enrollment complete workflows. |
| `{{contact.offer_num_payments}}` | Before enrollment complete workflows. |
| `{{contact.ss_enrollment_status}}` | Enrollment status updates. |
| `{{contact.ss_last_evidence_date}}` | Enrollment/evidence touchpoints. |
| `{{contact.ss_engagement_status}}` | Set to active when engagement is enabled. |

These are provisioned but should not be used for detailed payment/refund copy unless the app explicitly writes them before the workflow fires:

- `{{contact.ss_evidence_score}}`
- `{{contact.ss_chargeback_status}}`
- `{{contact.ss_defense_status}}`

## Fields From Source Docs And Beta Writer Status

These appeared in the workflow docs. Payment/refund fields are now provisioned and written by the app before the matching trigger fires. Milestone/defense/evidence-detail fields are provisioned for beta compatibility, but still need feature-path proof before workflow copy should depend on them.

| Field | Current beta decision |
|---|---|
| `{{contact.ss_current_milestone_name}}` | Provisioned, but do not rely on it until milestone/signoff app path proves a writer. |
| `{{contact.ss_signoff_milestone_name}}` | Provisioned, but do not rely on it until signoff app path proves a writer. |
| `{{contact.ss_no_show_count}}` | Provisioned, but still needs no-show writer proof. |
| `{{contact.ss_last_payment_amount}}` | Provisioned and written before enrollment/recurring/payment-success triggers. |
| `{{contact.ss_last_payment_date}}` | Provisioned and written before enrollment/recurring/payment-success triggers. |
| `{{contact.ss_payments_made}}` | Provisioned and written before enrollment/recurring/payment-success triggers. |
| `{{contact.ss_payments_remaining}}` | Provisioned and written before enrollment/recurring/payment-success triggers. |
| `{{contact.ss_total_paid}}` | Provisioned and written by payment-success/recurring paths where totals are available. |
| `{{contact.ss_failed_payment_count}}` | Provisioned and written before failed-payment/dunning triggers. |
| `{{contact.ss_last_failed_payment_date}}` | Provisioned and written before failed-payment/dunning triggers. |
| `{{contact.ss_refund_amount}}` | Provisioned and written before refund triggers. |
| `{{contact.ss_refund_date}}` | Provisioned and written before refund triggers. |
| `{{contact.ss_refund_transaction_id}}` | Provisioned and written before refund triggers when a transaction id is available. |
| `{{contact.ss_chargeback_reason_code}}` | Defense/dispute path needs proof before workflow copy relies on it. |
| `{{contact.ss_defense_packet_url}}` | Defense path needs proof before workflow copy relies on it. |
| `{{contact.ss_defense_pdf_url}}` | Do not rely on it for beta unless defense generation proves writer. |

## Workflow-by-Workflow Fix List

### SS - Welcome Sequence

Source doc fields:

- `{{contact.first_name}}`
- `{{contact.last_name}}`
- `{{contact.email}}`
- `{{contact.phone}}`
- `{{contact.offer_business_name}}`
- `{{contact.offer_payment_type}}`
- `{{contact.offer_program_name}}`
- `{{contact.offer_support_email}}`

Beta handling:

- Keep the existing fields. The app now creates/writes `offer_program_name` and `offer_support_email` before the workflow fires.

Status: ready after Repair Fields and live enrollment proof.

### SS - Enrollment Payment Receipt

Source doc fields:

- `{{contact.first_name}}`
- `{{contact.offer_business_name}}`
- `{{contact.offer_installment_amount}}`
- `{{contact.offer_installment_frequency}}`
- `{{contact.offer_number_of_payments}}`
- `{{contact.offer_payment_type}}`
- `{{contact.offer_price_display}}`
- `{{contact.offer_program_name}}`
- `{{contact.offer_support_email}}`

Beta handling:

- Keep the existing fields. The app now creates/writes `offer_program_name`, `offer_price_display`, `offer_number_of_payments`, and `offer_support_email` before the workflow fires.

Status: ready after Repair Fields and live enrollment proof.

### SS - Recurring Payment Reciept

Source doc fields:

- `{{contact.first_name}}`
- `{{contact.last_name}}`
- `{{contact.offer_business_name}}`
- `{{contact.offer_program_name}}`
- `{{contact.offer_support_email}}`
- `{{contact.ss_last_payment_amount}}`
- `{{contact.ss_last_payment_date}}`
- `{{contact.ss_payments_made}}`
- `{{contact.ss_payments_remaining}}`

Beta handling:

- Keep the existing fields. The app now writes the offer aliases and payment contact fields before `ss_payment_received` fires.

Current app payload:

- `amount`
- `transaction_id`
- `payments_remaining`
- `running_total`
- `payment_kind`

Status: ready after Repair Fields and live recurring-payment proof.

### SS - Payment Failed - First Attempt

Source doc fields:

- `{{contact.first_name}}`
- `{{contact.last_name}}`
- `{{contact.offer_business_name}}`
- `{{contact.offer_program_name}}`
- `{{contact.offer_support_email}}`
- `{{contact.ss_failed_payment_count}}`

Beta handling:

- Keep the existing fields. The app now writes the offer aliases and failed-payment fields before failed-payment/dunning triggers.

Current app payload:

- `amount`
- `failure_reason`
- `attempt_count`
- `next_retry_date`

Status: ready after a failed-payment test proves rendered values.

### SS - Payment Failed - Escalation

Source doc fields:

- `{{contact.first_name}}`
- `{{contact.last_name}}`
- `{{contact.offer_business_name}}`
- `{{contact.offer_program_name}}`
- `{{contact.offer_support_email}}`
- `{{contact.ss_failed_payment_count}}`
- `{{contact.ss_last_failed_payment_date}}`

Beta handling:

- Keep the existing fields. The app now writes the offer aliases and failed-payment fields before failed-payment/dunning triggers.

Status: ready after a failed-payment escalation test proves rendered values.

### SS - Refund Processed

Source doc fields:

- `{{contact.first_name}}`
- `{{contact.last_name}}`
- `{{contact.offer_business_name}}`
- `{{contact.offer_program_name}}`
- `{{contact.offer_support_email}}`
- `{{contact.ss_refund_amount}}`
- `{{contact.ss_refund_date}}`
- `{{contact.ss_refund_transaction_id}}`

Beta handling:

- Keep the existing fields. The app now writes the offer aliases and refund fields before refund triggers.

Current app payload:

- `amount`
- `refund_type`
- `reason`

Status: ready after a refund test proves rendered values.

### SS - Cancellation Acknowledgment

Source doc fields:

- `{{contact.first_name}}`
- `{{contact.last_name}}`
- `{{contact.offer_business_name}}`
- `{{contact.offer_program_name}}`
- `{{contact.offer_refund_policy}}`
- `{{contact.offer_support_email}}`
- `{{contact.offer_tc_document_url}}`

Beta handling:

- Keep the existing fields. The app now provisions/writes the offer aliases, refund policy, and T&C document URL where available.

Status: ready after cancellation-path proof.

### SS - Program Completion

Source doc fields:

- `{{contact.first_name}}`
- `{{contact.last_name}}`
- `{{contact.offer_business_name}}`
- `{{contact.offer_program_name}}`
- `{{contact.ss_total_paid}}`

Beta handling:

- Keep the existing fields. The app provisions/writes `offer_program_name` and writes payment totals in payment-success/recurring paths where totals are available.

Current app payloads include completion totals in some paths:

- `total_amount`
- `total_paid`
- `completed_at`

Status: needs final-installment/program-completion proof.

### Milestone Workflows

Applies to:

- `SS - Milestone Sign-Off Request`
- `SS - Milestone Sign-Off Confirmation`

Source doc fields:

- `{{contact.first_name}}`
- `{{contact.last_name}}`
- `{{contact.offer_business_name}}`
- `{{contact.offer_program_name}}`
- `{{contact.offer_support_email}}`
- `{{contact.ss_current_milestone_name}}`
- `{{contact.ss_signoff_milestone_name}}`

Beta handling:

- Offer/support aliases are now provisioned/written. Milestone `contact.ss_*` fields are provisioned but still need signoff-path proof before beta snapshot.

Status: not beta-clean until milestone runtime is verified or copy is made generic.

### Session / Module / No-Show / Re-Engagement Workflows

Applies to:

- `SS - Session Reminder`
- `SS - Session Follow-Up`
- `SS - No-Show Follow-Up`
- `SS - Module Completion Congrats`
- `SS - Re-Engagement Outreach`

Beta handling:

- Offer/support aliases are now provisioned/written. `ss_no_show_count` still needs no-show writer proof or generic copy.

Status: offer/support fields are beta-compatible after Repair Fields; detailed no-show count should be removed, proven, or deferred.

### Defense / Chargeback Workflows

Applies to:

- `SS - Chargeback Alert`
- `SS - Defense Ready`
- `SS - Defense Deadline Reminder`
- `SS - Chargeback Ratio Warning`
- `SS - Chargeback Ratio Critical`

Beta handling:

- Offer aliases are now provisioned/written. Do not rely on `{{contact.ss_chargeback_reason_code}}`, `{{contact.ss_defense_packet_url}}`, or `{{contact.ss_defense_pdf_url}}` until the defense path proves writers.

Status:

- Ratio warning/critical now have an app job path, but rendered template fields still need verification.
- Defense-ready copy should use trigger payload packet/readiness values if exposed, or app must write contact fields before firing.

### SS - Send Enrollment Link Delivery

Source addendum fields:

- `{{offer_name}}`
- `{{offer_price}}`
- `{{enrollment_url}}`
- `{{send_via}}`
- `{{custom_values.merchant_business_name}}`
- `{{custom_values.merchant_support_email}}`

Fix:

- Do not use `{{custom_value.ss_offer_name}}`; use `{{offer_name}}` if the trigger variable is available.
- If GHL does not expose flat trigger variables in the email action, add app-side contact field sync before firing this workflow.

Status: needs live editor verification of trigger variables.

## What Philip/Oke Should Not Spend Time Doing

- Do not manually compare every field to the app.
- Do not manually rebuild templates only to replace the offer/payment aliases; the app now creates and writes them for beta.
- Do not keep blank `contact.ss_*` merge fields in email/SMS copy.

## What Still Requires GHL UI Work

GHL's available API access exposed workflow metadata and trigger subscriptions, but not the actual email/SMS action bodies. The GHL editor is still needed only when rendered tests prove a workflow body uses a field that is not beta-supported.

The UI task is no longer an audit or broad rewrite. It is only targeted repair after live tests:

1. Run Repair Fields.
2. Run the test enrollment/payment that matches the workflow.
3. If a rendered email/SMS is blank, open that workflow.
4. Repair only the failing field/copy.
5. Publish and retest.

## Snapshot Gate

Before snapshot export:

- Run Settings > Provisioning Health > Repair Fields in PMG and fresh sandbox.
- Welcome and Enrollment Payment Receipt must render complete values.
- Recurring receipt must render app-written contact fields.
- Failed payment/refund/cancellation workflows must not contain blank unsupported fields.
- Milestone/defense workflows must be marked either beta-ready or deferred.
- `trigger_delivery_logs` must show successful sends for the tested workflows.
