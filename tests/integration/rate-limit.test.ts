import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { asSystem, asUser, asVisitor } from '@/lib/db'
import { allow, allowAll, pruneRateLimits, type Limit } from '@/lib/rate-limit'

/**
 * Slice 33 — rate limits for the forms anyone can submit (0036).
 */

const TEST: Limit = { bucket: 'test:ip', limit: 3, windowSeconds: 600 }
const OTHER: Limit = { bucket: 'test:email', limit: 1, windowSeconds: 600 }
const clean = () => asSystem((c) => c.query(`delete from rate_limit_hits where bucket like 'test:%'`))

beforeEach(clean)
afterAll(clean)

describe('rate limits', () => {
  it('allows up to the limit in a window, then refuses', async () => {
    const results = []
    for (let i = 0; i < 5; i++) results.push(await allow(TEST, '203.0.113.7'))
    expect(results).toEqual([true, true, true, false, false])
  })

  it('counts each key separately, and each bucket separately', async () => {
    for (let i = 0; i < 3; i++) await allow(TEST, '203.0.113.7')
    expect(await allow(TEST, '203.0.113.8')).toBe(true)
    expect(await allow(OTHER, '203.0.113.7')).toBe(true)
  })

  it('holds under a burst: 20 simultaneous hits, exactly the limit allowed', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => allow(TEST, '198.51.100.1')))
    expect(results.filter(Boolean)).toHaveLength(3)
  })

  it('refuses when any of several limits is exceeded, and still counts them all', async () => {
    expect(await allowAll([[TEST, '203.0.113.9'], [OTHER, 'ana@exemplo.ao']])).toBe(true)
    expect(await allowAll([[TEST, '203.0.113.9'], [OTHER, 'ana@exemplo.ao']])).toBe(false)
    const hits = await asSystem(async (c) =>
      (await c.query(`select bucket, hits from rate_limit_hits where bucket like 'test:%' order by bucket`)).rows)
    expect(hits).toEqual([{ bucket: 'test:email', hits: 2 }, { bucket: 'test:ip', hits: 2 }])
  })

  it('treats an address the same whatever its case', async () => {
    expect(await allow(OTHER, 'Ana@Exemplo.AO')).toBe(true)
    expect(await allow(OTHER, 'ana@exemplo.ao')).toBe(false)
  })

  it('never stores the raw IP or email', async () => {
    await allow(TEST, '203.0.113.7')
    await allow(OTHER, 'ana@exemplo.ao')
    const keys = await asSystem(async (c) =>
      (await c.query<{ key: string }>(`select key from rate_limit_hits where bucket like 'test:%'`)).rows.map((r) => r.key))
    for (const k of keys) {
      expect(k).toMatch(/^[0-9a-f]{64}$/)
      expect(k).not.toContain('203.0.113.7')
      expect(k).not.toContain('ana@')
    }
  })

  it('applies no limit when there is nothing to key on', async () => {
    for (let i = 0; i < 5; i++) expect(await allow(TEST, null)).toBe(true)
  })

  it('is out of reach of visitors and signed-in users alike', async () => {
    await expect(asVisitor((c) => c.query(`select rate_limit_hit('test:ip', 'x', 100, 60)`)))
      .rejects.toMatchObject({ code: '42501' })
    await expect(asUser('40000000-0000-0000-0000-000000000090', (c) =>
      c.query(`select rate_limit_hit('test:ip', 'x', 100, 60)`))).rejects.toMatchObject({ code: '42501' })
    await expect(asVisitor((c) => c.query(`select * from rate_limit_hits`)))
      .rejects.toMatchObject({ code: '42501' })
  })

  it('prunes windows older than a day', async () => {
    await asSystem((c) => c.query(
      `insert into rate_limit_hits (bucket, key, window_start, hits) values
         ('test:ip', 'old', now() - interval '2 days', 9), ('test:ip', 'new', now(), 1)`))
    expect(await pruneRateLimits()).toBeGreaterThanOrEqual(1)
    const left = await asSystem(async (c) =>
      (await c.query(`select key from rate_limit_hits where bucket = 'test:ip'`)).rows.map((r) => r.key))
    expect(left).toEqual(['new'])
  })
})
