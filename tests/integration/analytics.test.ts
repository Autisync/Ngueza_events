import { beforeEach, describe, expect, it } from 'vitest'
import { requestBooking } from '@/lib/booking'
import { asSystem } from '@/lib/db'
import { recordContactReveal, recordProviderView } from '@/lib/provider'
import { recordSearch } from '@/lib/search'

/**
 * The phase-two gates read from this table and nothing else, and none of it
 * can be backfilled. If these events are not emitted with a session id, the
 * decisions in the phase-two plan are guesswork.
 */

const HORIZONTE = '50000000-0000-0000-0000-000000000001'
const SALAO = '60000000-0000-0000-0000-000000000001'
const JOAO = '40000000-0000-0000-0000-000000000091'

const rows = (name: string) =>
  asSystem(async (c) => {
    const { rows } = await c.query<{ session_id: string | null; provider_id: string | null; props: any }>(
      `select session_id, provider_id, props from events where name = $1`,
      [name],
    )
    return rows
  })

beforeEach(() => asSystem((c) => c.query(`delete from events`)))

describe('event tracking', () => {
  it('records a provider view against a session', async () => {
    await recordProviderView(HORIZONTE, 'sess-a')
    const [row] = await rows('provider_viewed')
    expect(row?.session_id).toBe('sess-a')
    expect(row?.provider_id).toBe(HORIZONTE)
  })

  it('records both contact channels — the §32 leakage numerator', async () => {
    await recordContactReveal(HORIZONTE, 'phone', 'sess-a')
    await recordContactReveal(HORIZONTE, 'whatsapp', 'sess-a')
    expect(await rows('phone_revealed')).toHaveLength(1)
    expect(await rows('whatsapp_clicked')).toHaveLength(1)
  })

  it('records a booking request in the same transaction as the booking', async () => {
    const result = await requestBooking(JOAO, {
      providerId: HORIZONTE,
      resourceId: SALAO,
      startsAt: new Date('2027-11-01T09:00:00Z'),
      endsAt: new Date('2027-11-01T22:00:00Z'),
      partySize: 90,
      sessionId: 'sess-a',
    })
    expect(result.ok).toBe(true)

    const [row] = await rows('booking_requested')
    expect(row?.session_id).toBe('sess-a')
    expect(row?.props.party_size).toBe(90)
  })

  it('does not record a booking request when the booking is refused', async () => {
    // Same date as the seeded confirmation.
    const result = await requestBooking(JOAO, {
      providerId: HORIZONTE,
      resourceId: SALAO,
      startsAt: new Date('2026-12-15T18:00:00Z'),
      endsAt: new Date('2026-12-16T01:00:00Z'),
      sessionId: 'sess-a',
    })
    expect(result.ok).toBe(false)
    expect(await rows('booking_requested')).toHaveLength(0)
  })

  it('separates a zero-result search — the supply gap, written by clients', async () => {
    await recordSearch({ sessionId: 'sess-b', query: { capacity: 99999 }, resultCount: 0 })
    await recordSearch({ sessionId: 'sess-b', query: {}, resultCount: 5 })

    const zero = await rows('zero_result')
    expect(zero).toHaveLength(1)
    expect(zero[0]!.props.capacity).toBe(99999)
    expect(await rows('search_performed')).toHaveLength(1)
  })

  it('answers the two questions phase two actually asks', async () => {
    // 1. Leakage ratio: contact reveals per booking request.
    await recordContactReveal(HORIZONTE, 'phone', 'sess-1')
    await recordContactReveal(HORIZONTE, 'whatsapp', 'sess-2')
    await requestBooking(JOAO, {
      providerId: HORIZONTE, resourceId: SALAO,
      startsAt: new Date('2027-11-05T09:00:00Z'), endsAt: new Date('2027-11-05T22:00:00Z'),
      sessionId: 'sess-3',
    })

    const leakage = await asSystem(async (c) => {
      const { rows } = await c.query<{ reveals: string; requests: string }>(
        `select
           count(*) filter (where name in ('phone_revealed','whatsapp_clicked'))::text as reveals,
           count(*) filter (where name = 'booking_requested')::text as requests
         from events`,
      )
      return rows[0]!
    })
    expect(Number(leakage.reveals)).toBe(2)
    expect(Number(leakage.requests)).toBe(1)

    // 2. Comparison-intent: sessions viewing 3+ suppliers.
    for (const p of [HORIZONTE, '50000000-0000-0000-0000-000000000002',
                     '50000000-0000-0000-0000-000000000003']) {
      await recordProviderView(p, 'sess-compare')
    }
    const comparing = await asSystem(async (c) => {
      const { rows } = await c.query<{ n: string }>(
        `select count(*)::text as n from (
           select session_id from events
            where name = 'provider_viewed' and session_id is not null
            group by session_id having count(distinct provider_id) >= 3
         ) s`,
      )
      return Number(rows[0]!.n)
    })
    expect(comparing).toBe(1)
  })
})
