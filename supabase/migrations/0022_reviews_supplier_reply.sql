-- =====================================================================
-- 0022 — a supplier could never actually reply to a review (§30)
-- =====================================================================
--
-- reviews_guard_reply() (0011) exists to let a supplier touch only the
-- reply columns on someone else's review. Written while building slice 11
-- (reviews), the whole branch turned out to be dead code: RLS has exactly
-- one UPDATE policy on reviews, reviews_author_update, and its USING
-- clause is `author_id = auth.uid() or is_admin()`. A supplier who is
-- neither the author nor an admin never satisfies that clause, so
-- Postgres filters the row out of the UPDATE's target set before
-- reviews_guard_reply's trigger body ever runs — and does it silently:
--
--   set local role authenticated;
--   -- (JWT claims set to the supplier's own uid)
--   update reviews set provider_reply = '...' where id = '...';
--   -- UPDATE 0.  No exception. No RLS-violation error either.
--
-- "An empty result is not the same as no constraint" (CLAUDE.md) — this
-- is that trap on the write side. `INSERT ... RETURNING` and `ON
-- CONFLICT` fail loudly with a misleading RLS error when a role has no
-- SELECT policy; an UPDATE whose row USING clause excludes the target
-- just silently affects nothing, which every naive call site reads as
-- success unless it checks the row count.
--
-- The fix is a second, permissive UPDATE policy scoped to ownership.
-- Permissive policies OR: a supplier passes through this one, the
-- original review author still passes through reviews_author_update,
-- and an admin passes through either. reviews_guard_reply is still what
-- stops a supplier from rewriting the rating or comment once they can
-- reach the row at all — but its own column list was incomplete too,
-- checking only rating_overall/comment/status. That would have let a
-- supplier who reached this policy also move a review to a different
-- provider they own, edit any of the five sub-scores, or unset
-- is_verified. Replaced with the full column list.

create policy reviews_supplier_reply on reviews
  for update using (owns_provider(provider_id))
  with check (owns_provider(provider_id));

create or replace function reviews_guard_reply()
returns trigger language plpgsql as $$
begin
  if owns_provider(new.provider_id) and not is_admin()
     and new.author_id is distinct from auth.uid() then
    if new.id                 is distinct from old.id
       or new.provider_id     is distinct from old.provider_id
       or new.author_id       is distinct from old.author_id
       or new.booking_id      is distinct from old.booking_id
       or new.is_verified     is distinct from old.is_verified
       or new.rating_overall     is distinct from old.rating_overall
       or new.rating_quality     is distinct from old.rating_quality
       or new.rating_service     is distinct from old.rating_service
       or new.rating_punctuality is distinct from old.rating_punctuality
       or new.rating_cleanliness is distinct from old.rating_cleanliness
       or new.rating_value       is distinct from old.rating_value
       or new.comment          is distinct from old.comment
       or new.status           is distinct from old.status
       or new.created_at       is distinct from old.created_at
    then
      raise exception 'a supplier may only add a reply to a review'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end $$;
