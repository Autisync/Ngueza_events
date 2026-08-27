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
