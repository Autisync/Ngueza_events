# Slice 42 — search: budget, sort, price units, and only categories with supply

**Status:** done.
**Closes:** competitive review R001 (budget filter, sorting) and R002, plus
the price-unit part of R004. Amenity filters need an amenities model first
(below).

## What changes

- **Orçamento até (Kz):** keeps suppliers whose cheapest price is within
  budget. Those who price **on request stay in**, because an unknown price
  isn't over budget. Typed the way people write it ("500.000"); anything
  unparsable is ignored.
- **Ordenar:**
  - Relevância (priced first, then by name);
  - Preço mais baixo (price on request last);
  - Mais bem avaliados (verified rating, then review count).

  Real suppliers still always come before examples (0041).
- **Paging stays exact under every sort.** All sorts share one ascending
  key shape `(is_demo, grp, sort_num, name, id)`; "highest first" is
  negated rather than reversed, because a tuple comparison against mixed
  directions silently repeats and skips rows. The cursor records which
  sort it was made for, and is ignored, not misapplied, if the sort
  changes.
- **Cards say what a price is per:** "180 000 Kz / evento", "12 000 Kz / pessoa".
- **Only categories with at least one listing** appear in the filter: a
  filter that can only ever answer "nada encontrado" is a dead end.
- On a phone, budget and sort are folded into **"Mais filtros"**, which
  opens by itself when either is in use, so results stay on the first
  screen.
- Search events record the budget and sort, as recruitment and pricing
  evidence.

## Not in this slice

- **Amenity filters** (estacionamento, ar condicionado, gerador…) need an
  amenities model: rows an admin manages, like categories (CLAUDE.md), and
  a supplier UI to tick them. That's a slice of its own.

## Acceptance

- [x] The budget keeps within-budget and price-on-request suppliers and drops the rest.
- [x] Cheapest-first is ascending with price-on-request last; best-rated is descending; both page without repeats or gaps.
- [x] A cursor from another sort is ignored.
- [x] Cards show the price unit.
- [x] Checked live locally with the example catalogue: budget, sort and units on mobile.
