-- =====================================================================
-- The event planner (0046, slice 50). A plan is its owner's alone: not
-- another client's, not a visitor's, not an administrator's. Its lines
-- link only the owner's own bookings, and the caps hold.
--
-- Runs as the real `anon` and `authenticated` roles.
-- =====================================================================
\set ON_ERROR_STOP on
begin;

select tests_user('51500000-0000-0000-0000-000000000001', 'ana@plan.ao',   'client');
select tests_user('51500000-0000-0000-0000-000000000002', 'bento@plan.ao', 'client');
select tests_user('51500000-0000-0000-0000-000000000009', 'admin@plan.ao', 'admin');
select tests_user('51500000-0000-0000-0000-000000000005', 'dono@plan.ao',  'provider');

insert into categories (id, slug, name, default_supplier_type) values
  ('52500000-0000-0000-0000-000000000001', 'plan-saloes', 'Salões (plan)', 'venue');
insert into locations (id, level, slug, name) values
  ('53500000-0000-0000-0000-000000000001', 'province', 'plan-luanda', 'Luanda (plan)');
insert into providers (id, owner_id, supplier_type, slug, name, category_id, location_id,
                       verification_status, is_published) values
  ('54500000-0000-0000-0000-000000000001', '51500000-0000-0000-0000-000000000005', 'venue',
   'plan-salao', 'Salão Plan', '52500000-0000-0000-0000-000000000001',
   '53500000-0000-0000-0000-000000000001', 'verified', true);
insert into resources (id, provider_id, name, capacity) values
  ('55500000-0000-0000-0000-000000000001', '54500000-0000-0000-0000-000000000001', 'Sala', 200);
-- One booking each for Ana and Bento.
insert into bookings (id, provider_id, client_id, resource_id, status, starts_at, ends_at) values
  ('56500000-0000-0000-0000-00000000000a', '54500000-0000-0000-0000-000000000001',
   '51500000-0000-0000-0000-000000000001', '55500000-0000-0000-0000-000000000001', 'confirmed',
   now() + interval '60 days', now() + interval '60 days 10 hours'),
  ('56500000-0000-0000-0000-00000000000b', '54500000-0000-0000-0000-000000000001',
   '51500000-0000-0000-0000-000000000002', '55500000-0000-0000-0000-000000000001', 'confirmed',
   now() + interval '70 days', now() + interval '70 days 10 hours');

insert into event_types (id, slug, name, is_active) values
  ('57500000-0000-0000-0000-000000000001', 'plan-casamento', 'Casamento (plan)', true),
  ('57500000-0000-0000-0000-000000000002', 'plan-retirado',  'Retirado (plan)',  false);
insert into event_type_needs (event_type_id, name, category_id, budget_share_bp, weeks_before) values
  ('57500000-0000-0000-0000-000000000001', 'Local', '52500000-0000-0000-0000-000000000001', 3000, 26),
  ('57500000-0000-0000-0000-000000000002', 'Escondida', null, 1000, 2);

-- ---- 1. a visitor reads the active lists and no plan --------------------
set role anon;
select tests_logout();
do $$
declare v_types int; v_needs int;
begin
  select count(*) into v_types from event_types where slug like 'plan-%';
  select count(*) into v_needs from event_type_needs n
    join event_types t on t.id = n.event_type_id where t.slug like 'plan-%';
  if v_types <> 1 or v_needs <> 1 then
    raise exception 'FAIL: anon sees % types and % needs, expected only the active 1 and 1', v_types, v_needs;
  end if;
  begin
    perform 1 from event_plans;
    raise exception 'FAIL: anon read event_plans';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into event_types (slug, name) values ('plan-intruso', 'Intruso');
    raise exception 'FAIL: anon created an event type';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: visitors read the active event types and needs, and no plan';
end $$;

-- ---- 2. Ana plans; her plan and lines are hers --------------------------
set role authenticated;
select tests_login_as('51500000-0000-0000-0000-000000000001');
insert into event_plans (id, event_type_id, title, event_date, guest_count, budget_minor) values
  ('58500000-0000-0000-0000-00000000000a', '57500000-0000-0000-0000-000000000001',
   'Casamento da Ana', current_date + 120, 150, 500000000);
insert into event_plan_items (id, plan_id, name, estimate_minor) values
  ('59500000-0000-0000-0000-00000000000a', '58500000-0000-0000-0000-00000000000a', 'Local', 150000000);
do $$
declare v_owner uuid;
begin
  select owner_id into v_owner from event_plans where id = '58500000-0000-0000-0000-00000000000a';
  if v_owner is distinct from '51500000-0000-0000-0000-000000000001' then
    raise exception 'FAIL: the plan''s owner defaulted to %, not the caller', v_owner;
  end if;
  raise notice 'PASS: a plan belongs to whoever creates it';
end $$;

