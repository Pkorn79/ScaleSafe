-- 040: Add next_billing_date to enrollments for upcoming payment reminders.
-- Set by completeEnrollment for installment/subscription offers.
-- Updated by handleRecurringPayment after each successful charge.
-- Scanned daily by payment-reminder-check job (3-day lookahead).

ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS next_billing_date DATE;
