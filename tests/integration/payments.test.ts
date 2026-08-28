import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asSystem, asUser } from '@/lib/db'
import { clientPayments, submitPaymentProof } from '@/lib/payments'
import { decidePayment, paymentQueue } from '@/lib/admin'

/**
 * The manual_proof adapter (§28, §29) — the only one v1 ships. NGUEZA
 * never receives, holds or forwards money; these assert the record-and-
 * review layer around that, and the RLS boundary the whole thing sits on
 * (0025) — not any actual transfer, which does not exist in this codebase.
 */

const HORIZONTE = '50000000-0000-0000-0000-000000000001'
const PALMEIRAS = '50000000-0000-0000-0000-000000000002'
const SALAO = '60000000-0000-0000-0000-000000000001'
const ADMIN = '40000000-0000-0000-0000-000000000099'
const ANA = '40000000-0000-0000-0000-000000000090'
const JOAO = '40000000-0000-0000-0000-000000000091'

const AWAITING = '84000000-0000-0000-0000-000000000001'
const REQUESTED = '84000000-0000-0000-0000-000000000002'
const SOMEONE_ELSES = '84000000-0000-0000-0000-000000000003'

const clean = () =>
  asSystem(async (c) => {
    await c.query('truncate payment_documents, payments, booking_events, bookings cascade')
    await c.query(
      `insert into bookings (id, provider_id, client_id, resource_id, status, starts_at, ends_at)
       values
        ($1, $4, $5, $3, 'awaiting_payment', '2026-04-10 10:00+01', '2026-04-10 23:59+01'),
        ($2, $4, $5, $3, 'requested',        '2026-04-11 10:00+01', '2026-04-11 23:59+01')`,
      [AWAITING, REQUESTED, SALAO, HORIZONTE, ANA],
    )
    await c.query(
      `insert into bookings (id, provider_id, client_id, resource_id, status, starts_at, ends_at)
       values ($1, $2, $3, '60000000-0000-0000-0000-000000000002', 'awaiting_payment',
               '2026-04-12 10:00+01', '2026-04-12 23:59+01')`,
      [SOMEONE_ELSES, PALMEIRAS, JOAO],
    )
    // Restore the two shared seed fixtures other integration files depend on.
    await c.query(
      `insert into bookings (id, provider_id, client_id, resource_id, status, starts_at, ends_at)
       values ('80000000-0000-0000-0000-000000000001',
               '50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000090',
               '60000000-0000-0000-0000-000000000001', 'confirmed',
               '2026-12-15 10:00+01', '2026-12-15 23:59+01')`,
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

const doc = () => ({ externalId: `${AWAITING}/receipt.jpg`, filename: 'receipt.jpg', contentType: 'image/jpeg', byteSize: 12345 })

describe('proof of payment', () => {
  it('lets a client submit proof against their own awaiting-payment booking', async () => {
    const result = await submitPaymentProof(ANA, {
      bookingId: AWAITING, amountMinor: 5_000_000n, reference: 'REF-1', document: doc(),
    })
    expect(result.ok).toBe(true)

    const mine = await clientPayments(ANA, AWAITING)
    expect(mine).toHaveLength(1)
    expect(mine[0]?.status).toBe('submitted')
    expect(mine[0]?.amountMinor).toBe('5000000')
    expect(mine[0]?.hasDocument).toBe(true)
  })

  it('refuses a submission for a booking that is not awaiting payment', async () => {
    const result = await submitPaymentProof(ANA, {
      bookingId: REQUESTED, amountMinor: 5_000_000n,
      document: { externalId: `${REQUESTED}/receipt.jpg` },
    })
    expect(result).toEqual({ ok: false, reason: 'not_allowed' })
  })

  it('refuses a stranger submitting against someone else\'s booking', async () => {
    // João's own booking is SOMEONE_ELSES; this targets Ana's.
    const result = await submitPaymentProof(JOAO, {
      bookingId: AWAITING, amountMinor: 5_000_000n,
      document: { externalId: `${AWAITING}/receipt.jpg` },
    })
    expect(result).toEqual({ ok: false, reason: 'not_allowed' })
  })

  it('leaves no orphaned document when the payment insert fails after it', async () => {
    // The document insert alone would succeed (this booking really is
    // awaiting payment); a negative amount only trips the *second*
    // insert's own check constraint. Both must roll back together —
    // asUser wraps the whole call in one transaction — or a booking
    // would end up with an uploaded file and no payment record pointing
    // at it.
    await submitPaymentProof(ANA, {
      bookingId: AWAITING, amountMinor: -1n,
      document: { externalId: `${AWAITING}/x.jpg` },
    }).catch(() => {})
    const count = await asSystem((c) =>
      c.query(`select count(*)::int as n from payment_documents where booking_id = $1`, [AWAITING]),
    )
    expect(count.rows[0]?.n).toBe(0)
  })

  it('scopes clientPayments to the booking asked for, not every booking', async () => {
    await submitPaymentProof(ANA, { bookingId: AWAITING, amountMinor: 1000n, document: doc() })
    expect(await clientPayments(ANA, REQUESTED)).toHaveLength(0)
  })
})

describe('the admin review queue', () => {
  it('lists a submission with its business and client context', async () => {
    await submitPaymentProof(ANA, { bookingId: AWAITING, amountMinor: 2_500_000n, reference: 'X', document: doc() })
    const queue = await paymentQueue(ADMIN)
    const item = queue.find((p) => p.bookingId === AWAITING)
    expect(item?.providerName).toBe('Salão Horizonte')
    expect(item?.amountMinor).toBe('2500000')
    expect(item?.reference).toBe('X')
    expect(item?.documentId).not.toBeNull()
  })

  it('does not list a payment already decided', async () => {
    const result = await submitPaymentProof(ANA, { bookingId: AWAITING, amountMinor: 1000n, document: doc() })
    if (!result.ok) throw new Error('setup failed')
    await decidePayment(ADMIN, result.paymentId, 'confirmed')
    const queue = await paymentQueue(ADMIN)
    expect(queue.find((p) => p.id === result.paymentId)).toBeUndefined()
  })

  it('confirming stamps who and when, and never touches the booking itself', async () => {
    const result = await submitPaymentProof(ANA, { bookingId: AWAITING, amountMinor: 1000n, document: doc() })
    if (!result.ok) throw new Error('setup failed')
    await decidePayment(ADMIN, result.paymentId, 'confirmed')

    const row = await asSystem((c) =>
      c.query(`select status, confirmed_by, confirmed_at from payments where id = $1`, [result.paymentId]),
    )
    expect(row.rows[0]?.status).toBe('confirmed')
    expect(row.rows[0]?.confirmed_by).toBe(ADMIN)
    expect(row.rows[0]?.confirmed_at).not.toBeNull()

    // Reviewing a payment is not a booking transition — this app's own
    // "Confirmar pagamento recebido" button (slice 08) is a separate,
    // deliberate supplier action, never automated by this review.
    const booking = await asSystem((c) =>
      c.query(`select status from bookings where id = $1`, [AWAITING]),
    )
    expect(booking.rows[0]?.status).toBe('awaiting_payment')
  })

  it('a non-admin cannot decide a payment — RLS refuses the write, not just the UI', async () => {
    const result = await submitPaymentProof(ANA, { bookingId: AWAITING, amountMinor: 1000n, document: doc() })
    if (!result.ok) throw new Error('setup failed')
    // ANA is a real client, not an admin — payments_admin_write (0011)
    // is the only UPDATE policy on payments, admin-only.
    await asUser(ANA, (c) =>
      c.query(`update payments set status = 'confirmed', confirmed_by = $2, confirmed_at = now() where id = $1`,
        [result.paymentId, ANA]),
    )
    const row = await asSystem((c) => c.query(`select status from payments where id = $1`, [result.paymentId]))
    expect(row.rows[0]?.status).toBe('submitted')
  })

  // paymentProofUrl() itself is a thin wrapper around documentStore()'s
  // presigned-read call, which needs the local MinIO stack to exercise —
  // the same reason documentViewUrl(), its sibling for identity
  // paperwork, has no test in this suite either. Covered by test:media
  // (deploy/media/), not here.
})
