# Slice 41 — legal hooks: versioned documents, recorded acceptance, order acknowledgement

**Status:** done. The legal **text** remains NGUEZA's, with counsel.
**Closes:** the engineering side of competitive review R066 and C007.

## Why

Whatever the Terms, Privacy Policy and cancellation rules end up saying,
NGUEZA must be able to show which version was in force and that a given
person accepted it, when, and in what context. Nothing recorded any of
that. And a client sending a booking request got no confirmation at all;
only the supplier was emailed.

## What changes

- **`legal_documents`** (0042): one row per version of `terms`, `privacy`
  and `cancellation`, with a publication date and the page it lives at.
  `legal_current` is the version of each in force now. A new version is a
  new row; nothing is edited. The current placeholders (slice 15) are
  version `provisorio-2026-11`.
- **`legal_acceptances`**: who accepted which version, when, and where
  (`signup` or `booking`, with the booking id). RLS lets a person record
  only their own acceptance, and only of a version in force. Nobody edits
  or deletes a record. Admins read all.
- **Sign-up:** a required "Li e aceito os Termos de Utilização e a Política
  de Privacidade". Recorded against the new account once Supabase Auth
  creates it.
- **Booking request:** a required "Li e aceito os Termos de Utilização e a
  política de cancelamento acima («…»)", naming the supplier's actual
  policy. Recorded in the same transaction as the request, with its id.
- **Order acknowledgement:** a new `booking_requested_client` email, "Pedido
  enviado". It says the request isn't yet a reservation, explains what
  happens next, and links to the booking.

## Publishing a new version (NGUEZA, with counsel)

1. Put the new text at the page (`/termos`, `/privacidade`, `/cancelamento`).
2. `insert into legal_documents (kind, version, url) values ('terms', '2027-01', '/termos');`
   (an admin may also do this through the API: insert is admin-only).

From that moment, new acceptances record the new version; earlier records
keep the version actually accepted.

## Limitations

- Accounts created with **Google** skip the sign-up checkbox. Their first
  booking still records terms and cancellation acceptance.
- Notices at the point of data collection (what each field is used for)
  are legal text. The hooks are in place; the wording is NGUEZA's.

## Acceptance

- [x] A booking request records the terms and cancellation versions in force, with the booking id, in the same transaction.
- [x] Sign-up records terms and privacy.
- [x] A newer version is recorded for new acceptances; old records keep their version.
- [x] Nobody accepts for someone else, accepts a version not in force, or rewrites a record.
- [x] The client gets a "Pedido enviado" email linking to the booking.
