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
