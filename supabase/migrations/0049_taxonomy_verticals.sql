-- =====================================================================
-- 0049 — taxonomy for more than events (slice 52)
--
-- The pivot opens NGUEZA to every kind of service. The tree was built
-- for that (categories are rows), but four things assumed one vertical:
--
--   1. "Pickable" was `parent_id is not null`, copied in five places. With
--      more than one root that offers grouping headings and hides nothing
--      under an inactive root. -> `is_assignable` and two views,
--      `category_paths` (every effectively active node, with its root and
--      a sort path) and `assignable_categories`.
--   2. A make-up artist belongs under Eventos and under Beleza. Moving the
--      row would drop them from every Eventos search and quote (0028).
--      -> `category_links`, read by one function, `category_scope()`,
--      which search, quote matching and the supplier read policy now all
--      use.
--   3. Nothing below the app refused a root, a retired category or a
--      heading as a listing's category: 0047 checked only that the row
--      itself was visible, services had no check at all, and a client
--      could open a quote request on any id. -> guards on providers,
--      services and quote_requests, all through `assignable_categories`
--      or `category_paths`.
--   4. Switching a whole vertical on is a business decision with no
--      record. -> categories are audited.
--
-- Data written here reaches only databases that already hold the rows
-- (live). A fresh database runs migrations before seeds, so the trigger
-- in step 1 is what marks `eventos` as a heading there.
-- =====================================================================

-- ---- 1. assignable or a heading --------------------------------------
alter table categories add column is_assignable boolean not null default true;

comment on column categories.is_assignable is
  'Whether a supplier, a service or a client request may use this category. '
  'False for vertical headings such as Eventos. A root becomes a heading '
  'automatically when it gets its first child (categories_root_heading).';

-- Today: the only root with children is `eventos`.
update categories c set is_assignable = false
 where c.parent_id is null
   and exists (select 1 from categories k where k.parent_id = c.id);

-- A root that gains a child is a vertical heading from then on. Only
-- roots: an intermediate node ("Limpeza" over "Limpeza industrial") can
-- reasonably keep listings of its own, and an administrator decides that
-- on the edit form.
create or replace function categories_root_heading()
returns trigger language plpgsql as $$
begin
  if new.parent_id is not null then
    update categories set is_assignable = false
     where id = new.parent_id and parent_id is null and is_assignable;
  end if;
  return null;
end $$;

create trigger categories_root_heading
  after insert or update of parent_id on categories
  for each row execute function categories_root_heading();

-- Icon keys name a drawing in app/CategoryIcon.tsx. Lower-case words and
-- hyphens only, so a key can never carry markup into the page.
alter table categories add constraint categories_icon_key
  check (icon is null or icon ~ '^[a-z][a-z0-9-]{0,39}$');

