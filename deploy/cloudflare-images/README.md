# Media on Cloudflare — R2 + image Worker

Production media moved off the shared server (MinIO + imgproxy in
`deploy/media/`) to Cloudflare, so photo traffic no longer competes with
the mail server and everything else on that host.

| | Was | Now |
|---|---|---|
| Storage | MinIO container | **Cloudflare R2**, buckets `ngueza-media` and `ngueza-documents` |
| Resize + WebP/AVIF | imgproxy container | **This Worker** (`ngueza-images`), using the Images binding |

The §40 contract is unchanged: the browser uploads straight to storage with
a presigned URL, the app server never touches image bytes, and the database
stores only an object id. R2 speaks S3, so `lib/media.ts` presigns exactly as
before — only the endpoint, region and keys change.

`deploy/media/` stays for local development and CI. The app uses this Worker
when `IMAGES_PUBLIC_URL` and `IMAGES_KEY` are set, and imgproxy otherwise.

---

## What is already set up (Cloudflare dashboard)

- **Buckets** `ngueza-media` and `ngueza-documents`, Western Europe, Standard
  class. Both private: public access disabled, no public dev URL, no custom
  domain. Do not enable either — originals carry EXIF GPS data, and the
  documents bucket holds identity papers.
- **CORS** on both buckets, so the browser can upload directly:

  ```json
  [{
    "AllowedOrigins": ["https://www.ngueza.co.ao", "https://ngueza.co.ao", "http://localhost:3000"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }]
  ```

  A new site origin (a preview domain, a second hostname) must be added here
  or uploads from it fail with a CORS error in the browser console.
- **API token** `ngueza-app`: *Object Read & Write*, limited to those two
  buckets. Its Access Key ID and Secret Access Key are the app's
  `MEDIA_ACCESS_KEY_ID` / `MEDIA_SECRET_ACCESS_KEY`.

## Quick path — one script

From a **clean clone of `main`** (after this PR is merged):

```bash
git clone https://github.com/Autisync/Ngueza_events ngueza-setup
cd ngueza-setup
node scripts/cloudflare-setup.mjs
```

It signs in to Cloudflare and Vercel (a browser opens once for each),
generates `IMAGES_KEY` and `CRON_SECRET` locally without printing them,
deploys both Workers with their secrets, sets `IMAGES_PUBLIC_URL`,
`IMAGES_KEY` and `CRON_SECRET` on Vercel (Production and Preview), and
redeploys production. `--dry-run` prints the steps without doing them.
Steps 1–2 below are the same thing by hand.

## Scheduled jobs — `deploy/cloudflare-cron`

The booking expiry sweep and the email outbox run from a second Worker,
`ngueza-cron`, on Cloudflare's free cron triggers: expiry every 5 minutes,
email every 2. It POSTs to `/api/cron/expire` and `/api/cron/notify` with
`Authorization: Bearer $CRON_SECRET`. Vercel's free plan only runs cron
once a day, and this keeps the load off the shared server that the
Portainer cron stack (`deploy/cron/`) would have used.

By hand: `cd deploy/cloudflare-cron && npx wrangler deploy && npx wrangler
secret put CRON_SECRET`, with the same value as the app's `CRON_SECRET`.
Logs: dashboard → Workers → ngueza-cron → Logs. `/api/saude` turns 503 if
either job stops.

## 1. Deploy the Worker

From this folder, once, on any machine with Node:

```bash
cd deploy/cloudflare-images
npx wrangler login                      # opens the Cloudflare account in a browser
openssl rand -hex 32                    # → the IMAGES_KEY value; keep it for step 2
npx wrangler secret put IMAGES_KEY      # paste that value
npx wrangler deploy
```

`deploy` prints the URL, `https://ngueza-images.<subdomain>.workers.dev`.
Check it:

```bash
curl -s https://ngueza-images.<subdomain>.workers.dev/health   # → ok
```

Optional, later: add a custom domain such as `img.ngueza.co.ao` under
*Workers → ngueza-images → Settings → Domains*. That needs the domain's DNS
on Cloudflare. Then use that URL in step 2 instead.

## 2. Set the app's environment (Vercel → Settings → Environment Variables)

```bash
MEDIA_S3_ENDPOINT=https://cce9a71b770027027cfd86b8527b4954.r2.cloudflarestorage.com
MEDIA_S3_PUBLIC_ENDPOINT=https://cce9a71b770027027cfd86b8527b4954.r2.cloudflarestorage.com
MEDIA_BUCKET=ngueza-media
DOCUMENTS_BUCKET=ngueza-documents
MEDIA_REGION=auto
MEDIA_ACCESS_KEY_ID=<Access Key ID of the ngueza-app token>
MEDIA_SECRET_ACCESS_KEY=<Secret Access Key of the ngueza-app token>
IMAGES_PUBLIC_URL=https://ngueza-images.<subdomain>.workers.dev
IMAGES_KEY=<the same hex value given to wrangler secret put>
```

Remove `IMGPROXY_PUBLIC_URL`, `IMGPROXY_KEY` and `IMGPROXY_SALT` from
production once the Worker answers. Redeploy so the new values (and the CSP,
which reads `IMAGES_PUBLIC_URL`) take effect.

`MEDIA_REGION=auto` matters: R2 rejects a signature made for `us-east-1`.

## 3. Check it

1. As a supplier, upload a photo in *Painel → Fotografias*. It should appear
   with its thumbnail.
2. Open the photo's URL from the page: `content-type` is `image/avif` or
   `image/webp`.
3. Change one character of the signature in that URL: **403**.
4. Upload a verification document and open it from the admin review page:
   it loads through a short-lived signed link.

## Limits on the free plan

| | Free each month | Past it |
|---|---|---|
| R2 storage | 10 GB | $0.015 / GB-month |
| R2 writes (uploads, deletes) | 1 million | $4.50 / million |
| R2 reads | 10 million | $0.36 / million |
| Data out to visitors | free | free |
| Unique transformations | 5,000 | new sizes return 503 until the month resets; nothing is charged unless a paid Images plan is bought |

A unique transformation is one photo at one variant (thumb, card, hero,
full). Each photo uses at most four, so roughly 1,250 photos a month can be
newly viewed at every size before the cap. Repeat views are free.

When the cap is hit the Worker returns 503 rather than the original, on
purpose: the original still has its GPS metadata.

## Moving existing photos

Anything uploaded to the old MinIO stack is not in R2. If there are real
supplier photos there, copy them across before switching, keeping the same
keys (`{providerId}/{uuid}`), for example with `rclone copy` from MinIO to R2.
Object ids in the database do not change.
