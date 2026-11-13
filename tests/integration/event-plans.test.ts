import { beforeAll, describe, expect, it } from 'vitest'
import { asSystem } from '@/lib/db'
import { requestBooking } from '@/lib/booking'
import {
  activeEventTypes, addPlanItem, createPlan, linkableBookings, marketPrices, myPlans, nextNeeds,
  planDetail, removePlanItem, setPlanArchived, updatePlan, updatePlanItem,
} from '@/lib/event-plans'

/**
 * Slice 50: a client plans an event. Creating a plan copies its type's
 * needs with estimates (budget × share, integer cêntimos) and "reservar
 * até" dates (event date − lead time); the plan is the client's alone.
 */

const JOAO = '40000000-0000-0000-0000-000000000091'
const ANA = '40000000-0000-0000-0000-000000000090'
const HORIZONTE = '50000000-0000-0000-0000-000000000001'
const SALAO = '60000000-0000-0000-0000-000000000001'
const SALOES = '20000000-0000-0000-0000-000000000010'

// A far, random day so reruns never collide with an earlier run's rows.
const farDay = () => {
  const d = new Date(Date.UTC(2032, 0, 1) + Math.floor(Math.random() * 3000) * 86_400_000)
  return d.toISOString().slice(0, 10)
}

const minusDays = (ymd: string, days: number) => {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

async function aBookingFor(clientId: string): Promise<string> {
  const date = farDay()
  const made = await requestBooking(clientId, {
    providerId: HORIZONTE, resourceId: SALAO,
    startsAt: new Date(`${date}T09:00:00+01:00`), endsAt: new Date(`${date}T22:00:00+01:00`),
    clientPhone: '+244923000091', acceptsLegal: true,
  })
  if (!made.ok) throw new Error(`request failed: ${made.reason}`)
  return made.bookingId
}

// Earlier runs leave plans behind; archive them so the 30-active-plan cap
// (0046) never decides whether this file passes.
beforeAll(async () => {
  await asSystem((c) => c.query(
    `update event_plans set archived_at = now() where owner_id = $1 and archived_at is null`, [JOAO]))
})

async function casamentoId(): Promise<string> {
  const types = await activeEventTypes()
  return types.find((t) => t.slug === 'casamento')!.id
}

describe('event types', () => {
  it('are reference rows, each needs list adding up to the whole budget', async () => {
    const types = await activeEventTypes()
    expect(types.map((t) => t.slug)).toEqual(expect.arrayContaining(['casamento', 'alambamento', 'conferencia']))
    for (const t of types) {
      expect(t.needs.reduce((s, n) => s + n.budgetShareBp, 0)).toBe(10_000)
    }
    const local = types.find((t) => t.slug === 'casamento')!.needs.find((n) => n.name === 'Local da festa')!
    expect(local).toMatchObject({ categorySlug: 'saloes-de-festas', budgetShareBp: 3000, weeksBefore: 26 })
  })
})

describe('a new plan', () => {
  it('copies its type\'s needs with estimates and booking deadlines', async () => {
    const date = farDay()
    const made = await createPlan(JOAO, await casamentoId(), {
      title: 'Casamento do João', eventDate: date, guestCount: 150, locationId: null,
      budgetMinor: 500_000_000n, notes: null,
    })
    expect(made.ok).toBe(true)
    if (!made.ok) return

    const plan = (await planDetail(JOAO, made.id))!
    expect(plan.items).toHaveLength(12)
    const local = plan.items.find((i) => i.name === 'Local da festa')!
    expect(local.estimateMinor).toBe(150_000_000n)            // 30 % of 5 000 000 Kz
    expect(local.dueDate).toBe(minusDays(date, 26 * 7))
    expect(local.categorySlug).toBe('saloes-de-festas')
    // The shares add up to 100 %, so the estimates add up to the budget.
    expect(plan.estimatedMinor).toBe(500_000_000n)
    expect(plan.spentMinor).toBe(0n)

    const mine = await myPlans(JOAO)
    expect(mine.map((p) => p.id)).toContain(made.id)
  })

  it('without a budget or a date, the lines still come, unpriced and undated', async () => {
    const made = await createPlan(JOAO, await casamentoId(), {
      title: 'Ainda sem data', eventDate: null, guestCount: null, locationId: null, budgetMinor: null, notes: null,
    })
    if (!made.ok) throw new Error(made.reason)
    const plan = (await planDetail(JOAO, made.id))!
    expect(plan.items.every((i) => i.estimateMinor === null && i.dueDate === null)).toBe(true)

    // Choosing a date later gives the lines their type's lead times.
    const date = farDay()
    expect(await updatePlan(JOAO, made.id, {
      title: 'Agora com data', eventDate: date, guestCount: null, locationId: null, budgetMinor: null, notes: null,
    })).toEqual({ ok: true, id: made.id })
    const after = (await planDetail(JOAO, made.id))!
    expect(after.items.find((i) => i.name === 'Local da festa')!.dueDate).toBe(minusDays(date, 26 * 7))
  })

  it('moving the date moves every deadline by the same days', async () => {
    const date = farDay()
    const made = await createPlan(JOAO, await casamentoId(), {
      title: 'Data móvel', eventDate: date, guestCount: null, locationId: null, budgetMinor: null, notes: null,
    })
    if (!made.ok) throw new Error(made.reason)
    const later = minusDays(date, -10)
    await updatePlan(JOAO, made.id, {
      title: 'Data móvel', eventDate: later, guestCount: null, locationId: null, budgetMinor: null, notes: null,
    })
    const plan = (await planDetail(JOAO, made.id))!
    expect(plan.eventDate).toBe(later)
    expect(plan.items.find((i) => i.name === 'Local da festa')!.dueDate).toBe(minusDays(later, 26 * 7))
  })
})

describe('lines', () => {
  it('track status, estimate and actual, and link only the owner\'s bookings', async () => {
    const made = await createPlan(JOAO, await casamentoId(), {
      title: 'Linhas', eventDate: farDay(), guestCount: 100, locationId: null, budgetMinor: 100_000_000n, notes: null,
    })
    if (!made.ok) throw new Error(made.reason)
    const plan = (await planDetail(JOAO, made.id))!
    const local = plan.items.find((i) => i.name === 'Local da festa')!

    const mine = await aBookingFor(JOAO)
    const hers = await aBookingFor(ANA)
    expect((await linkableBookings(JOAO)).map((b) => b.id)).toContain(mine)

    const base = { name: local.name, estimateMinor: local.estimateMinor, dueDate: local.dueDate, notes: null }
    expect(await updatePlanItem(JOAO, local.id, { ...base, status: 'done', actualMinor: 32_000_000n, bookingId: hers }))
      .toEqual({ ok: false, reason: 'invalid' })
    expect(await updatePlanItem(JOAO, local.id, { ...base, status: 'done', actualMinor: 32_000_000n, bookingId: mine }))
      .toEqual({ ok: true, id: made.id })

    const after = (await planDetail(JOAO, made.id))!
    const line = after.items.find((i) => i.id === local.id)!
    expect(line).toMatchObject({ status: 'done', actualMinor: 32_000_000n })
    expect(line.booking?.id).toBe(mine)
    expect(after.spentMinor).toBe(32_000_000n)
    expect(after.itemsDone).toBe(1)

    // Added and removed freely.
    const added = await addPlanItem(JOAO, made.id, { name: 'Transporte dos convidados', categoryId: null, estimateMinor: 5_000_000n, dueDate: null })
    expect(added.ok).toBe(true)
    if (added.ok) expect(await removePlanItem(JOAO, added.id)).toEqual({ ok: true, id: made.id })
  })

  it('"por tratar" lists the open lines by deadline', async () => {
    const next = await nextNeeds(JOAO, 50)
    expect(next.length).toBeGreaterThan(0)
    expect(next.every((n) => n.status !== 'done')).toBe(true)
    const dated = next.filter((n) => n.dueDate).map((n) => n.dueDate!)
    expect([...dated].sort()).toEqual(dated)
  })
})

describe('privacy', () => {
  it('another client neither reads nor edits the plan', async () => {
    const made = await createPlan(JOAO, await casamentoId(), {
      title: 'Privado', eventDate: null, guestCount: null, locationId: null, budgetMinor: 10_000_000n, notes: null,
    })
    if (!made.ok) throw new Error(made.reason)
    const plan = (await planDetail(JOAO, made.id))!

    expect(await planDetail(ANA, made.id)).toBeNull()
    expect((await myPlans(ANA)).map((p) => p.id)).not.toContain(made.id)
    expect(await updatePlanItem(ANA, plan.items[0]!.id, {
      name: 'x', status: 'done', estimateMinor: null, actualMinor: null, dueDate: null, bookingId: null, notes: null,
    })).toEqual({ ok: false, reason: 'not_allowed' })
    expect(await setPlanArchived(ANA, made.id, true)).toEqual({ ok: false, reason: 'not_allowed' })
  })

  it('archiving hides a plan from the active list', async () => {
    const made = await createPlan(JOAO, await casamentoId(), {
      title: 'Arquivar', eventDate: null, guestCount: null, locationId: null, budgetMinor: null, notes: null,
    })
    if (!made.ok) throw new Error(made.reason)
    await setPlanArchived(JOAO, made.id, true)
    expect((await myPlans(JOAO)).map((p) => p.id)).not.toContain(made.id)
    expect((await myPlans(JOAO, { archived: true })).map((p) => p.id)).toContain(made.id)
  })
})

describe('market prices', () => {
  it('come from real, verified, published suppliers, one per category', async () => {
    const prices = await marketPrices([SALOES])
    const p = prices.get(SALOES)
    expect(p?.unit).toBe('event')
    // The cheapest public salão price among non-example suppliers.
    const { rows } = await asSystem((c) => c.query<{ min: string }>(
      `select min(s.price_minor)::text as min from services s join providers p on p.id = s.provider_id
        where s.category_id = $1 and s.is_active and s.price_unit = 'event'
          and s.price_mode in ('exact','from','range') and p.is_published
          and p.verification_status = 'verified' and not p.is_demo`, [SALOES]))
    expect(p?.minor).toBe(BigInt(rows[0]!.min))
  })
})
