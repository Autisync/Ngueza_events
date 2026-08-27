-- =====================================================================
-- 0010 — row-level security (§36)
--
-- Tenant isolation lives here, not in application code. A table without
-- policies is an incomplete slice. Every policy below has a matching
-- assertion in tests/sql/ — security stops being a code-review opinion
-- and becomes a failing build.
-- =====================================================================

alter table profiles                 enable row level security;
alter table categories               enable row level security;
alter table locations                enable row level security;
alter table providers                enable row level security;
alter table resources                enable row level security;
alter table services                 enable row level security;
alter table media                    enable row level security;
alter table bookings                 enable row level security;
alter table booking_events           enable row level security;
alter table reviews                  enable row level security;
alter table reports                  enable row level security;
alter table cancellation_policies    enable row level security;
alter table payments                 enable row level security;
alter table payment_events           enable row level security;
alter table refunds                  enable row level security;
alter table newsletter_subscribers   enable row level security;
alter table newsletter_consent_events enable row level security;
alter table events                   enable row level security;

-- ---------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------
create policy profiles_self_read on profiles
  for select using (id = auth.uid() or is_admin());

create policy profiles_self_update on profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

create policy profiles_admin_all on profiles
  for all using (is_admin()) with check (is_admin());

-- Role escalation must not be self-service.
create or replace function profiles_guard_role()
returns trigger language plpgsql as $$
begin
  if new.role is distinct from old.role and not is_admin() then
    raise exception 'only an administrator may change a role'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

create trigger profiles_guard_role
  before update on profiles
  for each row execute function profiles_guard_role();

-- ---------------------------------------------------------------------
-- taxonomy — world-readable, admin-writable (§44)
-- ---------------------------------------------------------------------
create policy categories_public_read on categories
  for select using (is_active or is_admin());
create policy categories_admin_write on categories
  for all using (is_admin()) with check (is_admin());

create policy locations_public_read on locations
  for select using (is_active or is_admin());
create policy locations_admin_write on locations
  for all using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------
-- providers — anonymous visitors see published, verified suppliers only
-- ---------------------------------------------------------------------
create policy providers_public_read on providers
  for select using (
    (is_published and verification_status = 'verified')
    or owner_id = auth.uid()
    or is_admin()
  );

create policy providers_owner_insert on providers
  for insert with check (owner_id = auth.uid());

create policy providers_owner_update on providers
  for update using (owner_id = auth.uid() or is_admin())
  with check (owner_id = auth.uid() or is_admin());

create policy providers_admin_delete on providers
  for delete using (is_admin());

-- Verification state is an administrator's decision (§25), never the
-- supplier's own.
create or replace function providers_guard_verification()
returns trigger language plpgsql as $$
begin
  if new.verification_status is distinct from old.verification_status
     and not is_admin() then
    raise exception 'only an administrator may change verification_status'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

create trigger providers_guard_verification
  before update on providers
  for each row execute function providers_guard_verification();

-- ---------------------------------------------------------------------
-- provider-owned content
-- ---------------------------------------------------------------------
create policy resources_public_read on resources
  for select using (
    is_active and exists (
      select 1 from providers p
      where p.id = resources.provider_id
        and p.is_published and p.verification_status = 'verified'
    )
    or owns_provider(resources.provider_id) or is_admin()
  );
create policy resources_owner_write on resources
  for all using (owns_provider(provider_id) or is_admin())
  with check (owns_provider(provider_id) or is_admin());

create policy services_public_read on services
  for select using (
    is_active and exists (
      select 1 from providers p
      where p.id = services.provider_id
        and p.is_published and p.verification_status = 'verified'
    )
    or owns_provider(services.provider_id) or is_admin()
  );
create policy services_owner_write on services
  for all using (owns_provider(provider_id) or is_admin())
  with check (owns_provider(provider_id) or is_admin());

create policy media_public_read on media
  for select using (
    exists (
      select 1 from providers p
      where p.id = media.provider_id
        and p.is_published and p.verification_status = 'verified'
    )
    or owns_provider(media.provider_id) or is_admin()
  );
create policy media_owner_write on media
  for all using (owns_provider(provider_id) or is_admin())
  with check (owns_provider(provider_id) or is_admin());

