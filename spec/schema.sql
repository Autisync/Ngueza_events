-- ===================================================================
-- GENERATED — do not edit. Run: npm run schema:dump
-- Source of truth is supabase/migrations/*.sql
-- ===================================================================

-- ─────────────── 0001_extensions.sql ───────────────
-- =====================================================================
-- 0001 — extensions and shared helpers
--
-- Authorization helpers live in 0005, after the tables they read.
-- =====================================================================

create extension if not exists pgcrypto;    -- gen_random_uuid()
create extension if not exists btree_gist;  -- exclusion constraints over (uuid, tstzrange)
create extension if not exists citext;      -- case-insensitive email
create extension if not exists unaccent;    -- Portuguese-friendly slugs and search
create extension if not exists pg_trgm;     -- fuzzy name search

-- ---------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- slugify('Salão de Festas Talatona') -> 'salao-de-festas-talatona'
-- Not immutable (unaccent is not); never use this in an index expression.
-- ---------------------------------------------------------------------
create or replace function slugify(txt text)
returns text language sql stable as $$
  select trim(both '-' from
    regexp_replace(
      regexp_replace(lower(unaccent(coalesce(txt, ''))), '[^a-z0-9]+', '-', 'g'),
      '-{2,}', '-', 'g'
    )
  );
$$;

-- ─────────────── 0002_identity.sql ───────────────
-- =====================================================================
-- 0002 — identity (§12, §13, §36)
-- =====================================================================

create table profiles (
  id             uuid primary key,                 -- mirrors auth.users.id
  role           text not null default 'client'
                   check (role in ('client', 'provider', 'admin')),
  full_name      text,
  email          citext not null unique,
  phone          text,
  email_verified boolean not null default false,
  phone_verified boolean not null default false,   -- §25: a verified phone is a trust signal
  locale         text not null default 'pt-AO',
  status         text not null default 'active'
                   check (status in ('active', 'suspended', 'deleted')),
  -- §37: account deletion is a state, not a DELETE. Bookings and audit
  -- records must survive it; personal fields are cleared on transition.
  deleted_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index profiles_role_idx   on profiles (role) where status = 'active';
create index profiles_status_idx on profiles (status);

create trigger profiles_updated_at
  before update on profiles
  for each row execute function set_updated_at();

comment on table profiles is
  'One row per authenticated user. Role gates everything; see RLS in 0010.';

-- ─────────────── 0003_taxonomy.sql ───────────────
-- =====================================================================
-- 0003 — categories and locations (§6, §43, §44)
--
-- Both are self-referencing trees managed by administrators at runtime.
-- Neither may ever become an enum or a TypeScript union. This is the
-- decision that lets NGUEZA expand from events into general services
-- without a rewrite.
-- =====================================================================

create table categories (
  id           uuid primary key default gen_random_uuid(),
  parent_id    uuid references categories(id) on delete restrict,
  slug         text not null unique,
  name         text not null,                     -- pt-AO, user-facing
  description  text,
  icon         text,
  -- Which supplier type this category implies when a provider registers.
  -- 'either' lets an administrator create ambiguous categories deliberately.
  default_supplier_type text not null default 'service'
                 check (default_supplier_type in ('venue', 'service', 'either')),
  sort_order   integer not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint categories_not_own_parent check (id <> parent_id)
);

create index categories_parent_idx on categories (parent_id);
create index categories_active_idx on categories (is_active, sort_order);

create trigger categories_updated_at
  before update on categories
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- Província → Município → Distrito/Bairro (§43)
--
-- Same table, distinguished by `level`, so adding a fourth level or a
-- second country is data rather than a migration.
-- ---------------------------------------------------------------------
create table locations (
  id          uuid primary key default gen_random_uuid(),
  parent_id   uuid references locations(id) on delete restrict,
  level       text not null
                check (level in ('country', 'province', 'municipality', 'district')),
  slug        text not null,
  name        text not null,
  -- Plain lat/lng rather than PostGIS: the MVP needs a map pin, not
  -- proximity search. When "perto de mim" ships, add PostGIS and a
  -- geography column alongside these.
  lat         numeric(9, 6),
  lng         numeric(9, 6),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint locations_not_own_parent check (id <> parent_id),
  unique (parent_id, slug)
);

create index locations_parent_idx on locations (parent_id);
create index locations_level_idx  on locations (level) where is_active;

create trigger locations_updated_at
  before update on locations
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- Ancestry helper. Used by search: "everything in Luanda" must include
-- every município and bairro beneath it.
-- ---------------------------------------------------------------------
create or replace function location_descendants(root uuid)
returns table (id uuid) language sql stable as $$
  with recursive tree as (
    select l.id from locations l where l.id = root
    union all
    select l.id from locations l join tree t on l.parent_id = t.id
  )
  select id from tree;
$$;

create or replace function category_descendants(root uuid)
returns table (id uuid) language sql stable as $$
  with recursive tree as (
    select c.id from categories c where c.id = root
    union all
    select c.id from categories c join tree t on c.parent_id = t.id
  )
  select id from tree;
$$;

-- ─────────────── 0004_providers.sql ───────────────
-- =====================================================================
-- 0004 — providers, resources, services, media (§7, §8, §25, §40)
-- =====================================================================

create table providers (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references profiles(id) on delete restrict,

  -- -----------------------------------------------------------------
  -- The supplier type discriminator.
  --
  -- 'venue'   — date-exclusive. A salão booked on 15 December cannot be
  --             booked again on 15 December. Enforced by the exclusion
  --             constraint in 0005. Requires at least one resource.
  -- 'service' — mobile or time-sliced. A maquilhadora can serve three
  --             clients in a day. Enforced by a concurrency trigger.
  --
  -- Modelling both as one calendar was the single most expensive
  -- mistake available in this schema. It is cheap here and a migration
  -- plus a re-onboarding campaign later.
  -- -----------------------------------------------------------------
  supplier_type text not null check (supplier_type in ('venue', 'service')),

  -- How many overlapping bookings a 'service' provider will accept.
  -- Ignored for venues, whose exclusivity comes from the constraint.
  concurrency_limit integer not null default 1
                      check (concurrency_limit >= 1),

  slug          text not null unique,
  name          text not null,
  description   text,
  category_id   uuid not null references categories(id) on delete restrict,
  location_id   uuid not null references locations(id) on delete restrict,
  address_line  text,
  lat           numeric(9, 6),
  lng           numeric(9, 6),

  phone         text,
  whatsapp      text,
  email         citext,
  website       text,
  social        jsonb not null default '{}',

  -- §25: verification is a state machine, initially part-manual.
  verification_status text not null default 'unverified'
                        check (verification_status in
                          ('unverified', 'pending', 'verified', 'rejected', 'suspended')),
  verified_at   timestamptz,
  verified_by   uuid references profiles(id),
  rejection_reason text,

  -- Declared, supplier-provided, explicitly unverified (part 07 of the
  -- adjustments memo). Displayed separately from verified evidence so
  -- the profile is not blank before the first real review exists.
  years_active_declared integer check (years_active_declared >= 0),

  is_published  boolean not null default false,
  published_at  timestamptz,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index providers_category_idx on providers (category_id) where is_published;
create index providers_location_idx on providers (location_id) where is_published;
create index providers_owner_idx    on providers (owner_id);
create index providers_status_idx   on providers (verification_status);
create index providers_name_trgm    on providers using gin (name gin_trgm_ops);

create trigger providers_updated_at
  before update on providers
  for each row execute function set_updated_at();

-- A provider may only be published once verified (§25).
create or replace function providers_guard_publish()
returns trigger language plpgsql as $$
begin
  if new.is_published and new.verification_status <> 'verified' then
    raise exception 'provider % cannot be published while % ', new.id, new.verification_status
      using errcode = 'check_violation';
  end if;
  if new.is_published and old.is_published is distinct from true then
    new.published_at = now();
  end if;
  return new;
end $$;

create trigger providers_guard_publish
  before insert or update on providers
  for each row execute function providers_guard_publish();

-- ---------------------------------------------------------------------
-- Bookable spaces. A casa de festas with two salões has two rows here,
-- each with its own calendar. Venues need at least one; services none.
-- ---------------------------------------------------------------------
create table resources (
  id           uuid primary key default gen_random_uuid(),
  provider_id  uuid not null references providers(id) on delete cascade,
  name         text not null,                    -- 'Salão Principal'
  capacity     integer check (capacity > 0),     -- §16 comparison, §5 search
  is_active    boolean not null default true,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index resources_provider_idx on resources (provider_id) where is_active;

create trigger resources_updated_at
  before update on resources
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- Services and prices (§7, §16)
--
-- Price is a spectrum, not a single number. Many event suppliers in this
-- market price by negotiation; forcing one public figure produces either
-- a refusal to list or a defensive anchor. Suppliers with concrete
-- pricing are ranked higher instead — transparency is made profitable
-- rather than mandatory.
-- ---------------------------------------------------------------------
create table services (
  id             uuid primary key default gen_random_uuid(),
  provider_id    uuid not null references providers(id) on delete cascade,
  category_id    uuid not null references categories(id) on delete restrict,
  name           text not null,
  description    text,

  price_mode     text not null default 'on_request'
                   check (price_mode in ('exact', 'from', 'range', 'on_request')),
  -- Kwanza in cêntimos. Money is an integer, always. Never a float.
  price_minor     bigint check (price_minor >= 0),
  price_max_minor bigint check (price_max_minor >= 0),
  price_unit      text not null default 'event'
                   check (price_unit in ('event', 'hour', 'day', 'person')),
  currency        text not null default 'AOA',

  min_capacity   integer check (min_capacity > 0),
  max_capacity   integer check (max_capacity > 0),

  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint services_price_shape check (
    case price_mode
      when 'exact'      then price_minor is not null and price_max_minor is null
      when 'from'       then price_minor is not null and price_max_minor is null
      when 'range'      then price_minor is not null and price_max_minor is not null
                             and price_max_minor >= price_minor
      when 'on_request' then price_minor is null and price_max_minor is null
    end
  ),
  constraint services_capacity_shape check (
    max_capacity is null or min_capacity is null or max_capacity >= min_capacity
  )
);

create index services_provider_idx on services (provider_id) where is_active;
create index services_category_idx on services (category_id) where is_active;
create index services_price_idx    on services (price_minor) where is_active and price_minor is not null;

create trigger services_updated_at
  before update on services
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- Media (§8, §40)
--
-- The file never touches the app server. Browser uploads to a signed
-- Cloudflare URL; this table stores the id and nothing heavier.
-- ---------------------------------------------------------------------
create table media (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references providers(id) on delete cascade,
  kind          text not null check (kind in ('image', 'video')),
  external_id   text not null,                   -- Cloudflare Images / Stream id
  event_type    text,                            -- 'casamento', 'aniversario', ... (§8)
  alt_text      text,
  sort_order    integer not null default 0,
  is_cover      boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (provider_id, external_id)
);

create index media_provider_idx on media (provider_id, sort_order);

-- §40: video storage escalates fast. Capped at 2 per provider for v1;
-- lift the cap once real demand is measured.
create or replace function media_cap_videos()
returns trigger language plpgsql as $$
begin
  if new.kind = 'video' and (
    select count(*) from media
    where provider_id = new.provider_id and kind = 'video' and id <> new.id
  ) >= 2 then
    raise exception 'video limit reached for provider %', new.provider_id
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger media_cap_videos
  before insert or update on media
  for each row execute function media_cap_videos();

-- One cover image per provider.
create unique index media_one_cover_idx
  on media (provider_id) where is_cover;

-- ─────────────── 0005_authz_helpers.sql ───────────────
-- =====================================================================
-- 0005 — authorization helpers
--
-- Defined after profiles (0002) and providers (0004) because SQL-language
-- function bodies are validated at creation time — unlike plpgsql, they
-- cannot forward-reference a table.
--
-- SECURITY DEFINER on purpose: these are called from RLS policies on the
-- very tables they read. Without it, evaluating a policy on profiles
-- would re-enter the policy on profiles and recurse.
-- =====================================================================

create or replace function current_role_name()
returns text language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from profiles where id = auth.uid()), false);
$$;

-- Is the current user the owner of this provider?
create or replace function owns_provider(p_provider_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from providers
    where id = p_provider_id and owner_id = auth.uid()
  );
$$;

-- ─────────────── 0006_bookings.sql ───────────────
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

-- ─────────────── 0007_reviews_reports.sql ───────────────
-- =====================================================================
-- 0006 — reviews and moderation (§14, §30, §31)
-- =====================================================================

create table reviews (
  id           uuid primary key default gen_random_uuid(),
  provider_id  uuid not null references providers(id) on delete cascade,
  author_id    uuid not null references profiles(id) on delete restrict,

  -- §30: the "Avaliação de Reserva Verificada" seal. A review carrying a
  -- completed booking is verified; one without it is not, and the two are
  -- displayed distinguishably. Nullable now so other review types can be
  -- allowed later without a migration.
  booking_id   uuid unique references bookings(id) on delete set null,
  is_verified  boolean not null default false,

  -- §14 sub-scores, 1..5
  rating_overall     smallint not null check (rating_overall between 1 and 5),
  rating_quality     smallint check (rating_quality between 1 and 5),
  rating_service     smallint check (rating_service between 1 and 5),
  rating_punctuality smallint check (rating_punctuality between 1 and 5),
  rating_cleanliness smallint check (rating_cleanliness between 1 and 5),
  rating_value       smallint check (rating_value between 1 and 5),

  comment      text,
  provider_reply      text,                       -- §30: right of reply
  provider_replied_at timestamptz,

  status       text not null default 'published'
                 check (status in ('published', 'hidden', 'removed')),

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index reviews_provider_idx on reviews (provider_id, created_at desc)
  where status = 'published';
create unique index reviews_one_per_booking_idx on reviews (booking_id)
  where booking_id is not null;

create trigger reviews_updated_at
  before update on reviews
  for each row execute function set_updated_at();

-- A review is verified only if its booking actually completed, and only
-- if the author is the client who booked. Derived, never asserted by
-- application code.
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
          and b.provider_id = new.provider_id)
    into v_ok
    from bookings b where b.id = new.booking_id;

  new.is_verified := coalesce(v_ok, false);
  return new;
end $$;

create trigger reviews_derive_verified
  before insert or update on reviews
  for each row execute function reviews_derive_verified();

-- ---------------------------------------------------------------------
-- Reports / denúncias (§30, §31)
-- ---------------------------------------------------------------------
create table reports (
  id           uuid primary key default gen_random_uuid(),
  reporter_id  uuid references profiles(id) on delete set null,
  target_type  text not null check (target_type in ('provider', 'review', 'media', 'booking')),
  target_id    uuid not null,
  reason       text not null check (reason in
                 ('fake_listing', 'misleading_photos', 'fake_review',
                  'no_show', 'offensive', 'wrong_info', 'other')),
  detail       text,
  status       text not null default 'open'
                 check (status in ('open', 'reviewing', 'upheld', 'dismissed')),
  resolved_by  uuid references profiles(id),
  resolved_at  timestamptz,
  resolution_note text,
  created_at   timestamptz not null default now()
);

create index reports_open_idx   on reports (status, created_at) where status in ('open', 'reviewing');
create index reports_target_idx on reports (target_type, target_id);

-- ─────────────── 0008_payments.sql ───────────────
-- =====================================================================
-- 0007 — payments and policies (§11, §28, §29)
--
-- v1 ships ONE adapter: 'manual_proof'. The client pays the supplier
-- directly and uploads proof; NGUEZA never receives, holds or forwards
-- money. Every model where it would (§28 B/C) requires a legal opinion
-- and a licensed partner first.
--
-- The table shape is provider-agnostic so those adapters drop in later
-- without a migration.
-- =====================================================================

create table cancellation_policies (
  id             uuid primary key default gen_random_uuid(),
  provider_id    uuid references providers(id) on delete cascade,  -- null = platform default
  name           text not null,
  -- Refund percentage by days before the event, most generous first:
  -- [{"days_before": 30, "refund_pct": 100}, {"days_before": 7, "refund_pct": 50}]
  tiers          jsonb not null default '[]',
  notes          text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index cancellation_policies_provider_idx on cancellation_policies (provider_id)
  where is_active;

create trigger cancellation_policies_updated_at
  before update on cancellation_policies
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
create table payments (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null references bookings(id) on delete restrict,

  provider_key  text not null default 'manual_proof'
                  check (provider_key in
                    ('manual_proof', 'multicaixa_reference', 'bank_transfer', 'card')),
  reference     text,                              -- the payment reference, when there is one

  amount_minor  bigint not null check (amount_minor >= 0),   -- cêntimos, never a float
  currency      text not null default 'AOA',

  status        text not null default 'pending'
                  check (status in ('pending', 'submitted', 'confirmed', 'failed', 'refunded')),

  proof_media_id uuid references media(id) on delete set null,  -- manual_proof only
  confirmed_by  uuid references profiles(id),      -- who accepted the proof
  confirmed_at  timestamptz,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index payments_booking_idx on payments (booking_id);
create index payments_status_idx  on payments (status) where status in ('pending', 'submitted');

create trigger payments_updated_at
  before update on payments
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- Webhook log. Every external provider retries deliveries, sometimes for
-- days. The unique constraint makes a replay a no-op rather than a
-- second state transition.
-- ---------------------------------------------------------------------
create table payment_events (
  id                uuid primary key default gen_random_uuid(),
  provider_key      text not null,
  provider_event_id text not null,
  payment_id        uuid references payments(id) on delete set null,
  payload           jsonb not null,
  received_at       timestamptz not null default now(),
  unique (provider_key, provider_event_id)
);

create table refunds (
  id            uuid primary key default gen_random_uuid(),
  payment_id    uuid not null references payments(id) on delete restrict,
  amount_minor  bigint not null check (amount_minor >= 0),
  reason        text,
  status        text not null default 'pending'
                  check (status in ('pending', 'processed', 'failed')),
  processed_by  uuid references profiles(id),
  processed_at  timestamptz,
  created_at    timestamptz not null default now()
);

create index refunds_payment_idx on refunds (payment_id);

-- ─────────────── 0009_newsletter.sql ───────────────
-- =====================================================================
-- 0008 — newsletter and waitlist (§37)
--
-- Not a marketing checkbox. The waitlist runs during the build, before
-- the platform exists, and turns weeks of building in silence into an
-- audience plus evidence of which categories and municipalities people
-- actually want — which directs supplier recruitment.
--
-- Marketing consent is a different legal basis from booking data, so it
-- is recorded as an audit trail rather than a boolean.
-- =====================================================================

create table newsletter_subscribers (
  id              uuid primary key default gen_random_uuid(),
  email           citext not null unique,
  profile_id      uuid references profiles(id) on delete set null,  -- null for waitlist

  audience        text not null default 'client'
                    check (audience in ('client', 'provider')),

  status          text not null default 'pending'
                    check (status in ('pending', 'confirmed', 'unsubscribed', 'bounced', 'complained')),

  -- {"categories": [uuid], "locations": [uuid]} — drives the "New in
  -- Talatona" digest and, before launch, tells recruitment where demand is.
  interests       jsonb not null default '{}',

  source          text check (source in
                    ('waitlist', 'footer', 'zero_result', 'signup', 'booking', 'import')),
  source_detail   text,                            -- e.g. the query that returned nothing

  locale          text not null default 'pt-AO',

  -- Double opt-in and one-click unsubscribe. Signed, single-purpose.
  confirm_token     text unique,
  unsubscribe_token text not null unique default encode(gen_random_bytes(24), 'hex'),

  confirmed_at    timestamptz,
  unsubscribed_at timestamptz,
  last_sent_at    timestamptz,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- Nothing is sent to an unconfirmed address.
  constraint newsletter_confirmed_shape check (
    (status = 'confirmed') = (confirmed_at is not null)
  )
);

create index newsletter_status_idx   on newsletter_subscribers (status);
create index newsletter_audience_idx on newsletter_subscribers (audience, status);
create index newsletter_source_idx   on newsletter_subscribers (source, created_at);
create index newsletter_interests_idx on newsletter_subscribers using gin (interests);

create trigger newsletter_subscribers_updated_at
  before update on newsletter_subscribers
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- The consent trail. A boolean proves nothing later; this records what
-- was shown, when, and from where — which is what §37 actually needs.
-- Append-only.
-- ---------------------------------------------------------------------
create table newsletter_consent_events (
  id            bigint generated always as identity primary key,
  subscriber_id uuid not null references newsletter_subscribers(id) on delete cascade,
  action        text not null check (action in
                  ('subscribed', 'confirmed', 'unsubscribed', 'resubscribed',
                   'bounced', 'complained')),
  consent_text  text,                              -- the exact wording presented
  source_url    text,
  ip            inet,
  user_agent    text,
  created_at    timestamptz not null default now()
);

create index newsletter_consent_subscriber_idx
  on newsletter_consent_events (subscriber_id, created_at);

create trigger newsletter_consent_append_only
  before update or delete on newsletter_consent_events
  for each row execute function reject_mutation();

-- ---------------------------------------------------------------------
-- The sendable audience. Marketing mail joins against this view and
-- never against the table, so an unconfirmed or unsubscribed address
-- cannot be reached by accident.
--
-- Transactional booking mail does NOT consult this at all — it travels
-- on a separate sending identity with its own suppression list. A
-- marketing unsubscribe must never stop a booking confirmation.
-- ---------------------------------------------------------------------
create view newsletter_sendable as
  select id, email, audience, interests, locale, last_sent_at
    from newsletter_subscribers
   where status = 'confirmed';

comment on view newsletter_sendable is
  'Marketing sends read from here only. Transactional mail is separate.';

-- ─────────────── 0010_analytics_and_health.sql ───────────────
-- =====================================================================
-- 0009 — event tracking and supplier health (§32, §48, §49)
--
-- Nine of the phase-two decisions are gated on numbers that come from
-- this table. None of it can be backfilled, which is why it ships in v1
-- rather than alongside the dashboard that reads it.
-- =====================================================================

create table events (
  id           bigint generated always as identity primary key,
  name         text not null check (name in (
                 'search_performed',
                 'provider_viewed',
                 'phone_revealed',        -- §32 leakage numerator
                 'whatsapp_clicked',      -- §32 leakage numerator
                 'booking_requested',
                 'payment_proof_uploaded',
                 'newsletter_subscribed',
                 'zero_result'
               )),
  session_id   text,
  profile_id   uuid references profiles(id) on delete set null,
  provider_id  uuid references providers(id) on delete set null,
  -- Query, filters, result_count, device class, connection type, referrer.
  props        jsonb not null default '{}',
  created_at   timestamptz not null default now()
);

create index events_name_time_idx on events (name, created_at desc);
create index events_provider_idx  on events (provider_id, created_at desc)
  where provider_id is not null;
create index events_props_idx     on events using gin (props);

-- =====================================================================
-- Supplier health (adjustments memo, part 08).
--
-- A supplier who receives no leads stops maintaining their calendar; a
-- stale calendar gives a wrong availability answer; a wrong answer costs
-- a client permanently. Health feeds ranking and triggers the monthly
-- digest, which is the only nudge that reliably works.
--
-- A view is fine at MVP volume. Make it materialised, refreshed hourly,
-- once providers pass a few thousand.
-- =====================================================================
create view provider_health as
select
  p.id as provider_id,
  p.name,
  p.verification_status,
  p.is_published,

  -- Requests answered, and how fast.
  count(*) filter (
    where b.status not in ('requested', 'blocked')
  )::int as answered_count,
  count(*) filter (where b.status = 'expired')::int as expired_count,
  count(*) filter (where b.status = 'completed')::int as completed_count,

  round(
    100.0 * count(*) filter (where b.status = 'expired')
    / nullif(count(*) filter (where b.status <> 'blocked'), 0)
  , 1) as expiry_rate_pct,

  avg(
    extract(epoch from (be.created_at - b.created_at)) / 3600.0
  ) filter (where be.to_status = 'accepted') as median_response_hours,

  -- Is the calendar being maintained at all?
  max(b.updated_at)  as last_booking_activity,
  greatest(p.updated_at, max(b.updated_at)) as last_activity_at,

  (greatest(p.updated_at, coalesce(max(b.updated_at), p.updated_at))
     < now() - interval '30 days') as is_stale

from providers p
left join bookings b       on b.provider_id = p.id
left join booking_events be on be.booking_id = b.id and be.to_status = 'accepted'
group by p.id;

comment on view provider_health is
  'Ranking input and digest trigger. Stale suppliers are demoted from date-filtered search, never deleted.';

-- ─────────────── 0011_rls.sql ───────────────
-- =====================================================================
-- 0010 — row-level security (§36)
--
-- Tenant isolation lives here, not in application code. A table without
-- policies is an incomplete slice. Every policy below has a matching
-- assertion in tests/sql/ — security stops being a code-review opinion
-- and becomes a failing build.
-- =====================================================================

alter table profiles                 enable row level security;
alter table categories               enable row level security;
alter table locations                enable row level security;
alter table providers                enable row level security;
alter table resources                enable row level security;
alter table services                 enable row level security;
alter table media                    enable row level security;
alter table bookings                 enable row level security;
alter table booking_events           enable row level security;
alter table reviews                  enable row level security;
alter table reports                  enable row level security;
alter table cancellation_policies    enable row level security;
alter table payments                 enable row level security;
alter table payment_events           enable row level security;
alter table refunds                  enable row level security;
alter table newsletter_subscribers   enable row level security;
alter table newsletter_consent_events enable row level security;
alter table events                   enable row level security;

-- ---------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------
create policy profiles_self_read on profiles
  for select using (id = auth.uid() or is_admin());

create policy profiles_self_update on profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

create policy profiles_admin_all on profiles
  for all using (is_admin()) with check (is_admin());

-- Role escalation must not be self-service.
create or replace function profiles_guard_role()
returns trigger language plpgsql as $$
begin
  if new.role is distinct from old.role and not is_admin() then
    raise exception 'only an administrator may change a role'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

create trigger profiles_guard_role
  before update on profiles
  for each row execute function profiles_guard_role();

-- ---------------------------------------------------------------------
-- taxonomy — world-readable, admin-writable (§44)
-- ---------------------------------------------------------------------
create policy categories_public_read on categories
  for select using (is_active or is_admin());
create policy categories_admin_write on categories
  for all using (is_admin()) with check (is_admin());

create policy locations_public_read on locations
  for select using (is_active or is_admin());
create policy locations_admin_write on locations
  for all using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------
-- providers — anonymous visitors see published, verified suppliers only
-- ---------------------------------------------------------------------
create policy providers_public_read on providers
  for select using (
    (is_published and verification_status = 'verified')
    or owner_id = auth.uid()
    or is_admin()
  );

create policy providers_owner_insert on providers
  for insert with check (owner_id = auth.uid());

create policy providers_owner_update on providers
  for update using (owner_id = auth.uid() or is_admin())
  with check (owner_id = auth.uid() or is_admin());

create policy providers_admin_delete on providers
  for delete using (is_admin());

-- Verification state is an administrator's decision (§25), never the
-- supplier's own.
create or replace function providers_guard_verification()
returns trigger language plpgsql as $$
begin
  if new.verification_status is distinct from old.verification_status
     and not is_admin() then
    raise exception 'only an administrator may change verification_status'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

create trigger providers_guard_verification
  before update on providers
  for each row execute function providers_guard_verification();

-- ---------------------------------------------------------------------
-- provider-owned content
-- ---------------------------------------------------------------------
create policy resources_public_read on resources
  for select using (
    is_active and exists (
      select 1 from providers p
      where p.id = resources.provider_id
        and p.is_published and p.verification_status = 'verified'
    )
    or owns_provider(resources.provider_id) or is_admin()
  );
create policy resources_owner_write on resources
  for all using (owns_provider(provider_id) or is_admin())
  with check (owns_provider(provider_id) or is_admin());

create policy services_public_read on services
  for select using (
    is_active and exists (
      select 1 from providers p
      where p.id = services.provider_id
        and p.is_published and p.verification_status = 'verified'
    )
    or owns_provider(services.provider_id) or is_admin()
  );
create policy services_owner_write on services
  for all using (owns_provider(provider_id) or is_admin())
  with check (owns_provider(provider_id) or is_admin());

create policy media_public_read on media
  for select using (
    exists (
      select 1 from providers p
      where p.id = media.provider_id
        and p.is_published and p.verification_status = 'verified'
    )
    or owns_provider(media.provider_id) or is_admin()
  );
create policy media_owner_write on media
  for all using (owns_provider(provider_id) or is_admin())
  with check (owns_provider(provider_id) or is_admin());

-- ---------------------------------------------------------------------
-- bookings — visible to the two parties and to administrators, nobody else
-- ---------------------------------------------------------------------
create policy bookings_party_read on bookings
  for select using (
    client_id = auth.uid() or owns_provider(provider_id) or is_admin()
  );

create policy bookings_client_insert on bookings
  for insert with check (
    (client_id = auth.uid() and status = 'requested')
    or (owns_provider(provider_id) and status = 'blocked')   -- §27 manual block
    or is_admin()
  );

create policy bookings_party_update on bookings
  for update using (
    client_id = auth.uid() or owns_provider(provider_id) or is_admin()
  ) with check (
    client_id = auth.uid() or owns_provider(provider_id) or is_admin()
  );

-- Bookings are never deleted; they reach a terminal state. No DELETE policy.

create policy booking_events_party_read on booking_events
  for select using (
    exists (
      select 1 from bookings b
      where b.id = booking_events.booking_id
        and (b.client_id = auth.uid() or owns_provider(b.provider_id) or is_admin())
    )
  );
-- No INSERT policy: the audit trail is written by a SECURITY DEFINER
-- trigger and by nothing else.

-- ---------------------------------------------------------------------
-- reviews and reports
-- ---------------------------------------------------------------------
create policy reviews_public_read on reviews
  for select using (status = 'published' or author_id = auth.uid() or is_admin());

create policy reviews_author_insert on reviews
  for insert with check (author_id = auth.uid());

create policy reviews_author_update on reviews
  for update using (author_id = auth.uid() or is_admin())
  with check (author_id = auth.uid() or is_admin());

-- A supplier may write only their own reply, never the rating or comment.
create or replace function reviews_guard_reply()
returns trigger language plpgsql as $$
begin
  if owns_provider(new.provider_id) and not is_admin()
     and new.author_id is distinct from auth.uid() then
    if new.rating_overall is distinct from old.rating_overall
       or new.comment is distinct from old.comment
       or new.status is distinct from old.status then
      raise exception 'a supplier may only add a reply to a review'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end $$;

create trigger reviews_guard_reply
  before update on reviews
  for each row execute function reviews_guard_reply();

create policy reports_insert_any on reports
  for insert with check (true);                    -- §30: anyone may report
create policy reports_admin_read on reports
  for select using (is_admin() or reporter_id = auth.uid());
create policy reports_admin_write on reports
  for update using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------
-- money — read-only to the parties, written server-side only
-- ---------------------------------------------------------------------
create policy policies_public_read on cancellation_policies
  for select using (is_active or owns_provider(provider_id) or is_admin());
create policy policies_owner_write on cancellation_policies
  for all using (owns_provider(provider_id) or is_admin())
  with check (owns_provider(provider_id) or is_admin());

create policy payments_party_read on payments
  for select using (
    exists (
      select 1 from bookings b
      where b.id = payments.booking_id
        and (b.client_id = auth.uid() or owns_provider(b.provider_id) or is_admin())
    )
  );
create policy payments_admin_write on payments
  for all using (is_admin()) with check (is_admin());

create policy refunds_admin_all on refunds
  for all using (is_admin()) with check (is_admin());

-- payment_events has no policy at all: webhooks are handled server-side
-- with the service role. Nothing reachable from a browser touches it.

-- ---------------------------------------------------------------------
-- newsletter — anyone may subscribe, nobody may read the list
-- ---------------------------------------------------------------------
create policy newsletter_public_subscribe on newsletter_subscribers
  for insert with check (status = 'pending');

create policy newsletter_admin_read on newsletter_subscribers
  for select using (is_admin() or profile_id = auth.uid());

create policy newsletter_admin_write on newsletter_subscribers
  for update using (is_admin()) with check (is_admin());
-- Confirm and unsubscribe run server-side against a signed token, not
-- through a browser session — so no token-based policy is needed here.

create policy newsletter_consent_admin_read on newsletter_consent_events
  for select using (is_admin());
create policy newsletter_consent_insert on newsletter_consent_events
  for insert with check (true);

-- ---------------------------------------------------------------------
-- analytics — write-only from the browser, readable by administrators
-- ---------------------------------------------------------------------
create policy events_public_insert on events
  for insert with check (true);
create policy events_admin_read on events
  for select using (is_admin());

-- ─────────────── 0012_app_roles.sql ───────────────
-- =====================================================================
-- 0012 — application roles
--
-- Row-level security only protects anything if the application connects
-- as a restricted role. A server route holding a superuser connection
-- bypasses every policy in 0011 silently.
--
-- These mirror the roles Supabase provides (anon / authenticated /
-- service_role), created here so local and CI environments behave
-- identically to production. Broad table grants are correct in this
-- model: RLS does the gating, GRANT only opens the door to the policy.
-- =====================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;

-- anon: can read public content, and can write only where a policy says
-- so — joining the waitlist and emitting analytics events. Every other
-- insert is refused by RLS because auth.uid() is null.
grant select, insert on all tables in schema public to anon;

-- authenticated: full DML surface, gated entirely by RLS.
grant select, insert, update, delete on all tables in schema public to authenticated;

-- service_role has BYPASSRLS, which skips policies but NOT grant checks.
-- Without these it cannot read its own tables.
grant all on all tables in schema public to service_role;

grant usage, select on all sequences in schema public to anon, authenticated;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;

alter default privileges in schema public
  grant select, insert on tables to anon;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant all on tables to service_role;
alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;

-- The audit trail is never writable through a session role; only the
-- SECURITY DEFINER trigger writes it.
revoke insert, update, delete on booking_events from anon, authenticated;

-- Webhooks are handled server-side with the service role only.
revoke all on payment_events from anon, authenticated;

-- ─────────────── 0013_consent_erasure.sql ───────────────
-- =====================================================================
-- 0013 — consent records must survive rewriting, but not erasure
--
-- 0009 made newsletter_consent_events reject both UPDATE and DELETE,
-- reusing the same guard as booking_events. That was too strong, and it
-- surfaced as a cascade from newsletter_subscribers being refused.
--
-- The two trails protect different things:
--
--   booking_events        — evidence for disputes and money. Immutable
--                           against everyone, which also makes bookings
--                           undeletable. Intended (§38).
--
--   newsletter_consent_events — proof that consent was given, for as long
--                           as the data is held. §37 requires a real
--                           erasure path; when the person is erased, the
--                           proof of their consent goes with them. Keeping
--                           it would be holding personal data about
--                           someone who asked to be forgotten.
--
-- So: consent records can never be rewritten, and can only disappear by
-- cascade when the subscriber is erased — an operation available to the
-- service role alone, never through a browser session.
-- =====================================================================

create or replace function reject_update()
returns trigger language plpgsql as $$
begin
  raise exception '% cannot be modified', tg_table_name using errcode = 'check_violation';
end $$;

drop trigger if exists newsletter_consent_append_only on newsletter_consent_events;

create trigger newsletter_consent_no_rewrite
  before update on newsletter_consent_events
  for each row execute function reject_update();

-- Deletion is possible only for the service role, and only as a cascade
-- from erasing the subscriber.
revoke delete on newsletter_consent_events from anon, authenticated;
revoke delete on newsletter_subscribers   from anon, authenticated;

-- ─────────────── 0014_public_availability.sql ───────────────
-- =====================================================================
-- 0014 — public availability, without exposing bookings
--
-- §9 requires that a client can see immediately whether a date is free.
-- But bookings are private: who booked what, when, and for how much is
-- visible only to the two parties and an administrator (0011).
--
-- Those two requirements collide in search. Computing availability with
-- an inline `not exists (select ... from bookings)` as an anonymous
-- visitor silently returns TRUE for every date, because RLS hides the
-- very rows the check depends on — so every venue looks free and the
-- calendar lies. No error, no warning; just wrong answers.
--
-- The fix is to expose exactly one bit through a SECURITY DEFINER
-- function. A visitor learns "free" or "not free" and nothing else — no
-- client, no price, no reason. That is precisely what a public
-- availability calendar must reveal anyway.
-- =====================================================================

create or replace function resource_is_free(
  p_resource_id uuid,
  p_from        timestamptz,
  p_to          timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1
      from bookings b
     where b.resource_id = p_resource_id
       and b.status = any (booking_occupying_statuses())
       and tstzrange(b.starts_at, b.ends_at) && tstzrange(p_from, p_to)
  );
$$;

comment on function resource_is_free is
  'Public availability for one bookable space. Returns a boolean only — '
  'booking details stay private. Used by search and the profile calendar.';

grant execute on function resource_is_free(uuid, timestamptz, timestamptz)
  to anon, authenticated;

-- ─────────────── 0015_profiles_auth_link.sql ───────────────
-- =====================================================================
-- 0015 — tie profiles to Supabase Auth
--
-- profiles.id carries the auth.users id. Adding the real foreign key
-- means an identity cannot exist in one place and not the other.
--
-- ON DELETE RESTRICT, deliberately. §37 requires an erasure path, and
-- 0002 already answers it: account deletion is a status change plus
-- clearing the personal fields, never a DELETE — because bookings,
-- payments and the audit trail have to survive it (§38). RESTRICT makes
-- that policy the only possible one, rather than a convention someone
-- can forget at 2am with a support ticket open.
--
-- Guarded so it is a no-op anywhere auth.users does not exist.
-- =====================================================================

do $$
begin
  if to_regclass('auth.users') is null then
    raise notice 'auth.users absent — skipping the profiles FK';
    return;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'profiles_id_fkey'
  ) then
    alter table profiles
      add constraint profiles_id_fkey
      foreign key (id) references auth.users(id) on delete restrict;
  end if;
end $$;

-- ─────────────── 0016_auth_profile_provisioning.sql ───────────────
-- =====================================================================
-- 0016 — a profile for every identity (§12, §13)
--
-- Supabase Auth owns auth.users. This system reads profiles, and 0015
-- ties the two together. Creating the profile in application code after
-- signup would leave a window — and a failure mode — where an identity
-- exists with nothing to authorise against. A trigger closes it.
-- =====================================================================

create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  -- IMPORTANT: raw_APP_meta_data, never raw_USER_meta_data.
  --
  -- A user chooses raw_user_meta_data at signup — it is whatever they put
  -- in the `data` field. Reading a role from it would let anyone register
  -- as an administrator. raw_app_meta_data can only be written by the
  -- service role or the admin API, so it is safe to trust.
  v_role := coalesce(new.raw_app_meta_data ->> 'app_role', 'client');
  if v_role not in ('client', 'provider', 'admin') then
    v_role := 'client';
  end if;

  insert into profiles (id, email, full_name, role, email_verified)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    v_role,
    new.email_confirmed_at is not null
  )
  on conflict (id) do nothing;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();

-- ---------------------------------------------------------------------
-- Keep profiles.email_verified in step with Supabase's confirmation, so
-- the trust signals on a supplier page (§25) reflect reality.
-- ---------------------------------------------------------------------
create or replace function handle_auth_user_updated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update profiles
     set email          = coalesce(new.email, email),
         email_verified = new.email_confirmed_at is not null
   where id = new.id;
  return new;
end $$;

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated
  after update of email, email_confirmed_at on auth.users
  for each row execute function handle_auth_user_updated();

-- ─────────────── 0017_provider_documents.sql ───────────────
-- =====================================================================
-- 0017 — verification documents, and an honest role guard (§13, §25)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Identity documents (§25).
--
-- These are the most sensitive rows in the system: an identity card, a
-- NIF, commercial registration. Three rules follow from that and are
-- enforced rather than assumed:
--
--   1. They live in a SEPARATE, PRIVATE bucket — never the public media
--      bucket, which is anonymously readable so that photographs load.
--   2. No public SELECT policy exists at all. Not "only when published" —
--      none. The owner and administrators, nobody else.
--   3. The file never touches the application server, same as media.
-- ---------------------------------------------------------------------
create table provider_documents (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references providers(id) on delete cascade,

  kind          text not null check (kind in (
                  'identity',                 -- bilhete de identidade / passaporte
                  'nif',                      -- número de identificação fiscal
                  'commercial_registration',  -- certidão comercial
                  'proof_of_address',
                  'other'
                )),

  external_id   text not null,                -- key in the private bucket
  original_filename text,
  content_type  text,
  byte_size     bigint check (byte_size > 0),

  status        text not null default 'submitted'
                  check (status in ('submitted', 'accepted', 'rejected')),
  reviewed_by   uuid references profiles(id),
  reviewed_at   timestamptz,
  review_note   text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (provider_id, external_id)
);

create index provider_documents_provider_idx on provider_documents (provider_id);
create index provider_documents_queue_idx on provider_documents (status, created_at)
  where status = 'submitted';

create trigger provider_documents_updated_at
  before update on provider_documents
  for each row execute function set_updated_at();

alter table provider_documents enable row level security;

-- Owner and administrators. There is deliberately no public policy.
create policy provider_documents_owner_read on provider_documents
  for select using (owns_provider(provider_id) or is_admin());

create policy provider_documents_owner_insert on provider_documents
  for insert with check (owns_provider(provider_id) and status = 'submitted');

-- A supplier may withdraw a document they submitted; they may not mark
-- their own paperwork accepted.
create policy provider_documents_owner_delete on provider_documents
  for delete using ((owns_provider(provider_id) and status = 'submitted') or is_admin());

create policy provider_documents_admin_update on provider_documents
  for update using (is_admin()) with check (is_admin());

comment on table provider_documents is
  'Identity paperwork for §25 verification. Private bucket, no public policy, ever.';

-- ---------------------------------------------------------------------
-- The role guard, rewritten to say what is actually true.
--
-- "Only an administrator may change a role" was too strong: it also
-- blocked the one legitimate self-service transition, a client becoming
-- a supplier by registering a business. Keeping the absolute rule would
-- have meant working around it with a service-role escape hatch, which is
-- how guards quietly stop guarding anything.
--
-- Becoming a 'provider' grants NO extra access. Every provider-owned
-- policy keys off owns_provider(), never off this column, and
-- verification (§25) stays an administrator's decision. The role is a
-- label for navigation and for the supplier digest audience.
-- ---------------------------------------------------------------------
create or replace function profiles_guard_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is not distinct from old.role then
    return new;
  end if;

  if is_admin() then
    return new;
  end if;

  if old.role = 'client'
     and new.role = 'provider'
     and exists (select 1 from providers where owner_id = new.id) then
    return new;
  end if;

  raise exception 'role % -> % is not self-service', old.role, new.role
    using errcode = 'insufficient_privilege';
end $$;

-- ---------------------------------------------------------------------
-- The verification guard, made precise for the same reason as the role
-- guard above.
--
-- "Only an administrator may change verification_status" also blocked a
-- supplier from *asking* to be reviewed, which is not an administrative
-- act — it is the supplier saying "my paperwork is in". The decision
-- itself stays with an administrator (§25).
--
-- Allowed for an owner:  unverified -> pending
-- Allowed for an admin:  anything
-- Everything else:       refused, including the obvious
--                        pending -> verified by the supplier.
-- ---------------------------------------------------------------------
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

  if is_admin() then
    return new;
  end if;

  if old.verification_status = 'unverified'
     and new.verification_status = 'pending'
     and owns_provider(new.id) then
    return new;
  end if;

  raise exception 'verification % -> % is an administrator''s decision',
    old.verification_status, new.verification_status
    using errcode = 'insufficient_privilege';
end $$;

