-- Migration 113: A contact with a payment is a client without a program enrollment.
-- Read-only visibility change: no payments, enrollments, or workflows are created.
BEGIN;
CREATE OR REPLACE VIEW public.client_list_view WITH (security_invoker = true) AS
WITH enrolled_clients AS (
  SELECT DISTINCT ON (e.location_id, e.contact_id)
    e.location_id, e.contact_id, e.id AS enrollment_id, e.email,
    e.first_name, e.last_name, e.digital_signature, e.status,
    e.payment_type, e.payment_amount, e.payments_made, e.payments_total,
    e.next_billing_date, e.enrolled_at, e.current_milestone, e.offer_id,
    o.offer_name,
    EXISTS (SELECT 1 FROM public.payment_methods pm
      WHERE pm.location_id = e.location_id AND pm.contact_id = e.contact_id
        AND pm.is_default = true) AS has_card,
    (SELECT MAX(ev.created_at) FROM public.evidence ev
      WHERE ev.location_id = e.location_id AND ev.contact_id = e.contact_id) AS last_activity_date
  FROM public.enrollments e
  LEFT JOIN public.offers_mirror o ON o.id = e.offer_id AND o.location_id = e.location_id
  WHERE NULLIF(e.contact_id, '') IS NOT NULL
  ORDER BY e.location_id, e.contact_id,
    CASE WHEN e.status IN ('enrolled', 'active') THEN 0
      WHEN e.status = 'paused' THEN 1
      WHEN e.status IN ('consent_captured', 'device_captured') THEN 2
      WHEN e.status = 'completed' THEN 3 WHEN e.status = 'cancelled' THEN 4 ELSE 5 END,
    e.enrolled_at DESC NULLS LAST, e.created_at DESC, e.id
), payment_clients AS (
  SELECT DISTINCT ON (p.location_id, p.contact_id)
    p.location_id, p.contact_id, NULL::uuid AS enrollment_id,
    COALESCE(NULLIF(p.customer_email, ''), p.raw_webhook_payload->>'customer_email',
      p.raw_webhook_payload->>'email') AS email,
    p.raw_webhook_payload->>'first_name' AS first_name,
    p.raw_webhook_payload->>'last_name' AS last_name,
    NULL::text AS digital_signature, 'active'::text AS status,
    'manual_sale'::text AS payment_type, p.amount::numeric(10,2) AS payment_amount,
    0::integer AS payments_made, NULL::integer AS payments_total,
    NULL::date AS next_billing_date, NULL::timestamptz AS enrolled_at,
    0::integer AS current_milestone, NULL::uuid AS offer_id, NULL::text AS offer_name,
    EXISTS (SELECT 1 FROM public.payment_methods pm
      WHERE pm.location_id = p.location_id AND pm.contact_id = p.contact_id
        AND pm.is_default = true) AS has_card,
    p.created_at AS last_activity_date
  FROM public.payment_events p
  WHERE NULLIF(p.contact_id, '') IS NOT NULL
    AND p.event_type IN ('sale', 'payment_success', 'subscription_payment', 'capture')
    AND COALESCE(p.payment_status, 'succeeded') NOT IN ('failed', 'declined', 'canceled', 'cancelled')
    AND NOT EXISTS (SELECT 1 FROM public.enrollments e
      WHERE e.location_id = p.location_id AND e.contact_id = p.contact_id)
  ORDER BY p.location_id, p.contact_id, p.created_at DESC NULLS LAST, p.id
)
SELECT * FROM enrolled_clients
UNION ALL
SELECT * FROM payment_clients;
REVOKE ALL ON public.client_list_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.client_list_view TO service_role;
COMMIT;
