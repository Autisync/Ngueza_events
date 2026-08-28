# Slice 10 — notifications

**Status:** done.
**Ownership:** agent + review.

A supplier hears their listing was verified, rejected or suspended. A
client hears their request was accepted, confirmed, rejected or expired.
Neither previously happened at all — `booking_events` and `audit_log`
both recorded what happened, but nothing reached a person (§17).

## Why the outbox pattern, not "just send an email in the trigger"

A database trigger runs *inside* the transaction that changed the row.
An HTTP call from in there either blocks that transaction on network
latency, or — worse — sends the email and then the transaction rolls
back, and the thing the email describes never actually happened.

So a trigger only **enqueues**: it writes a row to `notification_outbox`
describing what to send and to whom. A scheduled job
(`POST /api/cron/notify`, the same shared-secret pattern as the existing
expiry job) sends it afterwards, entirely outside any database
transaction. This is the standard outbox pattern, and it is the only safe
way to get a side effect out of a trigger.

## Who gets told what

One rule decides the recipient for every booking transition: **tell the
party who did not just act.** A client who cancels already knows they
cancelled; the supplier does not, until this fires. `confirmed` is the
one case both parties need telling, since either side can be the one who
triggered it — a payment webhook, an admin, or the supplier accepting
straight through — so it writes two independent rows rather than trying
to infer who already knows.

Provider decisions ride on `audit_log` rather than watching `providers`
directly: `audit_log` already fires only when `verification_status`
actually changed and already carries before/after, so re-deriving "did
this change" a second time would risk the two definitions drifting apart.
`unverified → pending` — a supplier submitting their own paperwork —
deliberately sends nothing; they already know, they just did it.

## Deduplication is a database constraint, not application discipline

`unique (source_table, source_id, kind)`. A retried trigger, or the same
transition somehow firing twice, produces the same pair and the second
insert is a silent no-op. The claim step then uses `FOR UPDATE SKIP
LOCKED` to flip `pending → sending`, so two callers — the Vercel cron
tick and the Portainer loop running at once, say — partition a batch
between them instead of racing to send the same email twice. Claiming and
sending are two separate database round trips on purpose: holding a row
lock across the network call to the mail provider would let one slow send
block an entire concurrent caller's batch instead of just one row.

**Proven with real OS-level concurrency**, not an async approximation of
it: `tests/notify-concurrency.sh` fires up to 50 simultaneous `curl`
processes at a running server's `/api/cron/notify`, seeded with that many
pending rows, and asserts every one sent exactly once. Run three times
running, including once at 50-way, all clean:

```
sent: 30 of 30 · stuck: 0
outbox file entries for this run: 30 (expected exactly 30, never double)
PASS: 30 concurrent cron calls sent every row exactly once
...
sent: 50 of 50 · stuck: 0
PASS: 50 concurrent cron calls sent every row exactly once
```

## A retry that would have silently double-sent

Marking a failed attempt used a single `UPDATE` binding the same
parameter twice — once in a `CASE` comparison, once in a column
assignment — and Postgres could not unify the parameter's type across
both without an explicit cast, failing with a type error on every retry
path. Caught by the failure-path test, not by the happy path, which is
exactly why that test exists: a retry mechanism that itself throws is
worse than no retry at all, since the row would sit stuck in `pending`
forever with the mail already having gone out once.

## Verified

`tests/unit/notify.test.ts` (14): every kind renders without throwing,
Africa/Luanda formatting, a rejected client is pointed to search while an
expired one is pointed back to the *same* supplier (worth retrying, not
turned down), a suspended supplier gets a human to write to rather than a
dead end.

`tests/integration/notifications.test.ts` (11): the right kind enqueued
for the right transition, both parties notified on confirmation, a
manual block enqueues nothing, the reason carries through to a rejection,
`SKIP LOCKED` accounts for every row exactly once, a malformed row fails
without blocking the rest of its batch, admin visibility and its absence
for anyone else.

`tests/notify-concurrency.sh`: run by hand against a live server, three
times, up to 50-way concurrency — see above.

## What this is not

Not SMS or WhatsApp (§17 defers those, and the phase-two plan gates them
on the leakage ratio slice 13 already measures). Not a preference
centre — every kind here is transactional, tied to an action the
recipient took or was affected by, and travels on the transactional
sending identity, never the marketing one. Not retried indefinitely — five
attempts, then `failed` for good, visible on `/admin/registo` rather than
disappearing.
