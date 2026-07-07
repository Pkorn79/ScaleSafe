# GHL Workflow Trigger Payload Contract

Status: beta source of truth for customer workflow copy.

ScaleSafe workflows should use Marketplace trigger custom variables first. Contact custom fields remain useful for profile display and backup, but they are not safe as the primary source for money emails because one contact can have multiple active programs.

## Message Intent Rules

- `ss_payment_received` sends receipts only.
- `ss_send_enrollment_link` sends enrollment packet links only.
- `enrollment_complete` sends welcome/access only after terms and signature are complete.
- `ss_payment_failed` sends failed-payment/dunning messages only.
- `ss_refund_processed` sends refund confirmation only.
- `ss_app_event` handles shared app events such as upcoming payment reminders, filtered by `event_type`.
- `ss_pulse_check_due` sends pulse check links. The legacy `ss_app_event` + `event_type = pulse_check_due` path is supported during beta transition only.

Do not use `enrollment_complete` for receipt copy.

## `ss_payment_received`

Use for paid-in-full, installment, subscription, quick/manual sale, dunning recovery, and recurring receipts.

Customer copy should be payment confirmation only. Do not include course access, onboarding, welcome copy, or an enrollment packet link.

Canonical payload variables:

- `program_name`
- `offer_name`
- `amount`
- `amount_display`
- `payment_kind`
- `payment_source`
- `payment_timing`
- `processor`
- `payment_number`
- `payments_total`
- `payments_remaining`
- `running_total`
- `running_total_display`
- `transaction_id`
- `support_email`
- `business_name`
- `enrollment_id`
- `offer_id`
- `send_receipt`
- `send_welcome`
- `receipt_only`

Expected guardrails:

- `send_receipt = true`
- `send_welcome = false`
- `receipt_only = true`

## `ss_send_enrollment_link`

Use to send an enrollment packet link after a merchant sends a link or after manual card payment when the merchant chooses to send the packet.

Customer copy should only ask the client to complete the enrollment packet. Do not include receipt copy or welcome/access copy.

Canonical payload variables:

- `enrollment_url`
- `program_name`
- `offer_name`
- `payment_status`
- `enrollment_status`
- `amount`
- `contact_id`
- `enrollment_id`
- `offer_id`
- `first_name`
- `last_name`
- `email`
- `phone`
- `send_welcome`

Expected guardrail:

- `send_welcome = false`

## `enrollment_complete`

Use for welcome/access/onboarding after the enrollment is finalized.

Customer copy should assume terms/signature are complete. Do not include payment receipt copy.

Canonical payload variables:

- `program_name`
- `offer_name`
- `enrollment_id`
- `offer_id`
- `contact_id`
- `amount`
- `payment_type`
- `pay_first`
- `payment_already_received`
- `access_ready`
- `support_email`
- `business_name`
- `send_receipt`
- `send_welcome`

Expected guardrails:

- `send_receipt = false`
- `send_welcome = true`
- `access_ready = true`

## `ss_app_event` with `event_type = upcoming_payment_reminder`

Use for upcoming payment reminders.

Canonical payload variables:

- `event_type`
- `program_name`
- `offer_name`
- `amount`
- `amount_display`
- `payment_amount`
- `payment_amount_display`
- `installment_amount`
- `installment_amount_display`
- `next_billing_date`
- `next_billing_date_display`
- `next_payment_date`
- `next_payment_date_display`
- `next_payment_number`
- `payment_number`
- `payment_number_display`
- `payments_made`
- `payments_total`
- `total_payments`
- `number_of_payments`
- `payments_remaining`
- `days_until_payment`
- `reminder_window`
- `processor`
- `support_email`
- `merchant_support_email`
- `offer_support_email`
- `business_name`
- `merchant_business_name`
- `offer_business_name`
- `enrollment_id`
- `offer_id`

Recommended GHL reminder template fields:

- Amount: `amount_display` or `payment_amount_display`
- Next payment date: `next_payment_date_display`
- Payment number: `payment_number`
- Total payments: `total_payments`
- Support email: `support_email`
- Business name/signature: `business_name`

## `ss_pulse_check_due`

Use for pulse check invitations during active enrollments.

Canonical payload variables:

- `event_type`
- `event_type_key`
- `program_name`
- `offer_name`
- `form_url`
- `pulse_check_url`
- `pulse_interval_label`
- `pulse_due_date_display`
- `due_date_display`
- `support_email`
- `merchant_support_email`
- `business_name`
- `merchant_business_name`
- `enrollment_id`
- `offer_id`
- `contact_id`

Recommended GHL pulse template fields:

- Program: `program_name` or `offer_name`
- Pulse interval: `pulse_interval_label`
- Pulse link: `pulse_check_url` or `form_url`
- Support email: `support_email`
- Business name/signature: `business_name`

Proof rule:

- A `sent` row in `trigger_delivery_logs` proves ScaleSafe delivered the pulse event to GHL.
- It does not prove the customer received an email/SMS. Confirm GHL workflow history, outbound activity, received message proof, and submitted pulse evidence separately.

## `ss_payment_failed`

Use for failed payment and dunning messages.

Canonical payload variables:

- `amount`
- `amount_display`
- `failure_reason`
- `attempt_count`
- `next_retry_date`
- `dunning_stage`
- `contact_id`

Current `dunning_stage` values:

- `initial` - first failed recurring payment / dunning started
- `retry_failed` - a retry failed but another retry may still be scheduled
- `escalated` - max retries reached; merchant should follow up manually
- `card_update_requested` - merchant manually sent a card update link

## `ss_refund_processed`

Use for refund confirmation messages.

Canonical payload variables:

- `amount`
- `amount_display`
- `refund_type`
- `reason`
- `contact_id`

## GHL Editing Rule

When editing GHL workflow emails/SMS, use Marketplace trigger custom variables first. Do not add new contact custom fields just to satisfy email copy unless the app also needs that field on the contact record outside the email.
