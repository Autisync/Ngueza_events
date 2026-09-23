# Slice 21 — weather and event-planning tips

**Status:** done.
**Ownership:** agent + review.

## User story

Someone with a confirmed booking is planning a real event on a real
date. `/reservas/[id]` already tells them the date, the supplier, and
the money side — it did not tell them anything about the day itself,
or what else is worth thinking about before it arrives.

## What landed

**`lib/weather.ts`** — a weather tip for the booking's own date,
resolved from the provider's own location (`locations.lat`/`lng`,
already populated for every real municipality since 0003 — no
geocoding step needed). Two shapes:

- **A real forecast**, for a date within Google Weather API's own
  ~10-day forecast window: condition, high/low in °C, rain chance.
- **A seasonal outlook**, for everything else — Angola's own wet/dry
  season pattern (chuvosa: Outubro–Abril, seca/cacimbo: Maio–Setembro).
  Most bookings on this platform are made further out than 10 days, so
  this is the common case, not a rare fallback. Deliberately not a
  fabricated "forecast" for a date no API can actually predict — a true
  seasonal fact instead.

Every real-world failure mode — no API key configured, the provider's
location has no coordinates, the request errors, the response doesn't
parse, a network timeout — degrades to the seasonal outlook rather
than showing nothing or an error. An event planner should never see a
blank card because a third-party API had a bad moment.

**`lib/event-tips.ts`** — planning tips keyed by category *slug*, with
a `supplier_type` fallback for any category the table has never heard
of. Categories stay rows an administrator can add to at runtime (§6,
§44); this cannot become the kind of enum CLAUDE.md forbids, because a
lookup miss degrades to sensible generic advice instead of a blank
section or a crash.

**`/reservas/[id]`** gained a "Dicas para o seu evento" card — shown
while the booking is still something to plan for (the same status set
`canCancel` already uses: requested/accepted/awaiting_payment/
confirmed), combining the weather tip with category-specific and
general planning tips.

**`lib/provider.ts`** gained `planningContext(providerId)` — the
category slug and supplier type a booking's own provider carries,
by id rather than slug since a booking or a quote offer carries the
id, not the slug the public page uses.

## Verified

- 4 unit tests (`tests/unit/weather.test.ts`) for the three branches
  reachable without a database or a network call: a past date, a date
  beyond the forecast window, and a missing API key — each returns
  before touching either.
- 2 new integration tests (`tests/integration/provider.test.ts`) for
  `planningContext`, against the real seeded catalogue.
- **The real forecast branch, verified live**: `eventWeather()` called
  end to end against the local seeded database and the real Google
  Weather API for a real provider (Salão Horizonte, Talatona) and a
  real near-term date — returned a correctly parsed, Portuguese-
  translated forecast (condition, high/low, rain chance). Confirmed
  separately at the raw API level first (`curl`), including the actual
  forecast window (`days` beyond 10 returns `400 INVALID_ARGUMENT`,
  confirming the cutoff this code uses rather than assuming one).
- Full local gate suite green: typecheck, lint (0 errors), unit tests,
  164 integration tests, complete `db:test` suite including the 50-way
  concurrency assertion — this slice adds no migration and touches no
  RLS, so nothing at the database layer could regress.
- `npm run build` succeeds; `/reservas/[id]` still registers.

## Deliberately out of scope

- **A tips section on the public supplier page** (`/fornecedor/[slug]`),
  before any booking exists. `eventTips()` is already usable there —
  the category slug and supplier type a public provider page reads are
  the same shape `planningContext` returns — this is a follow-up UI
  addition, not a design gap.
- **Weather on the quote-request flow** (slice 20). A quote request
  carries an optional `event_date` and a `location_id` directly (no
  provider yet, by definition — that's the whole point of the
  request), so `eventWeather` would need a `locationId` overload
  instead of always resolving through a provider. Small, but a real
  follow-up, not free with this slice's own scope.
