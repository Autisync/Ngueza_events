-- =====================================================================
-- 0002 — identity (§12, §13, §36)
-- =====================================================================

create table profiles (
  id             uuid primary key,                 -- mirrors auth.users.id
  role           text not null default 'client'
                   check (role in ('client', 'provider', 'admin')),
  full_name      text,
  email          citext not null unique,
  phone          text,
  email_verified boolean not null default false,
  phone_verified boolean not null default false,   -- §25: a verified phone is a trust signal
  locale         text not null default 'pt-AO',
  status         text not null default 'active'
                   check (status in ('active', 'suspended', 'deleted')),
  -- §37: account deletion is a state, not a DELETE. Bookings and audit
  -- records must survive it; personal fields are cleared on transition.
  deleted_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index profiles_role_idx   on profiles (role) where status = 'active';
create index profiles_status_idx on profiles (status);

create trigger profiles_updated_at
  before update on profiles
  for each row execute function set_updated_at();

comment on table profiles is
  'One row per authenticated user. Role gates everything; see RLS in 0010.';
