# Slice 01 — Schema, RLS, constraints, seed

**Status:** done.
**Ownership:** human. This is the contract; it is not generated.

## What landed

- 11 migrations, applying cleanly from an empty database.
- `supplier_type` splitting venues from services, with separate enforcement.
- `bookings_no_double_booking` exclusion constraint (§27).
- Booking state machine with expiry deadlines (§26) and an append-only audit
  trail (§38).
- Categories and locations as self-referencing trees (§43, §44).
- Price as a spectrum: exact, from, range, on request.
- `newsletter_subscribers` with a consent audit trail (§37).
- `events` table — the phase-two gates read from this and none of it can be
  backfilled.
- Row-level security on every table, asserted in `tests/sql/02_rls.sql`.

## Verified

| Assertion | Where |
|---|---|
| Overlapping venue bookings are refused by the database | `tests/sql/01_constraint.sql` |
| A venue booking without a resource is refused | same |
| Service concurrency respects `concurrency_limit` | same |
| Illegal state transitions are refused | same |
| `booking_events` is append-only | same |
| Anonymous visitors see only verified, published suppliers | `tests/sql/02_rls.sql` |
| Supplier A cannot read supplier B's bookings | same |
| A supplier cannot self-verify or publish unverified | same |
| A client cannot escalate to admin | same |
| The newsletter list is not readable by clients | same |
| Anonymous visitors can still join the waitlist | same |
| 50 simultaneous bookings for one slot → exactly one wins | `tests/concurrency.sh` |
| 50 simultaneous bookings at a service with limit 2 → exactly two win | same |

## Open questions carried forward

These block later slices and are not the engineer's to answer:

1. Venues only at launch, or venues and services together?
2. Free listing permanently, or subscription at month four?
3. Does the free period start at registration or at public launch?
4. Is NGUEZA a service provider or an intermediary (§51)?
