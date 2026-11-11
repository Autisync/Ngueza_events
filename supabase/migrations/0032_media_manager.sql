-- =====================================================================
-- 0032 — the supplier photo manager (slice 27)
--
-- The media table has existed since 0004, but nothing let a supplier put
-- a row in it: every listing showed a grey placeholder. Slice 27 adds the
-- upload screen. This migration makes the table safe to hand to end users:
--
-- 1. An object key belongs to the provider it is filed under. The upload
--    route issues keys as "<provider_id>/<uuid>"; the database now refuses
--    a row that points at another provider's object, so a tampered client
--    cannot claim somebody else's photograph.
-- 2. At most 30 photographs per provider, counted under a per-provider
--    lock so two simultaneous uploads cannot both squeeze past the cap.
-- 3. A listing with photographs always has exactly one cover: the first
--    upload becomes the cover, and removing the cover promotes the next.
-- 4. New uploads go to the end of the order, not to sort_order 0.
-- 5. Which object a row points at, and whose it is, never change.
-- 6. The public sees photographs only of a listing the public may see —
--    the same provider_is_public() test bookings use since 0031, so a
--    suspended owner's photographs disappear with the listing.
-- =====================================================================

-- ---- 1. the object key is the provider's own --------------------------
-- NOT VALID: enforced for every new row, without failing the migration on
-- a row an administrator inserted by hand before this rule existed.
alter table media add constraint media_external_id_in_provider_prefix
  check (starts_with(external_id, provider_id::text || '/')) not valid;

alter table media add constraint media_alt_text_length
  check (alt_text is null or char_length(alt_text) <= 200) not valid;

-- A video is never the listing's cover; the cards and hero render images.
alter table media add constraint media_cover_is_image
  check (not (is_cover and kind <> 'image')) not valid;

-- ---- 2, 3, 4. on insert ------------------------------------------------
create or replace function media_before_insert()
returns trigger language plpgsql as $$
begin
  -- Serialise inserts for one provider: the count below, the cover choice
  -- and the next sort_order all read the provider's other rows.
  perform pg_advisory_xact_lock(hashtextextended('media:' || new.provider_id::text, 0));

  if new.kind = 'image' and (
    select count(*) from media where provider_id = new.provider_id and kind = 'image'
  ) >= 30 then
    raise exception 'photo limit reached for provider %', new.provider_id
      using errcode = 'check_violation', constraint = 'media_photo_limit';
  end if;

  if new.kind = 'image' and not exists (
    select 1 from media where provider_id = new.provider_id and is_cover
  ) then
    new.is_cover := true;
  end if;

  if new.sort_order = 0 then
    new.sort_order := coalesce(
      (select max(sort_order) from media where provider_id = new.provider_id), 0
    ) + 1;
  end if;

  return new;
end $$;

create trigger media_00_before_insert
  before insert on media
  for each row execute function media_before_insert();

-- ---- 3. removing the cover promotes the next photograph ----------------
create or replace function media_promote_cover()
returns trigger language plpgsql as $$
begin
  if old.is_cover then
    update media set is_cover = true
     where id = (
       select id from media
        where provider_id = old.provider_id and kind = 'image'
        order by sort_order, created_at, id
        limit 1
     );
  end if;
  return null;
end $$;

create trigger media_promote_cover
  after delete on media
  for each row execute function media_promote_cover();

-- ---- 5. identity columns are fixed --------------------------------------
create or replace function media_guard_identity()
returns trigger language plpgsql as $$
begin
  if new.provider_id is distinct from old.provider_id
     or new.external_id is distinct from old.external_id
     or new.kind        is distinct from old.kind
     or new.created_at  is distinct from old.created_at then
    raise exception 'a photograph''s object, owner and kind may not be changed'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

create trigger media_guard_identity
  before update on media
  for each row execute function media_guard_identity();

-- ---- 6. public read follows the listing ---------------------------------
drop policy media_public_read on media;
create policy media_public_read on media
  for select using (
    provider_is_public(provider_id) or owns_provider(provider_id) or is_admin()
  );
