#!/usr/bin/env bash
# =====================================================================
# Which migrations from 0032 on are in a database. READ-ONLY: it only
# looks for one object each migration creates.
#
#   set -a; source .env.local; set +a
#   ./scripts/live-migration-status.sh
# =====================================================================
set -uo pipefail
URL="${MIGRATION_DATABASE_URL:?MIGRATION_DATABASE_URL must be set (session pooler, port 5432)}"

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

psql "$URL" -At <<'SQL'
select n || '  ' || case when ok then 'aplicada' else 'EM FALTA' end from (values
  ('0032', to_regprocedure('media_promote_cover()') is not null),
  ('0033', to_regprocedure('bookings_guard_unavailable()') is not null),
  ('0034', exists (select 1 from pg_proc where proname = 'booking_client_contact')),
  ('0035', exists (select 1 from information_schema.columns where table_name = 'bookings' and column_name = 'deposit_minor')),
  ('0036', to_regclass('public.rate_limit_hits') is not null),
  ('0037', to_regclass('public.job_runs') is not null),
  ('0038', to_regclass('public.support_requests') is not null),
  ('0039', to_regclass('public.platform_switches') is not null),
  ('0040', to_regclass('public.admin_notes') is not null),
  ('0041', exists (select 1 from information_schema.columns where table_name = 'providers' and column_name = 'is_demo')),
  ('0042', to_regclass('public.legal_documents') is not null),
  ('0043', to_regclass('public.amenities') is not null),
  ('0044', to_regclass('public.document_kinds') is not null),
  ('0045', exists (select 1 from information_schema.columns where table_name = 'bookings' and column_name = 'cancellation_reason'))
) as m(n, ok) order by n;
SQL
