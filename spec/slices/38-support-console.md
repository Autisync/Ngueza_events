# Slice 38 — the support console

**Status:** done. Admin two-factor sign-in (also in R040) is its own slice.
**Closes:** competitive review R040 (P0), except MFA.

## Why

Answering "where is my booking?" meant hopping between the supplier
queue, payments and the audit log, with no way to search by what the
caller actually has (a reference, an email, a phone number) and no shared
memory of what the team had already done.

## What changes

- **`/admin/consola`**: one search box. It accepts:
  - an 8-character **booking reference** (either case);
  - a client **email** or **name**;
  - a **phone** number, with at least 6 digits, matched however it was typed;
  - a supplier **name, slug, email or phone**.

  It returns matching bookings, people and suppliers. `%` and `_` are
  searched as text.
- **`/admin/consola/reserva/[id]`**: the booking with both parties' contacts
  and terms, and a **timeline** in time order:
  - state changes, with who made them;
  - payment proofs, and when they were reviewed;
  - every email sent (to whom, and whether it was delivered);
  - help requests quoting the booking's reference;
  - the team's notes.
- **Internal notes** (`admin_notes`, 0040) on a booking, supplier or
  person. Only admins can read or write them; they're append-only, so not
  even an admin can edit or delete one.
- "Consola" in the admin nav.

## Acceptance

- [x] Finds a booking by reference, a client by email, name or phone digits, and a supplier by name.
- [x] Wildcards are treated as text; one-character queries return nothing.
- [x] A non-admin gets nothing about anyone else.
- [x] The timeline holds state changes, emails and notes, in time order.
- [x] Notes: admins only; append-only for everyone.
- [x] Both pages render with real data locally.
