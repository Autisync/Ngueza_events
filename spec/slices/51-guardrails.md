# Slice 51 — guardrails before the marketplace pivot

**Status:** done.
**Part of:** the marketplace pivot (`spec/pivot/plan.md`, slice 51 of 51–70).
**Changes for visitors, clients and suppliers:** none they can see, except
one new message when a supplier tries to move a listing into a category of
the other kind.

The pivot adds many tables that hold money, and moves "how a listing
behaves" from the supplier to each offering. Before that starts, this slice
closes a hole that already exists and makes the checks the project claims
to have real.

## 1. A supplier cannot rewrite how their listing behaves (0047)

`providers_owner_insert` and `providers_owner_update` check only ownership,
and every column is writable. With one direct API call, which the app never
makes, an owner could:

- flip `supplier_type` from venue to service. Their bookings then stop
  blocking the calendar, and the same room can be confirmed twice;
- raise `concurrency_limit`, the ceiling the concurrency trigger enforces;
- set or clear `is_demo`, the flag that keeps example listings unbookable;
- move a venue into a service category (or the reverse) through the
  ordinary edit form, keeping the old behaviour under the new label.

`providers_guard_behaviour` (INVOKER, before insert or update):

| Who | What is refused | Error |
|---|---|---|
| An end user who is not an administrator, on update | any change to `supplier_type`, `concurrency_limit` or `is_demo` | 42501 |
| The same, on insert | `is_demo = true`, or a `concurrency_limit` other than 1 | 42501 |
| The same, on insert or a change of category | a category whose `default_supplier_type` is not `either` and differs from the listing's type | 23514 `providers_category_matches_mode` |
| The same | a category they cannot see (retired) | 23514 `providers_category_active` |

Administrators, the service role and migrations pass. It is a trigger and
not a column `REVOKE`, because revoking one column under a table-level
grant does nothing in Postgres.

`updateProvider()` now returns `'ok' | 'not_found' | 'category_mode'`, and
the painel says: "Essa categoria funciona de outra forma (espaço com data
exclusiva ou serviço). Escolha uma categoria do mesmo tipo, ou registe um
novo negócio."

**Before applying 0047 to live,** a person runs the read-only
`scripts/audit-provider-columns.sql`. The migration applies cleanly whatever
it shows; the audit lists listings that are already inconsistent, for an
administrator to look at.

## 2. Money

- **A real bug:** the admin console timeline printed a payment as
  `(amount_minor / 100)::text`, so 1 800 000,50 Kz read "1800000 Kz". The
  amount now crosses as text and is formatted by `lib/money`.
- `sumMinor()` and `multiplyMinor()` in `lib/money.ts`: bigint totals and
  unit price × whole quantity. Order lines and delivery fees will need both.
- ESLint now also refuses `Number(x)` where the name says money (`minor`,
  `price`, `amount`, `fee`, `budget`, `deposit`, `shipping`). It used to
  catch only `new Number()` and `parseFloat`.

## 3. Checks that check

- **`tests/sql/10_catalog_rules.sql`** asks the built schema, not the text
  of the migrations: every `*_minor` column is bigint and nothing
  money-shaped is fractional; there are no enum types; every table has RLS
  on; every table has a policy, or is one of two named as closed on purpose.
- **CI:** the OFFSET check now covers `lib/` and `app/`, where queries are
  written. A new check refuses a `z.enum` of category, location or event-type
  slugs.
- **Budget scripts:** `check-js-budget.sh` and `check-lcp-budget.sh` fail on
  a page that does not return 200. A renamed slug used to be measured as the
  404 page, which is small and fast, and passed. The three legal pages are
  no longer prerendered (the shared header reads the request), so they were
  being skipped; they are now measured as dynamic routes.
- **`tests_provider()`** in the test bootstrap creates a listing of one kind
  with its category, location and space. New SQL tests build fixtures
  through it, so when the venue/service switch moves to the offering
  (slice 56) it changes in one place. Existing test files are untouched.

## 4. Docs that are true

`CLAUDE.md` pointed at `spec/schema.md` (it is `spec/schema.sql`) and listed
`test:concurrency` and `test:e2e` gates that do not exist as scripts; there
is no e2e suite. The gates table now lists what `npm run gates` runs, what
CI adds, and says plainly that screens are checked by hand until an e2e
suite exists. It also points to the pivot plan.

## Not in this slice

- Migrating the fixtures of the existing SQL tests to `tests_provider()`.
  They stay byte-for-byte until slice 56 needs the change.
- A migrations ledger to replace the hand-kept fingerprints in
  `scripts/live-migration-status.sh` (0047's fingerprint is added).
- An e2e suite (review R072).

## Acceptance

- [x] As `authenticated`, an owner cannot change `supplier_type`, `concurrency_limit` or `is_demo`, on insert or update; an administrator can (`tests/sql/09_provider_guards.sql`).
- [x] A listing cannot move to a category of the other mode or a retired one; ordinary edits and same-mode moves still work; the painel explains the refusal.
- [x] Every existing test passes unchanged: nothing in the app relied on those writes.
- [x] The console shows a payment's cêntimos with pt-AO grouping.
- [x] `Number(priceMinor)` fails lint; `sumMinor` and `multiplyMinor` are unit-tested past 2^53.
- [x] The catalogue rules pass on the current schema.
- [x] A budget script given a missing page fails instead of passing.
- [x] `CLAUDE.md` names only gates and files that exist.
- [x] Gates pass; `spec/schema.sql` is in sync.
