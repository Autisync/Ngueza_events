// Server-only. Importing this from a client component is a BUILD
// ERROR, not a code-review question. Reads and writes quote requests
// and the offers on them.
import 'server-only'

import { asSystem, asUser, isCheckViolation, isInsufficientPrivilege } from '@/lib/db'
import type { Minor } from '@/lib/money'
import { isUuid } from '@/lib/safe'

/**
 * Quote requests (slice 20) — a client describes what they need once;
 * every matching, verified, published supplier is notified and may
 * respond with a priced offer. See spec/slices/20-quote-requests.md.
 *
 * RLS (0027) is what actually enforces who may see or do what here —
 * `quote_requests_matching_supplier_read`, `quote_offers_supplier_
 * insert`, the two guard triggers. This file translates the database's
 * answer; it does not re-implement any of that bound.
 */

export interface QuoteRequest {
  id: string
  clientId: string
  categoryId: string
  categoryName: string
  locationId: string
  locationName: string
  eventDate: string | null
  capacity: number | null
  description: string
  status: 'open' | 'closed' | 'expired'
  createdAt: string
  expiresAt: string
  offerCount: number
}

export interface QuoteOffer {
  id: string
  quoteRequestId: string
  providerId: string
  providerName: string
  providerSlug: string
  priceMinor: Minor
  message: string | null
  status: 'submitted' | 'withdrawn' | 'accepted' | 'declined'
  createdAt: string
}

function toQuoteRequest(r: any): QuoteRequest {
  return {
    id: r.id,
    clientId: r.client_id,
    categoryId: r.category_id,
    categoryName: r.category_name,
    locationId: r.location_id,
    locationName: r.location_name,
    eventDate: r.event_date,
    capacity: r.capacity,
    description: r.description,
    status: r.status,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    offerCount: Number(r.offer_count ?? 0),
  }
}

function toQuoteOffer(r: any): QuoteOffer {
  return {
    id: r.id,
    quoteRequestId: r.quote_request_id,
    providerId: r.provider_id,
    providerName: r.provider_name,
    providerSlug: r.provider_slug,
    priceMinor: BigInt(r.price_minor),
    message: r.message,
    status: r.status,
    createdAt: r.created_at,
  }
}

const REQUEST_SELECT = `
  select qr.*, cat.name as category_name, loc.name as location_name,
         (select count(*) from quote_offers qo
           where qo.quote_request_id = qr.id and qo.status = 'submitted') as offer_count
    from quote_requests qr
    join categories cat on cat.id = qr.category_id
    join locations  loc on loc.id = qr.location_id
`

export type PostQuoteRequestOutcome = { ok: true; id: string } | { ok: false; reason: 'invalid' }

export async function postQuoteRequest(
  clientId: string,
  input: {
    categoryId: string
    locationId: string
    description: string
    eventDate?: string
    capacity?: number
  },
): Promise<PostQuoteRequestOutcome> {
  try {
    const id = await asUser(clientId, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `insert into quote_requests (client_id, category_id, location_id, description, event_date, capacity)
         values ($1, $2, $3, $4, $5, $6)
         returning id`,
        [
          clientId, input.categoryId, input.locationId, input.description,
          input.eventDate ?? null, input.capacity ?? null,
        ],
      )
      return rows[0]!.id
    })
    return { ok: true, id }
  } catch (error) {
    if (isCheckViolation(error)) return { ok: false, reason: 'invalid' }
    throw error
  }
}

/** The requester's own requests, newest first, with how many live offers each has. */
export async function myQuoteRequests(clientId: string): Promise<QuoteRequest[]> {
  return asUser(clientId, async (c) => {
    const { rows } = await c.query<any>(
      `${REQUEST_SELECT} where qr.client_id = $1 order by qr.created_at desc`,
      [clientId],
    )
    return rows.map(toQuoteRequest)
  })
}

/** One of the requester's own requests, or null if it isn't theirs (or doesn't exist). */
export async function quoteRequestDetail(actorId: string, id: string): Promise<QuoteRequest | null> {
  return asUser(actorId, async (c) => {
    const { rows } = await c.query<any>(`${REQUEST_SELECT} where qr.id = $1`, [id])
    return rows[0] ? toQuoteRequest(rows[0]) : null
  })
}

