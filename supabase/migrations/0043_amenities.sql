-- =====================================================================
-- 0043 — amenities per space (slice 45, review R001)
--
-- What Luanda clients actually filter venues on: gerador, coberto or ao
-- ar livre, estacionamento, ar condicionado. Rows, not an enum: the list
-- is managed by administrators at runtime, like categories and locations,
-- because a cleaning or transport marketplace would need different ones.
--
-- Amenities hang on a space (resources), not on the provider: a quinta's
-- jardim is "ao ar livre" and its salão is "coberto, ar condicionado".
-- =====================================================================

create table amenities (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name        text not null check (char_length(name) between 2 and 60),   -- pt-AO
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table resource_amenities (
  resource_id uuid not null references resources(id) on delete cascade,
  amenity_id  uuid not null references amenities(id) on delete restrict,
  created_at  timestamptz not null default now(),
  primary key (resource_id, amenity_id)
);

-- Search asks "which spaces have this amenity", the other way round.
create index resource_amenities_amenity_idx on resource_amenities (amenity_id, resource_id);

alter table amenities          enable row level security;
alter table resource_amenities enable row level security;

-- Anyone may read the active list (it is a filter); admins see retired ones.
create policy amenities_public_read on amenities
  for select using (is_active or is_admin());
create policy amenities_admin_write on amenities
  for all using (is_admin()) with check (is_admin());

-- A space's amenities are public exactly when the space's provider is
-- (provider_is_public, 0031), and visible to its owner and to admins.
create policy resource_amenities_read on resource_amenities
  for select using (
    exists (
      select 1 from resources r
       where r.id = resource_amenities.resource_id
         and (provider_is_public(r.provider_id) or owns_provider(r.provider_id) or is_admin())
    )
  );
-- Only the owner (or an admin) ticks and unticks; and only active amenities
-- can be ticked, so a retired one cannot creep back onto a listing.
create policy resource_amenities_owner_insert on resource_amenities
  for insert with check (
    exists (select 1 from resources r
             where r.id = resource_amenities.resource_id
               and (owns_provider(r.provider_id) or is_admin()))
    and exists (select 1 from amenities a where a.id = resource_amenities.amenity_id and a.is_active)
  );
create policy resource_amenities_owner_delete on resource_amenities
  for delete using (
    exists (select 1 from resources r
             where r.id = resource_amenities.resource_id
               and (owns_provider(r.provider_id) or is_admin()))
  );
-- Nothing to update: a row is a fact or it is absent.
revoke update on resource_amenities from anon, authenticated;
-- Visitors never write either table.
revoke insert, update, delete on amenities, resource_amenities from anon;

-- The starting list. Administrators add, rename, reorder and retire from
-- /admin/comodidades; on conflict keeps a re-run harmless.
insert into amenities (slug, name, sort_order) values
  ('gerador',           'Gerador',                    10),
  ('ar-condicionado',   'Ar condicionado',            20),
  ('coberto',           'Coberto',                    30),
  ('ao-ar-livre',       'Ao ar livre',                40),
  ('estacionamento',    'Estacionamento',             50),
  ('cozinha',           'Cozinha',                    60),
  ('catering-externo',  'Catering externo permitido', 70),
  ('som-e-luz',         'Som e luz',                  80),
  ('acessivel',         'Acesso para cadeira de rodas', 90)
on conflict (slug) do nothing;
