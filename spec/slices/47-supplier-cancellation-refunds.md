# Slice 47 — a supplier's cancellation says why, and refunds are on the record

**Status:** done.
**Closes:** the open part of competitive review R013: fault recording and
refund tracking. The neutral card when a supplier cancels shipped in #31.

NGUEZA never holds or moves money (CLAUDE.md, "Never automate"). This slice
records what the two parties say. It does not compute, owe or send a refund.
As the review asked, it records **who initiated** the cancellation (the
status already does) and **why** (their own words), not who was at fault.
What a supplier owes when they cancel is NGUEZA's rule to set, with
counsel.

## Model (0045)

**`bookings.cancellation_reason`** (3–500 characters).
- Allowed only on a cancelled booking (check constraint).
- Settable only in the same update that cancels, and never edited
  afterwards (INVOKER trigger, 42501).
- **Required** when a supplier cancels a real booking (23514). Unblocking
  their own manual block needs no reason.

**`refund_attestations`**:
- **The supplier's statement:** amount (bigint cêntimos), method
  (transferência / Multicaixa Express / numerário / outro), optional
  reference.
- **The client's answer, once:** `received` or `disputed`, optional note,
  `responded_at`.

**RLS and guards:**
- Both parties and admins read.
- Only the booking's supplier inserts, as themselves, unanswered, and only
  on a cancelled booking (client- or supplier-cancelled).
- Only the booking's client answers. A trigger lets the answer be the only
  change, and only once.
- Nobody deletes.

**Notifications:**
- `refund_sent` goes to the client, linking to `/reservas/{id}#devolucao`.
- `refund_disputed` goes to the supplier, quoting the client's note and
  linking to `/painel/{p}/reservas/{id}#devolucao`.

## What changes

**Supplier's booking page.**
- "Cancelar" (from accepted, awaiting payment or confirmed) becomes
  "Cancelar esta reserva…". It opens a list of consequences:
  - the client gets an email with the reason;
  - the date frees up;
  - what the client declared paid, and that the refund is between them;
  - that it stays in the history.
- Then a required reason, then "Confirmar cancelamento".
- "Desbloquear data" stays one button.
- Once cancelled, a **Devolução** card shows:
  - the reason;
  - what the client declared paid;
  - what the supplier has recorded as returned;
  - each statement with the client's answer;
  - the form "Registar devolução".
- "Por pagar" is no longer shown on a cancelled booking.

**Client's booking page.**
- "Cancelada pelo fornecedor" now shows facts instead of a percentage:
  - when;
  - the reason;
  - what they declared paid (and on how many proofs);
  - the note that the policy's tiers apply only to client cancellations.
- A **Devolução** card shows "{fornecedor} diz que lhe devolveu X por
  Multicaixa Express (ref. …)", with **Recebi** and **Não recebi…** (a note,
  then "Confirmar que não recebi"). Once answered it shows the answer.
- The payment card (with its proof upload) no longer appears on a
  cancelled booking.

**Docs.** `spec/states.md` gains the reason rule, and the fraud runbook's
"record of what happened" now includes `refund_attestations`.

## Still NGUEZA's to decide (not built)

- What a supplier owes when they cancel. `refundEntitlement` still returns
  nothing for `cancelled_provider`, by design, until there's a rule.
- Whether a dispute should open a help request automatically. Today the
  client has the "Peça ajuda" link on the same page, and the supplier gets
  the email.

## Acceptance criteria

- [x] A supplier cancelling without a reason (or with only spaces) is
      refused; with one it succeeds; the client reads it; editing it
      afterwards is refused (integration).
- [x] Only the booking's supplier can state a refund; not the client and
      not another supplier; not on a booking that isn't cancelled.
- [x] Both parties see the statement; other clients and suppliers don't.
- [x] `refund_sent` reaches the client; the client answers once; the
      supplier can't answer for them; `refund_disputed` reaches the
      supplier.
- [x] A statement can't be rewritten or deleted.
- [x] Email copy and links (unit).
- [x] Checked at 390px: two-step cancel, refund record, client facts,
      dispute.
- [x] `npm run gates` green.
