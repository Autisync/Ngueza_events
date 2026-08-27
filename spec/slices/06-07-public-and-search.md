# Slices 06 & 07 — public supplier page and search

**Status:** done.
**Ownership:** agent + review.
**Taken out of order:** slice 02 (auth) needs a Supabase project that does not
exist yet. These need nothing but the schema and anonymous RLS, so the wedge
ships first rather than waiting behind provisioning.

## The wedge

> *"Salão de festas em Talatona disponível para dia 15 de Dezembro."*

A place, a date, a capacity, a price, and a truthful yes or no.

## What landed

- `/procurar` — category and location roll up through their trees, so
  *Luanda* includes every município beneath it. Capacity and date filters.
  Keyset pagination, never `OFFSET`.
- `/fornecedor/[slug]` — own URL, `schema.org` LocalBusiness, 28-day
  availability calendar, contact buttons.
- Credibility that exists on day one: verification seal, declared history
  labelled as declared, honest *"ainda sem avaliações"*.
- Every search and every contact reveal is recorded to `events`.

## The bug worth remembering

Availability started as an inline `not exists (select ... from bookings)`
evaluated as the visitor. **RLS hides every booking from a visitor**, so the
subquery matched nothing and returned TRUE for occupied dates. Every venue
looked free. No error, no warning — just a calendar that lies.

Migration 0014 replaces it with `resource_is_free()`, a SECURITY DEFINER
function returning one boolean and nothing else. A visitor learns *free* or
*not free*, never who booked it or for how much.

The general rule, now in `CLAUDE.md`: **when a query as `anon` returns a
suspiciously permissive answer, check whether RLS is hiding the rows the
logic depends on.** An empty set is not the same as no constraint.

## Also fixed

The keyset cursor compared a plain tuple `(has_price, name, id) < (…)`
against an ordering of `has_price DESC, name ASC, id ASC`. Tuple comparison
only matches an all-ascending order, so pages silently repeated and skipped
rows. The cursor now compares on `(not has_price)` so every column ascends.

## Verified

`tests/integration/search.test.ts` (11) and `provider.test.ts` (8), including
a regression test asserting a visitor reads zero bookings and still gets the
right availability answer.
