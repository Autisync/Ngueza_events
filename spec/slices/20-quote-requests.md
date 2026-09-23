# Slice 20 — quote requests (price inquiries / bids)

**Status:** in progress.
**Ownership:** agent + review.

## User story

A visitor knows what they need — "fotógrafo para casamento em Talatona,
dia 20 de Dezembro, cerca de 80 pessoas" — but not which supplier, or
what it costs. Today they can only browse `/procurar` and message
suppliers one at a time. This slice lets them describe the need once and
have every matching, verified supplier receive it and respond with a
price — a request for quotation, not a booking.

Suppliers already registered with NGUEZA (venues and services alike,
per the scope decision below) see matching open requests in their
painel and can submit a priced offer. The requester sees every offer
that comes in, by email and inside the webapp, and reaches out to
whichever supplier they choose directly — NGUEZA does not broker the
conversation or the payment, same as booking contact today.

## Scope decisions made before implementation

- **Both supplier types, both venues and services, from launch** — not
  scoped to venues only. Matching does not filter on `supplier_type`.
- **Requires an account.** A quote request needs a signed-in `client_id`
  — there is no in-webapp inbox to notify an anonymous visitor into.
  Anonymous visitors are directed to create an account first, same gate
  as booking already uses.
- **No in-system "accept" or payment.** Consistent with §28/slice 16:
  NGUEZA never receives, holds, or moves money, and does not broker the
  conversation. An offer is a price and a message; accepting it means
  contacting the supplier directly, using the same contact details the
  public supplier page already exposes.
- **Immutable after creation.** A request's category, location, date,
  capacity and description cannot be edited once posted — only closed.
  Suppliers who already offered are relying on what they read; changing
  the ask out from under them is a fairness problem this avoids by
  construction (the same reasoning as a booking's frozen
  `policy_snapshot`).

## What lands

### Schema (`0027_quote_requests.sql`)

- `quote_requests` — `client_id`, `category_id`, `location_id`, optional
  `event_date` and `capacity`, `description`, `status`
  (`open`/`closed`/`expired`), `expires_at` (14 days from creation).
- `quote_offers` — `quote_request_id`, `provider_id`, `price_minor`
  (bigint cêntimos, never a float), optional `message`, `status`
  (`submitted`/`withdrawn`). A partial unique index allows exactly one
  *live* offer per `(quote_request_id, provider_id)` — a supplier can
  withdraw and re-offer, but never have two simultaneously standing.
- RLS on both, matching the tree-rollup semantics `lib/search.ts`
  already uses (`category_descendants` / `location_descendants`): a
  supplier sees and may offer on a request only while it is open, and
  only if their own provider's category and location fall within the
  request's chosen trees, verified and published — the exact visibility
  bar `/procurar` already holds suppliers to.
- Guard triggers (matching `profiles_guard_role` / `providers_guard_
  verification`'s established shape): a client may only transition
  `quote_requests.status` toward `closed`, nothing else on the row; a
  supplier may only transition their own offer to `withdrawn`.
- `notification_outbox` (0019) extended: two new `kind` values
  (`quote_request_new`, `quote_offer_received`), a `read_at` column so a
  recipient can read their own notifications in-app (previously
  admin-only), and the unique constraint widened to include
  `recipient_id` — 0019's constraint assumed one recipient per
  triggering row, which a request fan-out to many matching suppliers
  breaks.
- A trigger on `quote_requests` fans out one `notification_outbox` row
  per matching, verified, published provider owner — capped at 50
  matches per request, the same "batch has a ceiling" idiom
  `claimAndSend`'s default `limit` already uses elsewhere in this
  codebase, so one broad request (a whole province, a shallow category)
  cannot enqueue an unbounded burst of email.
- A trigger on `quote_offers` notifies the requester.

### Domain layer, actions, UI

- `lib/quotes.ts` — create a request, list a supplier's matching open
  requests, submit/withdraw an offer, a requester's own requests and
  the offers on each, mark a request closed.
- `app/quote-actions.ts` — server actions, JavaScript optional, same
  shape as every other mutation in this app.
- `/pedir-orcamento` — the request form. Signed-out visitors are sent to
  `/entrar?next=/pedir-orcamento`.
- `/conta/pedidos` — the requester's own requests and the offers on
  each, with an unread badge.
- `/painel/[providerId]/pedidos` — matching open requests for that
  supplier, and the offer form.

## Explicitly out of scope, and why

- **Rate limiting on request creation.** The wider gap (no application-
  level rate limiting exists anywhere in this app yet) is a separate,
  pre-existing concern flagged outside this slice, not introduced by
  it — this slice does not make it worse in a way nothing else already
  isn't.
- **SMTP volume.** A broad request can fan out to up to 50 emails at
  once. Supabase's shared mailer caps at a few messages an hour (see
  README's "Blocked" section) — this slice's own notification volume is
  exactly the kind of load that blocker is about. Safe to ship because
  the outbox degrades to a growing `pending` queue rather than losing
  anything, but real usage before Resend is wired will be visibly slow.
- **Batching/digesting fan-out notifications** into one email per
  supplier per day, rather than one per request. Worth doing once
  volume justifies it; premature before there is real traffic to tune
  against.
