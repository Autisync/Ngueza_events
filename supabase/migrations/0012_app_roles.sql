-- =====================================================================
-- 0012 — application roles
--
-- Row-level security only protects anything if the application connects
-- as a restricted role. A server route holding a superuser connection
-- bypasses every policy in 0011 silently.
--
-- These mirror the roles Supabase provides (anon / authenticated /
-- service_role), created here so local and CI environments behave
-- identically to production. Broad table grants are correct in this
-- model: RLS does the gating, GRANT only opens the door to the policy.
-- =====================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;

-- anon: can read public content, and can write only where a policy says
-- so — joining the waitlist and emitting analytics events. Every other
-- insert is refused by RLS because auth.uid() is null.
grant select, insert on all tables in schema public to anon;

-- authenticated: full DML surface, gated entirely by RLS.
grant select, insert, update, delete on all tables in schema public to authenticated;

-- service_role has BYPASSRLS, which skips policies but NOT grant checks.
-- Without these it cannot read its own tables.
grant all on all tables in schema public to service_role;

grant usage, select on all sequences in schema public to anon, authenticated;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;

alter default privileges in schema public
  grant select, insert on tables to anon;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant all on tables to service_role;
alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;

-- The audit trail is never writable through a session role; only the
-- SECURITY DEFINER trigger writes it.
revoke insert, update, delete on booking_events from anon, authenticated;

-- Webhooks are handled server-side with the service role only.
revoke all on payment_events from anon, authenticated;
