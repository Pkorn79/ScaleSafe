-- 038: Add 'subscription' as a payment_type option on offers_mirror.
-- Subscription = ongoing recurring billing with no fixed end date.
-- Different from installments which have a set number of payments.

-- Drop and recreate the CHECK constraint to add 'subscription'
ALTER TABLE offers_mirror DROP CONSTRAINT IF EXISTS offers_mirror_payment_type_check;
ALTER TABLE offers_mirror ADD CONSTRAINT offers_mirror_payment_type_check
  CHECK (payment_type IN ('one_time', 'installments', 'subscription'));
