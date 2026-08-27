-- =====================================================================
-- Test-only shim.
--
-- In production Supabase supplies the `auth` schema, `auth.users` and
-- `auth.uid()`. CI runs against plain Postgres for speed, so this
-- recreates the minimum needed to exercise RLS.
--
-- NEVER applied to a real environment. Lives outside supabase/migrations
-- for exactly that reason.
-- =====================================================================

create schema if not exists auth;

-- Mirrors the columns 0016's triggers read. Not the whole GoTrue schema,
-- only the parts this system depends on.
create table if not exists auth.users (
  id                 uuid primary key,
  email              text,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb not null default '{}',
  raw_app_meta_data  jsonb not null default '{}'
);

-- Mirrors Supabase: reads the subject from the request's JWT claims.
-- The inner nullif matters: logged out, the setting is '' and a bare
-- ''::jsonb throws. Anonymous access is the most-exercised RLS path, so
-- it has to return null cleanly rather than error.
create or replace function auth.uid()
returns uuid language sql stable as $$
  select nullif(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub',
    ''
  )::uuid;
$$;

-- Test helpers: become a user, or become anonymous.
create or replace function tests_login_as(p_user uuid)
returns void language sql as $$
  select set_config('request.jwt.claims',
                    json_build_object('sub', p_user)::text, true);
$$;

create or replace function tests_logout()
returns void language sql as $$
  select set_config('request.jwt.claims', '', true);
$$;

-- ---------------------------------------------------------------------
-- Create an identity the way production does: an auth user first, then
-- the profile that points at it (0015). plpgsql defers name resolution,
-- so this can reference `profiles` before the migrations create it.
-- ---------------------------------------------------------------------
-- The role goes in raw_app_meta_data, which is exactly how production
-- assigns one: only the service role can write it, so a user cannot
-- register themselves as an administrator. The 0016 trigger then creates
-- the profile, so these fixtures exercise the real provisioning path
-- rather than a parallel one that could drift from it.
create or replace function tests_user(p_id uuid, p_email text, p_role text default 'client')
returns uuid language plpgsql as $$
begin
  insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data)
  values (p_id, p_email, now(), jsonb_build_object('app_role', p_role))
  on conflict (id) do nothing;
  return p_id;
end $$;

-- ---------------------------------------------------------------------
-- Real Supabase already grants the service role access to the auth
-- schema. Locally the shim owns it, so grant the same thing — otherwise
-- tests that provision identities fail with "permission denied for
-- schema auth", which looks like an RLS problem and is not one.
--
-- The roles come from migration 0012, so this runs after migrations.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant usage on schema auth to service_role;
    grant select, insert, update, delete on auth.users to service_role;
  end if;
end $$;
