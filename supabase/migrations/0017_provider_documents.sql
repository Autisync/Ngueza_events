-- =====================================================================
-- 0017 — verification documents, and an honest role guard (§13, §25)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Identity documents (§25).
--
-- These are the most sensitive rows in the system: an identity card, a
-- NIF, commercial registration. Three rules follow from that and are
-- enforced rather than assumed:
--
--   1. They live in a SEPARATE, PRIVATE bucket — never the public media
--      bucket, which is anonymously readable so that photographs load.
--   2. No public SELECT policy exists at all. Not "only when published" —
--      none. The owner and administrators, nobody else.
--   3. The file never touches the application server, same as media.
-- ---------------------------------------------------------------------
create table provider_documents (
  id            uuid primary key default gen_random_uuid(),
  provider_id   uuid not null references providers(id) on delete cascade,

  kind          text not null check (kind in (
                  'identity',                 -- bilhete de identidade / passaporte
                  'nif',                      -- número de identificação fiscal
                  'commercial_registration',  -- certidão comercial
                  'proof_of_address',
                  'other'
                )),

  external_id   text not null,                -- key in the private bucket
  original_filename text,
  content_type  text,
  byte_size     bigint check (byte_size > 0),

  status        text not null default 'submitted'
                  check (status in ('submitted', 'accepted', 'rejected')),
  reviewed_by   uuid references profiles(id),
  reviewed_at   timestamptz,
  review_note   text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (provider_id, external_id)
);

create index provider_documents_provider_idx on provider_documents (provider_id);
create index provider_documents_queue_idx on provider_documents (status, created_at)
  where status = 'submitted';

create trigger provider_documents_updated_at
  before update on provider_documents
  for each row execute function set_updated_at();

alter table provider_documents enable row level security;

-- Owner and administrators. There is deliberately no public policy.
create policy provider_documents_owner_read on provider_documents
  for select using (owns_provider(provider_id) or is_admin());

create policy provider_documents_owner_insert on provider_documents
  for insert with check (owns_provider(provider_id) and status = 'submitted');

-- A supplier may withdraw a document they submitted; they may not mark
-- their own paperwork accepted.
create policy provider_documents_owner_delete on provider_documents
  for delete using ((owns_provider(provider_id) and status = 'submitted') or is_admin());

create policy provider_documents_admin_update on provider_documents
  for update using (is_admin()) with check (is_admin());

comment on table provider_documents is
  'Identity paperwork for §25 verification. Private bucket, no public policy, ever.';

-- ---------------------------------------------------------------------
-- The role guard, rewritten to say what is actually true.
--
-- "Only an administrator may change a role" was too strong: it also
-- blocked the one legitimate self-service transition, a client becoming
-- a supplier by registering a business. Keeping the absolute rule would
-- have meant working around it with a service-role escape hatch, which is
-- how guards quietly stop guarding anything.
--
-- Becoming a 'provider' grants NO extra access. Every provider-owned
-- policy keys off owns_provider(), never off this column, and
-- verification (§25) stays an administrator's decision. The role is a
-- label for navigation and for the supplier digest audience.
-- ---------------------------------------------------------------------
create or replace function profiles_guard_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is not distinct from old.role then
    return new;
  end if;

  if is_admin() then
    return new;
  end if;

  if old.role = 'client'
     and new.role = 'provider'
     and exists (select 1 from providers where owner_id = new.id) then
    return new;
  end if;

  raise exception 'role % -> % is not self-service', old.role, new.role
    using errcode = 'insufficient_privilege';
end $$;

-- ---------------------------------------------------------------------
-- The verification guard, made precise for the same reason as the role
-- guard above.
--
-- "Only an administrator may change verification_status" also blocked a
-- supplier from *asking* to be reviewed, which is not an administrative
-- act — it is the supplier saying "my paperwork is in". The decision
-- itself stays with an administrator (§25).
--
-- Allowed for an owner:  unverified -> pending
-- Allowed for an admin:  anything
-- Everything else:       refused, including the obvious
--                        pending -> verified by the supplier.
-- ---------------------------------------------------------------------
create or replace function providers_guard_verification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.verification_status is not distinct from old.verification_status then
    return new;
  end if;

  if is_admin() then
    return new;
  end if;

  if old.verification_status = 'unverified'
     and new.verification_status = 'pending'
     and owns_provider(new.id) then
    return new;
  end if;

  raise exception 'verification % -> % is an administrator''s decision',
    old.verification_status, new.verification_status
    using errcode = 'insufficient_privilege';
end $$;
