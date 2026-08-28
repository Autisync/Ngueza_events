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


// ---------------------------------------------------------------------
// Reads. RLS (bookings_party_read) already scopes these to bookings the
// caller is a party to — a client sees theirs, a supplier owner sees
// every booking across every business they own. No extra WHERE clause
// duplicates that rule here; the one place it is enforced is the policy.
// ---------------------------------------------------------------------

export interface BookingSummary {
  id: string
  providerId: string
  providerName: string
  providerSlug: string
  clientId: string | null
  clientName: string | null
  clientEmail: string | null
  status: BookingStatus
  startsAt: string
  endsAt: string
  partySize: number | null
  totalMinor: string | null
  createdAt: string
  expiresAt: string | null
}

function toSummary(r: any): BookingSummary {
  return {
    id: r.id, providerId: r.provider_id, providerName: r.provider_name,
    providerSlug: r.provider_slug, clientId: r.client_id,
    clientName: r.client_name, clientEmail: r.client_email,
    status: r.status, startsAt: r.starts_at, endsAt: r.ends_at,
    partySize: r.party_size, totalMinor: r.total_minor,
    createdAt: r.created_at, expiresAt: r.expires_at,
  }
}

/** "As minhas reservas" — everything a signed-in client has requested,
 *  across every supplier. */
export async function clientBookings(clientId: string): Promise<BookingSummary[]> {
  return asUser(clientId, async (c) => {
    const { rows } = await c.query<any>(
      `select b.*, p.name as provider_name, p.slug as provider_slug,
              null as client_name, null as client_email
         from bookings b
         join providers p on p.id = b.provider_id
        where b.client_id = $1
        order by b.created_at desc`,
      [clientId],
    )
    return rows.map(toSummary)
  })
}

/** Every booking across every resource for one business a supplier owns.
 *  RLS already refuses this for a provider the caller does not own; the
 *  WHERE clause here is what NARROWS an owner's other businesses out of
 *  the list, not what authorises it. */
export async function providerBookings(
  ownerId: string, providerId: string,
): Promise<BookingSummary[]> {
  return asUser(ownerId, async (c) => {
    const { rows } = await c.query<any>(
      `select b.*, p.name as provider_name, p.slug as provider_slug,
              pr.full_name as client_name, pr.email as client_email
         from bookings b
         join providers p on p.id = b.provider_id
         left join profiles pr on pr.id = b.client_id
        where b.provider_id = $1
        order by
          case b.status when 'requested' then 0 else 1 end,
          b.starts_at`,
      [providerId],
    )
    return rows.map(toSummary)
  })
}

export interface BookingDetail extends BookingSummary {
  resourceId: string | null
  resourceName: string | null
  serviceId: string | null
  serviceName: string | null
  notes: string | null
  policySnapshot: Record<string, unknown> | null
  history: Array<{ fromStatus: string | null; toStatus: string; createdAt: string }>
}

/** One booking, with the transition history both parties are entitled
 *  to see (§38) — never returns someone else's booking, indistinguishable
 *  from it not existing, for the same reason transition() does. */
export async function bookingDetail(actorId: string, bookingId: string): Promise<BookingDetail | null> {
  return asUser(actorId, async (c) => {
    const { rows } = await c.query<any>(
      `select b.*, p.name as provider_name, p.slug as provider_slug,
              pr.full_name as client_name, pr.email as client_email,
              r.name as resource_name, s.name as service_name
         from bookings b
         join providers p on p.id = b.provider_id
         left join profiles pr on pr.id = b.client_id
         left join resources r on r.id = b.resource_id
         left join services s on s.id = b.service_id
        where b.id = $1`,
      [bookingId],
    )
    const row = rows[0]
    if (!row) return null

    const history = await c.query<{ from_status: string | null; to_status: string; created_at: string }>(
      `select from_status, to_status, created_at from booking_events
        where booking_id = $1 order by id`,
      [bookingId],
    )

    return {
      ...toSummary(row),
      resourceId: row.resource_id, resourceName: row.resource_name,
      serviceId: row.service_id, serviceName: row.service_name,
      notes: row.notes, policySnapshot: row.policy_snapshot,
      history: history.rows.map((h) => ({
        fromStatus: h.from_status, toStatus: h.to_status, createdAt: h.created_at,
      })),
    }
  })
}
