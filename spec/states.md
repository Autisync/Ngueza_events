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
| `cancelled_provider` | no | — | Supplier cancelled. |
| `no_show` | no | — | Client did not appear. |
| `blocked` | **yes** | — | Supplier blocking a date booked off-platform (§27). No client. |

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
