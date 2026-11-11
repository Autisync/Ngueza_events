# Slice 28 — release competing requests

**Status:** done.
**Closes:** competitive review C009 (P0).

## Why

A pending request doesn't hold a date (spec/states.md), so a supplier
could accept two clients for the same salão on the same day. Both saw
"Aceite — aguarda pagamento". When one paid, the other kept a booking that
could never be confirmed. Forty-eight hours later it expired, and the email
said nobody had acted in time. That was false, and the client had spent two
days of a short planning window waiting.

## What changes

- **A new terminal state, `unavailable`** ("Data indisponível"). When a
  booking starts to hold a venue's space (`awaiting_payment`, `confirmed`
  or `blocked`), every overlapping `requested`/`accepted` booking on that
  space moves to `unavailable` in the same transaction.
- **The client is told the truth, straight away.** The email says the date
  was booked by another client, that they owe nothing, and links to the same
  search (same date, zone and category). Their booking page shows the same
  thing, with a "Ver espaços livres nesse dia" button.
- **No second "aceite" for a held date.** Accepting a request for a space
  that is already held fails with the usual "Essa data já não está
  disponível".
- **Nobody sets `unavailable` by hand**, admin included. Only the database
  sets it.

Full rules, including why it isn't `expired`, `rejected` or
`cancelled_provider`, are in `spec/states.md` under "Releasing competitors".

## Two things found while building it

1. **`bookings_guard_actor` can't see who is acting.** It is
   `SECURITY DEFINER`, so `current_user` inside it is always the owner. The
   `unavailable` check therefore lives in a separate invoker-rights trigger,
   `bookings_guard_unavailable`. The first version put it in the definer
   function, and the test caught a client setting `unavailable` directly.
2. **A naïve release deadlocks.** If two overlapping accepted bookings are
   confirmed at once, each confirmation's release tries to update the
   other's locked row. The release therefore uses `FOR UPDATE SKIP LOCKED`
   and leaves that race to the exclusion constraint, as before. Tested
   concurrently, ten runs in a row: exactly one confirmation wins, with no
   errors.

## Acceptance

- [x] One booking starting to hold a date closes every overlapping request and acceptance on that space, and nothing on other dates.
- [x] The displaced client gets a `booking_unavailable` email carrying the date, zone and category for a new search.
- [x] A supplier blocking the date for an off-platform booking releases competitors too.
- [x] Accepting a request for an already-held date returns `slot_taken`.
- [x] Client, supplier and admin are all refused `→ unavailable`.
- [x] `unavailable` is terminal.
- [x] Two simultaneous confirmations of overlapping bookings: exactly one wins, no deadlock.
- [x] The 50-way concurrency gate still passes.

## Not in this slice

- **Services.** Capacity is a count of overlapping holds, so one more hold
  doesn't make a particular competing request impossible. A request that
  would exceed capacity is still refused (`23P01`) when the supplier tries
  to accept or confirm it.
- **Re-offering the date if the winner's hold lapses.** The released client
  is told they can request again. Nothing re-opens their old request
  automatically.
