-- =====================================================================
-- 0031 — integrity fixes from the competitive review
--
-- Every change here closes a path where one party could make the record
-- say something untrue, or where the system silently did the wrong
-- thing. Bug numbers refer to the review's verified bug list.
--
--  B13  bookings_set_shape fired LAST (triggers fire in name order), so
--       bookings_enforce_concurrency saw blocks_calendar = false on every
--       venue INSERT and ran the service capacity check on venues.
--  B14  Booking parties could rewrite dates, provider, price or the
--       frozen policy_snapshot with a plain UPDATE (the actor guard only
--       looked at status). Inserts trusted a client-supplied snapshot.
--  B8   A supplier could book their own listing, mark it completed at
--       once, and leave themselves a 'Reserva verificada' review.
--  B9   Reviews could name someone else's booking (and so block that
--       client's real review), authors could rewrite any column, and
--       unverified reviews counted in public averages (handled in app).
--  B10  Nothing ever moved confirmed bookings to completed.
--  B6   Uploading proof of payment did not pause the 24h payment
--       window, so a client who had paid could lose the date.
--  B11  Suspending an owner left their listings public and bookable.
--  B12  A rejected supplier could never resubmit.
--  B28  anon could read every providers column, including email,
--       owner_id and rejection_reason.
--  B29  The no-show notice went to the supplier who set it.
--  B44  The supplier was never told a held date was released.
--  B32  The verification queue's "submitted" clock was updated_at.
--  B33  Payment and report decisions were unaudited.
--  B35  Outbox rows could stay in 'sending' forever.
--  B43  provider_health's "median" was a mean over acceptances only.
--
-- Nothing here moves money or decides a dispute: a paid-but-silent
-- booking is held and flagged, never refunded or confirmed by the system.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------

-- Is this provider visible and bookable by the public: published,
-- verified, and owned by an active account? SECURITY DEFINER so policies
-- can call it without re-entering RLS on profiles.
create or replace function provider_is_public(p_provider_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from providers p join profiles pr on pr.id = p.owner_id
     where p.id = p_provider_id
       and p.is_published and p.verification_status = 'verified'
       and pr.status = 'active'
  );
$$;

-- Is a person acting directly through the API (PostgREST or asUser), as
-- opposed to a SECURITY DEFINER function or the service role? Column
-- guards below apply only to the former.
create or replace function acting_as_end_user()
returns boolean language sql stable as $$
  select current_user in ('authenticated', 'anon') and auth.uid() is not null;
$$;

-- ---------------------------------------------------------------------
-- B13 — shape first
-- ---------------------------------------------------------------------
drop trigger bookings_set_shape on bookings;
create trigger bookings_00_set_shape
  before insert or update on bookings
  for each row execute function bookings_set_shape();

-- Belt and braces: the concurrency check derives the type itself rather
-- than trusting a column another trigger sets.
create or replace function bookings_enforce_concurrency()
returns trigger language plpgsql as $$
declare
  v_limit integer;
  v_count integer;
  v_type  text;
begin
  select supplier_type, concurrency_limit into v_type, v_limit
    from providers where id = new.provider_id;
  if v_type = 'venue' then
    return new;                                   -- venues use the constraint
  end if;
  if not (new.status = any (booking_occupying_statuses())) then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.provider_id::text, 0));

  select count(*) into v_count
    from bookings
   where provider_id = new.provider_id
     and id <> new.id
     and status = any (booking_occupying_statuses())
     and tstzrange(starts_at, ends_at) && tstzrange(new.starts_at, new.ends_at);

  if v_count >= v_limit then
    raise exception 'provider % is at capacity (% concurrent) for that window',
      new.provider_id, v_limit
      using errcode = '23P01';
  end if;

  return new;
end $$;

-- ---------------------------------------------------------------------
-- B14 — a booking's terms are frozen once written
-- ---------------------------------------------------------------------
create or replace function bookings_guard_columns()
returns trigger language plpgsql as $$
begin
  if not acting_as_end_user() or is_admin() then
    return new;
  end if;

  if new.provider_id     is distinct from old.provider_id
     or new.client_id    is distinct from old.client_id
     or new.resource_id  is distinct from old.resource_id
     or new.service_id   is distinct from old.service_id
     or new.starts_at    is distinct from old.starts_at
     or new.ends_at      is distinct from old.ends_at
     or new.party_size   is distinct from old.party_size
     or new.total_minor  is distinct from old.total_minor
     or new.currency     is distinct from old.currency
     or new.policy_snapshot is distinct from old.policy_snapshot
     or new.created_at   is distinct from old.created_at
     or (new.expires_at is distinct from old.expires_at and new.status is not distinct from old.status)
  then
    raise exception 'a booking''s terms may not be edited, only moved through its states'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

