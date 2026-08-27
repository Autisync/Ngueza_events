-- =====================================================================
-- Seed: categories and Luanda locations (§6, §43)
--
-- Launch scope is venues in Luanda. Service categories are seeded too so
-- the tree is real, but they list as directory profiles until the
-- time-window availability model ships.
-- =====================================================================

insert into locations (id, parent_id, level, slug, name, lat, lng) values
  ('10000000-0000-0000-0000-000000000001', null, 'country',  'angola', 'Angola', null, null),
  ('10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
     'province', 'luanda', 'Luanda', -8.839988, 13.289437)
on conflict do nothing;

insert into locations (id, parent_id, level, slug, name, lat, lng) values
  ('10000000-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000002','municipality','talatona','Talatona', -8.916000, 13.184000),
  ('10000000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000002','municipality','viana','Viana', -8.903000, 13.373000),
  ('10000000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000002','municipality','kilamba-kiaxi','Kilamba Kiaxi', -8.867000, 13.256000),
  ('10000000-0000-0000-0000-000000000013','10000000-0000-0000-0000-000000000002','municipality','maianga','Maianga', -8.820000, 13.226000),
  ('10000000-0000-0000-0000-000000000014','10000000-0000-0000-0000-000000000002','municipality','ingombota','Ingombota', -8.813000, 13.234000),
  ('10000000-0000-0000-0000-000000000015','10000000-0000-0000-0000-000000000002','municipality','belas','Belas', -9.010000, 13.170000),
  ('10000000-0000-0000-0000-000000000016','10000000-0000-0000-0000-000000000002','municipality','cacuaco','Cacuaco', -8.777000, 13.366000),
  ('10000000-0000-0000-0000-000000000017','10000000-0000-0000-0000-000000000002','municipality','cazenga','Cazenga', -8.847000, 13.303000)
on conflict do nothing;

-- Top level. 'Eventos' today; 'Casa e Reparações', 'Beleza', 'Transporte'
-- are added by an administrator the day the business decides to expand —
-- no migration, no release (§44).
insert into categories (id, parent_id, slug, name, default_supplier_type, sort_order) values
  ('20000000-0000-0000-0000-000000000001', null, 'eventos', 'Eventos', 'either', 1)
on conflict do nothing;

insert into categories (id, parent_id, slug, name, default_supplier_type, sort_order) values
  -- Venues: date-exclusive, launch scope
  ('20000000-0000-0000-0000-000000000010','20000000-0000-0000-0000-000000000001','saloes-de-festas','Salões de festas','venue',1),
  ('20000000-0000-0000-0000-000000000011','20000000-0000-0000-0000-000000000001','casas-de-festas','Casas de festas','venue',2),
  ('20000000-0000-0000-0000-000000000012','20000000-0000-0000-0000-000000000001','casas-de-praia','Casas de praia','venue',3),
  ('20000000-0000-0000-0000-000000000013','20000000-0000-0000-0000-000000000001','salas-de-conferencia','Salas de conferência','venue',4),
  ('20000000-0000-0000-0000-000000000014','20000000-0000-0000-0000-000000000001','salas-de-workshop','Salas de workshop','venue',5),
  -- Services: time-window based, directory first
  ('20000000-0000-0000-0000-000000000020','20000000-0000-0000-0000-000000000001','djs','DJs','service',10),
  ('20000000-0000-0000-0000-000000000021','20000000-0000-0000-0000-000000000001','maquilhagem','Maquilhagem','service',11),
  ('20000000-0000-0000-0000-000000000022','20000000-0000-0000-0000-000000000001','decoracao','Decoração','service',12),
  ('20000000-0000-0000-0000-000000000023','20000000-0000-0000-0000-000000000001','buffet','Buffet','service',13),
  ('20000000-0000-0000-0000-000000000024','20000000-0000-0000-0000-000000000001','fotografia','Fotografia','service',14),
  ('20000000-0000-0000-0000-000000000025','20000000-0000-0000-0000-000000000001','video','Vídeo','service',15),
  ('20000000-0000-0000-0000-000000000026','20000000-0000-0000-0000-000000000001','som','Som','service',16),
  ('20000000-0000-0000-0000-000000000027','20000000-0000-0000-0000-000000000001','iluminacao','Iluminação','service',17),
  ('20000000-0000-0000-0000-000000000028','20000000-0000-0000-0000-000000000001','material-para-festas','Material para festas','service',18)
on conflict do nothing;

-- Platform default cancellation policy (§29). Suppliers may define their
-- own within limits; this is the fallback shown before payment.
insert into cancellation_policies (id, provider_id, name, tiers, notes) values
  ('30000000-0000-0000-0000-000000000001', null, 'Política padrão NGUEZA',
   '[{"days_before": 30, "refund_pct": 100},
     {"days_before": 14, "refund_pct": 50},
     {"days_before": 7,  "refund_pct": 0}]'::jsonb,
   'Aplicada quando o fornecedor não define uma política própria.')
on conflict do nothing;
