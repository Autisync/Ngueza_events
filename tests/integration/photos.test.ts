import { Client } from 'pg'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { asSystem, asUser, asVisitor } from '@/lib/db'
import { createProvider } from '@/lib/onboarding'
import {
  MAX_PHOTOS, movePhoto, ownedPhotos, recordPhoto, removePhoto, setCover, updateCaption,
} from '@/lib/photos'

/**
 * Slice 27 — the supplier photo manager. Everything runs as the supplier
 * (or a stranger, or a visitor), so RLS and the 0032 triggers are what is
 * under test, not this file's own bookkeeping.
 */

const OWNER = '30000000-0000-0000-0000-0000000027aa'
const STRANGER = '30000000-0000-0000-0000-0000000027bb'
const SALOES = '20000000-0000-0000-0000-000000000010'
const TALATONA = '10000000-0000-0000-0000-000000000010'

let providerId: string
let otherProviderId: string

async function reset(): Promise<void> {
  await asSystem(async (c) => {
    const owned = `(select id from providers where owner_id in ($1,$2))`
    await c.query(`delete from media where provider_id in ${owned}`, [OWNER, STRANGER])
    await c.query(`delete from resources where provider_id in ${owned}`, [OWNER, STRANGER])
    await c.query(`delete from providers where owner_id in ($1,$2)`, [OWNER, STRANGER])
    await c.query(`delete from profiles where id in ($1,$2)`, [OWNER, STRANGER])
    await c.query(`delete from auth.users where id in ($1,$2)`, [OWNER, STRANGER])
  })
}

const business = (name: string) => ({
  name, categoryId: SALOES, locationId: TALATONA,
})

const key = (provider: string, n: number | string) => `${provider}/00000000-0000-0000-0000-${String(n).padStart(12, '0')}`

beforeEach(async () => {
  await reset()
  await asSystem((c) =>
    c.query(`insert into auth.users (id, email, email_confirmed_at)
             values ($1,'fotos-a@teste.ao',now()), ($2,'fotos-b@teste.ao',now())`, [OWNER, STRANGER]))
  const a = await createProvider(OWNER, business('Salão das Fotografias'))
  const b = await createProvider(STRANGER, business('Salão do Vizinho'))
  if (!a.ok || !b.ok) throw new Error('could not create providers')
  providerId = a.providerId
  otherProviderId = b.providerId
})

afterAll(reset)

describe('uploading', () => {
  it('records a photo and makes the first one the cover', async () => {
    expect(await recordPhoto(OWNER, providerId, { externalId: key(providerId, 1), altText: '  Salão   montado ' })).toBe('ok')
    expect(await recordPhoto(OWNER, providerId, { externalId: key(providerId, 2) })).toBe('ok')

    const photos = await ownedPhotos(OWNER, providerId)
    expect(photos.map((p) => p.externalId)).toEqual([key(providerId, 1), key(providerId, 2)])
    expect(photos.map((p) => p.isCover)).toEqual([true, false])
    expect(photos[0]!.altText).toBe('Salão montado')
  })

  it('refuses an object key filed under another provider', async () => {
    expect(await recordPhoto(OWNER, providerId, { externalId: key(otherProviderId, 1) })).toBe('invalid')
    expect(await recordPhoto(OWNER, providerId, { externalId: 'outro/sitio.jpg' })).toBe('invalid')
    expect(await ownedPhotos(OWNER, providerId)).toHaveLength(0)
  })

  it('refuses the same object twice', async () => {
    expect(await recordPhoto(OWNER, providerId, { externalId: key(providerId, 1) })).toBe('ok')
    expect(await recordPhoto(OWNER, providerId, { externalId: key(providerId, 1) })).toBe('invalid')
  })

  it('refuses a stranger adding photos to somebody else\'s listing', async () => {
    expect(await recordPhoto(STRANGER, providerId, { externalId: key(providerId, 1) })).toBe('not_allowed')
  })

  it(`stops at ${MAX_PHOTOS} photos, even when uploads arrive together`, async () => {
    await asSystem(async (c) => {
      for (let n = 1; n < MAX_PHOTOS; n++) {
        await c.query(`insert into media (provider_id, kind, external_id) values ($1,'image',$2)`, [providerId, key(providerId, n)])
      }
    })
    // One slot left, three simultaneous uploads: exactly one wins.
    const outcomes = await Promise.all([101, 102, 103].map((n) =>
      recordPhoto(OWNER, providerId, { externalId: key(providerId, n) })))
    expect(outcomes.filter((o) => o === 'ok')).toHaveLength(1)
    expect(outcomes.filter((o) => o === 'limit')).toHaveLength(2)
    expect(await ownedPhotos(OWNER, providerId)).toHaveLength(MAX_PHOTOS)
  })

  it('gives exactly one cover when the first uploads arrive together', async () => {
    await Promise.all([1, 2, 3, 4].map((n) =>
      recordPhoto(OWNER, providerId, { externalId: key(providerId, n) })))
    const photos = await ownedPhotos(OWNER, providerId)
    expect(photos).toHaveLength(4)
    expect(photos.filter((p) => p.isCover)).toHaveLength(1)
  })
})

