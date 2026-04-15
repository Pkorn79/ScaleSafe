-- 041: Client list performance view + indexes.
-- One row per contact (most recent enrollment), with card-on-file and last-activity.
-- Replaces the N+1 evidence-health endpoint for the Clients list page.

CREATE OR REPLACE VIEW client_list_view AS
SELECT DISTINCT ON (e.location_id, e.contact_id)
  e.location_id,
  e.contact_id,
  e.id AS enrollment_id,
  e.email,
  e.first_name,
  e.last_name,
  e.digital_signature,
  e.status,
  e.payment_type,
  e.payment_amount,
  e.payments_made,
  e.payments_total,
  e.next_billing_date,
  e.enrolled_at,
  e.current_milestone,
  e.offer_id,
  o.offer_name,
  EXISTS(
    SELECT 1 FROM payment_methods pm
    WHERE pm.contact_id = e.contact_id
      AND pm.location_id = e.location_id
      AND pm.is_default = true
  ) AS has_card,
  (
    SELECT MAX(ev.created_at) FROM evidence ev
    WHERE ev.contact_id = e.contact_id
      AND ev.location_id = e.location_id
  ) AS last_activity_date
FROM enrollments e
LEFT JOIN offers_mirror o ON e.offer_id = o.id
WHERE e.contact_id IS NOT NULL
  AND e.contact_id != ''
ORDER BY e.location_id, e.contact_id, e.enrolled_at DESC NULLS LAST;

-- Indexes for fast view queries
CREATE INDEX IF NOT EXISTS idx_enrollments_loc_status_contact
  ON enrollments (location_id, status, contact_id);

CREATE INDEX IF NOT EXISTS idx_evidence_contact_created
  ON evidence (location_id, contact_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_methods_contact_default
  ON payment_methods (location_id, contact_id, is_default);
