-- Phase 5 security diagnostic.
-- Run this in Supabase SQL editor to see the exact tables/grants that can
-- produce rls_disabled_in_public or sensitive_columns_exposed warnings.

-- 1. Public tables with RLS disabled.
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relrowsecurity = false
ORDER BY c.relname;

-- 2. Public-schema table privileges granted to anon/authenticated/public.
SELECT
  table_schema,
  table_name,
  grantee,
  privilege_type
FROM information_schema.table_privileges
WHERE table_schema = 'public'
  AND grantee IN ('anon', 'authenticated', 'PUBLIC')
ORDER BY table_name, grantee, privilege_type;

-- 3. Sensitive-looking columns exposed through table grants.
SELECT
  c.table_schema,
  c.table_name,
  c.column_name,
  tp.grantee,
  tp.privilege_type
FROM information_schema.columns c
JOIN information_schema.table_privileges tp
  ON tp.table_schema = c.table_schema
 AND tp.table_name = c.table_name
WHERE c.table_schema = 'public'
  AND tp.grantee IN ('anon', 'authenticated', 'PUBLIC')
  AND (
    c.column_name ILIKE '%token%'
    OR c.column_name ILIKE '%secret%'
    OR c.column_name ILIKE '%key%'
    OR c.column_name ILIKE '%email%'
    OR c.column_name ILIKE '%phone%'
    OR c.column_name ILIKE '%ip%'
  )
ORDER BY c.table_name, c.column_name, tp.grantee;
