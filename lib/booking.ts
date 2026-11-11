// Server-only. Importing this from a client component is a BUILD
// ERROR, not a code-review question. Writes bookings and runs the expiry job.
import 'server-only'

import { asSystem, asUser, isCheckViolation, isInsufficientPrivilege, isSlotTaken } from '@/lib/db'
import { isUuid } from '@/lib/safe'
import type { Minor } from '@/lib/money'

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
  | 'no_show' | 'blocked' | 'unavailable'

export interface BookingRequest {
  providerId: string
  resourceId?: string | null
  serviceId?: string | null
  startsAt: Date
  endsAt: Date
  partySize?: number
  notes?: string
  sessionId?: string | null
  /** E.164. Saved to the client's profile in the same transaction as the
   *  request, so the supplier can reach them once they accept (0034). */
  clientPhone?: string | null
}

export type RequestOutcome =
  | { ok: true; bookingId: string }
  | { ok: false; reason: 'slot_taken' | 'not_allowed' | 'invalid' | 'paused' }

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

      if (input.clientPhone) {
        await c.query(
          `update profiles set phone = $2 where id = $1 and phone is distinct from $2`,
          [clientId, input.clientPhone],
        )
      }

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
    // The kill switch (0039): new requests are paused platform-wide.
    if ((error as { code?: string }).code === '55000') return { ok: false, reason: 'paused' }
    // RLS refusing the row (0031): a past date, the supplier's own
    // listing, or a supplier that is not public.
    if (isInsufficientPrivilege(error)) return { ok: false, reason: 'not_allowed' }
    if (isCheckViolation(error)) return { ok: false, reason: 'invalid' }
    throw error
  }
}

export type TransitionOutcome =
  | { ok: true }
  | { ok: false; reason: 'slot_taken' | 'illegal_transition' | 'not_found' | 'not_allowed' | 'terms_required' | 'invalid_terms' }

/** What the supplier sets when asking for payment (0035). Written in the
 *  same UPDATE as the transition — the only moment the database allows it. */
export interface PaymentTerms {
  totalMinor: Minor
  depositMinor?: Minor | null
  instructions?: string | null
}

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
  terms?: PaymentTerms,
): Promise<TransitionOutcome> {
  try {
    const changed = await asUser(actorId, async (c) => {
      const result = terms
        ? await c.query(
            `update bookings
                set status = $2, total_minor = $3, deposit_minor = $4, payment_instructions = $5
              where id = $1`,
            [
              bookingId, to, terms.totalMinor.toString(),
              terms.depositMinor == null ? null : terms.depositMinor.toString(),
              terms.instructions?.trim() || null,
            ],
          )
        : await c.query(`update bookings set status = $2 where id = $1`, [bookingId, to])
      return result.rowCount ?? 0
    })
    // Zero rows means RLS hid it or it does not exist — indistinguishable
    // on purpose, so this cannot be used to probe for other people's
    // bookings.
    return changed === 0 ? { ok: false, reason: 'not_found' } : { ok: true }
  } catch (error) {
    if (isSlotTaken(error)) return { ok: false, reason: 'slot_taken' }
    if (isInsufficientPrivilege(error)) return { ok: false, reason: 'not_allowed' }
    const e = error as { constraint?: string; message?: string }
    if (isCheckViolation(error) && e.message?.includes('needs the agreed total')) {
      return { ok: false, reason: 'terms_required' }
    }
    if (isCheckViolation(error) && e.constraint === 'bookings_deposit_within_total') {
      return { ok: false, reason: 'invalid_terms' }
    }
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
    if (isInsufficientPrivilege(error)) return { ok: false, reason: 'not_allowed' }
    if (isCheckViolation(error)) return { ok: false, reason: 'invalid' }
    throw error
  }
}

/**
 * §26: a pending request must never hold a date indefinitely. Runs every
 * five minutes; returns how many dates it released.
 */
