import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asSystem } from '@/lib/db'
import { search } from '@/lib/search'
import { getProvider } from '@/lib/provider'
import { amenitiesInUse, setResourceAmenities } from '@/lib/amenities'

/**
 * Amenities per space (0043, slice 45, review R001). Runs against the
 * seeded catalogue: Quinta das Palmeiras has two spaces, a 400-person
 * Jardim and a 180-person Área Coberta, which is exactly the case that
 * makes "per space, not per provider" matter.
 */

let PALMEIRAS = ''
const PALMEIRAS_OWNER = '40000000-0000-0000-0000-000000000002'
const JARDIM = '60000000-0000-0000-0000-000000000002'
const COBERTA = '60000000-0000-0000-0000-000000000003'
const HORIZONTE_OWNER = '40000000-0000-0000-0000-000000000001'

let A: Record<string, string> = {}

const slugs = (hits: { slug: string }[]) => hits.map((h) => h.slug)

beforeAll(async () => {
  PALMEIRAS = await asSystem(async (c) => {
    const { rows } = await c.query<{ k: string; v: string }>(`select slug as k, id::text as v from amenities`)
    A = Object.fromEntries(rows.map((r) => [r.k, r.v]))
    const p = await c.query<{ id: string }>(`select id from providers where owner_id = $1`, [PALMEIRAS_OWNER])
    return p.rows[0]!.id
  })
  expect(PALMEIRAS).toBeTruthy()
  await setResourceAmenities(PALMEIRAS_OWNER, PALMEIRAS, JARDIM, [A['ao-ar-livre']!, A['estacionamento']!])
  await setResourceAmenities(PALMEIRAS_OWNER, PALMEIRAS, COBERTA, [A['gerador']!, A['coberto']!])
})

afterAll(async () => {
  await asSystem((c) => c.query(`delete from resource_amenities where resource_id in ($1, $2)`, [JARDIM, COBERTA]))
  await asSystem((c) => c.query(`update amenities set is_active = true`))
})

describe('amenities', () => {
  it('shows each space its own amenities on the profile', async () => {
    const p = await getProvider('quinta-das-palmeiras')
    const byName = Object.fromEntries(p!.resources.map((r) => [r.name, r.amenities]))
    expect(byName['Jardim']).toEqual(['Ao ar livre', 'Estacionamento'])
    expect(byName['Área Coberta']).toEqual(['Gerador', 'Coberto'])
  })

  it('search matches a space with the amenity', async () => {
    expect(slugs((await search({ amenities: ['gerador'] })).hits)).toEqual(['quinta-das-palmeiras'])
  })

  it('needs every amenity on the same space, not spread across two', async () => {
    // Gerador is on the Área Coberta, ao ar livre on the Jardim: no single
    // space has both, so the quinta is not a match.
    expect(slugs((await search({ amenities: ['gerador', 'ao-ar-livre'] })).hits)).toEqual([])
    const both = await search({ amenities: ['ao-ar-livre', 'estacionamento'] })
    expect(slugs(both.hits)).toEqual(['quinta-das-palmeiras'])
    expect(both.hits[0]!.capacity).toBe(400) // the Jardim, the space that matched
  })

  it('combines with capacity on the same space', async () => {
    // The Área Coberta has the gerador but holds 180.
    expect(slugs((await search({ amenities: ['gerador'], capacity: 300 })).hits)).toEqual([])
    expect(slugs((await search({ amenities: ['gerador'], capacity: 150 })).hits)).toEqual(['quinta-das-palmeiras'])
  })

  it('offers only amenities some public space has', async () => {
    const offered = (await amenitiesInUse()).map((a) => a.slug)
    expect(offered).toEqual(expect.arrayContaining(['gerador', 'ao-ar-livre', 'estacionamento', 'coberto']))
    expect(offered).not.toContain('cozinha')
  })

  it('a save replaces the set exactly', async () => {
    await setResourceAmenities(PALMEIRAS_OWNER, PALMEIRAS, COBERTA, [A['gerador']!])
    const p = await getProvider('quinta-das-palmeiras')
    expect(p!.resources.find((r) => r.name === 'Área Coberta')!.amenities).toEqual(['Gerador'])
    await setResourceAmenities(PALMEIRAS_OWNER, PALMEIRAS, COBERTA, [A['gerador']!, A['coberto']!])
  })

  it("another supplier cannot change someone else's space", async () => {
    await setResourceAmenities(HORIZONTE_OWNER, PALMEIRAS, JARDIM, [])
    const p = await getProvider('quinta-das-palmeiras')
    expect(p!.resources.find((r) => r.name === 'Jardim')!.amenities).toHaveLength(2)
  })

  it('a retired amenity disappears from profiles, search and the filter', async () => {
    await asSystem((c) => c.query(`update amenities set is_active = false where slug = 'gerador'`))
    const p = await getProvider('quinta-das-palmeiras')
    expect(p!.resources.find((r) => r.name === 'Área Coberta')!.amenities).toEqual(['Coberto'])
    expect((await amenitiesInUse()).map((a) => a.slug)).not.toContain('gerador')
    // Asking for a retired amenity is not a constraint nobody can meet.
    expect(slugs((await search({ amenities: ['gerador'] })).hits).length).toBeGreaterThan(1)
    await asSystem((c) => c.query(`update amenities set is_active = true where slug = 'gerador'`))
  })
})
