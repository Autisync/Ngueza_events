// Server-only. Writes and reads support requests.
import 'server-only'

import { z } from 'zod'
import { asUser, asVisitor } from '@/lib/db'

/**
 * The help inbox (slice 35, 0038). Anyone may write — a person locked out
 * of their account most of all. RLS decides the rest: a signed-in person
 * files as themselves, nobody can file as someone else, and only an
 * administrator reads or resolves.
 */

export const TOPICS = {
  reserva: 'Uma reserva',
  pagamento: 'Um pagamento',
  conta: 'A minha conta',
  fornecedor: 'Sou fornecedor',
  fraude: 'Burla ou pedido suspeito',
  outro: 'Outro assunto',
} as const

export type Topic = keyof typeof TOPICS

export const supportInput = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  topic: z.enum(Object.keys(TOPICS) as [Topic, ...Topic[]]),
  // The 8-character reference both sides see on a booking (bookingRef()).
  bookingRef: z.string().trim().regex(/^[0-9a-fA-F]{8}$/).optional(),
  message: z.string().trim().min(10).max(4000),
})
export type SupportInput = z.infer<typeof supportInput>

/** No RETURNING: anon has no SELECT on this table (CLAUDE.md). */
export async function fileSupportRequest(profileId: string | null, input: SupportInput): Promise<void> {
  const write = (c: Parameters<Parameters<typeof asVisitor>[0]>[0]) => c.query(
    `insert into support_requests (profile_id, email, topic, booking_ref, message)
     values ($1, $2, $3, $4, $5)`,
    [profileId, input.email, input.topic, input.bookingRef?.toUpperCase() ?? null, input.message],
  )
  if (profileId) await asUser(profileId, write)
  else await asVisitor(write)
}

export interface SupportRequest {
  id: string
  email: string
  topic: Topic
  bookingRef: string | null
  message: string
  status: 'open' | 'resolved'
  createdAt: string
  resolvedAt: string | null
}

export async function supportQueue(adminId: string, status: 'open' | 'resolved' = 'open'): Promise<SupportRequest[]> {
  return asUser(adminId, async (c) => {
    const { rows } = await c.query<any>(
      `select * from support_requests where status = $1
        order by created_at ${status === 'open' ? 'asc' : 'desc'} limit 100`, [status])
    return rows.map((r) => ({
      id: r.id, email: r.email, topic: r.topic, bookingRef: r.booking_ref, message: r.message,
      status: r.status, createdAt: r.created_at, resolvedAt: r.resolved_at,
    }))
  })
}

export async function resolveSupportRequest(adminId: string, id: string): Promise<boolean> {
  return asUser(adminId, async (c) => {
    const { rowCount } = await c.query(
      `update support_requests set status = 'resolved', resolved_at = now(), resolved_by = $2
        where id = $1 and status = 'open'`, [id, adminId])
    return (rowCount ?? 0) > 0
  })
}
