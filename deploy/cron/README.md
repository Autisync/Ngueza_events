# Scheduled jobs — Portainer

Two jobs today:

1. Releasing dates held by bookings nobody answered or paid for (§26).
2. Sending whatever is waiting in the notification outbox (§17) — booking
   updates and supplier verification decisions.

## Why not Vercel Cron

Vercel's Hobby plan runs cron jobs **once a day**. A booking request is
supposed to expire after 48 hours and a payment after 24 — a daily sweep
can leave a date held almost a full day past its deadline, which is the
exact failure §26 exists to prevent. A once-a-day notification sweep is
worse: a client would sometimes wait most of a day to hear their request
was accepted.

On **Vercel Pro**, delete this stack and put both schedules back in
`vercel.json`:

```json
{
  "framework": "nextjs",
  "crons": [
    { "path": "/api/cron/expire", "schedule": "*/5 * * * *" },
    { "path": "/api/cron/notify", "schedule": "*/2 * * * *" }
  ]
}
```

Vercel Cron sends a `GET` with `Authorization: Bearer $CRON_SECRET`
automatically when `CRON_SECRET` is set. Both endpoints accept `GET` and
`POST` for exactly this reason.

## Deploy

**Stacks → Add stack → Repository**, compose path
`deploy/cron/docker-compose.yml`, then set:

| Variable | Value |
|---|---|
| `SITE_URL` | `https://ngueza.com` — no trailing slash |
| `CRON_SECRET` | The same value as the app's `CRON_SECRET` |
| `INTERVAL_SECONDS` | `300` — the expiry sweep |
| `NOTIFY_INTERVAL_SECONDS` | `60` — the notification sweep, deliberately shorter |

## Check it

```bash
docker logs -f ngueza-cron-expire
docker logs -f ngueza-cron-notify
```

```
2026-08-27T21:05:00Z {"released":0}
2026-08-27T21:10:00Z {"released":2}
```

`released` counts the dates put back on the market that cycle. A steadily
rising number means suppliers are not answering requests — which is the
signal the phase-two plan reads to decide whether WhatsApp notifications
are worth building, not a fault in this job.

```
2026-08-27T21:06:00Z {"claimed":3,"sent":3,"failed":0}
```

`claimed` is how many rows this tick picked up, `sent` how many actually
went out, `failed` how many hit an error and are either back in the queue
for the next tick or, past five attempts, marked `failed` for good — those
show up on `/admin/registo` with the error that killed them.

## Proving the notify job cannot double-send

`tests/notify-concurrency.sh` fires many simultaneous calls at
`/api/cron/notify` against a running app and asserts every row was sent
exactly once — the same kind of real, OS-level race proof
`tests/concurrency.sh` gives the booking exclusion constraint, rather than
an in-process approximation of one:

```bash
CRON_SECRET=xxx SITE_URL=http://localhost:3210 ./tests/notify-concurrency.sh
```

## Failure modes

| You see | Meaning |
|---|---|
| `401` | `CRON_SECRET` does not match the app's |
| `503` | The app has no `CRON_SECRET` set; the endpoint fails closed rather than open |
| `request failed` | The app is unreachable — the loop keeps going and retries next cycle |
