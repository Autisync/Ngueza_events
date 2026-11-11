-- =====================================================================
-- 0039 — kill switches (slice 37, review C004)
--
-- In an incident — a scam wave, a payment dispute spreading, a bug that
-- double-books — the team needs to stop the bleeding in seconds, not in
-- a deploy. Two switches, flipped from /admin:
--
--   bookings_paused  no new booking requests. Enforced HERE, on insert,
--                    so a form left open in a tab cannot slip one in.
--                    Existing bookings keep moving through their states.
--   signups_paused   no new accounts (the sign-up action checks it).
--
-- Both carry a message shown to the public while on. Every flip is in
-- the audit trail, attributed to the administrator who made it.
-- =====================================================================

create table platform_switches (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique check (key in ('bookings_paused', 'signups_paused')),
  is_on       boolean not null default false,
  message     text check (message is null or char_length(message) <= 300),
  updated_at  timestamptz not null default now()
);

insert into platform_switches (key) values ('bookings_paused'), ('signups_paused');

alter table platform_switches enable row level security;
-- The public reads them: the site shows the notice to everyone.
create policy platform_switches_public_read on platform_switches for select using (true);
create policy platform_switches_admin_update on platform_switches
  for update using (is_admin()) with check (is_admin());
grant select on platform_switches to anon, authenticated;
revoke insert, delete on platform_switches from anon, authenticated;

create trigger platform_switches_updated_at
  before update on platform_switches
  for each row execute function set_updated_at();

alter table audit_log drop constraint audit_log_target_type_check;
alter table audit_log add constraint audit_log_target_type_check
  check (target_type in ('provider', 'document', 'profile', 'service', 'report', 'payment', 'switch'));

create trigger platform_switches_audit
  after update on platform_switches
  for each row execute function audit_changes('switch', 'is_on', 'message');

-- ---- enforcement: no new requests while paused ------------------------
create or replace function bookings_guard_paused()
returns trigger language plpgsql as $$
begin
  if new.status = 'requested'
     and exists (select 1 from platform_switches where key = 'bookings_paused' and is_on) then
    raise exception 'new bookings are paused'
      using errcode = 'object_not_in_prerequisite_state';   -- 55000
  end if;
  return new;
end $$;

-- A supplier's manual block ('blocked') is not a request and still works:
-- it is how they keep their calendar true during the pause.
create trigger bookings_guard_paused
  before insert on bookings
  for each row execute function bookings_guard_paused();
