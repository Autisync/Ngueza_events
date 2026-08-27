-- =====================================================================
-- 0016 — a profile for every identity (§12, §13)
--
-- Supabase Auth owns auth.users. This system reads profiles, and 0015
-- ties the two together. Creating the profile in application code after
-- signup would leave a window — and a failure mode — where an identity
-- exists with nothing to authorise against. A trigger closes it.
-- =====================================================================

create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  -- IMPORTANT: raw_APP_meta_data, never raw_USER_meta_data.
  --
  -- A user chooses raw_user_meta_data at signup — it is whatever they put
  -- in the `data` field. Reading a role from it would let anyone register
  -- as an administrator. raw_app_meta_data can only be written by the
  -- service role or the admin API, so it is safe to trust.
  v_role := coalesce(new.raw_app_meta_data ->> 'app_role', 'client');
  if v_role not in ('client', 'provider', 'admin') then
    v_role := 'client';
  end if;

  insert into profiles (id, email, full_name, role, email_verified)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    v_role,
    new.email_confirmed_at is not null
  )
  on conflict (id) do nothing;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();

-- ---------------------------------------------------------------------
-- Keep profiles.email_verified in step with Supabase's confirmation, so
-- the trust signals on a supplier page (§25) reflect reality.
-- ---------------------------------------------------------------------
create or replace function handle_auth_user_updated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update profiles
     set email          = coalesce(new.email, email),
         email_verified = new.email_confirmed_at is not null
   where id = new.id;
  return new;
end $$;

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated
  after update of email, email_confirmed_at on auth.users
  for each row execute function handle_auth_user_updated();
