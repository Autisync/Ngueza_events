import { Client } from 'pg'
import { afterEach, describe, expect, it } from 'vitest'
import { asSystem } from '@/lib/db'
import { myNotifications, myUnreadNotificationCount, markNotificationRead } from '@/lib/notifications'
import {
  acceptOffer, acceptedOfferPrice, closeQuoteRequest, expireStaleQuoteRequests, matchingOpenRequests, myQuoteRequests, offersBySupplier,
  offersOnRequest, postQuoteRequest, quoteRequestDetail, submitOffer, withdrawOffer,
} from '@/lib/quotes'

/**
 * Slice 20 — the application layer over 0027's schema and RLS. The
 * database assertions (tests/sql/03_quote_requests.sql) already prove
 * the security bound; these prove the TypeScript wrappers this app
 * actually calls talk to it correctly — right columns, right params,
 * right shape back.
 */

const HORIZONTE = '50000000-0000-0000-0000-000000000001'
const OWNER = '40000000-0000-0000-0000-000000000001' // owns Horizonte — verified, published
const ANA = '40000000-0000-0000-0000-000000000090'
const SALOES = '20000000-0000-0000-0000-000000000010' // Horizonte's own category
const TALATONA = '10000000-0000-0000-0000-000000000010' // Horizonte's own location

const clean = () =>
  asSystem(async (c) => {
    await c.query(`delete from quote_requests where client_id = $1`, [ANA])
  })

afterEach(clean)

describe('posting and matching', () => {
  it('a matching, verified, published supplier sees a request the requester posted', async () => {
    const posted = await postQuoteRequest(ANA, {
      categoryId: SALOES, locationId: TALATONA,
      description: 'Preciso de um espaço para 80 pessoas em Dezembro.',
      capacity: 80,
    })
    if (!posted.ok) throw new Error('post failed')

    const mine = await myQuoteRequests(ANA)
    expect(mine.some((r) => r.id === posted.id)).toBe(true)
    expect(mine.find((r) => r.id === posted.id)?.status).toBe('open')

    const matching = await matchingOpenRequests(OWNER, HORIZONTE)
    expect(matching.some((r) => r.id === posted.id)).toBe(true)
  })

  it('notifies the matching supplier by enqueueing quote_request_new', async () => {
    const posted = await postQuoteRequest(ANA, {
      categoryId: SALOES, locationId: TALATONA, description: 'Um evento em Talatona.',
    })
    if (!posted.ok) throw new Error('post failed')

    const before = await myUnreadNotificationCount(OWNER)
    // The notification was already enqueued by the same insert above —
    // this just proves it reached the recipient's own in-app list.
    expect(before).toBeGreaterThan(0)
    const notes = await myNotifications(OWNER, 5)
    const mine = notes.find((n) => n.kind === 'quote_request_new')
    expect(mine).toBeTruthy()
    expect(mine!.readAt).toBeNull()

    await markNotificationRead(OWNER, mine!.id)
    const after = await myNotifications(OWNER, 5)
    expect(after.find((n) => n.id === mine!.id)?.readAt).not.toBeNull()
  })
})

