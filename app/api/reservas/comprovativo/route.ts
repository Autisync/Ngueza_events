import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireProfile } from '@/lib/auth'
import { asUser } from '@/lib/db'
import { parseMajor } from '@/lib/money'
import { ALLOWED_DOCUMENT_TYPES, MAX_DOCUMENT_BYTES, documentStore } from '@/lib/media'
import { submitPaymentProof } from '@/lib/payments'

export const dynamic = 'force-dynamic'

/**
 * Proof of payment (§28, §29) — the manual_proof adapter, the only one v1
 * ships. The browser uploads straight to the private documents bucket
 * with a presigned URL, same rule and same route shape as verification
 * paperwork (`/api/painel/documento`): a server action's request-body cap
 * would refuse a phone photograph of a receipt long before this file's
 * own MAX_DOCUMENT_BYTES limit does.
 *
 * NGUEZA never receives, holds or forwards money here. This route stores
 * a claim and an attachment; confirming or rejecting it is an
 * administrator's decision, made from lib/admin.ts, never this one.
 */

const presignBody = z.object({
  bookingId: z.string().uuid(),
  contentType: z.string().max(120),
  byteSize: z.number().int().positive().max(MAX_DOCUMENT_BYTES),
})

const recordBody = z.object({
  bookingId: z.string().uuid(),
  amount: z.string().min(1).max(30),
  reference: z.string().max(200).optional(),
  externalId: z.string().min(1).max(300),
  filename: z.string().max(200).optional(),
  contentType: z.string().max(120).optional(),
  byteSize: z.number().int().positive().max(MAX_DOCUMENT_BYTES).optional(),
})

/** RLS would refuse the write anyway; this turns that into a clean 403
 *  rather than the misleading RLS-violation message a raw insert gives. */
async function ownsAndAwaitingPayment(userId: string, bookingId: string): Promise<boolean> {
  return asUser(userId, async (c) => {
    const { rows } = await c.query(
      `select 1 from bookings where id = $1 and client_id = $2 and status = 'awaiting_payment'`,
      [bookingId, userId],
    )
    return rows.length > 0
  })
}

export async function POST(request: Request): Promise<NextResponse> {
  let profile
  try {
    profile = await requireProfile()
  } catch {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const step = new URL(request.url).searchParams.get('passo')

  if (step === 'presign') {
    const parsed = presignBody.safeParse(body)
    if (!parsed.success) return NextResponse.json({ error: 'bad request' }, { status: 400 })
    if (!ALLOWED_DOCUMENT_TYPES.has(parsed.data.contentType)) {
      return NextResponse.json({ error: 'tipo de ficheiro não aceite' }, { status: 415 })
    }
    if (!(await ownsAndAwaitingPayment(profile.id, parsed.data.bookingId))) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    const upload = await documentStore().presignUpload({
      contentType: parsed.data.contentType,
      keyPrefix: parsed.data.bookingId,
    })
    return NextResponse.json(upload)
  }

  const parsed = recordBody.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'bad request' }, { status: 400 })
  if (!(await ownsAndAwaitingPayment(profile.id, parsed.data.bookingId))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  // The object key is issued by presign and must stay inside this
  // booking's prefix, so a tampered client cannot claim someone else's
  // uploaded file as its own proof.
  if (!parsed.data.externalId.startsWith(`${parsed.data.bookingId}/`)) {
    return NextResponse.json({ error: 'bad object key' }, { status: 400 })
  }

  let amountMinor
  try {
    amountMinor = parseMajor(parsed.data.amount)
  } catch {
    return NextResponse.json({ error: 'valor inválido' }, { status: 400 })
  }
  if (amountMinor <= 0n) {
    return NextResponse.json({ error: 'valor inválido' }, { status: 400 })
  }

  const result = await submitPaymentProof(profile.id, {
    bookingId: parsed.data.bookingId,
    amountMinor,
    reference: parsed.data.reference,
    document: {
      externalId: parsed.data.externalId,
      filename: parsed.data.filename,
      contentType: parsed.data.contentType,
      byteSize: parsed.data.byteSize,
    },
  })
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 403 })
  return new NextResponse(null, { status: 204 })
}
