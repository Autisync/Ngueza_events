-- =====================================================================
-- 0044 — the verification document checklist (slice 46, review R035)
--
-- Before this, a supplier chose a document "type" from a fixed list and
-- nobody — supplier or reviewer — could see what was still missing, and a
-- supplier could be verified, and published, with no accepted paperwork
-- at all.
--
-- 1. Document kinds become rows, each saying which supplier type needs
--    it. Which papers NGUEZA asks for is policy and changes without a
--    deploy, like categories.
-- 2. Verifying requires at least one accepted document. A structural
--    floor, not the decision: the decision stays with a person (§25).
-- =====================================================================

create table document_kinds (
  slug          text primary key check (slug ~ '^[a-z0-9]+(_[a-z0-9]+)*$'),
  name          text not null check (char_length(name) between 2 and 80),   -- pt-AO
  hint          text check (char_length(hint) <= 300),                      -- what counts
  -- Who must provide it: every supplier, only venues, only service
  -- suppliers, or nobody (optional, accepted if sent).
  required_for  text not null default 'none'
                  check (required_for in ('all', 'venue', 'service', 'none')),
  sort_order    integer not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

alter table document_kinds enable row level security;
create policy document_kinds_read on document_kinds for select using (is_active or is_admin());
create policy document_kinds_admin_write on document_kinds
  for all using (is_admin()) with check (is_admin());
revoke insert, update, delete on document_kinds from anon;

-- The existing five keep their slugs (rows already reference them); two
-- are renamed to what Angolan paperwork is actually called, and the
-- venue-only proof of the right to use the space is new.
insert into document_kinds (slug, name, hint, required_for, sort_order) values
  ('identity', 'Documento de identificação do responsável',
   'Bilhete de identidade ou passaporte, dentro da validade, com a fotografia legível.', 'all', 10),
  ('nif', 'NIF',
   'Cartão ou declaração com o número de identificação fiscal do negócio ou do responsável.', 'all', 20),
  ('commercial_registration', 'Alvará ou certidão comercial',
   'Alvará comercial ou certidão do registo comercial em nome do negócio.', 'venue', 30),
  ('space_rights', 'Prova do direito de uso do espaço',
   'Escritura, contrato de arrendamento ou autorização do proprietário para eventos.', 'venue', 40),
  ('proof_of_address', 'Comprovativo de morada', null, 'none', 50),
  ('other', 'Outro documento', null, 'none', 90)
on conflict (slug) do nothing;

alter table provider_documents drop constraint provider_documents_kind_check;
alter table provider_documents
  add constraint provider_documents_kind_fkey
  foreign key (kind) references document_kinds (slug) on update cascade;

-- ---------------------------------------------------------------------
-- The verification guard, once more: everything 0031 allowed, plus a
-- floor under 'verified'. Reinstating a suspended supplier is exempt —
-- they were verified before, possibly before this rule existed.
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

  if new.verification_status = 'pending' then
    new.submitted_at := now();
  end if;

  if is_admin() then
    -- Only an administrator can verify at all; this is the floor under
    -- that decision, so it lives on their path.
    if new.verification_status = 'verified'
       and old.verification_status <> 'suspended'
       and not exists (select 1 from provider_documents d
                        where d.provider_id = new.id and d.status = 'accepted') then
      raise exception 'a supplier cannot be verified without an accepted document'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- Re-queuing after a rejection is the supplier's to do; the decision
  -- itself stays with an administrator. Suspended stays an admin matter.
  if old.verification_status in ('unverified', 'rejected')
     and new.verification_status = 'pending'
     and owns_provider(new.id) then
    return new;
  end if;

  raise exception 'verification % -> % is an administrator''s decision',
    old.verification_status, new.verification_status
    using errcode = 'insufficient_privilege';
end $$;