create trigger bookings_01_guard_columns
  before update on bookings
  for each row execute function bookings_guard_columns();

-- On INSERT by an end user, the cancellation terms and any total come
-- from the database, never from the request.
-- Deliberately NOT security definer: acting_as_end_user() reads
-- current_user, which a definer function would replace with its owner.
create or replace function bookings_set_terms()
returns trigger language plpgsql set search_path = public as $$
begin
  if not acting_as_end_user() or is_admin() then
    return new;
  end if;
  new.total_minor := null;
  new.currency := 'AOA';
  if new.status = 'requested' then
    new.policy_snapshot := (
      select to_jsonb(cp) from cancellation_policies cp
       where cp.is_active
         and (cp.provider_id = new.provider_id or cp.provider_id is null)
       order by cp.provider_id nulls last
       limit 1
    );
  else
    new.policy_snapshot := null;               -- a manual block has no client terms
  end if;
  return new;
end $$;

create trigger bookings_01_set_terms
  before insert on bookings
  for each row execute function bookings_set_terms();

-- ---------------------------------------------------------------------
-- B8 + B11 — who may request a booking, and for when
-- ---------------------------------------------------------------------
drop policy bookings_client_insert on bookings;
create policy bookings_client_insert on bookings
  for insert with check (
    (
      client_id = auth.uid()
      and status = 'requested'
      and starts_at > now()
      and not owns_provider(provider_id)        -- no booking your own listing
      and provider_is_public(provider_id)       -- published, verified, active owner
    )
    or (owns_provider(provider_id) and status = 'blocked')   -- §27 manual block
    or is_admin()
  );

-- 'completed' only once the event has actually ended. The supplier could
-- previously complete a booking for next year the moment it confirmed.
create or replace function bookings_guard_completion()
returns trigger language plpgsql as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed'
     and acting_as_end_user() and not is_admin()
     and now() < old.ends_at then
    raise exception 'a booking can only be completed after it ends'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger bookings_02_guard_completion
  before update on bookings
  for each row execute function bookings_guard_completion();

-- ---------------------------------------------------------------------
-- B10 — the completion sweep spec/states.md always described
-- ---------------------------------------------------------------------
create or replace function complete_past_bookings()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  -- A day's grace after the end, so a supplier can still record a
  -- no-show before the sweep closes the booking.
  update bookings
     set status = 'completed'
   where status = 'confirmed'
     and ends_at < now() - interval '24 hours';
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function complete_past_bookings() from public;
grant execute on function complete_past_bookings() to service_role;

-- ---------------------------------------------------------------------
-- B6 — proof of payment holds the date
-- ---------------------------------------------------------------------
-- How long a submitted proof holds a date while the supplier checks that
-- the money arrived. A human decision with a sensible default; NGUEZA
-- should confirm the number. Nothing is ever confirmed automatically.
create or replace function payment_proof_hold_window()
returns interval language sql immutable as $$ select interval '72 hours' $$;

create or replace function payments_hold_booking()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status <> 'submitted' then
    return null;
  end if;
  update bookings
     set expires_at = greatest(coalesce(expires_at, now()), now() + payment_proof_hold_window())
   where id = new.booking_id and status = 'awaiting_payment';
  return null;
end $$;

create trigger payments_hold_booking
  after insert on payments
  for each row execute function payments_hold_booking();

-- And the sweep itself never releases a date with a proof still under
-- review, even if the hold above lapsed.
create or replace function expire_stale_bookings()
returns integer language plpgsql as $$
declare
  v_count integer;
begin
  with expired as (
    update bookings b
       set status = 'expired'
     where b.expires_at is not null
       and b.expires_at < now()
       and b.status in ('requested', 'accepted', 'awaiting_payment')
       and not (
         b.status = 'awaiting_payment'
         and exists (select 1 from payments p where p.booking_id = b.id and p.status = 'submitted')
       )
    returning 1
  )
  select count(*) into v_count from expired;
  return v_count;
end $$;

-- Tell the supplier a proof arrived.
create or replace function enqueue_payment_submitted_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_booking  bookings%rowtype;
  v_provider providers%rowtype;
  v_email    citext;
