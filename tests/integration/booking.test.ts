import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { blockDate, expireStaleBookings, requestBooking, transition } from '@/lib/booking'
import { asSystem } from '@/lib/db'

/**
 * The booking loop. Every guarantee here is enforced by the database, so
 * these assert that the application layer surfaces them correctly rather
 * than re-implementing them.
 */

const HORIZONTE = '50000000-0000-0000-0000-000000000001'
const SALAO = '60000000-0000-0000-0000-000000000001'
const OWNER = '40000000-0000-0000-0000-000000000001'
const ANA = '40000000-0000-0000-0000-000000000090'
const JOAO = '40000000-0000-0000-0000-000000000091'

const at = (iso: string) => new Date(iso)

const clean = () =>
  asSystem(async (c) => {
    // TRUNCATE, not DELETE: booking_events is append-only by design, so a
    // cascading delete from bookings is refused. Separate statements
    // because a parameterised query cannot carry two commands.
    // No RESTART IDENTITY: that needs ownership of the sequence, which the
    // service role deliberately does not have.
    await c.query('truncate booking_events, bookings cascade')
    // Restore BOTH seeded bookings, not just the one this file uses.
    // Integration files share a database, and search/provider tests assert
    // against the seeded confirmation and the seeded manual block.
    await c.query(
      `insert into bookings (id, provider_id, client_id, resource_id, status, starts_at, ends_at)
       values ('80000000-0000-0000-0000-000000000001', $1, $2, $3, 'confirmed',
               '2026-12-15 10:00+01', '2026-12-15 23:59+01')`,
      [HORIZONTE, ANA, SALAO],
    )
    await c.query(
      `insert into bookings (id, provider_id, client_id, resource_id, status, starts_at, ends_at)
       values ('80000000-0000-0000-0000-000000000002',
               '50000000-0000-0000-0000-000000000002', null,
               '60000000-0000-0000-0000-000000000002', 'blocked',
               '2026-12-20 08:00+01', '2026-12-21 02:00+01')`,
    )
  })

beforeEach(clean)
afterEach(clean)

