-- =====================================================================
-- 0027 — quote requests: price inquiries that fan out to matching
-- suppliers as a request for quotation (slice 20)
--
-- A client describes what they need once; every verified, published
-- supplier whose own category and location fall within the request's
-- chosen trees is notified and may respond with a priced offer. NGUEZA
-- brokers neither the conversation nor the payment — same as booking
-- contact today (§28). See spec/slices/20-quote-requests.md.
-- =====================================================================

create table quote_requests (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references profiles(id) on delete restrict,
  category_id  uuid not null references categories(id) on delete restrict,
  location_id  uuid not null references locations(id) on delete restrict,
  event_date   date,
  capacity     integer check (capacity > 0),
  description  text not null check (char_length(description) between 10 and 2000),
  status       text not null default 'open'
                 check (status in ('open', 'closed', 'expired')),
  created_at   timestamptz not null default now(),
  -- Two weeks to collect offers — long enough to compare a few, short
  -- enough that a supplier reading it can trust the need is still live.
  expires_at   timestamptz not null default (now() + interval '14 days'),
  closed_at    timestamptz
);

create index quote_requests_client_idx on quote_requests (client_id, created_at desc);
create index quote_requests_open_idx   on quote_requests (category_id, location_id)
  where status = 'open';

alter table quote_requests enable row level security;

create table quote_offers (
  id                uuid primary key default gen_random_uuid(),
  quote_request_id  uuid not null references quote_requests(id) on delete cascade,
  provider_id       uuid not null references providers(id) on delete restrict,
  price_minor       bigint not null check (price_minor > 0),
  message           text check (char_length(message) <= 1000),
  status            text not null default 'submitted'
                      check (status in ('submitted', 'withdrawn')),
  created_at        timestamptz not null default now()
);

create index quote_offers_request_idx  on quote_offers (quote_request_id, created_at);
create index quote_offers_provider_idx on quote_offers (provider_id, created_at desc);

-- At most one *live* offer per supplier per request — withdraw and
-- re-offer is allowed (a supplier changing their mind about price),
-- two simultaneously standing offers from the same supplier is not.
create unique index quote_offers_one_live_per_provider
  on quote_offers (quote_request_id, provider_id) where status = 'submitted';

alter table quote_offers enable row level security;

-- ---------------------------------------------------------------------
-- quote_requests and quote_offers each need to read the other in their
-- own RLS policies (does this supplier's offer exist? is this request
-- still open?). A plain correlated subquery across the two would
-- re-evaluate the OTHER table's RLS policies, which read back into this
-- one — Postgres detects that as infinite recursion, not a slow query.
-- SECURITY DEFINER breaks the cycle the same way owns_provider() (0005)
-- already does for providers: called FROM a policy, it reads as its
-- owner rather than re-entering RLS on the table it queries.
-- ---------------------------------------------------------------------
create or replace function owns_quote_request(p_quote_request_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from quote_requests where id = p_quote_request_id and client_id = auth.uid()
  );
$$;

create or replace function has_offered_on_quote_request(p_quote_request_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from quote_offers qo
     where qo.quote_request_id = p_quote_request_id and owns_provider(qo.provider_id)
  );
$$;

-- Is this quote request open, and does this provider match it (verified,
-- published, category and location within its trees)? Used both by the
-- offer-insert check below and reused as-is for offers, so "matches" is
-- defined in exactly one place.
create or replace function quote_request_open_and_matches(p_quote_request_id uuid, p_provider_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from quote_requests qr, providers p
     where qr.id = p_quote_request_id
       and p.id = p_provider_id
       and qr.status = 'open'
       and p.is_published and p.verification_status = 'verified'
       and p.category_id in (select id from category_descendants(qr.category_id))
       and p.location_id in (select id from location_descendants(qr.location_id))
  );
$$;

