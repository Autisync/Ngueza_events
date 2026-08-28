#!/usr/bin/env bash
# =====================================================================
# Prove a deployed database behaves like the tested one.
#
# Everything runs inside a single transaction that is ROLLED BACK, so it
# is safe against a live project: no rows, roles or sequences survive.
# Run after any migration deploy.
#
#   set -a; source .env.local; set +a; ./scripts/verify-remote.sh
# =====================================================================
set -uo pipefail
: "${DATABASE_URL:?DATABASE_URL must be set}"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
begin;

-- ---- structure --------------------------------------------------------
do $$
declare v_missing text;
begin
  select string_agg(c.relname, ', ') into v_missing
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if v_missing is not null then
    raise exception 'FAIL: tables without RLS: %', v_missing;
  end if;
  raise notice 'PASS: row-level security is on for every table';
end $$;

do $$
begin
  if to_regclass('public.bookings') is null
     or not exists (select 1 from pg_constraint where conname = 'bookings_no_double_booking') then
    raise exception 'FAIL: the double-booking constraint is missing';
  end if;
  raise notice 'PASS: the double-booking constraint exists';
end $$;

-- ---- fixtures ---------------------------------------------------------
-- Identities come from auth.users only: migration 0016's trigger creates
-- the profile, and the role travels in raw_app_meta_data. Inserting into
-- profiles as well would collide with the trigger's row — which is
-- exactly how this script broke the first time 0016 was deployed.
insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data) values
  ('00000000-dead-0000-0000-000000000001','verify.dono@ngueza.invalid',now(),
   '{"app_role":"provider"}'),
  ('00000000-dead-0000-0000-000000000002','verify.ana@ngueza.invalid',now(),
   '{"app_role":"client"}')
on conflict do nothing;

do $$
declare v_role text;
begin
  select role into v_role from profiles where id = '00000000-dead-0000-0000-000000000001';
  if v_role is distinct from 'provider' then
    raise exception 'FAIL: the provisioning trigger did not run (role=%)', v_role;
  end if;
  raise notice 'PASS: a profile is provisioned for every identity, with its role';
end $$;

insert into providers (id, owner_id, supplier_type, slug, name, category_id, location_id,
                       verification_status, is_published)
select '00000000-dead-0000-0000-00000000000a','00000000-dead-0000-0000-000000000001','venue',
       'verify-salao','Verify Salão', c.id, l.id, 'verified', true
  from categories c, locations l
 where c.slug = 'saloes-de-festas' and l.slug = 'talatona';

insert into resources (id, provider_id, name, capacity)
values ('00000000-dead-0000-0000-00000000000b','00000000-dead-0000-0000-00000000000a','Salão',100);

insert into bookings (provider_id, client_id, resource_id, status, starts_at, ends_at)
values ('00000000-dead-0000-0000-00000000000a','00000000-dead-0000-0000-000000000002',
        '00000000-dead-0000-0000-00000000000b','confirmed',
        '2030-01-10 10:00+01','2030-01-10 23:00+01');

-- ---- the guarantee ----------------------------------------------------
do $$
begin
  insert into bookings (provider_id, client_id, resource_id, status, starts_at, ends_at)
  values ('00000000-dead-0000-0000-00000000000a','00000000-dead-0000-0000-000000000002',
          '00000000-dead-0000-0000-00000000000b','confirmed',
          '2030-01-10 18:00+01','2030-01-11 02:00+01');
  raise exception 'FAIL: the database accepted a double booking';
exception
  when exclusion_violation then
    raise notice 'PASS: overlapping venue booking refused';
end $$;

-- ---- what an anonymous visitor can see --------------------------------
set local role anon;
select set_config('request.jwt.claims', '', true);

do $$
declare v_bookings int; v_free boolean; v_providers int;
begin
  select count(*) into v_bookings from bookings;
  if v_bookings <> 0 then raise exception 'FAIL: anon read % bookings', v_bookings; end if;

  select resource_is_free('00000000-dead-0000-0000-00000000000b',
                          '2030-01-10 00:00+01','2030-01-10 23:59+01') into v_free;
  if v_free then raise exception 'FAIL: availability lied — occupied date reported free'; end if;
  raise notice 'PASS: anon reads no bookings and still gets truthful availability';

  select count(*) into v_providers from providers where slug = 'verify-salao';
  if v_providers <> 1 then raise exception 'FAIL: published supplier not visible to anon'; end if;
  raise notice 'PASS: anon sees the published, verified supplier';
end $$;

do $$
declare v_n int;
begin
  insert into newsletter_subscribers (email, status, source)
  values ('verify@ngueza.invalid','pending','waitlist');
  select count(*) into v_n from newsletter_subscribers;
  if v_n <> 0 then raise exception 'FAIL: anon read % newsletter rows', v_n; end if;
  raise notice 'PASS: anon can join the waitlist but cannot read it';
end $$;

reset role;

-- ---- a supplier's right of reply (0022, slice 11) ----------------------
-- reviews_guard_reply()'s whole branch was dead code until 0022: the only
-- UPDATE policy on reviews required author_id = auth.uid() or is_admin(),
-- so a supplier who was neither never reached the trigger that was meant
-- to let them reply. Asserted here so a future migration cannot regress
-- it silently, the same way the double-booking constraint above is.
insert into bookings (provider_id, client_id, resource_id, status, starts_at, ends_at)
values ('00000000-dead-0000-0000-00000000000a','00000000-dead-0000-0000-000000000002',
        '00000000-dead-0000-0000-00000000000b','completed',
        '2025-01-10 10:00+01','2025-01-10 23:00+01')
returning id as review_booking_id \gset

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub','00000000-dead-0000-0000-000000000002','role','authenticated')::text, true);
insert into reviews (id, provider_id, author_id, booking_id, rating_overall)
values ('00000000-dead-0000-0000-00000000000e','00000000-dead-0000-0000-00000000000a',
        '00000000-dead-0000-0000-000000000002', :'review_booking_id', 5);

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub','00000000-dead-0000-0000-000000000001','role','authenticated')::text, true);

do $$
begin
  update reviews set provider_reply = 'Obrigado!'
   where id = '00000000-dead-0000-0000-00000000000e';
  if not found then
    raise exception 'FAIL: the business owner could not reply to their own review';
  end if;
  raise notice 'PASS: a supplier can reply to a review on their own business';
end $$;

do $$
begin
  update reviews set provider_reply = 'x', rating_overall = 1
   where id = '00000000-dead-0000-0000-00000000000e';
  raise exception 'FAIL: a supplier rewrote the rating while replying';
exception
  when insufficient_privilege then
    raise notice 'PASS: a supplier still cannot rewrite the rating while replying';
end $$;

reset role;
rollback;
SQL
