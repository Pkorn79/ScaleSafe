-- Migration 050: Fix client_list_view to prefer active enrollments over cancelled ones.
-- Previously used ORDER BY enrolled_at DESC, which meant a recently-cancelled enrollment
-- would represent the client even if they had other active enrollments. Now uses a
-- status priority: active/enrolled first, then paused, then pending, then completed/cancelled.

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
ORDER BY e.location_id, e.contact_id,
  CASE
    WHEN e.status IN ('enrolled', 'active') THEN 0
    WHEN e.status = 'paused' THEN 1
    WHEN e.status IN ('consent_captured', 'device_captured') THEN 2
    WHEN e.status = 'completed' THEN 3
    WHEN e.status = 'cancelled' THEN 4
    ELSE 5
  END,
  e.enrolled_at DESC NULLS LAST;
