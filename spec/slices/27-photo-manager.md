# Slice 27 — supplier photo manager

**Status:** done.
**Ownership:** agent + review.
**Closes:** competitive review R026 (photo manager, P0) and R006 (gallery);
the "waiting on auth" half of slice 05. Partly closes C002 (enforced upload
size limits).

## Why

The `media` table has existed since migration 0004, and slice 23 wired up
real photo rendering. But nothing let a supplier put a row in that table, so
every listing in search and on its own page showed a grey placeholder. On a
venue marketplace, photos are what a client checks first.

## What a supplier can do

`/painel/[providerId]/fotos`, linked from a new "Fotografias" card at the top
of the supplier dashboard (it shows the count and the first thumbnails):

- **Add** several photos at once, up to 30 per listing. The browser uploads
  straight to the media bucket with a presigned URL (§40): the app server
  never sees the bytes.
- **Prepared on the phone.** Every photo is redrawn through a canvas and
  re-encoded as JPEG, at most 2560px on the long side, before upload.
  Delivery never serves more than 2048px, so clients see no difference.
  The supplier sends far less over paid mobile data, and the canvas carries
  pixels only: EXIF (GPS, camera serial, timestamp) never reaches storage.
- **Make cover.** The cover is what search cards and the top of the supplier
  page show.
- **Reorder** the rest with "← Antes" / "Depois →".
- **Caption** each photo. The caption is the alt text and is shown on the
  gallery.
- **Remove**, with a two-tap confirm that works without JavaScript. The
  original is also deleted from storage, so a removed photo is gone rather
  than merely unlisted.

Arranging photos works without JavaScript; only uploading needs it. The
`<noscript>` text says so plainly, as the document upload already does.

## What a client sees

`/fornecedor/[slug]`: the hero is now a swipeable CSS scroll-snap gallery of
every photo, with a "2 / 5" counter and the caption. It needs no script and
is keyboard-scrollable. The first photo is loaded eagerly at high priority
because it is the LCP element. The decorative dots that pretended to be a
carousel are gone.

## Rules the database enforces (0032)

| Rule | How |
|---|---|
| An object key belongs to the provider it is filed under | `media_external_id_in_provider_prefix` check, so a tampered client cannot claim another listing's photo |
| At most 30 photos per listing, even under concurrent uploads | `media_00_before_insert` under a per-provider advisory lock |
| Exactly one cover whenever there are photos | First upload becomes the cover (same lock). `media_promote_cover` promotes the next photo when the cover is removed |
| New photos go last | `sort_order` set to max + 1 on insert |
| A row's object, owner and kind never change | `media_guard_identity` |
| The public sees photos only of a listing it may see | `media_public_read` now uses `provider_is_public()`, so a suspended owner's photos disappear with the listing |

## Photo metadata

Asked during review: are photo metadata stored? The database stores none.
`media` holds an object key, an optional caption, the order and the cover
flag; no filename, size, camera data or location. Before this slice,
originals could still reach storage carrying EXIF, and that storage was
public:

| Layer | Before | Now |
|---|---|---|
| Upload | Re-encoded only when large; a small photo went up untouched, EXIF and GPS included | Always re-encoded on the device, so no EXIF leaves the phone. If the browser cannot decode the file, the original goes up and the next two rows still cover it. |
| Media bucket | Anonymously readable. The source path is base64 inside every imgproxy URL, so anyone could fetch the original. | Private (`mc anonymous set none`). `wait-ready.sh` refuses to continue if it answers anonymously. |
| Delivery | imgproxy strips metadata (`IMGPROXY_STRIP_METADATA`) | Unchanged. imgproxy reads with its own credentials, so photos still load. |

**Production:** restarting the media stack re-runs `minio-init`, which closes
the existing bucket. Confirm afterwards that an anonymous GET on
`/ngueza-media/` returns 403. Photos uploaded before this change may still
carry EXIF in storage. They are no longer public, and imgproxy strips the
metadata on delivery.

## Upload size is enforced by storage

Presigned PUTs now sign `content-length` along with `content-type`. Storage
rejects a body of any other length, so the 20 MB limit the route checks is
the size that actually lands. Before this, a client could declare 1 KB and
upload 5 GB. The same binding now applies to verification documents and
payment proofs (10 MB).

## Acceptance

- [x] A supplier can add, caption, reorder, choose the cover of, and remove photos for their own listing.
- [x] Nobody else can add or change photos on that listing (RLS, asserted per role).
- [x] A row pointing at another provider's object is refused by the database.
- [x] Three simultaneous uploads into the last free slot: exactly one succeeds.
- [x] Four simultaneous first uploads: exactly one cover.
- [x] Removing the cover promotes the next photo.
- [x] Visitors see photos of verified, published, active listings only.
- [x] The supplier page shows every photo, swipeable, with no script.
- [x] Presign refuses: other origins (403), SVG (415), > 20 MB (413), someone else's listing (403). Recording someone else's key gets 400.
- [x] A signed upload URL refuses a body larger than the declared size (`tests/media`, against real MinIO in CI).
- [x] No EXIF leaves the phone; original files are not anonymously readable, and photos still load through imgproxy.

## Verified

- `tests/integration/photos.test.ts` (17 tests).
- `tests/unit/media.test.ts`: content-length and DELETE signing (+4).
- `tests/media/roundtrip.test.ts`: sized upload; oversized refused; originals not anonymously readable or listable; imgproxy still serves; delete removes the object (+5; runs in CI against real MinIO).
- By hand, locally at 390px and desktop: add, cover, move and remove; the gallery swipe; on-device shrink (a 3.3 MB 4000×3000 PNG was sent as a 1.3 MB JPEG); the API guards above.
- Metadata: a small JPEG carrying an EXIF block with GPS coordinates was fed to the upload component. The bytes it would PUT contained neither the EXIF header nor the coordinates.

## Not in this slice

- **Orphaned objects.** A photo uploaded but never recorded (the tab closed
  between PUT and record) stays in the bucket. That needs a periodic sweep
  comparing bucket keys to `media.external_id`.
- **Video.** The schema allows 2 per provider; there is no UI for it.
- **Event-type tags** (`media.event_type`: casamento, aniversário…), for
  filtering the gallery by occasion.
- **Drag-to-reorder.** The buttons work everywhere, including without JS;
  drag can be layered on later.
