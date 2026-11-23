-- =====================================================================
-- Taxonomy for more than events (0049, slice 52).
--
--   * a root that gets children becomes a heading, not a category to pick;
--   * category_paths / assignable_categories show only nodes whose whole
--     ancestry is active, under the caller's RLS;
--   * category_links lists a category under a second parent, and
--     category_scope() follows it for search, quotes and supply;
--   * providers, services and quote requests can only name a category
--     that is open to them.
--
-- Runs seedless, as the real anon and authenticated roles.
-- =====================================================================
\set ON_ERROR_STOP on
begin;

select tests_user('91520000-0000-0000-0000-000000000001', 'maquilhadora@g52.ao', 'provider');
select tests_user('91520000-0000-0000-0000-000000000002', 'novo@g52.ao',         'provider');
select tests_user('91520000-0000-0000-0000-000000000003', 'cliente@g52.ao',      'client');
select tests_user('91520000-0000-0000-0000-000000000004', 'exemplo@g52.ao',      'provider');
select tests_user('91520000-0000-0000-0000-000000000009', 'admin@g52.ao',        'admin');

-- Two verticals: Eventos (open) and Beleza (not yet). Beleza holds an
-- ACTIVE leaf, which RLS alone would show to a visitor.
insert into categories (id, parent_id, slug, name, default_supplier_type, sort_order, is_active) values
  ('92520000-0000-0000-0000-000000000001', null, 't-g52-eventos', 'Eventos (g52)', 'either', 1, true),
  ('92520000-0000-0000-0000-000000000002', null, 't-g52-beleza',  'Beleza (g52)',  'either', 2, false);
insert into categories (id, parent_id, slug, name, default_supplier_type, sort_order, is_active) values
  ('92520000-0000-0000-0000-000000000011', '92520000-0000-0000-0000-000000000001', 't-g52-saloes',      'Salões (g52)',      'venue',   1, true),
  ('92520000-0000-0000-0000-000000000012', '92520000-0000-0000-0000-000000000001', 't-g52-maquilhagem', 'Maquilhagem (g52)', 'service', 2, true),
  ('92520000-0000-0000-0000-000000000013', '92520000-0000-0000-0000-000000000001', 't-g52-retirada',    'Retirada (g52)',    'service', 3, false),
  ('92520000-0000-0000-0000-000000000021', '92520000-0000-0000-0000-000000000002', 't-g52-unhas',       'Unhas (g52)',       'service', 1, true);
insert into locations (id, level, slug, name) values
  ('93520000-0000-0000-0000-000000000001', 'province', 't-g52-zona', 'Zona (g52)');

-- A make-up artist registered under Eventos, and an example listing in
-- the same category.
insert into providers (id, owner_id, supplier_type, slug, name, category_id, location_id,
                       verification_status, is_published, is_demo) values
  ('94520000-0000-0000-0000-000000000001', '91520000-0000-0000-0000-000000000001', 'service',
   't-g52-maquilhadora', 'Maquilhadora (g52)', '92520000-0000-0000-0000-000000000012',
   '93520000-0000-0000-0000-000000000001', 'verified', true, false),
  ('94520000-0000-0000-0000-000000000004', '91520000-0000-0000-0000-000000000004', 'service',
   't-g52-exemplo', 'Exemplo (g52)', '92520000-0000-0000-0000-000000000012',
   '93520000-0000-0000-0000-000000000001', 'verified', true, true);

-- ---- 1. a root with children is a heading ------------------------------
do $$
declare v_bad text;
begin
  select string_agg(slug, ', ') into v_bad from categories
   where slug like 't-g52-%'
     and is_assignable <> (parent_id is not null);
  if v_bad is not null then
    raise exception 'FAIL: headings and leaves have the wrong is_assignable: %', v_bad;
  end if;
  raise notice 'PASS: a root that gets a child becomes a heading; leaves stay assignable';
end $$;

