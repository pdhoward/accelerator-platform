-- Explicit grants for the Data API (Supabase change: tables created in "public" no longer get
-- privileges by default; without a GRANT, supabase-js and PostgREST answer "permission denied").
--
-- Who needs what: the Accelerator's API reaches every table through PostgREST with the
-- service_role key. The console uses Supabase only for sign-in (Auth) and never reads a table,
-- so anon and authenticated get NO table privileges here, on purpose: granting them would expose
-- tables (the vault, the audit log) to anyone holding the public anon key.
--
-- Idempotent: safe on accelerator-test (it restates what exists) and required on any fresh
-- project (production at go-live, preview branches, a local `supabase db reset`).
--
-- Convention from here on: every migration that creates a table ends with
--   grant select, insert, update, delete on public.<table> to service_role;

-- Every existing table in public.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('grant select, insert, update, delete on public.%I to service_role', t.tablename);
  end loop;
end $$;

-- Sequences behind identity and serial columns (inserts).
grant usage, select on all sequences in schema public to service_role;

-- Functions in public (none are called through the API today; kept for completeness).
grant execute on all functions in schema public to service_role;

-- Tables, sequences and functions created later by the migration role get the same, as a safety net
-- for a migration that forgets its grant.
alter default privileges for role postgres in schema public grant select, insert, update, delete on tables to service_role;
alter default privileges for role postgres in schema public grant usage, select on sequences to service_role;
alter default privileges for role postgres in schema public grant execute on functions to service_role;

-- To check what is exposed: Supabase dashboard → Project Settings → Data API, or
--   select table_name, privilege_type from information_schema.role_table_grants
--   where grantee in ('anon','authenticated') and table_schema = 'public';
-- (expected: no rows)
