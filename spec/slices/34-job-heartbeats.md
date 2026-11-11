# Slice 34 — heartbeats for the scheduled jobs

**Status:** done. One human step: point an uptime monitor at `/api/saude`.
**Closes:** competitive review R070 (P0).

## Why

Two jobs keep the marketplace honest. `/api/cron/expire` (every 5
minutes) releases dates nobody paid for, completes past bookings and
expires quotes. `/api/cron/notify` (every 2 minutes) sends every email the
system queues. Both are driven by a cron container on the Portainer host
(`deploy/cron`). If it stopped, dates stayed held and no email went out,
and nothing anywhere said so.

## What changes

- **Every run is logged** (`job_runs`, 0037): start, finish, ok or error,
  and the job's own summary. A run that throws is still recorded, then
  answers 500 so the container's log shows it too. Runs older than 30 days
  are pruned by the expire sweep.
- **`job_health()`** turns the log into verdicts: `expire` stale after 15
  min, `notify` after 10 (three missed ticks each), and `outbox`, which
  catches a job that runs but can't send (an email waiting over 15 min, or
  5+ failures in an hour).
- **`GET /api/saude`** returns 200 when healthy and 503 when not, naming the
  failing check. It's public so a monitor can call it, and reveals only job
  names and how long ago they last succeeded. If the database is
  unreachable it also returns 503 (`database`).
- **The admin dashboard** shows "Tarefas agendadas" with the same verdicts
  and the latest failures, with their errors.

Only the service role writes the log; only admins read it. Visitors can't
call `job_health()` directly.

## The human step

In an uptime monitor (UptimeRobot, Better Stack…), add an HTTP check on
`https://ngueza.com/api/saude` every 5 minutes, alerting by SMS or email on
any non-200. See `deploy/cron/README.md`.

## Acceptance

- [x] Successful and failed runs are both recorded; a failed run still throws.
- [x] A job that never succeeded, or not for three ticks, is unhealthy even if it failed in between.
- [x] Old unsent email makes `outbox` unhealthy.
- [x] Only admins read the log; nobody else writes it or calls `job_health()`.
- [x] `/api/saude` answers 503 before the jobs run and names which check failed; verified locally.
- [x] Runs older than 30 days are pruned.
