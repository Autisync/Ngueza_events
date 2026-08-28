import { readFile, rm } from 'node:fs/promises'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { requestBooking, transition } from '@/lib/booking'
import { asSystem, asUser } from '@/lib/db'
import { rejectProvider, verifyProvider } from '@/lib/admin'
import { claimAndSend, pendingNotificationCount, recentNotifications } from '@/lib/notifications'

/**
 * Slice 10 — the outbox actually reaching an inbox (or, in tests, a
 * file). Two things matter here that unit tests cannot cover: the
 * database triggers enqueueing the right row for the right person, and
 * a claim that will not send the same row twice.
 */

const OUTBOX = '.outbox/test-notify.jsonl'
const HORIZONTE = '50000000-0000-0000-0000-000000000001'
const SALAO = '60000000-0000-0000-0000-000000000001'
const OWNER = '40000000-0000-0000-0000-000000000001'
const JOAO = '40000000-0000-0000-0000-000000000091'
const ADMIN = '40000000-0000-0000-0000-000000000099'
const SUPPLIER = '30000000-0000-0000-0000-0000000000d1'
const SALOES = '20000000-0000-0000-0000-000000000010'
const TALATONA = '10000000-0000-0000-0000-000000000010'

// bookings are undeletable by design — booking_events is append-only, and
// deleting a booking would cascade into a DELETE on its events, which the
// append-only trigger refuses. So a rerun of this file against the same
// database, without a full db-reset, must never reuse a previous run's
// dates.
//
// Date.now() is the wrong tool here: two invocations seconds apart differ
// by a few thousand milliseconds, a rounding error against an 86.4
// million ms day — nowhere near enough to land on a different calendar
// day, so bookings a few seconds apart still overlap and collide. A
// random day, picked once per process, does the job regardless of how
// close together two runs are in wall-clock time.
const RUN_DAY = 1000 + Math.floor(Math.random() * 5000)
const at = (daysOffset: number, hour = 9) =>
  new Date(Date.now() + (RUN_DAY + daysOffset) * 86_400_000 + hour * 3_600_000)

// Same reasoning for the synthetic notification_outbox rows the claim
// tests insert directly: source_id only needs to be unique per row, not
// meaningful, so derive it from the same run-unique base.
const SOURCE_BASE = Date.now() + RUN_DAY

async function outbox(): Promise<Array<{ to: string; subject: string; text: string }>> {
  try {
    const raw = await readFile(OUTBOX, 'utf8')
    return raw.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  } catch {
    return []
  }
}

const notificationsFor = (sourceTable: string, sourceId: number) =>
  asSystem(async (c) => {
    const { rows } = await c.query<{ kind: string; to_email: string; status: string }>(
      `select kind, to_email, status from notification_outbox
        where source_table = $1 and source_id = $2 order by kind`,
      [sourceTable, sourceId],
    )
    return rows
  })

const lastBookingEventId = (bookingId: string) =>
  asSystem(async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `select id from booking_events where booking_id = $1 order by id desc limit 1`,
      [bookingId],
    )
    return Number(rows[0]!.id)
  })

const lastProviderAuditId = (providerId: string) =>
  asSystem(async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `select id from audit_log where target_type = 'provider' and target_id = $1
        order by id desc limit 1`,
      [providerId],
    )
    return Number(rows[0]!.id)
  })

beforeAll(() => {
  process.env.MAIL_OUTBOX = OUTBOX
})

beforeEach(() => rm(OUTBOX, { force: true }))

afterAll(async () => {
  await rm(OUTBOX, { force: true })
  // Unlike bookings, a provider with no history can be deleted outright,
  // and this one only ever exists for the "provider decisions" tests.
  await asSystem(async (c) => {
    await c.query(`delete from providers where owner_id = $1`, [SUPPLIER])
    await c.query(`delete from profiles where id = $1`, [SUPPLIER])
    await c.query(`delete from auth.users where id = $1`, [SUPPLIER])
  })
})

