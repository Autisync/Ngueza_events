# Slice 37 — kill switches and incident runbooks

**Status:** done. The runbook's contact table is for NGUEZA to fill in.
**Closes:** competitive review C004 (P0).

## Why

In an incident (a scam wave, a dispute spreading, a bug that double-books)
the only lever was a deploy. And nothing written said what to do when
`/api/saude` turned red, email stopped, or a supplier turned out to be
fraudulent.

## What changes

**Two switches**, flipped from "Interruptores de emergência" on the admin
dashboard (`platform_switches`, 0039):

| Switch | Effect while on | Enforced by |
|---|---|---|
| Suspender novos pedidos de reserva | No new booking requests. Existing bookings keep moving (accept, pay, confirm, cancel), and suppliers can still block dates. | A trigger on `bookings` insert (`55000`): an open tab can't slip one in |
| Suspender a criação de contas | "Criar conta" shows the notice and offers no form or Google button | The sign-up action |

- Each switch carries a public message, falling back to a default notice.
- The booking form is replaced by the notice.
- Every flip is in the audit log under the admin who made it.
- Anyone can read the switches (the site shows them); only an admin
  updates them; nobody inserts or deletes.

**`docs/runbooks.md`**, for each likely incident: how you notice, what to
check, what to do, and what people see meanwhile. It covers a stopped cron
sweep or mailer, email not delivered, database unreachable, a scam wave or
fraudulent supplier, a double-booking claim, a bad deploy, uploads failing,
Supabase Auth throttling and suspected data exposure. It ends with a table
of on-call contacts and URLs for NGUEZA to fill in before December.

## Limitations

- The **Google** button on `/entrar` can still create an account while
  sign-ups are paused; blocking that safely means changing the auth
  trigger. The sign-up page hides its own Google button.
- Resuming clears the message; the next pause takes a new one.

## Acceptance

- [x] While bookings are paused the database refuses a new request, from the app (`paused`) and directly (`55000`).
- [x] A supplier can still block a date; requests work again once resumed.
- [x] Only an admin flips a switch; the flip is audited to them; nobody deletes the switches.
- [x] The notice is the admin's message or a default; verified live: flip → notice on the supplier page → resume → two audit entries.
