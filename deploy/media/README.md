# Media stack — Portainer

Two containers replacing Cloudflare Images + R2 on your own host.

| | Replaces | Does |
|---|---|---|
| **MinIO** | Cloudflare R2 | S3-compatible object storage. The browser uploads straight to it with a presigned URL. |
| **imgproxy** | Cloudflare Images | Resizes and converts to WebP/AVIF on delivery. One original serves every size. |

The contract from §40 is unchanged, and it is the contract that matters:
**the application server never handles image bytes**, and the database
stores an id, not a file.

---

## 1. Generate the secrets

On any machine:

```bash
openssl rand -base64 32   # MINIO_ROOT_PASSWORD
openssl rand -hex 32      # IMGPROXY_KEY
openssl rand -hex 32      # IMGPROXY_SALT
```

`IMGPROXY_KEY` and `IMGPROXY_SALT` must be **hex, 64 characters each**.
Without them imgproxy will resize anything anyone points it at, on your CPU.

## 2. Create the stack in Portainer

**Stacks → Add stack → Repository**

| Field | Value |
|---|---|
| Repository URL | `https://github.com/Autisync/Ngueza_events` |
| Reference | `refs/heads/main` |
| Compose path | `deploy/media/docker-compose.yml` |

Or choose **Web editor** and paste `docker-compose.yml`.

## 3. Set the environment variables

Paste into Portainer's *Environment variables* box (advanced mode). Start
from `stack.env.example`.

The one that catches everyone:

> **`MINIO_PUBLIC_URL` must be the URL the browser actually uses.**
> Presigned uploads are signed for that exact host. If it says
> `http://minio:9000` but the browser talks to `https://media.ngueza.com`,
> every upload fails with `SignatureDoesNotMatch` and no other clue.

## 4. Deploy, then check

```
Container            Status
ngueza-minio         healthy
ngueza-imgproxy      healthy
ngueza-minio-init    exited (0)   ← correct: it creates the bucket and stops
```

`ngueza-minio-init` is expected to exit. It creates the bucket, marks it
publicly readable, and finishes. It re-runs on every stack start and is
idempotent.

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://media.ngueza.com/minio/health/live
curl -s -o /dev/null -w '%{http_code}\n' https://img.ngueza.com/health
```

## 5. Put TLS in front

Both containers speak plain HTTP. Terminate TLS at whatever you already
run — Nginx Proxy Manager, Traefik, Caddy — and publish two hostnames:

| Hostname | → | Notes |
|---|---|---|
| `media.ngueza.com` | `ngueza-minio:9000` | Must accept `PUT`. Raise the body limit to at least 20 MB. |
| `img.ngueza.com` | `ngueza-imgproxy:8080` | Read-only. Cache aggressively — responses carry a 30-day `Cache-Control`. |

Do **not** expose the MinIO console (`:9001`) publicly. Reach it over your
VPN, or bind it to localhost.

## 6. Point the application at it

In the app's environment:

```bash
MEDIA_S3_ENDPOINT=http://ngueza-minio:9000        # server-side, internal
MEDIA_S3_PUBLIC_ENDPOINT=https://media.ngueza.com  # what the browser uses
MEDIA_BUCKET=ngueza-media
MEDIA_REGION=us-east-1
MEDIA_ACCESS_KEY_ID=ngueza
MEDIA_SECRET_ACCESS_KEY=<MINIO_ROOT_PASSWORD>
IMGPROXY_PUBLIC_URL=https://img.ngueza.com
IMGPROXY_KEY=<hex>
IMGPROXY_SALT=<hex>
```

## 7. Prove it works

```bash
cd deploy/media && docker compose up -d
npm run test:media
```

Seven assertions: a presigned browser upload, downscale-and-convert,
thumbnail from the same original, long cache headers, a tampered signature
refused, an expired URL refused, and a content-type mismatch refused.

Verified locally against these images: a **1600×1067 PNG of 139 KB**
delivered as a **640×427 WebP of 3 KB** — 45× smaller — and a thumbnail of
668 bytes. That is §41 and §42 in one number.

---

## Operating it

**Backups.** `minio-data` is a Docker volume. It is not backed up by
anything. Supplier photographs are irreplaceable — a supplier will not
re-shoot their venue because your disk died. Add it to whatever runs your
Postgres backups (§39).

**Storage growth.** Roughly 2 MB per supplier photo, ten photos each: about
20 GB per thousand suppliers. Watch it; MinIO will fill the disk silently.

**Video.** Not in this stack, deliberately. §40 is right that video costs
escalate, and v1 caps it at two per supplier. Decide with real demand data.

**Swapping back to Cloudflare.** `lib/media.ts` defines a `MediaStore`
interface with one implementation. Adding a Cloudflare one is a new class
and an environment variable — no caller changes.