-- ---------------------------------------------------------------------
-- RLS — quote_requests
--
-- The matching bar is exactly what /procurar already holds suppliers
-- to (lib/search.ts): verified, published, and their own category/
-- location fall within the request's chosen trees via the same
-- category_descendants/location_descendants helpers (0003) search uses.
-- A supplier who already offered keeps visibility even after the
-- request closes or their own provider falls out of match — that offer
-- is their own record, not a live search result.
-- ---------------------------------------------------------------------
create policy quote_requests_owner_read on quote_requests
  for select using (client_id = auth.uid() or is_admin());

create policy quote_requests_matching_supplier_read on quote_requests
  for select using (
    has_offered_on_quote_request(id)
    or (
      status = 'open'
      and exists (
        select 1 from providers p
         where p.owner_id = auth.uid()
           and p.is_published and p.verification_status = 'verified'
           and p.category_id in (select id from category_descendants(quote_requests.category_id))
           and p.location_id in (select id from location_descendants(quote_requests.location_id))
      )
    )
  );

create policy quote_requests_owner_insert on quote_requests
  for insert with check (client_id = auth.uid());

create policy quote_requests_owner_update on quote_requests
  for update using (client_id = auth.uid() or is_admin())
  with check (client_id = auth.uid() or is_admin());

-- A request is immutable except for closing it — suppliers who already
-- read and offered on it are relying on what they read. Mirrors
-- profiles_guard_role / providers_guard_verification (0011).
create or replace function quote_requests_guard_immutable()
returns trigger language plpgsql as $$
begin
  if is_admin() then
    return new;
  end if;
  if (
    new.client_id   is distinct from old.client_id or
    new.category_id is distinct from old.category_id or
    new.location_id is distinct from old.location_id or
    new.event_date  is distinct from old.event_date or
    new.capacity    is distinct from old.capacity or
    new.description is distinct from old.description or
    new.created_at  is distinct from old.created_at or
    new.expires_at  is distinct from old.expires_at or
    (old.status = 'closed' and new.status is distinct from old.status)
  ) then
    raise exception 'a quote request may only be closed, not edited'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

create trigger quote_requests_guard_immutable
  before update on quote_requests
  for each row execute function quote_requests_guard_immutable();

-- ---------------------------------------------------------------------
-- RLS — quote_offers
-- ---------------------------------------------------------------------
create policy quote_offers_supplier_read on quote_offers
  for select using (owns_provider(provider_id));

create policy quote_offers_requester_read on quote_offers
  for select using (owns_quote_request(quote_request_id));

create policy quote_offers_admin_read on quote_offers
  for select using (is_admin());

create policy quote_offers_supplier_insert on quote_offers
  for insert with check (
    owns_provider(provider_id)
    and quote_request_open_and_matches(quote_request_id, provider_id)
  );

create policy quote_offers_supplier_withdraw on quote_offers
  for update using (owns_provider(provider_id))
  with check (owns_provider(provider_id));

create or replace function quote_offers_guard_withdraw_only()
returns trigger language plpgsql as $$
begin
  if is_admin() then
    return new;
  end if;
  if (
    new.quote_request_id is distinct from old.quote_request_id or
    new.provider_id      is distinct from old.provider_id or
    new.price_minor      is distinct from old.price_minor or
    new.message           is distinct from old.message or
    new.created_at        is distinct from old.created_at or
    new.status <> 'withdrawn' or old.status <> 'submitted'
  ) then
    raise exception 'an offer may only be withdrawn, not edited'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

create trigger quote_offers_guard_withdraw_only
  before update on quote_offers
  for each row execute function quote_offers_guard_withdraw_only();

-- ---------------------------------------------------------------------
-- notification_outbox (0019) — extended for fan-out and in-app reads
-- ---------------------------------------------------------------------

-- 0019's source_id is bigint, sized for booking_events/audit_log's
-- identity columns. quote_requests/quote_offers use uuid ids like every
-- other domain entity in this schema — widen to text rather than force
-- either side to a different id type. source_id is never read back
-- anywhere in lib/notifications.ts, only compared for the idempotency
-- key below, so this is a safe, silent-to-callers change.
alter table notification_outbox alter column source_id type text using source_id::text;

