# NGUEZA

Plataforma de procura, reserva e gestão de serviços — Angola.

The product answers one question:

> *"Salão de festas em Talatona disponível para dia 15 de Dezembro."*

A place, a date, a capacity, a price, and a truthful answer about availability.

---

## Status

Schema and safety rails. No application code yet — that starts at slice 02.

| | |
|---|---|
| Launch scope | Venues, Luanda, six categories |
| Stack | Next.js · Supabase (Postgres) · Cloudflare · Vercel |
| Verified | 11 migrations apply from empty; 18 database assertions pass |

---

## Getting started

Requires PostgreSQL 17 and Node 20+.

On macOS:

```bash
brew install postgresql@17 && brew services start postgresql@17
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
```

Then:

```bash
createdb ngueza
npm run db:reset     # migrations + seed
npm run db:test      # every assertion, against a disposable database
```

`db:reset` applies a local-only `auth` shim so the schema runs on plain
Postgres. Deployed environments get the real `auth` schema from Supabase.

---

## Layout

```
supabase/migrations/   the schema — source of truth for the whole system
spec/schema.sql        generated, flattened, read-only (npm run schema:dump)
spec/states.md         the booking state machine
spec/slices/           one file per unit of work, with acceptance criteria
seed/                  Luanda taxonomy + demo suppliers
tests/sql/             RLS and constraint assertions
tests/concurrency.sh   50 simultaneous bookings for one slot
CLAUDE.md              conventions and the forbidden list
```

---

## The four decisions that are expensive to reverse

**Availability is a database constraint.** `bookings_no_double_booking` is an
exclusion constraint over `(resource_id, tstzrange)`. Reading "is this free?"
and then inserting is a race; the database refuses the second write instead.
Application code catches SQLSTATE `23P01`.

**Venues and services are different products.** A salão is date-exclusive; a
maquilhadora can serve three clients in a day. `providers.supplier_type` splits
them, and each gets its own enforcement path — the constraint for venues, a
concurrency trigger for services. Modelling them as one calendar was the most
expensive mistake available in this schema.

**Categories and locations are rows, never enums.** Self-referencing trees
managed by an administrator at runtime. This is what lets NGUEZA add cleaning,
plumbing, tutoring or transport without a migration.

**Money is `bigint` in cêntimos.** No floating point ever touches a currency
value. CI fails the build otherwise.

---

## Ownership

Domain, repository, hosting, database and every third-party account are owned
by NGUEZA. Engineers receive access; engineers do not own accounts. The
departure of a developer must not risk the system.
