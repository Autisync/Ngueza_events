# Slice 29 — edit services in place

**Status:** done.
**Closes:** competitive review R009 (P0).

## Why

A supplier could only add or remove a service. To fix a price, which is
the most common edit in December, they had to remove the service and type
it all in again. The service description existed in the schema and was
fetched for the public page, but there was no field to set it and the page
never showed it. So a client couldn't tell what "1 800 000 Kz" covered.

## What changes

- **Each service has an "Editar" section** in the supplier dashboard, with
  every field prefilled: name, category, what's included, pricing mode,
  unit, price, maximum price, and capacities. Prices are shown in pt-AO
  grouping ("1.800.000"), which is what suppliers type and what the parser
  reads back.
- **"O que inclui"** (the description) is on both the add and edit forms,
  and the public supplier page now shows it under each service, keeping
  line breaks.
- **One set of fields** (`ServiceFields`) for adding and editing, so the
  two forms can't drift apart.
- **Validation errors appear next to the service being edited**, with its
  form reopened, instead of in a banner at the top of a long page.
- **Removing** a service moved inside "Editar" as "Retirar serviço", next
  to the other changes.

## Rules

- `updateService()` is scoped to the provider *and* the service id, and
  only touches active services. A form posted with another business's
  service id changes nothing, even before RLS refuses it.
- Existing bookings are unaffected. Each carries its own total, written by
  the database when it was made (0031).

## Acceptance

- [x] A supplier changes price, mode, unit and description; the same service row is updated, not a new one created.
- [x] Switching to "sob consulta" clears the stored price.
- [x] Another supplier cannot edit it, whether they post their own business id or the owner's.
- [x] A removed service cannot be edited back to life.
- [x] An invalid edit (maximum below minimum) shows the error inline, with that service's form open.
- [x] The description appears on the public supplier page.

## Not in this slice

- The no-JS form flow redirects on error, so the reopened form shows the
  saved values rather than what was typed. Keeping typed values needs
  either JavaScript or carrying every field in the URL.
