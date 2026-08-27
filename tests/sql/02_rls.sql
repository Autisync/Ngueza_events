-- =====================================================================
-- Row-level security (§36). Tenant isolation is asserted here, not
-- assumed in review.
-- =====================================================================
\set ON_ERROR_STOP on
begin;

-- Policies do not apply to the table owner, so run as a plain role.
create role app_user nologin;
grant usage on schema public, auth to app_user;
grant select, insert, update on all tables in schema public to app_user;
grant execute on all functions in schema public, auth to app_user;

select tests_user('11111111-1111-1111-1111-111111111111', 'dono.a@x.ao', 'provider');
select tests_user('44444444-4444-4444-4444-444444444444', 'dono.b@x.ao', 'provider');
select tests_user('22222222-2222-2222-2222-222222222222', 'ana@x.ao',    'client');
select tests_user('99999999-9999-9999-9999-999999999999', 'admin@x.ao',  'admin');

insert into categories (id, slug, name, default_supplier_type)
  values ('aaaaaaaa-0000-0000-0000-000000000001','t-saloes','Salões','venue');
insert into locations (id, level, slug, name)
  values ('bbbbbbbb-0000-0000-0000-000000000001','province','t-luanda','Luanda');

-- Provider A: verified and published. Provider B: still pending.
insert into providers (id, owner_id, supplier_type, slug, name, category_id, location_id,
                       verification_status, is_published) values
 ('cccccccc-0000-0000-0000-00000000000a','11111111-1111-1111-1111-111111111111','venue',
  't-salao-a','Salão A','aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','verified',true),
 ('cccccccc-0000-0000-0000-00000000000b','44444444-4444-4444-4444-444444444444','venue',
  't-salao-b','Salão B','aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','pending',false);

insert into resources (id, provider_id, name) values
 ('dddddddd-0000-0000-0000-00000000000a','cccccccc-0000-0000-0000-00000000000a','Salão'),
 ('dddddddd-0000-0000-0000-00000000000b','cccccccc-0000-0000-0000-00000000000b','Salão');

insert into bookings (id, provider_id, client_id, resource_id, status, starts_at, ends_at) values
 ('eeeeeeee-0000-0000-0000-00000000000a','cccccccc-0000-0000-0000-00000000000a',
  '22222222-2222-2222-2222-222222222222','dddddddd-0000-0000-0000-00000000000a',
  'confirmed','2026-12-20 10:00+01','2026-12-20 22:00+01'),
 ('eeeeeeee-0000-0000-0000-00000000000b','cccccccc-0000-0000-0000-00000000000b',
  '22222222-2222-2222-2222-222222222222','dddddddd-0000-0000-0000-00000000000b',
  'confirmed','2026-12-21 10:00+01','2026-12-21 22:00+01');

set role app_user;

-- ---- 1. anonymous sees only verified, published suppliers -----------
select tests_logout();
do $$
declare v_n int;
begin
  select count(*) into v_n from providers;
  if v_n <> 1 then raise exception 'FAIL: anon sees % providers, expected 1', v_n; end if;
  raise notice 'PASS: anonymous sees only the verified, published supplier';
end $$;

-- ---- 2. anonymous cannot read any booking ---------------------------
do $$
declare v_n int;
begin
  select count(*) into v_n from bookings;
  if v_n <> 0 then raise exception 'FAIL: anon sees % bookings', v_n; end if;
  raise notice 'PASS: anonymous sees no bookings';
end $$;

-- ---- 3. supplier A cannot read supplier B's bookings ----------------
select tests_login_as('11111111-1111-1111-1111-111111111111');
do $$
declare v_n int;
begin
  select count(*) into v_n from bookings;
  if v_n <> 1 then raise exception 'FAIL: supplier A sees % bookings, expected 1', v_n; end if;
  perform 1 from bookings where id = 'eeeeeeee-0000-0000-0000-00000000000b';
  if found then raise exception 'FAIL: supplier A read supplier B''s booking'; end if;
  raise notice 'PASS: supplier A sees only their own booking';
end $$;

-- ---- 4. a supplier cannot verify themselves (§25) -------------------
-- Supplier B owns a listing still in 'pending'. This is the actual
-- attack: promote your own listing to 'verified' and become publishable.
select tests_login_as('44444444-4444-4444-4444-444444444444');
do $$
begin
  update providers set verification_status = 'verified'
   where id = 'cccccccc-0000-0000-0000-00000000000b';
  raise exception 'FAIL: supplier self-verified a pending listing';
