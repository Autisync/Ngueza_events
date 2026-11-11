# Slice 48 — "As minhas reservas" you can read at a glance

**Status:** done.
**Why:** NGUEZA asked for better navigation and a less dull system. This
was the plainest screen a client returns to: one column of identical boxes
in creation order, with no sense of what needed them.

## What changes

The page groups bookings:
- **Precisa de si:** waiting for payment, so pay and send the proof.
  Outlined in the warning colour.
- **Próximas:** pedido enviado, aceite and confirmada, soonest first.
- **Anteriores:** everything past or closed, newest first, muted. A
  cancelled future date counts as past: it isn't happening.

Each row has:
- a calendar tile (day and month, Luanda time);
- the supplier;
- the date and time;
- one line saying what happens next, for example "À espera da resposta do
  fornecedor", "Pague ao fornecedor e envie o comprovativo", "É hoje",
  "Amanhã" or "Daqui a 34 dias";
- the status pill.

The header counts each group. The empty state has two ways forward:
Procurar and Pedir orçamento.

`groupClientBookings`, `dateTile` and `listHint` live in
`lib/booking-labels.ts` and are unit-tested. They compare dates as
timestamps because `BookingSummary.startsAt`, typed `string`, is a `Date`
at runtime (pg). That mismatch crashed the first version of this page.

## Acceptance criteria

- [x] Grouping and ordering, including a cancelled future date as past (unit).
- [x] Hints count days in Luanda, with "É hoje" and "Amanhã" (unit).
- [x] Checked at 390px with a booking in each group.
- [x] `npm run gates` green.
