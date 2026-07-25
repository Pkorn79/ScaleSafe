\set ON_ERROR_STOP on

-- ISOLATED DATABASE ONLY.

INSERT INTO merchants (
  location_id,
  business_name,
  status,
  snapshot_status,
  onboarding_complete,
  marketplace_plan_key,
  marketplace_billing_status
) VALUES
  ('cc-auth-assigned', 'Assigned Authorization Merchant', 'active', 'installed', true, 'standard', 'complete'),
  ('cc-auth-unassigned', 'Unassigned Authorization Merchant', 'active', 'installed', true, 'standard', 'complete');

INSERT INTO operator_organizations (
  id,
  organization_type,
  name,
  status,
  external_reference
) VALUES
  ('20000000-0000-4000-8000-000000000001', 'reseller', 'Phase 2 Reseller A', 'active', 'phase2-reseller-a'),
  ('20000000-0000-4000-8000-000000000002', 'reseller', 'Phase 2 Reseller B', 'active', 'phase2-reseller-b');

INSERT INTO auth.users (id) VALUES
  ('20000000-0000-4000-8000-000000000011'),
  ('20000000-0000-4000-8000-000000000012'),
  ('20000000-0000-4000-8000-000000000013'),
  ('20000000-0000-4000-8000-000000000014');

INSERT INTO operator_users (
  id,
  auth_user_id,
  email_normalized,
  display_name,
  status
) VALUES
  ('20000000-0000-4000-8000-000000000021', '20000000-0000-4000-8000-000000000011', 'phase2-owner@scalesafe.test', 'Phase 2 Owner', 'active'),
  ('20000000-0000-4000-8000-000000000022', '20000000-0000-4000-8000-000000000012', 'phase2-ops@scalesafe.test', 'Phase 2 Operations', 'active'),
  ('20000000-0000-4000-8000-000000000023', '20000000-0000-4000-8000-000000000013', 'phase2-reseller@scalesafe.test', 'Phase 2 Reseller', 'active'),
  ('20000000-0000-4000-8000-000000000024', '20000000-0000-4000-8000-000000000014', 'phase2-support@scalesafe.test', 'Phase 2 Support', 'active');

INSERT INTO operator_memberships (
  id,
  organization_id,
  operator_user_id,
  role,
  status
)
SELECT
  membership.id,
  membership.organization_id,
  membership.operator_user_id,
  membership.role,
  'active'
FROM (
  VALUES
    (
      '20000000-0000-4000-8000-000000000031'::uuid,
      (SELECT id FROM operator_organizations WHERE organization_type = 'platform'),
      '20000000-0000-4000-8000-000000000021'::uuid,
      'platform_owner'::text
    ),
    (
      '20000000-0000-4000-8000-000000000032'::uuid,
      (SELECT id FROM operator_organizations WHERE organization_type = 'platform'),
      '20000000-0000-4000-8000-000000000022'::uuid,
      'platform_ops'::text
    ),
    (
      '20000000-0000-4000-8000-000000000033'::uuid,
      '20000000-0000-4000-8000-000000000001'::uuid,
      '20000000-0000-4000-8000-000000000023'::uuid,
      'reseller_operator'::text
    ),
    (
      '20000000-0000-4000-8000-000000000034'::uuid,
      (SELECT id FROM operator_organizations WHERE organization_type = 'platform'),
      '20000000-0000-4000-8000-000000000024'::uuid,
      'platform_support'::text
    )
) AS membership(id, organization_id, operator_user_id, role);

INSERT INTO reseller_merchant_assignments (
  reseller_organization_id,
  location_id,
  merchant_id,
  status,
  assigned_by_operator_user_id,
  reason
)
SELECT
  '20000000-0000-4000-8000-000000000001',
  merchant.location_id,
  merchant.id,
  'active',
  '20000000-0000-4000-8000-000000000021',
  'Phase 2 authorization verification'
FROM merchants merchant
WHERE merchant.location_id = 'cc-auth-assigned';

INSERT INTO operator_support_grants (
  id,
  grantee_operator_user_id,
  location_id,
  permission_bundle,
  reason,
  status,
  starts_at,
  expires_at,
  requested_by_operator_user_id,
  approved_by_operator_user_id,
  approved_at
) VALUES (
  '20000000-0000-4000-8000-000000000041',
  '20000000-0000-4000-8000-000000000024',
  'cc-auth-assigned',
  'merchant_support_read',
  'Phase 2 authorization verification',
  'active',
  clock_timestamp() - interval '1 minute',
  clock_timestamp() + interval '1 hour',
  '20000000-0000-4000-8000-000000000022',
  '20000000-0000-4000-8000-000000000021',
  clock_timestamp()
);

INSERT INTO operator_sessions (
  id,
  session_token_hash,
  csrf_token_hash,
  operator_user_id,
  organization_id,
  membership_id,
  auth_assurance,
  idle_expires_at,
  absolute_expires_at
)
SELECT
  session.id,
  encode(extensions.digest(convert_to(session.token, 'UTF8'), 'sha256'), 'hex'),
  repeat(session.csrf_character, 64),
  session.operator_user_id,
  membership.organization_id,
  membership.id,
  'aal2',
  clock_timestamp() + interval '1 hour',
  clock_timestamp() + interval '8 hours'
FROM (
  VALUES
    ('20000000-0000-4000-8000-000000000051'::uuid, 'phase2-owner-session', 'a', '20000000-0000-4000-8000-000000000021'::uuid),
    ('20000000-0000-4000-8000-000000000052'::uuid, 'phase2-reseller-session', 'b', '20000000-0000-4000-8000-000000000023'::uuid),
    ('20000000-0000-4000-8000-000000000053'::uuid, 'phase2-support-session', 'c', '20000000-0000-4000-8000-000000000024'::uuid),
    ('20000000-0000-4000-8000-000000000054'::uuid, 'phase2-revoked-session', 'd', '20000000-0000-4000-8000-000000000021'::uuid)
) AS session(id, token, csrf_character, operator_user_id)
JOIN operator_memberships membership
  ON membership.operator_user_id = session.operator_user_id
 AND membership.status = 'active';

