-- =====================================================================
-- 0019 — the notification outbox (§17)
--
-- booking_events and audit_log both record what happened. Neither one
-- reaches a person: a supplier who gets verified, rejected or suspended
-- finds out only if they happen to open their dashboard, and a client
-- whose request was accepted has no idea until they check back.
--
-- Triggers cannot send email. A trigger runs inside the database's own
-- transaction — an HTTP call from in there either blocks the transaction
-- on network latency, or sends the email and then the transaction rolls
-- back and the thing it describes never happened. So a trigger only
-- ENQUEUES: it writes a row saying what to send and to whom. A scheduled
-- job (POST /api/cron/notify, alongside the existing expiry job) sends
-- it afterwards, outside any database transaction. This is the outbox
-- pattern, and it is the only safe way to get a side effect out of a
-- trigger.
-- =====================================================================

create table notification_outbox (
  id           bigint generated always as identity primary key,
  kind         text not null check (kind in (
                 'booking_requested', 'booking_accepted', 'booking_awaiting_payment',
                 'booking_confirmed', 'booking_confirmed_provider', 'booking_rejected',
                 'booking_expired', 'booking_cancelled_client', 'booking_cancelled_provider',
                 'booking_completed', 'booking_no_show',
                 'provider_verified', 'provider_rejected', 'provider_suspended',
                 'provider_reinstated'
               )),

  -- Snapshotted at enqueue time, not joined at send time. By the time the
  -- job runs, the person's email may have changed or their account may
  -- have been erased (§37) — the notification should still describe the
  -- event as it was, to the address that was correct when it happened.
  to_email     citext not null,
  recipient_id uuid references profiles(id) on delete set null,
  context      jsonb not null default '{}',

  -- Where this came from. No foreign key: source_table names one of two
  -- different tables (booking_events, audit_log), the same polymorphic
  -- shape reports.target_type/target_id already uses in this schema.
  source_table text not null,
  source_id    bigint not null,

  status       text not null default 'pending'
                 check (status in ('pending', 'sending', 'sent', 'failed')),
  attempts     int not null default 0,
  last_error   text,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz,

  -- The guard against double-sending. A retried trigger, or the same
  -- transition somehow firing twice, produces the same (source, kind)
  -- pair — the second insert is a silent no-op via ON CONFLICT below.
  unique (source_table, source_id, kind)
);

create index notification_outbox_pending_idx on notification_outbox (created_at)
  where status = 'pending';
create index notification_outbox_recipient_idx on notification_outbox (recipient_id, created_at desc)
  where recipient_id is not null;

alter table notification_outbox enable row level security;

-- Administrators can see what was sent, for support — "did the supplier
-- actually get the email?". Nothing else has a policy: not even the
-- recipient, who has no reason to read their own delivery metadata back.
-- No INSERT/UPDATE/DELETE policy exists for anon or authenticated at
-- all, so both are refused regardless of the broad default grant —
-- enqueueing and sending both run as service_role, which bypasses RLS.
create policy notification_outbox_admin_read on notification_outbox
  for select using (is_admin());

revoke insert, update, delete on notification_outbox from anon, authenticated;

-- ---------------------------------------------------------------------
-- Booking transitions → notification_outbox (§10, §17)
--
-- Whom to notify follows one rule: tell the party who did NOT just act.
-- A client who cancels already knows they cancelled; the supplier does
-- not, until this fires. 'confirmed' is the one case both parties need
-- telling, since either side can be the one who triggered it (a payment
-- webhook, an admin, or the supplier accepting straight through).
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
    -- Two recipients, two rows, so each can be retried and marked sent
    -- independently — one failing must not silently swallow the other.
    if v_client_email is not null then
      insert into notification_outbox
        (kind, to_email, recipient_id, context, source_table, source_id)
      values
        ('booking_confirmed', v_client_email, v_booking.client_id, v_context,
         'booking_events', new.id)
      on conflict (source_table, source_id, kind) do nothing;
    end if;
    if v_owner_email is not null then
      insert into notification_outbox
        (kind, to_email, recipient_id, context, source_table, source_id)
      values
        ('booking_confirmed_provider', v_owner_email, v_provider.owner_id, v_context,
         'booking_events', new.id)
      on conflict (source_table, source_id, kind) do nothing;
    end if;
    return null;
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
    when 'no_show'              then v_kind := 'booking_no_show';           v_to := v_owner_email;  v_recipient := v_provider.owner_id;
    else return null; -- 'blocked': the supplier's own action, nobody to tell
  end case;

  if v_to is null then
    return null; -- e.g. a manually-blocked booking has no client to notify
  end if;

  insert into notification_outbox (kind, to_email, recipient_id, context, source_table, source_id)
  values (v_kind, v_to, v_recipient, v_context, 'booking_events', new.id)
  on conflict (source_table, source_id, kind) do nothing;

  return null;
end $$;

create trigger booking_events_notify
  after insert on booking_events
  for each row execute function enqueue_booking_notification();

-- ---------------------------------------------------------------------
-- Provider verification decisions → notification_outbox (§25, §17)
--
-- Rides on audit_log rather than watching providers directly: audit_log
-- already fires only when verification_status actually changed, and
-- already carries before/after — re-deriving that here would be a
-- second, and probably diverging, definition of "did this change".
-- ---------------------------------------------------------------------
create or replace function enqueue_provider_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id     uuid;
  v_owner_email  citext;
  v_provider_name text;
  v_provider_slug text;
  v_new_status   text := new.after  ->> 'verification_status';
  v_old_status   text := new.before ->> 'verification_status';
  v_kind         text;
begin
  if new.target_type <> 'provider' or v_new_status is null then
    return null;
  end if;

  select owner_id, name, slug into v_owner_id, v_provider_name, v_provider_slug
    from providers where id = new.target_id;
  if v_owner_id is null then
    return null;
  end if;
  select email into v_owner_email from profiles where id = v_owner_id;
  if v_owner_email is null then
    return null; -- the owner's account was erased since; nobody to tell
  end if;

  v_kind := case
    when v_new_status = 'verified'  and v_old_status = 'suspended' then 'provider_reinstated'
    when v_new_status = 'verified'  then 'provider_verified'
    when v_new_status = 'rejected'  then 'provider_rejected'
    when v_new_status = 'suspended' then 'provider_suspended'
    else null -- 'pending': the supplier already knows, they just submitted
  end;
  if v_kind is null then
    return null;
  end if;

  insert into notification_outbox (kind, to_email, recipient_id, context, source_table, source_id)
  values (
    v_kind, v_owner_email, v_owner_id,
    jsonb_build_object(
      'provider_id', new.target_id, 'provider_name', v_provider_name,
      'provider_slug', v_provider_slug, 'reason', new.after ->> 'rejection_reason'
    ),
    'audit_log', new.id
  )
  on conflict (source_table, source_id, kind) do nothing;

  return null;
end $$;

create trigger audit_log_notify
  after insert on audit_log
  for each row execute function enqueue_provider_notification();
