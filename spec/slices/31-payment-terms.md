# Slice 31 — payment terms, and the proof in front of the supplier

**Status:** done.
**Closes:** competitive review R019 and R020 (P0).

## Why

A booking moved to "aguarda pagamento" with no amount, no deposit and no
way to pay. The client's email said "contacte o fornecedor". The supplier's
booking screen showed **no payments at all**, so "Confirmar pagamento
recebido" was pressed without seeing the proof the client had uploaded. And
once an administrator found a proof plausible, the client saw
**"Confirmado"**, which reads as "the money arrived". `total_minor` had
existed since 0006, but nothing ever set it.

NGUEZA still never receives, holds or moves money (slice 16). This slice
records what the two parties agreed and shows it to both.

## What changes

**Supplier, booking accepted → "Pedir pagamento":** the agreed total
(required), the deposit (sinal) due now (blank means the whole total), and
"Como pagar" (IBAN, Multicaixa Express…), prefilled from their last
request. Submitting moves the booking to `awaiting_payment` and writes the
terms in the same UPDATE.

**Supplier, after that, a "Pagamento" card:**
- total, deposit, amount declared by the client, and amount still owed;
- every submission, with amount, reference, date and **Ver comprovativo**;
- above "Confirmar pagamento recebido", the line "Confirme só depois de ver
  o dinheiro na sua conta", explaining what "Comprovativo verificado" means.

**Client:** the same totals, "Como pagar" with the booking reference
and "A NGUEZA nunca lhe pede para pagar para outra conta". "Valor pago" is
prefilled with what's due now: the rest of the deposit, then the rest of
the total.

**Email:** "Aguarda o seu pagamento" now carries the total, deposit,
instructions and a link to the booking.

**Label:** an administrator's "Plausível" now shows as
**"Comprovativo verificado"**, not "Confirmado". The booking moving to
"Confirmada" (by the supplier) is what says the money arrived.

## Rules the database enforces (0035)

| Rule | How |
|---|---|
| Terms are written once, by the supplier, when asking for payment (`accepted → awaiting_payment`, or `accepted → confirmed` with no payment step) | `bookings_guard_columns` allows the three columns only on that transition, for the owner |
| Frozen afterwards, for supplier and client alike; an admin can correct them for support | same guard |
| No "aguarda pagamento" without a total | `bookings_require_total` (reported as `terms_required`) |
| Deposit ≤ total | `bookings_deposit_within_total` (reported as `invalid_terms`) |
| A client's request carries no terms of its own | `bookings_set_terms` nulls them on insert |

The proof file is reached through `GET /api/reservas/comprovativo?id=`. It
issues a 3-minute signed link to whoever RLS lets read the document row
(the client, the booking's supplier, an admin) and returns 404 to anyone
else.

## Found while building it

- Slice 28's same-day search link on the client's page read
  `zona=undefined`: its fields had been added to the supplier list query,
  not the booking detail. This was fixed when #36 merged, with a regression
  test.

## Acceptance

- [x] The supplier sets total, deposit and instructions when asking for payment; the client sees them on the booking and in the email.
- [x] Asking for payment without a total is refused; a deposit above the total is refused.
- [x] Terms are frozen afterwards for the supplier and the client; confirming does not reopen them; an admin can correct them.
- [x] The supplier sees every submission on their booking, with a link to the proof; another supplier sees none.
- [x] The proof link is issued to the client, the supplier and an admin, and nobody else.
- [x] "Declared" excludes rejected submissions; "por pagar" never goes negative.
- [x] "Plausível" no longer reads as "Confirmado".

## Not in this slice

- Payment instructions are per booking, prefilled from the last one, with
  no separate settings screen.
- Bookings that asked for payment before this slice have no terms; their
  screens and email fall back to "contacte o fornecedor".
