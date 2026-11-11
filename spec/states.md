# Booking state machine

Enforced by `booking_can_transition()` and `bookings_guard_transition` in
`supabase/migrations/0005_bookings.sql`. Application code proposes a
transition; the database decides whether it is legal.

## States

| State | Holds the slot? | Expires after | Meaning |
|---|---|---|---|
| `requested` | no | 48h | Client asked. Supplier has not answered. |
| `accepted` | no | 48h | Supplier said yes. Client must proceed. |
| `awaiting_payment` | **yes** | 24h | Payment outstanding. |
| `confirmed` | **yes** | — | Booked. |
| `completed` | no | — | The event happened. Unlocks a verified review. |
| `expired` | no | — | Nobody acted in time. Date released automatically. |
| `rejected` | no | — | Supplier declined. |
| `cancelled_client` | no | — | Client cancelled. Policy decides the refund. |
| `cancelled_provider` | no | — | Supplier cancelled. Requires `cancellation_reason` (except unblocking a manual block), set in the same update and never edited afterwards (0045). |
| `no_show` | no | — | Client did not appear. |
| `blocked` | **yes** | — | Supplier blocking a date booked off-platform (§27). No client. |
| `unavailable` | no | — | Another booking took the date (0033). Set by the database only. |

`awaiting_payment` holds the slot deliberately. Without it, two clients can
both reach payment for the same date and one necessarily loses *after*
paying. It is safe because it carries a 24-hour deadline, which is what §26
requires.

## Transitions

```
requested ──► accepted ──► awaiting_payment ──► confirmed ──► completed
    │             │                │                │
    │             │                │                ├──► cancelled_client
    │             │                │                ├──► cancelled_provider
    │             │                │                └──► no_show
    │             │                │
    ├──► rejected │                ├──► expired
    ├──► expired  ├──► expired     ├──► cancelled_client
    └──► cancelled_client          └──► cancelled_provider
                  ├──► cancelled_client
                  ├──► cancelled_provider
                  └──► confirmed        (flows with no payment step)

blocked ──► cancelled_provider

requested ──► unavailable   ┐  the moment another booking on the same space
accepted  ──► unavailable   ┘  starts to hold an overlapping date (0033)
```

Anything not listed above raises `check_violation`. There is no path back
out of a terminal state; a client who wants to rebook creates a new booking.

## Who may trigger what

| Transition | Client | Supplier | Admin | Job |
|---|---|---|---|---|
| `→ requested` | ✓ | — | ✓ | — |
| `→ accepted` / `→ rejected` | — | ✓ | ✓ | — |
| `→ awaiting_payment` | — | ✓ | ✓ | — |
| `→ confirmed` | — | ✓ | ✓ | ✓ (payment webhook) |
| `→ completed` | — | ✓ | ✓ | ✓ (after `ends_at`) |
| `→ no_show` | — | ✓ | ✓ | — |
| `→ expired` | — | — | — | ✓ only, no exception |
| `→ cancelled_client` | ✓ | — | ✓ | — |
| `→ cancelled_provider` | — | ✓ | ✓ | — |
| `→ blocked` | — | ✓ | ✓ | — |
| `→ unavailable` | — | — | — | ✓ only — the database, inside the transition that took the date |

**Enforced by `bookings_guard_actor` (0021), not only documented here.**
`bookings_guard_transition` (0006) enforces the state *graph* — that
`requested → confirmed` directly is illegal, for instance. It never
enforced *who* may walk a legal edge, and nothing else did either:
`bookings_party_update`'s RLS policy only checks that the actor is *a*
party to the booking (`client_id = auth.uid() OR owns_provider(...)`),
not which transition that party is entitled to make. A client could set
their own booking straight to `accepted` and then `confirmed`, with zero
supplier action — confirmed directly, as the real `authenticated` role,
while building the booking screens (slice 08).

`→ expired` has no admin exception, deliberately. A person deciding a
date is free again is making a cancellation, which is attributable to
whoever decided it; `expired` means specifically that nobody acted in
time, and only the scheduled job may set it.

## Releasing competitors (0033)

A pending request does not hold a date, so a supplier can accept two
clients for the same space and day. When one of them starts to hold it —
`awaiting_payment`, `confirmed` or `blocked` — `bookings_release_competitors`
moves every overlapping `requested`/`accepted` booking on that space to
`unavailable`, in the same transaction, and the client is told with a link to
the same search on the same date. Before 0033 the loser sat on "Aceite" until
it expired 48h later, with an email saying nobody had acted in time.

- **Not `expired`** (nobody failed to act), and **not `rejected` /
  `cancelled_provider`** (the supplier did nothing to this client, and
  those count against them).
- **Database only.** Judged by `bookings_guard_unavailable`, an
  invoker-rights trigger. `bookings_guard_actor` is `SECURITY DEFINER`, so
  inside it `current_user` is always its owner and it cannot tell a person
  from the release function.
- **No deadlock.** The release uses `FOR UPDATE SKIP LOCKED`. A competing
  row that another transaction is changing (typically its own racing
  confirmation) is left to the exclusion constraint, as before.
- **No new "aceite" for a held date.** `requested → accepted` fails with
  `23P01` if the space is already held (`bookings_guard_held_date`).
- **Venues only.** A service supplier's capacity is a count of overlapping
  holds, so one more hold does not make a particular competing request
  impossible.

## Expiry

`expire_stale_bookings()` runs every five minutes and moves anything past
`expires_at` to `expired`, releasing the date. `expires_at` is written by
trigger on every state change — never by application code.

## Two supplier types, two enforcement paths

| | `venue` | `service` |
|---|---|---|
| Enforced by | `bookings_no_double_booking` exclusion constraint | `bookings_enforce_concurrency` trigger |
| Rule | No two overlapping holds on one `resource_id` | At most `concurrency_limit` overlapping holds |
| Error | `23P01` | `23P01` |

Both raise the same SQLSTATE so callers handle one code path.