-- 0019's unique constraint, (source_table, source_id, kind), assumed
-- exactly one recipient per triggering row. A quote request fans out to
-- many matching suppliers at once, so the constraint needs recipient_id
-- to still do its job: de-duplicating a retried trigger, not collapsing
-- distinct recipients into one row.
alter table notification_outbox drop constraint notification_outbox_source_table_source_id_kind_key;
alter table notification_outbox add constraint notification_outbox_source_kind_recipient_key
  unique (source_table, source_id, kind, recipient_id);

alter table notification_outbox drop constraint notification_outbox_kind_check;
alter table notification_outbox add constraint notification_outbox_kind_check
  check (kind in (
    'booking_requested', 'booking_accepted', 'booking_awaiting_payment',
    'booking_confirmed', 'booking_confirmed_provider', 'booking_rejected',
    'booking_expired', 'booking_cancelled_client', 'booking_cancelled_provider',
    'booking_completed', 'booking_no_show',
    'provider_verified', 'provider_rejected', 'provider_suspended', 'provider_reinstated',
    'quote_request_new', 'quote_offer_received'
  ));

-- Widening the constraint above means 0019's two trigger functions'
-- own ON CONFLICT targets (source_table, source_id, kind) no longer
-- name an existing constraint at all — ON CONFLICT must match one
-- exactly, and a 3-column target does not match a 4-column unique
-- index. Re-declared here with recipient_id added to each target;
-- everything else is byte-for-byte 0019's bodies. Never edit 0019
-- itself — this is a new statement in a new file, same as any other
-- function evolving behavior in this schema.
create or replace function enqueue_booking_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking      bookings%rowtype;
  v_provider     providers%rowtype;
  v_owner_email  citext;
  v_client_email citext;
  v_kind         text;
  v_to           citext;
  v_recipient    uuid;
  v_context      jsonb;
begin
  select * into v_booking  from bookings  where id = new.booking_id;
  select * into v_provider from providers where id = v_booking.provider_id;
  select email into v_owner_email from profiles where id = v_provider.owner_id;
  if v_booking.client_id is not null then
    select email into v_client_email from profiles where id = v_booking.client_id;
  end if;

  v_context := jsonb_build_object(
    'booking_id',    v_booking.id,
    'provider_id',   v_provider.id,
    'provider_name', v_provider.name,
    'provider_slug', v_provider.slug,
    'starts_at',     v_booking.starts_at,
    'ends_at',       v_booking.ends_at,
    'from_status',   new.from_status
  );

  if new.to_status = 'confirmed' then
    if v_client_email is not null then
      insert into notification_outbox
        (kind, to_email, recipient_id, context, source_table, source_id)
      values
        ('booking_confirmed', v_client_email, v_booking.client_id, v_context,
         'booking_events', new.id)
      on conflict (source_table, source_id, kind, recipient_id) do nothing;
    end if;
    if v_owner_email is not null then
      insert into notification_outbox
        (kind, to_email, recipient_id, context, source_table, source_id)
      values
        ('booking_confirmed_provider', v_owner_email, v_provider.owner_id, v_context,
         'booking_events', new.id)
      on conflict (source_table, source_id, kind, recipient_id) do nothing;
    end if;
    return null;
  end if;

  case new.to_status
    when 'requested'           then v_kind := 'booking_requested';          v_to := v_owner_email;  v_recipient := v_provider.owner_id;
    when 'accepted'             then v_kind := 'booking_accepted';           v_to := v_client_email; v_recipient := v_booking.client_id;
    when 'awaiting_payment'     then v_kind := 'booking_awaiting_payment';   v_to := v_client_email; v_recipient := v_booking.client_id;
    when 'rejected'             then v_kind := 'booking_rejected';          v_to := v_client_email; v_recipient := v_booking.client_id;
    when 'expired'              then v_kind := 'booking_expired';           v_to := v_client_email; v_recipient := v_booking.client_id;
    when 'cancelled_client'     then v_kind := 'booking_cancelled_client';  v_to := v_owner_email;  v_recipient := v_provider.owner_id;
    when 'cancelled_provider'   then v_kind := 'booking_cancelled_provider';v_to := v_client_email; v_recipient := v_booking.client_id;
    when 'completed'            then v_kind := 'booking_completed';         v_to := v_client_email; v_recipient := v_booking.client_id;
    when 'no_show'              then v_kind := 'booking_no_show';           v_to := v_owner_email;  v_recipient := v_provider.owner_id;
    else return null; -- 'blocked': the supplier's own action, nobody to tell
  end case;

  if v_to is null then
    return null; -- e.g. a manually-blocked booking has no client to notify
  end if;

  insert into notification_outbox (kind, to_email, recipient_id, context, source_table, source_id)
  values (v_kind, v_to, v_recipient, v_context, 'booking_events', new.id)
  on conflict (source_table, source_id, kind, recipient_id) do nothing;

  return null;
