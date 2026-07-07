# GHL Trigger Workflow Setup

Use one GHL workflow per message intent. Do not combine receipt copy and welcome/access copy in the same trigger.

## Payment Receipt

- GHL trigger name: Payment Received
- ScaleSafe key: `ss_payment_received`
- Purpose: receipt/payment confirmation only
- Include: amount, program, transaction ID, payment count, billing support info
- Do not include: welcome copy, course access, onboarding, enrollment packet link
- Important fields: `program_name`, `amount_display`, `payment_kind`, `payment_source`, `payment_timing`, `transaction_id`, `payment_number`, `payments_total`, `payments_remaining`, `support_email`, `business_name`

## Enrollment Packet Link

- GHL trigger name: Send Enrollment Link
- ScaleSafe key: `ss_send_enrollment_link`
- Purpose: send the packet/signature link only
- Include: `enrollment_url`, program name, simple instruction to complete enrollment
- Do not include: receipt copy, welcome/access copy
- Important fields: `enrollment_url`, `program_name`, `offer_name`, `payment_status`, `enrollment_status`, `amount`, `first_name`, `email`

## Welcome / Access

- GHL trigger name: Enrollment Complete
- ScaleSafe key: `enrollment_complete`
- Purpose: welcome, onboarding, course/access delivery after terms/signature are complete
- Include: access instructions, next steps, support info
- Do not include: payment receipt copy
- Important fields: `program_name`, `offer_name`, `enrollment_id`, `contact_id`, `pay_first`, `payment_already_received`, `access_ready`, `support_email`, `business_name`

## Payment Failed

- GHL trigger name: Payment Failed
- ScaleSafe key: `ss_payment_failed`
- Purpose: failed payment or dunning message
- Important fields: `amount_display`, `failure_reason`, `attempt_count`, `next_retry_date`, `dunning_stage`, `program_name`, `support_email`
- Recommended workflow split:
  - First failed payment: filter `dunning_stage = initial`
  - Escalation: filter `dunning_stage = escalated`
  - Card update link: filter `dunning_stage = card_update_requested`

## Refund Processed

- GHL trigger name: Refund Processed
- ScaleSafe key: `ss_refund_processed`
- Purpose: refund confirmation only
- Important fields: `amount_display`, `refund_type`, `reason`, `transaction_id`, `program_name`

## Upcoming Payment Reminder

- GHL trigger name: ScaleSafe App Event
- ScaleSafe key: `ss_app_event`
- Required workflow branch/filter: `event_type = upcoming_payment_reminder`
- Purpose: reminder before recurring/installment payment
- Important fields: `program_name`, `amount_display`, `next_billing_date`, `next_payment_number`, `payments_remaining`, `support_email`

## Pulse Check Due

- GHL trigger name: ScaleSafe App Event
- ScaleSafe key: `ss_app_event`
- Required workflow branch/filter: Event Type shown as `Pulse Check Due` in GHL. Payload value is `event_type = pulse_check_due`.
- Purpose: send the pulse check link during an active enrollment
- Important fields: `program_name`, `offer_name`, `pulse_check_url`, `form_url`, `pulse_interval_label`, `pulse_due_date_display`, `support_email`, `business_name`, `enrollment_id`, `offer_id`
- Beta note: a dedicated `ss_pulse_check_due` trigger is deferred until GHL/Marketplace support is proven. For beta, the working path is the shared `ScaleSafe App Event` trigger filtered to `Pulse Check Due`.
- Proof rule: ScaleSafe trigger logs prove app-event delivery to GHL only. A completed pulse proof also needs GHL workflow execution, outbound email/SMS activity, received message proof, and submitted pulse evidence.

## Expected Message Timing

- Full enrollment: `ss_payment_received` sends the receipt and `enrollment_complete` sends welcome/access.
- Manual card payment then enrollment: `ss_payment_received` sends receipt immediately; `ss_send_enrollment_link` sends packet if selected; `enrollment_complete` sends welcome/access only after the client signs.
- Quick payment only: `ss_payment_received` sends receipt only.
- Recurring payment: `ss_payment_received` sends receipt only.
