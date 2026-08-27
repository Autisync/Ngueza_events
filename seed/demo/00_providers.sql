-- =====================================================================
-- Seed: demo suppliers for local development, E2E tests and screenshots.
--
-- Realistic Luanda municipalities and Kwanza price bands so that tests
-- and demos exercise real formatting and real filters. These are NOT the
-- launch catalogue — the first 40 come from recruitment (§33).
--
-- Prices are cêntimos: 2 000 000,00 Kz = 200000000.
-- =====================================================================

-- Identities come from auth.users, exactly as they do in production: the
-- 0016 trigger creates the profile, and the role travels in
-- raw_app_meta_data because a user cannot write that field. Inserting
-- into profiles directly would be a second provisioning path that could
-- drift from the real one — and did, silently turning every supplier
-- into a client.
--
-- On a real Supabase project this demo seed is never applied.
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data) values
  ('40000000-0000-0000-0000-000000000001','dono.horizonte@exemplo.ao',now(),
   '{"full_name":"Manuel Kiala"}',        '{"app_role":"provider"}'),
  ('40000000-0000-0000-0000-000000000002','dono.palmeiras@exemplo.ao',now(),
   '{"full_name":"Teresa Neto"}',         '{"app_role":"provider"}'),
  ('40000000-0000-0000-0000-000000000003','dono.mirante@exemplo.ao',now(),
   '{"full_name":"Adão Fernandes"}',      '{"app_role":"provider"}'),
  ('40000000-0000-0000-0000-000000000004','dono.baia@exemplo.ao',now(),
   '{"full_name":"Luísa Cabral"}',        '{"app_role":"provider"}'),
  ('40000000-0000-0000-0000-000000000005','dono.kianda@exemplo.ao',now(),
   '{"full_name":"Paulo Domingos"}',      '{"app_role":"provider"}'),
  ('40000000-0000-0000-0000-000000000006','dono.centro@exemplo.ao',now(),
   '{"full_name":"Sara Mendes"}',         '{"app_role":"provider"}'),
  ('40000000-0000-0000-0000-000000000090','ana.cliente@exemplo.ao',now(),
   '{"full_name":"Ana Paula"}',           '{"app_role":"client"}'),
  ('40000000-0000-0000-0000-000000000091','joao.cliente@exemplo.ao',now(),
   '{"full_name":"João Baptista"}',       '{"app_role":"client"}'),
  ('40000000-0000-0000-0000-000000000099','admin@ngueza.com',now(),
   '{"full_name":"Administração NGUEZA"}','{"app_role":"admin"}')
on conflict (id) do nothing;

-- Only the fields the trigger cannot know.
update profiles set phone_verified = true
 where id in ('40000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002',
              '40000000-0000-0000-0000-000000000004','40000000-0000-0000-0000-000000000005',
              '40000000-0000-0000-0000-000000000006','40000000-0000-0000-0000-000000000099');

insert into providers (id, owner_id, supplier_type, slug, name, description,
                       category_id, location_id, address_line, phone, whatsapp,
                       verification_status, verified_at, is_published, years_active_declared) values
  ('50000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','venue',
   'salao-horizonte-talatona','Salão Horizonte',
   'Salão climatizado em Talatona com estacionamento privado e cozinha de apoio.',
   '20000000-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000010',
   'Via S8, Talatona','+244 923 000 001','+244 923 000 001','verified',now(),true,8),

  ('50000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000002','venue',
   'quinta-das-palmeiras','Quinta das Palmeiras',
   'Espaço ao ar livre para casamentos, com jardim e área coberta para 400 pessoas.',
   '20000000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000015',
   'Estrada de Belas, km 12','+244 923 000 002','+244 923 000 002','verified',now(),true,12),

  ('50000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000003','venue',
   'espaco-mirante-viana','Espaço Mirante',
   'Salão para aniversários e eventos empresariais, com som e iluminação incluídos.',
   '20000000-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000011',
   'Bairro Capalanga, Viana','+244 923 000 003',null,'verified',now(),true,4),

  ('50000000-0000-0000-0000-000000000004','40000000-0000-0000-0000-000000000004','venue',
   'casa-da-baia','Casa da Baía',
   'Casa de praia na Barra do Kwanza para eventos privados de fim-de-semana.',
   '20000000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000015',
   'Barra do Kwanza','+244 923 000 004','+244 923 000 004','verified',now(),true,6),

  ('50000000-0000-0000-0000-000000000005','40000000-0000-0000-0000-000000000005','venue',
   'centro-kianda-conferencias','Centro Kianda',
   'Duas salas de conferência com projector, wi-fi e serviço de coffee-break.',
   '20000000-0000-0000-0000-000000000013','10000000-0000-0000-0000-000000000014',
   'Rua Rainha Ginga, Ingombota','+244 923 000 005',null,'verified',now(),true,10),

  -- Deliberately left pending: the admin queue must have something in it,
  -- and RLS tests need a listing that anonymous visitors cannot see.
  ('50000000-0000-0000-0000-000000000006','40000000-0000-0000-0000-000000000006','venue',
   'salao-central-cazenga','Salão Central',
   'Salão em Cazenga para festas familiares.',
   '20000000-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000017',
   'Cazenga','+244 923 000 006',null,'pending',null,false,2)
