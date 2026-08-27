-- =====================================================================
-- 0015 — tie profiles to Supabase Auth
--
-- profiles.id carries the auth.users id. Adding the real foreign key
-- means an identity cannot exist in one place and not the other.
--
-- ON DELETE RESTRICT, deliberately. §37 requires an erasure path, and
-- 0002 already answers it: account deletion is a status change plus
-- clearing the personal fields, never a DELETE — because bookings,
-- payments and the audit trail have to survive it (§38). RESTRICT makes
-- that policy the only possible one, rather than a convention someone
-- can forget at 2am with a support ticket open.
--
-- Guarded so it is a no-op anywhere auth.users does not exist.
-- =====================================================================

do $$
begin
  if to_regclass('auth.users') is null then
    raise notice 'auth.users absent — skipping the profiles FK';
    return;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'profiles_id_fkey'
  ) then
    alter table profiles
      add constraint profiles_id_fkey
      foreign key (id) references auth.users(id) on delete restrict;
  end if;
end $$;
