#!/usr/bin/env bash
# =====================================================================
# Apply migrations from a given number to the latest, in order, each in
# its own transaction, stopping at the first error (which rolls that one
# back). Run live-migration-status.sh first to know where to start.
#
#   set -a; source .env.local; set +a
#   ./scripts/apply-migrations-from.sh 0032
#
# A person runs this against the live project, never an agent or CI
# (CLAUDE.md: migrations against live data are never automated).
# =====================================================================
set -uo pipefail
FROM="${1:?usage: apply-migrations-from.sh 0032}"
URL="${MIGRATION_DATABASE_URL:?MIGRATION_DATABASE_URL must be set (session pooler, port 5432)}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

files=()
for f in "$ROOT"/supabase/migrations/*.sql; do
  n="$(basename "$f" | cut -c1-4)"
  [[ "$n" < "$FROM" ]] || files+=("$f")
done
[ ${#files[@]} -gt 0 ] || { echo "Nada a aplicar a partir de $FROM."; exit 0; }

echo "Vai aplicar ${#files[@]} migração(ões) em: $(echo "$URL" | sed -E 's#://[^@]*@#://***@#')"
for f in "${files[@]}"; do echo "  $(basename "$f")"; done
read -r -p "Continuar? Escreva SIM: " answer
[ "$answer" = "SIM" ] || { echo "Cancelado."; exit 1; }

for f in "${files[@]}"; do
  echo "→ $(basename "$f")"
  if ! psql "$URL" -v ON_ERROR_STOP=1 --single-transaction -q -f "$f"; then
    echo "✗ Falhou em $(basename "$f"). Essa migração foi revertida; as anteriores ficaram aplicadas."
    exit 1
  fi
done
echo "✓ Aplicadas. Agora: ./scripts/live-migration-status.sh e ./scripts/verify-remote.sh"
