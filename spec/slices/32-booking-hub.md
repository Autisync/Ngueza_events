# Slice 32 — the booking page as one hub, and cancellation terms up front

**Status:** done.
**Closes:** competitive review R022 and R012 (P0).

## Why

The client's booking page listed facts (status, dates, payments, tips) and
left the client to work out what to do next and by when. The deadline the
database enforces (`expires_at`) was never shown. Cancellation terms
appeared only as "se cancelar hoje: X%", so a client could not see when
that number would drop, and before booking they couldn't see the terms at
all.

## What changes

**"Próximo passo" leads the booking page.** One card saying what happens
next, by when (the booking's own `expires_at`), and the one action to take:

| Status | Says | Action |
|---|---|---|
| requested | Waiting for the supplier, until the deadline; the date is not held yet | — |
| accepted | The payment request (amount and how) will arrive | Contact the supplier, when they published a number |
| awaiting_payment, no proof yet | "Pague 540 000,00 Kz e envie o comprovativo", by the deadline, or the date is released | Enviar comprovativo |
| awaiting_payment, proof sent | Waiting for the supplier to confirm; the date is kept until the deadline | — |
| confirmed | "Faltam N dias", and where | Ver no mapa |
| completed, review possible | "Como correu?" | Avaliar |

The summary also shows **where** (address and município, without repeating
the município) and the **booking reference**.

**Cancellation, dated.** Under "Se cancelar hoje", each tier as a real
date and time: "Até 20 de abril de 2027 às 10:00 — 100% de volta".
Cut-offs already gone by are struck through.

**Cancellation, before booking.** The supplier page's "Solicitar reserva"
shows the policy relative to the event ("Com pelo menos 30 dias de
antecedência — 100%"), to visitors too.

## Correctness

The steps mirror `compute_refund_pct()` (0026): the highest tier whose
`days_before` is at most the notice given, measured to the minute from the
event's start. An integration test checks each printed cut-off against the
database: at the cut-off minute the printed percentage applies, and one
minute later the next one down does.

A tier paying the same as what applies below it is not printed. The
platform default ends in an explicit 0% tier, which printed "0%" twice.
Dropping it never changes the outcome. The first version also moved the
lower tier's start date, which would have changed outcomes; the unit test
for two 50% tiers now pins that.

## Acceptance

- [x] Every live status has one next step with the real deadline; closed bookings have none.
- [x] The amount due now is in the title of the payment step; the step changes once a proof is sent.
- [x] A confirmed booking counts the days in Luanda time and links to the address on a map.
- [x] The contact action appears only when the supplier published a number.
- [x] Dated cancellation steps match `compute_refund_pct()` at every cut-off and one minute after.
- [x] The supplier page shows the relative tiers before sign-in.
- [x] No duplicate "0%" lines; collapsing tiers never moves a boundary.
