#!/usr/bin/env bash
# =====================================================================
# Stock photographs for the example catalogue (seed/examples/).
#
#   1. downloads each photo listed in seed/examples/photos/photos.tsv — CC0 or
#      public-domain stock, found through Openverse;
#   2. scales it to at most 1920 px and re-encodes it as JPEG (macOS
#      `sips`), so the image Worker never resizes a 20-megapixel original;
#   3. uploads it to the PRIVATE R2 bucket under the supplier's prefix,
#      exactly where an upload from the painel would land;
#   4. runs seed/examples/photos/photos.sql, which adds the rows.
#
# Files are uploaded BEFORE the rows exist, so the site never points at a
# photo that is not there yet. Safe to run twice.
#
# Needs: macOS (sips), `npx wrangler login` done once, and DATABASE_URL —
#   set -a; source .env.local; set +a
#   ./scripts/example-photos.sh
#
# A person runs this against the live project, never an agent or CI.
# =====================================================================
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MANIFEST="$ROOT/seed/examples/photos/photos.tsv"
SQL="$ROOT/seed/examples/photos/photos.sql"
BUCKET="${MEDIA_BUCKET:-ngueza-media}"
URL="${DATABASE_URL:?DATABASE_URL must be set (source .env.local)}"

command -v sips >/dev/null || { echo "✗ Precisa do macOS (sips)."; exit 1; }
wrangler() { npx --yes wrangler@4 "$@"; }

who="$(wrangler whoami 2>&1 || true)"
if echo "$who" | grep -qiE "not authenticated|wrangler login"; then
  echo "→ Inicie sessão na Cloudflare (abre o navegador)"
  wrangler login
fi

if [ "$(psql "$URL" -Atc "select count(*) from providers where is_demo")" = "0" ]; then
  echo "✗ O catálogo de exemplo não está na base de dados. Primeiro:"
  echo "  psql \"\$DATABASE_URL\" -v ON_ERROR_STOP=1 --single-transaction -f seed/examples/00_example_catalogue.sql"
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
total="$(grep -vc '^#' "$MANIFEST")"
i=0
while IFS=$'\t' read -r key source _rest; do
  case "$key" in ''|'#'*) continue ;; esac
  i=$((i + 1))
  printf '[%2d/%d] %s\n' "$i" "$total" "$key"
  curl -fsSL --max-time 120 -A "ngueza-seed-script/1.0" -o "$WORK/in" "$source"
  # -Z also enlarges, so only pass it when the photo is bigger than 1920 px.
  longest="$(sips -g pixelWidth -g pixelHeight "$WORK/in" | awk '/pixel/ { if ($2 > m) m = $2 } END { print m }')"
  resize=(); [ "${longest:-0}" -gt 1920 ] && resize=(-Z 1920)
  sips -s format jpeg -s formatOptions 82 ${resize[@]+"${resize[@]}"} "$WORK/in" --out "$WORK/out.jpg" >/dev/null
  # </dev/null: npx must not swallow the rest of the manifest on stdin.
  wrangler r2 object put "$BUCKET/$key" --file "$WORK/out.jpg" --content-type image/jpeg --remote </dev/null >/dev/null
done < "$MANIFEST"

echo "→ A registar as fotografias na base de dados"
psql "$URL" -v ON_ERROR_STOP=1 --single-transaction -q -f "$SQL"
echo "✓ $(psql "$URL" -Atc "select count(*) from media m join providers p on p.id = m.provider_id where p.is_demo") fotografias de exemplo."
