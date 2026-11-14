-- =====================================================================
-- Before applying 0047 to a live project: are any listings already in a
-- state the new guard would refuse to create? READ-ONLY.
--
--   psql "$DATABASE_URL" -f scripts/audit-provider-columns.sql
--
-- 0047 only checks rows as they are written, so it applies cleanly
-- whatever this shows. But a row listed here is a listing whose bookings
-- behave differently from what its category promises, and a person should
-- look at each one (fix the category, or the type, as an administrator).
-- Expect three empty tables on a healthy project.
-- =====================================================================
\pset footer off
\pset null '—'

\echo '1. Listings whose type does not match their category (venue in a service category, or the reverse)'
select p.id, p.slug, p.name, p.supplier_type as tipo, c.slug as categoria, c.default_supplier_type as categoria_e_para
  from providers p join categories c on c.id = p.category_id
 where c.default_supplier_type <> 'either' and c.default_supplier_type <> p.supplier_type
 order by p.created_at;

\echo '2. Listings with a concurrency limit other than the default 1'
select p.id, p.slug, p.name, p.supplier_type as tipo, p.concurrency_limit
  from providers p where p.concurrency_limit <> 1 order by p.created_at;

\echo '3. Example listings (is_demo) not owned by the example catalogue account'
select p.id, p.slug, p.name, p.owner_id
  from providers p
 where p.is_demo and p.owner_id <> '5d000000-0000-4000-8000-000000000000'
 order by p.created_at;

\echo '4. Services listed under a category of the other mode than their business (informational; slice 56 addresses these)'
select s.id, s.name as servico, sc.slug as categoria_do_servico, sc.default_supplier_type as categoria_e_para,
       p.slug as negocio, p.supplier_type as tipo_do_negocio
  from services s
  join providers p on p.id = s.provider_id
  join categories sc on sc.id = s.category_id
 where s.is_active and sc.default_supplier_type <> 'either' and sc.default_supplier_type <> p.supplier_type
 order by p.slug, s.name;
