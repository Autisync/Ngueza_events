-- =====================================================================
-- 0005 — authorization helpers
--
-- Defined after profiles (0002) and providers (0004) because SQL-language
-- function bodies are validated at creation time — unlike plpgsql, they
-- cannot forward-reference a table.
--
-- SECURITY DEFINER on purpose: these are called from RLS policies on the
-- very tables they read. Without it, evaluating a policy on profiles
-- would re-enter the policy on profiles and recurse.
-- =====================================================================

create or replace function current_role_name()
returns text language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from profiles where id = auth.uid()), false);
$$;

-- Is the current user the owner of this provider?
create or replace function owns_provider(p_provider_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from providers
    where id = p_provider_id and owner_id = auth.uid()
  );
$$;
