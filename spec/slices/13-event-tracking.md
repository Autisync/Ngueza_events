# Slice 13 — event tracking

**Status:** done.
**Ownership:** agent.

## Why this shipped before the dashboard that reads it

Nine of the phase-two decisions are gated on numbers from `events`, and
**none of it can be backfilled**. A month of missing data is a month of
decisions that have to be made on instinct instead. The dashboard (slice 14)
can wait; the recording cannot.

## What is emitted

| Event | Where | Coverage |
|---|---|---|
| `search_performed` / `zero_result` | `/procurar` | exact |
| `provider_viewed` | `/fornecedor/[slug]` | exact |
| `whatsapp_clicked` | server redirect via `/api/contacto` | exact |
| `phone_revealed` | `sendBeacon` from the client | **lower bound** |
| `booking_requested` | same transaction as the booking | exact |
| `newsletter_subscribed` | waitlist | exact |

**Read `phone_revealed` as a lower bound.** A `tel:` link cannot be routed
through a server redirect reliably, so the click is beaconed with ~600 bytes
of JavaScript. A visitor with JavaScript disabled still gets a working link
and is not counted. WhatsApp goes through the server and is exact.

## Sessions

`middleware.ts` sets `ngz_sid`: first-party, no `Max-Age` so it dies with
the browser session, no personal data, never shared. Without it the leakage
ratio has no denominator per visit and the comparison gate — *"more than 25%
of sessions view three or more suppliers"* — is unanswerable.

It is still a cookie and still belongs in the privacy policy. Slice 15.

## Crawlers

Crawlers must reach every public page (§50) and must never inflate the
metrics those pages emit — a supplier's view count is a business signal, not
a traffic number. `isCrawler()` filters recording, never rendering.

## The two questions this exists to answer

Both are asserted in `tests/integration/analytics.test.ts`:

```sql
-- 1. Leakage (§32): does the transaction layer earn its build?
select count(*) filter (where name in ('phone_revealed','whatsapp_clicked')) as reveals,
       count(*) filter (where name = 'booking_requested')                    as requests
  from events;

-- 2. Comparison intent: is the catalogue dense enough to compare?
select count(*) from (
  select session_id from events
   where name = 'provider_viewed' and session_id is not null
   group by session_id having count(distinct provider_id) >= 3
) s;
```

## Also in this slice

`app/robots.ts` and `app/sitemap.ts` (§50). The sitemap lists only
published, verified suppliers — enforced by RLS rather than a `WHERE`
clause someone can forget.
