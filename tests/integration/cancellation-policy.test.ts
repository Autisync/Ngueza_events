import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { requestBooking, transition } from '@/lib/booking'
import { asSystem } from '@/lib/db'
import {
  activePolicy, ownPolicy, refundEntitlement, setOwnPolicy,
} from '@/lib/cancellation-policy'

/**
 * Backdates one booking's cancellation audit row, for the one test that
 * needs to prove refundEntitlement() reads the real cancellation moment
 * rather than now(). booking_events is append-only (0006) even to
 * service_role — asSystem()'s role, and deliberately so, since that
 * restriction is the actual behaviour production code runs under.
 * Disabling the trigger needs real table ownership, which only a plain
 * superuser connection has — the same connection this codebase has
 * used via raw psql all session for the identical need during cleanup,
 * here just reached from inside a test instead of a shell command.
 */
async function backdateCancellation(bookingId: string, at: Date): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    await client.query(`alter table booking_events disable trigger booking_events_append_only`)
    await client.query(
      `update booking_events set created_at = $2
        where booking_id = $1 and to_status = 'cancelled_client'`,
      [bookingId, at.toISOString()],
    )
    await client.query(`alter table booking_events enable trigger booking_events_append_only`)
  } finally {
    await client.end()
  }
}

/**
 * The cancellation & refund policy engine (Phase Two, slice 19).
 * compute_refund_pct and cancellation_tiers_valid (0026) are asserted
 * directly against Postgres in the migration's own verification; these
 * assert the application layer surfaces both correctly.
 */

const HORIZONTE = '50000000-0000-0000-0000-000000000001'
const SALAO = '60000000-0000-0000-0000-000000000001'
const OWNER = '40000000-0000-0000-0000-000000000001'
const OTHER_OWNER = '40000000-0000-0000-0000-000000000002'
const ANA = '40000000-0000-0000-0000-000000000090'

const clean = () =>
  asSystem(async (c) => {
    await c.query(`delete from cancellation_policies where provider_id is not null`)
    // TRUNCATE, not DELETE: booking_events is append-only by design
    // (0006), so a cascading delete from bookings is refused — the same
    // reason tests/integration/booking.test.ts's own clean() uses
    // TRUNCATE. CASCADE reaches every table with a foreign key to
    // bookings (reviews, payments, payment_documents too), which is
    // fine: integration files run sequentially, never in parallel
    // (vitest.config.ts), so each file only needs its own baseline
    // restored before its own tests run.
    await c.query('truncate booking_events, bookings cascade')
    // Restore both seeded bookings, not just whichever this file uses —
    // search.test.ts and provider.test.ts assert against the seeded
    // confirmation and the seeded manual block.
    await c.query(
      `insert into bookings (id, provider_id, client_id, resource_id, status, starts_at, ends_at)
       values ('80000000-0000-0000-0000-000000000001', $1, $2, $3, 'confirmed',
               '2026-12-15 10:00+01', '2026-12-15 23:59+01')`,
      [HORIZONTE, ANA, SALAO],
    )
    await c.query(
      `insert into bookings (id, provider_id, client_id, resource_id, status, starts_at, ends_at)
       values ('80000000-0000-0000-0000-000000000002',
               '50000000-0000-0000-0000-000000000002', null,
               '60000000-0000-0000-0000-000000000002', 'blocked',
               '2026-12-20 08:00+01', '2026-12-21 02:00+01')`,
    )
  })

beforeEach(clean)
afterEach(clean)

describe('the supplier policy setting', () => {
  it('falls back to the platform default until a supplier sets their own', async () => {
    const policy = await activePolicy(ANA, HORIZONTE)
    expect(policy?.providerId).toBeNull()
    expect(policy?.name).toBe('Política padrão NGUEZA')
    expect(await ownPolicy(OWNER, HORIZONTE)).toBeNull()
  })

  it('lets a supplier set their own tiers, which then override the default', async () => {
    const result = await setOwnPolicy(OWNER, HORIZONTE, {
      name: 'Política flexível',
      tiers: [{ daysBefore: 14, refundPct: 100 }, { daysBefore: 3, refundPct: 50 }],
    })
    expect(result).toEqual({ ok: true })

    const own = await ownPolicy(OWNER, HORIZONTE)
    expect(own?.name).toBe('Política flexível')
    expect(own?.tiers).toEqual([{ daysBefore: 14, refundPct: 100 }, { daysBefore: 3, refundPct: 50 }])

    const active = await activePolicy(ANA, HORIZONTE)
    expect(active?.providerId).toBe(HORIZONTE)
    expect(active?.name).toBe('Política flexível')
  })

  it('updates in place rather than accumulating a second row', async () => {
    await setOwnPolicy(OWNER, HORIZONTE, { name: 'V1', tiers: [{ daysBefore: 30, refundPct: 100 }] })
    await setOwnPolicy(OWNER, HORIZONTE, { name: 'V2', tiers: [{ daysBefore: 10, refundPct: 80 }] })

    const count = await asSystem((c) =>
      c.query(`select count(*)::int as n from cancellation_policies where provider_id = $1`, [HORIZONTE]),
    )
    expect(count.rows[0]?.n).toBe(1)
    expect((await ownPolicy(OWNER, HORIZONTE))?.name).toBe('V2')
  })

  it('refuses a policy where more notice pays a worse refund than less', async () => {
    const result = await setOwnPolicy(OWNER, HORIZONTE, {
      name: 'Backwards',
      tiers: [{ daysBefore: 30, refundPct: 20 }, { daysBefore: 7, refundPct: 90 }],
    })
    expect(result).toEqual({ ok: false, reason: 'invalid_tiers' })
    expect(await ownPolicy(OWNER, HORIZONTE)).toBeNull()
  })

  it('refuses an out-of-range percentage and more than five tiers', async () => {
    expect(await setOwnPolicy(OWNER, HORIZONTE, {
      name: 'Bad', tiers: [{ daysBefore: 30, refundPct: 150 }],
    })).toEqual({ ok: false, reason: 'invalid_tiers' })

    expect(await setOwnPolicy(OWNER, HORIZONTE, {
      name: 'Bad',
      tiers: Array.from({ length: 6 }, (_, i) => ({ daysBefore: 60 - i * 10, refundPct: 100 - i * 10 })),
    })).toEqual({ ok: false, reason: 'invalid_tiers' })
  })

  it('refuses a supplier setting a policy for a business they do not own', async () => {
    // OTHER_OWNER owns Palmeiras, not Horizonte.
    await expect(
      setOwnPolicy(OTHER_OWNER, HORIZONTE, { name: 'X', tiers: [{ daysBefore: 30, refundPct: 100 }] }),
    ).rejects.toThrow()
    expect(await ownPolicy(OWNER, HORIZONTE)).toBeNull()
  })
})

