-- =====================================================================
-- 0038 — a way to ask for help (slice 35, review C006)
--
-- There was nowhere to ask NGUEZA for anything: a client whose supplier
-- went silent, a supplier who could not upload paperwork, someone who
-- had been asked to pay into a stranger's account. Email addresses were
-- buried in copy. support_requests is the inbox; every administrator is
-- emailed when one arrives.
-- =====================================================================

create table support_requests (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid references profiles(id) on delete set null,
  email         citext not null check (char_length(email) <= 254),
  topic         text not null check (topic in
                  ('reserva', 'pagamento', 'conta', 'fornecedor', 'fraude', 'outro')),
  booking_ref   text check (booking_ref is null or booking_ref ~ '^[0-9A-Fa-f]{8}$'),
  message       text not null check (char_length(message) between 10 and 4000),
  status        text not null default 'open' check (status in ('open', 'resolved')),
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz,
  resolved_by   uuid references profiles(id)
);

create index support_requests_open_idx on support_requests (created_at) where status = 'open';

alter table support_requests enable row level security;

-- Anyone may write one — a person locked out of their account most of
-- all — but only as themselves (or as nobody, signed out), and only open.
-- No RETURNING from the app: anon has no SELECT here (CLAUDE.md).
create policy support_requests_insert on support_requests
  for insert to anon, authenticated with check (
    status = 'open' and resolved_at is null and resolved_by is null
    and (profile_id is null or profile_id = auth.uid())
  );
create policy support_requests_own_read on support_requests
  for select using (profile_id = auth.uid() or is_admin());
create policy support_requests_admin_update on support_requests
  for update using (is_admin()) with check (is_admin());

-- ---- tell the team ---------------------------------------------------
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
    -- new in 0038
    'support_request_new'
  ));

create or replace function enqueue_support_request_notification()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into notification_outbox (kind, to_email, recipient_id, context, source_table, source_id)
  select 'support_request_new', p.email, p.id,
         jsonb_build_object(
           'support_request_id', new.id, 'topic', new.topic, 'email', new.email,
           'booking_ref', new.booking_ref, 'message', left(new.message, 600)),
         'support_requests', ('x' || substr(md5(new.id::text), 1, 15))::bit(60)::bigint
    from profiles p
   where p.role = 'admin' and p.status = 'active'
  on conflict (source_table, source_id, kind, recipient_id) do nothing;
  return null;
end $$;

create trigger support_requests_notify
  after insert on support_requests
  for each row execute function enqueue_support_request_notification();
