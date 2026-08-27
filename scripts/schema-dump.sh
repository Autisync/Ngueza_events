#!/usr/bin/env bash
# Flatten the migrations into one readable file for agents and reviewers.
# Generated — never edit spec/schema.sql by hand.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/spec/schema.sql"

{
  echo "-- ==================================================================="
  echo "-- GENERATED — do not edit. Run: npm run schema:dump"
  echo "-- Source of truth is supabase/migrations/*.sql"
  echo "-- ==================================================================="
  echo
  for f in "$ROOT"/supabase/migrations/*.sql; do
    echo "-- ─────────────── $(basename "$f") ───────────────"
    cat "$f"
    echo
  done
} > "$OUT"
echo "✓ wrote $OUT"
