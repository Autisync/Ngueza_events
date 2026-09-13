// Server-only. Importing this from a client component is a BUILD
// ERROR, not a code-review question. Reads and writes cancellation
// policies, and computes what a cancellation is worth.
import 'server-only'

import { asUser, isCheckViolation } from '@/lib/db'

/**
 * The cancellation & refund policy engine (Phase Two, slice 19).
 *
 * "Engine" is a precise word here, not a grand one: `compute_refund_pct`
 * (0026) is the whole of it, a pure function of a booking's own frozen
 * `policy_snapshot` and how much real notice a cancellation gave. This
 * file is thin on purpose — the bound on what a supplier may set lives
 * in the database (`cancellation_tiers_valid`, 0026), and the actual
 * percentage a cancelled booking earned is a database function too, so
 * a future report can call it directly without reimplementing the math.
 *
 * This computes and displays an entitlement. It does not pay anyone —
 * NGUEZA never receives, holds or moves money at any point in this
 * system (§28), so a refund itself is still a conversation between the
 * client and the supplier, the same as the payment was.
 */

export interface PolicyTier {
  daysBefore: number
  refundPct: number
}

export interface CancellationPolicy {
  id: string
  providerId: string | null
  name: string
  tiers: PolicyTier[]
  notes: string | null
}

function toTiers(raw: any): PolicyTier[] {
  return (raw ?? []).map((t: any) => ({
    daysBefore: Number(t.days_before),
    refundPct: Number(t.refund_pct),
  }))
}

function toPolicy(r: any): CancellationPolicy {
  return {
    id: r.id, providerId: r.provider_id, name: r.name,
    tiers: toTiers(r.tiers), notes: r.notes,
  }
}

/** The policy actually in force for this supplier right now — their own
 *  if they have set one, otherwise the platform default. RLS
 *  (`policies_public_read`) is what makes the platform default (a null
 *  `provider_id`, world-readable) visible alongside their own. */
export async function activePolicy(actorId: string, providerId: string): Promise<CancellationPolicy | null> {
  return asUser(actorId, async (c) => {
    const { rows } = await c.query<any>(
      `select * from cancellation_policies
        where is_active and (provider_id = $1 or provider_id is null)
        order by provider_id nulls last
        limit 1`,
      [providerId],
    )
    return rows[0] ? toPolicy(rows[0]) : null
  })
}

/** Only this supplier's own custom policy, or null if they have never
 *  set one and are simply running on the platform default. Distinct
 *  from `activePolicy()` — the supplier's own settings screen needs to
 *  know which of those two cases it's showing. */
export async function ownPolicy(ownerId: string, providerId: string): Promise<CancellationPolicy | null> {
  return asUser(ownerId, async (c) => {
    const { rows } = await c.query<any>(
      `select * from cancellation_policies where is_active and provider_id = $1`,
      [providerId],
    )
    return rows[0] ? toPolicy(rows[0]) : null
  })
}

export type SetPolicyOutcome = { ok: true } | { ok: false; reason: 'invalid_tiers' }

/**
 * Create or replace this supplier's own policy. The bound is enforced
 * by the database (`cancellation_tiers_valid`, 0026) — 1 to 5 tiers,
 * percentages 0-100, and more notice may never earn a worse refund than
 * less. This function does not re-check any of that; it translates the
 * database's answer.
 *
 * Upserts on the one-active-policy-per-supplier unique index (0026), so
 * editing a policy updates it in place rather than accumulating rows —
 * existing bookings are unaffected either way, because they hold their
 * own frozen snapshot from the moment they were made.
 */
export async function setOwnPolicy(
  ownerId: string,
  providerId: string,
  input: { name: string; tiers: PolicyTier[]; notes?: string },
): Promise<SetPolicyOutcome> {
  const tiersJson = JSON.stringify(
    input.tiers.map((t) => ({ days_before: t.daysBefore, refund_pct: t.refundPct })),
  )
  try {
    await asUser(ownerId, (c) =>
      c.query(
        `insert into cancellation_policies (provider_id, name, tiers, notes, is_active)
         values ($1, $2, $3::jsonb, $4, true)
         on conflict (provider_id) where is_active and provider_id is not null
         do update set name = excluded.name, tiers = excluded.tiers,
                        notes = excluded.notes, updated_at = now()`,
        [providerId, input.name, tiersJson, input.notes ?? null],
      ),
    )
    return { ok: true }
  } catch (error) {
    if (isCheckViolation(error)) return { ok: false, reason: 'invalid_tiers' }
    throw error
  }
}

export interface RefundEntitlement {
  policyName: string
  tiers: PolicyTier[]
  refundPct: number
  /** true once the booking has actually been cancelled — the number is
   *  then final, computed from the real cancellation moment
   *  (`booking_events.created_at`), not from `now()`. false means this
   *  is a live preview: "if you cancelled today, this is what you'd get." */
  isFinal: boolean
  decidedAt: string | null
}

/**
 * What a booking's own frozen policy is worth, right now or as of the
 * moment it was actually cancelled. RLS (`bookings_party_read`) already
 * scopes which bookings this actor may ask about at all.
 */
export async function refundEntitlement(actorId: string, bookingId: string): Promise<RefundEntitlement | null> {
  return asUser(actorId, async (c) => {
    const { rows } = await c.query<any>(
      `select policy_snapshot, starts_at, status from bookings where id = $1`,
      [bookingId],
    )
    const booking = rows[0]
    if (!booking || !booking.policy_snapshot) return null

    const isCancelled = booking.status === 'cancelled_client' || booking.status === 'cancelled_provider'
    let decidedAt: string | null = null

    if (isCancelled) {
      const { rows: eventRows } = await c.query<{ created_at: string }>(
        `select created_at from booking_events
          where booking_id = $1 and to_status = $2
          order by created_at desc limit 1`,
        [bookingId, booking.status],
      )
      decidedAt = eventRows[0]?.created_at ?? null
    }

    const { rows: pctRows } = await c.query<{ pct: number }>(
      `select compute_refund_pct($1, $2, $3) as pct`,
      [JSON.stringify(booking.policy_snapshot.tiers), booking.starts_at, decidedAt ?? new Date().toISOString()],
    )

    return {
      policyName: booking.policy_snapshot.name,
      tiers: toTiers(booking.policy_snapshot.tiers),
      refundPct: pctRows[0]!.pct,
      isFinal: isCancelled,
      decidedAt,
    }
  })
}
