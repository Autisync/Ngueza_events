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
- **Shrink on the phone first.** A photo longer than 2560px, or larger than
  1.5 MB, is re-encoded to JPEG on the device before upload, and the smaller
  file is kept. Delivery never serves more than 2048px, so clients see no
  difference. The supplier sends far less over paid mobile data, and EXIF
  (GPS included) is dropped before the file leaves the phone.
- **Make cover.** The cover is what search cards and the top of the supplier
  page show.
- **Reorder** the rest with "← Antes" / "Depois →".
- **Caption** each photo. The caption is the alt text and is shown on the
  gallery.
- **Remove**, with a two-tap confirm that works without JavaScript. The
  original is also deleted from storage, because the media bucket is
  publicly readable and a removed photo should not stay reachable.

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

## Verified

- `tests/integration/photos.test.ts` (17 tests).
- `tests/unit/media.test.ts`: content-length and DELETE signing (+4).
- `tests/media/roundtrip.test.ts`: sized upload, oversized refused, delete makes the public address stop answering (+3; runs in CI against real MinIO).
- By hand, locally at 390px and desktop: add, cover, move and remove; the gallery swipe; on-device shrink (a 3.3 MB 4000×3000 PNG was sent as a 1.3 MB JPEG); the API guards above.

## Not in this slice

- **Orphaned objects.** A photo uploaded but never recorded (the tab closed
  between PUT and record) stays in the bucket. That needs a periodic sweep
  comparing bucket keys to `media.external_id`.
- **Video.** The schema allows 2 per provider; there is no UI for it.
- **Event-type tags** (`media.event_type`: casamento, aniversário…), for
  filtering the gallery by occasion.
- **Drag-to-reorder.** The buttons work everywhere, including without JS;
  drag can be layered on later.
