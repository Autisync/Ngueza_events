import { describe, expect, it } from 'vitest'
import {
  budgetSummary, daysLeftLabel, daysUntil, dueDate, isItemStatus, percentOf, preparation, shareOf,
  supplierSearchHref,
} from '@/lib/event-plan-math'

/** Slice 50: the planner's arithmetic stays in integer cêntimos. */

// 12:00 in Luanda (UTC+1) on 1 March 2031.
const NOW = new Date('2031-03-01T11:00:00Z')

describe('shareOf', () => {
  it('splits a budget by basis points, in integers', () => {
    expect(shareOf(500_000_000n, 3000)).toBe(150_000_000n) // 30 % of 5 000 000 Kz
    expect(shareOf(500_000_000n, 0)).toBe(0n)
    expect(shareOf(500_000_000n, 10_000)).toBe(500_000_000n)
  })
  it('rounds down to the cêntimo rather than inventing one', () => {
    expect(shareOf(1n, 3333)).toBe(0n)
    expect(shareOf(1_001n, 5000)).toBe(500n)
  })
  it('refuses a share outside 0–100 %', () => {
    expect(() => shareOf(100n, 10_001)).toThrow()
    expect(() => shareOf(100n, -1)).toThrow()
    expect(() => shareOf(100n, 12.5)).toThrow()
  })
})

describe('dueDate', () => {
  it('counts weeks back from the event date', () => {
    expect(dueDate('2031-12-15', 26)).toBe('2031-06-16')
    expect(dueDate('2031-12-15', 0)).toBe('2031-12-15')
  })
  it('crosses month and year boundaries', () => {
    expect(dueDate('2031-01-10', 2)).toBe('2030-12-27')
  })
  it('is null without a valid date', () => {
    expect(dueDate(null, 4)).toBeNull()
    expect(dueDate('15/12/2031', 4)).toBeNull()
  })
})

describe('days left', () => {
  it('counts whole days in Luanda', () => {
    expect(daysUntil('2031-03-01', NOW)).toBe(0)
    expect(daysUntil('2031-03-13', NOW)).toBe(12)
    expect(daysUntil('2031-02-26', NOW)).toBe(-3)
  })
  it('a minute before midnight in Luanda is still today', () => {
    const lateLuanda = new Date('2031-03-01T22:59:00Z') // 23:59 in Luanda
    expect(daysUntil('2031-03-01', lateLuanda)).toBe(0)
  })
  it('says it the way a person would', () => {
    expect(daysLeftLabel('2031-03-01', NOW)).toBe('É hoje')
    expect(daysLeftLabel('2031-03-02', NOW)).toBe('É amanhã')
    expect(daysLeftLabel('2031-03-13', NOW)).toBe('Faltam 12 dias')
    expect(daysLeftLabel('2031-02-28', NOW)).toBe('Foi ontem')
    expect(daysLeftLabel('2031-02-26', NOW)).toBe('Foi há 3 dias')
    expect(daysLeftLabel(null, NOW)).toBeNull()
  })
})

describe('preparation', () => {
  it('is lines treated over lines in total', () => {
    expect(preparation([{ status: 'done' }, { status: 'doing' }, { status: 'todo' }])).toEqual({ done: 1, total: 3, pct: 33 })
  })
  it('an empty plan is 0 %, not done', () => {
    expect(preparation([])).toEqual({ done: 0, total: 0, pct: 0 })
  })
})

describe('budgetSummary', () => {
  const items = [
    { estimateMinor: 150_000_000n, actualMinor: 160_000_000n },
    { estimateMinor: 140_000_000n, actualMinor: null },
    { estimateMinor: null, actualMinor: 5_000_000n },
  ]
  it('adds estimates and actuals, and what is left', () => {
    expect(budgetSummary(500_000_000n, items)).toEqual({
      budget: 500_000_000n, estimated: 290_000_000n, spent: 165_000_000n,
      remaining: 335_000_000n, usedPct: 33, over: false,
    })
  })
  it('says so when spending passes the budget', () => {
    const s = budgetSummary(100_000_000n, items)
    expect(s.over).toBe(true)
    expect(s.remaining).toBe(-65_000_000n)
    expect(s.usedPct).toBe(165)
  })
  it('has no percentage without a budget', () => {
    const s = budgetSummary(null, items)
    expect(s.remaining).toBeNull()
    expect(s.usedPct).toBeNull()
    expect(s.over).toBe(false)
  })
  it('percentOf divides in integers', () => {
    expect(percentOf(1n, 3n)).toBe(33)
    expect(percentOf(5n, 0n)).toBeNull()
  })
})

describe('statuses and links', () => {
  it('knows its three statuses and nothing else', () => {
    expect(isItemStatus('done')).toBe(true)
    expect(isItemStatus('paid')).toBe(false)
    expect(isItemStatus(undefined)).toBe(false)
  })
  it('links a need to the search, filtered', () => {
    expect(supplierSearchHref({ categorySlug: 'buffet', zonaSlug: 'talatona', date: '2099-12-15', guests: 150 }))
      .toBe('/procurar?categoria=buffet&zona=talatona&data=2099-12-15&pessoas=150')
    // A past date is not a useful availability filter.
    expect(supplierSearchHref({ categorySlug: 'djs', date: '2000-01-01' })).toBe('/procurar?categoria=djs')
  })
})

describe('formatting', () => {
  it('writes dates the Angolan way, without a timezone shift', async () => {
    const { formatYmd, monthLabels } = await import('@/lib/event-plan-math')
    expect(formatYmd('2031-12-15')).toBe('15 dez 2031')
    expect(formatYmd('2031-01-01', { year: false })).toBe('1 jan')
    expect(formatYmd(null)).toBeNull()
    expect(monthLabels('2031-06')).toEqual({ short: 'jun', long: 'Junho de 2031' })
  })
})

describe('shares as typed by an administrator', () => {
  it('reads percentages into basis points without floats', async () => {
    const { percentToBp, bpToPercent } = await import('@/lib/event-plan-math')
    expect(percentToBp('30')).toBe(3000)
    expect(percentToBp('2,5')).toBe(250)
    expect(percentToBp('2.55')).toBe(255)
    expect(percentToBp('0')).toBe(0)
    expect(percentToBp('100')).toBe(10_000)
    expect(percentToBp('100,01')).toBeNull()
    expect(percentToBp('abc')).toBeNull()
    expect(percentToBp('-5')).toBeNull()
    expect(bpToPercent(3000)).toBe('30')
    expect(bpToPercent(250)).toBe('2,5')
    expect(bpToPercent(255)).toBe('2,55')
    expect(bpToPercent(5)).toBe('0,05')
  })
})
