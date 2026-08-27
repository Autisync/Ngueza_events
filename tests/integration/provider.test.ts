import { describe, expect, it } from 'vitest'
import { asSystem } from '@/lib/db'
import { availability, getProvider, recordContactReveal } from '@/lib/provider'

describe('public supplier page', () => {
  it('returns a published, verified supplier', async () => {
    const p = await getProvider('quinta-das-palmeiras')
    expect(p?.name).toBe('Quinta das Palmeiras')
    expect(p?.supplierType).toBe('venue')
    expect(p?.verifiedAt).not.toBeNull()
  })

  it('hides one still awaiting verification, as a 404 rather than a 403', async () => {
    // RLS does this, not application code — so there is no path that
    // forgets the check.
    expect(await getProvider('salao-central-cazenga')).toBeNull()
  })

  it('builds the location path from país down to município (§43)', async () => {
    const p = await getProvider('quinta-das-palmeiras')
    expect(p?.locationPath).toEqual(['Angola', 'Luanda', 'Belas'])
  })

  it('lists priced services before negotiated ones', async () => {
    const p = await getProvider('salao-horizonte-talatona')
    expect(p?.services[0]?.price).toEqual({ mode: 'exact', minor: 180000000n })
  })

  it('exposes every bookable space, not one calendar per supplier', async () => {
    const p = await getProvider('quinta-das-palmeiras')
    expect(p?.resources.map((r) => r.name).sort()).toEqual(['Jardim', 'Área Coberta'])
  })

  it('marks a manually blocked date as busy, and its neighbours free (§27)', async () => {
    const p = await getProvider('quinta-das-palmeiras')
    const jardim = p!.resources.find((r) => r.name === 'Jardim')!
    // The seed blocks the Jardim for 20 December 2026.
    const days = await availability(p!.id, new Date('2026-12-18T00:00:00Z'), 5)
    const forJardim = Object.fromEntries(
      days.filter((d) => d.resourceId === jardim.id).map((d) => [d.date, d.free]),
    )
    expect(forJardim['2026-12-19']).toBe(true)
    expect(forJardim['2026-12-20']).toBe(false)
    expect(forJardim['2026-12-22']).toBe(true)
  })

  it('leaves the other space in the same venue bookable that day', async () => {
    const p = await getProvider('quinta-das-palmeiras')
    const coberta = p!.resources.find((r) => r.name === 'Área Coberta')!
    const days = await availability(p!.id, new Date('2026-12-20T00:00:00Z'), 1)
    expect(days.find((d) => d.resourceId === coberta.id)?.free).toBe(true)
  })

  it('counts contact reveals — the §32 leakage numerator', async () => {
    const p = await getProvider('salao-horizonte-talatona')
    const before = await asSystem(async (c) => {
      const { rows } = await c.query<{ n: string }>(
        `select count(*)::text as n from events where name in ('phone_revealed','whatsapp_clicked')`,
      )
      return Number(rows[0]!.n)
    })

    await recordContactReveal(p!.id, 'phone', 'sess-1')
    await recordContactReveal(p!.id, 'whatsapp', 'sess-1')

    const after = await asSystem(async (c) => {
      const { rows } = await c.query<{ n: string }>(
        `select count(*)::text as n from events where name in ('phone_revealed','whatsapp_clicked')`,
      )
      return Number(rows[0]!.n)
    })
    expect(after - before).toBe(2)
  })
})
