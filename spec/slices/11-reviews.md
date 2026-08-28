# Slice 11 — reviews

**Status:** done.
**Ownership:** agent + review.
**Depends on:** 01 (schema — `reviews` already existed), 02 (auth), 08/09 (a completed booking to review).

## User stories

- As a client whose booking reached `completed`, I can leave a rating and
  comment on the supplier, and it carries the "Reserva Verificada" seal
  because it is tied to a real booking of mine.
- As a supplier, I can see every review on my business and reply once —
  never edit the rating or comment itself.
- As anyone, I see a provider's reviews on their public page: verified
  ones first, star rating, comment, and the supplier's reply if any.

## The schema already existed; the feature did not

`reviews`, its RLS, and `reviews_derive_verified()` were all built in
slice 01/06 (`supabase/migrations/0007_reviews_reports.sql`,
`0011_rls.sql`) — the aggregate rating even already rendered on the public
provider page as `★ 4.8 · 12 avaliações` with schema.org markup. What
slice 11 adds is everything that produces a review in the first place:
`lib/reviews.ts`, the two forms, and a public list.

## Two real gaps, found before any UI was built on top of them

**A supplier could never actually reply.** `reviews_guard_reply()` (0011)
exists specifically to let a supplier touch only the reply columns on
someone else's review — but `reviews`' only UPDATE policy,
`reviews_author_update`, requires `author_id = auth.uid() or is_admin()`.
A supplier who is neither is filtered out by RLS before the trigger's
body ever runs, and it fails silently: `UPDATE 0`, no exception. Exactly
CLAUDE.md's "an empty result is not the same as no constraint," on the
write side rather than the read side. Fixed in
`supabase/migrations/0022_reviews_supplier_reply.sql`: a second,
permissive `reviews_supplier_reply` UPDATE policy scoped to
`owns_provider(provider_id)`. Permissive policies OR, so this doesn't
loosen anything for the author — it only opens the door the trigger was
already built to guard. While in there, `reviews_guard_reply()`'s own
column list was widened from three columns (`rating_overall`, `comment`,
`status`) to every column but the reply ones — the old list would have
let a supplier who reached the row also move a review to a different
business they own, or edit any of the five sub-scores.

**Nowhere for a review to get a byline.** `profiles` has exactly two read
policies — self, and admin — no public read at all. A public reviews list
joining straight to `profiles` for the author's name gets `NULL`, which
reads as "reviews have no author" rather than the missing grant it is.
Same shape as `resource_is_free()`: `review_display_name()` (0023), a
`SECURITY DEFINER` function returning only "Ana C." — first name plus a
last initial — never the row, so nothing about `profiles`' RLS boundary
widens for it.

**A third thing, caught for free**: writing the reproduction for the
first gap hit `permission denied for schema auth` locally, from
`reviews_guard_reply()`'s own `auth.uid()` call. Checked directly against
live Supabase first (`has_function_privilege('authenticated',
'auth.uid()', 'execute')` — true there) before touching anything, since
assuming the fix without checking would have been the same mistake in a
new shape. Real Supabase already grants `anon`/`authenticated` that; the
local shim (`tests/bootstrap/00_auth_shim.sql`) only ever granted
`service_role`, because nothing had called `auth.uid()` from a
non-`SECURITY DEFINER` function before. Fixed there, not in a migration —
it was never a production bug, only a shim that didn't match what it was
standing in for.

## Why a review always carries a real booking here

The schema allows `booking_id` to be null — "so other review types can be
allowed later without a migration," per its own comment — and an insert
with someone else's booking, or no booking at all, still succeeds; it
just derives `is_verified = false` rather than being refused. This app's
only entry point is `/reservas/[id]` when `status = 'completed'`, which
always supplies the caller's own booking. `lib/reviews.ts`'s
`createReview()` doesn't duplicate that check server-side — the
derivation already produces the correct `is_verified` for whatever gets
sent regardless, matching "the database is what decides" rather than
re-asserting a rule the trigger already enforces. Tested directly: a
review naming a booking that isn't completed, or belongs to someone else,
still succeeds and comes out correctly unverified.

## What landed

- `lib/reviews.ts` — `createReview`, `replyToReview`, `providerReviews`,
  `reviewExistsForBooking`. Same shape as `lib/booking.ts`: thin,
  translates constraint violations, no re-derived business logic.
- `app/review-actions.ts` — `doLeaveReview`, `doReplyToReview`.
- The provider page's new "Avaliações" section (verified badge, stars,
  comment, reply).
- `/reservas/[id]`'s new review form, shown only when `completed` and
  unreviewed.
- `/painel/[providerId]/avaliacoes` — every review on the business, with
  an inline reply form that disappears once replied.

## Verified

- 11 new integration tests (`tests/integration/reviews.test.ts`) — 144
  total, all green. Includes the two derivation edge cases above, the
  reply boundary, and the one-review-per-booking rule.
- Full gate suite, including `db-test.sh`'s RLS/constraint/concurrency
  assertions.
- `scripts/verify-remote.sh` gained a supplier-reply check — asserted
  against live Supabase, not just locally, so this specific regression
  (RLS policy present but incomplete) cannot silently return.
- End-to-end against live Supabase with JavaScript disabled: sign in,
  leave a review on a completed booking, see it publicly with the
  verified seal and a privacy-safe author name, sign in as the supplier
  and reply, see the reply publicly. Then the negative cases through the
  real app, not just SQL: a second review on the same booking refused
  (`already_reviewed`, form gone from the page too), and an unrelated
  supplier's crafted reply POST refused (`not_found`, reply column
  unchanged in the database afterward). All test data and all three
  identities deleted from the live project afterward.

## Not in this slice

Reporting a review (`reports.target_type = 'review'`) — the table and the
admin queue (slice 12) already exist, but nothing public offers the
"denunciar" action yet, for any target type. Left for whenever that
lands generally rather than one-off for reviews.
