import { beforeAll, describe, expect, it } from 'vitest'
import { asSystem, asUser } from '@/lib/db'
import { bookingDetail, requestBooking, transition } from '@/lib/booking'
import { answerRefund, attestRefund, refundsFor } from '@/lib/refunds'

/**
 * Slice 47 (review R013): a supplier's cancellation says why, once; and
 * what happened to the money is two statements — the supplier's and the
 * client's — recorded as made. NGUEZA moves none of it.
 */

const HORIZONTE = '50000000-0000-0000-0000-000000000001'
const SALAO = '60000000-0000-0000-0000-000000000001'
const OWNER = '40000000-0000-0000-0000-000000000001'
const OTHER_OWNER = '40000000-0000-0000-0000-000000000002'
const JOAO = '40000000-0000-0000-0000-000000000091'
const ANA = '40000000-0000-0000-0000-000000000090'

// A far, random day so reruns never collide with an earlier run's rows.
const day = () => {
  const d = new Date(Date.UTC(2031, 0, 1) + Math.floor(Math.random() * 3000) * 86_400_000)
  return d.toISOString().slice(0, 10)
}

async function aConfirmedBooking(): Promise<string> {
  const date = day()
  const made = await requestBooking(JOAO, {
    providerId: HORIZONTE, resourceId: SALAO,
    startsAt: new Date(`${date}T09:00:00+01:00`), endsAt: new Date(`${date}T22:00:00+01:00`),
    clientPhone: '+244923000091', acceptsLegal: true,
  })
  if (!made.ok) throw new Error(`request failed: ${made.reason}`)
  expect(await transition(OWNER, made.bookingId, 'accepted')).toEqual({ ok: true })
  expect(await transition(OWNER, made.bookingId, 'confirmed')).toEqual({ ok: true })
  return made.bookingId
}

const outbox = (bookingId: string) =>
  asSystem(async (c) => (await c.query<{ kind: string; recipient_id: string }>(
    `select kind, recipient_id from notification_outbox
      where source_table = 'refund_attestations' and context->>'booking_id' = $1 order by id`,
    [bookingId])).rows)

describe('a supplier cancelling', () => {
  it('must say why, and the reason cannot be edited afterwards', async () => {
    const id = await aConfirmedBooking()
    expect(await transition(OWNER, id, 'cancelled_provider')).toEqual({ ok: false, reason: 'reason_required' })
    expect(await transition(OWNER, id, 'cancelled_provider', undefined, '   ')).toEqual({ ok: false, reason: 'reason_required' })
    expect(await transition(OWNER, id, 'cancelled_provider', undefined, 'Avaria no gerador.')).toEqual({ ok: true })

    const seen = await bookingDetail(JOAO, id)
    expect(seen?.cancellationReason).toBe('Avaria no gerador.')

    const edited = await asUser(OWNER, (c) =>
      c.query(`update bookings set cancellation_reason = 'Outro motivo' where id = $1`, [id]),
    ).then(() => 'edited', (e: { code?: string }) => e.code)
    expect(edited).toBe('42501')
  })
})

describe('refund statements', () => {
  let id = ''
  beforeAll(async () => {
    id = await aConfirmedBooking()
    await transition(OWNER, id, 'cancelled_provider', undefined, 'Avaria no gerador.')
  })

  it('only the booking\'s supplier may state a refund', async () => {
    expect(await attestRefund(JOAO, id, { amountMinor: 1000n, method: 'transferencia' })).toBe('not_allowed')
    expect(await attestRefund(OTHER_OWNER, id, { amountMinor: 1000n, method: 'transferencia' })).toBe('not_allowed')
    expect(await attestRefund(OWNER, id, { amountMinor: 45000000n, method: 'multicaixa_express', reference: 'MX-1' })).toBe('ok')
  })

  it('is refused on a booking that is not cancelled', async () => {
    const live = await aConfirmedBooking()
    expect(await attestRefund(OWNER, live, { amountMinor: 1000n, method: 'numerario' })).toBe('not_allowed')
  })

  it('both parties see it; nobody else does', async () => {
    expect(await refundsFor(OWNER, id)).toHaveLength(1)
    const [r] = await refundsFor(JOAO, id)
    expect(r).toMatchObject({ amountMinor: 45000000n, method: 'multicaixa_express', reference: 'MX-1', clientResponse: null })
    expect(await refundsFor(ANA, id)).toEqual([])
    expect(await refundsFor(OTHER_OWNER, id)).toEqual([])
  })

  it('tells the client', async () => {
    expect(await outbox(id)).toEqual([{ kind: 'refund_sent', recipient_id: JOAO }])
  })

  it('the client answers once; the supplier cannot answer for them', async () => {
    const [r] = await refundsFor(JOAO, id)
    expect(await answerRefund(OWNER, r!.id, 'received')).toBe('not_allowed')
    expect(await answerRefund(JOAO, r!.id, 'disputed', 'Não chegou.')).toBe('ok')
    expect(await answerRefund(JOAO, r!.id, 'received')).toBe('not_allowed')
    const [after] = await refundsFor(OWNER, id)
    expect(after).toMatchObject({ clientResponse: 'disputed', clientNote: 'Não chegou.' })
    expect(after!.respondedAt).not.toBeNull()
  })

  it('a dispute tells the supplier', async () => {
    expect((await outbox(id)).map((r) => r.kind)).toEqual(['refund_sent', 'refund_disputed'])
    expect((await outbox(id))[1]!.recipient_id).toBe(OWNER)
  })

  it('a statement cannot be rewritten or deleted', async () => {
    const tryAs = (who: string, sql: string) =>
      asUser(who, (c) => c.query(sql, [id])).then((r) => r.rowCount, (e: { code?: string }) => e.code)
    expect(await tryAs(JOAO, `update refund_attestations set amount_minor = 1 where booking_id = $1`)).toBe('42501')
    expect(await tryAs(OWNER, `delete from refund_attestations where booking_id = $1`)).toBe('42501')
  })
})
