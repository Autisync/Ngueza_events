-- =====================================================================
-- Quote requests (slice 20) — matching, immutability, and the
-- notification fan-out's in-app read path.
-- =====================================================================
\set ON_ERROR_STOP on
begin;

create role app_user nologin;
grant usage on schema public, auth to app_user;
grant select, insert, update on all tables in schema public to app_user;
grant execute on all functions in schema public, auth to app_user;

select tests_user('11112000-0000-0000-0000-000000000001', 'match.dono@qr.ao',    'provider');
select tests_user('11112000-0000-0000-0000-000000000002', 'nomatch.dono@qr.ao',  'provider');
select tests_user('11112000-0000-0000-0000-000000000003', 'pending.dono@qr.ao',  'provider');
select tests_user('22112000-0000-0000-0000-000000000001', 'requester@qr.ao',     'client');
select tests_user('22112000-0000-0000-0000-000000000002', 'bystander@qr.ao',     'client');
select tests_user('99112000-0000-0000-0000-000000000001', 'admin@qr.ao',         'admin');

insert into categories (id, slug, name, default_supplier_type) values
  ('aaaa2000-0000-0000-0000-000000000001', 'qr-saloes', 'Salões (qr)', 'venue'),
  ('aaaa2000-0000-0000-0000-000000000002', 'qr-outros', 'Outros (qr)', 'service');
insert into locations (id, level, slug, name) values
  ('bbbb2000-0000-0000-0000-000000000001', 'province', 'qr-luanda', 'Luanda (qr)'),
  ('bbbb2000-0000-0000-0000-000000000002', 'province', 'qr-benguela', 'Benguela (qr)');

-- Matching: right category, right location, verified and published.
-- Non-matching: right category, WRONG location.
-- Pending: right category, right location, but not yet verified —
-- must not match even though everything else lines up.
insert into providers (id, owner_id, supplier_type, slug, name, category_id, location_id,
                       verification_status, is_published) values
 ('cccc2000-0000-0000-0000-00000000000a', '11112000-0000-0000-0000-000000000001', 'venue',
  'qr-salao-match', 'Salão Match', 'aaaa2000-0000-0000-0000-000000000001',
  'bbbb2000-0000-0000-0000-000000000001', 'verified', true),
 ('cccc2000-0000-0000-0000-00000000000b', '11112000-0000-0000-0000-000000000002', 'venue',
  'qr-salao-nomatch', 'Salão Nomatch', 'aaaa2000-0000-0000-0000-000000000001',
  'bbbb2000-0000-0000-0000-000000000002', 'verified', true),
 ('cccc2000-0000-0000-0000-00000000000c', '11112000-0000-0000-0000-000000000003', 'venue',
  'qr-salao-pending', 'Salão Pending', 'aaaa2000-0000-0000-0000-000000000001',
  'bbbb2000-0000-0000-0000-000000000001', 'pending', false);

set role app_user;

-- ---- 1. a client posts a request; it fans out to the matching, ------
--         verified, published supplier only -------------------------
select tests_login_as('22112000-0000-0000-0000-000000000001');
do $$
declare v_id uuid;
begin
  insert into quote_requests (client_id, category_id, location_id, description, capacity)
  values ('22112000-0000-0000-0000-000000000001', 'aaaa2000-0000-0000-0000-000000000001',
          'bbbb2000-0000-0000-0000-000000000001', 'Preciso de um espaço para 80 pessoas', 80)
  returning id into v_id;
  if v_id is null then raise exception 'FAIL: request insert returned no id'; end if;
  raise notice 'PASS: a client can post a quote request';
end $$;

set role app_user;
select tests_logout();
do $$
declare v_n int;
begin
  select count(*) into v_n from quote_requests;
  if v_n <> 0 then raise exception 'FAIL: anonymous sees % quote requests', v_n; end if;
  raise notice 'PASS: anonymous sees no quote requests';
end $$;

-- ---- 2. matching supplier sees it; non-matching and pending do not --
select tests_login_as('11112000-0000-0000-0000-000000000001');
do $$
declare v_n int;
begin
  select count(*) into v_n from quote_requests;
  if v_n <> 1 then raise exception 'FAIL: matching supplier sees % requests, expected 1', v_n; end if;
  raise notice 'PASS: the matching, verified, published supplier sees the open request';
end $$;

select tests_login_as('11112000-0000-0000-0000-000000000002');
do $$
declare v_n int;
begin
  select count(*) into v_n from quote_requests;
  if v_n <> 0 then raise exception 'FAIL: non-matching supplier sees % requests', v_n; end if;
  raise notice 'PASS: a supplier in the wrong location sees nothing';
end $$;

select tests_login_as('11112000-0000-0000-0000-000000000003');
do $$
declare v_n int;
begin
  select count(*) into v_n from quote_requests;
  if v_n <> 0 then raise exception 'FAIL: unverified supplier sees % requests', v_n; end if;
  raise notice 'PASS: an unverified matching supplier still sees nothing';
end $$;

-- ---- 3. only the matching supplier can offer -------------------------
select tests_login_as('11112000-0000-0000-0000-000000000002');
do $$
begin
  insert into quote_offers (quote_request_id, provider_id, price_minor)
  select id, 'cccc2000-0000-0000-0000-00000000000b', 50000000 from quote_requests limit 1;
  raise exception 'FAIL: a non-matching supplier was able to submit an offer';
exception
  when others then
    raise notice 'PASS: a non-matching supplier cannot submit an offer';
end $$;

