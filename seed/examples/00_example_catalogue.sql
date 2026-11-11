-- =====================================================================
-- Example catalogue (slice 39): 24 fictional suppliers so the marketplace
-- does not look empty while recruitment fills it.
--
-- Every one is is_demo (0041): labelled "Perfil de exemplo" on the site,
-- never bookable (the database refuses), never matched to a quote
-- request. No phone numbers (a made-up number can belong to a real
-- person), no reviews (a fabricated review is a lie to the client).
--
-- Locally: WITH_EXAMPLES=1 npm run db:reset (off by default — the test
-- fixtures assume the six demo suppliers). On a shared project, apply it
-- deliberately, after migration 0041:
--     psql "$MIGRATION_DATABASE_URL" -f seed/examples/00_example_catalogue.sql
-- and remove it, in one go, with scripts/remove-example-catalogue.sql.
--
-- Idempotent: safe to run twice.
-- =====================================================================

-- One owner for all of them: an account with no password, so nobody can
-- sign in as it. Live Supabase needs the full auth.users row; the local
-- shim has only a few columns — so this checks which it is talking to.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'auth' and table_name = 'users' and column_name = 'instance_id') then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      confirmation_token, recovery_token, email_change, email_change_token_new,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token,
      raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous, created_at, updated_at
    ) values (
      '00000000-0000-0000-0000-000000000000', '5d000000-0000-4000-8000-000000000000', 'authenticated', 'authenticated',
      'catalogo-exemplo@ngueza.invalid', '', now(), '', '', '', '', '', '', '', '',
      '{"provider":"email","providers":["email"],"app_role":"provider"}',
      '{"full_name":"Catálogo de exemplo NGUEZA"}', false, false, now(), now()
    ) on conflict (id) do nothing;
  else
    insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data)
    values ('5d000000-0000-4000-8000-000000000000', 'catalogo-exemplo@ngueza.invalid', now(),
            '{"full_name":"Catálogo de exemplo NGUEZA"}', '{"app_role":"provider"}')
    on conflict (id) do nothing;
  end if;
end $$;

