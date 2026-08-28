import { beforeEach, describe, expect, it } from 'vitest'
import { render } from '@/lib/notify'

/**
 * Pure rendering — no database, no mailer. What lib/notifications.ts
 * calls once it has claimed a row; tested in isolation so the copy can
 * be checked without standing up Postgres.
 */

const BOOKING_CONTEXT = {
  provider_id: 'p1', provider_name: 'Salão Horizonte', provider_slug: 'salao-horizonte',
  starts_at: '2027-04-01T09:00:00Z', ends_at: '2027-04-01T20:00:00Z', from_status: 'requested',
}
const PROVIDER_CONTEXT = {
  provider_id: 'p1', provider_name: 'Salão Horizonte', provider_slug: 'salao-horizonte',
}

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_SITE_URL
  delete process.env.VERCEL_URL
  delete process.env.VERCEL_PROJECT_PRODUCTION_URL
})

describe('booking notifications', () => {
  it('tells the supplier a request arrived, with a link to their dashboard', () => {
    const mail = render('booking_requested', BOOKING_CONTEXT)
    expect(mail.subject).toContain('Salão Horizonte')
    expect(mail.text).toContain('/painel/p1')
    expect(mail.text).not.toContain('/fornecedor/') // owner-facing, not the public page
  })

  it('tells the client their request was accepted, with a link to the public page', () => {
    const mail = render('booking_accepted', BOOKING_CONTEXT)
    expect(mail.text).toContain('/fornecedor/salao-horizonte')
  })

  it('formats the date in Africa/Luanda, not UTC', () => {
    // 2027-04-01T09:00:00Z is 10:00 in Luanda (UTC+1).
    const mail = render('booking_accepted', BOOKING_CONTEXT)
    expect(mail.text).toMatch(/10:00/)
  })

  it('produces two distinct mails for confirmation — client and provider', () => {
    const client = render('booking_confirmed', BOOKING_CONTEXT)
    const provider = render('booking_confirmed_provider', BOOKING_CONTEXT)
    expect(client.text).toContain('A sua reserva')
    expect(provider.text).toContain('Uma reserva para')
    expect(client.text).not.toBe(provider.text)
  })

  it('points a rejected client to search — the supplier already said no', () => {
    const mail = render('booking_rejected', BOOKING_CONTEXT)
    expect(mail.text).toContain('/procurar')
  })

  it('points an expired client back to the SAME supplier — worth retrying, not rejected', () => {
    const mail = render('booking_expired', BOOKING_CONTEXT)
    expect(mail.text).toContain('/fornecedor/salao-horizonte')
    expect(mail.text).not.toContain('/procurar')
  })

  it('renders every booking kind without throwing', () => {
    const kinds = [
      'booking_requested', 'booking_accepted', 'booking_awaiting_payment',
      'booking_confirmed', 'booking_confirmed_provider', 'booking_rejected',
      'booking_expired', 'booking_cancelled_client', 'booking_cancelled_provider',
      'booking_completed', 'booking_no_show',
    ]
    for (const kind of kinds) {
      const mail = render(kind, BOOKING_CONTEXT)
      expect(mail.subject.length).toBeGreaterThan(0)
      expect(mail.text.length).toBeGreaterThan(0)
    }
  })
})

describe('provider decision notifications', () => {
  it('includes the rejection reason when one was given', () => {
    const mail = render('provider_rejected', { ...PROVIDER_CONTEXT, reason: 'Documento ilegível.' })
    expect(mail.text).toContain('Documento ilegível.')
  })

  it('omits the reason line cleanly when none was given', () => {
    const mail = render('provider_rejected', { ...PROVIDER_CONTEXT, reason: null })
    expect(mail.text).not.toContain('Motivo:')
    expect(mail.text).not.toContain('null')
  })

  it('distinguishes a first verification from a reinstatement', () => {
    const verified = render('provider_verified', PROVIDER_CONTEXT)
    const reinstated = render('provider_reinstated', PROVIDER_CONTEXT)
    expect(verified.subject).not.toBe(reinstated.subject)
  })

  it('gives a suspended supplier a way to reach a human, not a dead end', () => {
    const mail = render('provider_suspended', { ...PROVIDER_CONTEXT, reason: 'Denúncias.' })
    expect(mail.text).toContain('fornecedores@ngueza.com')
  })

  it('links a verified supplier to their now-public page', () => {
    const mail = render('provider_verified', PROVIDER_CONTEXT)
    expect(mail.text).toContain('/fornecedor/salao-horizonte')
  })
})

describe('links use the configured site origin', () => {
  it('falls back sanely when nothing is configured', () => {
    const mail = render('booking_requested', BOOKING_CONTEXT)
    expect(mail.text).toContain('http://localhost:3000/painel/p1')
  })

  it('uses NEXT_PUBLIC_SITE_URL when set', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://ngueza.com'
    const mail = render('booking_requested', BOOKING_CONTEXT)
    expect(mail.text).toContain('https://ngueza.com/painel/p1')
  })
})
