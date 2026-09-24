import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asSystem } from '@/lib/db'
import { waitlistDemand, waitlistSubscribers } from '@/lib/admin'
import { confirm, subscribe } from '@/lib/newsletter'

/**
 * The admin side of the waitlist (slice 25): turning signups into the
 * evidence recruitment actually reads — who wants what, where — and a
 * plain list an administrator can act on once outreach is manual.
 */

const ADMIN = '40000000-0000-0000-0000-000000000099'
const SALOES = '20000000-0000-0000-0000-000000000010'
const TALATONA = '10000000-0000-0000-0000-000000000010'

const base = {
  audience: 'client' as const,
  categories: [] as string[],
  locations: [] as string[],
  source: 'waitlist' as const,
  consent: true as const,
}

const confirmTokenFor = (email: string) =>
  asSystem(async (c) => {
    const { rows } = await c.query<{ confirm_token: string }>(
      `select confirm_token from newsletter_subscribers where email = $1`,
      [email],
    )
    return rows[0]!.confirm_token
  })

beforeEach(async () => {
  await asSystem((c) => c.query(`delete from newsletter_subscribers where email like '%@admintest.ao'`))
})
afterEach(async () => {
  await asSystem((c) => c.query(`delete from newsletter_subscribers where email like '%@admintest.ao'`))
})

describe('waitlistSubscribers', () => {
  it('resolves category/location ids into real names, and surfaces free-text "other" entries', async () => {
    await subscribe(
      {
        ...base,
        email: 'listed@admintest.ao',
        categories: [SALOES],
        locations: [TALATONA],
        otherCategory: 'Aluguer de tendas',
      },
      {},
    )

    const list = await waitlistSubscribers(ADMIN)
    const mine = list.find((s) => s.email === 'listed@admintest.ao')
    expect(mine).toBeTruthy()
    expect(mine!.categoryNames).toContain('Salões de festas')
    expect(mine!.locationNames).toContain('Talatona')
    expect(mine!.otherCategory).toBe('Aluguer de tendas')
    expect(mine!.status).toBe('pending')
  })

  it('filters by status', async () => {
    await subscribe({ ...base, email: 'pend@admintest.ao' }, {})
    await subscribe({ ...base, email: 'conf@admintest.ao' }, {})
    await confirm(await confirmTokenFor('conf@admintest.ao'))

    const pending = await waitlistSubscribers(ADMIN, { status: 'pending' })
    const confirmed = await waitlistSubscribers(ADMIN, { status: 'confirmed' })
    expect(pending.some((s) => s.email === 'pend@admintest.ao')).toBe(true)
    expect(pending.some((s) => s.email === 'conf@admintest.ao')).toBe(false)
    expect(confirmed.some((s) => s.email === 'conf@admintest.ao')).toBe(true)
  })
})

describe('waitlistDemand', () => {
  it('counts both pending and confirmed toward demand — nobody has to open the email to count', async () => {
    await subscribe({ ...base, email: 'd1@admintest.ao', categories: [SALOES] }, {})
    await subscribe({ ...base, email: 'd2@admintest.ao', categories: [SALOES] }, {})
    await confirm(await confirmTokenFor('d2@admintest.ao'))

    const demand = await waitlistDemand(ADMIN)
    const saloes = demand.categories.find((d) => d.name === 'Salões de festas')
    expect(saloes).toBeTruthy()
    expect(saloes!.count).toBeGreaterThanOrEqual(2)
  })
})