describe('offering and being notified', () => {
  it('the requester sees the offer and is notified of it', async () => {
    const posted = await postQuoteRequest(ANA, {
      categoryId: SALOES, locationId: TALATONA, description: 'Um evento em Talatona.',
    })
    if (!posted.ok) throw new Error('post failed')

    const offer = await submitOffer(OWNER, {
      quoteRequestId: posted.id, providerId: HORIZONTE,
      priceMinor: 45_000_00n, message: 'Temos disponibilidade nessa data.',
    })
    if (!offer.ok) throw new Error('offer failed')

    const offers = await offersOnRequest(ANA, posted.id)
    expect(offers).toHaveLength(1)
    expect(offers[0]!.priceMinor).toBe(45_000_00n)
    expect(offers[0]!.providerName).toBe('Salão Horizonte')

    const detail = await quoteRequestDetail(ANA, posted.id)
    expect(detail?.offerCount).toBe(1)

    const notes = await myNotifications(ANA, 5)
    expect(notes.some((n) => n.kind === 'quote_offer_received')).toBe(true)

    const bySupplier = await offersBySupplier(OWNER, HORIZONTE)
    expect(bySupplier.some((o) => o.id === offer.id)).toBe(true)
  })

  it('refuses a second live offer from the same supplier on the same request', async () => {
    const posted = await postQuoteRequest(ANA, {
      categoryId: SALOES, locationId: TALATONA, description: 'Um evento em Talatona.',
    })
    if (!posted.ok) throw new Error('post failed')

    const first = await submitOffer(OWNER, {
      quoteRequestId: posted.id, providerId: HORIZONTE, priceMinor: 40_000_00n,
    })
    expect(first.ok).toBe(true)

    const second = await submitOffer(OWNER, {
      quoteRequestId: posted.id, providerId: HORIZONTE, priceMinor: 42_000_00n,
    })
    expect(second).toEqual({ ok: false, reason: 'already_offered' })
  })

  it('allows re-offering after withdrawing', async () => {
    const posted = await postQuoteRequest(ANA, {
      categoryId: SALOES, locationId: TALATONA, description: 'Um evento em Talatona.',
    })
    if (!posted.ok) throw new Error('post failed')

    const first = await submitOffer(OWNER, {
      quoteRequestId: posted.id, providerId: HORIZONTE, priceMinor: 40_000_00n,
    })
    if (!first.ok) throw new Error('first offer failed')

    const withdrawn = await withdrawOffer(OWNER, first.id)
    expect(withdrawn).toEqual({ ok: true })

    const second = await submitOffer(OWNER, {
      quoteRequestId: posted.id, providerId: HORIZONTE, priceMinor: 42_000_00n,
    })
    expect(second.ok).toBe(true)
  })
})

describe('accepting an offer', () => {
  it('accepting closes the request and marks the offer accepted', async () => {
    const posted = await postQuoteRequest(ANA, {
      categoryId: SALOES, locationId: TALATONA, description: 'Um evento em Talatona.',
    })
    if (!posted.ok) throw new Error('post failed')

    const offer = await submitOffer(OWNER, {
      quoteRequestId: posted.id, providerId: HORIZONTE, priceMinor: 45_000_00n,
    })
    if (!offer.ok) throw new Error('offer failed')

    const result = await acceptOffer(ANA, offer.id)
    // The slug comes from the offer's own row, not the client's form.
    expect(result).toEqual({ ok: true, providerSlug: 'salao-horizonte-talatona' })

    const offers = await offersOnRequest(ANA, posted.id)
    expect(offers.find((o) => o.id === offer.id)?.status).toBe('accepted')

    const detail = await quoteRequestDetail(ANA, posted.id)
    expect(detail?.status).toBe('closed')
  })

  it('refuses to accept an offer that is not this client\'s own request', async () => {
    const posted = await postQuoteRequest(ANA, {
      categoryId: SALOES, locationId: TALATONA, description: 'Um evento em Talatona.',
    })
    if (!posted.ok) throw new Error('post failed')

    const offer = await submitOffer(OWNER, {
      quoteRequestId: posted.id, providerId: HORIZONTE, priceMinor: 45_000_00n,
    })
    if (!offer.ok) throw new Error('offer failed')

    const BYSTANDER = '40000000-0000-0000-0000-000000000091'
    const result = await acceptOffer(BYSTANDER, offer.id)
    expect(result).toEqual({ ok: false, reason: 'forbidden' })
  })

  it('refuses to accept an offer twice', async () => {
    const posted = await postQuoteRequest(ANA, {
      categoryId: SALOES, locationId: TALATONA, description: 'Um evento em Talatona.',
    })
    if (!posted.ok) throw new Error('post failed')

    const offer = await submitOffer(OWNER, {
      quoteRequestId: posted.id, providerId: HORIZONTE, priceMinor: 45_000_00n,
    })
    if (!offer.ok) throw new Error('offer failed')

    const first = await acceptOffer(ANA, offer.id)
    expect(first.ok).toBe(true)

    const second = await acceptOffer(ANA, offer.id)
    expect(second).toEqual({ ok: false, reason: 'forbidden' })
  })
})

