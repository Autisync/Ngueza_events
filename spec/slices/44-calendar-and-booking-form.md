# Slice 44 — a month calendar you can tap, and a booking form that says what's wrong

**Status:** done.
**Closes:** competitive review R007 (month calendar), R014 (multi-day
events, inline form errors) and R011 (a call to action you can reach on a
phone).

## What changes

**A real month on the supplier page.**
- The fixed "next 28 days" strip becomes a calendar month, Monday first,
  with weekday headings. ‹ and › move between months (`?mes=YYYY-MM`).
- You can't go back before the current month or more than 18 months ahead.
  A malformed `mes` shows the current month.
- Each space (`resources` row) gets its own grid, as before. Availability
  still comes from `resource_is_free` through `availability()`. Nothing is
  computed in application code.
- Past days are muted. Busy days are struck through.
- A free day is a link: `?mes=…&data=YYYY-MM-DD&espaco=<resource id>#reservar`.
  It opens the form with that date and that space already chosen, and the
  day stays highlighted. No JavaScript.
- Example (demo) profiles show the calendar but their days aren't links.

**Multi-day events.**
- "Até ao dia" (optional) sits next to the date.
- `eventWindow(date, start, end, endDate?)` moved to `lib/booking-labels.ts`,
  because a `'use server'` file may only export async functions.
- An end date before the start, a date that doesn't exist, or more than 7
  days in total is refused with `erro=fim`.
- The past-midnight rule is unchanged: 20:00–02:00 on one day ends the next
  morning.
- The double-booking constraint covers the whole range, as it always has.

**Errors next to the field.**
- The summary at the top stays (now `role="alert"`).
- The field at fault is also outlined in red, gets `aria-invalid` and
  `aria-describedby`, and has its own message underneath:
  - date: `passado`, `fim`, `dados`, `data_indisponivel`;
  - phone: `telefone`;
  - the Terms checkbox: `aceitar`.
- After an error the form keeps the chosen date and space. The date is
  dropped when it is the problem (`passado`, `data_indisponivel`).

**A form that fits a phone.**
- Date, end date, start and end time are two by two on a phone, four across
  from 720px.
- A sticky bar at the bottom shows "Desde <lowest price>" (or the supplier's
  name) and "Solicitar reserva", jumping to the form.
- It is `position: sticky` inside `<main>`, so it never covers the footer.
- It is hidden from 720px, on example profiles, and while bookings are
  paused.

## Acceptance criteria

- [x] `monthGrid`: Monday-first blanks (Sunday 1st gives 6, Monday 1st gives
      0), real month lengths including leap years, year roll-over both
      ways, Portuguese month names (unit).
- [x] `clampMonth`: defaults, never in the past, at most 18 months ahead
      (unit).
- [x] `eventWindow`: past midnight, Luanda offset, two days, same-day end
      date, refusals (unit).
- [x] Tapping a free day opens the form with that date and space (checked at
      390px against the seeded database).
- [x] A busy day isn't a link.
- [x] A bad phone number gives an inline error, and the date is kept.
- [x] A 16→17 December request is stored as 18:00→02:00 Luanda.
- [x] `npm run gates` green.
