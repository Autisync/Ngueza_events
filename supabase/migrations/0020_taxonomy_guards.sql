-- =====================================================================
-- 0020 — cycle prevention for categories and locations (§44, §43)
--
-- Building admin CRUD for these trees (slice 03) surfaced a real gap:
-- reparenting a category under one of its own descendants was accepted
-- silently, producing a genuine cycle. category_descendants() and
-- location_descendants() are recursive CTEs with no depth guard, so a
-- cycle does not error — it hangs. Confirmed directly: reparenting
-- "Eventos" under its own child "Salões de festas" succeeded, and the
-- very next call to category_descendants() never returned.
--
-- category_not_own_parent (0003) only catches the one-level case, id =
-- parent_id. A three-level cycle sails straight through it. This closes
-- the general case: a node may never be reparented under itself or any
-- of its own descendants.
--
-- lib/search.ts calls category_descendants() and location_descendants()
-- on every search — a cycle here is not a data-quality nuisance, it is
-- a way to take the search page down.
-- =====================================================================

create or replace function categories_guard_parent()
returns trigger language plpgsql as $$
begin
  if new.parent_id is null or new.parent_id is not distinct from old.parent_id then
    return new;
  end if;
  if new.parent_id in (select id from category_descendants(old.id)) then
    raise exception 'category % cannot be reparented under its own descendant %',
      old.id, new.parent_id
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger categories_guard_parent
  before update on categories
  for each row execute function categories_guard_parent();

create or replace function locations_guard_parent()
returns trigger language plpgsql as $$
begin
  if new.parent_id is null or new.parent_id is not distinct from old.parent_id then
    return new;
  end if;
  if new.parent_id in (select id from location_descendants(old.id)) then
    raise exception 'location % cannot be reparented under its own descendant %',
      old.id, new.parent_id
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger locations_guard_parent
  before update on locations
  for each row execute function locations_guard_parent();
