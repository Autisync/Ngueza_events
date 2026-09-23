# Slice 24 — the real homepage

**Status:** done.
**Ownership:** NGUEZA decision, agent implementation.

## The decision, made outside this codebase

Slice 23 stopped short of touching `/` on purpose — it was a pre-launch
waitlist gate by design, and turning it into a live "browse now" page
would have silently ended that phase without anyone deciding to. NGUEZA
made that call explicitly: show the real product at `/`, and handle
directing prospective clients to the waitlist manually, as part of
supplier recruitment, for zones and categories not covered yet. This
slice is that decision, implemented.

## What moved

**The waitlist moved to `/lista-de-espera`** — same form, same fields,
same `joinWaitlist` action, same double opt-in flow through
`/lista-de-espera/obrigado` (which already existed at that path; the
signup form now matches it). Nothing about *how* the waitlist works
changed, only *where* it lives. `robots.ts` already disallowed
`/lista-de-espera/` from indexing — correct before this slice and still
correct now, since it is reachable only by a link supplier recruitment
hands out directly.

## What's new at `/`

A real homepage, built from the approved marketplace mockup and backed
entirely by live data — no placeholder content:

- A hero with a working search form (category, zone, date) that
  submits straight into `/procurar`'s own query parameters — no
  parallel search implementation, just another entry point into the
  one that exists.
- A category rail of real active categories, each linking into
  `/procurar?categoria=<id>`.
- A trust strip stating only facts already true elsewhere in this
  system: "Verificados" (search has only ever shown verified
  suppliers), "48h Resposta" (§26's own booking-request deadline),
  "0% Comissão" (§28 — NGUEZA never receives, holds, or moves money,
  so there is no commission to take).
- A featured-suppliers section — the same real, live, verified
  suppliers `/procurar` would return, not curated or faked.

**`app/SupplierCard.tsx` + `app/supplier-card.module.css`** — the card
markup slice 23 built for `/procurar` is now a shared component instead
of duplicated JSX, since the homepage is a second real call site. One
definition of what a supplier card looks like.

## Verified

- Live, in a real browser, against the local seeded database: every
  section of the new homepage screenshotted with real category names,
  real zone names, and five real featured suppliers with correct
  pricing (including a price range and an on-request listing, proving
  the shared card handles every price shape, not just the simple one).
- The full waitlist submission flow re-tested at its new location:
  filled the form, submitted, landed on `/lista-de-espera/obrigado`,
  confirmed its own "← Voltar" link correctly points at `/` — the real
  homepage now, which is what it always pointed at, just meaningfully
  different underneath.
- `check-js-budget.sh` re-run against the new `/`: still 169KB
  gzipped, 10KB headroom.
- Full local gate suite green: typecheck, lint (0 errors), 62 unit
  tests, 170 integration tests, complete `db:test` suite (this slice
  adds no migration and touches no RLS) — the existing 10 waitlist
  integration tests pass unchanged, confirming the relocation didn't
  touch the actual subscribe behavior. `npm run build` succeeds,
  `spec/schema.sql` unchanged.

## Deliberately out of scope

- Real photography. The featured cards and category rail render the
  same styled placeholders slice 23 introduced — `coverImageUrl()`
  degrades to them exactly as designed, since no real photos exist in
  this environment yet. Nothing to fix; the code path for real photos
  was already correct and stays correct once photos exist.
- A homepage-specific location filter smarter than "toda a Luanda".
  `/procurar`'s own filter is what search is; the homepage form uses it
  as-is rather than inventing a second opinion about what filtering
  should look like.