describe('after an offer is accepted (0030)', () => {
  it('marks the other live offers declined, not withdrawn', async () => {
    const posted = await postQuoteRequest(ANA, {
      categoryId: SALOES, locationId: TALATONA, description: 'Um evento em Talatona.',
    })
    if (!posted.ok) throw new Error('post failed')
    const winner = await submitOffer(OWNER, {
      quoteRequestId: posted.id, providerId: HORIZONTE, priceMinor: 45_000_00n,
    })
    if (!winner.ok) throw new Error('offer failed')
    const loser = await asSystem(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `insert into quote_offers (quote_request_id, provider_id, price_minor)
         select $1, id, 5000000 from providers where id <> $2 and is_published limit 1
         returning id`,
        [posted.id, HORIZONTE],
      )
      return rows[0]!.id
    })

    expect((await acceptOffer(ANA, winner.id)).ok).toBe(true)
    const offers = await offersOnRequest(ANA, posted.id)
    expect(offers.find((o) => o.id === loser)?.status).toBe('declined')
  })

  it('tells the winning supplier', async () => {
    const posted = await postQuoteRequest(ANA, {
      categoryId: SALOES, locationId: TALATONA, description: 'Um evento em Talatona.',
    })
    if (!posted.ok) throw new Error('post failed')
    const offer = await submitOffer(OWNER, {
      quoteRequestId: posted.id, providerId: HORIZONTE, priceMinor: 45_000_00n,
    })
    if (!offer.ok) throw new Error('offer failed')
    await acceptOffer(ANA, offer.id)

    const queued = await asSystem(async (c) => {
      const { rows } = await c.query<{ recipient_id: string }>(
        `select recipient_id from notification_outbox
          where kind = 'quote_offer_accepted' and source_id = $1`,
        [offer.id],
      )
      return rows
    })
    expect(queued).toEqual([{ recipient_id: OWNER }])
  })

  it('shows the accepted price only to the requester, read from the database', async () => {
    const posted = await postQuoteRequest(ANA, {
      categoryId: SALOES, locationId: TALATONA, description: 'Um evento em Talatona.',
    })
    if (!posted.ok) throw new Error('post failed')
    const offer = await submitOffer(OWNER, {
      quoteRequestId: posted.id, providerId: HORIZONTE, priceMinor: 45_000_00n,
    })
    if (!offer.ok) throw new Error('offer failed')
    expect(await acceptedOfferPrice(ANA, offer.id, HORIZONTE)).toBeNull() // not accepted yet
    await acceptOffer(ANA, offer.id)
    expect(await acceptedOfferPrice(ANA, offer.id, HORIZONTE)).toBe(45_000_00n)
    expect(await acceptedOfferPrice('40000000-0000-0000-0000-000000000091', offer.id, HORIZONTE)).toBeNull()
  })

  it('expires requests past their deadline, and they stop matching', async () => {
    const posted = await postQuoteRequest(ANA, {
      categoryId: SALOES, locationId: TALATONA, description: 'Um evento em Talatona.',
    })
    if (!posted.ok) throw new Error('post failed')
    // expires_at is immutable to everyone but an admin
    // (quote_requests_guard_immutable), so age the fixture as a superuser
    // with triggers off.
    const raw = new Client({ connectionString: process.env.DATABASE_URL })
    await raw.connect()
    try {
      await raw.query(`set session_replication_role = replica`)
      await raw.query(`update quote_requests set expires_at = now() - interval '1 minute' where id = $1`, [posted.id])
    } finally {
      await raw.end()
    }
    expect((await matchingOpenRequests(OWNER, HORIZONTE)).map((r) => r.id)).not.toContain(posted.id)
    expect(await expireStaleQuoteRequests()).toBeGreaterThanOrEqual(1)
    expect((await quoteRequestDetail(ANA, posted.id))?.status).toBe('expired')
  })
})

describe('closing a request', () => {
  it('the requester can close their own request, and it stops matching', async () => {
    const posted = await postQuoteRequest(ANA, {
      categoryId: SALOES, locationId: TALATONA, description: 'Um evento em Talatona.',
    })
    if (!posted.ok) throw new Error('post failed')

    const closed = await closeQuoteRequest(ANA, posted.id)
    expect(closed).toEqual({ ok: true })

    const matching = await matchingOpenRequests(OWNER, HORIZONTE)
    expect(matching.some((r) => r.id === posted.id)).toBe(false)

    const offer = await submitOffer(OWNER, {
      quoteRequestId: posted.id, providerId: HORIZONTE, priceMinor: 40_000_00n,
    })
    expect(offer).toEqual({ ok: false, reason: 'not_open_or_not_matching' })
  })
})
