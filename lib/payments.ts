// Server-only. Importing this from a client component is a BUILD
// ERROR, not a code-review question. Writes payment submissions and
// their proof-of-payment attachments.
import 'server-only'

import { asUser, isInsufficientPrivilege } from '@/lib/db'
import { documentStore } from '@/lib/media'
import type { Minor } from '@/lib/money'

/**
 * The manual_proof adapter (§28, §29) — the only one v1 ships.
 *
 * NGUEZA never receives, holds or forwards money. The client pays the
 * supplier directly, by whatever means they already use, and uploads
 * evidence of it here. This file records that claim and its attachment;
 * it does not move anything and does not decide anything — confirming or
 * rejecting a submission is an administrator's call, made in lib/admin.ts,
 * the same separation §25 already draws for supplier verification.
 *
 * "manual_proof without the proof" is refused by the database
 * (payments_client_submit, 0025), not re-checked here.
 */

export interface ProofDocument {
  externalId: string
  filename?: string
  contentType?: string
  byteSize?: number
}

export interface SubmitPaymentInput {
  bookingId: string
  amountMinor: Minor
  reference?: string
  document: ProofDocument
}

export type SubmitOutcome =
  | { ok: true; paymentId: string }
  | { ok: false; reason: 'not_allowed' }

/**
 * A client submitting proof of a payment they made off-platform. Both
 * rows land in one transaction — asUser wraps every call in BEGIN/COMMIT
 * — so a booking that isn't actually awaiting payment refuses the whole
 * submission rather than leaving an orphaned upload record behind.
 */
export async function submitPaymentProof(
  clientId: string,
  input: SubmitPaymentInput,
): Promise<SubmitOutcome> {
  try {
    const paymentId = await asUser(clientId, async (c) => {
      const { rows: docRows } = await c.query<{ id: string }>(
        `insert into payment_documents
           (booking_id, uploaded_by, external_id, original_filename, content_type, byte_size)
         values ($1, $2, $3, $4, $5, $6)
         returning id`,
        [
          input.bookingId, clientId, input.document.externalId,
          input.document.filename ?? null, input.document.contentType ?? null,
          input.document.byteSize ?? null,
        ],
      )
      const documentId = docRows[0]!.id

      const { rows: payRows } = await c.query<{ id: string }>(
        `insert into payments
           (booking_id, provider_key, status, amount_minor, currency, reference, proof_document_id)
         values ($1, 'manual_proof', 'submitted', $2, 'AOA', $3, $4)
         returning id`,
        [input.bookingId, input.amountMinor.toString(), input.reference ?? null, documentId],
      )
      return payRows[0]!.id
    })
    return { ok: true, paymentId }
  } catch (error) {
    if (isInsufficientPrivilege(error)) return { ok: false, reason: 'not_allowed' }
    throw error
  }
}

export type PaymentStatus = 'pending' | 'submitted' | 'confirmed' | 'failed' | 'refunded'

export interface PaymentSummary {
  id: string
  status: PaymentStatus
  amountMinor: string
  currency: string
  reference: string | null
  createdAt: string
  confirmedAt: string | null
  hasDocument: boolean
  documentId: string | null
}

/** Every submission on one booking, for either party — RLS
 *  (payments_party_read) is what actually scopes this: the client sees
 *  their own, the supplier sees those on their bookings (slice 31). */
export async function bookingPayments(actorId: string, bookingId: string): Promise<PaymentSummary[]> {
  return asUser(actorId, async (c) => {
    const { rows } = await c.query<any>(
      `select id, status, amount_minor, currency, reference, created_at, confirmed_at,
              proof_document_id is not null as has_document, proof_document_id
         from payments
        where booking_id = $1
        order by created_at desc`,
      [bookingId],
    )
    return rows.map((r: any) => ({
      id: r.id, status: r.status, amountMinor: r.amount_minor, currency: r.currency,
      reference: r.reference, createdAt: r.created_at, confirmedAt: r.confirmed_at,
      hasDocument: r.has_document, documentId: r.proof_document_id,
    }))
  })
}

/**
 * What has been declared against a booking's total: every submission not
 * rejected. "Declared", not "paid" — NGUEZA never sees the money; the
 * supplier confirming the booking is what says it arrived.
 */
export function paymentProgress(totalMinor: string | null, payments: PaymentSummary[]): {
  declaredMinor: bigint
  remainingMinor: bigint | null
} {
  const declaredMinor = payments
    .filter((p) => p.status === 'submitted' || p.status === 'confirmed')
    .reduce((sum, p) => sum + BigInt(p.amountMinor), 0n)
  const remainingMinor = totalMinor === null ? null
    : (BigInt(totalMinor) > declaredMinor ? BigInt(totalMinor) - declaredMinor : 0n)
  return { declaredMinor, remainingMinor }
}

/**
 * A short-lived link to one proof-of-payment file, for whoever RLS lets
 * read its row: the client who uploaded it, the booking's supplier, an
 * administrator. Anyone else gets null — the same answer as "no such
 * document", on purpose.
 */
export async function proofDocumentUrl(actorId: string, documentId: string): Promise<string | null> {
  const externalId = await asUser(actorId, async (c) => {
    const { rows } = await c.query<{ external_id: string }>(
      `select external_id from payment_documents where id = $1`, [documentId])
    return rows[0]?.external_id ?? null
  })
  if (!externalId) return null
  return documentStore().presignRead(externalId, 180)
}