-- ---- 2. the views: whole ancestry active, caller's RLS ----------------
do $$
declare v_bad text;
begin
  select string_agg(c.relname, ', ') into v_bad
    from pg_class c
   where c.relname in ('category_paths', 'assignable_categories')
     and not ('security_invoker=true' = any (coalesce(c.reloptions, '{}')));
  if v_bad is not null then
    raise exception 'FAIL: views that would bypass RLS: %', v_bad;
  end if;
  raise notice 'PASS: category_paths and assignable_categories apply the caller''s RLS';
end $$;

set role anon;
select tests_logout();
do $$
declare v_paths text; v_pick text; v_row int;
begin
  select string_agg(slug, ',' order by root_sort, root_name, sort_path, name_path) into v_paths
    from category_paths where slug like 't-g52-%';
  if v_paths is distinct from 't-g52-eventos,t-g52-saloes,t-g52-maquilhagem' then
    raise exception 'FAIL: a visitor''s category_paths is %, expected eventos, saloes, maquilhagem', v_paths;
  end if;
  select string_agg(slug, ',' order by root_sort, sort_path) into v_pick
    from assignable_categories where slug like 't-g52-%';
  if v_pick is distinct from 't-g52-saloes,t-g52-maquilhagem' then
    raise exception 'FAIL: a visitor can pick %, expected only the two open leaves', v_pick;
  end if;
  -- RLS alone shows the active leaf under the closed vertical...
  select count(*) into v_row from categories where slug = 't-g52-unhas';
  if v_row <> 1 then raise exception 'FAIL: fixture: anon should see the unhas row itself'; end if;
  raise notice 'PASS: a visitor sees only nodes whose whole ancestry is active; headings are not pickable';
end $$;
reset role;

-- An administrator sees inactive rows through RLS; the views still hide them.
set role authenticated;
select tests_login_as('91520000-0000-0000-0000-000000000009');
do $$
declare v_n int;
begin
  select count(*) into v_n from category_paths where slug in ('t-g52-beleza', 't-g52-unhas', 't-g52-retirada');
  if v_n <> 0 then raise exception 'FAIL: an administrator''s category_paths shows % closed nodes', v_n; end if;
  raise notice 'PASS: the views show administrators what visitors see';
end $$;
reset role;

-- ---- 3. links: no redundant ones, admin-only writes ---------------------
do $$
begin
  begin
    insert into category_links values ('92520000-0000-0000-0000-000000000011', '92520000-0000-0000-0000-000000000001');
    raise exception 'FAIL: a leaf was linked under its own parent';
  exception when check_violation then null;
  end;
  begin
    insert into category_links values ('92520000-0000-0000-0000-000000000001', '92520000-0000-0000-0000-000000000011');
    raise exception 'FAIL: a vertical was linked under its own leaf';
  exception when check_violation then null;
  end;
  raise notice 'PASS: a link that adds nothing, or that loops into its own subtree, is refused';
end $$;

-- Maquilhagem is also under Beleza.
insert into category_links (category_id, also_under_id)
values ('92520000-0000-0000-0000-000000000012', '92520000-0000-0000-0000-000000000002');

set role anon;
select tests_logout();
do $$
declare v_n int;
begin
  begin
    insert into category_links values ('92520000-0000-0000-0000-000000000011', '92520000-0000-0000-0000-000000000021');
    raise exception 'FAIL: a visitor created a link';
  exception when insufficient_privilege then null;
  end;
  select count(*) into v_n from category_links where category_id = '92520000-0000-0000-0000-000000000012';
  if v_n <> 0 then raise exception 'FAIL: a visitor sees a link into a closed vertical'; end if;
  raise notice 'PASS: visitors cannot write links, and do not see links into a closed vertical';
end $$;
reset role;

set role authenticated;
select tests_login_as('91520000-0000-0000-0000-000000000002');
do $$
begin
  begin
    insert into category_links values ('92520000-0000-0000-0000-000000000011', '92520000-0000-0000-0000-000000000021');
    raise exception 'FAIL: a supplier created a link';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: only an administrator writes links';
end $$;
reset role;

