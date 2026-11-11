# Slice 39 — an example catalogue, honestly labelled

**Status:** done. Applying it to the live project is NGUEZA's step (below).
**Asked for:** "insert dummy data for now for suppliers".

## Why it's built this way

Dummy suppliers make the marketplace look alive while recruitment fills
it. Unlabelled, they'd mislead. A client could request a salão that
doesn't exist and wait for an answer that never comes; a search engine
would list fictional businesses; and the "✓ Verificado" seal would be a
false claim. So an example profile is:

| | |
|---|---|
| Labelled | "Exemplo" on its card; "Perfil de exemplo — mostra como a NGUEZA funciona. Não é um fornecedor real." on its page |
| Never verified | The seal is withheld, however the row is set |
| Never bookable | The database refuses a request for it (0041); its page explains and points to real suppliers and the quote form, instead of a sign-in prompt |
| Never quoted | Excluded from quote-request matching |
| Never first | Search sorts every real supplier before any example, keyset-safe across pages |
| Not indexed | `noindex`, no structured data, not in the sitemap |
| Removable | `scripts/remove-example-catalogue.sql`, in one transaction |

## The catalogue

`seed/examples/00_example_catalogue.sql` holds 24 fictional suppliers:
- 10 venues across every venue category, with 13 bookable spaces;
- 14 service suppliers across every service category;
- spread across all eight municipalities, with 27 priced services that
  include "O que inclui" text, in all four pricing modes.

There are **no phone numbers** (a made-up number can belong to a real
person) and **no reviews** (a fabricated review is a lie to the client).
All are owned by one account with no password.

The file is idempotent. It works on both the local auth shim and live
Supabase's full `auth.users`, and looks categories and zones up by slug.

## How to use it

- **Locally:** `WITH_EXAMPLES=1 npm run db:reset`. It's off by default,
  because the test fixtures assume the six demo suppliers.
- **Live, after migration 0041** (NGUEZA's step):
  `psql "$MIGRATION_DATABASE_URL" -f seed/examples/00_example_catalogue.sql`
- **Remove, once real supply is there:**
  `psql "$MIGRATION_DATABASE_URL" -f scripts/remove-example-catalogue.sql`

## Acceptance

- [x] A booking request for an example is refused by the database.
- [x] Examples are labelled, never shown as verified, never matched to quotes.
- [x] Search lists every real supplier first, with no repeats or gaps across pages.
- [x] Not indexed: `noindex`, no JSON-LD, not in the sitemap.
- [x] The seed applies twice without duplicates; the removal script leaves no example rows and the six demo suppliers untouched.
- [x] Seen live locally: cards say "Exemplo"; the example page has the notice and no sign-in prompt.
