-- =====================================================================
-- 0001 — extensions and shared helpers
--
-- Authorization helpers live in 0005, after the tables they read.
-- =====================================================================

create extension if not exists pgcrypto;    -- gen_random_uuid()
create extension if not exists btree_gist;  -- exclusion constraints over (uuid, tstzrange)
create extension if not exists citext;      -- case-insensitive email
create extension if not exists unaccent;    -- Portuguese-friendly slugs and search
create extension if not exists pg_trgm;     -- fuzzy name search

-- ---------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- slugify('Salão de Festas Talatona') -> 'salao-de-festas-talatona'
-- Not immutable (unaccent is not); never use this in an index expression.
-- ---------------------------------------------------------------------
create or replace function slugify(txt text)
returns text language sql stable as $$
  select trim(both '-' from
    regexp_replace(
      regexp_replace(lower(unaccent(coalesce(txt, ''))), '[^a-z0-9]+', '-', 'g'),
      '-{2,}', '-', 'g'
    )
  );
$$;