exception
  when insufficient_privilege then
    raise notice 'PASS: verification_status is administrator-only';
end $$;

-- ---- 4b. nor publish an unverified listing --------------------------
do $$
begin
  update providers set is_published = true
   where id = 'cccccccc-0000-0000-0000-00000000000b';
  raise exception 'FAIL: unverified listing was published';
exception
  when check_violation then
    raise notice 'PASS: an unverified listing cannot be published';
end $$;

-- ---- 5. a client cannot promote themselves to admin -----------------
select tests_login_as('22222222-2222-2222-2222-222222222222');
do $$
begin
  update profiles set role = 'admin' where id = '22222222-2222-2222-2222-222222222222';
  raise exception 'FAIL: client escalated to admin';
exception
  when insufficient_privilege then
    raise notice 'PASS: role escalation refused';
end $$;

-- ---- 6. the client sees their own booking, on both suppliers --------
do $$
declare v_n int;
begin
  select count(*) into v_n from bookings;
  if v_n <> 2 then raise exception 'FAIL: client sees % of their 2 bookings', v_n; end if;
  raise notice 'PASS: client sees both of their own bookings';
end $$;

-- ---- 7. nobody but an admin reads the newsletter list ---------------
reset role;
insert into newsletter_subscribers (email, status, source)
  values ('interessado@x.ao', 'pending', 'waitlist');
set role app_user;
select tests_login_as('22222222-2222-2222-2222-222222222222');
do $$
declare v_n int;
begin
  select count(*) into v_n from newsletter_subscribers;
  if v_n <> 0 then raise exception 'FAIL: a client read % newsletter rows', v_n; end if;
  raise notice 'PASS: the newsletter list is not readable by clients';
end $$;

-- ---- 7b. and anonymous visitors cannot read it either ---------------
select tests_logout();
do $$
declare v_n int;
begin
  select count(*) into v_n from newsletter_subscribers;
  if v_n <> 0 then raise exception 'FAIL: anon read % newsletter rows', v_n; end if;
  raise notice 'PASS: the newsletter list is not readable by anonymous visitors';
end $$;

-- ---- 8. but anyone may subscribe (the waitlist must work logged-out) --
select tests_logout();
insert into newsletter_subscribers (email, status, source)
  values ('anonimo@x.ao', 'pending', 'waitlist');
do $$ begin raise notice 'PASS: anonymous visitors can join the waitlist'; end $$;

-- ---- 8b. the verification guard holds even with no session ----------
-- A direct database connection has no auth.uid(), so is_admin() is false
-- and the trigger refuses. Verification cannot be granted by connecting
-- to the database and issuing an UPDATE — it has to go through an
-- authenticated administrator, which is what leaves an audit trail.
reset role;
do $$
begin
  update providers set verification_status = 'verified'
   where id = 'cccccccc-0000-0000-0000-00000000000b';
  raise exception 'FAIL: verification granted from a session-less connection';
exception
  when insufficient_privilege then
    raise notice 'PASS: verification needs an authenticated administrator, not just database access';
end $$;
set role app_user;

-- ---- 8c. a user cannot register themselves as an administrator ------
-- The 0016 trigger reads the role from raw_APP_meta_data, which only the
-- service role can write. raw_user_meta_data is whatever the person typed
-- into the signup form, so trusting it would be an escalation.
reset role;
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
values ('77777777-7777-7777-7777-777777777777', 'esperto@x.ao',
        '{"role":"admin","app_role":"admin","full_name":"Esperto"}', '{}');

do $$
declare v_role text;
begin
  select role into v_role from profiles where id = '77777777-7777-7777-7777-777777777777';
  if v_role <> 'client' then
    raise exception 'FAIL: signup metadata granted role %', v_role;
  end if;
  raise notice 'PASS: signup metadata cannot grant a role';
end $$;
set role app_user;

-- ---- 9. an admin sees everything ------------------------------------
select tests_login_as('99999999-9999-9999-9999-999999999999');
do $$
declare v_p int; v_b int; v_n int;
begin
  select count(*) into v_p from providers;
  select count(*) into v_b from bookings;
  select count(*) into v_n from newsletter_subscribers;
  if v_p <> 2 or v_b <> 2 or v_n <> 2 then
    raise exception 'FAIL: admin sees %/2 providers, %/2 bookings, %/2 subscribers', v_p, v_b, v_n;
  end if;
  raise notice 'PASS: administrator sees all rows';
end $$;

reset role;
rollback;
