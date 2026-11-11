import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asSystem, asUser } from '@/lib/db'
import { bookingPayments, paymentProgress, proofDocumentUrl, submitPaymentProof } from '@/lib/payments'
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

    const mine = await bookingPayments(ANA, AWAITING)
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

  it('scopes bookingPayments to the booking asked for, not every booking', async () => {
    await submitPaymentProof(ANA, { bookingId: AWAITING, amountMinor: 1000n, document: doc() })
    expect(await bookingPayments(ANA, REQUESTED)).toHaveLength(0)
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

describe('the supplier sees the proof before confirming (slice 31)', () => {
  const OWNER = '40000000-0000-0000-0000-000000000001'          // Horizonte's owner
  const OTHER_OWNER = '40000000-0000-0000-0000-000000000002'    // Palmeiras' owner

  it('lists the client\'s submissions on the supplier\'s own booking, with the document', async () => {
    await submitPaymentProof(ANA, { bookingId: AWAITING, amountMinor: 5000000n, reference: 'MCX-1', document: doc() })
    const seen = await bookingPayments(OWNER, AWAITING)
    expect(seen).toHaveLength(1)
    expect(seen[0]!.reference).toBe('MCX-1')
    expect(seen[0]!.documentId).toBeTruthy()
    expect(await bookingPayments(OTHER_OWNER, AWAITING)).toHaveLength(0)
  })

  it('signs a short-lived link for the client, the supplier and an admin — and nobody else', async () => {
    Object.assign(process.env, {
      MEDIA_S3_PUBLIC_ENDPOINT: 'http://localhost:9000',
      MEDIA_ACCESS_KEY_ID: 'test', MEDIA_SECRET_ACCESS_KEY: 'test-secret',
    })
    await submitPaymentProof(ANA, { bookingId: AWAITING, amountMinor: 5000000n, document: doc() })
    const documentId = (await bookingPayments(ANA, AWAITING))[0]!.documentId!
    for (const actor of [ANA, OWNER, ADMIN]) {
      const url = await proofDocumentUrl(actor, documentId)
      expect(url).toContain('/ngueza-documents/')
      expect(url).toContain('X-Amz-Expires=180')
    }
    expect(await proofDocumentUrl(OTHER_OWNER, documentId)).toBeNull()
    expect(await proofDocumentUrl(JOAO, documentId)).toBeNull()
  })

  it('adds up what has been declared, leaving out rejected submissions', () => {
    const p = (amount: string, status: 'submitted' | 'confirmed' | 'failed') =>
      ({ id: amount, status, amountMinor: amount, currency: 'AOA', reference: null,
         createdAt: '', confirmedAt: null, hasDocument: true, documentId: null })
    expect(paymentProgress('10000', [p('3000', 'submitted'), p('2000', 'confirmed'), p('9000', 'failed')]))
      .toEqual({ declaredMinor: 5000n, remainingMinor: 5000n })
    expect(paymentProgress('10000', [p('12000', 'submitted')])).toEqual({ declaredMinor: 12000n, remainingMinor: 0n })
    expect(paymentProgress(null, [p('3000', 'submitted')])).toEqual({ declaredMinor: 3000n, remainingMinor: null })
  })
})
