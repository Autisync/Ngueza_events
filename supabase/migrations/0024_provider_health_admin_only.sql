-- =====================================================================
-- 0024 — provider_health was readable by anyone, including anon (§48)
-- =====================================================================
--
-- Found while building slice 14 (the admin metrics dashboard) and
-- verified before writing a single line of dashboard code: provider_health
-- (0010) is a plain view with no `security_invoker`, so — per Postgres's
-- default for views — it runs with the privileges of its OWNER (the
-- migration role) against bookings and booking_events, not the querying
-- role's. Both of those tables have real RLS policies scoping who may see
-- a booking; the view ignores every one of them.
--
--   set local role anon;
--   select set_config('request.jwt.claims', '', true);
--   select count(*) from provider_health;
--   -- 6 rows. Every supplier's answered/expired/completed counts,
--   -- response time and staleness flag, to a visitor who isn't even
--   -- signed in.
--
-- This one was already live: 0010 shipped in an earlier slice, so this is
-- a real exposure on the deployed project until this migration lands,
-- not a caught-before-shipping gap like 0021's and 0022's. Deployed and
-- verified immediately for that reason, ahead of the rest of slice 14.
--
-- The fix is not `security_invoker = true` — that would make the view
-- correctly RLS-scoped per caller, but a non-admin's "correct" view of
-- provider_health is still nobody's business: this is aggregate business
-- performance data across every supplier, exactly the kind of derived
-- fact CLAUDE.md says to gate behind a SECURITY DEFINER function that
-- returns only what the caller may know — here, "nothing at all, unless
-- you are an administrator" rather than a per-row filter.
revoke select on provider_health from anon, authenticated;

create or replace function admin_provider_health()
returns setof provider_health
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'provider_health is administrator-only'
      using errcode = 'insufficient_privilege';
  end if;
  return query select * from provider_health;
end $$;
