#!/usr/bin/env bash
# Rebuild the local database from scratch: migrations, then seed.
set -euo pipefail

: "${PGDATABASE:=ngueza}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

case "$PGDATABASE" in
  *prod*|*production*) echo "refusing to reset '$PGDATABASE'"; exit 2 ;;
esac

echo "→ recreating $PGDATABASE"
psql -q -d postgres -c "drop database if exists \"$PGDATABASE\";" \
                    -c "create database \"$PGDATABASE\";"

# Local only. Supabase provides the real auth schema in every deployed
# environment; this shim exists so CI can run against plain Postgres.
if [ "${WITH_AUTH_SHIM:-1}" = "1" ]; then
  echo "→ auth shim (local/CI only)"
  psql -q -v ON_ERROR_STOP=1 -f "$ROOT/tests/bootstrap/00_auth_shim.sql"
fi

for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "→ $(basename "$f")"
  psql -q -v ON_ERROR_STOP=1 -f "$f"
done

if [ "${WITH_SEED:-1}" = "1" ]; then
  for f in "$ROOT"/seed/*.sql; do
    echo "→ seed $(basename "$f")"
    psql -q -v ON_ERROR_STOP=1 -f "$f"
  done
fi

echo "✓ $PGDATABASE ready"
