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
