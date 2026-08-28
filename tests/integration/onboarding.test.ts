import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { asSystem, asUser } from '@/lib/db'
import {
  addResource, addService, createProvider, recordDocument,
  removeService, serviceInput, submitForVerification, updateProvider,
} from '@/lib/onboarding'

/**
 * Slice 04 — a person with an account registers a business, describes it,
 * prices it, and submits paperwork. Everything runs as that person, so
 * RLS is doing the authorising throughout.
 */

const NEWCOMER = '30000000-0000-0000-0000-0000000000aa'
const OTHER = '30000000-0000-0000-0000-0000000000bb'
const SALOES = '20000000-0000-0000-0000-000000000010'   // venue category
const DJS = '20000000-0000-0000-0000-000000000020'      // service category
const TALATONA = '10000000-0000-0000-0000-000000000010'

const ids = async () =>
  asSystem(async (c) => {
    const { rows } = await c.query<{ id: string; owner_id: string; slug: string }>(
      `select id, owner_id, slug from providers where owner_id in ($1,$2)`, [NEWCOMER, OTHER],
    )
    return rows
  })

/**
 * Integration files share one database, so a file that leaves rows behind
 * breaks a different file's assertions — which is exactly what happened:
 * a stray supplier changed the role counts in provisioning.test.ts.
 * Clean before AND after.
 */
async function reset(): Promise<void> {
  await asSystem(async (c) => {
    await c.query(`delete from provider_documents where provider_id in
                     (select id from providers where owner_id in ($1,$2))`, [NEWCOMER, OTHER])
    await c.query(`delete from services where provider_id in
                     (select id from providers where owner_id in ($1,$2))`, [NEWCOMER, OTHER])
    await c.query(`delete from resources where provider_id in
                     (select id from providers where owner_id in ($1,$2))`, [NEWCOMER, OTHER])
    await c.query(`delete from providers where owner_id in ($1,$2)`, [NEWCOMER, OTHER])
    await c.query(`delete from profiles where id in ($1,$2)`, [NEWCOMER, OTHER])
    await c.query(`delete from auth.users where id in ($1,$2)`, [NEWCOMER, OTHER])
  })
}

beforeEach(async () => {
  await reset()
  await asSystem((c) =>
    c.query(`insert into auth.users (id, email, email_confirmed_at)
             values ($1,'onboarding-a@teste.ao',now()), ($2,'onboarding-b@teste.ao',now())`,
      [NEWCOMER, OTHER]))
})

afterAll(reset)

describe('registering a business', () => {
  it('creates the provider and promotes the account to supplier', async () => {
    const before = await asSystem(async (c) => {
      const { rows } = await c.query(`select role from profiles where id = $1`, [NEWCOMER])
      return rows[0]?.role
    })
    expect(before).toBe('client')

    const result = await createProvider(NEWCOMER, {
      name: 'Salão Boa Vista', categoryId: SALOES, locationId: TALATONA,
      description: 'Salão em Talatona.', phone: '+244 923 111 222',
    })
    expect(result.ok).toBe(true)

    const after = await asSystem(async (c) => {
      const { rows } = await c.query(`select role from profiles where id = $1`, [NEWCOMER])
      return rows[0]?.role
    })
    // Allowed only because they now own a business — and it grants no
    // access, since RLS keys off owns_provider().
    expect(after).toBe('provider')
  })

  it('takes supplier_type from the category, not from the form', async () => {
    await createProvider(NEWCOMER, { name: 'Salão A', categoryId: SALOES, locationId: TALATONA })
    await createProvider(OTHER, { name: 'DJ Kotas', categoryId: DJS, locationId: TALATONA })

    const types = await asSystem(async (c) => {
      const { rows } = await c.query<{ owner_id: string; supplier_type: string }>(
        `select owner_id, supplier_type from providers where owner_id in ($1,$2)`, [NEWCOMER, OTHER],
      )
      return Object.fromEntries(rows.map((r) => [r.owner_id, r.supplier_type]))
    })
    expect(types[NEWCOMER]).toBe('venue')
    expect(types[OTHER]).toBe('service')
  })

  it('gives a venue somewhere to be booked, because a booking requires one', async () => {
    const created = await createProvider(NEWCOMER, {
      name: 'Salão B', categoryId: SALOES, locationId: TALATONA,
    })
    if (!created.ok) throw new Error('create failed')

    const resources = await asSystem(async (c) => {
      const { rows } = await c.query(`select name from resources where provider_id = $1`,
        [created.providerId])
      return rows
    })
    expect(resources).toHaveLength(1)
  })

  it('does not create a resource for a service supplier', async () => {
    const created = await createProvider(OTHER, {
      name: 'DJ Xita', categoryId: DJS, locationId: TALATONA,
    })
    if (!created.ok) throw new Error('create failed')
    const resources = await asSystem(async (c) => {
      const { rows } = await c.query(`select 1 from resources where provider_id = $1`,
        [created.providerId])
      return rows
    })
    expect(resources).toHaveLength(0)
  })

  it('starts unpublished and unverified — nobody self-publishes', async () => {
    const created = await createProvider(NEWCOMER, {
      name: 'Salão C', categoryId: SALOES, locationId: TALATONA,
    })
    if (!created.ok) throw new Error('create failed')
    const row = await asSystem(async (c) => {
      const { rows } = await c.query(
        `select is_published, verification_status from providers where id = $1`,
        [created.providerId])
      return rows[0]
    })
    expect(row.is_published).toBe(false)
    expect(row.verification_status).toBe('unverified')
  })

  it('gives a colliding name a distinct slug rather than failing', async () => {
    const a = await createProvider(NEWCOMER, { name: 'Salão Repetido', categoryId: SALOES, locationId: TALATONA })
    const b = await createProvider(OTHER, { name: 'Salão Repetido', categoryId: SALOES, locationId: TALATONA })
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) expect(a.slug).not.toBe(b.slug)
  })
})

