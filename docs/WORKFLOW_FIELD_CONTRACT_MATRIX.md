# Workflow Field Contract Matrix

**Created:** 2026-05-07  
**Location audited:** PMG / `274dtgl30b7x2HG8hn69`  
**Purpose:** Pre-snapshot source of truth for the field contract between ScaleSafe, GHL workflow templates, and PMG custom fields.

For the concrete workflow-by-workflow repair list extracted from the Claude/Oke DOCX files, see `docs/GHL_WORKFLOW_TEMPLATE_REPAIR_PLAN.md`.

## Decision

Current workflows win for beta. Instead of making Philip manually rebuild every GHL workflow email/SMS before snapshot, the app now provisions and writes the workflow-compatible fields the current templates already expect.

The app writes both canonical fields and compatibility aliases before the relevant workflow trigger fires. Custom values are separate from custom fields and are not part of the custom-field cleanup/delete pass.

## Sources Compared

- Live PMG GHL custom fields: 118 returned by GHL API on 2026-05-07.
- Live PMG GHL custom values: 22 returned by GHL API on 2026-05-07.
- App-written field constants/code: `src/constants/ghl-fields.ts`, enrollment/payment services.
- Workflow instruction docs:
  - `ScaleSafe_Communication_Workflows_Build_Guide.docx`
  - `ScaleSafe_Workflows_Build_Guide_ADDENDUM.docx`
  - `Oke_GHL_Workflow_Buildsheet.docx`
- Live PMG workflow metadata: 35 workflows returned by GHL API on 2026-05-07.

## Canonical Offer Fields

These exist in PMG and are written by the app at enrollment time.

| Canonical field | PMG status | Notes |
|---|---:|---|
| `{{contact.offer_business_name}}` | Exists | Merchant business/DBA name copied to contact. |
| `{{contact.offer_name}}` | Exists | Program/offer name. |
| `{{contact.offer_price}}` | Exists | Formatted total offer price. |
| `{{contact.offer_payment_type}}` | Exists | Paid in full, Installment, Subscription, or Free. |
| `{{contact.offer_installment_amount}}` | Exists | Formatted per-payment/billing amount. |
| `{{contact.offer_installment_frequency}}` | Exists | Formatted billing frequency. |
| `{{contact.offer_num_payments}}` | Exists | Total number of installment payments where applicable. |

The app also writes workflow-compatible aliases such as `{{contact.offer_program_name}}`, `{{contact.offer_price_display}}`, `{{contact.offer_number_of_payments}}`, and `{{contact.offer_support_email}}` so existing PMG templates render without a manual rewrite pass.

## Workflow Compatibility Aliases

These appeared in the original workflow build guide and are now intentionally provisioned/written by the app for beta.

| Workflow field | App value |
|---|---|
| `{{contact.offer_program_name}}` | Same as `{{contact.offer_name}}`. |
| `{{contact.offer_price_display}}` | Same formatted value as `{{contact.offer_price}}`. |
| `{{contact.offer_number_of_payments}}` | Same as `{{contact.offer_num_payments}}`. |
| `{{contact.offer_support_email}}` | Merchant support email copied from merchant config. |
| `{{contact.offer_refund_policy}}` | Offer refund policy/terms when available. |
| `{{contact.offer_tc_document_url}}` | Merchant/location terms URL when available. |

`{{contact.first_name}}`, `{{contact.last_name}}`, `{{contact.email}}`, and `{{contact.phone}}` are native contact fields, not custom fields. They are valid even though they are not in the custom-field inventory.

## Optional Future Workflow Template Edits

The following copy is still a cleaner long-term direction, but it is no longer a beta blocker because the app now writes the compatibility aliases.

### SS - Welcome Sequence

Subject:

```text
Welcome to {{contact.offer_name}}!
```

Client email body should use:

```text
Hi {{contact.first_name}},

Welcome to {{contact.offer_name}} with {{contact.offer_business_name}}.

Your enrollment is confirmed.

Program: {{contact.offer_name}}
Payment type: {{contact.offer_payment_type}}

If you have questions, contact {{custom_values.merchant_support_email}}.

Thank you,
{{contact.offer_business_name}}
```

Client SMS should use:

```text
Hi {{contact.first_name}}! Welcome to {{contact.offer_name}}. Your enrollment is confirmed. {{contact.offer_business_name}} will be in touch soon.
```

Merchant notification should use:

```text
New client enrolled.

Client: {{contact.first_name}} {{contact.last_name}}
Email: {{contact.email}}
Phone: {{contact.phone}}
Program: {{contact.offer_name}}
Payment type: {{contact.offer_payment_type}}

Log in to ScaleSafe to view the enrollment details.
```

### SS - Enrollment Payment Receipt

Subject:

```text
Payment Receipt - {{contact.offer_name}}
```

Client email body should use:

