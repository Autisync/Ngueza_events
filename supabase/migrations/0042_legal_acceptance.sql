-- =====================================================================
-- 0042 — legal hooks: versioned documents, recorded acceptance, and an
-- acknowledgement of every booking request (slice 41, review R066/C007)
--
-- The legal TEXT is NGUEZA's, with counsel (CLAUDE.md: never automate legal
-- text). This is the machinery any version of it needs: which version of
-- which document was in force, and who accepted which version, when, in
-- what context. A new version is a new row; nothing is ever edited, so the
-- record of what someone agreed to cannot drift.
-- =====================================================================

create table legal_documents (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('terms', 'privacy', 'cancellation')),
  version       text not null check (char_length(version) between 1 and 40),
  published_at  timestamptz not null default now(),
  url           text not null check (url like '/%'),
  unique (kind, version)
);

-- The documents in force today are the placeholders slice 15 published.
insert into legal_documents (kind, version, url) values
  ('terms',        'provisorio-2026-11', '/termos'),
  ('privacy',      'provisorio-2026-11', '/privacidade'),
  ('cancellation', 'provisorio-2026-11', '/cancelamento');

alter table legal_documents enable row level security;
create policy legal_documents_public_read on legal_documents for select using (true);
create policy legal_documents_admin_insert on legal_documents for insert with check (is_admin());
grant select on legal_documents to anon, authenticated;
revoke update, delete on legal_documents from anon, authenticated;

/** The version of each kind in force now: the latest published. */
create view legal_current as
  select distinct on (kind) id, kind, version, published_at, url
    from legal_documents
   where published_at <= now()
   order by kind, published_at desc;
grant select on legal_current to anon, authenticated;

create table legal_acceptances (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references profiles(id) on delete cascade,
  document_id  uuid not null references legal_documents(id),
  context      text not null check (context in ('signup', 'booking')),
  booking_id   uuid references bookings(id) on delete set null,
  accepted_at  timestamptz not null default now()
);

create index legal_acceptances_profile_idx on legal_acceptances (profile_id, accepted_at desc);

alter table legal_acceptances enable row level security;
create policy legal_acceptances_own_read on legal_acceptances
  for select using (profile_id = auth.uid() or is_admin());
-- A person records only their own acceptance, and only of a version that
-- is in force — not a future draft, not one already replaced.
create policy legal_acceptances_own_insert on legal_acceptances
  for insert with check (
    profile_id = auth.uid()
    and document_id in (select id from legal_current)
  );
revoke update, delete on legal_acceptances from anon, authenticated;

-- ---- the client's acknowledgement of a request -----------------------
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
    -- new in 0042
    'booking_requested_client'
  ));

-- Redefined from 0035 with one addition: 'booking_requested_client'.
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

  -- The client's own acknowledgement that the request went through (0042):
  -- before this, only the supplier heard about a new request.
  if new.to_status = 'requested' and v_client_email is not null then
    insert into notification_outbox
      (kind, to_email, recipient_id, context, source_table, source_id)
    values
      ('booking_requested_client', v_client_email, v_booking.client_id, v_context,
       'booking_events', new.id)
    on conflict (source_table, source_id, kind, recipient_id) do nothing;
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
