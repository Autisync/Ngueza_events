-- =====================================================================
-- Integrity guards from the competitive review (0030, 0031).
--
-- Runs as the real `authenticated` and `anon` roles, the ones PostgREST
-- and lib/db.ts use, because the column guards apply to end users only.
-- =====================================================================
\set ON_ERROR_STOP on
begin;

select tests_user('11113000-0000-0000-0000-000000000001', 'dono@int.ao',    'provider');
select tests_user('22113000-0000-0000-0000-000000000001', 'cliente@int.ao', 'client');
select tests_user('22113000-0000-0000-0000-000000000002', 'outro@int.ao',   'client');

insert into categories (id, slug, name, default_supplier_type) values
  ('aaaa3000-0000-0000-0000-000000000001', 'int-saloes', 'Salões (int)', 'venue');
insert into locations (id, level, slug, name) values
  ('bbbb3000-0000-0000-0000-000000000001', 'province', 'int-luanda', 'Luanda (int)');
insert into providers (id, owner_id, supplier_type, slug, name, category_id, location_id,
                       verification_status, is_published, email) values
  ('cccc3000-0000-0000-0000-000000000001', '11113000-0000-0000-0000-000000000001', 'venue',
   'int-salao', 'Salão Int', 'aaaa3000-0000-0000-0000-000000000001',
   'bbbb3000-0000-0000-0000-000000000001', 'verified', true, 'privado@int.ao');
insert into resources (id, provider_id, name, capacity) values
  ('dddd3000-0000-0000-0000-000000000001', 'cccc3000-0000-0000-0000-000000000001', 'Sala A', 100),
  ('dddd3000-0000-0000-0000-000000000002', 'cccc3000-0000-0000-0000-000000000001', 'Sala B', 100);

-- ---- 1. anon cannot read private provider columns (B28) -------------
set role anon;
select tests_logout();
do $$
begin
  perform email from providers where id = 'cccc3000-0000-0000-0000-000000000001';
  raise exception 'FAIL: anon read providers.email';
exception
  when insufficient_privilege then
    raise notice 'PASS: anon cannot read a supplier''s private email';
end $$;
do $$
begin
  if not exists (select 1 from providers where id = 'cccc3000-0000-0000-0000-000000000001') then
    raise exception 'FAIL: anon cannot see the published supplier at all';
  end if;
  raise notice 'PASS: anon still sees the published supplier''s display columns';
end $$;
reset role;

-- ---- 2. a supplier cannot book their own listing (B8) ----------------
set role authenticated;
select tests_login_as('11113000-0000-0000-0000-000000000001');
do $$
begin
  insert into bookings (provider_id, client_id, resource_id, status, starts_at, ends_at)
  values ('cccc3000-0000-0000-0000-000000000001', '11113000-0000-0000-0000-000000000001',
          'dddd3000-0000-0000-0000-000000000001', 'requested',
          now() + interval '30 days', now() + interval '30 days 10 hours');
  raise exception 'FAIL: a supplier booked their own listing';
exception
  when insufficient_privilege then
    raise notice 'PASS: a supplier cannot request a booking of their own listing';
end $$;

-- ---- 3. a client cannot request a date in the past (B22) -------------
select tests_login_as('22113000-0000-0000-0000-000000000001');
do $$
begin
  insert into bookings (provider_id, client_id, resource_id, status, starts_at, ends_at)
  values ('cccc3000-0000-0000-0000-000000000001', '22113000-0000-0000-0000-000000000001',
          'dddd3000-0000-0000-0000-000000000001', 'requested',
          now() - interval '3 days', now() - interval '2 days');
  raise exception 'FAIL: a booking was requested for a past date';
exception
  when insufficient_privilege then
    raise notice 'PASS: a past date cannot be requested';
end $$;

-- ---- 4. a client's snapshot is replaced, and terms are frozen (B14) ---
do $$
declare v_id uuid; v_name text;
begin
  insert into bookings (provider_id, client_id, resource_id, status, starts_at, ends_at, policy_snapshot)
  values ('cccc3000-0000-0000-0000-000000000001', '22113000-0000-0000-0000-000000000001',
          'dddd3000-0000-0000-0000-000000000001', 'requested',
          now() + interval '30 days', now() + interval '30 days 10 hours',
          '{"name":"forjada","tiers":[{"days_before":0,"refund_pct":100}]}')
  returning id into v_id;
  select policy_snapshot->>'name' into v_name from bookings where id = v_id;
  if v_name = 'forjada' then raise exception 'FAIL: a client-supplied policy snapshot was kept'; end if;
  raise notice 'PASS: the cancellation snapshot comes from the database, not the request';

  begin
    update bookings set starts_at = starts_at + interval '1 day' where id = v_id;
    raise exception 'FAIL: a client moved the date of their own booking';
  exception
    when insufficient_privilege then
      raise notice 'PASS: a booking''s dates cannot be rewritten by a party';
  end;
end $$;

-- ---- 5. trigger order: room B can be blocked while room A is held (B13)
reset role;
insert into bookings (provider_id, client_id, resource_id, status, starts_at, ends_at)
values ('cccc3000-0000-0000-0000-000000000001', '22113000-0000-0000-0000-000000000002',
        'dddd3000-0000-0000-0000-000000000001', 'confirmed',
        now() + interval '40 days', now() + interval '40 days 10 hours');
set role authenticated;
select tests_login_as('11113000-0000-0000-0000-000000000001');
do $$
begin
  insert into bookings (provider_id, resource_id, status, starts_at, ends_at)
  values ('cccc3000-0000-0000-0000-000000000001', 'dddd3000-0000-0000-0000-000000000002', 'blocked',
          now() + interval '40 days', now() + interval '40 days 10 hours');
  raise notice 'PASS: a second room is blockable while the first is held';
exception
  when exclusion_violation then
    raise exception 'FAIL: blocking room B was refused because room A is held';
end $$;

-- ---- 6. a suspended owner's listing leaves public view (B11) ----------
reset role;
update profiles set status = 'suspended' where id = '11113000-0000-0000-0000-000000000001';
set role anon;
select tests_logout();
do $$
begin
  if exists (select 1 from providers where id = 'cccc3000-0000-0000-0000-000000000001') then
    raise exception 'FAIL: a suspended owner''s listing is still public';
  end if;
  raise notice 'PASS: suspending the owner hides their listing';
end $$;

reset role;
rollback;
