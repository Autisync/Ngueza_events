-- =====================================================================
-- 0046 — the event planner (slice 50)
--
-- A client plans an event in NGUEZA: what kind of event, when, for how
-- many people, with what budget, and the list of what it needs (a place,
-- food, music, photographs), each with an estimate and what it actually
-- cost. NGUEZA moves no money: "actual cost" is what the client says.
--
-- Event types, and the needs each one suggests, are rows that
-- administrators manage at runtime. This is the same rule as categories
-- (CLAUDE.md), and for the same reason: a cleaning or tutoring
-- marketplace plans different things. The starting lists are reference
-- data (seed/reference/01_event_types.sql), loaded after the taxonomy so
-- their category links resolve.
--
-- A plan is private to the person who made it. Not even an administrator
-- reads it: nothing in running the platform needs a client's budget.
-- =====================================================================

-- ---- 1. what kinds of event there are, and what each usually needs ----
create table event_types (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name         text not null check (char_length(name) between 2 and 60),        -- pt-AO
  description  text check (description is null or char_length(description) <= 200),
  sort_order   integer not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

create table event_type_needs (
  id               uuid primary key default gen_random_uuid(),
  event_type_id    uuid not null references event_types(id) on delete cascade,
  name             text not null check (char_length(name) between 2 and 80),     -- pt-AO
  -- Where to find it on NGUEZA. Optional: a wedding dress is a need, not
  -- a category we list.
  category_id      uuid references categories(id) on delete set null,
  -- The typical share of the budget, in basis points (3000 = 30 %).
  -- Integers, so a suggested estimate is integer arithmetic on cêntimos.
  budget_share_bp  integer not null default 0 check (budget_share_bp between 0 and 10000),
  -- How long before the date it should be booked.
  weeks_before     integer not null default 0 check (weeks_before between 0 and 104),
  sort_order       integer not null default 0,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  unique (event_type_id, name)
);

create index event_type_needs_type_idx on event_type_needs (event_type_id, sort_order);

-- ---- 2. a client's plan, and its lines ---------------------------------
create table event_plans (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null default auth.uid() references profiles(id) on delete cascade,
  event_type_id  uuid not null references event_types(id) on delete restrict,
  title          text not null check (char_length(btrim(title)) between 2 and 120),
  event_date     date,
  guest_count    integer check (guest_count between 1 and 100000),
  location_id    uuid references locations(id) on delete set null,
  budget_minor   bigint check (budget_minor >= 0),          -- cêntimos, never a float
  notes          text check (notes is null or char_length(notes) <= 2000),
  archived_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index event_plans_owner_idx on event_plans (owner_id, event_date);

create table event_plan_items (
  id              uuid primary key default gen_random_uuid(),
  plan_id         uuid not null references event_plans(id) on delete cascade,
  name            text not null check (char_length(btrim(name)) between 2 and 80),
  category_id     uuid references categories(id) on delete set null,
  -- A personal checklist, not a governed state machine: any step to any.
  status          text not null default 'todo' check (status in ('todo', 'doing', 'done')),
  estimate_minor  bigint check (estimate_minor >= 0),
  actual_minor    bigint check (actual_minor >= 0),
  due_date        date,
  booking_id      uuid references bookings(id) on delete set null,
  notes           text check (notes is null or char_length(notes) <= 500),
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index event_plan_items_plan_idx on event_plan_items (plan_id, sort_order);
create index event_plan_items_booking_idx on event_plan_items (booking_id) where booking_id is not null;

create trigger event_plans_updated_at
  before update on event_plans
  for each row execute function set_updated_at();
create trigger event_plan_items_updated_at
  before update on event_plan_items
  for each row execute function set_updated_at();

-- ---- 3. guards ---------------------------------------------------------
-- INVOKER throughout: each one reads only what the caller can already see.

-- A plan keeps its owner. RLS refuses handing it to someone else; this
-- also covers a service-role connection.
create or replace function event_plans_guard()
returns trigger language plpgsql as $$
begin
  if new.owner_id is distinct from old.owner_id or new.created_at is distinct from old.created_at then
    raise exception 'a plan keeps its owner'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

create trigger event_plans_guard
  before update on event_plans
  for each row execute function event_plans_guard();

-- At most 30 active plans per person. Generous for anyone planning, and a
-- ceiling for a script.
create or replace function event_plans_cap()
returns trigger language plpgsql as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('event_plans:' || new.owner_id::text, 0));
  if (select count(*) from event_plans
       where owner_id = new.owner_id and archived_at is null) >= 30 then
    raise exception 'active plan limit reached'
      using errcode = 'check_violation', constraint = 'event_plans_limit';
  end if;
  return new;
end $$;

create trigger event_plans_00_cap
  before insert on event_plans
  for each row execute function event_plans_cap();

-- A line stays in its plan, links only its owner's own bookings, and a
-- plan holds at most 60 lines.
create or replace function event_plan_items_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.plan_id is distinct from old.plan_id then
    raise exception 'a line stays in its plan'
      using errcode = 'insufficient_privilege';
  end if;

  if new.booking_id is not null
     and (tg_op = 'INSERT' or new.booking_id is distinct from old.booking_id) then
    if not exists (
      select 1 from bookings b
        join event_plans p on p.id = new.plan_id
       where b.id = new.booking_id and b.client_id = p.owner_id
    ) then
      raise exception 'a plan links only its owner''s own bookings'
        using errcode = 'check_violation', constraint = 'event_plan_items_own_booking';
    end if;
  end if;

  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtextextended('event_plan_items:' || new.plan_id::text, 0));
    if (select count(*) from event_plan_items where plan_id = new.plan_id) >= 60 then
      raise exception 'line limit reached for this plan'
        using errcode = 'check_violation', constraint = 'event_plan_items_limit';
    end if;
  end if;
  return new;
end $$;

create trigger event_plan_items_guard
  before insert or update on event_plan_items
  for each row execute function event_plan_items_guard();

-- ---- 4. row-level security ----------------------------------------------
alter table event_types      enable row level security;
alter table event_type_needs enable row level security;
alter table event_plans      enable row level security;
alter table event_plan_items enable row level security;

-- The lists are public while active (the "new plan" form reads them);
-- administrators see retired rows too, and are the only writers.
create policy event_types_read on event_types
  for select using (is_active or is_admin());
create policy event_types_admin_write on event_types
  for all using (is_admin()) with check (is_admin());

create policy event_type_needs_read on event_type_needs
  for select using (
    is_admin() or (
      is_active and exists (select 1 from event_types t
                             where t.id = event_type_needs.event_type_id and t.is_active)
    )
  );
create policy event_type_needs_admin_write on event_type_needs
  for all using (is_admin()) with check (is_admin());

-- A plan is its owner's, and nobody else's: no admin clause, on purpose.
create policy event_plans_owner_read on event_plans
  for select using (owner_id = auth.uid());
-- A new plan needs a type that is still offered; an old one keeps working
-- after its type is retired, hence a separate insert policy.
create policy event_plans_owner_insert on event_plans
  for insert with check (
    owner_id = auth.uid()
    and exists (select 1 from event_types t where t.id = event_plans.event_type_id and t.is_active)
  );
create policy event_plans_owner_update on event_plans
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
-- Plans are archived, never deleted (no delete policy).
revoke delete on event_plans from anon, authenticated;

create policy event_plan_items_owner on event_plan_items
  for all using (
    exists (select 1 from event_plans p
             where p.id = event_plan_items.plan_id and p.owner_id = auth.uid())
  ) with check (
    exists (select 1 from event_plans p
             where p.id = event_plan_items.plan_id and p.owner_id = auth.uid())
  );

-- Visitors write nothing here, and read no plan at all.
revoke insert, update, delete on event_types, event_type_needs from anon;
revoke all on event_plans, event_plan_items from anon;
