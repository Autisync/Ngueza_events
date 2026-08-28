import { beforeEach, describe, expect, it } from 'vitest'
import { requestBooking } from '@/lib/booking'
import { asSystem, asVisitor } from '@/lib/db'
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
const ADMIN = '40000000-0000-0000-0000-000000000099'

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

/**
 * The admin dashboard (§48, §49) — both the numbers it computes and the
 * boundary this session found while building it: provider_health (0010)
 * had no security_invoker, so it ran with its owner's privileges against
 * bookings/booking_events and ignored their RLS. Fixed in 0024 with
 * admin_provider_health(), a SECURITY DEFINER wrapper that refuses
 * anyone but an administrator outright, rather than filtering rows.
 */
describe('the admin dashboard', () => {
  it('computes the §32 leakage ratio and the zero-result rate for this month', async () => {
    const { dashboardMetrics } = await import('@/lib/analytics')

    await recordContactReveal(HORIZONTE, 'phone', 'sess-1')
    await recordContactReveal(HORIZONTE, 'whatsapp', 'sess-2')
    await requestBooking(JOAO, {
      providerId: HORIZONTE, resourceId: SALAO,
      startsAt: new Date('2027-11-06T09:00:00Z'), endsAt: new Date('2027-11-06T22:00:00Z'),
      sessionId: 'sess-3',
    })
    await recordSearch({ sessionId: 'sess-b', query: { capacity: 99999 }, resultCount: 0 })
    await recordSearch({ sessionId: 'sess-b', query: {}, resultCount: 5 })

    const m = await dashboardMetrics(ADMIN)
    // 2 reveals, 1 request: 2 / (2 + 1) = 66.7%.
    expect(m.leakageRatioPct).toBeCloseTo(66.7, 1)
    // 1 of 2 searches this month returned nothing: 50%.
    expect(m.zeroResultRatePct).toBe(50)
    expect(m.month.contactReveals).toBe(2)
    expect(m.month.bookingRequests).toBe(1)
    expect(m.month.searches).toBe(2)
  })

  it('is null, not a divide-by-zero, when this file\'s events are empty', async () => {
    // Only `events` is scoped to this test (beforeEach clears it) — other
    // integration files share this same database and continually
    // re-seed real rows in `bookings`, so requestToConfirmedPct is not
    // assertable here; its null-on-zero handling is the same `pct()`
    // helper the two ratios below already exercise.
    const { dashboardMetrics } = await import('@/lib/analytics')
    const m = await dashboardMetrics(ADMIN)
    expect(m.leakageRatioPct).toBeNull()
    expect(m.zeroResultRatePct).toBeNull()
    expect(m.today).toEqual({
      searches: 0, zeroResults: 0, providerViews: 0,
      contactReveals: 0, bookingRequests: 0, newsletterSignups: 0,
    })
  })

  it('reports supplier health only to an administrator (0024)', async () => {
    const { providerHealthReport } = await import('@/lib/analytics')
    const report = await providerHealthReport(ADMIN)
    expect(report.length).toBeGreaterThan(0)
    expect(report.every((r) => typeof r.isStale === 'boolean')).toBe(true)
  })

  it('refuses provider health to a non-admin — not filtered, refused outright', async () => {
    const { providerHealthReport } = await import('@/lib/analytics')
    await expect(providerHealthReport(JOAO)).rejects.toThrow()
  })

  it('refuses provider_health to an anonymous visitor at the database level', async () => {
    const free = await asVisitor(async (c) => {
      try {
        await c.query(`select 1 from provider_health`)
        return true
      } catch {
        return false
      }
    })
    expect(free).toBe(false)
  })
})