describe('one supplier cannot touch another', () => {
  it('refuses an edit to a business they do not own', async () => {
    const mine = await createProvider(NEWCOMER, {
      name: 'Meu Salão', categoryId: SALOES, locationId: TALATONA,
    })
    if (!mine.ok) throw new Error('create failed')

    const changed = await updateProvider(OTHER, mine.providerId, {
      name: 'Roubado', categoryId: SALOES, locationId: TALATONA,
    })
    expect(changed).toBe(false)

    const name = await asSystem(async (c) => {
      const { rows } = await c.query(`select name from providers where id = $1`, [mine.providerId])
      return rows[0]?.name
    })
    expect(name).toBe('Meu Salão')
  })

  it('refuses a service added to someone else\'s business', async () => {
    const mine = await createProvider(NEWCOMER, {
      name: 'Salão D', categoryId: SALOES, locationId: TALATONA,
    })
    if (!mine.ok) throw new Error('create failed')

    await expect(
      addService(OTHER, mine.providerId, {
        name: 'Serviço intruso', categoryId: SALOES, priceMode: 'exact',
        price: 100n, priceUnit: 'event',
      } as never),
    ).rejects.toThrow()
  })
})

describe('prices', () => {
  it('accepts every mode in the spectrum', async () => {
    const created = await createProvider(NEWCOMER, {
      name: 'Salão E', categoryId: SALOES, locationId: TALATONA,
    })
    if (!created.ok) throw new Error('create failed')

    for (const input of [
      { name: 'Dia inteiro', priceMode: 'exact' as const, price: '180.000' },
      { name: 'Meio dia', priceMode: 'from' as const, price: '95.000' },
      { name: 'Casamento', priceMode: 'range' as const, price: '350.000', priceMax: '620.000' },
      { name: 'Personalizado', priceMode: 'on_request' as const },
    ]) {
      const parsed = serviceInput.parse({ ...input, categoryId: SALOES })
      await addService(NEWCOMER, created.providerId, parsed)
    }

    const services = await asSystem(async (c) => {
      const { rows } = await c.query<{ price_mode: string; price_minor: string | null }>(
        `select price_mode, price_minor from services where provider_id = $1 order by name`,
        [created.providerId])
      return rows
    })
    expect(services).toHaveLength(4)
    // 180.000 Kz stored as cêntimos, exactly.
    const exact = services.find((s) => s.price_mode === 'exact')
    expect(exact?.price_minor).toBe('18000000')
  })

  it('rejects a range whose maximum is below its minimum, with a field error', () => {
    const result = serviceInput.safeParse({
      name: 'Errado', categoryId: SALOES, priceMode: 'range',
      price: '600.000', priceMax: '300.000',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['priceMax'])
    }
  })

  it('rejects a missing price on a mode that needs one', () => {
    const result = serviceInput.safeParse({
      name: 'Sem preço', categoryId: SALOES, priceMode: 'exact',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a price on "sob consulta"', () => {
    const result = serviceInput.safeParse({
      name: 'Contraditório', categoryId: SALOES, priceMode: 'on_request', price: '100.000',
    })
    expect(result.success).toBe(false)
  })
})

describe('verification (§25)', () => {
  it('will not submit a business with no paperwork', async () => {
    const created = await createProvider(NEWCOMER, {
      name: 'Salão F', categoryId: SALOES, locationId: TALATONA,
    })
    if (!created.ok) throw new Error('create failed')
    expect(await submitForVerification(NEWCOMER, created.providerId)).toBe('no_documents')
  })

  it('moves to pending once paperwork is attached', async () => {
    const created = await createProvider(NEWCOMER, {
      name: 'Salão G', categoryId: SALOES, locationId: TALATONA,
    })
    if (!created.ok) throw new Error('create failed')

    await recordDocument(NEWCOMER, created.providerId, {
      kind: 'identity', externalId: `${created.providerId}/bi.pdf`,
      filename: 'bi.pdf', contentType: 'application/pdf', byteSize: 1024,
    })
    expect(await submitForVerification(NEWCOMER, created.providerId)).toBe('submitted')

    const status = await asSystem(async (c) => {
      const { rows } = await c.query(`select verification_status from providers where id = $1`,
        [created.providerId])
      return rows[0]?.verification_status
    })
    expect(status).toBe('pending')
  })

  it('cannot mark its own paperwork accepted', async () => {
    const created = await createProvider(NEWCOMER, {
      name: 'Salão H', categoryId: SALOES, locationId: TALATONA,
    })
    if (!created.ok) throw new Error('create failed')
    await recordDocument(NEWCOMER, created.providerId, {
      kind: 'nif', externalId: `${created.providerId}/nif.pdf`,
    })

    // RLS filters, it does not raise: with no UPDATE policy matching a
    // non-admin, the statement succeeds and touches zero rows. Asserting
    // a throw here would have passed for the wrong reason on a schema
    // that had no policy at all.
    const changed = await asUser(NEWCOMER, async (c) => {
      const result = await c.query(
        `update provider_documents set status = 'accepted' where provider_id = $1`,
        [created.providerId])
      return result.rowCount ?? 0
    })
    expect(changed).toBe(0)

    const status = await asSystem(async (c) => {
      const { rows } = await c.query(
        `select status from provider_documents where provider_id = $1`, [created.providerId])
      return rows[0]?.status
    })
    expect(status).toBe('submitted')
  })

  it('keeps another supplier out of the paperwork entirely', async () => {
    const created = await createProvider(NEWCOMER, {
      name: 'Salão I', categoryId: SALOES, locationId: TALATONA,
    })
    if (!created.ok) throw new Error('create failed')
    await recordDocument(NEWCOMER, created.providerId, {
      kind: 'identity', externalId: `${created.providerId}/bi.pdf`,
    })

    const seen = await asUser(OTHER, async (c) => {
      const { rows } = await c.query(`select id from provider_documents`)
      return rows.length
    })
    expect(seen).toBe(0)
  })
})

describe('resources', () => {
  it('adds a second bookable space with its own capacity', async () => {
    const created = await createProvider(NEWCOMER, {
      name: 'Quinta J', categoryId: SALOES, locationId: TALATONA,
    })
    if (!created.ok) throw new Error('create failed')

    await addResource(NEWCOMER, created.providerId, { name: 'Jardim', capacity: 400 })
    const rows = await asSystem(async (c) => {
      const { rows } = await c.query<{ name: string; capacity: number | null }>(
        `select name, capacity from resources where provider_id = $1 order by name`,
        [created.providerId])
      return rows
    })
    expect(rows.map((r) => r.name)).toEqual(['Espaço principal', 'Jardim'])
    expect(rows.find((r) => r.name === 'Jardim')?.capacity).toBe(400)
  })
})
