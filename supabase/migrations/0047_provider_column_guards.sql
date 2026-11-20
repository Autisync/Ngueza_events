-- =====================================================================
-- 0047 — a supplier cannot rewrite how their own listing behaves
--        (slice 51, first step of the marketplace pivot)
--
-- `providers_owner_insert` and `providers_owner_update` (0011) check only
-- who owns the row, and 0012 grants UPDATE on every column. So an owner
-- could, with one PostgREST call the app never makes:
--
--   * flip `supplier_type` venue -> service, after which their bookings
--     stop blocking the calendar (`bookings_set_shape` reads this column)
--     and the same room can be confirmed twice;
--   * raise `concurrency_limit`, the ceiling the concurrency trigger
--     enforces;
--   * set or clear `is_demo`, the flag that keeps example listings
--     unbookable (0041);
--   * move a venue into a service category (or the reverse) while the
--     frozen `supplier_type` keeps the old behaviour.
--
-- Only `verification_status` had a guard. This adds the rest, before the
-- pivot gives these columns more to decide.
--
-- A trigger, not a column REVOKE: with a table-level UPDATE grant in
-- place, revoking one column is a no-op in Postgres.
--
-- INVOKER on purpose, so acting_as_end_user() sees the real caller (see
-- 0031/0033). Administrators, the service role and migrations pass.
-- =====================================================================

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

  -- A new listing, or a change of category: the category decides the mode.
  -- Read under the caller's own RLS, so a retired category (invisible to
  -- them) is refused the same way the registration form refuses it.
  select default_supplier_type into v_default from categories where id = new.category_id;
  if v_default is null then
    raise exception 'unknown or inactive category'
      using errcode = 'check_violation', constraint = 'providers_category_active';
  end if;
  if v_default <> 'either' and v_default <> new.supplier_type then
    raise exception 'category % is for % listings, this one is a %', new.category_id, v_default, new.supplier_type
      using errcode = 'check_violation', constraint = 'providers_category_matches_mode';
  end if;
  return new;
end $$;

create trigger providers_guard_behaviour
  before insert or update on providers
  for each row execute function providers_guard_behaviour();
