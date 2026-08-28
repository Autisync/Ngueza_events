// Server-only. Importing this from a client component is a BUILD
// ERROR, not a code-review question. Writes and reads reviews.
import 'server-only'

import { asUser, asVisitor, isAlreadyExists } from '@/lib/db'

/**
 * Reviews (§14, §30).
 *
 * The "Avaliação de Reserva Verificada" seal is derived, not asserted —
 * reviews_derive_verified() (0007) sets is_verified from the booking it
 * carries, every time, so this layer cannot get it wrong by forgetting a
 * check. This app only ever offers the review form from a client's own
 * completed booking (`/reservas/[id]`), so every review it creates ends
 * up verified; the schema still allows an unlinked review for whatever
 * uses this table later, this layer just doesn't expose that path yet.
 *
 * A supplier's reply is scoped by reviews_supplier_reply (0022) — RLS,
 * not this file, is what stops them touching anything but the reply.
 */

export interface Ratings {
  overall: number
  quality?: number
  service?: number
  punctuality?: number
  cleanliness?: number
  value?: number
}

export interface NewReview {
  providerId: string
  bookingId: string
  ratings: Ratings
  comment?: string
}

export type CreateOutcome =
  | { ok: true; reviewId: string }
  | { ok: false; reason: 'already_reviewed' }

/** A client reviewing their own completed booking. `bookingId` is
 *  required here — see the module comment for why. */
export async function createReview(authorId: string, input: NewReview): Promise<CreateOutcome> {
  try {
    const reviewId = await asUser(authorId, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `insert into reviews
           (provider_id, author_id, booking_id, rating_overall, rating_quality,
            rating_service, rating_punctuality, rating_cleanliness, rating_value, comment)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         returning id`,
        [
          input.providerId, authorId, input.bookingId, input.ratings.overall,
          input.ratings.quality ?? null, input.ratings.service ?? null,
          input.ratings.punctuality ?? null, input.ratings.cleanliness ?? null,
          input.ratings.value ?? null, input.comment ?? null,
        ],
      )
      return rows[0]!.id
    })
    return { ok: true, reviewId }
  } catch (error) {
    // reviews_one_per_booking_idx — one review per booking, ever.
    if (isAlreadyExists(error)) return { ok: false, reason: 'already_reviewed' }
    throw error
  }
}

export type ReplyOutcome = { ok: true } | { ok: false; reason: 'not_found' }

/** A supplier's right of reply. Zero rows means RLS hid it — either a
 *  review on a business this actor does not own, or one that does not
 *  exist — indistinguishable on purpose, the same convention
 *  lib/booking.ts's transition() uses for the same reason. */
export async function replyToReview(
  ownerId: string, reviewId: string, reply: string,
): Promise<ReplyOutcome> {
  const changed = await asUser(ownerId, async (c) => {
    const result = await c.query(
      `update reviews set provider_reply = $2, provider_replied_at = now() where id = $1`,
      [reviewId, reply],
    )
    return result.rowCount ?? 0
  })
  return changed === 0 ? { ok: false, reason: 'not_found' } : { ok: true }
}

export interface PublicReview {
  id: string
  authorName: string
  isVerified: boolean
  ratingOverall: number
  ratingQuality: number | null
  ratingService: number | null
  ratingPunctuality: number | null
  ratingCleanliness: number | null
  ratingValue: number | null
  comment: string | null
  providerReply: string | null
  providerRepliedAt: string | null
  createdAt: string
}

function toPublicReview(r: any): PublicReview {
  return {
    id: r.id,
    authorName: r.author_name,
    isVerified: r.is_verified,
    ratingOverall: r.rating_overall,
    ratingQuality: r.rating_quality,
    ratingService: r.rating_service,
    ratingPunctuality: r.rating_punctuality,
    ratingCleanliness: r.rating_cleanliness,
    ratingValue: r.rating_value,
    comment: r.comment,
    providerReply: r.provider_reply,
    providerRepliedAt: r.provider_replied_at,
    createdAt: r.created_at,
  }
}

/** Every published review for a provider's public page. Verified ones
 *  first, then newest first — the seal is the point, so it sorts to the
 *  top rather than getting lost among unverified ones. */
export async function providerReviews(providerId: string): Promise<PublicReview[]> {
  return asVisitor(async (c) => {
    const { rows } = await c.query<any>(
      `select r.*, review_display_name(r.author_id) as author_name
         from reviews r
        where r.provider_id = $1 and r.status = 'published'
        order by r.is_verified desc, r.created_at desc`,
      [providerId],
    )
    return rows.map(toPublicReview)
  })
}

/** Whether this booking already has a review — governs whether
 *  `/reservas/[id]` offers the "leave a review" form at all. */
export async function reviewExistsForBooking(actorId: string, bookingId: string): Promise<boolean> {
  return asUser(actorId, async (c) => {
    const { rows } = await c.query(`select 1 from reviews where booking_id = $1`, [bookingId])
    return rows.length > 0
  })
}
