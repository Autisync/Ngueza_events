// Server-only. Records which version of each legal document a person
// accepted.
import 'server-only'

import type { PoolClient } from 'pg'
import { asSystem } from '@/lib/db'

/**
 * Legal hooks (slice 41, 0042). The wording is NGUEZA's; this records,
 * for any version of it, who accepted which version, when and where.
 */
export type LegalKind = 'terms' | 'privacy' | 'cancellation'

/**
 * Within a transaction already running as the person (asUser) — so RLS
 * checks they accept only for themselves, and only versions in force.
 */
export async function recordAcceptance(
  c: PoolClient, profileId: string, kinds: LegalKind[], context: 'signup' | 'booking', bookingId?: string,
): Promise<void> {
  await c.query(
    `insert into legal_acceptances (profile_id, document_id, context, booking_id)
     select $1, id, $3, $4 from legal_current where kind = any($2::text[])`,
    [profileId, kinds, context, bookingId ?? null],
  )
}

/**
 * At sign-up the person has no session yet when the address still needs
 * confirming, so this writes as the system — for the account Supabase
 * Auth has just created, and only after the action checked the box.
 */
export async function recordSignupAcceptance(profileId: string): Promise<void> {
  await asSystem(async (c) => {
    const exists = await c.query(`select 1 from profiles where id = $1`, [profileId])
    if (exists.rowCount === 0) return
    await c.query(
      `insert into legal_acceptances (profile_id, document_id, context)
       select $1, id, 'signup' from legal_current where kind in ('terms', 'privacy')`,
      [profileId],
    )
  })
}
