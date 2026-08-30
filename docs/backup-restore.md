# Backup and restore

Rehearsed against the live project on 2026-08-30, twice, and both attempts
are worth knowing about — the first one failed for reasons specific to how
Supabase manages extensions, and the failure is the useful part.

## The strategy: schema from migrations, data from a dump

Two separate things make up this database, and they need two separate
recovery paths:

- **Schema** — every table, policy, function, and trigger — already has a
  source of truth that is proven correct daily: `supabase/migrations/*.sql`,
  which CI applies to an empty database on every push (`Migrations apply
  cleanly from empty`). There is no reason to also carry it inside a backup
  file; doing so fights Supabase's own extension and role management (see
  below) for no benefit.
- **Data** — the rows themselves — is the one thing a migration replay can
  never recreate. This is what actually needs backing up.

So: **restore a fresh (or wiped) project by replaying the migrations, then
loading a data-only dump into it.** Not a full `pg_dump` of everything.

## Why not a full schema+data dump

Tried first, and it is worth recording exactly how it failed, because the
failure mode looks like a broken backup and is not one:

```
pg_dump: relation "public.providers" does not exist
```

`pg_dump` against a Supabase project silently omits `CREATE EXTENSION`
statements — confirmed directly: the dump's table of contents had zero
`EXTENSION` entries, despite `citext`, `btree_gist`, `pg_trgm` and
`unaccent` genuinely existing on the live project (`select extname,
extnamespace::regnamespace from pg_extension`). Every table using
`citext` (e.g. `profiles.email`) or depending on `btree_gist` (the
double-booking exclusion constraint) fails to restore, and everything
that references those tables cascades from there — which is most of the
schema. `pgcrypto` and `uuid-ossp` additionally live in a separate
`extensions` schema on Supabase, not `public`, so even manually creating
the extensions first fails again until that schema exists too.

None of this is a Ngueza bug. It is a known Supabase/pg_dump interaction,
and it is exactly why the schema half of recovery uses migrations instead.

## Taking a backup

Data only, from the `public` schema — `auth` is Supabase's own concern and
is not this project's data to carry around:

```bash
set -a; source .env.local; set +a
pg_dump "$MIGRATION_DATABASE_URL" \
  --format=custom --data-only --schema=public \
  --file="ngueza-$(date +%Y%m%d).dump"
```

Use `MIGRATION_DATABASE_URL` (the session-mode pooler, port 5432), not the
transaction pooler — `pg_dump` needs a long-lived connection.

Expect a warning, and it is not a problem:

```
pg_dump: warning: there are circular foreign-key constraints on this table:
pg_dump: detail: categories
```

`categories` and `locations` are self-referencing trees (`parent_id`) —
exactly the CLAUDE.md-mandated shape, and exactly why `--disable-triggers`
is required on restore, below.

## Restoring

**1. Schema**, into a project that has none (a fresh Supabase project, or
the existing one wiped back to empty) — this is already documented and
already proven daily:

```bash
set -a; source .env.local; set +a
for f in supabase/migrations/*.sql; do
  psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f" || break
done
psql "$MIGRATION_DATABASE_URL" -f seed/reference/00_taxonomy.sql
```

A real Supabase project already has `anon`, `authenticated` and
`service_role` provisioned, and `citext`/`btree_gist`/`pgcrypto` etc.
already installed — none of the extension or role gaps above apply when
the target is an actual Supabase project rather than a bare local Postgres
instance. They only bit during local verification, below.

**2. Data**, on top of that schema:

```bash
pg_restore --dbname="$MIGRATION_DATABASE_URL" \
  --no-owner --no-privileges --disable-triggers \
  ngueza-<date>.dump
```

`--disable-triggers` is required, not optional — without it the circular
FK on `categories`/`locations` refuses to load in any row order, and
separately, `booking_events`' append-only trigger (correctly) refuses to
let anything write to it at all, including a legitimate restore. Disabling
triggers for the duration of the data load is the standard, correct way
to bulk-load into a schema that has integrity triggers; it does not
disable RLS or constraints going forward, only during this one operation.

## Verifying a restore actually worked

Structural checks, in order of how likely a broken restore is to trip them:

```sql
-- Every table present, RLS on all of them (should be 0 missing)
select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='r' and not c.relrowsecurity;

-- The functions everything else depends on
select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in
   ('is_admin','owns_provider','resource_is_free',
    'handle_new_auth_user','admin_provider_health','review_display_name');

-- The constraint the whole product depends on
select count(*) from pg_constraint where conname = 'bookings_no_double_booking';
```

Then `./scripts/verify-remote.sh` against the restored database —
it is written to be safe to run anywhere, rolls back everything it
touches, and is the same suite that runs after every migration deploy.
Rehearsed end to end this way: reference data (15 categories, 10
locations), a real provider/booking/review/payment inserted, backed up,
wiped, restored, and every value — including `booking_events`' append-only
audit row and `reviews.is_verified`'s trigger-derived value — came back
byte-identical.

## This is a supplement, not a replacement

Supabase's own project-level backups (continuous or scheduled, depending
on plan) are the first line of recovery and cover more than this — this
procedure is deliberately independent of them: portable to any Postgres
host, exercisable without touching Supabase's dashboard, and proven by
actually running it rather than assumed from the plan tier. Check what
Supabase's own backup settings are for this project separately
(**Settings → Database → Backups**) — that is a dashboard setting, not
something in this repository.

## When to actually do this

Before anything that touches production data directly (a manual data
fix, a risky migration), and on a regular cadence once real suppliers and
bookings exist — monthly is a reasonable default to start with, tightened
once real transaction volume makes the gap between backups actually
matter.
