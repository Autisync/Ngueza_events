-- =====================================================================
-- 0018 — the audit trail §38 actually asked for
--
-- booking_events covers bookings. §38 also names "when a supplier changed
-- a price" and "when an account was suspended", and neither was recorded
-- anywhere. Slice 12 makes that urgent: an administrator is about to
-- start making decisions on identity documents and suspending accounts,
-- and those are precisely the actions that get disputed later.
--
-- Written by triggers rather than by application code, for the same
-- reason booking_events is: a call site can be forgotten, and the one
-- that gets forgotten is the one somebody later needs.
-- =====================================================================

create table audit_log (
  id          bigint generated always as identity primary key,
  -- ON DELETE SET NULL, deliberately. §38 wants to know who did a thing;
  -- §37 requires that a person can be erased. Those collide for anyone
  -- who ever acted. Setting null keeps WHAT changed and WHEN — the part
  -- that resolves a dispute — while letting the person go. Without this
  -- the reference would make everyone who ever touched anything
  -- permanently undeletable, which is a stricter promise than §37 allows.
  actor_id    uuid references profiles(id) on delete set null,
  target_type text not null check (target_type in
                ('provider', 'document', 'profile', 'service', 'report')),
  target_id   uuid not null,
  before      jsonb not null default '{}',
  after       jsonb not null default '{}',
  note        text,
  created_at  timestamptz not null default now()
);

create index audit_log_target_idx on audit_log (target_type, target_id, created_at desc);
create index audit_log_actor_idx  on audit_log (actor_id, created_at desc)
  where actor_id is not null;
create index audit_log_time_idx   on audit_log (created_at desc);

alter table audit_log enable row level security;

-- Administrators read it. Nothing writes it but the trigger below.
create policy audit_log_admin_read on audit_log
  for select using (is_admin());

revoke insert, update, delete on audit_log from anon, authenticated;

-- Append-only, with one precise exception.
--
-- A blanket ban on UPDATE also blocks the ON DELETE SET NULL above,
-- because detaching an erased actor IS an update — so erasing a person
-- would fail with "audit_log is append-only", which reads like a bug and
-- is really two requirements colliding.
--
-- So: nothing may be rewritten, and nothing may be deleted, except
-- setting actor_id to null while every other column stays identical.
-- That is exactly what §37 erasure needs and nothing more.
create or replace function audit_log_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'audit_log is append-only' using errcode = 'check_violation';
  end if;

  if new.actor_id is null
     and old.actor_id is not null
     and (to_jsonb(new) - 'actor_id') = (to_jsonb(old) - 'actor_id') then
    return new;
  end if;

  raise exception 'audit_log cannot be rewritten' using errcode = 'check_violation';
end $$;

create trigger audit_log_append_only
  before update or delete on audit_log
  for each row execute function audit_log_guard();

-- ---------------------------------------------------------------------
-- Records only the columns it is told to watch, and only when they
-- actually change. Dumping whole rows would put identity-document keys
-- and personal data into a table many administrators can read.
-- ---------------------------------------------------------------------
create or replace function audit_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target text := tg_argv[0];
  v_col    text;
  v_old    jsonb := to_jsonb(old);
  v_new    jsonb := to_jsonb(new);
  v_before jsonb := '{}';
  v_after  jsonb := '{}';
begin
  for i in 1 .. (array_length(tg_argv, 1) - 1) loop
    v_col := tg_argv[i];
    if v_old -> v_col is distinct from v_new -> v_col then
      v_before := v_before || jsonb_build_object(v_col, v_old -> v_col);
      v_after  := v_after  || jsonb_build_object(v_col, v_new -> v_col);
    end if;
  end loop;

  if v_after = '{}'::jsonb then
    return null;
  end if;

  insert into audit_log (actor_id, target_type, target_id, before, after)
  values (auth.uid(), v_target, new.id, v_before, v_after);
  return null;
end $$;

-- §25 decisions, and whether a listing is visible at all.
create trigger providers_audit
  after update on providers
  for each row execute function audit_changes(
    'provider', 'verification_status', 'is_published', 'rejection_reason');

-- §38: "when a supplier changed a certain price".
create trigger services_audit
  after update on services
  for each row execute function audit_changes(
    'service', 'price_mode', 'price_minor', 'price_max_minor', 'is_active');

-- §38: "when an account was suspended".
create trigger profiles_audit
  after update on profiles
  for each row execute function audit_changes('profile', 'status', 'role');

-- Who accepted or rejected which document.
create trigger provider_documents_audit
  after update on provider_documents
  for each row execute function audit_changes('document', 'status', 'review_note');

comment on table audit_log is
  'Append-only. Written by triggers only, so a forgotten call site cannot leave a gap.';

-- ---------------------------------------------------------------------
-- The same reasoning applied to the other "who decided this" columns.
-- They were written without an ON DELETE clause, which defaults to NO
-- ACTION and quietly pins the profile forever.
-- ---------------------------------------------------------------------
alter table providers          drop constraint if exists providers_verified_by_fkey;
alter table providers          add  constraint providers_verified_by_fkey
  foreign key (verified_by) references profiles(id) on delete set null;

alter table provider_documents drop constraint if exists provider_documents_reviewed_by_fkey;
alter table provider_documents add  constraint provider_documents_reviewed_by_fkey
  foreign key (reviewed_by) references profiles(id) on delete set null;

alter table reports            drop constraint if exists reports_resolved_by_fkey;
alter table reports            add  constraint reports_resolved_by_fkey
  foreign key (resolved_by) references profiles(id) on delete set null;

alter table booking_events     drop constraint if exists booking_events_actor_id_fkey;
alter table booking_events     add  constraint booking_events_actor_id_fkey
  foreign key (actor_id) references profiles(id) on delete set null;

alter table refunds            drop constraint if exists refunds_processed_by_fkey;
alter table refunds            add  constraint refunds_processed_by_fkey
  foreign key (processed_by) references profiles(id) on delete set null;

alter table payments           drop constraint if exists payments_confirmed_by_fkey;
alter table payments           add  constraint payments_confirmed_by_fkey
  foreign key (confirmed_by) references profiles(id) on delete set null;
