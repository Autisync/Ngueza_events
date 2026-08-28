-- =====================================================================
-- 0023 — a public-safe name for a review's author (§14, §30)
-- =====================================================================
--
-- profiles has exactly two read policies: a person reading their own row,
-- and an administrator (0011). There is no public-read policy at all — on
-- purpose, the same reasoning CLAUDE.md gives for availability: an anon
-- visitor reading `providers` and joining straight to `profiles` for a
-- review's author would just get NULL, which reads as "reviews have no
-- author" rather than as the missing grant it actually is.
--
-- The fix is the same shape as resource_is_free(): a SECURITY DEFINER
-- function that returns only the narrow, public-safe fact — first name
-- plus a last-initial, e.g. "Ana C." — never the row itself, so nothing
-- about profiles' RLS boundary widens to give reviews a byline.
create or replace function review_display_name(p_author_id uuid)
returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v_name  text;
  v_parts text[];
begin
  select full_name into v_name from profiles where id = p_author_id;
  if v_name is null or btrim(v_name) = '' then
    return 'Cliente NGUEZA';
  end if;
  v_parts := regexp_split_to_array(btrim(v_name), '\s+');
  if array_length(v_parts, 1) = 1 then
    return v_parts[1];
  end if;
  return v_parts[1] || ' ' || left(v_parts[array_length(v_parts, 1)], 1) || '.';
end $$;

-- No explicit grant needed: 0012's `alter default privileges ... grant
-- execute on functions to anon, authenticated, service_role` already
-- covers anything the migration role creates from here on.
