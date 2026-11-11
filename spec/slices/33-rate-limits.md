# Slice 33 — rate limits for the forms anyone can submit

**Status:** done.
**Closes:** competitive review C001 (P0), apart from one item still to
verify live (below).

## Why

Sign-in, sign-up, password reset and the waitlist had no limit of their
own:
- **Passwords:** anyone could try them as fast as the server answered.
- **Email from NGUEZA's domain:** the waitlist (which sends a confirmation)
  and password reset could be used to mail-bomb a stranger.
- **Supabase Auth's per-IP limit made things worse, not better.** Every
  call reaches it from the app server's single IP, so one person's attempts
  throttled everybody. The README records "Demasiadas tentativas" after two
  real sign-ups.

## What changes

| Form | Limit | Over the limit |
|---|---|---|
| Sign-in | 20 per IP and 8 per email, per 10 min | "Demasiadas tentativas. Aguarde alguns minutos." |
| Sign-up | 5 per IP per hour | same |
| Password reset | 5 per IP and 3 per email, per hour | Nothing is sent, but the page is the same "enviado" either way, so the limit can't be used as an enumeration oracle |
| Waitlist | 10 per IP per hour | "Recebemos muitos pedidos deste endereço…" |

- **Postgres fixed windows** (`rate_limit_hits`, `rate_limit_hit()`, 0036):
  no Redis to run. Only the service role can call the function or touch the
  table, and windows older than a day are pruned by the existing cron sweep.
- **Keys are SHA-256 hashes** of bucket plus IP or email; the table never
  holds a raw address. (An IPv4 hash is brute-forceable, so the 24-hour
  retention is the real protection.)
- **IP:** Vercel's `x-real-ip` / `x-forwarded-for`, which Vercel overwrites
  at its edge. With no IP (local dev), no limit applies.
- **Fails open:** if the database can't count, the request goes ahead.
- **Supabase Auth now receives the visitor's IP** as `X-Forwarded-For` on
  sign-in, sign-up and reset.

## To verify live

Whether hosted Supabase Auth honours `X-Forwarded-For` from this caller
for its own per-IP limit isn't something tests can show. If it does, the
shared-IP lockout is gone. If not, nothing is worse, and this slice's
limits still apply per visitor. **Check after deploy:** several failed
sign-ins from one network shouldn't produce "Demasiadas tentativas" for a
different network.

## Acceptance

- [x] Up to the limit per window, then refused; separate per key and per bucket.
- [x] Twenty simultaneous hits let through exactly the limit.
- [x] Several limits together: refused if any is exceeded, and all are counted.
- [x] Email keys ignore case; no raw IP or email is stored.
- [x] Visitors and signed-in users can neither call the function nor read the table.
- [x] Windows older than a day are pruned.
