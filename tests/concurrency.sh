#!/usr/bin/env bash
# =====================================================================
# 50 simultaneous booking attempts for one venue slot. Exactly one may
# win. Sequential tests cannot catch the race this exists to prevent:
# two requests both read "free", both insert.
# =====================================================================
set -uo pipefail
: "${PGDATABASE:=ngueza}"
ATTEMPTS=${ATTEMPTS:-50}

# This script truncates tables. Refuse to touch anything that is not an
# obviously disposable database.
case "$PGDATABASE" in
  *test*|ngueza) ;;
  *) echo "refusing to run against '$PGDATABASE' — use a disposable database"; exit 2 ;;
esac

# TRUNCATE rather than DELETE: booking_events is append-only, so a
# cascading delete from bookings is refused by design. TRUNCATE does not
# fire row-level triggers.
psql -v ON_ERROR_STOP=1 -q <<'SQL'
truncate booking_events, bookings restart identity cascade;
delete from resources  where provider_id::text like 'cccccccc-9999%';
delete from providers  where id::text like 'cccccccc-9999%';
delete from profiles   where id in ('11111111-9999-1111-1111-111111111111',
                                    '22222222-9999-2222-2222-222222222222');
delete from auth.users where id in ('11111111-9999-1111-1111-111111111111',
                                    '22222222-9999-2222-2222-222222222222');
delete from categories where id = 'aaaaaaaa-9999-0000-0000-000000000001';
delete from locations  where id = 'bbbbbbbb-9999-0000-0000-000000000001';

select tests_user('11111111-9999-1111-1111-111111111111','race.dono@x.ao','provider');
select tests_user('22222222-9999-2222-2222-222222222222','race.ana@x.ao','client');
insert into categories (id, slug, name, default_supplier_type)
  values ('aaaaaaaa-9999-0000-0000-000000000001','race-saloes','Salões','venue');
insert into locations (id, level, slug, name)
  values ('bbbbbbbb-9999-0000-0000-000000000001','province','race-luanda','Luanda');
insert into providers (id, owner_id, supplier_type, slug, name, category_id, location_id,
                       verification_status, is_published)
  values ('cccccccc-9999-0000-0000-000000000001','11111111-9999-1111-1111-111111111111',
          'venue','race-salao','Salão Corrida','aaaaaaaa-9999-0000-0000-000000000001',
          'bbbbbbbb-9999-0000-0000-000000000001','verified',true);
insert into resources (id, provider_id, name)
  values ('dddddddd-9999-0000-0000-000000000001','cccccccc-9999-0000-0000-000000000001','Salão');
SQL

if [ $? -ne 0 ]; then echo "FAIL: fixture setup did not apply"; exit 1; fi

echo "firing $ATTEMPTS simultaneous bookings for the same slot..."
for i in $(seq 1 "$ATTEMPTS"); do
  psql -q -c "insert into bookings (provider_id, client_id, resource_id, status, starts_at, ends_at)
              values ('cccccccc-9999-0000-0000-000000000001',
                      '22222222-9999-2222-2222-222222222222',
                      'dddddddd-9999-0000-0000-000000000001',
                      'confirmed','2026-12-31 20:00+01','2027-01-01 04:00+01');" \
       >/dev/null 2>&1 &
done
wait

WON=$(psql -tAc "select count(*) from bookings
                  where resource_id = 'dddddddd-9999-0000-0000-000000000001'
                    and status = 'confirmed';")

echo "venue winners: $WON of $ATTEMPTS (expected 1)"
RC=0
[ "$WON" -eq 1 ] || { echo "FAIL: $WON bookings confirmed for one venue slot"; RC=1; }

# ---------------------------------------------------------------------
# The service path takes a different route: an advisory lock and a count,
# not the exclusion constraint. With concurrency_limit = 2, exactly two
# of N simultaneous attempts may win.
# ---------------------------------------------------------------------
psql -v ON_ERROR_STOP=1 -q <<'SQL'
insert into providers (id, owner_id, supplier_type, concurrency_limit, slug, name,
                       category_id, location_id, verification_status, is_published)
  values ('cccccccc-9999-0000-0000-000000000002','11111111-9999-1111-1111-111111111111',
          'service', 2, 'race-dj','DJ Corrida','aaaaaaaa-9999-0000-0000-000000000001',
          'bbbbbbbb-9999-0000-0000-000000000001','verified',true)
  on conflict (id) do nothing;
SQL

echo "firing $ATTEMPTS simultaneous bookings at a service with limit 2..."
for i in $(seq 1 "$ATTEMPTS"); do
  psql -q -c "insert into bookings (provider_id, client_id, status, starts_at, ends_at)
              values ('cccccccc-9999-0000-0000-000000000002',
                      '22222222-9999-2222-2222-222222222222',
                      'confirmed','2026-12-31 20:00+01','2027-01-01 04:00+01');" \
       >/dev/null 2>&1 &
done
wait

SWON=$(psql -tAc "select count(*) from bookings
                   where provider_id = 'cccccccc-9999-0000-0000-000000000002'
                     and status = 'confirmed';")

echo "service winners: $SWON of $ATTEMPTS (expected 2)"
[ "$SWON" -eq 2 ] || { echo "FAIL: $SWON overlapping service bookings, limit was 2"; RC=1; }

[ "$RC" -eq 0 ] && echo "PASS: both supplier types held under $ATTEMPTS-way concurrency"
exit $RC