on conflict (id) do nothing;

insert into resources (id, provider_id, name, capacity) values
  ('60000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','Salão Principal',250),
  ('60000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000002','Jardim',400),
  ('60000000-0000-0000-0000-000000000003','50000000-0000-0000-0000-000000000002','Área Coberta',180),
  ('60000000-0000-0000-0000-000000000004','50000000-0000-0000-0000-000000000003','Salão',150),
  ('60000000-0000-0000-0000-000000000005','50000000-0000-0000-0000-000000000004','Casa Inteira',60),
  ('60000000-0000-0000-0000-000000000006','50000000-0000-0000-0000-000000000005','Sala A',80),
  ('60000000-0000-0000-0000-000000000007','50000000-0000-0000-0000-000000000005','Sala B',30),
  ('60000000-0000-0000-0000-000000000008','50000000-0000-0000-0000-000000000006','Salão',100)
on conflict (id) do nothing;

-- Every price_mode is represented, so search, filters and the profile
-- page are all exercised against the full spectrum (adjustments, part 06).
insert into services (id, provider_id, category_id, name, price_mode,
                      price_minor, price_max_minor, price_unit, min_capacity, max_capacity) values
  ('70000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000010','Aluguer do salão (dia inteiro)','exact',
   180000000, null, 'event', 50, 250),
  ('70000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000002',
   '20000000-0000-0000-0000-000000000011','Casamento — jardim e área coberta','range',
   350000000, 620000000, 'event', 100, 400),
  ('70000000-0000-0000-0000-000000000003','50000000-0000-0000-0000-000000000003',
   '20000000-0000-0000-0000-000000000010','Aniversário (6 horas)','from',
   95000000, null, 'event', 30, 150),
  ('70000000-0000-0000-0000-000000000004','50000000-0000-0000-0000-000000000004',
   '20000000-0000-0000-0000-000000000012','Fim-de-semana completo','on_request',
   null, null, 'event', 10, 60),
  ('70000000-0000-0000-0000-000000000005','50000000-0000-0000-0000-000000000005',
   '20000000-0000-0000-0000-000000000013','Sala A — dia de conferência','exact',
   120000000, null, 'day', 20, 80)
on conflict (id) do nothing;

-- A confirmed booking and a manual block, so the calendar has real shape.
insert into bookings (id, provider_id, client_id, resource_id, service_id, status,
                      starts_at, ends_at, party_size, total_minor) values
  ('80000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',
   '40000000-0000-0000-0000-000000000090','60000000-0000-0000-0000-000000000001',
   '70000000-0000-0000-0000-000000000001','confirmed',
   '2026-12-15 10:00+01','2026-12-15 23:59+01', 200, 180000000)
on conflict (id) do nothing;

-- §27: the supplier accepted a walk-in in person and blocked the date.
insert into bookings (id, provider_id, client_id, resource_id, status,
                      starts_at, ends_at) values
  ('80000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000002',
   null,'60000000-0000-0000-0000-000000000002','blocked',
   '2026-12-20 08:00+01','2026-12-21 02:00+01')
on conflict (id) do nothing;

-- Waitlist signups gathered before launch, including a zero-result
-- capture that doubles as a supply gap (adjustments, part 09).
insert into newsletter_subscribers (email, audience, status, source, source_detail,
                                    interests, confirmed_at) values
  ('interessada1@exemplo.ao','client','confirmed','waitlist',null,
   '{"categories":["20000000-0000-0000-0000-000000000010"],
     "locations":["10000000-0000-0000-0000-000000000010"]}'::jsonb, now()),
  ('interessado2@exemplo.ao','client','confirmed','zero_result',
   'casa de praia em Benguela',
   '{"categories":["20000000-0000-0000-0000-000000000012"]}'::jsonb, now()),
  ('fornecedor.novo@exemplo.ao','provider','pending','footer',null,'{}'::jsonb, null)
on conflict (email) do nothing;
