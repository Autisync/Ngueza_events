import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createReview, providerReviews, replyToReview, reviewExistsForBooking } from '@/lib/reviews'
import { asSystem } from '@/lib/db'

/**
 * Reviews (§14, §30). The verified seal, the one-per-booking rule and the
 * supplier-reply boundary are all enforced by the database (0007, 0022);
 * these assert the application layer surfaces them correctly.
 */

const HORIZONTE = '50000000-0000-0000-0000-000000000001'
const PALMEIRAS = '50000000-0000-0000-0000-000000000002'
const SALAO = '60000000-0000-0000-0000-000000000001'
const OWNER = '40000000-0000-0000-0000-000000000001'
const OTHER_OWNER = '40000000-0000-0000-0000-000000000002'
const ANA = '40000000-0000-0000-0000-000000000090'
const JOAO = '40000000-0000-0000-0000-000000000091'

// A completed booking for Ana, and an unrelated confirmed-but-not-completed
// one for João — fixtures inserted directly, the same way
// tests/integration/booking.test.ts seeds its own confirmed booking,
// because the review tests need bookings in states the transition state
// machine does not let anyone walk to directly from nothing.
const COMPLETED = '81000000-0000-0000-0000-000000000001'
const NOT_COMPLETED = '81000000-0000-0000-0000-000000000002'
const SOMEONE_ELSES = '81000000-0000-0000-0000-000000000003'

const clean = () =>
  asSystem(async (c) => {
    await c.query('truncate booking_events, reviews, bookings cascade')
    // Integration files share a database — restore both seeded bookings
    // search.test.ts and provider tests assert against, the same
    // convention tests/integration/booking.test.ts documents and follows,
    // plus this file's own review fixtures.
    await c.query(
      `insert into bookings (id, provider_id, client_id, resource_id, status, starts_at, ends_at)
       values ('80000000-0000-0000-0000-000000000001',
               '50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000090',
               '60000000-0000-0000-0000-000000000001', 'confirmed',
               '2026-12-15 10:00+01', '2026-12-15 23:59+01')`,
    )
    await c.query(
      `insert into bookings (id, provider_id, client_id, resource_id, status, starts_at, ends_at)
       values ('80000000-0000-0000-0000-000000000002',
               '50000000-0000-0000-0000-000000000002', null,
               '60000000-0000-0000-0000-000000000002', 'blocked',
               '2026-12-20 08:00+01', '2026-12-21 02:00+01')`,
    )
    await c.query(
      `insert into bookings (id, provider_id, client_id, resource_id, status, starts_at, ends_at)
       values
        ($1, $4, $6, $3, 'completed', '2026-01-10 10:00+01', '2026-01-10 23:59+01'),
        ($2, $4, $7, $3, 'confirmed', '2026-02-10 10:00+01', '2026-02-10 23:59+01'),
        ($5, $4, $7, $3, 'completed', '2026-03-10 10:00+01', '2026-03-10 23:59+01')`,
      [COMPLETED, NOT_COMPLETED, SALAO, HORIZONTE, SOMEONE_ELSES, ANA, JOAO],
    )
  })

beforeEach(clean)
afterEach(clean)