begin
  if new.status <> 'submitted' then
    return null;
  end if;
  select * into v_booking  from bookings  where id = new.booking_id;
  select * into v_provider from providers where id = v_booking.provider_id;
  select email into v_email from profiles where id = v_provider.owner_id;
  if v_email is null then
    return null;
  end if;
  insert into notification_outbox (kind, to_email, recipient_id, context, source_table, source_id)
  values (
    'booking_payment_submitted', v_email, v_provider.owner_id,
    jsonb_build_object(
      'booking_id', v_booking.id, 'provider_id', v_provider.id,
      'provider_name', v_provider.name, 'provider_slug', v_provider.slug,
      'starts_at', v_booking.starts_at, 'ends_at', v_booking.ends_at
    ),
    'payments', new.id::text
  )
  on conflict (source_table, source_id, kind, recipient_id) do nothing;
  return null;
end $$;

create trigger payments_notify_submitted
  after insert on payments
  for each row execute function enqueue_payment_submitted_notification();

-- ---------------------------------------------------------------------
-- B9 + B8 — reviews
-- ---------------------------------------------------------------------
create or replace function booking_is_authors(p_booking_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from bookings where id = p_booking_id and client_id = auth.uid());
$$;

drop policy reviews_author_insert on reviews;
create policy reviews_author_insert on reviews
  for insert with check (
    author_id = auth.uid()
    and (booking_id is null or booking_is_authors(booking_id))
    and not owns_provider(provider_id)
  );

-- Verified also means the author is not the business itself.
create or replace function reviews_derive_verified()
returns trigger language plpgsql as $$
declare
  v_ok boolean;
begin
  if new.booking_id is null then
    new.is_verified := false;
    return new;
  end if;

  select (b.status = 'completed'
          and b.client_id = new.author_id
          and b.provider_id = new.provider_id
          and p.owner_id is distinct from new.author_id)
    into v_ok
    from bookings b join providers p on p.id = b.provider_id
   where b.id = new.booking_id;

  new.is_verified := coalesce(v_ok, false);
  return new;
end $$;

-- An author may edit their own words and stars, nothing else: not the
-- moderation status, not the booking it hangs on, not the reply.
create or replace function reviews_guard_author()
returns trigger language plpgsql as $$
begin
  if acting_as_end_user() and not is_admin()
     and old.author_id = auth.uid() and not owns_provider(old.provider_id) then
    if new.provider_id        is distinct from old.provider_id
       or new.author_id       is distinct from old.author_id
       or new.booking_id      is distinct from old.booking_id
       or new.status          is distinct from old.status
       or new.provider_reply  is distinct from old.provider_reply
       or new.provider_replied_at is distinct from old.provider_replied_at
       or new.created_at      is distinct from old.created_at
    then
      raise exception 'a review''s author may only edit its rating and comment'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end $$;

create trigger reviews_guard_author
  before update on reviews
  for each row execute function reviews_guard_author();

-- ---------------------------------------------------------------------
-- B11 — a suspended owner's listings leave public view
-- ---------------------------------------------------------------------
drop policy providers_public_read on providers;
create policy providers_public_read on providers
  for select using (
    provider_is_public(id)
    or owner_id = auth.uid()
    or is_admin()
  );

-- ---------------------------------------------------------------------
-- B28 — the public sees display columns only
-- ---------------------------------------------------------------------
revoke select on providers from anon;
grant select (
  id, supplier_type, slug, name, description, category_id, location_id,
  address_line, lat, lng, phone, whatsapp, website,
  verification_status, verified_at, years_active_declared,
  is_published, published_at, created_at, updated_at
) on providers to anon;

-- ---------------------------------------------------------------------
-- B12 + B32 — resubmission, and a real submission clock
-- ---------------------------------------------------------------------
alter table providers add column submitted_at timestamptz;

update providers set submitted_at = updated_at where verification_status = 'pending';

create or replace function providers_guard_verification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.verification_status is not distinct from old.verification_status then
    return new;
  end if;

  if new.verification_status = 'pending' then
    new.submitted_at := now();
  end if;

  if is_admin() then
    return new;
  end if;

  -- Re-queuing after a rejection is the supplier's to do; the decision
  -- itself stays with an administrator. Suspended stays an admin matter.
  if old.verification_status in ('unverified', 'rejected')
     and new.verification_status = 'pending'
     and owns_provider(new.id) then
    return new;
  end if;

  raise exception 'verification % -> % is an administrator''s decision',
    old.verification_status, new.verification_status
    using errcode = 'insufficient_privilege';
