# Slice 05 — media pipeline

**Status:** infrastructure done and proven; the upload UI waits on auth.
**Ownership:** agent + review.

## Departure from the plan

The build dossier specified Cloudflare Images + R2. NGUEZA already runs
Portainer, so media is self-hosted instead: **MinIO** for storage,
**imgproxy** for delivery. Stack and instructions in `deploy/media/`.

The §40 contract is what mattered, and none of it changed:

1. The application server never handles image bytes — the browser PUTs to
   a presigned URL.
2. Resizing and format conversion happen on **delivery**, not upload, so
   one original serves every size.
3. The database stores an id and nothing heavier.

`lib/media.ts` defines a `MediaStore` interface with one implementation.
Cloudflare becomes a second class and an environment variable if the
hosting decision ever reverses.

## Measured

A 1600×1067 PNG of **139 KB**, uploaded once, delivered as:

| Variant | Size | Bytes |
|---|---|---|
| `card` | 640×427 WebP | **3 078** — 45× smaller |
| `thumb` | 160×120 WebP | **668** — 209× smaller |

That is §41 and §42 in one number: the search grid on a phone loads five
cards for about 15 KB of imagery.

## Security

- imgproxy URLs are HMAC-signed. Unsigned, it will resize anything anyone
  points it at, on your CPU. A tampered signature returns 403.
- Presigned uploads sign the content-type, so a `.png` URL cannot be used
  to store HTML.
- Uploads expire in five minutes.
- Only JPEG, PNG, WebP and AVIF are accepted. **SVG is refused** — it is a
  document format that executes script, not an image format.
- EXIF is stripped on delivery, which removes GPS coordinates from photos
  suppliers take on a phone. They will not think about that; the pipeline
  has to.

## Verified

`tests/unit/media.test.ts` (14) covers the signing maths and always runs.
`tests/media/roundtrip.test.ts` (7) runs against real MinIO and imgproxy —
in CI too, since signing is either exactly right or completely broken and
unit tests alone cannot tell the difference.

## Waiting on auth

The supplier-facing upload UI: request a presigned URL, PUT from the
browser, record the id in `media`, reorder, set a cover, delete.

## Operating notes

`minio-data` is a Docker volume and nothing backs it up. A supplier will
not re-shoot their venue because a disk died — put it alongside the
Postgres backups (§39). Roughly 20 GB per thousand suppliers.