describe('booking', () => {
  it('accepts a request for a free date', async () => {
    const result = await requestBooking(JOAO, {
      providerId: HORIZONTE,
      resourceId: SALAO,
      startsAt: at('2027-02-10T09:00:00Z'),
      endsAt: at('2027-02-10T22:00:00Z'),
      partySize: 120,
    })
    expect(result.ok).toBe(true)
  })

  it('snapshots the cancellation policy at booking time (§29)', async () => {
    const result = await requestBooking(JOAO, {
      providerId: HORIZONTE,
      resourceId: SALAO,
      startsAt: at('2027-02-11T09:00:00Z'),
      endsAt: at('2027-02-11T22:00:00Z'),
    })
    expect(result.ok).toBe(true)

    const snapshot = await asSystem(async (c) => {
      const { rows } = await c.query<{ policy_snapshot: { name: string } | null }>(
        `select policy_snapshot from bookings where id = $1`,
        [(result as { bookingId: string }).bookingId],
      )
      return rows[0]!.policy_snapshot
    })
    // A supplier changing terms later cannot rewrite this booking's terms.
    expect(snapshot?.name).toBe('Política padrão NGUEZA')
  })

  it('does not let a pending request hold a date', async () => {
    // Two clients may both ask for the same free date; only confirmation
    // is exclusive. Blocking on request would let anyone freeze a calendar.
    const first = await requestBooking(JOAO, {
      providerId: HORIZONTE, resourceId: SALAO,
      startsAt: at('2027-03-01T09:00:00Z'), endsAt: at('2027-03-01T22:00:00Z'),
    })
    const second = await requestBooking(ANA, {
      providerId: HORIZONTE, resourceId: SALAO,
      startsAt: at('2027-03-01T09:00:00Z'), endsAt: at('2027-03-01T22:00:00Z'),
    })
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
  })

  it('turns a clash into a readable reason rather than throwing (§27)', async () => {
    const result = await requestBooking(JOAO, {
      providerId: HORIZONTE, resourceId: SALAO,
      startsAt: at('2026-12-15T18:00:00Z'), endsAt: at('2026-12-16T01:00:00Z'),
    })
    expect(result).toEqual({ ok: false, reason: 'slot_taken' })
  })

  it('still lets the constraint decide when the pre-check races', async () => {
    // The courtesy check in requestBooking can go stale between read and
    // write. Confirming is where exclusivity is actually enforced, and it
    // must hold even when two bookings got as far as being accepted.
    const a = await requestBooking(JOAO, {
      providerId: HORIZONTE, resourceId: SALAO,
      startsAt: at('2027-09-01T09:00:00Z'), endsAt: at('2027-09-01T22:00:00Z'),
    })
    const b = await requestBooking(ANA, {
      providerId: HORIZONTE, resourceId: SALAO,
      startsAt: at('2027-09-01T15:00:00Z'), endsAt: at('2027-09-02T01:00:00Z'),
    })
    const idA = (a as { bookingId: string }).bookingId
    const idB = (b as { bookingId: string }).bookingId

    await transition(OWNER, idA, 'accepted')
    await transition(OWNER, idB, 'accepted')
    expect(await transition(OWNER, idA, 'confirmed')).toEqual({ ok: true })
    expect(await transition(OWNER, idB, 'confirmed')).toEqual({ ok: false, reason: 'slot_taken' })
  })

  it('refuses a transition the state machine does not allow', async () => {
    const created = await requestBooking(JOAO, {
      providerId: HORIZONTE, resourceId: SALAO,
      startsAt: at('2027-04-01T09:00:00Z'), endsAt: at('2027-04-01T22:00:00Z'),
    })
    const id = (created as { bookingId: string }).bookingId
    expect(await transition(OWNER, id, 'completed')).toEqual({
      ok: false, reason: 'illegal_transition',
    })
    expect(await transition(OWNER, id, 'accepted')).toEqual({ ok: true })
  })

  it('hides someone else\'s booking behind not_found, not a permission error', async () => {
    const created = await requestBooking(JOAO, {
      providerId: HORIZONTE, resourceId: SALAO,
      startsAt: at('2027-05-01T09:00:00Z'), endsAt: at('2027-05-01T22:00:00Z'),
    })
    const id = (created as { bookingId: string }).bookingId
    // Ana is neither the client nor the supplier here. A distinguishable
    // error would let her probe for other people's bookings.
    expect(await transition(ANA, id, 'accepted')).toEqual({ ok: false, reason: 'not_found' })
  })

  it('blocks a walk-in date through the same constraint (§27)', async () => {
    const blocked = await blockDate(OWNER, {
      providerId: HORIZONTE, resourceId: SALAO,
      startsAt: at('2027-06-01T08:00:00Z'), endsAt: at('2027-06-02T01:00:00Z'),
    })
    expect(blocked.ok).toBe(true)

    // A blocked date is indistinguishable from a booked one, so a client
    // cannot even ask for it — which is the point of blocking.
    const clash = await requestBooking(JOAO, {
      providerId: HORIZONTE, resourceId: SALAO,
      startsAt: at('2027-06-01T18:00:00Z'), endsAt: at('2027-06-01T23:00:00Z'),
    })
    expect(clash).toEqual({ ok: false, reason: 'slot_taken' })

    // And the day either side is untouched.
    const next = await requestBooking(JOAO, {
      providerId: HORIZONTE, resourceId: SALAO,
      startsAt: at('2027-06-03T18:00:00Z'), endsAt: at('2027-06-03T23:00:00Z'),
    })
    expect(next.ok).toBe(true)
  })

  it('expires a request nobody answered, releasing the date (§26)', async () => {
    const created = await requestBooking(JOAO, {
      providerId: HORIZONTE, resourceId: SALAO,
      startsAt: at('2027-07-01T09:00:00Z'), endsAt: at('2027-07-01T22:00:00Z'),
    })
    const id = (created as { bookingId: string }).bookingId

    // Wind the deadline back rather than waiting 48 hours.
    await asSystem((c) =>
      c.query(`update bookings set expires_at = now() - interval '1 minute' where id = $1`, [id]),
    )

    expect(await expireStaleBookings()).toBeGreaterThanOrEqual(1)

    const status = await asSystem(async (c) => {
      const { rows } = await c.query<{ status: string }>(
        `select status from bookings where id = $1`, [id],
      )
      return rows[0]!.status
    })
    expect(status).toBe('expired')
  })

  it('writes an audit row for every state change (§38)', async () => {
    const created = await requestBooking(JOAO, {
      providerId: HORIZONTE, resourceId: SALAO,
      startsAt: at('2027-08-01T09:00:00Z'), endsAt: at('2027-08-01T22:00:00Z'),
    })
    const id = (created as { bookingId: string }).bookingId
    await transition(OWNER, id, 'accepted')
    await transition(OWNER, id, 'confirmed')

    const trail = await asSystem(async (c) => {
      const { rows } = await c.query<{ from_status: string | null; to_status: string }>(
        `select from_status, to_status from booking_events
          where booking_id = $1 order by id`, [id],
      )
      return rows
    })
    expect(trail.map((t) => t.to_status)).toEqual(['requested', 'accepted', 'confirmed'])
    expect(trail[0]!.from_status).toBeNull()
  })
})

