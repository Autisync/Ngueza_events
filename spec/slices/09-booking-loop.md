# Slice 09 — the booking loop (domain layer)

**Status:** domain layer done; the supplier and client screens wait on auth.
**Ownership:** agent + review.

## Why only the domain layer

The screens need a signed-in client and a signed-in supplier, which needs
slice 02, which needs a Supabase project. The logic does not — the state
machine, the deadlines, the exclusion constraint and the audit trail all
live in the database — so it is built and tested now, and the screens
become thin when auth lands.

## What landed

`lib/booking.ts`:

- `requestBooking` — the availability check **is** the INSERT. Reading
  "is this free?" and then writing is a race; the database refuses the
  second write and we translate `23P01` into a readable reason.
- `transition` — the database refuses anything `spec/states.md` does not
  permit, so this cannot drift from the spec.
- `blockDate` — a walk-in booked in person (§27), modelled as a booking so
  it collides through the very same constraint. There is no second code
  path that could disagree with the first.
- `expireStaleBookings` — §26. `POST /api/cron/expire`, every five minutes,
  guarded by a shared secret because it runs as the service role.

## Two decisions worth stating

**A pending request does not hold a date.** Blocking on request would let
anyone freeze a supplier's calendar for 48 hours for free. Only
`awaiting_payment`, `confirmed` and `blocked` occupy a slot.

**`requestBooking` pre-checks availability anyway** — as a courtesy, not a
guarantee. Without it a client can request a date the supplier could never
confirm, and only finds out days later. That read can race; the constraint
is still the only thing that decides.

**Someone else's booking returns `not_found`, never a permission error.**
A distinguishable error would let a stranger probe for other people's
bookings.

## Verified

`tests/integration/booking.test.ts` (10), including a race the pre-check
cannot catch: two bookings both reach `accepted`, and only one can confirm.

## Waiting on auth

Supplier accept/reject screen, client booking form, "as minhas reservas",
and the supplier calendar with manual blocking.
