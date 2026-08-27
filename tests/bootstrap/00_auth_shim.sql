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