end $$;

create or replace function enqueue_provider_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id     uuid;
  v_owner_email  citext;
  v_provider_name text;
  v_provider_slug text;
  v_new_status   text := new.after  ->> 'verification_status';
  v_old_status   text := new.before ->> 'verification_status';
  v_kind         text;
begin
  if new.target_type <> 'provider' or v_new_status is null then
    return null;
  end if;

  select owner_id, name, slug into v_owner_id, v_provider_name, v_provider_slug
    from providers where id = new.target_id;
  if v_owner_id is null then
    return null;
  end if;
  select email into v_owner_email from profiles where id = v_owner_id;
  if v_owner_email is null then
    return null; -- the owner's account was erased since; nobody to tell
  end if;

  v_kind := case
    when v_new_status = 'verified'  and v_old_status = 'suspended' then 'provider_reinstated'
    when v_new_status = 'verified'  then 'provider_verified'
    when v_new_status = 'rejected'  then 'provider_rejected'
    when v_new_status = 'suspended' then 'provider_suspended'
    else null -- 'pending': the supplier already knows, they just submitted
  end;
  if v_kind is null then
    return null;
  end if;

  insert into notification_outbox (kind, to_email, recipient_id, context, source_table, source_id)
  values (
    v_kind, v_owner_email, v_owner_id,
    jsonb_build_object(
      'provider_id', new.target_id, 'provider_name', v_provider_name,
      'provider_slug', v_provider_slug, 'reason', new.after ->> 'rejection_reason'
    ),
    'audit_log', new.id
  )
  on conflict (source_table, source_id, kind, recipient_id) do nothing;

  return null;
end $$;

-- Previously admin-only ("the recipient... has no reason to read their
-- own delivery metadata back" — true until this slice gave them one: an
-- in-webapp notification list). read_at is nullable and starts unset.
alter table notification_outbox add column read_at timestamptz;

create policy notification_outbox_recipient_read on notification_outbox
  for select using (recipient_id = auth.uid());

create policy notification_outbox_recipient_mark_read on notification_outbox
  for update using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

-- 0019 revoked UPDATE on this table from authenticated entirely (only
-- service_role sent notifications, nothing else touched the row). This
-- slice is the first thing besides service_role that legitimately
-- updates a row here, so the grant that revoke took away has to come
-- back — RLS alone does not restore a table-level privilege.
grant update on notification_outbox to authenticated;

-- claimAndSend (lib/notifications.ts) updates status/attempts/sent_at
-- as service_role, which bypasses RLS but NOT triggers — current_user
-- is checked directly rather than is_admin()/auth.uid(), which are both
-- meaningless under service_role (no JWT claims are set for it).
--
-- profiles.id -> recipient_id is ON DELETE SET NULL (erasure, §37).
-- Postgres runs that foreign-key action's own UPDATE as the table
-- OWNER, not as whatever role issued the DELETE — verified directly:
-- current_user inside this trigger reads as the owner during that
-- cascade, never 'service_role', in every environment, not only this
-- one. current_user can't tell that case apart from an arbitrary
-- UPDATE, so it is allowed by shape instead: recipient_id changing,
-- and only to null, and nothing else about the row. RLS's own with
-- check (recipient_id = auth.uid()) independently refuses a client
-- trying to exploit this path — a null recipient_id never equals
-- their own auth.uid().
create or replace function notification_outbox_guard_read_only()
returns trigger language plpgsql as $$
declare
  v_rest_unchanged boolean;
