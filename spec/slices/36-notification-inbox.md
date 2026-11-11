# Slice 36 — actionable notifications: an inbox, and links to the right screen

**Status:** done. WhatsApp Business delivery remains a separate, human-owned
application (see "Not in this slice").
**Closes:** competitive review R049 (P0), apart from WhatsApp.

## Why

Every event already produced an email, but:
- the links pointed at the wrong place: a supplier's "novo pedido" went to
  the dashboard, not the request, and a client's "reserva aceite" went to
  the supplier's public page, not their booking;
- someone who missed or lost the email had no record in the app. Slice 20
  had built the inbox queries (`myNotifications`, unread count, mark read)
  and the RLS for them, but no screen used them.

## What changes

- **`notificationPath(kind, context)`** (in `lib/notify.ts`) is the one
  answer to "where does this take me?", used by both the email and the
  inbox:
  - supplier booking kinds → `/painel/{provider}/reservas/{booking}`;
  - client booking kinds → `/reservas/{booking}`;
  - verification → the supplier's dashboard; quote kinds → the request or
    offer screens; help requests → `/admin/apoio`;
  - anything unknown → `null`, never a guess.
- **Emails** for a new request, acceptance, confirmation, payment proof and
  a released date now link to that booking.
- **`/conta/notificacoes`:** the person's notifications, newest first,
  unread in bold. Opening one marks it read and goes to its screen. It's a
  form post (works without JS), and the destination is passed through
  `safeNext()`, so a tampered form can't redirect off-site. There's also
  "Marcar todas como lidas".
- **Unread counts** on `/conta` and in the supplier dashboard header.

## Acceptance

- [x] Supplier booking notifications open the specific booking in the dashboard; client ones open the client's booking page.
- [x] Every other kind maps somewhere sensible or to nothing; unknown kinds are `null`.
- [x] The emails carry the same link as the inbox.
- [x] "Mark all read" touches only the reader's own notifications.
- [x] Verified end to end locally: accept → the client sees "1 por ler" → opening lands on the booking, now read.

## Not in this slice

- **WhatsApp delivery.** It needs a WhatsApp Business account, a verified
  sender and approved message templates, applied for in NGUEZA's name.
  Once approved, a sender plugs into the same outbox rows and
  `notificationPath` links.
- **A shared site header with the badge on every page.** That waits on the
  shared header and footer (a P1 item).
