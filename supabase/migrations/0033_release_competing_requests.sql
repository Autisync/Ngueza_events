-- =====================================================================
-- 0033 — release competing requests honestly (slice 28, review C009)
--
-- A pending request does not hold a date (spec/states.md). So a supplier
-- could accept two clients for the same salão and the same day, and both
-- saw "Aceite — aguarda pagamento" until one of them paid. The other then
-- sat on a dead booking until it expired 48 hours later, told only that
-- "nobody acted in time" — which was false; somebody else got the date.
--
-- 1. A new terminal state, 'unavailable' ("Data indisponível"): the date
--    was taken by another booking. Not 'expired' (nobody failed to act),
--    not 'rejected' or 'cancelled_provider' (the supplier did nothing to
--    this client, and those count against them in provider_health).
-- 2. The moment a booking starts holding a venue's space (awaiting_payment,
--    confirmed or blocked), every overlapping requested/accepted booking
--    on that space moves to 'unavailable', in the same transaction.
-- 3. 'unavailable' is set by the database only: no person, admin
--    included, can set it directly — the same rule as 'expired'. Judged
--    by an invoker-rights trigger, because bookings_guard_actor is
--    SECURITY DEFINER and cannot see who is really acting.
-- 4. Accepting a request for a date that is already held fails with the
--    same 23P01 as the exclusion constraint, instead of creating a second
--    "aceite" that can never be confirmed.
-- 5. The client is told, with a link to the same search on the same date.
--
-- Venues only. A service supplier's capacity is a count of overlapping
-- holds (bookings_enforce_concurrency), so one more hold does not make a
-- given competing request impossible; the supplier still gets 23P01 if
-- they try to exceed it.
-- =====================================================================

-- ---- 1. the state ------------------------------------------------------
alter table bookings drop constraint bookings_status_check;
alter table bookings add constraint bookings_status_check check (status in (
  'requested', 'accepted', 'awaiting_payment', 'confirmed',
  'completed', 'expired', 'rejected',
  'cancelled_client', 'cancelled_provider', 'no_show',
  'blocked', 'unavailable'
));

create or replace function booking_can_transition(from_status text, to_status text)
returns boolean language sql immutable as $$
  select (from_status, to_status) in (
    ('requested',        'accepted'),
    ('requested',        'rejected'),
    ('requested',        'expired'),
    ('requested',        'cancelled_client'),
    ('requested',        'unavailable'),
    ('accepted',         'awaiting_payment'),
    ('accepted',         'confirmed'),           -- flows with no payment step
    ('accepted',         'expired'),
    ('accepted',         'cancelled_client'),
    ('accepted',         'cancelled_provider'),
    ('accepted',         'unavailable'),
    ('awaiting_payment', 'confirmed'),
    ('awaiting_payment', 'expired'),
    ('awaiting_payment', 'cancelled_client'),
    ('awaiting_payment', 'cancelled_provider'),
    ('confirmed',        'completed'),
    ('confirmed',        'cancelled_client'),
    ('confirmed',        'cancelled_provider'),
    ('confirmed',        'no_show'),
    ('blocked',          'cancelled_provider')
  );
$$;

-- ---- 3. only the database sets it --------------------------------------
create or replace function bookings_guard_actor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  -- 'unavailable' is judged by bookings_guard_unavailable below, not
  -- here: this function is SECURITY DEFINER, so current_user inside it is
  -- always its owner and it cannot tell a person from the database.
  if new.status = 'unavailable' then
    return new;
  end if;

  if auth.uid() is null then
    return new;                              -- service_role: the expiry job
  end if;

  if new.status = 'expired' then
    raise exception 'expired is set only by the scheduled job, never a person'
      using errcode = 'insufficient_privilege';
  end if;

  if is_admin() then
    return new;
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

-- 'unavailable' is derived, never decided: only bookings_release_competitors
-- writes it. SECURITY INVOKER on purpose — a trigger fires as the
-- current_user of the statement that caused it, so inside the release
-- function's UPDATE that is the function's owner (acting_as_end_user() is
-- false), and for anything a person sends it is authenticated/anon. A
-- person — admin included — who wants a request gone rejects or cancels
-- it, attributably.
create or replace function bookings_guard_unavailable()
returns trigger language plpgsql as $$
begin
  if new.status = 'unavailable' and old.status is distinct from 'unavailable'
     and acting_as_end_user() then
    raise exception 'unavailable is set only by the database, never a person'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

create trigger bookings_guard_unavailable
  before update of status on bookings
  for each row execute function bookings_guard_unavailable();

-- ---- 2. release the competitors ---------------------------------------
create or replace function bookings_release_competitors()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.resource_id is null
     or not new.blocks_calendar
     or new.status not in ('awaiting_payment', 'confirmed', 'blocked') then
    return null;
  end if;
  -- Only on the transition INTO a hold; confirmed after awaiting_payment
  -- already released everything when the hold began.
  if tg_op = 'UPDATE' and old.status in ('awaiting_payment', 'confirmed', 'blocked') then
    return null;
  end if;

  -- SKIP LOCKED: a competing row locked right now is being changed by
  -- another transaction — most likely its own confirmation racing this
  -- one. Waiting for it would deadlock (each side waits on the other's
  -- row); skipping it leaves the exclusion constraint to decide that
  -- race, exactly as before 0033, and the loser is released or expires.
  update bookings
     set status = 'unavailable'
   where id in (
     select id from bookings
      where resource_id = new.resource_id
        and id <> new.id
        and status in ('requested', 'accepted')
        and tstzrange(starts_at, ends_at) && tstzrange(new.starts_at, new.ends_at)
      for update skip locked
   );

  return null;
end $$;

