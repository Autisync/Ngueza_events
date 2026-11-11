import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { asSystem, asUser } from '@/lib/db'
import { requestBooking } from '@/lib/booking'
import { recordSignupAcceptance } from '@/lib/legal'

/**
 * Slice 41 — versioned legal documents and recorded acceptance (0042).
 */

const ANA = '40000000-0000-0000-0000-000000000090'
const JOAO = '40000000-0000-0000-0000-000000000091'
const ADMIN = '40000000-0000-0000-0000-000000000099'
const HORIZONTE = '50000000-0000-0000-0000-000000000001'
const SALAO = '60000000-0000-0000-0000-000000000001'

const clean = () => asSystem(async (c) => {
  await c.query(`delete from legal_acceptances`)
  await c.query(`delete from legal_documents where version like 'teste-%'`)
})
beforeEach(clean)
afterAll(clean)

const accepted = (who: string) => asSystem(async (c) => (await c.query<{ kind: string; version: string; context: string; booking_id: string | null }>(
  `select d.kind, d.version, a.context, a.booking_id from legal_acceptances a
     join legal_documents d on d.id = a.document_id where a.profile_id = $1 order by d.kind`, [who])).rows)

const book = (who: string, day: string, acceptsLegal: boolean) => requestBooking(who, {
  providerId: HORIZONTE, resourceId: SALAO,
  startsAt: new Date(`${day}T09:00:00Z`), endsAt: new Date(`${day}T22:00:00Z`), acceptsLegal,
})

describe('legal acceptance', () => {
  it('records the terms and cancellation versions in force with the booking request, in one transaction', async () => {
    const r = await book(JOAO, '2028-07-01', true)
    const id = (r as { bookingId: string }).bookingId
    expect(await accepted(JOAO)).toEqual([
      { kind: 'cancellation', version: 'provisorio-2026-11', context: 'booking', booking_id: id },
      { kind: 'terms', version: 'provisorio-2026-11', context: 'booking', booking_id: id },
    ])
  })

  it('records terms and privacy at sign-up', async () => {
    await recordSignupAcceptance(ANA)
    expect((await accepted(ANA)).map((a) => [a.kind, a.context])).toEqual([['privacy', 'signup'], ['terms', 'signup']])
  })

  it('points new acceptances at a new version, and leaves old records on the version accepted', async () => {
    await book(JOAO, '2028-07-02', true)
    await asSystem((c) => c.query(
      `insert into legal_documents (kind, version, url, published_at) values ('terms', 'teste-v2', '/termos', now() + interval '1 second')`))
    await new Promise((r) => setTimeout(r, 1100))
    await book(JOAO, '2028-07-03', true)
    const terms = (await accepted(JOAO)).filter((a) => a.kind === 'terms').map((a) => a.version).sort()
    expect(terms).toEqual(['provisorio-2026-11', 'teste-v2'])
  })

  it('lets nobody accept for someone else, or accept a version not in force, or rewrite a record', async () => {
    const doc = await asSystem(async (c) => (await c.query<{ id: string }>(
      `select id from legal_documents where kind = 'terms' and version = 'provisorio-2026-11'`)).rows[0]!.id)
    await expect(asUser(JOAO, (c) => c.query(
      `insert into legal_acceptances (profile_id, document_id, context) values ($1, $2, 'signup')`, [ANA, doc])))
      .rejects.toMatchObject({ code: '42501' })
    const future = await asSystem(async (c) => (await c.query<{ id: string }>(
      `insert into legal_documents (kind, version, url, published_at) values ('terms', 'teste-futuro', '/termos', now() + interval '1 day') returning id`)).rows[0]!.id)
    await expect(asUser(JOAO, (c) => c.query(
      `insert into legal_acceptances (profile_id, document_id, context) values ($1, $2, 'signup')`, [JOAO, future])))
      .rejects.toMatchObject({ code: '42501' })
    await recordSignupAcceptance(JOAO)
    await expect(asUser(JOAO, (c) => c.query(`delete from legal_acceptances`))).rejects.toMatchObject({ code: '42501' })
    expect((await asUser(ADMIN, async (c) => (await c.query(`select id from legal_acceptances`)).rows)).length).toBeGreaterThan(0)
  })

  it('acknowledges the request to the client by email, not only to the supplier', async () => {
    const r = await book(ANA, '2028-07-04', true)
    const id = (r as { bookingId: string }).bookingId
    const kinds = await asSystem(async (c) => (await c.query<{ kind: string; recipient_id: string }>(
      `select kind, recipient_id from notification_outbox where context->>'booking_id' = $1 order by kind`, [id])).rows)
    expect(kinds).toEqual(expect.arrayContaining([
      { kind: 'booking_requested_client', recipient_id: ANA },
      expect.objectContaining({ kind: 'booking_requested' }),
    ]))
  })
})
