# Slice 23 — the modern-marketplace visual direction, on the two live public surfaces

**Status:** done, scoped.
**Ownership:** agent + review.

## What this is

The approved direction from a design mockup (published separately, not
part of this repo), implemented on `/procurar` and `/fornecedor/[slug]`
— the two public surfaces that are actually live today. Image-forward
cards, real category tags (plural — slice 22's own payoff, made
visible), rating badges, larger radii, real photo rendering wired up
for the first time.

## Why not the homepage too

`app/page.tsx` is not a browsable marketplace today — it is a
deliberate pre-launch waitlist gate (see its own header comment:
"Ships before the platform exists... eight weeks before launch"). This
slice does not touch it. Silently turning a pre-launch waitlist page
into a live "browse now" homepage would end that phase without anyone
having decided to — a real product/go-to-market call, not a UI
question. Left alone on purpose, flagged rather than assumed.

## What landed

**Real photo rendering, wired up for the first time.** `lib/media.ts`'s
`imgproxyUrl()` has existed since the media pipeline slice, and its
`VARIANTS.card` comment even says *"3:2 search card"* — but nothing in
`app/` ever called it. `coverImageUrl(objectId, variant)` is the new
entry point: unlike `mediaStore()` (which correctly throws hard on
missing config, because a broken upload path is a real bug), this
never throws — no object, or media not configured, both mean "render
the placeholder", because a page showing a supplier is not the place
to fail loudly over infrastructure config. Used on both pages; falls
back to a styled placeholder in this environment, where no real photos
exist yet.

**`lib/search.ts`** — `SearchHit` gains `categoryNames` (slice 22's
matching made visible: what a result actually matched the search
through, not just its registered category), `ratingAverage` and
`reviewCount`.

**`lib/provider.ts`** — `PublicProvider` gains `photos` (cover-first,
then `sort_order`).

**`/procurar`** — cards rebuilt: a real photo or a styled placeholder,
a "✓ Verificado" badge (restated per-card because every search result
already is one — the same trust signal, not a differentiator within
results, matching every card the same way an Airbnb Superhost badge
does), a rating badge when reviews exist, and the plural category tags.
16px card radius, up from 6px.

**`/fornecedor/[slug]`** — a photo hero above the existing dark info
section (not replacing it — the crumb/name/seals stayed exactly where
they were, lower-risk than a full hero restructure), with dot
indicators when there's more than one photo. Multi-category tags
(landed in slice 22) sit alongside the new photo treatment. Radii
brought in line with `/procurar`'s 16px language.

## Verified

- Live, in a real browser, against the local seeded database (these
  two pages are `asVisitor` — no auth needed, so this is not blocked
  by the Supabase outage the way auth-gated pages are): both pages
  screenshotted before and after adding a real cross-category service
  to confirm the category tags actually appear when there's a second
  category to show, and stay absent when there isn't.
- The booking calendar on `/fornecedor/[slug]` re-verified working
  unchanged underneath the new hero — this slice is presentation only,
  the availability logic it sits on top of was not touched.
- 2 new unit tests for `coverImageUrl` (never throws; builds a real
  signed URL once configured) and 1 new integration test for the
  rating fields on a search hit.
- `scripts/check-js-budget.sh` run against both redesigned routes:
  still 169KB gzipped, 10KB of headroom — server-rendered markup and
  CSS add nothing to the client bundle.
- Full local gate suite green: typecheck, lint (0 errors), 62 unit
  tests, 170 integration tests, complete `db:test` suite (this slice
  adds no migration and touches no RLS — nothing at the database layer
  could regress). `npm run build` succeeds; `spec/schema.sql` unchanged.

## Deliberately out of scope

- The homepage (see above).
- Every other page in the app (`/conta`, `/painel`, admin, auth
  screens) — the mockup covered three surfaces; this implements the
  two of those three that are live and unblocked. `/painel`'s own
  quote-requests and cancellation screens, the admin dashboard, and
  the auth flow all still carry the pre-existing 6px-radius language.
  Extending the new direction further is a real follow-up, not
  something this slice tried to sneak in under one design approval.
