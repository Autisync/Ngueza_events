-- =====================================================================
-- Multi-category matching (slice 22 / migration 0028) — a provider
-- matches a category through its own category_id OR any active
-- service's, for quote-request visibility and offering both.
-- =====================================================================
\set ON_ERROR_STOP on
begin;

create role app_user nologin;
grant usage on schema public, auth to app_user;
grant select, insert, update on all tables in schema public to app_user;
grant execute on all functions in schema public, auth to app_user;

select tests_user('11113000-0000-0000-0000-000000000001', 'salao.dono@mc.ao', 'provider');
select tests_user('22113000-0000-0000-0000-000000000001', 'requester@mc.ao',  'client');

insert into categories (id, slug, name, default_supplier_type) values
  ('aaaa3000-0000-0000-0000-000000000001', 'mc-saloes', 'Salões (mc)', 'venue'),
  ('aaaa3000-0000-0000-0000-000000000002', 'mc-fotografia', 'Fotografia (mc)', 'service');
insert into locations (id, level, slug, name) values
  ('bbbb3000-0000-0000-0000-000000000001', 'province', 'mc-luanda', 'Luanda (mc)');

-- Registered as a salão (venue), but also lists a photography service —
-- category_id alone would never match a fotografia request.
insert into providers (id, owner_id, supplier_type, slug, name, category_id, location_id,
                       verification_status, is_published) values
 ('cccc3000-0000-0000-0000-00000000000a', '11113000-0000-0000-0000-000000000001', 'venue',
  'mc-salao-multi', 'Salão Multi', 'aaaa3000-0000-0000-0000-000000000001',
  'bbbb3000-0000-0000-0000-000000000001', 'verified', true);

insert into services (provider_id, category_id, name, price_mode, price_minor, price_unit, is_active)
values ('cccc3000-0000-0000-0000-00000000000a', 'aaaa3000-0000-0000-0000-000000000002',
        'Fotografia do evento', 'exact', 9500000, 'event', true);

set role app_user;

-- ---- a fotografia request matches the salão through its service ------
select tests_login_as('22113000-0000-0000-0000-000000000001');
do $$
declare v_id uuid;
begin
  insert into quote_requests (client_id, category_id, location_id, description)
  values ('22113000-0000-0000-0000-000000000001', 'aaaa3000-0000-0000-0000-000000000002',
          'bbbb3000-0000-0000-0000-000000000001', 'Preciso de um fotógrafo para o casamento')
  returning id into v_id;
  if v_id is null then raise exception 'FAIL: request insert returned no id'; end if;
  raise notice 'PASS: a fotografia request was posted';
end $$;

select tests_login_as('11113000-0000-0000-0000-000000000001');
do $$
declare v_n int;
begin
  select count(*) into v_n from quote_requests;
  if v_n <> 1 then
    raise exception 'FAIL: a venue with a matching SERVICE sees % fotografia requests, expected 1', v_n;
  end if;
  raise notice 'PASS: a provider matches a category through a service, not only its own category_id';
end $$;

do $$
declare v_offer_id uuid;
begin
  insert into quote_offers (quote_request_id, provider_id, price_minor)
  select id, 'cccc3000-0000-0000-0000-00000000000a', 9500000 from quote_requests limit 1
  returning id into v_offer_id;
  if v_offer_id is null then raise exception 'FAIL: offer insert returned no id'; end if;
  raise notice 'PASS: that provider can also offer on it';
end $$;

do $$
declare v_n int;
begin
  select count(*) into v_n from notification_outbox
   where kind = 'quote_request_new' and recipient_id = '11113000-0000-0000-0000-000000000001';
  if v_n <> 1 then
    raise exception 'FAIL: the matching-through-a-service owner got % notifications, expected 1', v_n;
  end if;
  raise notice 'PASS: the fan-out notified the owner matched through a service too';
end $$;

reset role;
rollback;
