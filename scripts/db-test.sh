#!/usr/bin/env bash
# =====================================================================
# Run every database assertion against a disposable, SEEDLESS database.
#
# Seedless on purpose: assertions like "an anonymous visitor sees exactly
# one provider" must describe the policy, not the demo content. Tests
# that depend on seed data drift the moment someone adds a supplier.
# =====================================================================
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

export PGDATABASE="${TEST_DATABASE:-ngueza_test}"

case "$PGDATABASE" in
  *prod*|*production*) echo "refusing to test against '$PGDATABASE'"; exit 2 ;;
esac

echo "→ building $PGDATABASE (migrations only, no seed)"
WITH_REFERENCE=0 WITH_DEMO=0 "$ROOT/scripts/db-reset.sh" >/dev/null

fail=0
for f in "$ROOT"/tests/sql/*.sql; do
  echo "── $(basename "$f")"
  if out=$(psql -v ON_ERROR_STOP=1 -f "$f" 2>&1); then
    echo "$out" | grep 'NOTICE' | sed 's/.*NOTICE:  /   /'
  else
    fail=1
    echo "$out" | grep -E 'ERROR|FAIL' | sed 's/^/   /'
  fi
done

echo "── concurrency"
if "$ROOT/tests/concurrency.sh" 2>/dev/null | sed 's/^/   /'; then :; else fail=1; fi

echo
if [ $fail -eq 0 ]; then echo "✓ all database assertions passed"; else echo "✗ database assertions failed"; fi
exit $fail
