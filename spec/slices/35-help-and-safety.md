# Slice 35 — help centre, support inbox, and safety in context

**Status:** done.
**Closes:** competitive review C006 and R047 (P0).

## Why

There was nowhere to ask NGUEZA for help: not a client whose supplier went
silent, not a supplier stuck uploading paperwork, not someone asked to pay
into a stranger's account. Contact addresses were buried in copy. Nothing
explained what "Verificado" means, and nothing warned about the most
likely scam in a pay-the-supplier-directly model: a message asking you to
pay "another account".

## What changes

**`/ajuda`**, plain explanatory copy (not legal text, no guarantees):
- **Como funciona uma reserva:** the five steps as the product implements them.
- **Pagar com segurança:** NGUEZA never receives the money and never asks
  you to pay a different account; warning signs; always quote the
  reference; what "Comprovativo verificado" does and doesn't mean.
- **«Verificado»:** documents checked against the registered business;
  says who the supplier is, not how good they are.
- **Cancelar:** the policy at the time of the request is the one that
  counts; refunds are agreed with the supplier.
- **Algo correu mal:** what to do for each common case.
- **Pedir ajuda:** a form that works signed out, with topic, booking
  reference and message. Rate limited (5 per IP per hour).

**Support inbox** (`support_requests`, 0038): RLS lets anyone file, but
only as themselves (or as nobody, signed out), and only as open. A person
reads their own requests; only an admin resolves. Every active admin gets
an email quoting the request. **`/admin/apoio`** lists open requests oldest
first, scams first, with mailto links, plus a count in the admin nav.

**In context:**
- the verified seal links to "O que quer dizer";
- the booking form says "Pague sempre pelos dados da página da reserva";
- every booking page has "Peça ajuda à NGUEZA", prefilled with its reference;
- "Ajuda" is in every footer and legal page, and in the sitemap.

## Acceptance

- [x] A signed-out request is stored and every admin is emailed with the person's own words.
- [x] A signed-in request is filed as that person; nobody can file as someone else, or pre-resolved.
- [x] People read only their own requests; only an admin resolves.
- [x] The form needs a valid email, a real message and, if given, an 8-character reference.
- [x] Verified end to end locally: submit signed out, see it in `/admin/apoio`.
