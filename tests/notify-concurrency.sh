#!/usr/bin/env bash
# =====================================================================
# 30 simultaneous calls to /api/cron/notify, seeded with 30 pending
# notifications. Exactly 30 must send, and no row may send twice.
#
# This is the real proof that Promise.all() inside a single vitest
# process cannot give: genuine OS-level parallelism, many separate curl
# processes hitting a running server at the same instant, the same way
# tests/concurrency.sh proves the booking exclusion constraint holds
# under a real race rather than an async illusion of one.
#
# Requires a running app (npm run dev / next start) and CRON_SECRET set
# to the same value the app is using.
#
#   PGDATABASE=ngueza CRON_SECRET=xxx SITE_URL=http://localhost:3210 \
#     ./tests/notify-concurrency.sh
# =====================================================================
set -uo pipefail
: "${PGDATABASE:=ngueza}"
: "${SITE_URL:=http://localhost:3210}"
: "${CRON_SECRET:?set CRON_SECRET to match the running app}"
ATTEMPTS=${ATTEMPTS:-30}

case "$PGDATABASE" in
  *test*|ngueza) ;;
  *) echo "refusing to run against '$PGDATABASE' — use a disposable database"; exit 2 ;;
esac

MARKER="notify-race-$$-$(date +%s)"
# A run-unique base, so a second invocation of this script does not
# collide with the first one's still-committed rows under the
# (source_table, source_id, kind) unique constraint.
SOURCE_BASE=$(( $(date +%s) * 1000 + ($$ % 1000) ))

echo "seeding $ATTEMPTS pending notifications ($MARKER)..."
psql -v ON_ERROR_STOP=1 -q <<SQL
insert into notification_outbox (kind, to_email, context, source_table, source_id)
select 'provider_verified', '${MARKER}@teste.ao'::citext,
       jsonb_build_object('provider_id','x','provider_name','${MARKER}','provider_slug','x'),
       'audit_log', ${SOURCE_BASE} + g
  from generate_series(1, ${ATTEMPTS}) g;
SQL
if [ $? -ne 0 ]; then echo "FAIL: seed did not apply"; exit 1; fi

echo "firing $ATTEMPTS simultaneous calls to $SITE_URL/api/cron/notify..."
for i in $(seq 1 "$ATTEMPTS"); do
  curl -s -o /dev/null -H "authorization: Bearer $CRON_SECRET" \
       "$SITE_URL/api/cron/notify?limit=$ATTEMPTS" &
done
wait

# source_id runs 700000001..700000030 for ATTEMPTS=30 (generate_series
# starts at g=1), so the range check is inclusive on the top end.
SENT=$(psql -tAc "select count(*) from notification_outbox
                    where source_table = 'audit_log' and source_id > ${SOURCE_BASE}
                      and source_id <= ${SOURCE_BASE} + ${ATTEMPTS} and status = 'sent';")
STUCK=$(psql -tAc "select count(*) from notification_outbox
                     where source_table = 'audit_log' and source_id > ${SOURCE_BASE}
                       and source_id <= ${SOURCE_BASE} + ${ATTEMPTS}
                       and status in ('pending','sending');")

echo "sent: $SENT of $ATTEMPTS · stuck: $STUCK"
RC=0
[ "$SENT" -eq "$ATTEMPTS" ] || { echo "FAIL: $SENT of $ATTEMPTS sent, expected all of them"; RC=1; }
[ "$STUCK" -eq 0 ] || { echo "FAIL: $STUCK rows stuck mid-claim"; RC=1; }

if [ -f .outbox/mail.jsonl ]; then
  ACTUAL=$(grep -c "\"to\":\"${MARKER}@teste.ao\"" .outbox/mail.jsonl 2>/dev/null || echo 0)
  echo "outbox file entries for this run: $ACTUAL (expected exactly $ATTEMPTS, never double)"
  [ "$ACTUAL" -eq "$ATTEMPTS" ] || { echo "FAIL: $ACTUAL mail entries, expected exactly $ATTEMPTS"; RC=1; }
fi

[ "$RC" -eq 0 ] && echo "PASS: $ATTEMPTS concurrent cron calls sent every row exactly once"
exit $RC
