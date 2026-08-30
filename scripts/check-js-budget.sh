#!/usr/bin/env bash
# =====================================================================
# The route JS budget CLAUDE.md claims — "Route JS budget is 180KB...
# CI fails the build on either" — was never actually checked by CI. It
# checked that no secret reached the client bundle, and stopped there.
# Found doing a launch-hardening pass: every page measured, static or
# dynamic, sits at 169–175KB gzipped, almost entirely the shared React /
# Next.js runtime — meaning any route has 5–11KB of headroom before a
# single line of page-specific code, and nothing was catching a
# regression past that.
#
# Static pages are measured straight off disk — the prerendered HTML
# under .next/server/app already lists every chunk it needs, no server
# required. Dynamic pages need a live one; this script starts `next
# start` itself, with DATABASE_URL if the caller has one (CI's database
# job does, from its seeded test database — the seed includes
# 'salao-horizonte-talatona'), and skips the dynamic pass entirely
# without one rather than fail on an unrelated missing prerequisite.
#
#   npm run build && ./scripts/check-js-budget.sh
#   DATABASE_URL=... ./scripts/check-js-budget.sh   # also checks dynamic routes
# =====================================================================
set -uo pipefail

BUDGET_BYTES=$((180 * 1024))
FAIL=0

if [ ! -d .next/static/chunks ]; then
  echo "::error::.next/static/chunks not found — run 'npm run build' first" >&2
  exit 1
fi

# gzip -c on the built asset is what a real server serves compressed
# content as, at minimum — Vercel's edge additionally offers brotli,
# which only shrinks this further, so gzip is the honest worst case.
chunk_size() {
  gzip -c ".next/static/chunks/$1" 2>/dev/null | wc -c | tr -d ' '
}

check_html_file() {
  local label="$1" html_file="$2"
  if [ ! -f "$html_file" ]; then
    echo "  (skip: $html_file not found)"
    return
  fi
  local total=0
  for f in $(grep -oE '/_next/static/chunks/[a-zA-Z0-9_.-]+\.js' "$html_file" | sort -u | sed 's#/_next/static/chunks/##'); do
    total=$((total + $(chunk_size "$f")))
  done
  report "$label" "$total"
}

report() {
  local label="$1" total="$2"
  local kb=$((total / 1024))
  if [ "$total" -gt "$BUDGET_BYTES" ]; then
    echo "::error::$label — ${kb}KB gzipped, over the 180KB budget"
    FAIL=1
  else
    local headroom=$(( (BUDGET_BYTES - total) / 1024 ))
    echo "  PASS: $label — ${kb}KB gzipped (${headroom}KB headroom)"
  fi
}

echo "── static routes (measured from the prerendered build output) ──"
check_html_file "/termos"        ".next/server/app/termos.html"
check_html_file "/privacidade"   ".next/server/app/privacidade.html"
check_html_file "/cancelamento"  ".next/server/app/cancelamento.html"

if [ -z "${DATABASE_URL:-}" ]; then
  echo
  echo "── dynamic routes: skipped, no DATABASE_URL ──"
  exit $FAIL
fi

echo
echo "── dynamic routes (measured against a live server) ──"
PORT=$((30000 + RANDOM % 10000))
npx next start -p "$PORT" >/tmp/check-js-budget-server.log 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null; wait $SERVER_PID 2>/dev/null' EXIT

ready=0
for _ in $(seq 1 30); do
  if curl -sS -o /dev/null "http://localhost:$PORT/" 2>/dev/null; then ready=1; break; fi
  sleep 1
done
if [ "$ready" -eq 0 ]; then
  echo "::error::the local server never came up on port $PORT — see /tmp/check-js-budget-server.log"
  cat /tmp/check-js-budget-server.log >&2
  exit 1
fi

check_live_route() {
  local label="$1" path="$2"
  local html; html=$(mktemp)
  curl -sS "http://localhost:$PORT$path" -o "$html"
  local total=0
  for f in $(grep -oE '/_next/static/chunks/[a-zA-Z0-9_.-]+\.js' "$html" | sort -u | sed 's#/_next/static/chunks/##'); do
    total=$((total + $(chunk_size "$f")))
  done
  rm -f "$html"
  report "$label" "$total"
}

check_live_route "/"                                     "/"
check_live_route "/procurar"                              "/procurar"
check_live_route "/fornecedor/salao-horizonte-talatona"   "/fornecedor/salao-horizonte-talatona"

exit $FAIL
