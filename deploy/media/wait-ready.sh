#!/usr/bin/env bash
# =====================================================================
# Bring the media stack up and block until it can actually serve.
#
# Not `docker compose up --wait`: that treats minio-init exiting 0 as a
# failure, because it cannot tell a finished job from a crashed service.
# The init container is *supposed* to exit — it creates the bucket and
# stops.
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")"

MINIO_URL="http://localhost:${MINIO_PORT:-9000}"
IMGPROXY_URL="http://localhost:${IMGPROXY_PORT:-8080}"

docker compose up -d

echo -n "waiting for minio and imgproxy"
for _ in $(seq 1 60); do
  if curl -sf "$MINIO_URL/minio/health/live" >/dev/null 2>&1 \
     && curl -sf "$IMGPROXY_URL/health" >/dev/null 2>&1; then
    echo " ok"
    break
  fi
  echo -n "."
  sleep 2
done

curl -sf "$MINIO_URL/minio/health/live" >/dev/null || { echo "minio never became healthy"; docker compose logs minio | tail -20; exit 1; }
curl -sf "$IMGPROXY_URL/health" >/dev/null   || { echo "imgproxy never became healthy"; docker compose logs imgproxy | tail -20; exit 1; }

# The bucket is what the app actually needs, so assert that rather than
# the init container's status.
if ! docker compose logs minio-init 2>&1 | grep -q "ready"; then
  echo "bucket was not created:"
  docker compose logs minio-init | tail -20
  exit 1
fi

echo "media stack ready"
