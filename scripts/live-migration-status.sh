#!/usr/bin/env bash
# =====================================================================
# Which migrations are in a database. READ-ONLY: it only looks for one
# object each migration creates, and names the first one missing.
#
#   set -a; source .env.local; set +a
#   ./scripts/live-migration-status.sh
# =====================================================================
set -uo pipefail
URL="${MIGRATION_DATABASE_URL:?MIGRATION_DATABASE_URL must be set }"

if ! psql "$URL" -Atc 'select 1' >/dev/null 2>&1; then
  echo "✗ Não foi possível ligar à base de dados."
  echo "  Confirme no painel do Supabase que o projecto está activo (não 'Paused')"
  echo "  e que MIGRATION_DATABASE_URL usa o pooler (aws-1-eu-west-1.pooler.supabase.com:5432)."
  psql "$URL" -Atc 'select 1' 2>&1 | tail -2 | sed 's/^/  /'
  if [ -n "${DATABASE_URL:-}" ] && [ "$DATABASE_URL" != "$URL" ] && psql "$DATABASE_URL" -Atc 'select 1' >/dev/null 2>&1; then
    echo
    echo "  DATABASE_URL (pooler, porta 6543) responde. As migrações correm uma a uma numa"
    echo "  única transacção, por isso podem usar essa ligação:"
    echo '    MIGRATION_DATABASE_URL="$DATABASE_URL" ./scripts/live-migration-status.sh'
  fi
  exit 2
fi

STATUS="$(psql "$URL" -At -v ON_ERROR_STOP=1 <<'SQL'
with fn(name) as (select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'),
col(t, c) as (select table_name, column_name from information_schema.columns where table_schema = 'public')
select n || '  ' || case when ok then 'aplicada' else 'EM FALTA' end from (values
  ('0001', exists (select 1 from pg_extension where extname = 'btree_gist')),
  ('0002', to_regclass('public.profiles') is not null),
  ('0003', to_regclass('public.categories') is not null),
  ('0004', to_regclass('public.providers') is not null),
  ('0005', exists (select 1 from fn where name = 'owns_provider')),
  ('0006', to_regclass('public.bookings') is not null),
  ('0007', to_regclass('public.reviews') is not null),
  ('0008', to_regclass('public.payments') is not null),
  ('0009', to_regclass('public.newsletter_subscribers') is not null),
  ('0010', to_regclass('public.events') is not null),
  ('0011', exists (select 1 from fn where name = 'profiles_guard_role')),
  ('0012', exists (select 1 from pg_roles where rolname = 'service_role')),
  ('0013', exists (select 1 from fn where name = 'reject_update')),
  ('0014', exists (select 1 from fn where name = 'resource_is_free')),
  ('0015', exists (select 1 from pg_constraint where conname = 'profiles_id_fkey')),
  ('0016', exists (select 1 from fn where name = 'handle_new_auth_user')),
  ('0017', to_regclass('public.provider_documents') is not null),
  ('0018', to_regclass('public.audit_log') is not null),
  ('0019', to_regclass('public.notification_outbox') is not null),
  ('0020', exists (select 1 from fn where name = 'categories_guard_parent')),
  ('0021', exists (select 1 from fn where name = 'bookings_guard_actor')),
  ('0022', exists (select 1 from fn where name = 'reviews_guard_reply')),
  ('0023', exists (select 1 from fn where name = 'review_display_name')),
  ('0024', exists (select 1 from fn where name = 'admin_provider_health')),
  ('0025', to_regclass('public.payment_documents') is not null),
  ('0026', exists (select 1 from fn where name = 'compute_refund_pct')),
  ('0027', to_regclass('public.quote_requests') is not null),
  ('0028', exists (select 1 from fn where name = 'enqueue_quote_request_notification')),
  ('0029', exists (select 1 from fn where name = 'quote_offers_guard_transitions')),
  ('0030', to_regclass('public.quote_offers_one_accepted_per_request') is not null),
  ('0031', exists (select 1 from fn where name = 'provider_is_public')),
  ('0032', exists (select 1 from fn where name = 'media_promote_cover')),
  ('0033', exists (select 1 from fn where name = 'bookings_guard_unavailable')),
  ('0034', exists (select 1 from fn where name = 'booking_client_contact')),
  ('0035', exists (select 1 from col where t = 'bookings' and c = 'deposit_minor')),
  ('0036', to_regclass('public.rate_limit_hits') is not null),
  ('0037', to_regclass('public.job_runs') is not null),
  ('0038', to_regclass('public.support_requests') is not null),
  ('0039', to_regclass('public.platform_switches') is not null),
  ('0040', to_regclass('public.admin_notes') is not null),
  ('0041', exists (select 1 from col where t = 'providers' and c = 'is_demo')),
  ('0042', to_regclass('public.legal_documents') is not null),
  ('0043', to_regclass('public.amenities') is not null),
  ('0044', to_regclass('public.document_kinds') is not null),
  ('0045', exists (select 1 from col where t = 'bookings' and c = 'cancellation_reason'))
) as m(n, ok) order by n;
SQL
)" || exit 2

echo "$STATUS"
FIRST="$(echo "$STATUS" | awk '/EM FALTA/ { print $1; exit }')"
echo
if [ -z "$FIRST" ]; then
  echo "✓ Todas aplicadas."
  exit 0
fi
# A migration found after the first missing one means the database was
# changed by hand; applying in order would then fail. Stop and look.
if echo "$STATUS" | awk -v f="$FIRST" '$1 > f && /aplicada/ { found = 1 } END { exit !found }'; then
  echo "⚠ Há migrações aplicadas depois de $FIRST, que está em falta. Não aplique nada;"
  echo "  envie esta lista para análise."
  exit 3
fi
echo "A primeira em falta é $FIRST. Para aplicar a partir dela:"
echo "  ./scripts/apply-migrations-from.sh $FIRST   (com o mesmo MIGRATION_DATABASE_URL)"