describe('reviews', () => {
  it('marks a review verified when it carries the client\'s own completed booking', async () => {
    const result = await createReview(ANA, {
      providerId: HORIZONTE, bookingId: COMPLETED,
      ratings: { overall: 5, quality: 5, service: 4 },
      comment: 'Excelente espaço, recomendo.',
    })
    expect(result.ok).toBe(true)

    const [review] = await providerReviews(HORIZONTE)
    expect(review?.isVerified).toBe(true)
    expect(review?.ratingOverall).toBe(5)
    expect(review?.ratingQuality).toBe(5)
    expect(review?.ratingPunctuality).toBeNull()
  })

  it('derives unverified rather than rejecting, for a booking that never completed', async () => {
    // Nothing in this app's own UI offers the review form before a
    // booking reaches 'completed' — this proves the database's own
    // derivation is what actually holds the line, not that screen.
    const result = await createReview(JOAO, {
      providerId: HORIZONTE, bookingId: NOT_COMPLETED,
      ratings: { overall: 3 },
    })
    expect(result.ok).toBe(true)
    const [review] = await providerReviews(HORIZONTE)
    expect(review?.isVerified).toBe(false)
  })

  it('derives unverified for a booking that belongs to someone else', async () => {
    // The FK only requires the booking to exist, not that the caller was
    // its client — RLS lets Ana insert with author_id = herself
    // regardless of whose booking_id she names. reviews_derive_verified
    // is what actually checks b.client_id = author_id.
    const result = await createReview(ANA, {
      providerId: HORIZONTE, bookingId: SOMEONE_ELSES, // João's completed booking
      ratings: { overall: 5 },
    })
    expect(result.ok).toBe(true)
    const reviews = await providerReviews(HORIZONTE)
    const mine = reviews.find((r) => r.comment === null && r.ratingOverall === 5)
    expect(mine?.isVerified).toBe(false)
  })

  it('refuses a second review on the same booking', async () => {
    const first = await createReview(ANA, {
      providerId: HORIZONTE, bookingId: COMPLETED, ratings: { overall: 4 },
    })
    expect(first.ok).toBe(true)
    const second = await createReview(ANA, {
      providerId: HORIZONTE, bookingId: COMPLETED, ratings: { overall: 2 },
    })
    expect(second).toEqual({ ok: false, reason: 'already_reviewed' })
  })

  it('reviewExistsForBooking reflects that rule before the form even renders', async () => {
    expect(await reviewExistsForBooking(ANA, COMPLETED)).toBe(false)
    await createReview(ANA, { providerId: HORIZONTE, bookingId: COMPLETED, ratings: { overall: 4 } })
    expect(await reviewExistsForBooking(ANA, COMPLETED)).toBe(true)
  })

  it('sorts verified reviews first, then newest first within each group', async () => {
    await createReview(ANA, { providerId: HORIZONTE, bookingId: COMPLETED, ratings: { overall: 5 } })
    await createReview(JOAO, { providerId: HORIZONTE, bookingId: NOT_COMPLETED, ratings: { overall: 1 } })
    const reviews = await providerReviews(HORIZONTE)
    expect(reviews[0]?.isVerified).toBe(true)
    expect(reviews[1]?.isVerified).toBe(false)
  })

  it('shows a public, privacy-safe author name — first name and a last initial', async () => {
    await createReview(ANA, { providerId: HORIZONTE, bookingId: COMPLETED, ratings: { overall: 5 } })
    const [review] = await providerReviews(HORIZONTE)
    // Seed data: ana.cliente@exemplo.ao's full_name has more than one word.
    expect(review?.authorName).toMatch(/^\S+ \S\.$/)
  })

  it('lets the business owner reply, and the reply is public', async () => {
    await createReview(ANA, { providerId: HORIZONTE, bookingId: COMPLETED, ratings: { overall: 4 } })
    const [review] = await providerReviews(HORIZONTE)
    const outcome = await replyToReview(OWNER, review!.id, 'Obrigado pela visita!')
    expect(outcome).toEqual({ ok: true })

    const [after] = await providerReviews(HORIZONTE)
    expect(after?.providerReply).toBe('Obrigado pela visita!')
    expect(after?.providerRepliedAt).not.toBeNull()
    // The reply changed nothing else about the review.
    expect(after?.ratingOverall).toBe(4)
  })

  it('hides someone else\'s review from an unrelated supplier — not_found, not a permission error', async () => {
    await createReview(ANA, { providerId: HORIZONTE, bookingId: COMPLETED, ratings: { overall: 4 } })
    const [review] = await providerReviews(HORIZONTE)
    // OTHER_OWNER owns Palmeiras, not Horizonte.
    const outcome = await replyToReview(OTHER_OWNER, review!.id, 'não é meu')
    expect(outcome).toEqual({ ok: false, reason: 'not_found' })

    const [unchanged] = await providerReviews(HORIZONTE)
    expect(unchanged?.providerReply).toBeNull()
  })

  it('never shows a hidden review on the public page', async () => {
    const result = await createReview(ANA, {
      providerId: HORIZONTE, bookingId: COMPLETED, ratings: { overall: 1 }, comment: 'spam',
    })
    if (!result.ok) throw new Error('setup failed')
    await asSystem((c) => c.query(`update reviews set status = 'hidden' where id = $1`, [result.reviewId]))
    expect(await providerReviews(HORIZONTE)).toHaveLength(0)
  })

  it('scopes reviews to their own provider', async () => {
    await createReview(ANA, { providerId: HORIZONTE, bookingId: COMPLETED, ratings: { overall: 5 } })
    expect(await providerReviews(PALMEIRAS)).toHaveLength(0)
  })
})
