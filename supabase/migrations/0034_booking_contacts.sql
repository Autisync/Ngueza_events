-- =====================================================================
-- 0034 — the two sides of a booking can reach each other (slice 30)
--
-- profiles_self_read lets a person read only their own profile. That is
-- right for a stranger, and it also meant a supplier's booking screen
-- showed "Cliente" and nothing else — no name, no email, no phone — even
-- for a confirmed booking. The supplier had no way to call the person who
-- was about to hold a wedding in their salão.
--
-- The policy stays as it is. The supplier learns only what this function
-- returns, about only their own bookings (CLAUDE.md: "expose the derived
-- fact through a SECURITY DEFINER function that returns only what [they]
-- may know"):
--
--   - the client's name, always — enough to recognise a request;
--   - email and phone once the supplier has accepted, at any point, this
--     booking. Before that, a stream of requests is not a contact list to
--     harvest; after it, the two of them have business to arrange.
--
-- The client's phone is what the booking form now collects (slice 30).
-- =====================================================================

create or replace function booking_client_contact(p_booking_id uuid)
returns table (full_name text, email citext, phone text, contact_shared boolean)
language sql
stable
security definer
set search_path = public
as $$
  select pr.full_name,
         case when shared then pr.email end,
         case when shared then pr.phone end,
         shared
    from bookings b
    join profiles pr on pr.id = b.client_id
    cross join lateral (
      select exists (
        select 1 from booking_events be
         where be.booking_id = b.id
           and be.to_status in ('accepted', 'awaiting_payment', 'confirmed')
      ) as shared
    ) s
   where b.id = p_booking_id
     and (owns_provider(b.provider_id) or is_admin());
$$;

comment on function booking_client_contact is
  'The client of one booking, as its supplier may see them: the name always, '
  'email and phone once the supplier has accepted. Nothing for anyone else.';

-- Supabase's default privileges grant EXECUTE on new public functions to
-- anon as well as public; revoking from public alone leaves anon able to
-- call it. It would return nothing (owns_provider is false), but a visitor
-- has no business calling it at all.
revoke all on function booking_client_contact(uuid) from public;
revoke all on function booking_client_contact(uuid) from anon;
grant execute on function booking_client_contact(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Job-only functions were callable by anyone.
--
-- 0030 and 0031 wrote "revoke all ... from public; grant ... to
-- service_role" for the two sweeps the cron job runs. Supabase's default
-- privileges grant EXECUTE on new functions in public to anon and
-- authenticated explicitly, so revoking from PUBLIC removed nothing: any
-- visitor could call them through the API. They only do what the job
-- does, early — no escalation — but a job's lever is not a public one.
-- tests/sql/06_function_grants.sql now fails the build if a SECURITY
-- DEFINER function is callable by anon without being on its allowlist.
-- ---------------------------------------------------------------------
revoke execute on function complete_past_bookings()      from anon, authenticated;
revoke execute on function expire_stale_quote_requests() from anon, authenticated;
