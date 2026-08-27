-- =====================================================================
-- 0005 — bookings, the exclusion constraint, and the audit trail
--        (§9, §10, §26, §27, §29, §38)
--
-- This is the most important file in the schema. Two things must be
-- structurally impossible, not merely handled carefully in application
-- code:
--
--   1. Two confirmed bookings for the same venue at the same time (§27).
--   2. A pending request blocking a date forever (§26).
--
-- The first is an exclusion constraint. The second is an expiry deadline
-- written on every state change.
-- =====================================================================

create table bookings (
  id             uuid primary key default gen_random_uuid(),
  provider_id    uuid not null references providers(id) on delete restrict,

  -- Null only for status = 'blocked': the supplier accepted a walk-in
  -- in person and is blocking the date manually (§27). Modelling that as
  -- a booking rather than a separate table means the exclusion
  -- constraint covers platform and off-platform bookings identically.
  client_id      uuid references profiles(id) on delete restrict,

  -- Required for venues, forbidden for services. Enforced below.
  resource_id    uuid references resources(id) on delete restrict,
  service_id     uuid references services(id) on delete restrict,

  status         text not null default 'requested' check (status in (
                   'requested', 'accepted', 'awaiting_payment', 'confirmed',
                   'completed', 'expired', 'rejected',
                   'cancelled_client', 'cancelled_provider', 'no_show',
                   'blocked'
                 )),

  starts_at      timestamptz not null,
  ends_at        timestamptz not null,

  party_size     integer check (party_size > 0),
  notes          text,

  total_minor    bigint check (total_minor >= 0),   -- cêntimos, never a float
  currency       text not null default 'AOA',

  -- §29: the policy in force when the client booked. Snapshotted so a
  -- supplier changing terms in March cannot retroactively alter a
  -- January booking.
  policy_snapshot jsonb,

  -- Set by trigger from the provider's supplier_type. Do not write it
  -- from application code.
  blocks_calendar boolean not null default false,

  -- §26: when this booking loses its hold. Set by trigger on every
  -- state change; null in terminal states.
  expires_at     timestamptz,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint bookings_time_order check (ends_at > starts_at),
  constraint bookings_client_required check (
    status = 'blocked' or client_id is not null
  )
);

create index bookings_provider_idx on bookings (provider_id, starts_at);
create index bookings_client_idx   on bookings (client_id, starts_at desc)
  where client_id is not null;
create index bookings_resource_idx on bookings (resource_id, starts_at)
  where resource_id is not null;
create index bookings_expiry_idx   on bookings (expires_at)
  where expires_at is not null;

create trigger bookings_updated_at
  before update on bookings
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- Which statuses hold a slot.
--
-- 'awaiting_payment' is included deliberately: without it two clients
-- can both reach payment for the same date and one necessarily loses
-- after paying. It is safe to include because it carries a 24h expiry,
-- which is exactly what §26 asks for.
-- ---------------------------------------------------------------------
create or replace function booking_occupying_statuses()
returns text[] language sql immutable as $$
  select array['awaiting_payment', 'confirmed', 'blocked']::text[];
$$;

