# Slice 09 — the booking loop (domain layer)

**Status:** done — domain layer, plus the screens as slice 08.
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

## A real authorization gap, found while building slice 08

Before writing the "Accept" / "Reject" buttons (slice 08), it was worth
testing what actually stops a client from calling the same underlying
`transition()` on their own booking — a UI control is not an
authorization boundary, and the database is where that boundary needed
to already hold. The answer was nothing.
`bookings_party_update`'s RLS only checked that the actor was *a* party
to the booking — `client_id = auth.uid() OR owns_provider(provider_id)`
— never which transition that specific party was entitled to make. A
client could set their own request straight to `accepted` and then
`confirmed`, with zero supplier action, entirely within RLS's rules as
written.

Confirmed directly, and a genuine gotcha along the way: the first attempt
gave a false negative because it connected as the `postgres` superuser,
which bypasses RLS unconditionally regardless of any JWT claim set — the
same trap `rolbypassrls` sets for any ad-hoc debugging session that
forgets `SET LOCAL ROLE authenticated` first. Reproduced properly against
the real role, fixed with `bookings_guard_actor` (0021) — a trigger that
enforces `spec/states.md`'s "Who may trigger what" table precisely,
including that `→ expired` has no exception even for an administrator —
and reproduced fixed against Supabase directly, inside a transaction that
was never committed.

`transition()` now returns `{ ok: false, reason: 'not_allowed' }` for a
genuine party attempting the wrong role's transition, distinct from the
existing `not_found` a complete stranger to the booking still gets — RLS
filters a stranger's row out before 0021's trigger ever runs, so that
privacy property (§ "a distinguishable error would let a stranger probe
for other people's bookings") holds for both cases without this file
needing to special-case it.

See `tests/integration/booking.test.ts`'s `who may drive a transition
(0021)` block (11 tests) and `spec/states.md` for the full rule.

## Screens

The supplier accept/reject screen, client booking form, "as minhas
reservas", and the supplier calendar with manual blocking landed as
slice 08 — see `spec/slices/08-booking-screens.md`. They add nothing to
the rules on this page; they just render them.
