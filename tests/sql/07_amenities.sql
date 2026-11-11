-- =====================================================================
-- Amenities (0043, slice 45). Who may read a space's amenities, and who
-- may tick them.
-- =====================================================================
\set ON_ERROR_STOP on
begin;

create role app_user nologin;
grant usage on schema public, auth to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;
grant execute on all functions in schema public, auth to app_user;

select tests_user('11111111-1111-1111-1111-111111111111', 'dono.a@x.ao', 'provider');
select tests_user('44444444-4444-4444-4444-444444444444', 'dono.b@x.ao', 'provider');
select tests_user('99999999-9999-9999-9999-999999999999', 'admin@x.ao',  'admin');

insert into categories (id, slug, name, default_supplier_type)
  values ('aaaaaaaa-0000-0000-0000-000000000001','t-saloes','Salões','venue');
insert into locations (id, level, slug, name)
  values ('bbbbbbbb-0000-0000-0000-000000000001','province','t-luanda','Luanda');
insert into providers (id, owner_id, supplier_type, slug, name, category_id, location_id,
                       verification_status, is_published) values
 ('cccccccc-0000-0000-0000-00000000000a','11111111-1111-1111-1111-111111111111','venue',
  't-salao-a','Salão A','aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','verified',true),
 ('cccccccc-0000-0000-0000-00000000000b','44444444-4444-4444-4444-444444444444','venue',
  't-salao-b','Salão B','aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','pending',false);
insert into resources (id, provider_id, name) values
 ('dddddddd-0000-0000-0000-00000000000a','cccccccc-0000-0000-0000-00000000000a','Salão'),
 ('dddddddd-0000-0000-0000-00000000000b','cccccccc-0000-0000-0000-00000000000b','Salão');
insert into amenities (id, slug, name, is_active) values
 ('ffffffff-0000-0000-0000-000000000001','t-gerador','Gerador', true),
 ('ffffffff-0000-0000-0000-000000000002','t-retirada','Retirada', false);
insert into resource_amenities (resource_id, amenity_id) values
 ('dddddddd-0000-0000-0000-00000000000a','ffffffff-0000-0000-0000-000000000001'),
 ('dddddddd-0000-0000-0000-00000000000b','ffffffff-0000-0000-0000-000000000001');

set role app_user;

-- ---- 1. a visitor sees the public space's amenities, not the pending one's
select tests_logout();
do $$
declare v_n int; v_r int;
begin
  select count(*) into v_n from resource_amenities;
  if v_n <> 1 then raise exception 'FAIL: anon sees % resource amenities, expected 1', v_n; end if;
  select count(*) into v_r from amenities where slug like 't-%';
  if v_r <> 1 then raise exception 'FAIL: anon sees % test amenities, expected only the active one', v_r; end if;
  raise notice 'PASS: visitors see amenities of public spaces only, and only active amenities';
end $$;

-- ---- 2. a visitor cannot write ------------------------------------
do $$
begin
  begin
    insert into amenities (slug, name) values ('t-intruso', 'Intruso');
    raise exception 'FAIL: anon created an amenity';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: visitors cannot create amenities';
end $$;

-- ---- 3. owner B sees their own (unpublished) space's amenities, and
--         cannot tick one on supplier A's space ------------------------
select tests_login_as('44444444-4444-4444-4444-444444444444');
do $$
declare v_n int;
begin
  select count(*) into v_n from resource_amenities where resource_id = 'dddddddd-0000-0000-0000-00000000000b';
  if v_n <> 1 then raise exception 'FAIL: owner B sees % of their own amenities', v_n; end if;
  begin
    insert into resource_amenities (resource_id, amenity_id)
      values ('dddddddd-0000-0000-0000-00000000000a', 'ffffffff-0000-0000-0000-000000000002');
    raise exception 'FAIL: owner B ticked an amenity on supplier A''s space';
  exception when insufficient_privilege then null;
  end;
  delete from resource_amenities where resource_id = 'dddddddd-0000-0000-0000-00000000000a';
  if found then raise exception 'FAIL: owner B removed supplier A''s amenity'; end if;
  raise notice 'PASS: an owner cannot change another supplier''s amenities';
end $$;

-- ---- 4. owner A cannot tick a retired amenity, and cannot create one
select tests_login_as('11111111-1111-1111-1111-111111111111');
do $$
begin
  begin
    insert into resource_amenities (resource_id, amenity_id)
      values ('dddddddd-0000-0000-0000-00000000000a', 'ffffffff-0000-0000-0000-000000000002');
    raise exception 'FAIL: a retired amenity was ticked';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into amenities (slug, name) values ('t-meu', 'Meu');
    raise exception 'FAIL: a supplier created an amenity';
  exception when insufficient_privilege then null;
  end;
  delete from resource_amenities where resource_id = 'dddddddd-0000-0000-0000-00000000000a';
  if not found then raise exception 'FAIL: owner A could not untick their own amenity'; end if;
  raise notice 'PASS: owners tick and untick only active amenities on their own spaces';
end $$;

-- ---- 5. an admin manages the list ---------------------------------
select tests_login_as('99999999-9999-9999-9999-999999999999');
do $$
declare v_r int;
begin
  insert into amenities (slug, name) values ('t-piscina', 'Piscina');
  select count(*) into v_r from amenities where slug like 't-%';
  if v_r <> 3 then raise exception 'FAIL: admin sees % test amenities, expected 3 incl. retired', v_r; end if;
  raise notice 'PASS: administrators create amenities and see retired ones';
end $$;

reset role;
rollback;
