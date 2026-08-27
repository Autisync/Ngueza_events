-- =====================================================================
-- The double-booking constraint (§27) and service concurrency.
-- Run with: npm run test:db
-- =====================================================================
\set ON_ERROR_STOP on
begin;

-- ---- fixtures -------------------------------------------------------
insert into profiles (id, email, role) values
  ('11111111-1111-1111-1111-111111111111', 'dono@salao.ao',  'provider'),
  ('22222222-2222-2222-2222-222222222222', 'ana@example.ao', 'client'),
  ('33333333-3333-3333-3333-333333333333', 'joao@example.ao','client');

insert into categories (id, slug, name, default_supplier_type) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 't-saloes', 'Salões de festas', 'venue'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 't-maquilhagem', 'Maquilhagem', 'service');

insert into locations (id, level, slug, name) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'province', 't-luanda', 'Luanda');
insert into locations (id, parent_id, level, slug, name) values
  ('bbbbbbbb-0000-0000-0000-000000000002',
   'bbbbbbbb-0000-0000-0000-000000000001', 'municipality', 't-talatona', 'Talatona');

insert into providers (id, owner_id, supplier_type, slug, name, category_id, location_id,
                       verification_status, is_published)
values ('cccccccc-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111', 'venue',
        't-salao-talatona', 'Salão Talatona',
        'aaaaaaaa-0000-0000-0000-000000000001',
        'bbbbbbbb-0000-0000-0000-000000000002', 'verified', true);

insert into resources (id, provider_id, name, capacity)
values ('dddddddd-0000-0000-0000-000000000001',
        'cccccccc-0000-0000-0000-000000000001', 'Salão Principal', 250);

-- ---- 1. a venue slot can be taken once ------------------------------
insert into bookings (provider_id, client_id, resource_id, status, starts_at, ends_at)
values ('cccccccc-0000-0000-0000-000000000001',
        '22222222-2222-2222-2222-222222222222',
        'dddddddd-0000-0000-0000-000000000001',
        'confirmed', '2026-12-15 10:00+01', '2026-12-15 23:00+01');

-- ---- 2. and not twice ------------------------------------------------
do $$
begin
  insert into bookings (provider_id, client_id, resource_id, status, starts_at, ends_at)
  values ('cccccccc-0000-0000-0000-000000000001',
          '33333333-3333-3333-3333-333333333333',
          'dddddddd-0000-0000-0000-000000000001',
          'confirmed', '2026-12-15 18:00+01', '2026-12-16 02:00+01');
  raise exception 'FAIL: overlapping confirmed booking was accepted';
exception
  when exclusion_violation then
    raise notice 'PASS: overlapping venue booking refused by the database';
end $$;

-- ---- 3. a pending request does NOT hold the date --------------------
insert into bookings (provider_id, client_id, resource_id, status, starts_at, ends_at)
values ('cccccccc-0000-0000-0000-000000000001',
        '33333333-3333-3333-3333-333333333333',
        'dddddddd-0000-0000-0000-000000000001',
        'requested', '2026-12-15 18:00+01', '2026-12-16 02:00+01');

-- ---- 4. a venue booking without a resource is refused ---------------
do $$
begin
  insert into bookings (provider_id, client_id, status, starts_at, ends_at)
  values ('cccccccc-0000-0000-0000-000000000001',
          '22222222-2222-2222-2222-222222222222',
          'requested', '2027-01-05 10:00+01', '2027-01-05 20:00+01');
  raise exception 'FAIL: venue booking accepted without a resource';
exception
  when check_violation then
    raise notice 'PASS: venue booking requires a resource';
end $$;

-- ---- 5. services overlap up to concurrency_limit --------------------
insert into providers (id, owner_id, supplier_type, concurrency_limit, slug, name,
                       category_id, location_id, verification_status, is_published)
values ('cccccccc-0000-0000-0000-000000000002',
        '11111111-1111-1111-1111-111111111111', 'service', 2,
        't-maria-maquilhagem', 'Maria Maquilhagem',
        'aaaaaaaa-0000-0000-0000-000000000002',
        'bbbbbbbb-0000-0000-0000-000000000002', 'verified', true);

insert into bookings (provider_id, client_id, status, starts_at, ends_at) values
  ('cccccccc-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'confirmed', '2026-12-15 08:00+01', '2026-12-15 11:00+01'),
  ('cccccccc-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333',
   'confirmed', '2026-12-15 09:00+01', '2026-12-15 12:00+01');

do $$
begin
  insert into bookings (provider_id, client_id, status, starts_at, ends_at)
  values ('cccccccc-0000-0000-0000-000000000002',
          '22222222-2222-2222-2222-222222222222',
          'confirmed', '2026-12-15 10:00+01', '2026-12-15 13:00+01');
  raise exception 'FAIL: third overlapping service booking accepted (limit is 2)';
exception
  when exclusion_violation then
    raise notice 'PASS: service concurrency limit enforced';
end $$;

-- ---- 6. illegal transitions are refused -----------------------------
do $$
declare v_id uuid;
begin
  select id into v_id from bookings where status = 'requested' limit 1;
  update bookings set status = 'completed' where id = v_id;
  raise exception 'FAIL: requested -> completed was allowed';
exception
  when check_violation then
    raise notice 'PASS: illegal transition refused';
end $$;

-- ---- 7. the audit trail wrote itself --------------------------------
do $$
declare v_bookings int; v_events int;
begin
  select count(*) into v_bookings from bookings;
  select count(*) into v_events   from booking_events;
  -- Every surviving booking wrote exactly one creation event. Bookings
  -- refused by a constraint rolled their event back with them, which is
  -- the behaviour we want from an audit trail.
  if v_events <> v_bookings then
    raise exception 'FAIL: % bookings but % audit rows', v_bookings, v_events;
  end if;
  raise notice 'PASS: % bookings, % audit rows, one each', v_bookings, v_events;
end $$;

-- ---- 8. the audit trail cannot be rewritten -------------------------
do $$
begin
  update booking_events set to_status = 'confirmed' where id = (select min(id) from booking_events);
  raise exception 'FAIL: booking_events was mutable';
exception
  when check_violation then
    raise notice 'PASS: booking_events is append-only';
end $$;

rollback;