```text
Hi {{contact.first_name}},

This confirms your payment for {{contact.offer_name}}.

Program: {{contact.offer_name}}
Payment type: {{contact.offer_payment_type}}
Amount: {{contact.offer_price}}

If you selected an installment plan:
Installment amount: {{contact.offer_installment_amount}}
Frequency: {{contact.offer_installment_frequency}}
Number of payments: {{contact.offer_num_payments}}

If you have any billing questions, contact {{custom_values.merchant_support_email}}.

Thank you,
{{contact.offer_business_name}}
```

### SS - Recurring Payment Reciept

Subject:

```text
Payment Receipt - {{contact.offer_name}}
```

Client email body should use:

```text
Hi {{contact.first_name}},

This confirms we have received your payment for {{contact.offer_name}}.

Amount: {{contact.ss_last_payment_amount}}
Date: {{contact.ss_last_payment_date}}
Payments made: {{contact.ss_payments_made}}
Payments remaining: {{contact.ss_payments_remaining}}

If you have billing questions, contact {{custom_values.merchant_support_email}}.

Thank you,
{{contact.offer_business_name}}
```

### Any Other Workflow

Search the workflow body, SMS body, subject, internal notification, and branch conditions for:

- `offer_program_name`
- `offer_price_display`
- `offer_number_of_payments`
- `offer_support_email`
- `offer_refund_policy`
- `offer_tc_document_url`

Replace them using the table above.

## Review Fields

These fields exist in PMG and appear in workflow docs, but this audit did not prove a current app writer for each field. They should be verified workflow-by-workflow before snapshot export.

| Field | Reason to review |
|---|---|
| `{{contact.ss_chargeback_reason_code}}` | Used by chargeback workflow docs; verify dispute/chargeback code writes it. |
| `{{contact.ss_current_milestone_name}}` | Used by milestone workflows; verify milestone trigger path writes it before workflow fires. |
| `{{contact.ss_defense_packet_url}}` | Used by defense-ready workflow; verify defense generation writes it. |
| `{{contact.ss_defense_pdf_url}}` | Exists live; verify whether beta needs it. |
| `{{contact.ss_failed_payment_count}}` | Used by failed-payment workflow branches; verify dunning path writes it. |
| `{{contact.ss_last_failed_payment_date}}` | Used by payment escalation copy; verify dunning path writes it. |
| `{{contact.ss_last_payment_amount}}` | Used by recurring receipt; verify recurring success path writes it. |
| `{{contact.ss_last_payment_date}}` | Used by recurring receipt; verify recurring success path writes it. |
| `{{contact.ss_no_show_count}}` | Used by no-show workflow; verify evidence logger or app updates it. |
| `{{contact.ss_payments_made}}` | Used by recurring receipt; verify payment success path writes it. |
| `{{contact.ss_payments_remaining}}` | Used by recurring receipt; verify payment success path writes it. |
| `{{contact.ss_refund_amount}}` | Used by refund workflow; verify refund path writes it. |
| `{{contact.ss_refund_date}}` | Used by refund workflow; verify refund path writes it. |
| `{{contact.ss_refund_transaction_id}}` | Used by refund workflow; verify refund path writes it. |
| `{{contact.ss_remaining_balance}}` | Exists live; verify whether beta needs it. |
| `{{contact.ss_signoff_milestone_name}}` | Used by milestone sign-off confirmation; verify sign-off path writes it. |
| `{{contact.ss_total_paid}}` | Used by payment workflows; verify payment success path writes it. |

## Live Workflow Metadata Snapshot

The GHL API can read workflow metadata but does not expose full email/SMS action bodies through the endpoint available to this session. Exact body verification still requires manual GHL UI review.

| Workflow | Status | Notes |
|---|---:|---|
| `SS - Welcome Sequence` | Published | Reset by Philip 2026-05-07; enrollment trigger now fires. Must edit stale merge fields. |
| `SS - Enrollment Payment Receipt` | Published | Fires. Must edit stale merge fields. |
| `SS - Recurring Payment Reciept` | Published | Spelling in GHL is `Reciept`; consider correcting before snapshot if safe. Verify SS payment fields populate. |
| `SS - Post Payment Actions` | Draft | Keep only if confirmed V2 and needed. |
| `SS--Pulse-Check-Cadence` | Published | Old tag/timer-driven pulse cadence. Exclude/retire in favor of app-owned `SS - Pulse Check Due` pattern. |
| Evidence logger workflows `SYS2-*` / `WF - 02` | Published | Must use `https://dashboard.scalesafe.app/webhooks/ghl/forms` plus `x-scalesafe-webhook-secret`. |

## Snapshot Gate

Before exporting the beta snapshot:

1. Workflow-compatible custom fields must exist and render in PMG.
2. Run Settings > Provisioning Health > Repair Fields in PMG and in a fresh sandbox install so missing workflow-compatible custom fields are created.
3. Run free, installment, and subscription enrollments.
4. Confirm `trigger_delivery_logs` shows `sent`/2xx for Welcome and Payment Receipt subscriptions.
5. Confirm rendered emails show offer name, payment type, amount, installment amount/frequency, payment count, business name, and support email.
6. Confirm PMG contact record has canonical offer fields populated after enrollment.
