-- =====================================================================
-- 0014 — public availability, without exposing bookings
--
-- §9 requires that a client can see immediately whether a date is free.
-- But bookings are private: who booked what, when, and for how much is
-- visible only to the two parties and an administrator (0011).
--
-- Those two requirements collide in search. Computing availability with
-- an inline `not exists (select ... from bookings)` as an anonymous
-- visitor silently returns TRUE for every date, because RLS hides the
-- very rows the check depends on — so every venue looks free and the
-- calendar lies. No error, no warning; just wrong answers.
--
-- The fix is to expose exactly one bit through a SECURITY DEFINER
-- function. A visitor learns "free" or "not free" and nothing else — no
-- client, no price, no reason. That is precisely what a public
-- availability calendar must reveal anyway.
-- =====================================================================

create or replace function resource_is_free(
  p_resource_id uuid,
  p_from        timestamptz,
  p_to          timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1
      from bookings b
     where b.resource_id = p_resource_id
       and b.status = any (booking_occupying_statuses())
       and tstzrange(b.starts_at, b.ends_at) && tstzrange(p_from, p_to)
  );
$$;

comment on function resource_is_free is
  'Public availability for one bookable space. Returns a boolean only — '
  'booking details stay private. Used by search and the profile calendar.';

grant execute on function resource_is_free(uuid, timestamptz, timestamptz)
  to anon, authenticated;
