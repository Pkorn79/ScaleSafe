# GHL Workflow Trigger Payload Contract

Status: beta source of truth for money workflow copy.

ScaleSafe payment workflows should prefer Marketplace trigger custom variables from the trigger payload. Contact custom fields remain useful for profile display and backup, but they are not safe as the primary source for money emails because one contact can have multiple active programs.

## `ss_payment_received`

Use for paid-in-full, installment, subscription, and recurring receipts.

Canonical payload variables:

- `program_name`
- `offer_name`
- `amount`
- `amount_display`
- `payment_kind`
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

## `ss_upcoming_payment_reminder`

Use for 3-day and 1-day upcoming payment reminders.

Canonical payload variables:

- `program_name`
- `offer_name`
- `amount`
- `amount_display`
- `installment_amount`
- `next_billing_date`
- `next_payment_number`
- `payments_made`
- `payments_total`
- `payments_remaining`
- `days_until_payment`
- `reminder_window`
- `processor`
- `support_email`
- `business_name`
- `enrollment_id`
- `offer_id`

## `ss_payment_failed`

Use for failed payment and dunning messages.

Canonical payload variables:

- `amount`
- `amount_display`
- `failure_reason`
- `attempt_count`
- `next_retry_date`
- `contact_id`

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