-- ---------------------------------------------------------------------
-- bookings — visible to the two parties and to administrators, nobody else
-- ---------------------------------------------------------------------
create policy bookings_party_read on bookings
  for select using (
    client_id = auth.uid() or owns_provider(provider_id) or is_admin()
  );

create policy bookings_client_insert on bookings
  for insert with check (
    (client_id = auth.uid() and status = 'requested')
    or (owns_provider(provider_id) and status = 'blocked')   -- §27 manual block
    or is_admin()
  );

create policy bookings_party_update on bookings
  for update using (
    client_id = auth.uid() or owns_provider(provider_id) or is_admin()
  ) with check (
    client_id = auth.uid() or owns_provider(provider_id) or is_admin()
  );

-- Bookings are never deleted; they reach a terminal state. No DELETE policy.

create policy booking_events_party_read on booking_events
  for select using (
    exists (
      select 1 from bookings b
      where b.id = booking_events.booking_id
        and (b.client_id = auth.uid() or owns_provider(b.provider_id) or is_admin())
    )
  );
-- No INSERT policy: the audit trail is written by a SECURITY DEFINER
-- trigger and by nothing else.

-- ---------------------------------------------------------------------
-- reviews and reports
-- ---------------------------------------------------------------------
create policy reviews_public_read on reviews
  for select using (status = 'published' or author_id = auth.uid() or is_admin());

create policy reviews_author_insert on reviews
  for insert with check (author_id = auth.uid());

create policy reviews_author_update on reviews
  for update using (author_id = auth.uid() or is_admin())
  with check (author_id = auth.uid() or is_admin());

-- A supplier may write only their own reply, never the rating or comment.
create or replace function reviews_guard_reply()
returns trigger language plpgsql as $$
begin
  if owns_provider(new.provider_id) and not is_admin()
     and new.author_id is distinct from auth.uid() then
    if new.rating_overall is distinct from old.rating_overall
       or new.comment is distinct from old.comment
       or new.status is distinct from old.status then
      raise exception 'a supplier may only add a reply to a review'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end $$;

create trigger reviews_guard_reply
  before update on reviews
  for each row execute function reviews_guard_reply();

create policy reports_insert_any on reports
  for insert with check (true);                    -- §30: anyone may report
create policy reports_admin_read on reports
  for select using (is_admin() or reporter_id = auth.uid());
create policy reports_admin_write on reports
  for update using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------
-- money — read-only to the parties, written server-side only
-- ---------------------------------------------------------------------
create policy policies_public_read on cancellation_policies
  for select using (is_active or owns_provider(provider_id) or is_admin());
create policy policies_owner_write on cancellation_policies
  for all using (owns_provider(provider_id) or is_admin())
  with check (owns_provider(provider_id) or is_admin());

create policy payments_party_read on payments
  for select using (
    exists (
      select 1 from bookings b
      where b.id = payments.booking_id
        and (b.client_id = auth.uid() or owns_provider(b.provider_id) or is_admin())
    )
  );
create policy payments_admin_write on payments
  for all using (is_admin()) with check (is_admin());

create policy refunds_admin_all on refunds
  for all using (is_admin()) with check (is_admin());

-- payment_events has no policy at all: webhooks are handled server-side
-- with the service role. Nothing reachable from a browser touches it.

-- ---------------------------------------------------------------------
-- newsletter — anyone may subscribe, nobody may read the list
-- ---------------------------------------------------------------------
create policy newsletter_public_subscribe on newsletter_subscribers
  for insert with check (status = 'pending');

create policy newsletter_admin_read on newsletter_subscribers
  for select using (is_admin() or profile_id = auth.uid());

create policy newsletter_admin_write on newsletter_subscribers
  for update using (is_admin()) with check (is_admin());
-- Confirm and unsubscribe run server-side against a signed token, not
-- through a browser session — so no token-based policy is needed here.

create policy newsletter_consent_admin_read on newsletter_consent_events
  for select using (is_admin());
create policy newsletter_consent_insert on newsletter_consent_events
  for insert with check (true);

-- ---------------------------------------------------------------------
-- analytics — write-only from the browser, readable by administrators
-- ---------------------------------------------------------------------
create policy events_public_insert on events
  for insert with check (true);
create policy events_admin_read on events
  for select using (is_admin());