-- ---- 4. scope: subtree, links, retired nodes, loops ---------------------
set role anon;
select tests_logout();
do $$
declare v_scope text;
begin
  select string_agg(c.slug, ',' order by c.slug) into v_scope
    from category_scope('92520000-0000-0000-0000-000000000001') s join categories c on c.id = s.id;
  if v_scope is distinct from 't-g52-eventos,t-g52-maquilhagem,t-g52-saloes' then
    raise exception 'FAIL: scope(Eventos) is %, expected eventos, maquilhagem, saloes (not the retired leaf)', v_scope;
  end if;
  if exists (select 1 from category_scope('92520000-0000-0000-0000-000000000002')) then
    raise exception 'FAIL: a closed vertical has a scope';
  end if;
  raise notice 'PASS: a scope is the active subtree; a closed vertical covers nothing';
end $$;
reset role;

-- Open Beleza.
update categories set is_active = true where id = '92520000-0000-0000-0000-000000000002';

set role anon;
select tests_logout();
do $$
declare v_scope text;
begin
  select string_agg(c.slug, ',' order by c.slug) into v_scope
    from category_scope('92520000-0000-0000-0000-000000000002') s join categories c on c.id = s.id;
  if v_scope is distinct from 't-g52-beleza,t-g52-maquilhagem,t-g52-unhas' then
    raise exception 'FAIL: scope(Beleza) is %, expected beleza, maquilhagem (linked), unhas', v_scope;
  end if;
  raise notice 'PASS: a linked category is in the scope of its second parent';
end $$;
reset role;

-- A loop through links: Beleza also under Maquilhagem, Maquilhagem under
-- Beleza. Neither is in the other's parent tree, so the guard allows it;
-- the scope must still stop.
insert into category_links (category_id, also_under_id)
values ('92520000-0000-0000-0000-000000000002', '92520000-0000-0000-0000-000000000012');
set local statement_timeout = '3s';
do $$
declare v_n int;
begin
  select count(*) into v_n from category_scope('92520000-0000-0000-0000-000000000002');
  if v_n <> 3 then raise exception 'FAIL: a scope through a link loop returned % rows, expected 3', v_n; end if;
  raise notice 'PASS: a loop of links ends (UNION), it does not hang search';
end $$;
set local statement_timeout = 0;
delete from category_links where category_id = '92520000-0000-0000-0000-000000000002';

-- ---- 5. listings, services and requests name an open category ----------
set role authenticated;
select tests_login_as('91520000-0000-0000-0000-000000000002');
do $$
declare v_id uuid;
begin
  begin
    insert into providers (owner_id, supplier_type, slug, name, category_id, location_id)
    values ('91520000-0000-0000-0000-000000000002', 'service', 't-g52-novo-a', 'Novo',
            '92520000-0000-0000-0000-000000000001', '93520000-0000-0000-0000-000000000001');
    raise exception 'FAIL: a supplier registered under a heading';
  exception when check_violation then null;
  end;
  begin
    insert into providers (owner_id, supplier_type, slug, name, category_id, location_id)
    values ('91520000-0000-0000-0000-000000000002', 'service', 't-g52-novo-b', 'Novo',
            '92520000-0000-0000-0000-000000000013', '93520000-0000-0000-0000-000000000001');
    raise exception 'FAIL: a supplier registered under a retired category';
  exception when check_violation then null;
  end;
  insert into providers (owner_id, supplier_type, slug, name, category_id, location_id)
  values ('91520000-0000-0000-0000-000000000002', 'service', 't-g52-novo', 'Novo',
          '92520000-0000-0000-0000-000000000021', '93520000-0000-0000-0000-000000000001')
  returning id into v_id;
  raise notice 'PASS: a new listing takes an open leaf, never a heading or a retired category';
end $$;

do $$
declare v_provider uuid := (select id from providers where slug = 't-g52-novo'); v_service uuid;
begin
  begin
    insert into services (provider_id, category_id, name, price_mode, price_minor, price_unit)
    values (v_provider, '92520000-0000-0000-0000-000000000001', 'Tudo', 'exact', 100000, 'event');
    raise exception 'FAIL: a service was filed under a heading';
  exception when check_violation then null;
  end;
  begin
    insert into services (provider_id, category_id, name, price_mode, price_minor, price_unit)
    values (v_provider, '92520000-0000-0000-0000-000000000013', 'Velho', 'exact', 100000, 'event');
    raise exception 'FAIL: a service was filed under a retired category';
  exception when check_violation then null;
  end;
  insert into services (provider_id, category_id, name, price_mode, price_minor, price_unit)
  values (v_provider, '92520000-0000-0000-0000-000000000021', 'Gel', 'exact', 100000, 'event')
  returning id into v_service;
  raise notice 'PASS: a service takes an open leaf, never a heading or a retired category';
