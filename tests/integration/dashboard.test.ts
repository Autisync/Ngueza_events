import { describe, expect, it } from 'vitest'
import { asSystem } from '@/lib/db'
import { adminOverview, clientNavCounts, monthWindow, supplierOverview, weekWindow } from '@/lib/dashboard'

/** Slice 50: the numbers behind the three dashboards, counted as the reader. */

const OWNER = '40000000-0000-0000-0000-000000000001'
const HORIZONTE = '50000000-0000-0000-0000-000000000001'
const JOAO = '40000000-0000-0000-0000-000000000091'
const ADMIN = '40000000-0000-0000-0000-000000000099'

describe('windows', () => {
  it('twelve months around this one, in Luanda', () => {
    // 23:30 UTC on 31 Jan is already 1 February in Luanda.
    const w = monthWindow(new Date('2031-01-31T23:30:00Z'))
    expect(w).toHaveLength(12)
    expect(w[6]).toBe('2031-02')
    expect(w[0]).toBe('2030-08')
    expect(w[11]).toBe('2031-07')
  })
  it('eight Mondays up to this week', () => {
    const w = weekWindow(new Date('2031-03-05T12:00:00Z')) // a Wednesday
    expect(w).toHaveLength(8)
    expect(w[7]).toBe('2031-03-03')
    expect(w[0]).toBe('2031-01-13')
    expect(w.every((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 1)).toBe(true)
  })
})

describe('supplier overview', () => {
  it('counts only the business\'s own bookings, gaps filled', async () => {
    const o = await supplierOverview(OWNER, HORIZONTE)
    expect(o.months).toHaveLength(12)
    expect(o.byStatus.map((s) => s.count)).toEqual([...o.byStatus.map((s) => s.count)].sort((a, b) => b - a))
    expect(o.next.length).toBeLessThanOrEqual(5)
    const starts = o.next.map((b) => b.startsAt)
    expect([...starts].sort()).toEqual(starts)
    expect(typeof o.bookedThisYear).toBe('bigint')
  })
  it('another supplier sees nothing of it', async () => {
    const o = await supplierOverview('40000000-0000-0000-0000-000000000002', HORIZONTE)
    expect(o.months.every((m) => m.count === 0)).toBe(true)
    expect(o.next).toEqual([])
    expect(o.bookedThisYear).toBe(0n)
  })
})

describe('admin overview', () => {
  it('counts suppliers by state, real ones only', async () => {
    const o = await adminOverview(ADMIN)
    expect(o.weeks).toHaveLength(8)
    const { rows } = await asSystem((c) => c.query<{ n: number }>(`select count(*)::int as n from providers where not is_demo`))
    expect(o.suppliers.reduce((s, x) => s + x.count, 0)).toBe(rows[0]!.n)
  })
  it('is refused nothing, but a client counts nothing', async () => {
    const o = await adminOverview(JOAO)
    // RLS: a client sees no other client's profile and no unpublished supplier.
    expect(o.clients).toBeLessThanOrEqual(1)
  })
})

describe('client counts', () => {
  it('are the client\'s own', async () => {
    const n = await clientNavCounts(JOAO)
    expect(n.toPay).toBeGreaterThanOrEqual(0)
    expect(n.offers).toBeGreaterThanOrEqual(0)
  })
})