insert into providers (id, owner_id, supplier_type, slug, name, description,
                       category_id, location_id, address_line, verification_status, verified_at,
                       is_published, published_at, years_active_declared, is_demo) values
  ('5d000000-0000-4000-8001-000000000001', '5d000000-0000-4000-8000-000000000000', 'venue', 'salao-estrela-do-mar', 'Salão Estrela do Mar', 'Salão climatizado com palco, cozinha de apoio e estacionamento para 60 viaturas.',
   (select id from categories where slug = 'saloes-de-festas'), (select id from locations where slug = 'talatona'),
   'Rua do Talatona, Talatona', 'verified', now(), true, now(), 7, true),
  ('5d000000-0000-4000-8001-000000000002', '5d000000-0000-4000-8000-000000000000', 'venue', 'salao-imbondeiro', 'Salão Imbondeiro', 'Salão de festas para casamentos e aniversários, com gerador próprio.',
   (select id from categories where slug = 'saloes-de-festas'), (select id from locations where slug = 'kilamba-kiaxi'),
   'Centralidade do Kilamba', 'verified', now(), true, now(), 5, true),
  ('5d000000-0000-4000-8001-000000000003', '5d000000-0000-4000-8000-000000000000', 'venue', 'salao-mutamba', 'Salão Mutamba', 'Salão no centro da cidade, ideal para cerimónias e copos-d’água.',
   (select id from categories where slug = 'saloes-de-festas'), (select id from locations where slug = 'ingombota'),
   'Largo da Mutamba, Ingombota', 'verified', now(), true, now(), 11, true),
  ('5d000000-0000-4000-8001-000000000004', '5d000000-0000-4000-8000-000000000000', 'venue', 'salao-luz-de-viana', 'Salão Luz de Viana', 'Salão amplo com parque infantil e esplanada coberta.',
   (select id from categories where slug = 'saloes-de-festas'), (select id from locations where slug = 'viana'),
   'Estrada de Catete, Viana', 'verified', now(), true, now(), 3, true),
  ('5d000000-0000-4000-8001-000000000005', '5d000000-0000-4000-8000-000000000000', 'venue', 'quinta-dos-cajueiros', 'Quinta dos Cajueiros', 'Quinta com jardim, piscina e área coberta para casamentos ao ar livre.',
   (select id from categories where slug = 'casas-de-festas'), (select id from locations where slug = 'belas'),
   'Estrada de Belas, km 18', 'verified', now(), true, now(), 9, true),
  ('5d000000-0000-4000-8001-000000000006', '5d000000-0000-4000-8000-000000000000', 'venue', 'casa-jardim-cacuaco', 'Casa Jardim', 'Casa de festas familiar com jardim e churrasqueira.',
   (select id from categories where slug = 'casas-de-festas'), (select id from locations where slug = 'cacuaco'),
   'Bairro Kicolo, Cacuaco', 'verified', now(), true, now(), 4, true),
  ('5d000000-0000-4000-8001-000000000007', '5d000000-0000-4000-8000-000000000000', 'venue', 'casa-mussulo-sol', 'Casa Mussulo Sol', 'Casa de praia com acesso ao mar, para eventos privados e retiros.',
   (select id from categories where slug = 'casas-de-praia'), (select id from locations where slug = 'belas'),
   'Ilha do Mussulo', 'verified', now(), true, now(), 6, true),
  ('5d000000-0000-4000-8001-000000000008', '5d000000-0000-4000-8000-000000000000', 'venue', 'centro-maianga-negocios', 'Centro Maianga Negócios', 'Salas de conferência com projector, videoconferência e coffee-break.',
   (select id from categories where slug = 'salas-de-conferencia'), (select id from locations where slug = 'maianga'),
   'Rua Major Kanhangulo, Maianga', 'verified', now(), true, now(), 8, true),
  ('5d000000-0000-4000-8001-000000000009', '5d000000-0000-4000-8000-000000000000', 'venue', 'hub-talatona', 'Hub Talatona', 'Espaço flexível para workshops, formações e lançamentos.',
   (select id from categories where slug = 'salas-de-workshop'), (select id from locations where slug = 'talatona'),
   'Via AL15, Talatona', 'verified', now(), true, now(), 2, true),
  ('5d000000-0000-4000-8001-000000000010', '5d000000-0000-4000-8000-000000000000', 'venue', 'espaco-cazenga-eventos', 'Espaço Cazenga Eventos', 'Salão acessível para festas de bairro e celebrações familiares.',
   (select id from categories where slug = 'saloes-de-festas'), (select id from locations where slug = 'cazenga'),
   'Avenida dos Comandos, Cazenga', 'verified', now(), true, now(), 5, true),
  ('5d000000-0000-4000-8001-000000000011', '5d000000-0000-4000-8000-000000000000', 'service', 'dj-kizomba-sound', 'DJ Kizomba Sound', 'DJ para casamentos e festas: kizomba, semba, afro house e o que a pista pedir.',
   (select id from categories where slug = 'djs'), (select id from locations where slug = 'talatona'),
   null, 'verified', now(), true, now(), 10, true),
  ('5d000000-0000-4000-8001-000000000012', '5d000000-0000-4000-8000-000000000000', 'service', 'dj-nelo-mix', 'DJ Nelo Mix', 'DJ e animador para aniversários e eventos empresariais.',
   (select id from categories where slug = 'djs'), (select id from locations where slug = 'viana'),
   null, 'verified', now(), true, now(), 6, true),
  ('5d000000-0000-4000-8001-000000000013', '5d000000-0000-4000-8000-000000000000', 'service', 'beleza-da-banda', 'Beleza da Banda', 'Maquilhagem para noivas e convidadas, ao domicílio ou no local do evento.',
   (select id from categories where slug = 'maquilhagem'), (select id from locations where slug = 'maianga'),
   null, 'verified', now(), true, now(), 8, true),
  ('5d000000-0000-4000-8001-000000000014', '5d000000-0000-4000-8000-000000000000', 'service', 'studio-glamour-kilamba', 'Studio Glamour', 'Equipa de maquilhadoras para casamentos e sessões fotográficas.',
   (select id from categories where slug = 'maquilhagem'), (select id from locations where slug = 'kilamba-kiaxi'),
   null, 'verified', now(), true, now(), 4, true),
  ('5d000000-0000-4000-8001-000000000015', '5d000000-0000-4000-8000-000000000000', 'service', 'decor-mimosa', 'Decor Mimosa', 'Decoração de casamentos, aniversários e baptizados, com flores naturais.',
   (select id from categories where slug = 'decoracao'), (select id from locations where slug = 'talatona'),
   null, 'verified', now(), true, now(), 7, true),
  ('5d000000-0000-4000-8001-000000000016', '5d000000-0000-4000-8000-000000000000', 'service', 'festa-perfeita-decoracoes', 'Festa Perfeita Decorações', 'Decoração temática para festas infantis e aniversários.',
   (select id from categories where slug = 'decoracao'), (select id from locations where slug = 'cazenga'),
   null, 'verified', now(), true, now(), 3, true),
  ('5d000000-0000-4000-8001-000000000017', '5d000000-0000-4000-8000-000000000000', 'service', 'sabores-de-luanda', 'Sabores de Luanda', 'Buffet com cozinha angolana e internacional para eventos de 50 a 500 pessoas.',
   (select id from categories where slug = 'buffet'), (select id from locations where slug = 'ingombota'),
   null, 'verified', now(), true, now(), 12, true),
  ('5d000000-0000-4000-8001-000000000018', '5d000000-0000-4000-8000-000000000000', 'service', 'mesa-farta-catering', 'Mesa Farta Catering', 'Catering para festas familiares, com muamba, calulu e grelhados.',
   (select id from categories where slug = 'buffet'), (select id from locations where slug = 'viana'),
   null, 'verified', now(), true, now(), 5, true),
  ('5d000000-0000-4000-8001-000000000019', '5d000000-0000-4000-8000-000000000000', 'service', 'foto-kwanza', 'Foto Kwanza', 'Fotografia de casamento e de eventos, com entrega digital em 15 dias.',
   (select id from categories where slug = 'fotografia'), (select id from locations where slug = 'talatona'),
   null, 'verified', now(), true, now(), 9, true),
  ('5d000000-0000-4000-8001-000000000020', '5d000000-0000-4000-8000-000000000000', 'service', 'lente-luanda', 'Lente Luanda', 'Fotografia para aniversários, baptizados e eventos empresariais.',
   (select id from categories where slug = 'fotografia'), (select id from locations where slug = 'maianga'),
   null, 'verified', now(), true, now(), 4, true),
  ('5d000000-0000-4000-8001-000000000021', '5d000000-0000-4000-8000-000000000000', 'service', 'filmes-do-rio', 'Filmes do Rio', 'Vídeo de casamento com drone e montagem cinematográfica.',
   (select id from categories where slug = 'video'), (select id from locations where slug = 'belas'),
   null, 'verified', now(), true, now(), 6, true),
  ('5d000000-0000-4000-8001-000000000022', '5d000000-0000-4000-8000-000000000000', 'service', 'som-total-eventos', 'Som Total Eventos', 'Aluguer de som profissional e técnico para eventos.',
   (select id from categories where slug = 'som'), (select id from locations where slug = 'kilamba-kiaxi'),
   null, 'verified', now(), true, now(), 8, true),
  ('5d000000-0000-4000-8001-000000000023', '5d000000-0000-4000-8000-000000000000', 'service', 'luz-e-cor', 'Luz & Cor', 'Iluminação decorativa e de palco para casamentos e festas.',
   (select id from categories where slug = 'iluminacao'), (select id from locations where slug = 'talatona'),
   null, 'verified', now(), true, now(), 5, true),
  ('5d000000-0000-4000-8001-000000000024', '5d000000-0000-4000-8000-000000000000', 'service', 'aluga-festa', 'Aluga Festa', 'Aluguer de tendas, mesas, cadeiras e loiça para festas.',
   (select id from categories where slug = 'material-para-festas'), (select id from locations where slug = 'cacuaco'),
   null, 'verified', now(), true, now(), 10, true)
