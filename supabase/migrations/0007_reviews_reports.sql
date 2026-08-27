-- =====================================================================
-- 0006 — reviews and moderation (§14, §30, §31)
-- =====================================================================

create table reviews (
  id           uuid primary key default gen_random_uuid(),
  provider_id  uuid not null references providers(id) on delete cascade,
  author_id    uuid not null references profiles(id) on delete restrict,

  -- §30: the "Avaliação de Reserva Verificada" seal. A review carrying a
  -- completed booking is verified; one without it is not, and the two are
  -- displayed distinguishably. Nullable now so other review types can be
  -- allowed later without a migration.
  booking_id   uuid unique references bookings(id) on delete set null,
  is_verified  boolean not null default false,

  -- §14 sub-scores, 1..5
  rating_overall     smallint not null check (rating_overall between 1 and 5),
  rating_quality     smallint check (rating_quality between 1 and 5),
  rating_service     smallint check (rating_service between 1 and 5),
  rating_punctuality smallint check (rating_punctuality between 1 and 5),
  rating_cleanliness smallint check (rating_cleanliness between 1 and 5),
  rating_value       smallint check (rating_value between 1 and 5),

  comment      text,
  provider_reply      text,                       -- §30: right of reply
  provider_replied_at timestamptz,

  status       text not null default 'published'
                 check (status in ('published', 'hidden', 'removed')),

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index reviews_provider_idx on reviews (provider_id, created_at desc)
  where status = 'published';
create unique index reviews_one_per_booking_idx on reviews (booking_id)
  where booking_id is not null;

create trigger reviews_updated_at
  before update on reviews
  for each row execute function set_updated_at();

-- A review is verified only if its booking actually completed, and only
-- if the author is the client who booked. Derived, never asserted by
-- application code.
create or replace function reviews_derive_verified()
returns trigger language plpgsql as $$
declare
  v_ok boolean;
begin
  if new.booking_id is null then
    new.is_verified := false;
    return new;
  end if;

  select (b.status = 'completed'
          and b.client_id = new.author_id
          and b.provider_id = new.provider_id)
    into v_ok
    from bookings b where b.id = new.booking_id;

  new.is_verified := coalesce(v_ok, false);
  return new;
end $$;

create trigger reviews_derive_verified
  before insert or update on reviews
  for each row execute function reviews_derive_verified();

-- ---------------------------------------------------------------------
-- Reports / denúncias (§30, §31)
-- ---------------------------------------------------------------------
create table reports (
  id           uuid primary key default gen_random_uuid(),
  reporter_id  uuid references profiles(id) on delete set null,
  target_type  text not null check (target_type in ('provider', 'review', 'media', 'booking')),
  target_id    uuid not null,
  reason       text not null check (reason in
                 ('fake_listing', 'misleading_photos', 'fake_review',
                  'no_show', 'offensive', 'wrong_info', 'other')),
  detail       text,
  status       text not null default 'open'
                 check (status in ('open', 'reviewing', 'upheld', 'dismissed')),
  resolved_by  uuid references profiles(id),
  resolved_at  timestamptz,
  resolution_note text,
  created_at   timestamptz not null default now()
);

create index reports_open_idx   on reports (status, created_at) where status in ('open', 'reviewing');
create index reports_target_idx on reports (target_type, target_id);
