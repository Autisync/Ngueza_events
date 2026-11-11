-- =====================================================================
-- 0045 — a supplier's cancellation, and what happened to the money
--        (slice 47, review R013)
--
-- NGUEZA never holds or moves money. When a supplier cancels a booking
-- the client paid for, the refund happens between them. Until now nothing
-- recorded either side of it: no reason for the cancellation, and the
-- `refunds` table (0008), shaped for a platform that pays out, unused.
--
-- 1. bookings.cancellation_reason — said once, in the same update that
--    cancels, never edited afterwards. Required when a supplier cancels a
--    real booking (not when they unblock their own date).
-- 2. refund_attestations — the supplier states "devolvi X Kz, por este
--    meio, com esta referência"; the client answers "recebi" or "não
--    recebi". Statements by the two parties, recorded as they made them.
--    Who was at fault and what refund was owed are NOT decided here: that
--    rule is NGUEZA's, with counsel.
-- =====================================================================

-- ---- 1. the reason ---------------------------------------------------
alter table bookings add column cancellation_reason text
  check (cancellation_reason is null or char_length(cancellation_reason) between 3 and 500);
alter table bookings add constraint bookings_reason_only_when_cancelled
  check (cancellation_reason is null or status in ('cancelled_client', 'cancelled_provider'));

-- INVOKER, so acting_as_end_user() sees the real caller (see 0033).
create or replace function bookings_guard_cancellation_reason()
returns trigger language plpgsql as $$
begin
  if not acting_as_end_user() or is_admin() then
    return new;
  end if;
  if new.cancellation_reason is distinct from old.cancellation_reason
     and not (new.status is distinct from old.status
              and new.status in ('cancelled_client', 'cancelled_provider')) then
    raise exception 'a cancellation reason is given when cancelling, and not edited afterwards'
      using errcode = 'insufficient_privilege';
  end if;
  if new.status = 'cancelled_provider' and old.status is distinct from 'cancelled_provider'
     and old.status <> 'blocked'
     and coalesce(btrim(new.cancellation_reason), '') = '' then
    raise exception 'a supplier cancelling a booking must say why'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger bookings_guard_cancellation_reason
  before update on bookings
  for each row execute function bookings_guard_cancellation_reason();

-- ---- 2. refund attestations -----------------------------------------
create table refund_attestations (
  id              bigint generated always as identity primary key,
  booking_id      uuid not null references bookings(id) on delete restrict,
  amount_minor    bigint not null check (amount_minor > 0),
  method          text not null check (method in ('transferencia', 'multicaixa_express', 'numerario', 'outro')),
  reference       text check (reference is null or char_length(reference) <= 120),
  sent_by         uuid not null default auth.uid() references profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  -- The client's answer, once.
  client_response text check (client_response in ('received', 'disputed')),
  client_note     text check (client_note is null or char_length(client_note) <= 1000),
  responded_at    timestamptz,
  constraint refund_attestations_response_complete
    check ((client_response is null) = (responded_at is null))
);

create index refund_attestations_booking_idx on refund_attestations (booking_id, created_at);

alter table refund_attestations enable row level security;

-- Both parties to the booking, and administrators.
create policy refund_attestations_read on refund_attestations
  for select using (
    is_admin() or exists (
      select 1 from bookings b
       where b.id = refund_attestations.booking_id
         and (b.client_id = auth.uid() or owns_provider(b.provider_id))
    )
  );
-- The supplier states a refund, on a cancelled booking of theirs, as
-- themselves, unanswered.
create policy refund_attestations_supplier_insert on refund_attestations
  for insert with check (
    sent_by = auth.uid()
    and client_response is null
    and exists (
      select 1 from bookings b
       where b.id = refund_attestations.booking_id
         and owns_provider(b.provider_id)
         and b.status in ('cancelled_client', 'cancelled_provider')
    )
  );
-- The client answers. What they may change is narrowed by the trigger.
create policy refund_attestations_client_answer on refund_attestations
  for update using (
    exists (select 1 from bookings b
             where b.id = refund_attestations.booking_id and b.client_id = auth.uid())
  ) with check (
    exists (select 1 from bookings b
             where b.id = refund_attestations.booking_id and b.client_id = auth.uid())
  );
-- A statement is a record: nobody deletes one.
revoke delete on refund_attestations from anon, authenticated;
revoke insert, update on refund_attestations from anon;

create or replace function refund_attestations_guard()
returns trigger language plpgsql as $$
begin
  if not acting_as_end_user() or is_admin() then
    return new;
  end if;
  if old.client_response is not null then
    raise exception 'the client has already answered this refund'
      using errcode = 'insufficient_privilege';
  end if;
  if new.booking_id   is distinct from old.booking_id
     or new.amount_minor is distinct from old.amount_minor
     or new.method       is distinct from old.method
     or new.reference    is distinct from old.reference
     or new.sent_by      is distinct from old.sent_by
     or new.created_at   is distinct from old.created_at
     or new.client_response is null then
    raise exception 'only the client''s answer may be recorded'
      using errcode = 'insufficient_privilege';
  end if;
  new.responded_at := now();
  return new;
end $$;

create trigger refund_attestations_guard
  before update on refund_attestations
  for each row execute function refund_attestations_guard();

-- ---- 3. telling the other side ---------------------------------------
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
    'booking_unavailable',
    'support_request_new',
    'booking_requested_client',
    -- new in 0045
    'refund_sent', 'refund_disputed'
  ));

-- SECURITY DEFINER: reads the other party's email, which neither side
-- can select, and writes the outbox, which only service_role can.
create or replace function refund_attestations_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_kind text;
begin
  if tg_op = 'INSERT' then
    v_kind := 'refund_sent';
  elsif new.client_response = 'disputed' and old.client_response is null then
    v_kind := 'refund_disputed';
  else
    return null;
  end if;

  insert into notification_outbox (kind, to_email, recipient_id, context, source_table, source_id)
  select v_kind, r.email, r.id,
         jsonb_build_object(
           'booking_id', b.id, 'provider_id', p.id, 'provider_name', p.name, 'provider_slug', p.slug,
           'starts_at', b.starts_at, 'ends_at', b.ends_at,
           'amount_minor', new.amount_minor, 'method', new.method, 'reference', new.reference,
           'client_note', new.client_note),
         'refund_attestations', new.id
    from bookings b
    join providers p on p.id = b.provider_id
    join profiles r on r.id = case when v_kind = 'refund_sent' then b.client_id else p.owner_id end
   where b.id = new.booking_id and r.email is not null
  on conflict (source_table, source_id, kind, recipient_id) do nothing;
  return null;
end $$;

revoke execute on function refund_attestations_notify() from public, anon, authenticated;

create trigger refund_attestations_notify
  after insert or update of client_response on refund_attestations
  for each row execute function refund_attestations_notify();