-- =====================================================================
-- THE constraint (§27).
--
-- Two overlapping holds on one resource cannot both exist. Checking
-- "is this slot free?" in application code and then inserting is a race:
-- two requests read free, both insert. Postgres refuses the second one
-- regardless of timing or code path.
--
-- Application code must catch SQLSTATE 23P01 and report the clash.
-- =====================================================================
alter table bookings add constraint bookings_no_double_booking
  exclude using gist (
    resource_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (
    blocks_calendar
    and resource_id is not null
    and status in ('awaiting_payment', 'confirmed', 'blocked')
  );

-- ---------------------------------------------------------------------
-- Derive blocks_calendar, and enforce the venue/service shape.
-- ---------------------------------------------------------------------
create or replace function bookings_set_shape()
returns trigger language plpgsql as $$
declare
  v_type text;
  v_resource_provider uuid;
begin
  select supplier_type into v_type from providers where id = new.provider_id;
  if v_type is null then
    raise exception 'unknown provider %', new.provider_id using errcode = 'foreign_key_violation';
  end if;

  new.blocks_calendar := (v_type = 'venue');

  if new.blocks_calendar and new.resource_id is null then
    raise exception 'venue booking requires a resource_id (provider %)', new.provider_id
      using errcode = 'check_violation';
  end if;

  if not new.blocks_calendar and new.resource_id is not null then
    raise exception 'service booking must not carry a resource_id (provider %)', new.provider_id
      using errcode = 'check_violation';
  end if;

  if new.resource_id is not null then
    select provider_id into v_resource_provider from resources where id = new.resource_id;
    if v_resource_provider is distinct from new.provider_id then
      raise exception 'resource % does not belong to provider %', new.resource_id, new.provider_id
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end $$;

create trigger bookings_set_shape
  before insert or update on bookings
  for each row execute function bookings_set_shape();

-- ---------------------------------------------------------------------
-- Service concurrency (the other half of the venue/service split).
--
-- An exclusion constraint cannot express "at most N overlapping", so
-- this serialises per provider with an advisory lock and counts. Raises
-- 23P01 so callers handle both supplier types through one code path.
-- ---------------------------------------------------------------------
create or replace function bookings_enforce_concurrency()
returns trigger language plpgsql as $$
declare
  v_limit integer;
  v_count integer;
begin
  if new.blocks_calendar then
    return new;                                   -- venues use the constraint
  end if;
  if not (new.status = any (booking_occupying_statuses())) then
    return new;
  end if;

  select concurrency_limit into v_limit from providers where id = new.provider_id;

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

create trigger bookings_enforce_concurrency
  before insert or update on bookings
  for each row execute function bookings_enforce_concurrency();

-- ---------------------------------------------------------------------
-- The state machine (§26). Full table in spec/states.md.
-- ---------------------------------------------------------------------
create or replace function booking_can_transition(from_status text, to_status text)
returns boolean language sql immutable as $$
  select (from_status, to_status) in (
    ('requested',        'accepted'),
    ('requested',        'rejected'),
    ('requested',        'expired'),
    ('requested',        'cancelled_client'),
    ('accepted',         'awaiting_payment'),
    ('accepted',         'confirmed'),           -- flows with no payment step
    ('accepted',         'expired'),
    ('accepted',         'cancelled_client'),
    ('accepted',         'cancelled_provider'),
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

-- How long each pending state holds the slot.
create or replace function booking_hold_window(p_status text)
returns interval language sql immutable as $$
  select case p_status
    when 'requested'        then interval '48 hours'   -- supplier must answer
    when 'accepted'         then interval '48 hours'   -- client must proceed
    when 'awaiting_payment' then interval '24 hours'   -- client must pay
    else null
  end;
$$;

create or replace function bookings_guard_transition()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if not booking_can_transition(old.status, new.status) then
      raise exception 'illegal booking transition % -> %', old.status, new.status
        using errcode = 'check_violation';
    end if;
  end if;

  new.expires_at := case
    when tg_op = 'INSERT' or new.status is distinct from old.status
      then now() + booking_hold_window(new.status)
    else new.expires_at
  end;

  return new;
end $$;

-- Runs after bookings_set_shape so blocks_calendar is already derived.
create trigger bookings_guard_transition
  before insert or update on bookings
  for each row execute function bookings_guard_transition();

-- =====================================================================
-- Audit trail (§38). Append-only. Every state change is recorded with
-- who did it and when — this is what makes complaints resolvable.
-- =====================================================================
create table booking_events (
  id           bigint generated always as identity primary key,
  booking_id   uuid not null references bookings(id) on delete cascade,
  from_status  text,
  to_status    text not null,
  actor_id     uuid references profiles(id),      -- null when a job did it
  payload      jsonb not null default '{}',
  created_at   timestamptz not null default now()
);

create index booking_events_booking_idx on booking_events (booking_id, created_at);

-- SECURITY DEFINER: booking_events has RLS enabled and no INSERT policy.
-- The audit trail is written by this trigger and by nothing else.
create or replace function bookings_write_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into booking_events (booking_id, from_status, to_status, actor_id)
    values (
      new.id,
      case when tg_op = 'UPDATE' then old.status else null end,
      new.status,
      auth.uid()
    );
  end if;
  return null;
end $$;

create trigger bookings_write_event
  after insert or update on bookings
  for each row execute function bookings_write_event();

-- booking_events is append-only: no updates, no deletes, ever.
--
-- A consequence worth stating: this also makes bookings undeletable,
-- because the cascade from bookings would have to delete audit rows.
-- That is intended. Bookings reach a terminal state; they are never
-- removed, and the trail of who changed what survives (§38). Account
-- deletion under §37 is a status change on profiles, not a DELETE.
create or replace function reject_mutation()
returns trigger language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = 'check_violation';
end $$;

create trigger booking_events_append_only
  before update or delete on booking_events
  for each row execute function reject_mutation();

-- =====================================================================
-- Expiry job (§26). Run every 5 minutes. Returns how many it released.
-- =====================================================================
create or replace function expire_stale_bookings()
returns integer language plpgsql as $$
declare
  v_count integer;
begin
  with expired as (
    update bookings
       set status = 'expired'
     where expires_at is not null
       and expires_at < now()
       and status in ('requested', 'accepted', 'awaiting_payment')
    returning 1
  )
  select count(*) into v_count from expired;
  return v_count;
end $$;

comment on function expire_stale_bookings is
  'Releases dates held by unanswered or unpaid bookings. Scheduled every 5 minutes.';