end $$;

-- ---------------------------------------------------------------------
-- B33 — payment and report decisions are audited
-- ---------------------------------------------------------------------
alter table audit_log drop constraint audit_log_target_type_check;
alter table audit_log add constraint audit_log_target_type_check
  check (target_type in ('provider', 'document', 'profile', 'service', 'report', 'payment'));

create trigger payments_audit
  after update on payments
  for each row execute function audit_changes('payment', 'status', 'confirmed_by', 'confirmed_at');

create trigger reports_audit
  after update on reports
  for each row execute function audit_changes('report', 'status', 'resolved_by', 'resolution_note');

-- ---------------------------------------------------------------------
-- B35 — outbox rows can be reclaimed
-- ---------------------------------------------------------------------
alter table notification_outbox add column claimed_at timestamptz;

-- ---------------------------------------------------------------------
-- B29 + B44 — the right person hears about no-shows and released dates
-- ---------------------------------------------------------------------
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
    'from_status',   new.from_status
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

-- ---------------------------------------------------------------------
-- B43 — provider_health measures what its columns say
-- ---------------------------------------------------------------------
create or replace view provider_health as
with responses as (
  -- The supplier's first answer to each request, accept or reject.
  select be.booking_id, min(be.created_at) as answered_at
    from booking_events be
   where be.from_status = 'requested' and be.to_status in ('accepted', 'rejected')
   group by be.booking_id
)
select
  p.id as provider_id,
  p.name,
  p.verification_status,
  p.is_published,

  count(r.booking_id)::int as answered_count,
  count(*) filter (where b.status = 'expired')::int as expired_count,
  count(*) filter (where b.status = 'completed')::int as completed_count,

  -- Requests the SUPPLIER let lapse, over requests received.
  round(
    100.0 * count(*) filter (
      where b.status = 'expired'
        and exists (select 1 from booking_events x
                     where x.booking_id = b.id and x.from_status = 'requested' and x.to_status = 'expired')
    )
    / nullif(count(*) filter (where b.status <> 'blocked'), 0)
  , 1) as expiry_rate_pct,

  (percentile_cont(0.5) within group (
     order by extract(epoch from (r.answered_at - b.created_at)) / 3600.0
   ) filter (where r.answered_at is not null))::numeric as median_response_hours,

  max(b.updated_at)  as last_booking_activity,
  greatest(p.updated_at, max(b.updated_at)) as last_activity_at,

  (greatest(p.updated_at, coalesce(max(b.updated_at), p.updated_at))
     < now() - interval '30 days') as is_stale

from providers p
left join bookings b  on b.provider_id = p.id
left join responses r on r.booking_id = b.id
group by p.id;

revoke select on provider_health from anon, authenticated;

-- ---------------------------------------------------------------------
-- B30 — phone numbers stored as E.164
--
-- lib/safe.ts normalizePhone() now does this on every save. This applies
-- the same rule to rows already written, so the WhatsApp button stops
-- opening chats in Pakistan for "923 456 789". A value the rule cannot
-- read is left exactly as it was, for the supplier to correct.
-- ---------------------------------------------------------------------
create or replace function normalize_phone_e164(p_raw text)
returns text language plpgsql immutable as $$
declare
  v_digits text := regexp_replace(coalesce(p_raw, ''), '\D', '', 'g');
  v_plus   boolean := coalesce(p_raw, '') ~ '^\s*\+';
begin
  if v_digits = '' then
    return p_raw;
  end if;
  if not v_plus and v_digits like '00%' then
    v_digits := substr(v_digits, 3);
  elsif not v_plus and length(v_digits) = 9 then
    v_digits := '244' || v_digits;
  elsif not v_plus and not (length(v_digits) = 12 and v_digits like '244%') then
    return p_raw;
  end if;
  if v_digits like '244%' and length(v_digits) <> 12 then
    return p_raw;
  end if;
  if length(v_digits) < 8 or length(v_digits) > 15 then
    return p_raw;
  end if;
  return '+' || v_digits;
end $$;

update providers
   set phone = normalize_phone_e164(phone),
       whatsapp = normalize_phone_e164(whatsapp)
 where (phone is not null and phone is distinct from normalize_phone_e164(phone))
    or (whatsapp is not null and whatsapp is distinct from normalize_phone_e164(whatsapp));
