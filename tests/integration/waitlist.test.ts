import { readFile, rm } from 'node:fs/promises'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { asSystem } from '@/lib/db'
import { confirm, subscribe, unsubscribe } from '@/lib/newsletter'

/**
 * Slice 00.5 acceptance criteria, asserted against a real database and a
 * real outbox. These are the statements in spec/slices/00.5-waitlist.md.
 */

const OUTBOX = '.outbox/test-mail.jsonl'

async function outbox(): Promise<Array<{ to: string; text: string; kind: string; from: string }>> {
  try {
    const raw = await readFile(OUTBOX, 'utf8')
    return raw.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  } catch {
    return []
  }
}

function linkFrom(text: string, path: string): string {
  const match = text.match(new RegExp(`/${path}/([a-f0-9]{48})`))
  if (!match?.[1]) throw new Error(`no ${path} link in: ${text}`)
  return match[1]
}

const row = (email: string) =>
  asSystem(async (c) => {
    const { rows } = await c.query(
      `select id, status, interests, source, confirm_token, unsubscribe_token,
              confirmed_at, unsubscribed_at
         from newsletter_subscribers where email = $1`,
      [email],
    )
    return rows[0] ?? null
  })

const consentEvents = (subscriberId: string) =>
  asSystem(async (c) => {
    const { rows } = await c.query(
      `select action, consent_text, source_url from newsletter_consent_events
        where subscriber_id = $1 order by created_at, id`,
      [subscriberId],
    )
    return rows
  })

const base = {
  audience: 'client' as const,
  categories: [],
  locations: [],
  source: 'waitlist' as const,
  consent: true as const,
}

beforeAll(() => {
  process.env.MAIL_OUTBOX = OUTBOX
})

beforeEach(async () => {
  await rm(OUTBOX, { force: true })
  await asSystem((c) => c.query(`delete from newsletter_subscribers where email like '%@teste.ao'`))
})

afterAll(async () => {
  await rm(OUTBOX, { force: true })
  await asSystem((c) => c.query(`delete from newsletter_subscribers where email like '%@teste.ao'`))
})

