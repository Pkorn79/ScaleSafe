-- 028_payment_evidence_integration.sql — Phase G: Payment-enrollment-evidence linkage

-- Extend payment_events for evidence chain
ALTER TABLE payment_events
  ADD COLUMN IF NOT EXISTS offer_id UUID,
  ADD COLUMN IF NOT EXISTS processor_charge_id TEXT,
  ADD COLUMN IF NOT EXISTS payment_method_type TEXT,
  ADD COLUMN IF NOT EXISTS payment_method_last4 TEXT,
  ADD COLUMN IF NOT EXISTS customer_email TEXT,
  ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS installment_number INTEGER,
  ADD COLUMN IF NOT EXISTS total_installments INTEGER,
  ADD COLUMN IF NOT EXISTS evidence_data JSONB,
  ADD COLUMN IF NOT EXISTS consent_linked BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS consent_ip_match BOOLEAN,
  ADD COLUMN IF NOT EXISTS ghl_order_id TEXT,
  ADD COLUMN IF NOT EXISTS ghl_transaction_id TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'checkout';

-- Extend enrollment_packets for payment linkage
ALTER TABLE enrollment_packets
  ADD COLUMN IF NOT EXISTS payment_event_id UUID,
  ADD COLUMN IF NOT EXISTS payment_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS enrollment_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