/** Moves confirmed bookings to completed a day after they end (0031), so
 *  verified reviews and supplier health no longer wait on the supplier
 *  to click "concluída". */
export async function completePastBookings(): Promise<number> {
  return asSystem(async (c) => {
    const { rows } = await c.query<{ n: number }>(`select complete_past_bookings() as n`)
    return rows[0]!.n
  })
}

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

/** The instructions this supplier gave on their last payment request,
 *  to prefill the next one — nobody should retype an IBAN per booking. */
export async function lastPaymentInstructions(ownerId: string, providerId: string): Promise<string | null> {
  return asUser(ownerId, async (c) => {
    const { rows } = await c.query<{ payment_instructions: string }>(
      `select payment_instructions from bookings
        where provider_id = $1 and payment_instructions is not null
        order by updated_at desc limit 1`,
      [providerId],
    )
    return rows[0]?.payment_instructions ?? null
  })
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
      // A supplier cannot read client profiles (profiles_self_read), so
      // the name — and the email once accepted — come from 0034's
      // booking_client_contact(), which answers only for their bookings.
      `select b.*, p.name as provider_name, p.slug as provider_slug,
              cc.full_name as client_name, cc.email as client_email
         from bookings b
         join providers p on p.id = b.provider_id
         left join lateral booking_client_contact(b.id) cc on true
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
  /** The client's phone: their own to the client, the supplier's to see
   *  only once they have accepted (0034). */
  clientPhone: string | null
  /** For the supplier: whether the client's email and phone are visible yet. */
  contactShared: boolean | null
  providerPhone: string | null
  providerWhatsapp: string | null
  /** Where the event is: the supplier's street address and município. */
  providerAddress: string | null
  providerZone: string | null
  /** The sinal and how to pay, set by the supplier when asking for payment (0035). */
  depositMinor: string | null
  paymentInstructions: string | null
  /** For "find another on the same date" when a date is lost (0033). */
  providerCategoryId: string
  providerLocationId: string
  history: Array<{ fromStatus: string | null; toStatus: string; createdAt: string }>
}

/** One booking, with the transition history both parties are entitled
 *  to see (§38) — never returns someone else's booking, indistinguishable
 *  from it not existing, for the same reason transition() does. */
export async function bookingDetail(actorId: string, bookingId: string): Promise<BookingDetail | null> {
  if (!isUuid(bookingId)) return null
  return asUser(actorId, async (c) => {
    const { rows } = await c.query<any>(
      // pr: the client reading their own booking, or an admin.
      // cc: the supplier, through booking_client_contact() (0034).
      `select b.*, p.name as provider_name, p.slug as provider_slug,
              p.category_id as provider_category_id, p.location_id as provider_location_id,
              p.phone as provider_phone, p.whatsapp as provider_whatsapp,
              p.address_line as provider_address,
              (select l.name from locations l where l.id = p.location_id) as provider_zone,
              coalesce(pr.full_name, cc.full_name) as client_name,
              coalesce(pr.email, cc.email) as client_email,
              coalesce(pr.phone, cc.phone) as client_phone,
              cc.contact_shared,
              r.name as resource_name, s.name as service_name
         from bookings b
         join providers p on p.id = b.provider_id
         left join profiles pr on pr.id = b.client_id
         left join lateral booking_client_contact(b.id) cc on true
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
      providerCategoryId: row.provider_category_id, providerLocationId: row.provider_location_id,
      clientPhone: row.client_phone, contactShared: row.contact_shared ?? null,
      providerPhone: row.provider_phone, providerWhatsapp: row.provider_whatsapp,
      depositMinor: row.deposit_minor, paymentInstructions: row.payment_instructions,
      providerAddress: row.provider_address, providerZone: row.provider_zone,
      history: history.rows.map((h) => ({
        fromStatus: h.from_status, toStatus: h.to_status, createdAt: h.created_at,
      })),
    }
  })
}