describe('waitlist', () => {
  it('1. creates a pending row and a consent event carrying the exact wording', async () => {
    await subscribe({ ...base, email: 'a@teste.ao' }, { ip: '41.223.0.1', url: '/' })

    const r = await row('a@teste.ao')
    expect(r.status).toBe('pending')
    expect(r.source).toBe('waitlist')

    const events = await consentEvents(r.id)
    expect(events).toHaveLength(1)
    expect(events[0]!.action).toBe('subscribed')
    expect(events[0]!.consent_text).toContain('Aceito receber novidades da NGUEZA')
    expect(events[0]!.source_url).toBe('/')
  })

  it('2. sends nothing but the confirmation until the link is followed', async () => {
    await subscribe({ ...base, email: 'b@teste.ao' }, {})
    const sent = await outbox()
    expect(sent).toHaveLength(1)
    expect(sent[0]!.to).toBe('b@teste.ao')
    expect(sent[0]!.text).toContain('/confirmar/')
    // Marketing identity, separate from booking mail.
    expect(sent[0]!.kind).toBe('marketing')
  })

  it('3. confirming stamps the row and writes a confirmed event', async () => {
    await subscribe({ ...base, email: 'c@teste.ao' }, {})
    const token = linkFrom((await outbox())[0]!.text, 'confirmar')

    expect(await confirm(token)).toBe('confirmed')

    const r = await row('c@teste.ao')
    expect(r.status).toBe('confirmed')
    expect(r.confirmed_at).not.toBeNull()
    expect((await consentEvents(r.id)).map((e) => e.action)).toEqual(['subscribed', 'confirmed'])
  })

  it('4. confirming twice is idempotent — no duplicate event, no error', async () => {
    await subscribe({ ...base, email: 'd@teste.ao' }, {})
    const token = linkFrom((await outbox())[0]!.text, 'confirmar')

    expect(await confirm(token)).toBe('confirmed')
    expect(await confirm(token)).toBe('confirmed')

    const r = await row('d@teste.ao')
    expect((await consentEvents(r.id)).filter((e) => e.action === 'confirmed')).toHaveLength(1)
  })

  it('5. a duplicate address creates no second row and reveals nothing', async () => {
    await subscribe({ ...base, email: 'e@teste.ao' }, {})
    const token = linkFrom((await outbox())[0]!.text, 'confirmar')
    await confirm(token)

    // Resolves identically to a fresh signup — the caller cannot tell.
    await expect(subscribe({ ...base, email: 'e@teste.ao' }, {})).resolves.toBeUndefined()

    const count = await asSystem(async (c) => {
      const { rows } = await c.query(
        `select count(*)::int as n from newsletter_subscribers where email = $1`,
        ['e@teste.ao'],
      )
      return rows[0]!.n
    })
    expect(count).toBe(1)

    // And a confirmed address is not mailed again.
    expect(await outbox()).toHaveLength(1)
  })

  it('5b. a pending address gets its confirmation resent', async () => {
    await subscribe({ ...base, email: 'f@teste.ao' }, {})
    await subscribe({ ...base, email: 'f@teste.ao' }, {})

    const sent = await outbox()
    expect(sent).toHaveLength(2)

    // The newest link is the one that works.
    const token = linkFrom(sent[1]!.text, 'confirmar')
    expect(await confirm(token)).toBe('confirmed')
  })

  it('6. unsubscribe works from the token alone, with no sign-in', async () => {
    await subscribe({ ...base, email: 'g@teste.ao' }, {})
    await confirm(linkFrom((await outbox())[0]!.text, 'confirmar'))

    const r = await row('g@teste.ao')
    expect(await unsubscribe(r.unsubscribe_token)).toBe('unsubscribed')

    const after = await row('g@teste.ao')
    expect(after.status).toBe('unsubscribed')
    expect(after.unsubscribed_at).not.toBeNull()
    expect((await consentEvents(r.id)).map((e) => e.action))
      .toEqual(['subscribed', 'confirmed', 'unsubscribed'])
  })

  it('7. interests are stored as ids, so the digest can join on them', async () => {
    const { categoryId, locationId } = await asSystem(async (c) => {
      const cat = await c.query(`select id from categories where slug = 'saloes-de-festas'`)
      const loc = await c.query(`select id from locations where slug = 'talatona'`)
      return { categoryId: cat.rows[0]!.id, locationId: loc.rows[0]!.id }
    })

    await subscribe(
      { ...base, email: 'h@teste.ao', categories: [categoryId], locations: [locationId], eventMonth: '2026-12' },
      {},
    )

    const r = await row('h@teste.ao')
    expect(r.interests.categories).toEqual([categoryId])
    expect(r.interests.locations).toEqual([locationId])
    expect(r.interests.event_month).toBe('2026-12')

    // The join the monthly "New in Talatona" digest will actually run.
    const digestAudience = () =>
      asSystem(async (c) => {
        const { rows } = await c.query<{ email: string }>(
          `select s.email from newsletter_sendable s
             where s.interests -> 'locations' ? $1`,
          [locationId],
        )
        return rows.map((r) => r.email)
      })

    // Interests match, but consent is not confirmed — so no mail.
    expect(await digestAudience()).not.toContain('h@teste.ao')

    await confirm(linkFrom((await outbox())[0]!.text, 'confirmar'))

    expect(await digestAudience()).toContain('h@teste.ao')
  })

  it('8. an unconfirmed address is never in the sendable audience', async () => {
    await subscribe({ ...base, email: 'i@teste.ao' }, {})
    const before = await asSystem(async (c) => {
      const { rows } = await c.query(`select 1 from newsletter_sendable where email = $1`, ['i@teste.ao'])
      return rows.length
    })
    expect(before).toBe(0)

    await confirm(linkFrom((await outbox())[0]!.text, 'confirmar'))

    const after = await asSystem(async (c) => {
      const { rows } = await c.query(`select 1 from newsletter_sendable where email = $1`, ['i@teste.ao'])
      return rows.length
    })
    expect(after).toBe(1)
  })

  it('9. an unknown token fails safely rather than throwing', async () => {
    expect(await confirm('0'.repeat(48))).toBe('unknown')
    expect(await unsubscribe('0'.repeat(48))).toBe('unknown')
  })
})