describe('booking transitions enqueue the right notification', () => {
  it('tells the supplier when a request arrives', async () => {
    const result = await requestBooking(JOAO, {
      providerId: HORIZONTE, resourceId: SALAO,
      startsAt: at(400), endsAt: at(400, 20),
    })
    if (!result.ok) throw new Error('booking failed')

    const eventId = await lastBookingEventId(result.bookingId)
    const rows = await notificationsFor('booking_events', eventId)
    expect(rows).toEqual([
      { kind: 'booking_requested', to_email: 'dono.horizonte@exemplo.ao', status: 'pending' },
    ])
  })

  it('notifies both parties on confirmation, as two independent rows', async () => {
    const result = await requestBooking(JOAO, {
      providerId: HORIZONTE, resourceId: SALAO,
      startsAt: at(401), endsAt: at(401, 20),
    })
    if (!result.ok) throw new Error('booking failed')
    await transition(OWNER, result.bookingId, 'accepted')
    await transition(OWNER, result.bookingId, 'confirmed')

    const eventId = await lastBookingEventId(result.bookingId)
    const rows = await notificationsFor('booking_events', eventId)
    expect(rows.map((r) => r.kind).sort()).toEqual(['booking_confirmed', 'booking_confirmed_provider'])
    expect(rows.map((r) => r.to_email).sort()).toEqual([
      'dono.horizonte@exemplo.ao', 'joao.cliente@exemplo.ao',
    ])
  })

  it('does not enqueue anything for a manual block — nobody to tell', async () => {
    const blockedId = await asSystem(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `insert into bookings (provider_id, resource_id, status, starts_at, ends_at)
         values ($1, $2, 'blocked', $3, $4)
         returning id`,
        [HORIZONTE, SALAO, at(402), at(402, 20)],
      )
      return rows[0]!.id
    })
    const eventId = await lastBookingEventId(blockedId)
    expect(await notificationsFor('booking_events', eventId)).toHaveLength(0)
  })
})

describe('provider decisions enqueue the right notification', () => {
  beforeEach(async () => {
    await asSystem(async (c) => {
      await c.query(`delete from providers where owner_id = $1`, [SUPPLIER])
      await c.query(`delete from profiles where id = $1`, [SUPPLIER])
      await c.query(`delete from auth.users where id = $1`, [SUPPLIER])
      await c.query(
        `insert into auth.users (id, email, email_confirmed_at)
         values ($1, 'notify-supplier@teste.ao', now())`,
        [SUPPLIER],
      )
      await c.query(
        `insert into providers (owner_id, supplier_type, slug, name, category_id, location_id,
                                verification_status)
         values ($1, 'venue', 'notify-test-salao', 'Salão de Teste', $2, $3, 'pending')`,
        [SUPPLIER, SALOES, TALATONA],
      )
    })
  })

  it('tells the owner when verified', async () => {
    const providerId = await asSystem(async (c) => {
      const { rows } = await c.query(`select id from providers where owner_id = $1`, [SUPPLIER])
      return rows[0]!.id
    })
    await verifyProvider(ADMIN, providerId)

    const eventId = await lastProviderAuditId(providerId)
    const rows = await notificationsFor('audit_log', eventId)
    expect(rows).toEqual([
      { kind: 'provider_verified', to_email: 'notify-supplier@teste.ao', status: 'pending' },
    ])
  })

  it('carries the reason through to the enqueued context on rejection', async () => {
    const providerId = await asSystem(async (c) => {
      const { rows } = await c.query(`select id from providers where owner_id = $1`, [SUPPLIER])
      return rows[0]!.id
    })
    await rejectProvider(ADMIN, providerId, 'Documento ilegível.')

    const eventId = await lastProviderAuditId(providerId)
    const row = await asSystem(async (c) => {
      const { rows } = await c.query(
        `select context->>'reason' as reason from notification_outbox
          where source_table = 'audit_log' and source_id = $1`,
        [eventId],
      )
      return rows[0]
    })
    expect(row?.reason).toBe('Documento ilegível.')
  })

  it('does not enqueue anything for pending — the supplier already knows they submitted', async () => {
    const providerId = await asSystem(async (c) => {
      const { rows } = await c.query(`select id from providers where owner_id = $1`, [SUPPLIER])
      return rows[0]!.id
    })
    // unverified -> pending, the owner's own submission (0017 self-service).
    await asSystem((c) =>
      c.query(`update providers set verification_status = 'pending' where id = $1`, [providerId]),
    )
    const eventId = await lastProviderAuditId(providerId).catch(() => null)
    if (eventId) expect(await notificationsFor('audit_log', eventId)).toHaveLength(0)
  })
})

