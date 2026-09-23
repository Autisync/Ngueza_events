# Slice 22 — multi-category discoverability

**Status:** done.
**Ownership:** agent + review.

## User story

A business registers once but offers more than one kind of service —
a salão that also runs its own buffet, a DJ who also does photography.
Today it registers under exactly one category, and that single
`providers.category_id` is the only thing search or a quote request
ever matches against. A second service tagged under a different
category is invisible to anyone looking for that category, even though
the form to add it already existed and already let a supplier pick any
category they wanted.

## What was actually missing

Not a schema gap. `services.category_id` has always been settable
independently per service — the add-service form
(`app/painel/[providerId]/page.tsx`) already offers every category, not
just the provider's own. The gap was entirely on the *discovery* side:
`lib/search.ts` and migration 0027's quote-request matching both only
ever read `providers.category_id`, so a service under a different
category quietly went nowhere.

## What landed

- **`lib/search.ts`** — the category filter now matches through
  `providers.category_id` **or** any of that provider's active
  services' own `category_id`.
- **`supabase/migrations/0028_multi_category_matching.sql`** — the same
  widening for quote-request matching: `quote_request_open_and_matches`
  (the offer-insert check), `quote_requests_matching_supplier_read`
  (RLS), and `enqueue_quote_request_notification` (the fan-out trigger)
  all now match through either route. No schema change — the data to
  match on already existed; this is three query bodies re-declared with
  a widened `where`.
- **`lib/provider.ts`** gains `PublicProvider.categoryNames: string[]`
  (the provider's own category plus every active service's, deduplicated,
  primary first) and `PublicService.categoryName`, so the public page can
  show what it's actually discoverable under.
- **`/fornecedor/[slug]`** shows the additional categories as tags, and
  labels each service with its own category — both **only when there is
  a second category to say**. A provider with one category shows exactly
  what it showed before; nothing new appears until a second category is
  genuinely true.

## Verified

- 4 new SQL assertions (`tests/sql/04_multi_category_matching.sql`): a
  venue matches a fotografia request through a listed service, can offer
  on it, and the fan-out notifies its owner — none of which was true
  before this migration.
- 3 new integration tests (`tests/integration/search.test.ts`,
  `tests/integration/provider.test.ts`): a real seeded provider (Salão
  Horizonte) verified invisible to a fotografia search before adding a
  photography service, then visible after; `categoryNames` and each
  service's `categoryName` verified both before (one category) and
  after (two) adding one.
- **Verified live**, not just against test fixtures: added a real
  photography service to Salão Horizonte in the seeded database, called
  `search()` and `getProvider()` directly, and confirmed both the
  search hit and the profile's `categoryNames` picked it up — same for
  the quote-request fan-out, checked directly against
  `notification_outbox`.
- Full local gate suite green: typecheck, lint (0 errors), 59 unit
  tests, 169 integration tests, the complete `db:test` suite (43 SQL
  assertions including the 50-way concurrency check) — none of the
  pre-existing coverage regressed.
- `npm run build` succeeds; `spec/schema.sql` regenerated for 0028.

## Deliberately out of scope

- **The visual redesign** ("modern marketplace" look — image-forward
  cards, a browse-first homepage). That's a separate, much larger
  effort currently waiting on a design-direction review (a mockup was
  published separately for that). This slice is the underlying data/
  discovery fix; the category tags added to `/fornecedor/[slug]` reuse
  the page's *existing* pill styling rather than anticipate a redesign
  that hasn't been approved yet.
- **A `provider_categories` join table.** Not needed — `services.
  category_id` already does the job. Revisit only if a provider ever
  needs to be discoverable in a category it has no service in at all,
  which nothing currently asks for.
