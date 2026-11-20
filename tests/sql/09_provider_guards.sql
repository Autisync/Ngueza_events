-- =====================================================================
-- What a supplier may not change about their own listing (0047, slice 51).
--
-- supplier_type, concurrency_limit and is_demo decide how bookings behave
-- (date-exclusive or not, how many at once, bookable at all). They were
-- writable by the owner through the plain owner policies. Runs as the
-- real `authenticated` role, the one PostgREST and lib/db.ts use.
-- =====================================================================
\set ON_ERROR_STOP on
begin;

select tests_user('91510000-0000-0000-0000-000000000001', 'dono.salao@g51.ao', 'provider');
select tests_user('91510000-0000-0000-0000-000000000002', 'dono.dj@g51.ao',    'provider');
select tests_user('91510000-0000-0000-0000-000000000009', 'admin@g51.ao',      'admin');

create temp table g51 on commit drop as
select tests_provider('91510000-0000-0000-0000-000000000001', 'venue',   'g51') as venue_id,
       tests_provider('91510000-0000-0000-0000-000000000002', 'service', 'g51') as service_id;
grant select on g51 to authenticated;

insert into categories (id, slug, name, default_supplier_type, is_active) values
  ('92510000-0000-0000-0000-000000000001', 't-g51-either',   'Ambos (g51)',     'either',  true),
  ('92510000-0000-0000-0000-000000000002', 't-g51-retirada', 'Retirada (g51)',  'venue',   false);

set role authenticated;

-- ---- 1. the owner cannot rewrite the behaviour columns ----------------
select tests_login_as('91510000-0000-0000-0000-000000000001');
do $$
declare v_id uuid := (select venue_id from g51);
begin
  begin
    update providers set supplier_type = 'service' where id = v_id;
    raise exception 'FAIL: an owner turned their venue into a service (bookings would stop blocking the date)';
  exception when insufficient_privilege then null;
  end;
  begin
    update providers set concurrency_limit = 50 where id = v_id;
    raise exception 'FAIL: an owner raised their own concurrency limit';
  exception when insufficient_privilege then null;
  end;
  begin
    update providers set is_demo = true where id = v_id;
    raise exception 'FAIL: an owner flagged their own listing as an example';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: an owner cannot change supplier_type, concurrency_limit or is_demo';
end $$;

-- ---- 2. ordinary edits still work, and so does a same-mode category ----
do $$
declare v_id uuid := (select venue_id from g51); v_n int;
begin
  update providers set name = 'Salão renomeado', description = 'Novo texto' where id = v_id;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'FAIL: an owner could not edit their own listing (% rows)', v_n; end if;
  update providers set category_id = '92510000-0000-0000-0000-000000000001' where id = v_id;
  raise notice 'PASS: an owner edits their listing and may move it to a category that fits its mode';
end $$;

-- ---- 3. a category of the other mode, or a retired one, is refused -----
do $$
declare
  v_id uuid := (select venue_id from g51);
  v_service_cat uuid := (select category_id from providers where id = (select service_id from g51));
begin
  begin
    update providers set category_id = v_service_cat where id = v_id;
    raise exception 'FAIL: a venue moved into a service category and kept venue behaviour';
  exception when check_violation then null;
  end;
  begin
    update providers set category_id = '92510000-0000-0000-0000-000000000002' where id = v_id;
    raise exception 'FAIL: a listing moved into a retired category';
  exception when check_violation then null;
  end;
  raise notice 'PASS: a listing cannot move to a category of the other mode, or to a retired one';
end $$;

-- ---- 4. a new listing cannot start with rewritten behaviour ------------
select tests_login_as('91510000-0000-0000-0000-000000000002');
do $$
declare
  v_loc uuid := (select location_id from providers where id = (select service_id from g51));
  v_service_cat uuid := (select category_id from providers where id = (select service_id from g51));
  v_venue_cat uuid := (select c.id from categories c where c.slug = 't-g51-venue');
begin
  begin
    insert into providers (owner_id, supplier_type, slug, name, category_id, location_id, is_demo)
    values ('91510000-0000-0000-0000-000000000002', 'service', 't-g51-demo', 'Exemplo falso', v_service_cat, v_loc, true);
    raise exception 'FAIL: an owner created a listing already flagged as an example';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into providers (owner_id, supplier_type, slug, name, category_id, location_id, concurrency_limit)
    values ('91510000-0000-0000-0000-000000000002', 'service', 't-g51-c50', 'Cinquenta', v_service_cat, v_loc, 50);
    raise exception 'FAIL: an owner created a listing with a raised concurrency limit';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into providers (owner_id, supplier_type, slug, name, category_id, location_id)
    values ('91510000-0000-0000-0000-000000000002', 'service', 't-g51-mis', 'Desalinhado', v_venue_cat, v_loc);
    raise exception 'FAIL: an owner registered a service inside a venue category';
  exception when check_violation then null;
  end;
  insert into providers (owner_id, supplier_type, slug, name, category_id, location_id)
  values ('91510000-0000-0000-0000-000000000002', 'service', 't-g51-ok', 'Segundo negócio', v_service_cat, v_loc);
  raise notice 'PASS: a new listing must match its category''s mode and start with default behaviour';
end $$;

-- ---- 5. an administrator, and the system, still can --------------------
select tests_login_as('91510000-0000-0000-0000-000000000009');
do $$
declare v_id uuid := (select service_id from g51);
begin
  update providers set concurrency_limit = 3 where id = v_id;
  raise notice 'PASS: an administrator may change a listing''s behaviour';
end $$;

reset role;
update providers set is_demo = true where id = (select venue_id from g51);
do $$ begin raise notice 'PASS: migrations and the service role are not end users'; end $$;

rollback;
