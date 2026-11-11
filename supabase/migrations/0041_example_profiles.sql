-- =====================================================================
-- 0041 — example profiles (slice 39)
--
-- NGUEZA asked for dummy suppliers so the marketplace does not look empty
-- while recruitment fills it. Unlabelled, they would mislead: a client
-- could request a salão that does not exist and wait for an answer that
-- never comes. So an example profile is:
--
--   - flagged (providers.is_demo) and shown as "Perfil de exemplo";
--   - never bookable — the database refuses the request;
--   - never matched to a quote request;
--   - removable in one go (scripts/remove-example-catalogue.sql).
--
-- The catalogue itself is seed/demo/10_example_catalogue.sql.
-- =====================================================================

alter table providers add column is_demo boolean not null default false;

-- The public reads it: cards and pages label example profiles.
grant select (is_demo) on providers to anon;

create or replace function bookings_guard_demo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'requested'
     and exists (select 1 from providers where id = new.provider_id and is_demo) then
    raise exception 'example profiles cannot be booked'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

create trigger bookings_guard_demo
  before insert on bookings
  for each row execute function bookings_guard_demo();

-- Redefined from 0030 with one line: examples never match a request.
create or replace function quote_request_open_and_matches(p_quote_request_id uuid, p_provider_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from quote_requests qr, providers p
     where qr.id = p_quote_request_id
       and p.id = p_provider_id
       and qr.status = 'open'
       and qr.expires_at > now()
       and (qr.event_date is null or qr.event_date >= (now() at time zone 'Africa/Luanda')::date)
       and p.is_published and p.verification_status = 'verified'
       and not p.is_demo                         -- 0041: an example cannot quote
       and p.location_id in (select id from location_descendants(qr.location_id))
       and (
         p.category_id in (select id from category_descendants(qr.category_id))
         or exists (
           select 1 from services sv
            where sv.provider_id = p.id and sv.is_active
              and sv.category_id in (select id from category_descendants(qr.category_id))
         )
       )
  );
$$;
