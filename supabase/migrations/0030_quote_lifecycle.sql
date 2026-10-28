-- =====================================================================
-- 0030 — the quote lifecycle, finished
--
-- Found in the competitive review (bugs B25, B26, B45):
--
-- 1. Losing offers were marked 'withdrawn' when the client accepted
--    another one, so a supplier who lost looked as if they had pulled
--    out themselves. They are now 'declined'.
-- 2. The winning supplier was never told. A quote_offer_accepted
--    notification now goes to them.
-- 3. Quote requests never expired: 'expired' and expires_at existed but
--    nothing ever set them. expire_stale_quote_requests() does, called
--    from the existing /api/cron/expire sweep, and the matching function
--    stops treating a past-expiry request as open even if the job lags.
-- 4. At most one accepted offer per request, enforced by the database.
-- =====================================================================

-- ---- 1. 'declined' --------------------------------------------------
alter table quote_offers drop constraint quote_offers_status_check;
alter table quote_offers add constraint quote_offers_status_check
  check (status in ('submitted', 'withdrawn', 'accepted', 'declined'));

-- Offers that lost to an accepted offer before this migration were
-- written as 'withdrawn' by the requester's accept. Re-label them: the
-- accepted sibling on the same request is the evidence.
update quote_offers lost
   set status = 'declined'
 where lost.status = 'withdrawn'
   and exists (
     select 1 from quote_offers won
      where won.quote_request_id = lost.quote_request_id
        and won.status = 'accepted'
   );

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
    if old.status = 'submitted' and new.status in ('accepted', 'declined') then
      return new;
    end if;
    raise exception 'a requester may only accept or decline a live offer'
      using errcode = 'insufficient_privilege';
  end if;

  raise exception 'not permitted' using errcode = 'insufficient_privilege';
end $$;

-- ---- 4. one winner per request ------------------------------------------
create unique index quote_offers_one_accepted_per_request
  on quote_offers (quote_request_id) where status = 'accepted';

-- ---- 3. expiry -------------------------------------------------------------
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

-- Called by the cron sweep as service_role. Closes requests past their
-- own expiry, and requests whose event date has already gone by.
create or replace function expire_stale_quote_requests()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  update quote_requests
     set status = 'expired'
   where status = 'open'
     and (
       expires_at < now()
       or (event_date is not null and event_date < (now() at time zone 'Africa/Luanda')::date)
     );
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function expire_stale_quote_requests() from public;
grant execute on function expire_stale_quote_requests() to service_role;

-- ---- 2. tell the winner ---------------------------------------------------
alter table notification_outbox drop constraint notification_outbox_kind_check;
alter table notification_outbox add constraint notification_outbox_kind_check
  check (kind in (
    'booking_requested', 'booking_accepted', 'booking_awaiting_payment',
    'booking_confirmed', 'booking_confirmed_provider', 'booking_rejected',
    'booking_expired', 'booking_cancelled_client', 'booking_cancelled_provider',
    'booking_completed', 'booking_no_show',
    'provider_verified', 'provider_rejected', 'provider_suspended', 'provider_reinstated',
    'quote_request_new', 'quote_offer_received',
    -- new in 0030 and 0031
    'quote_offer_accepted', 'booking_payment_submitted', 'booking_released_provider'
  ));

create or replace function enqueue_quote_offer_accepted_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id    uuid;
  v_owner_email citext;
  v_provider    providers%rowtype;
  v_request     quote_requests%rowtype;
begin
  if not (old.status = 'submitted' and new.status = 'accepted') then
    return null;
  end if;

  select * into v_provider from providers where id = new.provider_id;
  select * into v_request  from quote_requests where id = new.quote_request_id;
  select p.id, p.email into v_owner_id, v_owner_email
    from profiles p where p.id = v_provider.owner_id;
  if v_owner_email is null then
    return null;
  end if;

  insert into notification_outbox
    (kind, to_email, recipient_id, context, source_table, source_id)
  values (
    'quote_offer_accepted', v_owner_email, v_owner_id,
    jsonb_build_object(
      'quote_request_id', new.quote_request_id,
      'offer_id', new.id,
      'provider_id', v_provider.id,
      'provider_name', v_provider.name,
      'provider_slug', v_provider.slug,
      'price_minor', new.price_minor,
      'event_date', v_request.event_date,
      'category_name', (select name from categories where id = v_request.category_id),
      'location_name', (select name from locations where id = v_request.location_id)
    ),
    'quote_offers', new.id::text
  )
  on conflict (source_table, source_id, kind, recipient_id) do nothing;
  return null;
end $$;

create trigger quote_offers_notify_accepted
  after update of status on quote_offers
  for each row execute function enqueue_quote_offer_accepted_notification();