on conflict (id) do nothing;

insert into resources (id, provider_id, name, capacity) values
  ('5d000000-0000-4000-8002-000000010001', '5d000000-0000-4000-8001-000000000001', 'Salão Principal', 300),
  ('5d000000-0000-4000-8002-000000020001', '5d000000-0000-4000-8001-000000000002', 'Salão', 220),
  ('5d000000-0000-4000-8002-000000030001', '5d000000-0000-4000-8001-000000000003', 'Salão Nobre', 180),
  ('5d000000-0000-4000-8002-000000030002', '5d000000-0000-4000-8001-000000000003', 'Sala Pequena', 60),
  ('5d000000-0000-4000-8002-000000040001', '5d000000-0000-4000-8001-000000000004', 'Salão', 350),
  ('5d000000-0000-4000-8002-000000050001', '5d000000-0000-4000-8001-000000000005', 'Jardim', 450),
  ('5d000000-0000-4000-8002-000000050002', '5d000000-0000-4000-8001-000000000005', 'Área coberta', 200),
  ('5d000000-0000-4000-8002-000000060001', '5d000000-0000-4000-8001-000000000006', 'Casa e jardim', 120),
  ('5d000000-0000-4000-8002-000000070001', '5d000000-0000-4000-8001-000000000007', 'Casa inteira', 50),
  ('5d000000-0000-4000-8002-000000080001', '5d000000-0000-4000-8001-000000000008', 'Auditório', 120),
  ('5d000000-0000-4000-8002-000000080002', '5d000000-0000-4000-8001-000000000008', 'Sala de reuniões', 20),
  ('5d000000-0000-4000-8002-000000090001', '5d000000-0000-4000-8001-000000000009', 'Sala aberta', 60),
  ('5d000000-0000-4000-8002-000000100001', '5d000000-0000-4000-8001-000000000010', 'Salão', 160)
