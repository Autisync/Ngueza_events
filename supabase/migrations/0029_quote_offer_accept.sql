-- =====================================================================
-- 0029 — a client can accept a quote offer (slice 20 follow-up)
--
-- The connection the Gap Analysis flagged as missing: quote_offers had
-- no path from "here's a price" to "I'm taking it" — a client accepting
-- had to go click through to the supplier's normal profile and book
-- separately, at whatever price happened to be live there, not the
-- quoted one. This adds the one missing status transition.
--
-- Deliberately does NOT auto-create a booking. A quote request captures
-- category/location/date, never which specific resource (a multi-room
-- venue) or service the offer was for — bookings.resource_id/service_id
-- need a real choice this table was never designed to make for the
-- client. Accepting records the decision and closes the request; the
-- client still completes the booking through the existing, already-
-- correct flow on the supplier's own page, now with the agreed price
-- as context rather than a guess.
-- =====================================================================

alter table quote_offers drop constraint quote_offers_status_check;
alter table quote_offers add constraint quote_offers_status_check
  check (status in ('submitted', 'withdrawn', 'accepted'));

-- The requester may update any offer on their own request — the trigger
-- below is what actually limits *what* that update may do. Permissive
-- policies combine with OR, so this sits alongside
-- quote_offers_supplier_withdraw (0027) without touching it.
create policy quote_offers_requester_decide on quote_offers
  for update using (owns_quote_request(quote_request_id))
  with check (owns_quote_request(quote_request_id));

-- Replaces 0027's quote_offers_guard_withdraw_only with one that knows
-- about two actors instead of one: a supplier may still only withdraw
-- their own live offer, and now a requester may accept or decline a
-- live offer on their own request — in a single statement, so accepting
-- offer A and declining B/C on the same request is one UPDATE, not
-- three round trips with their own race condition between them.
drop trigger quote_offers_guard_withdraw_only on quote_offers;
drop function quote_offers_guard_withdraw_only();

create or replace function quote_offers_guard_transitions()
returns trigger language plpgsql as $$
begin
  if is_admin() then
    return new;
  end if;

  if (
    new.quote_request_id is distinct from old.quote_request_id or
    new.provider_id      is distinct from old.provider_id or
    new.price_minor      is distinct from old.price_minor or
    new.message           is distinct from old.message or
    new.created_at        is distinct from old.created_at
  ) then
    raise exception 'an offer''s own terms may not be edited'
      using errcode = 'insufficient_privilege';
  end if;

  if owns_provider(old.provider_id) then
    if old.status = 'submitted' and new.status = 'withdrawn' then
      return new;
    end if;
    raise exception 'an offer may only be withdrawn, not edited'
      using errcode = 'insufficient_privilege';
  end if;

  if owns_quote_request(old.quote_request_id) then
    if old.status = 'submitted' and new.status in ('accepted', 'withdrawn') then
      return new;
    end if;
    raise exception 'a requester may only accept or decline a live offer'
      using errcode = 'insufficient_privilege';
  end if;

  raise exception 'not permitted' using errcode = 'insufficient_privilege';
end $$;

create trigger quote_offers_guard_transitions
  before update on quote_offers
  for each row execute function quote_offers_guard_transitions();