describe('claiming and sending', () => {
  it('sends a pending row and marks it sent', async () => {
    const result = await requestBooking(JOAO, {
      providerId: HORIZONTE, resourceId: SALAO,
      startsAt: at(410), endsAt: at(410, 20),
    })
    if (!result.ok) throw new Error('booking failed')

    const before = await outbox()
    const summary = await claimAndSend(500)
    expect(summary.sent).toBeGreaterThanOrEqual(1)

    const after = await outbox()
    expect(after.length).toBeGreaterThan(before.length)
    expect(after.some((m) => m.to === 'dono.horizonte@exemplo.ao')).toBe(true)

    const eventId = await lastBookingEventId(result.bookingId)
    const [row] = await notificationsFor('booking_events', eventId)
    expect(row?.status).toBe('sent')
  })

  it('never sends the same row twice, even claimed by two callers at once', async () => {
    // Enqueue a distinguishable batch of rows directly, bypassing the
    // triggers so the count is exact and independent of what earlier
    // tests in this file left pending.
    const marker = `concurrency-${SOURCE_BASE}`
    const ids = await asSystem(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `insert into notification_outbox (kind, to_email, context, source_table, source_id)
         select 'provider_verified', $1::text, jsonb_build_object(
                  'provider_id','x','provider_name',$2::text,'provider_slug','x'),
                'audit_log', $3::bigint + g
           from generate_series(1, 12) g
         returning id`,
        [`${marker}@teste.ao`, marker, SOURCE_BASE],
      )
      return rows.map((r) => Number(r.id))
    })

    // Two overlapping claimAndSend calls, racing for the same rows.
    const [a, b] = await Promise.all([claimAndSend(100), claimAndSend(100)])

    const statuses = await asSystem(async (c) => {
      const { rows } = await c.query<{ status: string; n: string }>(
        `select status, count(*)::text as n from notification_outbox
          where id = any($1) group by status`,
        [ids],
      )
      return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]))
    })
    expect(statuses.sent).toBe(12)
    expect(statuses.pending ?? 0).toBe(0)
    expect(statuses.sending ?? 0).toBe(0)

    const sentToMarker = (await outbox()).filter((m) => m.to === `${marker}@teste.ao`)
    expect(sentToMarker).toHaveLength(12) // not 24 — nothing sent twice

    // Between them, the two calls accounted for every row exactly once.
    // NOT asserted: that both calls actually claimed something. Two
    // async calls over a fast local connection can easily have the first
    // finish its claim before the second's even starts — that is not a
    // bug, SKIP LOCKED still did its job. A real proof that concurrent
    // claims cannot collide needs genuine OS-level parallelism, which
    // tests/notify-concurrency.sh provides the same way
    // tests/concurrency.sh does for the booking exclusion constraint.
    expect(a.claimed + b.claimed).toBe(12)
  })

  it('marks a row failed after exhausting retries, without blocking the rest of the batch', async () => {
    const marker = `bad-${SOURCE_BASE}`
    const [badId, goodId] = await asSystem(async (c) => {
      // A valid kind — it satisfies the CHECK constraint, so it queues
      // exactly as a real bug in a future enqueue trigger would — but
      // context is empty, missing the provider_name every template
      // requires, so render() throws when this row is claimed.
      const bad = await c.query<{ id: string }>(
        `insert into notification_outbox (kind, to_email, context, source_table, source_id, attempts)
         values ('provider_rejected', $1, '{}'::jsonb, 'audit_log', $2::bigint, 4)
         returning id`,
        [`${marker}@teste.ao`, SOURCE_BASE + 100],
      )
      const good = await c.query<{ id: string }>(
        `insert into notification_outbox (kind, to_email, context, source_table, source_id)
         values ('provider_verified', $1, jsonb_build_object(
                   'provider_id','x','provider_name','x','provider_slug','x'),
                 'audit_log', $2::bigint)
         returning id`,
        [`${marker}-good@teste.ao`, SOURCE_BASE + 101],
      )
      return [Number(bad.rows[0]!.id), Number(good.rows[0]!.id)]
    })

    const summary = await claimAndSend(500)
    expect(summary.failed).toBeGreaterThanOrEqual(1)
    expect(summary.sent).toBeGreaterThanOrEqual(1)

    const rows = await asSystem(async (c) => {
      const { rows } = await c.query<{ id: string; status: string; last_error: string | null }>(
        `select id, status, last_error from notification_outbox where id = any($1)`,
        [[badId, goodId]],
      )
      return rows
    })
    const bad = rows.find((r) => Number(r.id) === badId)
    const good = rows.find((r) => Number(r.id) === goodId)
    expect(bad?.status).toBe('failed')
    expect(bad?.last_error).toBeTruthy()
    // The bad row's failure did not stop the good one in the same batch.
    expect(good?.status).toBe('sent')
  })
})

describe('admin visibility', () => {
  it('counts what is waiting and lists what was sent', async () => {
    const before = await pendingNotificationCount(ADMIN)
    const result = await requestBooking(JOAO, {
      providerId: HORIZONTE, resourceId: SALAO,
      startsAt: at(420), endsAt: at(420, 20),
    })
    if (!result.ok) throw new Error('booking failed')

    expect(await pendingNotificationCount(ADMIN)).toBe(before + 1)
    await claimAndSend(500)
    expect(await pendingNotificationCount(ADMIN)).toBe(before)

    const recent = await recentNotifications(ADMIN, 5)
    expect(recent.length).toBeGreaterThan(0)
    expect(recent[0]!.status).toBe('sent')
  })

  it('is invisible to a non-administrator', async () => {
    const seen = await asUser(JOAO, async (c) => {
      const { rows } = await c.query(`select id from notification_outbox`)
      return rows.length
    })
    expect(seen).toBe(0)
  })
})
