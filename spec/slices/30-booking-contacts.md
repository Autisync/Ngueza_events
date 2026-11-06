# Slice 30 — the two sides of a booking can reach each other

**Status:** done.
**Closes:** competitive review R051 (P0). Also found and fixed: job
functions callable by any visitor (from 0030/0031).

## Why

The review asked for the client's +244 number and WhatsApp click-to-chat.
Building it showed the gap was wider. `profiles_self_read` lets a person
read only their own profile, so a supplier's booking screen showed
**"Cliente" and nothing else**: no name, no email, no phone, even for a
confirmed booking. The supplier had no way to reach the person holding a
wedding in their salão. The client's page had no contact either.

## What changes

**Collected:** the request form asks for "Telemóvel (WhatsApp)". It is
required, normalised to +244, prefilled from the profile, and saved to the
profile in the same transaction as the request.

**Supplier's booking screen**, a new "Cliente" card:

| Stage | Supplier sees |
|---|---|
| Request | The client's name, and "O telefone e o email do cliente aparecem aqui depois de aceitar o pedido." |
| Once accepted (at any point) | Name, phone (`tel:`), email (`mailto:`), **Falar no WhatsApp** with a prefilled message naming the date and booking reference |
| Only ever rejected | Name only |

The bookings list shows names too, so it stops reading "Bloqueio manual"
for real clients.

**Client's booking screen:** "Falar com [fornecedor]" with WhatsApp (also
prefilled) and Ligar, plus the booking reference. The link goes straight to
the supplier's own published number, not through `/api/contacto`. That
route counts pre-booking contact (the §32 leakage ratio), and discussing a
booking already made isn't leakage.

## How

`booking_client_contact(booking_id)` (0034) is a `SECURITY DEFINER`
function that answers only to the booking's supplier or an admin. It
returns the name always, and email and phone only once a `booking_events`
row shows the booking reached `accepted`, `awaiting_payment` or
`confirmed`. The profiles policy is unchanged. This is the CLAUDE.md
pattern: expose the derived fact, not the table.

Holding contact back until acceptance is a default, not a law: a stream of
requests shouldn't be a contact list to harvest. Sharing at request time is
a one-line change to the function.

## Found while building it: job functions open to visitors

Supabase's default privileges grant EXECUTE on new public functions to
`anon` and `authenticated` explicitly. So `revoke all ... from public`,
which 0030 and 0031 used for `complete_past_bookings()` and
`expire_stale_quote_requests()`, removed nothing. Any visitor could run the
sweeps through the API. They only do what the job does, early, so there's
no escalation, but a job's lever shouldn't be public. 0034 revokes them
from `anon` and `authenticated`.

`tests/sql/06_function_grants.sql` now fails the build if a
`SECURITY DEFINER` function is callable by `anon` without being on an
explicit allowlist. Re-granting one function made it fail, as intended.

## Acceptance

- [x] The phone given on a request is saved to the client's profile, in the same transaction.
- [x] On a request, the supplier sees the name but not the email or phone.
- [x] After acceptance, the supplier sees email and phone, and still does if the client later cancels.
- [x] A request that was only ever rejected never shares contact.
- [x] An unrelated supplier gets nothing; a visitor can't even call the function.
- [x] An admin sees it, for support.
- [x] The client sees the supplier's published numbers.
- [x] No job function is callable by an end user; the allowlist assertion catches a regression.

## Not in this slice

- Phone verification (`phone_verified` stays false; that needs an SMS
  provider).
- Clients who requested before this slice have no phone; the supplier
  screen says to use the email.