end $$;
reset role;

-- The category of that service is retired later. Its owner can still edit it.
update categories set is_active = false where id = '92520000-0000-0000-0000-000000000021';
set role authenticated;
select tests_login_as('91520000-0000-0000-0000-000000000002');
do $$
declare v_n int;
begin
  update services set name = 'Gel e verniz'
   where provider_id = (select id from providers where slug = 't-g52-novo');
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'FAIL: a service in a since-retired category could not be edited'; end if;
  raise notice 'PASS: editing a service whose category was retired later still works';
end $$;
reset role;
update categories set is_active = true where id = '92520000-0000-0000-0000-000000000021';

set role authenticated;
select tests_login_as('91520000-0000-0000-0000-000000000003');
do $$
begin
  begin
    insert into quote_requests (client_id, category_id, location_id, description)
    values ('91520000-0000-0000-0000-000000000003', '92520000-0000-0000-0000-000000000013',
            '93520000-0000-0000-0000-000000000001', 'Pedido numa categoria retirada');
    raise exception 'FAIL: a request was opened on a retired category';
  exception when check_violation then null;
  end;
  raise notice 'PASS: a request cannot name a retired category';
end $$;

-- ---- 6. a request on Beleza reaches the make-up artist through the link --
do $$
declare v_id uuid;
begin
  insert into quote_requests (client_id, category_id, location_id, description)
  values ('91520000-0000-0000-0000-000000000003', '92520000-0000-0000-0000-000000000002',
          '93520000-0000-0000-0000-000000000001', 'Maquilhagem e unhas para a noiva')
  returning id into v_id;
  perform set_config('tests.g52_request', v_id::text, true);
  raise notice 'PASS: a request may name a whole open vertical';
end $$;

select tests_login_as('91520000-0000-0000-0000-000000000001');
do $$
declare v_n int; v_req uuid := current_setting('tests.g52_request')::uuid;
begin
  select count(*) into v_n from quote_requests where id = v_req;
  if v_n <> 1 then
    raise exception 'FAIL: the make-up artist (Eventos, linked under Beleza) cannot read a Beleza request';
  end if;
  if not quote_request_open_and_matches(v_req, '94520000-0000-0000-0000-000000000001') then
    raise exception 'FAIL: quote_request_open_and_matches says the linked supplier does not match';
  end if;
  raise notice 'PASS: a linked supplier reads, and may answer, a request on the second parent';
end $$;
reset role;

do $$
declare v_req uuid := current_setting('tests.g52_request')::uuid; v_real int; v_demo int;
begin
  select count(*) into v_real from notification_outbox
   where source_id = v_req::text and kind = 'quote_request_new'
     and recipient_id = '91520000-0000-0000-0000-000000000001';
  select count(*) into v_demo from notification_outbox
   where source_id = v_req::text and kind = 'quote_request_new'
     and recipient_id = '91520000-0000-0000-0000-000000000004';
  if v_real <> 1 then raise exception 'FAIL: the linked supplier was not told about the request (% rows)', v_real; end if;
  if v_demo <> 0 then raise exception 'FAIL: an example listing was told about a real request'; end if;
  raise notice 'PASS: the linked supplier is notified; an example listing is not';
end $$;

-- ---- 7. switching a vertical is recorded ---------------------------------
do $$
declare v_n int;
begin
  select count(*) into v_n from audit_log
   where target_type = 'category' and target_id = '92520000-0000-0000-0000-000000000002'
     and after ->> 'is_active' = 'true';
  if v_n <> 1 then raise exception 'FAIL: opening a vertical left % audit rows, expected 1', v_n; end if;
  raise notice 'PASS: opening a vertical is in the audit log';
end $$;

rollback;
