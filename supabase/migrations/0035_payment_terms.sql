-- =====================================================================
-- 0035 — payment terms on the booking (slice 31, review R019 + R020)
--
-- A booking moved to awaiting_payment with no amount, no deposit and no
-- way to pay: the client's email said "contacte o fornecedor", the
-- supplier's screen showed no payments at all, and the supplier pressed
-- "Confirmar pagamento recebido" without seeing the proof the client had
-- uploaded. total_minor existed (0006) but nothing ever set it.
--
-- 1. deposit_minor (the sinal) and payment_instructions join total_minor.
--    Money is bigint cêntimos, never a float.
-- 2. The SUPPLIER writes all three exactly once: on the transition that
--    asks for payment (accepted -> awaiting_payment), or accepted ->
--    confirmed for a booking with no payment step. Before that there are
--    no terms; after it they are frozen like every other term (0031). The
--    client never writes them.
-- 3. Asking for payment requires a total — "aguarda pagamento" of what?
-- 4. The awaiting-payment email carries the amounts and instructions.
--
-- NGUEZA still never receives, holds or moves money (slice 16). These
-- columns record what two parties agreed; nothing here pays anyone.
-- =====================================================================

-- ---- 1. columns ---------------------------------------------------------
alter table bookings add column deposit_minor bigint check (deposit_minor >= 0);
alter table bookings add column payment_instructions text
  check (payment_instructions is null or char_length(payment_instructions) <= 500);
alter table bookings add constraint bookings_deposit_within_total
  check (deposit_minor is null or (total_minor is not null and deposit_minor <= total_minor));

-- ---- 2. who may write them, and when ----------------------------------
create or replace function bookings_guard_columns()
returns trigger language plpgsql as $$
declare
  v_setting_terms boolean;
begin
  if not acting_as_end_user() or is_admin() then
    return new;
  end if;

  -- The one moment terms may be written: the supplier asking for payment
  -- (or confirming a booking that has no payment step).
  v_setting_terms := old.status = 'accepted'
    and new.status in ('awaiting_payment', 'confirmed')
    and owns_provider(old.provider_id);

  if new.provider_id     is distinct from old.provider_id
     or new.client_id    is distinct from old.client_id
     or new.resource_id  is distinct from old.resource_id
     or new.service_id   is distinct from old.service_id
     or new.starts_at    is distinct from old.starts_at
     or new.ends_at      is distinct from old.ends_at
     or new.party_size   is distinct from old.party_size
     or new.currency     is distinct from old.currency
     or new.policy_snapshot is distinct from old.policy_snapshot
     or new.created_at   is distinct from old.created_at
     or (new.expires_at is distinct from old.expires_at and new.status is not distinct from old.status)
     or (not v_setting_terms and (
           new.total_minor          is distinct from old.total_minor
        or new.deposit_minor        is distinct from old.deposit_minor
        or new.payment_instructions is distinct from old.payment_instructions))
  then
    raise exception 'a booking''s terms may not be edited, only moved through its states'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

-- ---- 3. no "aguarda pagamento" without an amount ------------------------
create or replace function bookings_require_total()
returns trigger language plpgsql as $$
begin
  if new.status = 'awaiting_payment' and old.status is distinct from 'awaiting_payment'
     and new.total_minor is null then
    raise exception 'asking for payment needs the agreed total'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger bookings_require_total
  before update of status on bookings
  for each row execute function bookings_require_total();

-- 0031's insert-time rule still holds: a client's request carries no
-- total, deposit or instructions of its own.
create or replace function bookings_set_terms()
returns trigger language plpgsql set search_path = public as $$
begin
  if not acting_as_end_user() or is_admin() then
    return new;
  end if;
  new.total_minor := null;
  new.deposit_minor := null;
  new.payment_instructions := null;
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

-- ---- 4. the email says how much and how --------------------------------
-- Redefined from 0033 with the three terms added to the context.
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
    'location_id',   v_provider.location_id,
    -- The terms the supplier set when asking for payment (0035), so the
    -- "aguarda o seu pagamento" email says how much and how.
    'total_minor',   v_booking.total_minor,
    'deposit_minor', v_booking.deposit_minor,
    'payment_instructions', v_booking.payment_instructions
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