/** Every offer on a request. RLS decides what this actually returns:
 *  the requester sees all of them, a supplier sees only their own. */
export async function offersOnRequest(actorId: string, quoteRequestId: string): Promise<QuoteOffer[]> {
  return asUser(actorId, async (c) => {
    const { rows } = await c.query<any>(
      `select qo.*, p.name as provider_name, p.slug as provider_slug
         from quote_offers qo
         join providers p on p.id = qo.provider_id
        where qo.quote_request_id = $1
        order by qo.created_at`,
      [quoteRequestId],
    )
    return rows.map(toQuoteOffer)
  })
}

export type CloseQuoteRequestOutcome = { ok: true } | { ok: false; reason: 'forbidden' }

export async function closeQuoteRequest(
  clientId: string,
  quoteRequestId: string,
): Promise<CloseQuoteRequestOutcome> {
  try {
    await asUser(clientId, (c) =>
      c.query(
        `update quote_requests set status = 'closed', closed_at = now() where id = $1`,
        [quoteRequestId],
      ),
    )
    return { ok: true }
  } catch (error) {
    if (isInsufficientPrivilege(error)) return { ok: false, reason: 'forbidden' }
    throw error
  }
}

// ---------------------------------------------------------------------
// The supplier side
// ---------------------------------------------------------------------

/** Open requests this supplier's own provider matches — verified,
 *  published, category and location within the request's trees
 *  (`quote_requests_matching_supplier_read`, 0027) — that they have not
 *  already offered on. */
export async function matchingOpenRequests(ownerId: string, providerId: string): Promise<QuoteRequest[]> {
  return asUser(ownerId, async (c) => {
    const { rows } = await c.query<any>(
      `${REQUEST_SELECT}
        where qr.status = 'open' and qr.expires_at > now()
          -- Scoped to THIS provider: the read policy only checks that the
          -- viewer owns some matching provider, so an owner of two
          -- businesses saw each one's requests in the other's inbox.
          and quote_request_open_and_matches(qr.id, $1)
          and not exists (
            select 1 from quote_offers qo
             where qo.quote_request_id = qr.id and qo.provider_id = $1 and qo.status = 'submitted'
          )
        order by qr.created_at desc`,
      [providerId],
    )
    return rows.map(toQuoteRequest)
  })
}

/** This provider's own offers, across every request. */
export async function offersBySupplier(ownerId: string, providerId: string): Promise<QuoteOffer[]> {
  return asUser(ownerId, async (c) => {
    const { rows } = await c.query<any>(
      `select qo.*, p.name as provider_name, p.slug as provider_slug
         from quote_offers qo
         join providers p on p.id = qo.provider_id
        where qo.provider_id = $1
        order by qo.created_at desc`,
      [providerId],
    )
    return rows.map(toQuoteOffer)
  })
}

export type SubmitOfferOutcome =
  | { ok: true; id: string }
  | { ok: false; reason: 'not_open_or_not_matching' | 'already_offered' | 'invalid' }

export async function submitOffer(
  ownerId: string,
  input: { quoteRequestId: string; providerId: string; priceMinor: Minor; message?: string },
): Promise<SubmitOfferOutcome> {
  try {
    const id = await asUser(ownerId, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `insert into quote_offers (quote_request_id, provider_id, price_minor, message)
         values ($1, $2, $3, $4)
         returning id`,
        [input.quoteRequestId, input.providerId, input.priceMinor.toString(), input.message ?? null],
      )
      return rows[0]!.id
    })
    return { ok: true, id }
  } catch (error) {
    // RLS refuses the insert outright (42501) when the request is not
    // open or this provider does not match it — quote_offers_supplier_
    // insert (0027) is the single definition of "matches".
    if (isInsufficientPrivilege(error)) return { ok: false, reason: 'not_open_or_not_matching' }
    if (isCheckViolation(error)) return { ok: false, reason: 'invalid' }
    // The partial unique index (one live offer per supplier per request).
    if (error instanceof Error && 'code' in error && (error as { code?: string }).code === '23505') {
      return { ok: false, reason: 'already_offered' }
    }
    throw error
  }
}

