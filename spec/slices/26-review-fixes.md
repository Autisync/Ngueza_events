# Slice 26 — fixes from the competitive review

**Status:** done locally; migrations 0030 and 0031 not yet applied to any
shared environment.
**Ownership:** agent + review.

The competitive review (October 2026) verified 53 defects against the
running app and the code. This slice fixes every one an engineer can fix
without a business, legal or money decision. Those it does not decide are
listed at the end.

## Security and fraud paths

- **Stored XSS (critical).** Supplier text went into the JSON-LD
  `<script>` through plain `JSON.stringify`, which does not escape `<`.
  Now `jsonForScript()` (`lib/safe.ts`). Verified live: a description of
  `</script><script>alert(1)</script>` renders as inert `<…`.
- **WhatsApp open redirect.** `/api/contacto/[id]` redirected to whatever
  `?para=` said. It now reads the supplier's own stored number, validates
  the id, returns 404 for non-public suppliers, and only then counts the
  reveal.
- **"Proposta aceite" banner.** Printed `?proposta=` text verbatim — a
  ready-made "pay this reference" scam on NGUEZA's domain. Now `?oferta=<id>`,
  and the price is read from the database for the requester only.
- **Open redirect after sign-in.** `startsWith('/')` accepted `//host`.
  `safeNext()` everywhere a `next` is read.
- **Login CSRF.** `/api/auth/callback` and `/recover`, and both upload
  routes, now require a same-origin request.
- **CSP media origin.** `connect-src` read `MINIO_PUBLIC_URL`, which the
  app is never given, so browser uploads were likely blocked in
  production. Now `MEDIA_S3_PUBLIC_ENDPOINT`. **Check production headers
  after deploy.**

## Records that could be made untrue (0031)

- Booking parties could rewrite dates, provider, price or the frozen
  cancellation snapshot; inserts trusted a client-supplied snapshot.
- A supplier could book their own listing, complete it at once and leave
  a "Reserva verificada" review. Self-booking, past dates and completing
  before the end are refused by the database.
- Reviews could name someone else's booking (blocking their real review),
  authors could rewrite moderation status and replies, and unverified
  reviews moved public ratings. Public scores now count verified reviews
  only.
- `bookings_set_shape` fired last, so venues ran the service capacity
  check: a multi-room venue could not block room B while room A was held.
- Suspending an owner left their listings public and bookable.
- anon could read every providers column, including the owner's email.

## The system silently doing the wrong thing

- A client who uploaded proof of payment could still lose the date at the
  24h mark. A submitted proof now holds the date 72h and the expiry sweep
  never releases it while the proof is pending. The supplier is told.
  **72h is a default NGUEZA should confirm.** Nothing is ever confirmed or
  refunded by the system.
- Nothing ever completed bookings; `complete_past_bookings()` now runs in
  the expiry cron, a day after the end.
- Quote requests never expired; losing offers read as self-withdrawn; the
  winner was never told; two accepts could race.
- No-show notices went to the supplier who set them; expiry emails always
  blamed the supplier; suppliers were never told a held date was released.
- Outbox rows could stay in `sending` forever; payment and report
  decisions could be silently overwritten and were unaudited; the
  verification queue's clock reset on every edit; a rejected supplier
  could never resubmit; manual blocks could not be removed; the default
  space had no capacity and matched every party size.
- Phone numbers were free text, so `923 456 789` opened a WhatsApp chat
  in Pakistan. Stored as E.164 from now on, and backfilled.

## Everyday failures

- Every unvalidated URL or form id reached a Postgres cast: `?zona=talatona`,
  `?data=2026-02-31` and friends returned an English 500. Search now
  accepts slugs (`?zona=talatona` works) and ignores invalid values;
  branded pt-AO 404 and error pages back everything else.
- Service categories offered on the homepage vanished on `/procurar`;
  search gained a "Pessoas" field; zero results now point to a quote
  request; past dates are refused everywhere and date inputs use Luanda's
  today; the calendar used UTC days and showed only the first room.
- Events past midnight (20:00–02:00) are accepted instead of erroring.
- Newsletter confirm/unsubscribe happen on a button press, so mail
  scanners no longer confirm people.
- Smaller: suspended label, `§NN` in UI copy, rating decimals and
  plurals, review-form accessibility, reduced-motion loops, hero width,
  category icon erased on edit, KPI counting unpaid bookings as paid,
  waitlist demand counting suppliers, newsletter sign-ups never counted.

## Verified

`npm run gates` green: typecheck, 96 unit tests, 193 integration tests,
56 SQL assertions (new `tests/sql/05_integrity.sql`), 50-way concurrency.
Lint has 0 errors. Every fixed route re-checked against a running copy of
the app on the seeded local database.

## Not decided here — NGUEZA's call

- **What a supplier owes when they cancel.** The client-cancellation
  tiers no longer pretend to answer this; the client now sees a neutral
  note. The rule itself is policy and legal text.
- **How long a submitted proof holds a date** (72h default above), and
  what happens when the supplier never checks it.
- **Per-request CSP nonces** to remove `'unsafe-inline'` — engineering,
  but a larger change than this slice; the XSS above is closed without it.
- Applying 0030/0031 to the live project — a migration against live data.
