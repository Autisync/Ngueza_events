import { describe, expect, it } from 'vitest'
import { asSystem, asVisitor } from '@/lib/db'
import { search } from '@/lib/search'

/**
 * The wedge, asserted: a date, a place, a capacity — and a truthful answer.
 * Runs against the seeded Luanda catalogue.
 */

const ids = () =>
  asSystem(async (c) => {
    const { rows } = await c.query<{ k: string; v: string }>(`
      select 'saloes' as k, id::text as v from categories where slug = 'saloes-de-festas'
      union all select 'talatona', id::text from locations where slug = 'talatona'
      union all select 'luanda',   id::text from locations where slug = 'luanda'
      union all select 'belas',    id::text from locations where slug = 'belas'
    `)
    return Object.fromEntries(rows.map((r) => [r.k, r.v])) as Record<string, string>
  })

describe('search', () => {
  it('returns only published, verified suppliers', async () => {
    const { hits } = await search({})
    expect(hits.length).toBeGreaterThan(0)
    // 'Salão Central' is seeded as pending — it must never surface.
    expect(hits.map((h) => h.slug)).not.toContain('salao-central-cazenga')
  })

  it('filters by município', async () => {
    const id = await ids()
    const { hits } = await search({ locationId: id.talatona })
    expect(hits.map((h) => h.slug)).toEqual(['salao-horizonte-talatona'])
  })

  it('rolls a província up to every município beneath it', async () => {
    const id = await ids()
    const luanda = await search({ locationId: id.luanda })
    const talatona = await search({ locationId: id.talatona })
    expect(luanda.hits.length).toBeGreaterThan(talatona.hits.length)
  })

  it('filters by category, including descendants', async () => {
    const id = await ids()
    const { hits } = await search({ categoryId: id.saloes })
    expect(hits.length).toBeGreaterThan(0)
    for (const hit of hits) expect(hit.categoryName).toBe('Salões de festas')
  })

  it('filters by capacity', async () => {
    const big = await search({ capacity: 300 })
    // Only Quinta das Palmeiras has a 400-capacity resource.
    expect(big.hits.map((h) => h.slug)).toEqual(['quinta-das-palmeiras'])
  })

  it('hides a venue whose date is already confirmed', async () => {
    // The seed confirms Salão Horizonte for 15 December 2026.
    const taken = await search({ date: '2026-12-15' })
    expect(taken.hits.map((h) => h.slug)).not.toContain('salao-horizonte-talatona')

    const free = await search({ date: '2026-12-16' })
    expect(free.hits.map((h) => h.slug)).toContain('salao-horizonte-talatona')
  })

  it('honours a manual block the same way as a booking (§27)', async () => {
    // The seed blocks Quinta das Palmeiras' garden for 20 December.
    const { hits } = await search({ date: '2026-12-20' })
    const palmeiras = hits.find((h) => h.slug === 'quinta-das-palmeiras')
    // The garden is blocked; the covered area is not, so it still appears
    // but only via its remaining resource.
    expect(palmeiras?.capacity ?? 0).toBeLessThan(400)
  })

  it('ranks suppliers with concrete pricing above negotiation', async () => {
    const { hits } = await search({})
    const firstOnRequest = hits.findIndex((h) => !h.hasPrice)
    const lastWithPrice = hits.map((h) => h.hasPrice).lastIndexOf(true)
    if (firstOnRequest !== -1) expect(lastWithPrice).toBeLessThan(firstOnRequest)
  })

  it('paginates by keyset, with no repeats and no gaps', async () => {
    const all = await search({ limit: 48 })
    const first = await search({ limit: 2 })
    expect(first.hits).toHaveLength(2)
    expect(first.nextCursor).not.toBeNull()

    const second = await search({ limit: 2, cursor: first.nextCursor! })
    const seen = [...first.hits, ...second.hits].map((h) => h.id)
    expect(new Set(seen).size).toBe(seen.length)
    expect(seen).toEqual(all.hits.slice(0, seen.length).map((h) => h.id))
  })

  it('computes availability without letting a visitor read bookings', async () => {
    // The bug this pins: an inline `not exists (select from bookings)` is
    // always TRUE for anon, because RLS hides the rows the check depends
    // on — so every venue looks free and the calendar lies, silently.
    const visible = await asVisitor(async (c) => {
      const { rows } = await c.query<{ n: string }>(`select count(*)::text as n from bookings`)
      return Number(rows[0]!.n)
    })
    expect(visible).toBe(0)

    const free = await asVisitor(async (c) => {
      const { rows } = await c.query<{ free: boolean }>(
        `select resource_is_free(
                  '60000000-0000-0000-0000-000000000001',
                  $1::timestamptz, $2::timestamptz) as free`,
        ['2026-12-15T00:00:00+01:00', '2026-12-15T23:59:59+01:00'],
      )
      return rows[0]!.free
    })
    // A visitor sees no bookings at all, and still gets a truthful answer.
    expect(free).toBe(false)
  })

  it('carries a usable price for the profile card', async () => {
    const { hits } = await search({ capacity: 300 })
    const palmeiras = hits[0]!
    expect(palmeiras.price).toEqual({
      mode: 'range',
      minor: 350000000n,
      maxMinor: 620000000n,
    })
  })
})

describe('rating and categoryNames on a hit (modern marketplace UI)', () => {
  it('carries a null rating with zero reviews, and a real average once reviews exist', async () => {
    const HORIZONTE = '50000000-0000-0000-0000-000000000001'
    const ANA = '40000000-0000-0000-0000-000000000090'

    const before = (await search({})).hits.find((h) => h.id === HORIZONTE)
    expect(before?.ratingAverage).toBeNull()
    expect(before?.reviewCount).toBe(0)
    expect(before?.categoryNames).toEqual(['Salões de festas'])

    const reviewId = await asSystem(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `insert into reviews (provider_id, author_id, rating_overall, status)
         values ($1, $2, 5, 'published') returning id`,
        [HORIZONTE, ANA],
      )
      return rows[0]!.id
    })

    try {
      const after = (await search({})).hits.find((h) => h.id === HORIZONTE)
      expect(after?.ratingAverage).toBe(5)
      expect(after?.reviewCount).toBe(1)
    } finally {
      await asSystem((c) => c.query(`delete from reviews where id = $1`, [reviewId]))
    }
  })
})

describe('multi-category matching (slice 22 / migration 0028)', () => {
  it('a venue registered under saloes-de-festas surfaces in a fotografia search once it lists a photography service', async () => {
    const HORIZONTE = '50000000-0000-0000-0000-000000000001'
    const fotografiaId = await asSystem(async (c) => {
      const { rows } = await c.query<{ id: string }>(`select id from categories where slug = 'fotografia'`)
      return rows[0]!.id
    })

    const before = await search({ categoryId: fotografiaId })
    expect(before.hits.some((h) => h.id === HORIZONTE)).toBe(false)

    const serviceId = await asSystem(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `insert into services (provider_id, category_id, name, price_mode, price_minor, price_unit, is_active)
         values ($1, $2, 'Fotografia do evento', 'exact', 9500000, 'event', true)
         returning id`,
        [HORIZONTE, fotografiaId],
      )
      return rows[0]!.id
    })

    try {
      const after = await search({ categoryId: fotografiaId })
      expect(after.hits.some((h) => h.id === HORIZONTE)).toBe(true)
    } finally {
      await asSystem((c) => c.query(`delete from services where id = $1`, [serviceId]))
    }
  })
})
