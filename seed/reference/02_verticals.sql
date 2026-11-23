-- =====================================================================
-- Verticals beyond events (slice 52 of the marketplace pivot).
--
-- Every vertical NGUEZA expects to open, with its first categories, all
-- CLOSED (is_active = false). Nothing here is visible to a visitor or a
-- supplier until an administrator opens a vertical at /admin/categorias,
-- which opens it whole and records it in the audit log (0049).
--
-- Rules for this file (spec/pivot/inventory.md §2.6):
--   * Re-runnable. `on conflict do nothing` everywhere, so running it
--     again never re-closes a vertical an administrator has opened, and
--     never undoes an admin's rename. The cross-listings and the icon
--     backfill happen only on the run that adds the verticals, so a
--     re-run never restores a link an admin removed or an icon they set
--     back to "inherit".
--   * Parents are found by slug, not by id: if an administrator already
--     created "limpeza" by hand on live, the seed skips that row and the
--     rest still attach. A person checks live slugs before running it.
--   * Event slugs are untouched (01_event_types.sql and tests use them).
--   * Slugs are unique across the whole tree, so generic words carry a
--     qualifier: lavagem-auto, aulas-de-informatica.
--   * Every new leaf is 'service' (time windows, may overlap). Venue-style
--     date exclusivity for vehicles, and products, come with the
--     fulfilment model (slice 56) and the product catalogue (slice 63).
--     Product categories are therefore NOT seeded here: a seller under a
--     'service' category would get a bookable calendar, and a wrong
--     default_supplier_type seeded now could not be fixed by re-seeding.
--   * Sort order in blocks per vertical (root N, leaves N01…), so no list
--     interleaves two verticals.
--
-- Not decided here (the owner's, plan.md §7): which vertical opens first,
-- and the optional cross-listings (bolos under Eventos, wedding cars,
-- bridal hair). Trades involving minors (explicações, transporte escolar)
-- and regulated ones should not open before their document requirements
-- exist (slice 54); verification decisions stay human.
-- =====================================================================

-- ---- the verticals, and what comes only with their first arrival --------
-- One statement, so the cross-listings and the icon backfill run only on
-- the run that actually adds the verticals. A later run, after an
-- administrator removed a link, moved maquilhagem under Beleza, or set
-- an icon back to "inherit", changes none of that (and cannot trip the
-- category_links redundancy guard).
--
-- Moving maquilhagem, buffet, fotografia or vídeo out of Eventos would
-- drop them from every Eventos search and quote request; a link keeps
-- both (category_scope, 0049).
with new_roots as (
  insert into categories (id, parent_id, slug, name, icon, default_supplier_type, sort_order, is_active, is_assignable)
  values
  ('21000002-0000-0000-0000-000000000001', null, 'casa-e-reparacoes',          'Casa e Reparações',          'house',    'either', 2, false, false),
  ('21000003-0000-0000-0000-000000000001', null, 'beleza-e-bem-estar',         'Beleza e Bem-estar',         'scissors', 'either', 3, false, false),
  ('21000004-0000-0000-0000-000000000001', null, 'aulas-e-explicacoes',        'Aulas e Explicações',        'book',     'either', 4, false, false),
  ('21000005-0000-0000-0000-000000000001', null, 'transporte-e-mudancas',      'Transporte e Mudanças',      'truck',    'either', 5, false, false),
  ('21000006-0000-0000-0000-000000000001', null, 'auto',                       'Auto',                       'car',      'either', 6, false, false),
  ('21000007-0000-0000-0000-000000000001', null, 'comida-e-catering',          'Comida e Catering',          'utensils', 'either', 7, false, false),
  ('21000008-0000-0000-0000-000000000001', null, 'tecnologia-e-profissionais', 'Tecnologia e Profissionais', 'laptop',   'either', 8, false, false)
  on conflict do nothing
  returning id, slug
),
links as (
  insert into category_links (category_id, also_under_id)
  select c.id, r.id
    from (values
      ('maquilhagem', 'beleza-e-bem-estar'),
      ('buffet',      'comida-e-catering'),
      ('fotografia',  'tecnologia-e-profissionais'),
      ('video',       'tecnologia-e-profissionais')
    ) as v(slug, under)
    join new_roots r on r.slug = v.under
    join categories c on c.slug = v.slug
  on conflict do nothing
  returning 1
),
-- Icons for the categories that predate them, where none is set. (app/
-- CategoryIcon.tsx draws these 14 by slug even without this.)
icons as (
  update categories c
     set icon = v.icon
    from (values
      ('eventos', 'party'),
      ('saloes-de-festas', 'hall'),
      ('casas-de-festas', 'party-house'),
      ('casas-de-praia', 'beach'),
      ('salas-de-conferencia', 'presentation'),
      ('salas-de-workshop', 'wrench'),
      ('djs', 'headphones'),
      ('maquilhagem', 'makeup'),
      ('decoracao', 'balloon'),
      ('buffet', 'utensils'),
      ('fotografia', 'camera'),
      ('video', 'video'),
      ('som', 'speaker'),
      ('iluminacao', 'bulb'),
      ('material-para-festas', 'gift')
    ) as v(slug, icon)
   where c.slug = v.slug and c.icon is null
     and exists (select 1 from new_roots)
  returning 1
)
select (select count(*) from new_roots) as verticals_added,
       (select count(*) from links)     as links_added,
       (select count(*) from icons)     as icons_set;

-- ---- their first categories (after the verticals, which they join by slug)
insert into categories (id, parent_id, slug, name, icon, default_supplier_type, sort_order, is_active)
select v.id::uuid, r.id, v.slug, v.name, v.icon, 'service', v.ord, false
  from (values
    -- Casa e Reparações
    ('21000002-0000-0000-0000-000000000010', 'casa-e-reparacoes', 'limpeza',                          'Limpeza',                          'broom',     201),
    ('21000002-0000-0000-0000-000000000011', 'casa-e-reparacoes', 'canalizacao',                      'Canalização',                      'pipe',      202),
    ('21000002-0000-0000-0000-000000000012', 'casa-e-reparacoes', 'electricidade',                    'Electricidade',                    'bolt',      203),
    ('21000002-0000-0000-0000-000000000013', 'casa-e-reparacoes', 'pintura',                          'Pintura',                          'roller',    204),
    ('21000002-0000-0000-0000-000000000014', 'casa-e-reparacoes', 'serralharia',                      'Serralharia',                      'key',       205),
    ('21000002-0000-0000-0000-000000000015', 'casa-e-reparacoes', 'carpintaria-e-montagem-de-moveis', 'Carpintaria e montagem de móveis', 'hammer',    206),
    ('21000002-0000-0000-0000-000000000016', 'casa-e-reparacoes', 'jardinagem',                       'Jardinagem',                       'leaf',      207),
    ('21000002-0000-0000-0000-000000000017', 'casa-e-reparacoes', 'desinfestacao',                    'Desinfestação',                    'bug',       208),
    ('21000002-0000-0000-0000-000000000018', 'casa-e-reparacoes', 'ar-condicionado-e-frio',           'Ar condicionado e frio',           'snowflake', 209),
    ('21000002-0000-0000-0000-000000000019', 'casa-e-reparacoes', 'reparacao-de-electrodomesticos',   'Reparação de electrodomésticos',   'plug',      210),
    -- Beleza e Bem-estar (maquilhagem stays under Eventos, listed here too)
    ('21000003-0000-0000-0000-000000000010', 'beleza-e-bem-estar', 'cabeleireiro-e-trancas', 'Cabeleireiro e tranças',      'scissors', 301),
    ('21000003-0000-0000-0000-000000000011', 'beleza-e-bem-estar', 'barbeiro',               'Barbeiro',                    'comb',     302),
    ('21000003-0000-0000-0000-000000000012', 'beleza-e-bem-estar', 'unhas',                  'Unhas (manicure e pedicure)', 'polish',   303),
    ('21000003-0000-0000-0000-000000000013', 'beleza-e-bem-estar', 'estetica',               'Estética',                    'sparkle',  304),
    ('21000003-0000-0000-0000-000000000014', 'beleza-e-bem-estar', 'massagem',               'Massagem',                    'hand',     305),
    -- Aulas e Explicações
    ('21000004-0000-0000-0000-000000000010', 'aulas-e-explicacoes', 'explicacoes-escolares',  'Explicações escolares',  'book',   401),
    ('21000004-0000-0000-0000-000000000011', 'aulas-e-explicacoes', 'linguas',                'Línguas',                'speech', 402),
    ('21000004-0000-0000-0000-000000000012', 'aulas-e-explicacoes', 'aulas-de-musica',        'Aulas de música',        'music',  403),
    ('21000004-0000-0000-0000-000000000013', 'aulas-e-explicacoes', 'aulas-de-informatica',   'Aulas de informática',   'laptop', 404),
    ('21000004-0000-0000-0000-000000000014', 'aulas-e-explicacoes', 'preparacao-para-exames', 'Preparação para exames', 'pencil', 405),
    -- Transporte e Mudanças
    ('21000005-0000-0000-0000-000000000010', 'transporte-e-mudancas', 'mudancas',                          'Mudanças',                         'truck',    501),
    ('21000005-0000-0000-0000-000000000011', 'transporte-e-mudancas', 'motorista',                         'Motorista particular',             'steering', 502),
    ('21000005-0000-0000-0000-000000000012', 'transporte-e-mudancas', 'estafeta-e-entregas',               'Estafeta e entregas',              'package',  503),
    ('21000005-0000-0000-0000-000000000013', 'transporte-e-mudancas', 'aluguer-de-viatura-com-motorista',  'Aluguer de viatura com motorista', 'car',      504),
    ('21000005-0000-0000-0000-000000000014', 'transporte-e-mudancas', 'transporte-escolar',                'Transporte escolar',               'bus',      505),
    -- Auto
    ('21000006-0000-0000-0000-000000000010', 'auto', 'mecanica',     'Mecânica',                  'wrench',  601),
    ('21000006-0000-0000-0000-000000000011', 'auto', 'lavagem-auto', 'Lavagem auto',              'droplet', 602),
    ('21000006-0000-0000-0000-000000000012', 'auto', 'bate-chapa',   'Bate-chapa e pintura auto', 'hammer',  603),
    ('21000006-0000-0000-0000-000000000013', 'auto', 'pneus',        'Pneus',                     'tyre',    604),
    -- Comida e Catering (buffet stays under Eventos, listed here too)
    ('21000007-0000-0000-0000-000000000010', 'comida-e-catering', 'catering',      'Catering',      null,   701),
    ('21000007-0000-0000-0000-000000000011', 'comida-e-catering', 'bolos-e-doces', 'Bolos e doces', 'cake', 702),
    ('21000007-0000-0000-0000-000000000012', 'comida-e-catering', 'salgados',      'Salgados',      null,   703),
    -- Tecnologia e Profissionais (fotografia and vídeo listed here too)
    ('21000008-0000-0000-0000-000000000010', 'tecnologia-e-profissionais', 'reparacao-de-telemoveis',   'Reparação de telemóveis',   'phone',   801),
    ('21000008-0000-0000-0000-000000000011', 'tecnologia-e-profissionais', 'reparacao-de-computadores', 'Reparação de computadores', 'laptop',  802),
    ('21000008-0000-0000-0000-000000000012', 'tecnologia-e-profissionais', 'design-grafico',            'Design gráfico',            'palette', 803)
  ) as v(id, root_slug, slug, name, icon, ord)
  join categories r on r.slug = v.root_slug
on conflict do nothing;

