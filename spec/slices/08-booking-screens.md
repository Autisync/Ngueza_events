# Slice 08 — booking screens

**Status:** done.
**Ownership:** agent + review.
**Depends on:** 02 (auth), 09 (booking domain layer).

## User stories

- As a signed-in client, I can request a date on a supplier's page, see the
  request's status change, and cancel it while it is still mine to cancel.
- As a signed-in supplier, I can see every request against my business,
  accept or reject it, walk it through to completion, and block a date I
  booked off-platform.

Nothing here decides *whether* a transition is legal or *who* may make it —
`spec/states.md` and `bookings_guard_actor` (0021) already do, and this
layer is deliberately thin: render the state, offer only the buttons that
transition allows, and translate the database's answer.

## Routes

| Route | Who | What |
|---|---|---|
| `/fornecedor/[slug]` (new `#reservar` section) | signed-in client | request a date |
| `/reservas` | signed-in client | list of their own bookings, newest first |
| `/reservas/[id]` | the client on that booking | detail, history, cancel |
| `/painel/[providerId]/reservas` | the business owner | request queue + manual block-date form (§27) |
| `/painel/[providerId]/reservas/[bookingId]` | the business owner | detail, history, role-appropriate decision buttons |

Every route works with JavaScript disabled — a plain `<form action={...}>`
posting to a server action, matching every other screen in this codebase.

## Acceptance criteria

- A visitor who is not signed in sees a sign-in prompt in place of the
  booking form, not a broken form.
- Submitting the booking form for a date the constraint refuses redirects
  back to the supplier page with `?erro=data_indisponivel`, and no booking
  row is created.
- A successful request redirects to `/reservas/[id]?novo=1` and the booking
  appears in `/reservas` immediately.
- `/reservas/[id]` and `/painel/[providerId]/reservas/[bookingId]` show the
  same booking, and only the state's legal next transitions render as
  buttons — e.g. a `requested` booking offers only "Aceitar" / "Rejeitar"
  to its supplier, an `accepted` one offers "Marcar como aguarda
  pagamento", "Confirmar directamente" and "Cancelar".
- A transition the database refuses (illegal, taken slot, or not this
  actor's to make) redirects back with `?erro=<reason>` and a Portuguese
  message from `lib/booking-labels.ts`'s `TRANSITION_ERROR`; the booking's
  status is unchanged.
- Blocking a date through the manual-block form makes that date refused to
  every client the same way a real booking would, and does not affect
  either neighbouring day.
- A client who is a genuine party to a booking but attempts a
  supplier-only transition (e.g. posting `to=confirmed` on their own
  `requested` booking) gets `not_allowed`, not a silent success — and
  cannot reach the supplier panel's page for a business they do not own at
  all, regardless of query string.
- A stranger to a booking gets `not_found` from every route that would
  otherwise reveal it exists.

## What landed

- `lib/booking-labels.ts` — Portuguese status labels, pill CSS-class
  mapping, `Africa/Luanda` date formatting, and the `TRANSITION_ERROR`
  copy table. Pure, no `server-only` needed.
- `app/booking-actions.ts` — the four server actions
  (`doRequestBooking`, `doClientCancel`, `doSupplierTransition`,
  `doBlockDate`), each a thin zod-validated wrapper around
  `lib/booking.ts`. `doSupplierTransition` allowlists `to` against
  `BookingStatus` before calling `transition()` — the database is still
  what actually enforces who may make which transition, this just avoids
  sending it garbage.
- `lib/booking.ts` gained the read side: `clientBookings`,
  `providerBookings`, `bookingDetail` — RLS scopes all three, this layer
  just shapes the result and orders it (newest / soonest-decision first).
- Five new pages (`app/reservas/`, `app/reservas/[id]/`,
  `app/painel/[providerId]/reservas/`,
  `app/painel/[providerId]/reservas/[bookingId]/`) plus a booking section
  added to `app/fornecedor/[slug]/page.tsx`, and a "Reservas" link added
  to both `app/conta/page.tsx` and `app/painel/[providerId]/page.tsx`.

## A CSS bug this slice's audit caught, not manual review

`admin.module.css` and the new `app/reservas/reservas.module.css` both use
bare `.wait/.ok/.bad/.off` pill classes. `app/painel/painel.module.css`
does not — it combines a base `.pill` with `.pillWait/.pillOk/.pillBad/
.pillOff`, and had no `.row`/`.actions`/`.btn`/`.go`/`.no`/`.audit`/`.when`
rules at all. Writing the supplier pages against the first convention
would have compiled and built cleanly while silently rendering unstyled
class names in production.

Caught by grepping every `styles.<name>` reference in the new files against
its actual CSS module rather than by inspection. Fixed two ways: a small
`PILL_CLASS` mapping constant local to the two supplier pages (documented
inline as deliberate, not a second naming convention), and the missing
decision-button/history rules added to `painel.module.css`, matching
`admin.module.css`'s existing pattern for the same shape.

## Verified

- `tests/integration/booking.test.ts`'s `reading bookings` block (6 tests):
  a client's own list stays scoped to them, a supplier's list stays scoped
  to their business, and `bookingDetail` returns `null` rather than
  another party's data.
- Full gate suite: `npm run gates` — 49 unit, 128 integration, and
  `db-test.sh`'s RLS/constraint/50-way-concurrency assertions, all green.
- End-to-end against the real, live Supabase project (not a local shim):
  two throwaway identities provisioned through migration 0016's trigger,
  a published venue seeded under the owner, the full journey driven with
  JavaScript disabled — sign in, request, accept, confirm, complete,
  block a date, and a client's own date clash against that block — each
  step re-fetched and read back from the actual response, not assumed.
  Also re-proved the 0021 authorization fix through the real app rather
  than only the database: a client who is a genuine party to a *different*
  booking cannot force it to `confirmed` by posting directly to the
  supplier's server action (`not_allowed`, status unchanged), and cannot
  even load the supplier panel page for a business they do not own
  (redirected to `/painel` regardless of query string). All test rows,
  bookings, and both identities were deleted from the live project
  afterward.

## Not in this slice

Payment. `awaiting_payment` and `confirmed` are both reachable by a
supplier's own hand ("Confirmar directamente") because §16's payment
adapter is explicitly on the never-automate list — a human decides when
money has actually moved.
