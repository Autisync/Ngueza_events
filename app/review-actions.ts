'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { requireProfile } from '@/lib/auth'
import { createReview, replyToReview } from '@/lib/reviews'

/**
 * Review actions (§14, §30) — plain server actions, JavaScript optional,
 * matching every other screen in this codebase.
 */

const star = z.coerce.number().int().min(1).max(5)

const reviewForm = z.object({
  providerId: z.string().uuid(),
  bookingId: z.string().uuid(),
  ratingOverall: star,
  ratingQuality: star.optional(),
  ratingService: star.optional(),
  ratingPunctuality: star.optional(),
  ratingCleanliness: star.optional(),
  ratingValue: star.optional(),
  comment: z.string().max(2000).optional(),
})

const str = (f: FormData, k: string) => {
  const v = String(f.get(k) ?? '').trim()
  return v === '' ? undefined : v
}

/** Only ever reached from a client's own completed booking
 *  (`/reservas/[id]`) — see lib/reviews.ts's module comment for why that
 *  is enough to guarantee the "Reserva Verificada" seal without this
 *  action asserting it itself. */
export async function doLeaveReview(formData: FormData): Promise<void> {
  const profile = await requireProfile()
  const bookingId = String(formData.get('bookingId') ?? '')
  const parsed = reviewForm.safeParse({
    providerId: str(formData, 'providerId'),
    bookingId,
    ratingOverall: str(formData, 'ratingOverall'),
    ratingQuality: str(formData, 'ratingQuality'),
    ratingService: str(formData, 'ratingService'),
    ratingPunctuality: str(formData, 'ratingPunctuality'),
    ratingCleanliness: str(formData, 'ratingCleanliness'),
    ratingValue: str(formData, 'ratingValue'),
    comment: str(formData, 'comment'),
  })
  if (!parsed.success) redirect(`/reservas/${bookingId}?erro=dados`)

  const result = await createReview(profile.id, {
    providerId: parsed.data.providerId,
    bookingId: parsed.data.bookingId,
    ratings: {
      overall: parsed.data.ratingOverall,
      quality: parsed.data.ratingQuality,
      service: parsed.data.ratingService,
      punctuality: parsed.data.ratingPunctuality,
      cleanliness: parsed.data.ratingCleanliness,
      value: parsed.data.ratingValue,
    },
    comment: parsed.data.comment,
  })
  redirect(
    result.ok
      ? `/reservas/${bookingId}?avaliado=1`
      : `/reservas/${bookingId}?erro=${result.reason}`,
  )
}

const replyForm = z.object({
  reviewId: z.string().uuid(),
  providerId: z.string().uuid(),
  reply: z.string().trim().min(1).max(2000),
})

export async function doReplyToReview(formData: FormData): Promise<void> {
  const profile = await requireProfile()
  const providerId = String(formData.get('providerId') ?? '')
  const parsed = replyForm.safeParse({
    reviewId: str(formData, 'reviewId'),
    providerId,
    reply: str(formData, 'reply'),
  })
  if (!parsed.success) redirect(`/painel/${providerId}/avaliacoes?erro=dados`)

  const result = await replyToReview(profile.id, parsed.data.reviewId, parsed.data.reply)
  redirect(
    result.ok
      ? `/painel/${providerId}/avaliacoes?feito=1`
      : `/painel/${providerId}/avaliacoes?erro=${result.reason}`,
  )
}