export type WithdrawOfferOutcome = { ok: true } | { ok: false; reason: 'forbidden' }

export async function withdrawOffer(ownerId: string, offerId: string): Promise<WithdrawOfferOutcome> {
  try {
    await asUser(ownerId, (c) =>
      c.query(`update quote_offers set status = 'withdrawn' where id = $1`, [offerId]),
    )
    return { ok: true }
  } catch (error) {
    if (isInsufficientPrivilege(error)) return { ok: false, reason: 'forbidden' }
    throw error
  }
}

export type AcceptOfferOutcome =
  | { ok: true; providerSlug: string }
  | { ok: false; reason: 'forbidden' }

/**
 * The requester taking one live offer: it becomes 'accepted', every
 * other still-live offer on the same request becomes 'declined' (0030 —
 * it used to read 'withdrawn', which made a losing supplier look as if
 * they had pulled out), and the request itself closes. The request row
 * is locked first, so two concurrent accepts on one request cannot both
 * win, and an expired or already-closed request accepts nothing.
 *
 * Deliberately does not create a booking. See 0029's own migration
 * comment: a quote request never captured which specific resource or
 * service the offer was for, so this records the decision and sends
 * the client to the supplier's own booking flow with that decision
 * already made, rather than guessing.
 */
export async function acceptOffer(clientId: string, offerId: string): Promise<AcceptOfferOutcome> {
  if (!isUuid(offerId)) return { ok: false, reason: 'forbidden' }
  try {
    const slug = await asUser(clientId, async (c) => {
      const { rows } = await c.query<{ quote_request_id: string; slug: string }>(
        `select qo.quote_request_id, p.slug
           from quote_offers qo
           join quote_requests qr on qr.id = qo.quote_request_id
           join providers p on p.id = qo.provider_id
          where qo.id = $1 and qo.status = 'submitted'
            and qr.status = 'open' and qr.expires_at > now()
            for update of qr`,
        [offerId],
      )
      const row = rows[0]
      if (!row) return null

      const won = await c.query(
        `update quote_offers set status = 'accepted'
          where id = $1 and status = 'submitted' returning id`,
        [offerId],
      )
      if (won.rowCount !== 1) return null
      await c.query(
        `update quote_offers set status = 'declined'
          where quote_request_id = $1 and status = 'submitted'`,
        [row.quote_request_id],
      )
      await c.query(
        `update quote_requests set status = 'closed', closed_at = now() where id = $1`,
        [row.quote_request_id],
      )
      return row.slug
    })
    return slug ? { ok: true, providerSlug: slug } : { ok: false, reason: 'forbidden' }
  } catch (error) {
    if (isInsufficientPrivilege(error)) return { ok: false, reason: 'forbidden' }
    throw error
  }
}

/**
 * The price of an offer the viewer accepted from this supplier, for the
 * "Proposta aceite" note on the supplier page. Read from the database,
 * never from the URL: the page used to print whatever `?proposta=` said
 * inside a green confirmation banner, which is a ready-made "pay this
 * reference" scam on NGUEZA's own domain.
 */
export async function acceptedOfferPrice(
  viewerId: string, offerId: string, providerId: string,
): Promise<bigint | null> {
  if (!isUuid(offerId) || !isUuid(providerId)) return null
  return asUser(viewerId, async (c) => {
    const { rows } = await c.query<{ price_minor: string }>(
      `select qo.price_minor
         from quote_offers qo join quote_requests qr on qr.id = qo.quote_request_id
        where qo.id = $1 and qo.provider_id = $2 and qo.status = 'accepted'
          and qr.client_id = $3`,
      [offerId, providerId, viewerId],
    )
    return rows[0] ? BigInt(rows[0].price_minor) : null
  })
}

/** Closes open requests past their own deadline or event date. Run by the
 *  /api/cron/expire sweep; returns how many it closed. */
export async function expireStaleQuoteRequests(): Promise<number> {
  return asSystem(async (c) => {
    const { rows } = await c.query<{ n: number }>(`select expire_stale_quote_requests() as n`)
    return rows[0]!.n
  })
}
