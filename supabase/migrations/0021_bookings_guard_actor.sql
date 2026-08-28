-- =====================================================================
-- 0021 — who may drive which booking transition (§10, §26)
--
-- Building the booking screens (slice 08) meant, for the first time,
-- writing "Accept" and "Reject" buttons for a supplier — and testing
-- what stops a CLIENT from calling the same underlying transition. The
-- answer was nothing. bookings_party_update (0011) only checks that the
-- actor is A PARTY to the booking — client_id = auth.uid() OR
-- owns_provider(provider_id) — never which transition that specific
-- party is allowed to make. Confirmed directly, as the real
-- `authenticated` role rather than a superuser connection (which
-- bypasses RLS regardless of role and gave a false negative on the first
-- attempt): a client could set their own booking straight to 'accepted'
-- and then 'confirmed', with zero supplier action.
--
-- bookings_guard_transition (0006) already enforces the state GRAPH —
-- that requested -> confirmed directly is illegal. It has never enforced
-- who may walk a legal edge. This is that second, missing check, and it
-- is spec/states.md's "Who may trigger what" table turned into code
-- rather than only documentation an application layer could ignore.
-- =====================================================================

create or replace function bookings_guard_actor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is not distinct from old.status then
    return new;                              -- not a transition, nothing to check
  end if;

  if auth.uid() is null then
    return new;                              -- service_role: the expiry job, a future
                                              -- payment webhook. Never reachable from a
                                              -- browser (lib/db.ts's asSystem is not).
  end if;

  -- 'expired' is JOB ONLY per spec/states.md — deliberately with no
  -- admin exception. A person deciding a date is free again is a
  -- cancellation, which is attributable to whoever made it; 'expired'
  -- means specifically that nobody acted in time.
  if new.status = 'expired' then
    raise exception 'expired is set only by the scheduled job, never a person'
      using errcode = 'insufficient_privilege';
  end if;

  if is_admin() then
    return new;                              -- admin may drive every other transition
  end if;

  if new.status in ('accepted', 'rejected', 'awaiting_payment', 'confirmed',
                     'completed', 'no_show', 'cancelled_provider')
     and owns_provider(old.provider_id) then
    return new;
  end if;

  if new.status = 'cancelled_client' and old.client_id = auth.uid() then
    return new;
  end if;

  raise exception 'booking transition to % is not this actor''s to make', new.status
    using errcode = 'insufficient_privilege';
end $$;

-- Postgres fires same-timing triggers on one table in NAME order, and
-- 'bookings_guard_actor' sorts BEFORE 'bookings_guard_transition' and
-- 'bookings_set_shape' — this runs first, not after them. That is
-- exactly the ordering mistake that made bookings_enforce_concurrency
-- read blocks_calendar before bookings_set_shape had set it (0006).
-- Checked deliberately here: this trigger reads only OLD.provider_id and
-- OLD.client_id, which no earlier-or-later trigger in the chain ever
-- rewrites, and NEW.status, which is exactly what the caller supplied —
-- so firing order genuinely does not matter for this one. It would if
-- this ever needed a value another BEFORE trigger derives.
create trigger bookings_guard_actor
  before update on bookings
  for each row execute function bookings_guard_actor();
