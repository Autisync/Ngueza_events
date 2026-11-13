-- =====================================================================
-- Event types and what each usually needs (0046, slice 50).
--
-- Reference data: every environment needs it, production included. It
-- loads after 00_taxonomy.sql, so each need's category link resolves by
-- slug; a slug that does not exist simply leaves the need unlinked.
--
-- Shares are basis points (3000 = 30 %) and add up to 100 % per type,
-- contingency included. Lead times are weeks before the date. Both are
-- starting points an administrator tunes at /admin/tipos-de-evento.
--
-- Idempotent: types by slug, needs by (type, name).
-- =====================================================================

insert into event_types (slug, name, description, sort_order) values
  ('casamento',         'Casamento',                 'Cerimónia e festa, do local ao bolo.',                         10),
  ('alambamento',       'Alambamento',               'O pedido tradicional: a lista, a comida e a festa das famílias.', 20),
  ('aniversario',       'Aniversário',               'Uma festa de anos, em casa ou num salão.',                     30),
  ('festa-infantil',    'Festa infantil',            'Decoração temática, animação e comida para os mais novos.',    40),
  ('baptizado',         'Baptizado',                 'A cerimónia e o almoço ou jantar que se segue.',               50),
  ('conferencia',       'Conferência ou seminário',  'Sala, coffee-break, som e projecção.',                         60),
  ('festa-de-empresa',  'Festa de empresa',          'Fim de ano, aniversário da empresa ou lançamento.',            70),
  ('outro',             'Outro evento',              'Uma lista curta, para adaptar.',                               90)
on conflict (slug) do nothing;

insert into event_type_needs (event_type_id, name, category_id, budget_share_bp, weeks_before, sort_order)
select t.id, v.name, c.id, v.share_bp, v.weeks, v.ord
  from (values
    -- type,               need,                                        category,                share, weeks, order
    ('casamento',          'Local da festa',                            'saloes-de-festas',       3000, 26, 10),
    ('casamento',          'Buffet e bebidas',                          'buffet',                 2800, 16, 20),
    ('casamento',          'Decoração',                                 'decoracao',              1000, 10, 30),
    ('casamento',          'Fotografia',                                'fotografia',              600, 20, 40),
    ('casamento',          'Vídeo',                                     'video',                   500, 20, 50),
    ('casamento',          'DJ',                                        'djs',                     400, 12, 60),
    ('casamento',          'Som e iluminação',                          'som',                     300,  8, 70),
    ('casamento',          'Maquilhagem',                               'maquilhagem',             200,  8, 80),
    ('casamento',          'Vestido e fato',                            null,                      500, 16, 90),
    ('casamento',          'Convites',                                  null,                      100,  8, 100),
    ('casamento',          'Bolo',                                      null,                      200,  4, 110),
    ('casamento',          'Imprevistos',                               null,                      400,  0, 990),

    ('alambamento',        'Local',                                     'casas-de-festas',        2000, 12, 10),
    ('alambamento',        'Comida e bebidas',                          'buffet',                 3500,  8, 20),
    ('alambamento',        'Lista do alambamento',                      null,                     2500,  6, 30),
    ('alambamento',        'Decoração',                                 'decoracao',               700,  4, 40),
    ('alambamento',        'Fotografia',                                'fotografia',              500,  6, 50),
    ('alambamento',        'Som e DJ',                                  'djs',                     400,  4, 60),
    ('alambamento',        'Imprevistos',                               null,                      400,  0, 990),

    ('aniversario',        'Local',                                     'saloes-de-festas',       3000,  8, 10),
    ('aniversario',        'Buffet',                                    'buffet',                 3500,  4, 20),
    ('aniversario',        'Bolo',                                      null,                      500,  2, 30),
    ('aniversario',        'Decoração',                                 'decoracao',              1000,  3, 40),
    ('aniversario',        'DJ',                                        'djs',                     800,  4, 50),
    ('aniversario',        'Fotografia',                                'fotografia',              700,  4, 60),
    ('aniversario',        'Imprevistos',                               null,                      500,  0, 990),

    ('festa-infantil',     'Local',                                     'casas-de-festas',        2500,  6, 10),
    ('festa-infantil',     'Comida e bolo',                             'buffet',                 3000,  3, 20),
    ('festa-infantil',     'Decoração temática',                        'decoracao',              2000,  3, 30),
    ('festa-infantil',     'Insufláveis, mesas e cadeiras',             'material-para-festas',   1000,  3, 40),
    ('festa-infantil',     'Animação',                                  null,                     1000,  3, 50),
    ('festa-infantil',     'Imprevistos',                               null,                      500,  0, 990),

    ('baptizado',          'Local da festa',                            'casas-de-festas',        3000,  8, 10),
    ('baptizado',          'Buffet',                                    'buffet',                 3500,  4, 20),
    ('baptizado',          'Decoração',                                 'decoracao',              1000,  3, 30),
    ('baptizado',          'Fotografia',                                'fotografia',             1000,  4, 40),
    ('baptizado',          'Bolo e lembranças',                         null,                     1000,  3, 50),
    ('baptizado',          'Imprevistos',                               null,                      500,  0, 990),

    ('conferencia',        'Sala de conferência',                       'salas-de-conferencia',   4000, 12, 10),
    ('conferencia',        'Coffee-break e almoço',                     'buffet',                 3000,  4, 20),
    ('conferencia',        'Som e projecção',                           'som',                    1000,  4, 30),
    ('conferencia',        'Fotografia e vídeo',                        'fotografia',              800,  4, 40),
    ('conferencia',        'Material e impressões',                     null,                      700,  2, 50),
    ('conferencia',        'Imprevistos',                               null,                      500,  0, 990),

    ('festa-de-empresa',   'Local',                                     'saloes-de-festas',       3000, 10, 10),
    ('festa-de-empresa',   'Buffet e bebidas',                          'buffet',                 3500,  6, 20),
    ('festa-de-empresa',   'DJ',                                        'djs',                     800,  6, 30),
    ('festa-de-empresa',   'Iluminação e som',                          'iluminacao',              700,  4, 40),
    ('festa-de-empresa',   'Decoração',                                 'decoracao',               800,  4, 50),
    ('festa-de-empresa',   'Fotografia',                                'fotografia',              700,  4, 60),
    ('festa-de-empresa',   'Imprevistos',                               null,                      500,  0, 990),

    ('outro',              'Local',                                     'saloes-de-festas',       3500,  8, 10),
    ('outro',              'Comida e bebidas',                          'buffet',                 3500,  4, 20),
    ('outro',              'Decoração',                                 'decoracao',              1000,  3, 30),
    ('outro',              'Som',                                       'som',                    1000,  3, 40),
    ('outro',              'Imprevistos',                               null,                     1000,  0, 990)
  ) as v(type_slug, name, cat_slug, share_bp, weeks, ord)
  join event_types t on t.slug = v.type_slug
  left join categories c on c.slug = v.cat_slug
on conflict (event_type_id, name) do nothing;