describe('refund entitlement', () => {
  it('previews live against today, before any cancellation', async () => {
    const starts = new Date(Date.now() + 40 * 86400_000) // 40 days out
    const created = await requestBooking(ANA, {
      providerId: HORIZONTE, resourceId: SALAO, startsAt: starts,
      endsAt: new Date(starts.getTime() + 12 * 3600_000),
    })
    if (!created.ok) throw new Error('setup failed')

    const entitlement = await refundEntitlement(ANA, created.bookingId)
    expect(entitlement?.isFinal).toBe(false)
    expect(entitlement?.decidedAt).toBeNull()
    expect(entitlement?.refundPct).toBe(100) // 40 days out clears the 30-day tier
  })

  it('is 0% once inside every tier\'s window', async () => {
    const starts = new Date(Date.now() + 2 * 86400_000) // 2 days out
    const created = await requestBooking(ANA, {
      providerId: HORIZONTE, resourceId: SALAO, startsAt: starts,
      endsAt: new Date(starts.getTime() + 12 * 3600_000),
    })
    if (!created.ok) throw new Error('setup failed')
    expect((await refundEntitlement(ANA, created.bookingId))?.refundPct).toBe(0)
  })

  it('freezes at the moment actually cancelled, not at whenever it is looked up', async () => {
    const starts = new Date(Date.now() + 20 * 86400_000) // 20 days out at booking time
    const created = await requestBooking(ANA, {
      providerId: HORIZONTE, resourceId: SALAO, startsAt: starts,
      endsAt: new Date(starts.getTime() + 12 * 3600_000),
    })
    if (!created.ok) throw new Error('setup failed')

    expect(await transition(ANA, created.bookingId, 'cancelled_client')).toEqual({ ok: true })

    // Backdate the audit row to simulate a cancellation that actually
    // happened 40 days before the event — a real 100%-tier cancellation
    // — rather than trusting the fast test clock. If refundEntitlement()
    // used now() instead of this recorded moment, it would see roughly
    // "20 days before start" (today, unchanged) and report 50%, not 100%.
    // booking_events is append-only (0006) by design, and even
    // service_role — asSystem()'s role — isn't the table owner, so
    // disabling the trigger needs the same real superuser connection
    // this codebase has only ever used via a raw psql session until
    // now, not the app's own restricted, production-shaped roles.
    await backdateCancellation(created.bookingId, new Date(starts.getTime() - 40 * 86400_000))

    const entitlement = await refundEntitlement(ANA, created.bookingId)
    expect(entitlement?.isFinal).toBe(true)
    expect(entitlement?.decidedAt).not.toBeNull()
    expect(entitlement?.refundPct).toBe(100)
  })

  it('uses the booking\'s own frozen snapshot, unaffected by a policy changed afterward', async () => {
    const starts = new Date(Date.now() + 22 * 86400_000)
    const created = await requestBooking(ANA, {
      providerId: HORIZONTE, resourceId: SALAO, startsAt: starts,
      endsAt: new Date(starts.getTime() + 12 * 3600_000),
    })
    if (!created.ok) throw new Error('setup failed')
    // 20 days out against the platform default (30/14/7) clears only the
    // 14-day tier: 50%.
    expect((await refundEntitlement(ANA, created.bookingId))?.refundPct).toBe(50)

    // The supplier tightens their policy after the fact.
    await setOwnPolicy(OWNER, HORIZONTE, { name: 'Tighter', tiers: [{ daysBefore: 60, refundPct: 100 }] })

    // This booking's own snapshot is unchanged — still 50%, not 0%.
    expect((await refundEntitlement(ANA, created.bookingId))?.refundPct).toBe(50)
  })

  it('hides a stranger\'s booking entirely — not found, not a permission error', async () => {
    const starts = new Date(Date.now() + 24 * 86400_000)
    const created = await requestBooking(ANA, {
      providerId: HORIZONTE, resourceId: SALAO, startsAt: starts,
      endsAt: new Date(starts.getTime() + 12 * 3600_000),
    })
    if (!created.ok) throw new Error('setup failed')
    // OTHER_OWNER is neither the client nor Horizonte's owner.
    expect(await refundEntitlement(OTHER_OWNER, created.bookingId)).toBeNull()
  })
})
