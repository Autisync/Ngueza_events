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

create table if not exists auth.users (
  id    uuid primary key,
  email text
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
create or replace function tests_user(p_id uuid, p_email text, p_role text default 'client')
returns uuid language plpgsql as $$
begin
  insert into auth.users (id, email) values (p_id, p_email) on conflict (id) do nothing;
  insert into profiles (id, email, role) values (p_id, p_email, p_role)
    on conflict (id) do nothing;
  return p_id;
end $$;
