// Server-only. Importing this from a client component is a BUILD
// ERROR, not a code-review question. Writes bookings and runs the expiry job.
import 'server-only'

import { asSystem, asUser, isCheckViolation, isInsufficientPrivilege, isSlotTaken } from '@/lib/db'

/**
 * The booking loop (§10, §26, §27).
 *
 * Almost nothing here is business logic. The state machine, the expiry
 * deadlines, the double-booking constraint and the audit trail all live in
 * the database, so this layer is mostly about turning a constraint
 * violation into something a person can read.
 */

export type BookingStatus =
  | 'requested' | 'accepted' | 'awaiting_payment' | 'confirmed' | 'completed'
  | 'expired' | 'rejected' | 'cancelled_client' | 'cancelled_provider'
  | 'no_show' | 'blocked'

export interface BookingRequest {
  providerId: string
  resourceId?: string | null
  serviceId?: string | null
  startsAt: Date
  endsAt: Date
  partySize?: number
  notes?: string
  sessionId?: string | null
}

export type RequestOutcome =
  | { ok: true; bookingId: string }
  | { ok: false; reason: 'slot_taken' }

/**
 * A client asks for a date.
 *
 * The availability check is the INSERT itself. Reading "is this free?" and
 * then writing is a race — two clients both read free, both insert — so the
 * database refuses the second one and we report the clash. Never re-check
 * first and treat the answer as authoritative.
 */
export async function requestBooking(
  clientId: string,
  input: BookingRequest,
): Promise<RequestOutcome> {
  // A courtesy check, not the guarantee. A pending request deliberately
  // does not hold a date (§26), so the constraint would happily accept a
  // request for a date that is already confirmed — the client would only
  // discover it when the supplier could never confirm. Rejecting early
  // saves both of them the trip.
  //
  // This read can race; that is fine, because the INSERT below is still
  // the only thing that decides. Never treat this answer as authoritative.
  if (input.resourceId) {
    const free = await asUser(clientId, async (c) => {
      const { rows } = await c.query<{ free: boolean }>(
        `select resource_is_free($1, $2::timestamptz, $3::timestamptz) as free`,
        [input.resourceId, input.startsAt.toISOString(), input.endsAt.toISOString()],
      )
      return rows[0]!.free
    })
    if (!free) return { ok: false, reason: 'slot_taken' }
  }

  try {
    const bookingId = await asUser(clientId, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `insert into bookings
           (provider_id, client_id, resource_id, service_id, status,
            starts_at, ends_at, party_size, notes, policy_snapshot)
         values ($1, $2, $3, $4, 'requested', $5, $6, $7, $8,
                 (select to_jsonb(cp) from cancellation_policies cp
                   where cp.is_active
                     and (cp.provider_id = $1 or cp.provider_id is null)
                   order by cp.provider_id nulls last
                   limit 1))
         returning id`,
        [
          input.providerId,
          clientId,
          input.resourceId ?? null,
          input.serviceId ?? null,
          input.startsAt.toISOString(),
          input.endsAt.toISOString(),
          input.partySize ?? null,
          input.notes ?? null,
        ],
      )
      const id = rows[0]!.id

      // The denominator of the §32 leakage ratio. Written in the same
      // transaction as the booking, so the two can never disagree.
      await c.query(
        `insert into events (name, session_id, profile_id, provider_id, props)
         values ('booking_requested', $1, $2, $3, $4)`,
        [
          input.sessionId ?? null,
          clientId,
          input.providerId,
          { party_size: input.partySize ?? null, has_resource: Boolean(input.resourceId) },
        ],
      )
      return id
    })
    return { ok: true, bookingId }
  } catch (error) {
    // 23P01 covers both paths: the exclusion constraint for venues and the
    // concurrency trigger for services. One code path, both supplier types.
    if (isSlotTaken(error)) return { ok: false, reason: 'slot_taken' }
    throw error
  }
}

export type TransitionOutcome =
  | { ok: true }
  | { ok: false; reason: 'slot_taken' | 'illegal_transition' | 'not_found' | 'not_allowed' }

/**
 * Move a booking along. The database refuses anything the state machine
 * does not permit (illegal_transition), and, separately, refuses a legal
 * transition attempted by the wrong party (not_allowed) — a client
 * cannot self-accept their own request, only a supplier or admin can
 * (0021). Neither guarantee can drift from spec/states.md, because
 * neither lives in this file.
 */
export async function transition(
  actorId: string,
  bookingId: string,
  to: BookingStatus,
): Promise<TransitionOutcome> {
  try {
    const changed = await asUser(actorId, async (c) => {
      const result = await c.query(`update bookings set status = $2 where id = $1`, [bookingId, to])
      return result.rowCount ?? 0
    })
    // Zero rows means RLS hid it or it does not exist — indistinguishable
    // on purpose, so this cannot be used to probe for other people's
    // bookings.
    return changed === 0 ? { ok: false, reason: 'not_found' } : { ok: true }
  } catch (error) {
    if (isSlotTaken(error)) return { ok: false, reason: 'slot_taken' }
    if (isInsufficientPrivilege(error)) return { ok: false, reason: 'not_allowed' }
    if (isCheckViolation(error)) return { ok: false, reason: 'illegal_transition' }
    throw error
  }
}

/**
 * A supplier blocking a date they filled in person (§27). Modelled as a
 * booking so it collides with platform bookings through the very same
 * constraint — there is no second code path that could disagree.
 */
export async function blockDate(
  providerOwnerId: string,
  input: { providerId: string; resourceId: string; startsAt: Date; endsAt: Date },
): Promise<RequestOutcome> {
  try {
    const bookingId = await asUser(providerOwnerId, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `insert into bookings (provider_id, resource_id, status, starts_at, ends_at)
         values ($1, $2, 'blocked', $3, $4) returning id`,
        [input.providerId, input.resourceId, input.startsAt.toISOString(), input.endsAt.toISOString()],
      )
      return rows[0]!.id
    })
    return { ok: true, bookingId }
  } catch (error) {
    if (isSlotTaken(error)) return { ok: false, reason: 'slot_taken' }
    throw error
  }
}

/**
 * §26: a pending request must never hold a date indefinitely. Runs every
 * five minutes; returns how many dates it released.
 */
export async function expireStaleBookings(): Promise<number> {
  return asSystem(async (c) => {
    const { rows } = await c.query<{ expired: number }>(`select expire_stale_bookings() as expired`)
    return rows[0]!.expired
  })
}
