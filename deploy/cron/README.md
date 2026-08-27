# Scheduled jobs — Portainer

One job today: releasing dates held by bookings nobody answered or paid
for (§26).

## Why not Vercel Cron

Vercel's Hobby plan runs cron jobs **once a day**. A request is supposed
to expire after 48 hours and a payment after 24 — a daily sweep can leave
a date held almost a full day past its deadline, which is the exact
failure §26 exists to prevent.

On **Vercel Pro**, delete this stack and put the schedule back in
`vercel.json`:

```json
{
  "framework": "nextjs",
  "crons": [{ "path": "/api/cron/expire", "schedule": "*/5 * * * *" }]
}
```

Vercel Cron sends a `GET` with `Authorization: Bearer $CRON_SECRET`
automatically when `CRON_SECRET` is set. The endpoint accepts `GET` and
`POST` for exactly this reason.

## Deploy

**Stacks → Add stack → Repository**, compose path
`deploy/cron/docker-compose.yml`, then set:

| Variable | Value |
|---|---|
| `SITE_URL` | `https://ngueza.com` — no trailing slash |
| `CRON_SECRET` | The same value as the app's `CRON_SECRET` |
| `INTERVAL_SECONDS` | `300` |

## Check it

```bash
docker logs -f ngueza-cron-expire
```

Every five minutes:

```
2026-08-27T21:05:00Z {"released":0}
2026-08-27T21:10:00Z {"released":2}
```

`released` counts the dates put back on the market that cycle. A steadily
rising number means suppliers are not answering requests — which is the
signal the phase-two plan reads to decide whether WhatsApp notifications
are worth building, not a fault in this job.

## Failure modes

| You see | Meaning |
|---|---|
| `401` | `CRON_SECRET` does not match the app's |
| `503` | The app has no `CRON_SECRET` set; the endpoint fails closed rather than open |
| `request failed` | The app is unreachable — the loop keeps going and retries next cycle |