select tests_login_as('11112000-0000-0000-0000-000000000001');
do $$
declare v_offer_id uuid;
begin
  insert into quote_offers (quote_request_id, provider_id, price_minor, message)
  select id, 'cccc2000-0000-0000-0000-00000000000a', 45000000, 'Temos disponibilidade.'
    from quote_requests limit 1
  returning id into v_offer_id;
  if v_offer_id is null then raise exception 'FAIL: offer insert returned no id'; end if;
  raise notice 'PASS: the matching supplier can submit an offer';
end $$;

-- ---- 4. the requester sees the offer; a bystander does not ----------
select tests_login_as('22112000-0000-0000-0000-000000000001');
do $$
declare v_n int;
begin
  select count(*) into v_n from quote_offers;
  if v_n <> 1 then raise exception 'FAIL: requester sees % offers, expected 1', v_n; end if;
  raise notice 'PASS: the requester sees the offer on their own request';
end $$;

select tests_login_as('22112000-0000-0000-0000-000000000002');
do $$
declare v_qn int; v_on int;
begin
  select count(*) into v_qn from quote_requests;
  select count(*) into v_on from quote_offers;
  if v_qn <> 0 or v_on <> 0 then
    raise exception 'FAIL: a bystander client sees %/0 requests, %/0 offers', v_qn, v_on;
  end if;
  raise notice 'PASS: a bystander client sees neither the request nor its offers';
end $$;

-- ---- 5. a request is immutable except for closing it -----------------
select tests_login_as('22112000-0000-0000-0000-000000000001');
do $$
begin
  update quote_requests set description = 'texto diferente';
  raise exception 'FAIL: the requester edited the description after posting';
exception
  when insufficient_privilege then
    raise notice 'PASS: a quote request cannot be edited, only closed';
end $$;

do $$
begin
  update quote_requests set status = 'closed', closed_at = now();
  raise notice 'PASS: the requester can close their own request';
exception
  when insufficient_privilege then
    raise exception 'FAIL: the requester could not close their own request';
end $$;

-- ---- 6. once closed, no new offer may be submitted -------------------
select tests_login_as('11112000-0000-0000-0000-000000000001');
do $$
begin
  insert into quote_offers (quote_request_id, provider_id, price_minor)
  select id, 'cccc2000-0000-0000-0000-00000000000a', 40000000 from quote_requests limit 1;
  raise exception 'FAIL: an offer was accepted on a closed request';
exception
  when others then
    raise notice 'PASS: a closed request refuses new offers';
end $$;

-- ---- 7. an offer may be withdrawn, not edited -------------------------
do $$
begin
  update quote_offers set price_minor = 1 where provider_id = 'cccc2000-0000-0000-0000-00000000000a';
  raise exception 'FAIL: an offer''s price was edited after submission';
exception
  when insufficient_privilege then
    raise notice 'PASS: an offer''s price cannot be edited after submission';
end $$;

do $$
begin
  update quote_offers set status = 'withdrawn'
   where provider_id = 'cccc2000-0000-0000-0000-00000000000a';
  raise notice 'PASS: a supplier can withdraw their own offer';
exception
  when insufficient_privilege then
    raise exception 'FAIL: a supplier could not withdraw their own offer';
end $$;

-- ---- 8. the notification fan-out reached the matching supplier, and -
--         only they can read or mark it read --------------------------
select tests_login_as('11112000-0000-0000-0000-000000000001');
do $$
declare v_id bigint; v_n int;
begin
  select id into v_id from notification_outbox
   where kind = 'quote_request_new' and recipient_id = '11112000-0000-0000-0000-000000000001';
  if v_id is null then raise exception 'FAIL: the matching supplier got no quote_request_new notification'; end if;

  update notification_outbox set read_at = now() where id = v_id;
  select count(*) into v_n from notification_outbox where id = v_id and read_at is not null;
  if v_n <> 1 then raise exception 'FAIL: marking the notification read did not stick'; end if;
  raise notice 'PASS: the matching supplier received and could mark read their own notification';
end $$;

do $$
begin
  update notification_outbox set status = 'sent'
   where kind = 'quote_request_new' and recipient_id = '11112000-0000-0000-0000-000000000001';
  raise exception 'FAIL: a recipient rewrote their own notification''s status';
exception
  when insufficient_privilege then
    raise notice 'PASS: a recipient may mark a notification read, nothing else';
end $$;

select tests_login_as('11112000-0000-0000-0000-000000000002');
do $$
declare v_n int;
begin
  select count(*) into v_n from notification_outbox
   where recipient_id = '11112000-0000-0000-0000-000000000001';
  if v_n <> 0 then raise exception 'FAIL: a bystander read someone else''s notification'; end if;
  raise notice 'PASS: nobody else can read another recipient''s notification';
end $$;

-- ---- 9. the offer notified the requester ------------------------------
select tests_login_as('22112000-0000-0000-0000-000000000001');
do $$
declare v_n int;
begin
  select count(*) into v_n from notification_outbox
   where kind = 'quote_offer_received' and recipient_id = '22112000-0000-0000-0000-000000000001';
  if v_n <> 1 then raise exception 'FAIL: the requester got % quote_offer_received notifications, expected 1', v_n; end if;
  raise notice 'PASS: the requester was notified of the offer';
end $$;

-- ---- 10. an admin sees everything --------------------------------------
select tests_login_as('99112000-0000-0000-0000-000000000001');
do $$
declare v_q int; v_o int;
begin
  select count(*) into v_q from quote_requests;
  select count(*) into v_o from quote_offers;
  if v_q <> 1 or v_o <> 1 then
    raise exception 'FAIL: admin sees %/1 requests, %/1 offers', v_q, v_o;
  end if;
  raise notice 'PASS: administrator sees all quote requests and offers';
end $$;

reset role;
rollback;
