-- =====================================================================
-- 0007 — payments and policies (§11, §28, §29)
--
-- v1 ships ONE adapter: 'manual_proof'. The client pays the supplier
-- directly and uploads proof; NGUEZA never receives, holds or forwards
-- money. Every model where it would (§28 B/C) requires a legal opinion
-- and a licensed partner first.
--
-- The table shape is provider-agnostic so those adapters drop in later
-- without a migration.
-- =====================================================================

create table cancellation_policies (
  id             uuid primary key default gen_random_uuid(),
  provider_id    uuid references providers(id) on delete cascade,  -- null = platform default
  name           text not null,
  -- Refund percentage by days before the event, most generous first:
  -- [{"days_before": 30, "refund_pct": 100}, {"days_before": 7, "refund_pct": 50}]
  tiers          jsonb not null default '[]',
  notes          text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index cancellation_policies_provider_idx on cancellation_policies (provider_id)
  where is_active;

create trigger cancellation_policies_updated_at
  before update on cancellation_policies
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
create table payments (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null references bookings(id) on delete restrict,

  provider_key  text not null default 'manual_proof'
                  check (provider_key in
                    ('manual_proof', 'multicaixa_reference', 'bank_transfer', 'card')),
  reference     text,                              -- the payment reference, when there is one

  amount_minor  bigint not null check (amount_minor >= 0),   -- cêntimos, never a float
  currency      text not null default 'AOA',

  status        text not null default 'pending'
                  check (status in ('pending', 'submitted', 'confirmed', 'failed', 'refunded')),

  proof_media_id uuid references media(id) on delete set null,  -- manual_proof only
  confirmed_by  uuid references profiles(id),      -- who accepted the proof
  confirmed_at  timestamptz,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index payments_booking_idx on payments (booking_id);
create index payments_status_idx  on payments (status) where status in ('pending', 'submitted');

create trigger payments_updated_at
  before update on payments
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- Webhook log. Every external provider retries deliveries, sometimes for
-- days. The unique constraint makes a replay a no-op rather than a
-- second state transition.
-- ---------------------------------------------------------------------
create table payment_events (
  id                uuid primary key default gen_random_uuid(),
  provider_key      text not null,
  provider_event_id text not null,
  payment_id        uuid references payments(id) on delete set null,
  payload           jsonb not null,
  received_at       timestamptz not null default now(),
  unique (provider_key, provider_event_id)
);

create table refunds (
  id            uuid primary key default gen_random_uuid(),
  payment_id    uuid not null references payments(id) on delete restrict,
  amount_minor  bigint not null check (amount_minor >= 0),
  reason        text,
  status        text not null default 'pending'
                  check (status in ('pending', 'processed', 'failed')),
  processed_by  uuid references profiles(id),
  processed_at  timestamptz,
  created_at    timestamptz not null default now()
);

create index refunds_payment_idx on refunds (payment_id);
