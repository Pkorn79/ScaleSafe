-- 069_ghl_native_activity_layer.sql
-- Native GHL activity tracking for appointments, invoices, and communications.
-- Stores raw GHL activity, merchant mapping rules, and first-class evidence.

CREATE TABLE IF NOT EXISTS ghl_activity_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id TEXT NOT NULL,
  contact_id TEXT,
  enrollment_id UUID,
  offer_id UUID,
  source_object TEXT NOT NULL,
  event_type TEXT NOT NULL,
  source_record_id TEXT,
  source_parent_id TEXT,
  occurred_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'unmatched',
  match_reason TEXT,
  action_taken TEXT,
  error_message TEXT,
  normalized JSONB DEFAULT '{}'::jsonb,
  raw_payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ghl_activity_unique_source
  ON ghl_activity_events(location_id, source_object, source_record_id, event_type)
  WHERE source_record_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ghl_activity_contact
  ON ghl_activity_events(location_id, contact_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_ghl_activity_unmatched
  ON ghl_activity_events(location_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ghl_activity_event_type
  ON ghl_activity_events(location_id, source_object, event_type, created_at DESC);

ALTER TABLE ghl_activity_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON ghl_activity_events
  FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS ghl_appointment_mappings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id TEXT NOT NULL,
  calendar_id TEXT NOT NULL,
  offer_id UUID,
  staff_user_id TEXT,
  title_keyword TEXT,
  appointment_type TEXT,
  delivery_role TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ghl_appt_map_location
  ON ghl_appointment_mappings(location_id, is_active, calendar_id);

CREATE INDEX IF NOT EXISTS idx_ghl_appt_map_offer
  ON ghl_appointment_mappings(location_id, offer_id);

ALTER TABLE ghl_appointment_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON ghl_appointment_mappings
  FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS evidence_appointments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  enrollment_id UUID,
  offer_id UUID,
  source TEXT DEFAULT 'ghl_calendar',
  appointment_id TEXT,
  calendar_id TEXT,
  appointment_title TEXT,
  appointment_status TEXT,
  appointment_event_type TEXT,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  assigned_user_id TEXT,
  delivery_role TEXT,
  notes TEXT,
  description TEXT,
  raw_payload JSONB,
  payment_event_id UUID,
  defense_summary TEXT,
  issuer_exhibit_title TEXT,
  proof_role TEXT,
  reason_code_tags TEXT[],
  dispute_relevance JSONB DEFAULT '{}'::jsonb,
  source_record_id TEXT,
  actor TEXT,
  defense_metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ev_appointments_contact
  ON evidence_appointments(location_id, contact_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ev_appointments_appointment_id
  ON evidence_appointments(location_id, appointment_id);

CREATE INDEX IF NOT EXISTS idx_ev_appointments_enrollment
  ON evidence_appointments(location_id, enrollment_id);

ALTER TABLE evidence_appointments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON evidence_appointments
  FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS evidence_invoices (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  enrollment_id UUID,
  offer_id UUID,
  source TEXT DEFAULT 'ghl_invoice',
  invoice_id TEXT,
  invoice_number TEXT,
  invoice_status TEXT,
  invoice_event_type TEXT,
  amount DECIMAL(10,2),
  amount_paid DECIMAL(10,2),
  currency TEXT DEFAULT 'USD',
  due_date TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  voided_at TIMESTAMPTZ,
  line_items JSONB DEFAULT '[]'::jsonb,
  description TEXT,
  raw_payload JSONB,
  payment_event_id UUID,
  defense_summary TEXT,
  issuer_exhibit_title TEXT,
  proof_role TEXT,
  reason_code_tags TEXT[],
  dispute_relevance JSONB DEFAULT '{}'::jsonb,
  source_record_id TEXT,
  actor TEXT,
  defense_metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ev_invoices_contact
  ON evidence_invoices(location_id, contact_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ev_invoices_invoice_id
  ON evidence_invoices(location_id, invoice_id);

CREATE INDEX IF NOT EXISTS idx_ev_invoices_enrollment
  ON evidence_invoices(location_id, enrollment_id);

ALTER TABLE evidence_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON evidence_invoices
  FOR ALL USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