on conflict (id) do nothing;

insert into services (id, provider_id, category_id, name, description, price_mode,
                      price_minor, price_max_minor, price_unit, min_capacity, max_capacity) values
  ('5d000000-0000-4000-8003-000000010001', '5d000000-0000-4000-8001-000000000001', (select id from categories where slug = 'saloes-de-festas'), 'Aluguer do salão (dia inteiro)', 'Mesas, cadeiras, ar condicionado, segurança e limpeza no fim. Não inclui decoração nem catering.', 'exact', 220000000, null, 'event', 80, 300),
  ('5d000000-0000-4000-8003-000000020001', '5d000000-0000-4000-8001-000000000002', (select id from categories where slug = 'saloes-de-festas'), 'Festa (8 horas)', 'Inclui mesas, cadeiras e toalhas. Gerador incluído.', 'from', 150000000, null, 'event', 50, 220),
  ('5d000000-0000-4000-8003-000000030001', '5d000000-0000-4000-8001-000000000003', (select id from categories where slug = 'saloes-de-festas'), 'Salão Nobre — dia inteiro', 'Inclui mobiliário, ar condicionado e dois seguranças.', 'exact', 260000000, null, 'event', 60, 180),
  ('5d000000-0000-4000-8003-000000030002', '5d000000-0000-4000-8001-000000000003', (select id from categories where slug = 'saloes-de-festas'), 'Sala Pequena — 6 horas', 'Ideal para aniversários e baptizados.', 'exact', 70000000, null, 'event', 20, 60),
  ('5d000000-0000-4000-8003-000000040001', '5d000000-0000-4000-8001-000000000004', (select id from categories where slug = 'saloes-de-festas'), 'Aluguer do salão', 'O preço depende do dia da semana. Mobiliário incluído.', 'range', 120000000, 180000000, 'event', 100, 350),
  ('5d000000-0000-4000-8003-000000050001', '5d000000-0000-4000-8001-000000000005', (select id from categories where slug = 'casas-de-festas'), 'Casamento — quinta inteira', 'Jardim, área coberta, casas de banho e estacionamento. Catering à escolha do cliente.', 'range', 450000000, 800000000, 'event', 150, 450),
  ('5d000000-0000-4000-8003-000000060001', '5d000000-0000-4000-8001-000000000006', (select id from categories where slug = 'casas-de-festas'), 'Festa de fim-de-semana', 'Churrasqueira, mesas e cadeiras incluídas.', 'exact', 85000000, null, 'event', 20, 120),
  ('5d000000-0000-4000-8003-000000070001', '5d000000-0000-4000-8001-000000000007', (select id from categories where slug = 'casas-de-praia'), 'Fim-de-semana completo', 'Inclui travessia de barco para até 20 pessoas. Preço sob consulta conforme a época.', 'on_request', null, null, 'event', 10, 50),
  ('5d000000-0000-4000-8003-000000080001', '5d000000-0000-4000-8001-000000000008', (select id from categories where slug = 'salas-de-conferencia'), 'Auditório — dia inteiro', 'Projector, som, wi-fi e duas pausas de café.', 'exact', 150000000, null, 'day', 30, 120),
  ('5d000000-0000-4000-8003-000000080002', '5d000000-0000-4000-8001-000000000008', (select id from categories where slug = 'salas-de-conferencia'), 'Sala de reuniões — por hora', 'Ecrã, quadro branco e wi-fi.', 'exact', 2500000, null, 'hour', 2, 20),
  ('5d000000-0000-4000-8003-000000090001', '5d000000-0000-4000-8001-000000000009', (select id from categories where slug = 'salas-de-workshop'), 'Workshop — meio dia', 'Mesas modulares, projector e café.', 'exact', 45000000, null, 'event', 10, 60),
  ('5d000000-0000-4000-8003-000000100001', '5d000000-0000-4000-8001-000000000010', (select id from categories where slug = 'saloes-de-festas'), 'Festa (6 horas)', 'Mesas e cadeiras incluídas.', 'from', 60000000, null, 'event', 40, 160),
  ('5d000000-0000-4000-8003-000000110001', '5d000000-0000-4000-8001-000000000011', (select id from categories where slug = 'djs'), 'Festa (5 horas)', 'Som para 200 pessoas e luzes básicas. Hora extra: 6.000 Kz.', 'exact', 35000000, null, 'event', null, null),
  ('5d000000-0000-4000-8003-000000120001', '5d000000-0000-4000-8001-000000000012', (select id from categories where slug = 'djs'), 'Animação (4 horas)', 'Inclui microfone sem fios para discursos.', 'from', 25000000, null, 'event', null, null),
  ('5d000000-0000-4000-8003-000000130001', '5d000000-0000-4000-8001-000000000013', (select id from categories where slug = 'maquilhagem'), 'Noiva — maquilhagem e penteado', 'Inclui prova uma semana antes.', 'exact', 12000000, null, 'person', null, null),
  ('5d000000-0000-4000-8003-000000130002', '5d000000-0000-4000-8001-000000000013', (select id from categories where slug = 'maquilhagem'), 'Convidada', null, 'exact', 2500000, null, 'person', null, null),
  ('5d000000-0000-4000-8003-000000140001', '5d000000-0000-4000-8001-000000000014', (select id from categories where slug = 'maquilhagem'), 'Pacote noiva + 4 madrinhas', 'Deslocação em Luanda incluída.', 'exact', 30000000, null, 'event', null, null),
  ('5d000000-0000-4000-8003-000000150001', '5d000000-0000-4000-8001-000000000015', (select id from categories where slug = 'decoracao'), 'Decoração de casamento', 'Mesa dos noivos, centros de mesa e arco floral. O preço depende do número de mesas.', 'range', 80000000, 250000000, 'event', null, null),
  ('5d000000-0000-4000-8003-000000160001', '5d000000-0000-4000-8001-000000000016', (select id from categories where slug = 'decoracao'), 'Festa infantil temática', 'Painel, balões e mesa de doces decorada.', 'from', 18000000, null, 'event', null, null),
  ('5d000000-0000-4000-8003-000000170001', '5d000000-0000-4000-8001-000000000017', (select id from categories where slug = 'buffet'), 'Buffet completo', 'Entradas, dois pratos principais, sobremesa e serviço de mesa.', 'exact', 1200000, null, 'person', 50, 500),
  ('5d000000-0000-4000-8003-000000180001', '5d000000-0000-4000-8001-000000000018', (select id from categories where slug = 'buffet'), 'Menu tradicional', 'Inclui loiça e dois empregados por cada 50 convidados.', 'from', 800000, null, 'person', 30, 300),
  ('5d000000-0000-4000-8003-000000190001', '5d000000-0000-4000-8001-000000000019', (select id from categories where slug = 'fotografia'), 'Casamento (dia inteiro)', 'Dois fotógrafos, galeria online e 50 fotografias impressas.', 'exact', 45000000, null, 'event', null, null),
  ('5d000000-0000-4000-8003-000000200001', '5d000000-0000-4000-8001-000000000020', (select id from categories where slug = 'fotografia'), 'Cobertura (4 horas)', 'Entrega digital em 7 dias.', 'exact', 18000000, null, 'event', null, null),
  ('5d000000-0000-4000-8003-000000210001', '5d000000-0000-4000-8001-000000000021', (select id from categories where slug = 'video'), 'Filme de casamento', 'Inclui drone e vídeo curto para redes sociais.', 'range', 40000000, 90000000, 'event', null, null),
  ('5d000000-0000-4000-8003-000000220001', '5d000000-0000-4000-8001-000000000022', (select id from categories where slug = 'som'), 'Som para 300 pessoas', 'Colunas, mesa de mistura, dois microfones e técnico.', 'exact', 30000000, null, 'day', null, null),
  ('5d000000-0000-4000-8003-000000230001', '5d000000-0000-4000-8001-000000000023', (select id from categories where slug = 'iluminacao'), 'Iluminação de salão', 'Luzes ambiente, cortina de luzes e montagem.', 'from', 20000000, null, 'event', null, null),
  ('5d000000-0000-4000-8003-000000240001', '5d000000-0000-4000-8001-000000000024', (select id from categories where slug = 'material-para-festas'), 'Tenda 10x20 com mesas e cadeiras', 'Montagem e desmontagem incluídas em Luanda.', 'exact', 40000000, null, 'day', null, null)
on conflict (id) do nothing;
