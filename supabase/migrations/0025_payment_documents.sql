-- =====================================================================
-- 0025 — proof-of-payment storage, and a schema mistake fixed first
-- =====================================================================
--
-- Found while scaffolding slice 16's upload screen, before writing it:
-- payments.proof_media_id (0008) referenced `media` — the PUBLIC,
-- provider-owned photo gallery table. media_public_read (0011) makes any
-- row belonging to a published, verified provider readable by anyone,
-- signed in or not. A payment proof is a bank-transfer screenshot or a
-- mobile-money receipt — routinely showing an account number, a name, an
-- amount — and has no business anywhere near that table, let alone that
-- policy. Confirmed nothing had ever written to the column before fixing
-- it: no application code references `payments` at all yet.
--
-- The fix is payment_documents — the same shape as provider_documents
-- (0017), booking-scoped instead of provider-scoped, same private bucket
-- (documentStore() in lib/media.ts already exists for exactly this), no
-- public policy, ever.

alter table payments drop column proof_media_id;

create table payment_documents (
  id                uuid primary key default gen_random_uuid(),
  booking_id        uuid not null references bookings(id) on delete cascade,
  uploaded_by       uuid not null references profiles(id) on delete restrict,

  external_id       text not null,             -- key in the PRIVATE documents bucket
  original_filename text,
  content_type      text,
  byte_size         bigint check (byte_size > 0),

  created_at        timestamptz not null default now()
);

create index payment_documents_booking_idx on payment_documents (booking_id);

alter table payments add column proof_document_id uuid references payment_documents(id) on delete set null;

alter table payment_documents enable row level security;

-- The client who booked, the supplier they paid directly (§28 Model A —
-- NGUEZA is never a party to the money itself, but the supplier who
-- received it is), and administrators. Same three parties
-- bookings_party_read already recognises for the booking itself.
create policy payment_documents_party_read on payment_documents
  for select using (
    exists (
      select 1 from bookings b
      where b.id = payment_documents.booking_id
        and (b.client_id = auth.uid() or owns_provider(b.provider_id) or is_admin())
    )
  );

-- Only the client, only their own booking, only while it is actually
-- awaiting payment — not a booking that never reached that state, and
-- not one that already moved past it.
create policy payment_documents_client_insert on payment_documents
  for insert with check (
    uploaded_by = auth.uid()
    and exists (
      select 1 from bookings b
      where b.id = payment_documents.booking_id
        and b.client_id = auth.uid()
        and b.status = 'awaiting_payment'
    )
  );

comment on table payment_documents is
  'Proof-of-payment uploads for the manual_proof adapter (§28, §29). Private bucket, no public policy, ever.';

-- payments itself (0011) has exactly one write policy, admin-only —
-- correct for confirming or rejecting a submission, but nothing ever
-- granted the client submitting one in the first place. The same
-- booking-state gate as above, plus: only the one adapter v1 ships,
-- only landing as 'submitted' (never self-confirmed), and only with the
-- proof actually attached — "manual proof" without the proof is just a
-- claim.
create policy payments_client_submit on payments
  for insert with check (
    provider_key = 'manual_proof'
    and status = 'submitted'
    and proof_document_id is not null
    and confirmed_by is null
    and confirmed_at is null
    and exists (
      select 1 from bookings b
      where b.id = payments.booking_id
        and b.client_id = auth.uid()
        and b.status = 'awaiting_payment'
    )
  );