/**
 * §10 / §26 — who may drive which transition, not just whether the edge
 * is legal in the graph. bookings_party_update's RLS only checks that
 * the actor is A PARTY to the booking; nothing else checked WHICH party
 * for WHICH transition until 0021. Building slice 08's "Accept" and
 * "Reject" buttons is what surfaced it: without this, a client could
 * self-accept and self-confirm their own request, skipping the supplier
 * entirely. Confirmed directly against the real `authenticated` role —
 * a first attempt as the `postgres` superuser gave a false negative,
 * since a superuser bypasses RLS (and these triggers still fire, but the
 * point stands: connect as the role the app actually uses).
 */
describe('who may drive a transition (0021)', () => {
  it('refuses a client who tries to accept their own request', async () => {
    const created = await requestBooking(JOAO, {
      providerId: HORIZONTE, resourceId: SALAO,
      startsAt: at('2027-09-10T09:00:00Z'), endsAt: at('2027-09-10T22:00:00Z'),
    })
    const id = (created as { bookingId: string }).bookingId
    expect(await transition(JOAO, id, 'accepted')).toEqual({ ok: false, reason: 'not_allowed' })
  })

  it('refuses a client who tries to confirm after a real acceptance', async () => {
    const created = await requestBooking(JOAO, {
      providerId: HORIZONTE, resourceId: SALAO,
      startsAt: at('2027-09-11T09:00:00Z'), endsAt: at('2027-09-11T22:00:00Z'),
    })
    const id = (created as { bookingId: string }).bookingId
    await transition(OWNER, id, 'accepted')
    expect(await transition(JOAO, id, 'confirmed')).toEqual({ ok: false, reason: 'not_allowed' })
  })

  it('refuses a client who tries to cancel as if they were the supplier', async () => {
    const created = await requestBooking(JOAO, {
      providerId: HORIZONTE, resourceId: SALAO,
      startsAt: at('2027-09-12T09:00:00Z'), endsAt: at('2027-09-12T22:00:00Z'),
    })
    const id = (created as { bookingId: string }).bookingId
    await transition(OWNER, id, 'accepted')
    expect(await transition(JOAO, id, 'cancelled_provider')).toEqual({
      ok: false, reason: 'not_allowed',
    })
  })

  it('lets the client cancel their own request', async () => {
    const created = await requestBooking(JOAO, {
      providerId: HORIZONTE, resourceId: SALAO,
      startsAt: at('2027-09-13T09:00:00Z'), endsAt: at('2027-09-13T22:00:00Z'),
    })
    const id = (created as { bookingId: string }).bookingId
    expect(await transition(JOAO, id, 'cancelled_client')).toEqual({ ok: true })
  })

  it('refuses a supplier who tries to cancel as if they were the client', async () => {
    const created = await requestBooking(JOAO, {
      providerId: HORIZONTE, resourceId: SALAO,
      startsAt: at('2027-09-14T09:00:00Z'), endsAt: at('2027-09-14T22:00:00Z'),
    })
    const id = (created as { bookingId: string }).bookingId
    expect(await transition(OWNER, id, 'cancelled_client')).toEqual({
      ok: false, reason: 'not_allowed',
    })
  })

  it('lets the supplier walk the whole accept -> confirm -> complete path', async () => {
    const created = await requestBooking(JOAO, {
      providerId: HORIZONTE, resourceId: SALAO,
      startsAt: at('2027-09-15T09:00:00Z'), endsAt: at('2027-09-15T22:00:00Z'),
    })
    const id = (created as { bookingId: string }).bookingId
    expect(await transition(OWNER, id, 'accepted')).toEqual({ ok: true })
    expect(await transition(OWNER, id, 'confirmed')).toEqual({ ok: true })
    expect(await transition(OWNER, id, 'completed')).toEqual({ ok: true })
  })

  it('lets an administrator drive any transition', async () => {
    const created = await requestBooking(JOAO, {
      providerId: HORIZONTE, resourceId: SALAO,
      startsAt: at('2027-09-16T09:00:00Z'), endsAt: at('2027-09-16T22:00:00Z'),
    })
    const id = (created as { bookingId: string }).bookingId
    const ADMIN = '40000000-0000-0000-0000-000000000099'
    expect(await transition(ADMIN, id, 'rejected')).toEqual({ ok: true })
  })

  it('refuses expired to EVERY person, admin included — job only, no exception', async () => {
    const created = await requestBooking(JOAO, {
      providerId: HORIZONTE, resourceId: SALAO,
      startsAt: at('2027-09-17T09:00:00Z'), endsAt: at('2027-09-17T22:00:00Z'),
    })
    const id = (created as { bookingId: string }).bookingId
    const ADMIN = '40000000-0000-0000-0000-000000000099'
    expect(await transition(ADMIN, id, 'expired')).toEqual({ ok: false, reason: 'not_allowed' })
    expect(await transition(JOAO, id, 'expired')).toEqual({ ok: false, reason: 'not_allowed' })
    expect(await transition(OWNER, id, 'expired')).toEqual({ ok: false, reason: 'not_allowed' })
  })

  it('still lets the scheduled job expire it — the one legitimate path', async () => {
    const created = await requestBooking(JOAO, {
      providerId: HORIZONTE, resourceId: SALAO,
      startsAt: at('2027-09-18T09:00:00Z'), endsAt: at('2027-09-18T22:00:00Z'),
    })
    const id = (created as { bookingId: string }).bookingId
    await asSystem((c) =>
      c.query(`update bookings set expires_at = now() - interval '1 minute' where id = $1`, [id]),
    )
    expect(await expireStaleBookings()).toBeGreaterThanOrEqual(1)
    const status = await asSystem(async (c) => {
      const { rows } = await c.query<{ status: string }>(`select status from bookings where id = $1`, [id])
      return rows[0]!.status
    })
    expect(status).toBe('expired')
  })

  it('hides the booking from an unrelated supplier entirely — not_found, not not_allowed', async () => {
    // not_allowed is for a genuine party attempting the wrong role's
    // transition. A stranger to this booking is not a party at all, so
    // RLS filters the row out before the 0021 trigger ever runs — the
    // same not_found this file already asserts for other actors, kept
    // consistent rather than leaking a more specific error to a stranger.
    const created = await requestBooking(JOAO, {
      providerId: HORIZONTE, resourceId: SALAO,
      startsAt: at('2027-09-19T09:00:00Z'), endsAt: at('2027-09-19T22:00:00Z'),
    })
    const id = (created as { bookingId: string }).bookingId
    await transition(OWNER, id, 'accepted')
    await transition(OWNER, id, 'confirmed')
    const OTHER_OWNER = '40000000-0000-0000-0000-000000000002' // Quinta das Palmeiras' owner
    expect(await transition(OTHER_OWNER, id, 'no_show')).toEqual({ ok: false, reason: 'not_found' })
    expect(await transition(OWNER, id, 'no_show')).toEqual({ ok: true })
  })
})
