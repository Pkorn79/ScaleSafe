-- 022_payment_infrastructure_alters.sql — Phase A: Extend existing tables for dual-rail payments
--
-- Adds payment processor columns to merchants and offers_mirror.
-- Extends payment_events with fields needed for NMI/Stripe processing.

-- ============================================================
-- MERCHANTS: processor defaults + Stripe Connect status
-- ============================================================
ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS default_processor TEXT CHECK (default_processor IN ('nmi', 'stripe')),
  ADD COLUMN IF NOT EXISTS stripe_connected BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS stripe_user_id TEXT,
  ADD COLUMN IF NOT EXISTS payment_provider_registered BOOLEAN DEFAULT false;

-- ============================================================
-- OFFERS_MIRROR: per-offer processor routing
-- ============================================================
ALTER TABLE offers_mirror
  ADD COLUMN IF NOT EXISTS processor_override TEXT CHECK (processor_override IN ('nmi', 'stripe')),
  ADD COLUMN IF NOT EXISTS nmi_processor_id TEXT;

-- ============================================================
-- PAYMENT_EVENTS: extend for dual-rail + evidence linkage
-- ============================================================

-- Add merchant_id FK (existing table only has location_id)
ALTER TABLE payment_events
  ADD COLUMN IF NOT EXISTS merchant_id UUID REFERENCES merchants(id);

-- Update processor CHECK to allow nmi and stripe values
-- Drop old constraint, add new one
DO $$
BEGIN
  -- Only alter if the constraint doesn't already include 'nmi'
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payment_events_processor_check_v2'
  ) THEN
    -- Drop old check if exists (may have different name)
    ALTER TABLE payment_events DROP CONSTRAINT IF EXISTS payment_events_processor_check;
    -- Add updated check
    ALTER TABLE payment_events ADD CONSTRAINT payment_events_processor_check_v2
      CHECK (processor IN ('nmi', 'stripe', 'ghl'));
  END IF;
END $$;

-- Update event_type CHECK to support new types
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payment_events_event_type_check_v2'
  ) THEN
    ALTER TABLE payment_events DROP CONSTRAINT IF EXISTS payment_events_event_type_check;
    ALTER TABLE payment_events ADD CONSTRAINT payment_events_event_type_check_v2
      CHECK (event_type IN (
        'sale', 'auth', 'capture', 'void', 'refund',
        'payment_failed', 'subscription_created', 'subscription_cancelled',
        'subscription_payment'
      ));
  END IF;
END $$;

-- Additional columns for dual-rail processing
ALTER TABLE payment_events
  ADD COLUMN IF NOT EXISTS processor_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS payments_total INTEGER,
  ADD COLUMN IF NOT EXISTS failure_code TEXT,
  ADD COLUMN IF NOT EXISTS consent_token TEXT,
  ADD COLUMN IF NOT EXISTS evidence_id UUID,
  ADD COLUMN IF NOT EXISTS ip_address TEXT,
  ADD COLUMN IF NOT EXISTS device_info TEXT,
  ADD COLUMN IF NOT EXISTS browser_info TEXT;

-- New indexes for payment_events
CREATE INDEX IF NOT EXISTS idx_payment_events_contact ON payment_events(location_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_payment_events_processor_tx ON payment_events(processor_transaction_id);
CREATE INDEX IF NOT EXISTS idx_payment_events_consent ON payment_events(consent_token);
