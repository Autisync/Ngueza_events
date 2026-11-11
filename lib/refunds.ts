import { asUser } from '@/lib/db'
import type { Minor } from '@/lib/money'

/**
 * Refunds between a supplier and a client (0045, slice 47, review R013).
 *
 * NGUEZA never holds or moves money (CLAUDE.md, "Never automate"). This
 * only records what each party says happened: the supplier "devolvi X
 * por este meio", the client "recebi" or "não recebi". Who owed what is
 * not decided here.
 */

export type RefundMethod = 'transferencia' | 'multicaixa_express' | 'numerario' | 'outro'
export const REFUND_METHODS: Record<RefundMethod, string> = {
  transferencia: 'Transferência bancária',
  multicaixa_express: 'Multicaixa Express',
  numerario: 'Numerário',
  outro: 'Outro meio',
}

/** The same, mid-sentence ("devolveu X por …"); brand names keep their capitals. */
export const REFUND_METHOD_PHRASE: Record<RefundMethod, string> = {
  transferencia: 'transferência bancária',
  multicaixa_express: 'Multicaixa Express',
  numerario: 'numerário',
  outro: 'outro meio',
}

export interface RefundAttestation {
  id: string
  amountMinor: Minor
  method: RefundMethod
  reference: string | null
  createdAt: string
  clientResponse: 'received' | 'disputed' | null
  clientNote: string | null
  respondedAt: string | null
}

/** Both parties and admins see a booking's refunds (RLS). */
export async function refundsFor(userId: string, bookingId: string): Promise<RefundAttestation[]> {
  return asUser(userId, async (c) => {
    const { rows } = await c.query<{
      id: string; amount_minor: string; method: RefundMethod; reference: string | null; created_at: Date
      client_response: 'received' | 'disputed' | null; client_note: string | null; responded_at: Date | null
    }>(
      `select id::text, amount_minor::text, method, reference, created_at, client_response, client_note, responded_at
         from refund_attestations where booking_id = $1 order by created_at`,
      [bookingId],
    )
    return rows.map((r) => ({
      id: r.id, amountMinor: BigInt(r.amount_minor), method: r.method, reference: r.reference,
      createdAt: r.created_at.toISOString(), clientResponse: r.client_response, clientNote: r.client_note,
      respondedAt: r.responded_at?.toISOString() ?? null,
    }))
  })
}

const refused = (error: unknown) => (error as { code?: string })?.code === '42501'

/** The supplier states a refund on a cancelled booking of theirs. The
 *  database checks the booking is theirs and cancelled. No RETURNING:
 *  a write that reads needs a SELECT policy, and failing quietly beats a
 *  misleading error (CLAUDE.md). */
export async function attestRefund(
  ownerId: string, bookingId: string,
  input: { amountMinor: Minor; method: RefundMethod; reference?: string | null },
): Promise<'ok' | 'not_allowed'> {
  try {
    await asUser(ownerId, (c) =>
      c.query(
        `insert into refund_attestations (booking_id, amount_minor, method, reference)
         values ($1, $2, $3, $4)`,
        [bookingId, input.amountMinor.toString(), input.method, input.reference?.trim() || null],
      ),
    )
    return 'ok'
  } catch (error) {
    if (refused(error)) return 'not_allowed'
    throw error
  }
}

/** The client answers, once. */
export async function answerRefund(
  clientId: string, attestationId: string, response: 'received' | 'disputed', note?: string | null,
): Promise<'ok' | 'not_allowed'> {
  try {
    const { rowCount } = await asUser(clientId, (c) =>
      c.query(
        `update refund_attestations set client_response = $2, client_note = $3 where id = $1`,
        [attestationId, response, note?.trim() || null],
      ),
    )
    return rowCount ? 'ok' : 'not_allowed'
  } catch (error) {
    if (refused(error)) return 'not_allowed'
    throw error
  }
}
