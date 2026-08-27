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

# The shim declares grants that depend on roles created in migration
# 0012, so apply it a second time now that those roles exist. Every
# statement in it is idempotent.
if [ "${WITH_AUTH_SHIM:-1}" = "1" ]; then
  psql -q -v ON_ERROR_STOP=1 -f "$ROOT/tests/bootstrap/00_auth_shim.sql"
fi

# Reference data — real Luanda locations, real categories, the platform
# cancellation policy. Every environment needs these, production included.
if [ "${WITH_REFERENCE:-1}" = "1" ]; then
  for f in "$ROOT"/seed/reference/*.sql; do
    echo "→ reference $(basename "$f")"
    psql -q -v ON_ERROR_STOP=1 -f "$f"
  done
fi

# Demo suppliers. Local development and tests ONLY. "Salão Horizonte" and
# "Quinta das Palmeiras" do not exist; shipping them to production would
# put fake listings in front of real clients.
if [ "${WITH_DEMO:-1}" = "1" ]; then
  for f in "$ROOT"/seed/demo/*.sql; do
    echo "→ demo $(basename "$f")"
    psql -q -v ON_ERROR_STOP=1 -f "$f"
  done
fi

echo "✓ $PGDATABASE ready"