create trigger bookings_release_competitors
  after insert or update of status on bookings
  for each row execute function bookings_release_competitors();

-- ---- 4. no new "aceite" for a held date --------------------------------
create or replace function bookings_guard_held_date()
returns trigger language plpgsql as $$
begin
  if new.status = 'accepted' and old.status = 'requested'
     and new.resource_id is not null
     and not resource_is_free(new.resource_id, new.starts_at, new.ends_at) then
    raise exception 'that date is already held for this space'
      using errcode = 'exclusion_violation';
  end if;
  return new;
end $$;

create trigger bookings_guard_held_date
  before update of status on bookings
  for each row execute function bookings_guard_held_date();

-- ---- 5. tell the client -------------------------------------------------
alter table notification_outbox drop constraint notification_outbox_kind_check;
alter table notification_outbox add constraint notification_outbox_kind_check
  check (kind in (
    'booking_requested', 'booking_accepted', 'booking_awaiting_payment',
    'booking_confirmed', 'booking_confirmed_provider', 'booking_rejected',
    'booking_expired', 'booking_cancelled_client', 'booking_cancelled_provider',
    'booking_completed', 'booking_no_show',
    'provider_verified', 'provider_rejected', 'provider_suspended', 'provider_reinstated',
    'quote_request_new', 'quote_offer_received',
    'quote_offer_accepted', 'booking_payment_submitted', 'booking_released_provider',
    -- new in 0033
    'booking_unavailable'
  ));

-- Redefined from 0031 with two changes: the 'unavailable' case, and the
-- provider's category and location in the context for the search link.
create or replace function enqueue_booking_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking      bookings%rowtype;
  v_provider     providers%rowtype;
  v_owner_email  citext;
  v_client_email citext;
  v_kind         text;
  v_to           citext;
  v_recipient    uuid;
  v_context      jsonb;
begin
  select * into v_booking  from bookings  where id = new.booking_id;
  select * into v_provider from providers where id = v_booking.provider_id;
  select email into v_owner_email from profiles where id = v_provider.owner_id;
  if v_booking.client_id is not null then
    select email into v_client_email from profiles where id = v_booking.client_id;
  end if;

  v_context := jsonb_build_object(
    'booking_id',    v_booking.id,
    'provider_id',   v_provider.id,
    'provider_name', v_provider.name,
    'provider_slug', v_provider.slug,
    'starts_at',     v_booking.starts_at,
    'ends_at',       v_booking.ends_at,
    'from_status',   new.from_status,
    -- So a client told their date is gone can be sent straight to the
    -- same search with that date (0033).
    'category_id',   v_provider.category_id,
    'location_id',   v_provider.location_id
  );

  if new.to_status = 'confirmed' then
    if v_client_email is not null then
      insert into notification_outbox
        (kind, to_email, recipient_id, context, source_table, source_id)
      values
        ('booking_confirmed', v_client_email, v_booking.client_id, v_context,
         'booking_events', new.id)
      on conflict (source_table, source_id, kind, recipient_id) do nothing;
    end if;
    if v_owner_email is not null then
      insert into notification_outbox
        (kind, to_email, recipient_id, context, source_table, source_id)
      values
        ('booking_confirmed_provider', v_owner_email, v_provider.owner_id, v_context,
         'booking_events', new.id)
      on conflict (source_table, source_id, kind, recipient_id) do nothing;
    end if;
    return null;
  end if;

  -- A date the supplier had already accepted was released because the
  -- client did not proceed: the supplier needs to know it is free again.
  if new.to_status = 'expired' and new.from_status in ('accepted', 'awaiting_payment')
     and v_owner_email is not null then
    insert into notification_outbox
      (kind, to_email, recipient_id, context, source_table, source_id)
    values
      ('booking_released_provider', v_owner_email, v_provider.owner_id, v_context,
       'booking_events', new.id)
    on conflict (source_table, source_id, kind, recipient_id) do nothing;
  end if;

  case new.to_status
    when 'requested'           then v_kind := 'booking_requested';          v_to := v_owner_email;  v_recipient := v_provider.owner_id;
    when 'accepted'             then v_kind := 'booking_accepted';           v_to := v_client_email; v_recipient := v_booking.client_id;
    when 'awaiting_payment'     then v_kind := 'booking_awaiting_payment';   v_to := v_client_email; v_recipient := v_booking.client_id;
    when 'rejected'             then v_kind := 'booking_rejected';          v_to := v_client_email; v_recipient := v_booking.client_id;
    when 'expired'              then v_kind := 'booking_expired';           v_to := v_client_email; v_recipient := v_booking.client_id;
    when 'cancelled_client'     then v_kind := 'booking_cancelled_client';  v_to := v_owner_email;  v_recipient := v_provider.owner_id;
    when 'cancelled_provider'   then v_kind := 'booking_cancelled_provider';v_to := v_client_email; v_recipient := v_booking.client_id;
    when 'completed'            then v_kind := 'booking_completed';         v_to := v_client_email; v_recipient := v_booking.client_id;
    when 'no_show'              then v_kind := 'booking_no_show';           v_to := v_client_email; v_recipient := v_booking.client_id;
    when 'unavailable'          then v_kind := 'booking_unavailable';       v_to := v_client_email; v_recipient := v_booking.client_id;
    else return null; -- 'blocked': the supplier's own action, nobody to tell
  end case;

  if v_to is null then
    return null; -- e.g. a manually-blocked booking has no client to notify
  end if;

  insert into notification_outbox (kind, to_email, recipient_id, context, source_table, source_id)
  values (v_kind, v_to, v_recipient, v_context, 'booking_events', new.id)
  on conflict (source_table, source_id, kind, recipient_id) do nothing;

  return null;
end $$;