-- ---- 3. nobody else sees it: not Bento, not an administrator ------------
select tests_login_as('51500000-0000-0000-0000-000000000002');
do $$
declare v_p int; v_i int; v_u int;
begin
  select count(*) into v_p from event_plans;
  select count(*) into v_i from event_plan_items;
  if v_p <> 0 or v_i <> 0 then
    raise exception 'FAIL: another client sees % plans and % lines', v_p, v_i;
  end if;
  update event_plans set title = 'Roubado' where id = '58500000-0000-0000-0000-00000000000a';
  get diagnostics v_u = row_count;
  if v_u <> 0 then raise exception 'FAIL: another client edited the plan'; end if;
  begin
    insert into event_plan_items (plan_id, name) values ('58500000-0000-0000-0000-00000000000a', 'Intrusa');
    raise exception 'FAIL: another client added a line to the plan';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: another client can neither see nor touch someone''s plan';
end $$;

select tests_login_as('51500000-0000-0000-0000-000000000009');
do $$
declare v_p int; v_i int;
begin
  select count(*) into v_p from event_plans;
  select count(*) into v_i from event_plan_items;
  if v_p <> 0 or v_i <> 0 then
    raise exception 'FAIL: an administrator sees % plans and % lines; a budget is private', v_p, v_i;
  end if;
  raise notice 'PASS: administrators do not see clients'' plans';
end $$;

-- ---- 4. a line links only the owner's own bookings ----------------------
select tests_login_as('51500000-0000-0000-0000-000000000001');
do $$
begin
  begin
    update event_plan_items set booking_id = '56500000-0000-0000-0000-00000000000b'
     where id = '59500000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: a line linked someone else''s booking';
  exception when check_violation then null;
  end;
  update event_plan_items set booking_id = '56500000-0000-0000-0000-00000000000a', status = 'done'
   where id = '59500000-0000-0000-0000-00000000000a';
  raise notice 'PASS: a line links the owner''s own booking, and only that';
end $$;

-- ---- 5. a line stays in its plan; plans are archived, never deleted ----
reset role;
insert into event_plans (id, owner_id, event_type_id, title) values
  ('58500000-0000-0000-0000-00000000000b', '51500000-0000-0000-0000-000000000002',
   '57500000-0000-0000-0000-000000000001', 'Festa do Bento');
set role authenticated;
select tests_login_as('51500000-0000-0000-0000-000000000001');
do $$
begin
  begin
    update event_plan_items set plan_id = '58500000-0000-0000-0000-00000000000b'
     where id = '59500000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: a line moved into another person''s plan';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from event_plans where id = '58500000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: a plan was deleted';
  exception when insufficient_privilege then null;
  end;
  update event_plans set archived_at = now() where id = '58500000-0000-0000-0000-00000000000a';
  raise notice 'PASS: lines stay in their plan, and plans are archived rather than deleted';
end $$;

-- ---- 6. a retired type takes no new plans ------------------------------
do $$
begin
  begin
    insert into event_plans (event_type_id, title) values ('57500000-0000-0000-0000-000000000002', 'Velho');
    raise exception 'FAIL: a plan was created with a retired type';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: a retired event type takes no new plans';
end $$;

-- ---- 7. the caps: 30 active plans, 60 lines ----------------------------
do $$
declare i int;
begin
  for i in 1..30 loop
    insert into event_plans (event_type_id, title) values ('57500000-0000-0000-0000-000000000001', 'Plano ' || i);
  end loop;
  begin
    insert into event_plans (event_type_id, title) values ('57500000-0000-0000-0000-000000000001', 'Plano 31');
    raise exception 'FAIL: a 31st active plan was created';
  exception when check_violation then null;
  end;
  for i in 2..60 loop
    insert into event_plan_items (plan_id, name) values ('58500000-0000-0000-0000-00000000000a', 'Linha ' || i);
  end loop;
  begin
    insert into event_plan_items (plan_id, name) values ('58500000-0000-0000-0000-00000000000a', 'Linha 61');
    raise exception 'FAIL: a 61st line was added';
  exception when check_violation then null;
  end;
  raise notice 'PASS: at most 30 active plans per person and 60 lines per plan';
end $$;

-- ---- 8. administrators keep the lists; clients cannot -------------------
do $$
begin
  begin
    insert into event_types (slug, name) values ('plan-cliente', 'Cliente');
    raise exception 'FAIL: a client created an event type';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: clients cannot change the event types';
end $$;

select tests_login_as('51500000-0000-0000-0000-000000000009');
do $$
declare v_n int;
begin
  insert into event_types (slug, name) values ('plan-admin', 'Admin');
  update event_type_needs set budget_share_bp = 2500 where name = 'Local' and event_type_id = '57500000-0000-0000-0000-000000000001';
  select count(*) into v_n from event_types where slug like 'plan-%';
  if v_n <> 3 then raise exception 'FAIL: an administrator sees % test types, expected 3 including the retired one', v_n; end if;
  raise notice 'PASS: administrators manage event types and needs, retired ones included';
end $$;

reset role;
rollback;