describe('arranging', () => {
  beforeEach(async () => {
    for (const n of [1, 2, 3, 4]) await recordPhoto(OWNER, providerId, { externalId: key(providerId, n) })
  })
  const order = async () => (await ownedPhotos(OWNER, providerId)).map((p) => p.externalId.slice(-1))

  it('moves a photo earlier and later among the non-cover photos', async () => {
    const photos = await ownedPhotos(OWNER, providerId)
    expect(await movePhoto(OWNER, providerId, photos[3]!.id, 'up')).toBe(true)
    expect(await order()).toEqual(['1', '2', '4', '3'])
    expect(await movePhoto(OWNER, providerId, photos[1]!.id, 'down')).toBe(true)
    expect(await order()).toEqual(['1', '4', '2', '3'])
  })

  it('never moves a photo past the cover, or off either end', async () => {
    const photos = await ownedPhotos(OWNER, providerId)
    expect(await movePhoto(OWNER, providerId, photos[1]!.id, 'up')).toBe(false)
    expect(await movePhoto(OWNER, providerId, photos[3]!.id, 'down')).toBe(false)
    expect(await movePhoto(OWNER, providerId, photos[0]!.id, 'down')).toBe(false)   // the cover itself
    expect(await order()).toEqual(['1', '2', '3', '4'])
  })

  it('moves photos that share a sort_order, as every pre-0032 row did', async () => {
    await asSystem((c) => c.query(`update media set sort_order = 0 where provider_id = $1`, [providerId]))
    const photos = await ownedPhotos(OWNER, providerId)
    expect(await movePhoto(OWNER, providerId, photos[2]!.id, 'up')).toBe(true)
    expect(await order()).toEqual(['1', '3', '2', '4'])
  })

  it('swaps the cover', async () => {
    const photos = await ownedPhotos(OWNER, providerId)
    expect(await setCover(OWNER, providerId, photos[2]!.id)).toBe(true)
    const after = await ownedPhotos(OWNER, providerId)
    expect(after[0]!.id).toBe(photos[2]!.id)
    expect(after.filter((p) => p.isCover)).toHaveLength(1)
  })

  it('edits and clears a caption', async () => {
    const [first] = await ownedPhotos(OWNER, providerId)
    expect(await updateCaption(OWNER, providerId, first!.id, 'Jardim ao fim da tarde')).toBe(true)
    expect((await ownedPhotos(OWNER, providerId))[0]!.altText).toBe('Jardim ao fim da tarde')
    expect(await updateCaption(OWNER, providerId, first!.id, '   ')).toBe(true)
    expect((await ownedPhotos(OWNER, providerId))[0]!.altText).toBeNull()
  })

  it('promotes the next photo when the cover is removed', async () => {
    const [cover, next] = await ownedPhotos(OWNER, providerId)
    expect(await removePhoto(OWNER, providerId, cover!.id)).toBe(cover!.externalId)
    const after = await ownedPhotos(OWNER, providerId)
    expect(after).toHaveLength(3)
    expect(after[0]!.id).toBe(next!.id)
    expect(after[0]!.isCover).toBe(true)
  })

  it('lets a stranger do none of it', async () => {
    const photos = await ownedPhotos(OWNER, providerId)
    expect(await ownedPhotos(STRANGER, providerId)).toHaveLength(0)
    expect(await setCover(STRANGER, providerId, photos[2]!.id)).toBe(false)
    expect(await movePhoto(STRANGER, providerId, photos[2]!.id, 'up')).toBe(false)
    expect(await updateCaption(STRANGER, providerId, photos[2]!.id, 'x')).toBe(false)
    expect(await removePhoto(STRANGER, providerId, photos[2]!.id)).toBeNull()
    expect(await order()).toEqual(['1', '2', '3', '4'])
  })

  it('refuses re-pointing a photo at another object or provider', async () => {
    const [first] = await ownedPhotos(OWNER, providerId)
    await expect(asUser(OWNER, (c) =>
      c.query(`update media set external_id = $2 where id = $1`, [first!.id, key(providerId, 99)])))
      .rejects.toMatchObject({ code: '42501' })
  })
})

describe('what the public sees', () => {
  const publicPhotos = () => asVisitor(async (c) => {
    const { rows } = await c.query(`select id from media where provider_id = $1`, [providerId])
    return rows.length
  })

  beforeEach(async () => {
    await recordPhoto(OWNER, providerId, { externalId: key(providerId, 1) })
  })

  // Verification is an administrator's decision (providers_guard_verification);
  // the fixture writes it as a superuser with triggers off instead.
  async function publish(): Promise<void> {
    const raw = new Client({ connectionString: process.env.DATABASE_URL })
    await raw.connect()
    try {
      await raw.query(`set session_replication_role = replica`)
      await raw.query(
        `update providers set verification_status = 'verified', verified_at = now(), is_published = true where id = $1`,
        [providerId])
    } finally {
      await raw.end()
    }
  }

  it('sees nothing of an unverified listing', async () => {
    expect(await publicPhotos()).toBe(0)
  })

  it('sees the photos once the listing is verified and published', async () => {
    await publish()
    expect(await publicPhotos()).toBe(1)
  })

  it('stops seeing them when the owner is suspended', async () => {
    await publish()
    expect(await publicPhotos()).toBe(1)
    await asSystem((c) => c.query(`update profiles set status = 'suspended' where id = $1`, [OWNER]))
    expect(await publicPhotos()).toBe(0)
  })
})