-- ---- 2. every node a visitor may see, with its vertical ---------------
-- `is_active` is checked on every step down from an active root, so a
-- leaf under a retired root is not here, even though RLS alone (which
-- looks only at the row's own flag) would show it. The explicit filter
-- also makes administrators see what visitors see.
--
-- security_invoker: the view applies the caller's RLS. A plain view runs
-- as its owner and bypasses it (0048, 0024).
create view category_paths with (security_invoker = true) as
with recursive t as (
  select c.id, c.parent_id, c.slug, c.name, c.icon,
         c.default_supplier_type, c.is_assignable, c.sort_order,
         c.id as root_id, c.slug as root_slug, c.name as root_name,
         c.sort_order as root_sort, 0 as depth,
         array[c.sort_order] as sort_path, array[c.name] as name_path,
         c.icon as resolved_icon
    from categories c
   where c.parent_id is null and c.is_active
  union all
  select c.id, c.parent_id, c.slug, c.name, c.icon,
         c.default_supplier_type, c.is_assignable, c.sort_order,
         t.root_id, t.root_slug, t.root_name, t.root_sort, t.depth + 1,
         t.sort_path || c.sort_order, t.name_path || c.name,
         coalesce(c.icon, t.resolved_icon)
    from categories c
    join t on c.parent_id = t.id
   where c.is_active and t.depth < 8       -- 0020 forbids cycles; this is a belt
)
select id, parent_id, slug, name, icon, resolved_icon, default_supplier_type,
       is_assignable, sort_order, root_id, root_slug, root_name, root_sort,
       depth, sort_path, name_path
  from t;

comment on view category_paths is
  'Every category whose whole ancestry is active, with its root (vertical), '
  'depth and a sort path. Order by root_sort, root_name, sort_path, name_path.';

create view assignable_categories with (security_invoker = true) as
  select * from category_paths where is_assignable;

comment on view assignable_categories is
  'What a supplier, a service or a request may pick. The one definition; '
  'pickers and guards read it instead of "parent_id is not null".';

revoke insert, update, delete on category_paths, assignable_categories from anon, authenticated;

-- ---- 3. cross-listing --------------------------------------------------
create table category_links (
  category_id   uuid not null references categories(id) on delete cascade,
  also_under_id uuid not null references categories(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (category_id, also_under_id),
  constraint category_links_not_self check (category_id <> also_under_id)
);

create index category_links_also_under_idx on category_links (also_under_id, category_id);

comment on table category_links is
  'Lists a category under a second parent as well as its own: maquilhagem '
  'stays under Eventos and also appears under Beleza. Read by category_scope().';

alter table category_links enable row level security;

-- A link is as visible as both of its ends (evaluated under the caller's
-- RLS on categories), so a retired vertical hides its links too.
create policy category_links_public_read on category_links
  for select using (
    exists (select 1 from categories c where c.id = category_links.category_id)
    and exists (select 1 from categories c where c.id = category_links.also_under_id)
  );

create policy category_links_admin_write on category_links
  for all using (is_admin()) with check (is_admin());

revoke insert, update, delete on category_links from anon;

-- A link that adds nothing, or that would put a category under its own
-- subtree. Both would duplicate results; the second reads as a loop.
create or replace function category_links_guard()
returns trigger language plpgsql as $$
begin
  if new.also_under_id in (select id from category_descendants(new.category_id))
     or new.category_id in (select id from category_descendants(new.also_under_id)) then
    raise exception 'category % is already in the tree of %', new.category_id, new.also_under_id
      using errcode = 'check_violation', constraint = 'category_links_redundant';
  end if;
  return new;
end $$;

create trigger category_links_guard
  before insert or update on category_links
  for each row execute function category_links_guard();

-- ---- 4. what a category covers: its subtree, plus what is linked in ---
-- `category_descendants` stays parent-only: the 0020 cycle guard depends
-- on that meaning. This is the one definition of "everything a search,
-- a quote request or a supply count on X should include".
--
-- UNION, not UNION ALL: it stops on any loop the links might form, the
-- hang 0020 was written about. Active nodes only, so SECURITY DEFINER
-- callers (quote matching) and RLS callers (search) agree.
create or replace function category_scope(root uuid)
returns table (id uuid) language sql stable rows 50 as $$
  with recursive tree(id) as (
    select c.id from categories c where c.id = root and c.is_active
    union
    select e.child_id
      from tree t
      join (
        select c.parent_id, c.id as child_id
          from categories c
         where c.is_active and c.parent_id is not null
        union all
        select l.also_under_id, l.category_id
          from category_links l
          join categories c on c.id = l.category_id and c.is_active
      ) e on e.parent_id = t.id
  )
  select id from tree;
$$;

comment on function category_scope(uuid) is
  'The category, its active descendants, and every active category linked '
  'under any of them (category_links), followed transitively.';

-- The icon a category shows: its own, or its nearest ancestor's. Parent
-- links only: a cross-listed leaf keeps the look of its home vertical.
create or replace function category_icon(p_id uuid)
returns text language sql stable as $$
  with recursive up as (
    select c.id, c.parent_id, c.icon, 0 as d from categories c where c.id = p_id
    union all
    select c.id, c.parent_id, c.icon, up.d + 1
      from categories c join up on c.id = up.parent_id
     where up.d < 8
  )
  select icon from up where icon is not null order by d limit 1;
$$;

-- ---- 5. matching reads the scope ---------------------------------------
-- Redefined from 0041 (keeps `not p.is_demo`); only the two category
-- lines change.
create or replace function quote_request_open_and_matches(p_quote_request_id uuid, p_provider_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from quote_requests qr, providers p
     where qr.id = p_quote_request_id
       and p.id = p_provider_id
       and qr.status = 'open'
       and qr.expires_at > now()
       and (qr.event_date is null or qr.event_date >= (now() at time zone 'Africa/Luanda')::date)
       and p.is_published and p.verification_status = 'verified'
       and not p.is_demo
       and p.location_id in (select id from location_descendants(qr.location_id))
       and (
         p.category_id in (select id from category_scope(qr.category_id))
         or exists (
           select 1 from services sv
            where sv.provider_id = p.id and sv.is_active
              and sv.category_id in (select id from category_scope(qr.category_id))
         )
       )
  );
$$;

-- Redefined from 0028; only the two category lines change.
drop policy quote_requests_matching_supplier_read on quote_requests;

create policy quote_requests_matching_supplier_read on quote_requests
  for select using (
    has_offered_on_quote_request(id)
    or (
      status = 'open'
      and exists (
        select 1 from providers p
         where p.owner_id = auth.uid()
           and p.is_published and p.verification_status = 'verified'
           and p.location_id in (select id from location_descendants(quote_requests.location_id))
           and (
             p.category_id in (select id from category_scope(quote_requests.category_id))
             or exists (
               select 1 from services sv
                where sv.provider_id = p.id and sv.is_active
                  and sv.category_id in (select id from category_scope(quote_requests.category_id))
             )
           )
      )
    )
  );

-- Redefined from 0028: the scope, and examples are never told about a
-- request (0041 already keeps them from answering one).
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
    and not p.is_demo
    and p.location_id in (select id from location_descendants(new.location_id))
    and (
      p.category_id in (select id from category_scope(new.category_id))
      or exists (
        select 1 from services sv
         where sv.provider_id = p.id and sv.is_active
           and sv.category_id in (select id from category_scope(new.category_id))
      )
    )
  order by p.created_at
  limit 50
  on conflict (source_table, source_id, kind, recipient_id) do nothing;
  return null;
end $$;

-- ---- 6. guards: only an assignable category -----------------------------
-- Redefined from 0047. One change: a new listing, or a change of
-- category, must name an assignable category (not a heading, not under a
-- retired vertical), read under the caller's RLS. The error keeps 0047's
-- name, so lib/onboarding.ts maps it as before.
create or replace function providers_guard_behaviour()
returns trigger language plpgsql as $$
declare
  v_default text;
begin
  if not acting_as_end_user() or is_admin() then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.supplier_type is distinct from old.supplier_type
       or new.concurrency_limit is distinct from old.concurrency_limit
       or new.is_demo is distinct from old.is_demo then
      raise exception 'how a listing behaves (type, concurrency, example flag) is not the supplier''s to change'
        using errcode = 'insufficient_privilege';
    end if;
    if new.category_id is not distinct from old.category_id then
      return new;
    end if;
  else
    if new.is_demo or new.concurrency_limit <> 1 then
      raise exception 'a new listing starts as a real one, with the default concurrency'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  select default_supplier_type into v_default
    from assignable_categories where id = new.category_id;
  if v_default is null then
    raise exception 'category % cannot be chosen (unknown, retired, or a heading)', new.category_id
      using errcode = 'check_violation', constraint = 'providers_category_active';
  end if;
  if v_default <> 'either' and v_default <> new.supplier_type then
    raise exception 'category % is for % listings, this one is a %', new.category_id, v_default, new.supplier_type
      using errcode = 'check_violation', constraint = 'providers_category_matches_mode';
  end if;
  return new;
end $$;

-- Services had no category check at all: an owner could file one under a
-- retired vertical and have it surface the day the vertical opened. An
-- unchanged category passes, so a service whose category was retired
-- later can still be edited.
create or replace function services_guard_category()
returns trigger language plpgsql as $$
begin
  if not acting_as_end_user() or is_admin() then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.category_id is not distinct from old.category_id then
    return new;
  end if;
  if not exists (select 1 from assignable_categories where id = new.category_id) then
    raise exception 'category % cannot be chosen for a service', new.category_id
      using errcode = 'check_violation', constraint = 'services_category_active';
  end if;
  return new;
end $$;

create trigger services_guard_category
  before insert or update of category_id on services
  for each row execute function services_guard_category();

-- A request may name any category a visitor can see, a vertical
-- included ("anything in Casa e Reparações"), but not a retired one.
-- category_id is frozen after insert (0027), so insert is enough.
create or replace function quote_requests_guard_category()
returns trigger language plpgsql as $$
begin
  if not acting_as_end_user() or is_admin() then
    return new;
  end if;
  if not exists (select 1 from category_paths where id = new.category_id) then
    raise exception 'category % is not open for requests', new.category_id
      using errcode = 'check_violation', constraint = 'quote_requests_category_active';
  end if;
  return new;
end $$;

create trigger quote_requests_guard_category
  before insert on quote_requests
  for each row execute function quote_requests_guard_category();

-- ---- 7. switching a vertical on is recorded ----------------------------
alter table audit_log drop constraint audit_log_target_type_check;
alter table audit_log add constraint audit_log_target_type_check
  check (target_type in ('provider', 'document', 'profile', 'service', 'report', 'payment', 'switch', 'category'));

create trigger categories_audit
  after update on categories
  for each row execute function audit_changes('category', 'is_active', 'is_assignable', 'parent_id',
                                              'default_supplier_type', 'slug', 'name');