begin
  if current_user = 'service_role' or is_admin() then
    return new;
  end if;

  v_rest_unchanged := (
    new.kind         is not distinct from old.kind and
    new.to_email      is not distinct from old.to_email and
    new.context       is not distinct from old.context and
    new.source_table  is not distinct from old.source_table and
    new.source_id     is not distinct from old.source_id and
    new.status        is not distinct from old.status and
    new.attempts      is not distinct from old.attempts and
    new.last_error    is not distinct from old.last_error and
    new.created_at    is not distinct from old.created_at and
    new.sent_at       is not distinct from old.sent_at
  );

  if v_rest_unchanged and new.recipient_id is not distinct from old.recipient_id then
    return new; -- a recipient marking read_at, nothing else
  end if;
  if v_rest_unchanged and old.recipient_id is not null and new.recipient_id is null then
    return new; -- the ON DELETE SET NULL erasure cascade, see above
  end if;

  raise exception 'a recipient may only mark their own notification read'
    using errcode = 'insufficient_privilege';
end $$;

create trigger notification_outbox_guard_read_only
  before update on notification_outbox
  for each row execute function notification_outbox_guard_read_only();

-- ---------------------------------------------------------------------
-- Fan-out: a new open request notifies every matching, verified,
-- published provider owner. Capped at 50 matches — the same "a batch
-- has a ceiling" idiom claimAndSend's own default limit already uses
-- (lib/notifications.ts) — so one broad request (a whole province, a
-- shallow category) cannot enqueue an unbounded burst of email. See
-- spec/slices/20-quote-requests.md for why this cap, not a digest, is
-- the v1 answer.
-- ---------------------------------------------------------------------
create or replace function enqueue_quote_request_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into notification_outbox
    (kind, to_email, recipient_id, context, source_table, source_id)
  select
    'quote_request_new',
    pr.email,
    p.owner_id,
    jsonb_build_object(
      'quote_request_id', new.id,
      'category_name', (select name from categories where id = new.category_id),
      'location_name', (select name from locations where id = new.location_id),
      'event_date', new.event_date,
      'capacity', new.capacity,
      'description', left(new.description, 280)
    ),
    'quote_requests', new.id::text
  from providers p
  join profiles pr on pr.id = p.owner_id
  where p.is_published and p.verification_status = 'verified'
    and p.category_id in (select id from category_descendants(new.category_id))
    and p.location_id in (select id from location_descendants(new.location_id))
  order by p.created_at
  limit 50
  on conflict (source_table, source_id, kind, recipient_id) do nothing;
  return null;
end $$;

create trigger quote_requests_notify
  after insert on quote_requests
  for each row execute function enqueue_quote_request_notification();

-- ---------------------------------------------------------------------
-- An offer notifies the requester who posted the request.
-- ---------------------------------------------------------------------
create or replace function enqueue_quote_offer_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id    uuid;
  v_client_email citext;
  v_provider_name text;
  v_provider_slug text;
begin
  select qr.client_id, pf.email into v_client_id, v_client_email
    from quote_requests qr join profiles pf on pf.id = qr.client_id
   where qr.id = new.quote_request_id;
  select name, slug into v_provider_name, v_provider_slug
    from providers where id = new.provider_id;

  if v_client_email is null then
    return null; -- the requester's account was erased since; nobody to tell
  end if;

  insert into notification_outbox
    (kind, to_email, recipient_id, context, source_table, source_id)
  values (
    'quote_offer_received', v_client_email, v_client_id,
    jsonb_build_object(
      'quote_request_id', new.quote_request_id,
      'offer_id', new.id,
      'provider_name', v_provider_name,
      'provider_slug', v_provider_slug,
      'price_minor', new.price_minor,
      'message', new.message
    ),
    'quote_offers', new.id::text
  )
  on conflict (source_table, source_id, kind, recipient_id) do nothing;
  return null;
end $$;

create trigger quote_offers_notify
  after insert on quote_offers
  for each row execute function enqueue_quote_offer_notification();
