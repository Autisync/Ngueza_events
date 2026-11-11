import { beforeEach, describe, expect, it } from 'vitest'
import { notificationPath, render } from '@/lib/notify'

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

describe('help requests (slice 35)', () => {
  it('quotes the person\'s own words to the team, with topic, reference and a link', () => {
    const mail = render('support_request_new', {
      topic: 'fraude', email: 'ana@exemplo.ao', booking_ref: '81A0F3C2',
      message: 'Pediram-me outra conta.\nCom pressa.',
    })
    expect(mail.subject).toBe('Pedido de ajuda — fraude · ref. 81A0F3C2')
    expect(mail.text).toContain('De: ana@exemplo.ao')
    expect(mail.text).toContain('> Pediram-me outra conta.\n> Com pressa.')
    expect(mail.text).toContain('/admin/apoio')
  })
})

describe('booking notifications', () => {
  it('tells the client how much to pay and how, when the supplier set terms (slice 31)', () => {
    const mail = render('booking_awaiting_payment', {
      ...BOOKING_CONTEXT, booking_id: 'b1',
      total_minor: 180000000, deposit_minor: '54000000', payment_instructions: 'IBAN AO06 0000',
    })
    expect(mail.text).toMatch(/Total acordado: 1\s800\s000,00\sKz/)
    expect(mail.text).toMatch(/Sinal a pagar agora: 540\s000,00\sKz/)
    expect(mail.text).toContain('Como pagar:\nIBAN AO06 0000')
    expect(mail.text).toContain('/reservas/b1')
  })

  it('falls back to "contact the supplier" for a booking with no terms', () => {
    const mail = render('booking_awaiting_payment', { ...BOOKING_CONTEXT, booking_id: 'b1' })
    expect(mail.text).toContain('Contacte o fornecedor')
    expect(mail.text).not.toContain('Total acordado')
  })

  it('tells a displaced client the date went to someone else, with the same-day search (0033)', () => {
    const mail = render('booking_unavailable', {
      ...BOOKING_CONTEXT, category_id: 'cat-1', location_id: 'loc-1',
      // 23:30 UTC is already the next day in Luanda (UTC+1).
      starts_at: '2027-04-01T23:30:00Z',
    })
    expect(mail.subject).toContain('Data indisponível')
    expect(mail.text).toContain('reservada por outro cliente')
    expect(mail.text).toContain('não tem nada a pagar')
    expect(mail.text).toContain('/procurar?data=2027-04-02&zona=loc-1&categoria=cat-1')
    expect(mail.text).not.toMatch(/expirou|rejeit/i)
  })

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

  it('says whose deadline passed when a booking expires', () => {
    const unanswered = render('booking_expired', { ...BOOKING_CONTEXT, from_status: 'requested' })
    expect(unanswered.text).toContain('sem resposta do fornecedor')
    const unpaid = render('booking_expired', { ...BOOKING_CONTEXT, from_status: 'awaiting_payment' })
    expect(unpaid.text).toContain('prazo para avançar com o pagamento')
    expect(unpaid.text).not.toContain('sem resposta do fornecedor')
  })

  it('renders every booking kind without throwing', () => {
    const kinds = [
      'booking_requested', 'booking_accepted', 'booking_awaiting_payment',
      'booking_confirmed', 'booking_confirmed_provider', 'booking_rejected',
      'booking_expired', 'booking_cancelled_client', 'booking_cancelled_provider',
      'booking_completed', 'booking_no_show', 'booking_payment_submitted', 'booking_released_provider',
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

const NBSP = ' '

describe('quote request notifications (slice 20)', () => {
  const REQUEST_CONTEXT = {
    quote_request_id: 'q1', category_name: 'Salões', location_name: 'Talatona',
    event_date: '2027-12-15', capacity: 80, description: 'Um espaço amplo e coberto, por favor.',
  }
  const OFFER_CONTEXT = {
    quote_request_id: 'q1', offer_id: 'o1', provider_name: 'Salão Horizonte',
    provider_slug: 'salao-horizonte', price_minor: 4500000, message: 'Temos disponibilidade.',
  }

  it('tells a matching supplier about a new request, without needing a provider_name', () => {
    const mail = render('quote_request_new', REQUEST_CONTEXT)
    expect(mail.subject).toContain('Salões')
    expect(mail.text).toContain('Talatona')
    expect(mail.text).toContain('80 pessoas')
    expect(mail.text).toContain('Um espaço amplo')
  })

  it('formats the event date in Africa/Luanda', () => {
    const mail = render('quote_request_new', REQUEST_CONTEXT)
    expect(mail.text).toMatch(/15 de dezembro/i)
  })

  it('omits the capacity line when none was given', () => {
    const mail = render('quote_request_new', { ...REQUEST_CONTEXT, capacity: null })
    expect(mail.text).not.toContain('Capacidade:')
  })

  it('tells the winning supplier their offer was accepted', () => {
    const mail = render('quote_offer_accepted', {
      quote_request_id: 'q', offer_id: 'o', provider_id: 'p1', provider_name: 'Salão X',
      price_minor: 18000000, event_date: '2026-12-15', category_name: 'Salões', location_name: 'Talatona',
    })
    expect(mail.subject).toContain('Proposta aceite')
    expect(mail.text).toContain('/painel/p1/reservas')
  })

  it('tells the requester about a new offer, with the price in Kz', () => {
    const mail = render('quote_offer_received', OFFER_CONTEXT)
    expect(mail.subject).toContain('Salão Horizonte')
    expect(mail.text).toContain(`45${NBSP}000,00${NBSP}Kz`)
    expect(mail.text).toContain('Temos disponibilidade.')
    expect(mail.text).toContain('/conta/pedidos')
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

describe('where a notification takes its reader (slice 36)', () => {
  const ctx = { booking_id: 'b1', provider_id: 'p1', provider_slug: 's', provider_name: 'X',
                starts_at: '2027-04-01T09:00:00Z', ends_at: '2027-04-01T20:00:00Z' }

  it('sends the supplier to the booking that needs them, not the dashboard', () => {
    for (const k of ['booking_requested', 'booking_payment_submitted', 'booking_cancelled_client',
                     'booking_confirmed_provider', 'booking_released_provider']) {
      expect(notificationPath(k, ctx)).toBe('/painel/p1/reservas/b1')
    }
  })

  it('sends the client to their own booking page', () => {
    for (const k of ['booking_accepted', 'booking_awaiting_payment', 'booking_confirmed',
                     'booking_rejected', 'booking_expired', 'booking_unavailable', 'booking_no_show']) {
      expect(notificationPath(k, ctx)).toBe('/reservas/b1')
    }
  })

  it('knows the non-booking kinds, and says null rather than guessing', () => {
    expect(notificationPath('provider_verified', ctx)).toBe('/painel/p1')
    expect(notificationPath('quote_offer_received', {})).toBe('/conta/pedidos')
    expect(notificationPath('quote_request_new', { provider_id: 'p1' })).toBe('/painel/p1/pedidos')
    expect(notificationPath('support_request_new', {})).toBe('/admin/apoio')
    expect(notificationPath('booking_requested', { provider_id: 'p1' })).toBeNull()
    expect(notificationPath('qualquer', ctx)).toBeNull()
  })

  it('puts the same link in the email', () => {
    expect(render('booking_requested', ctx).text).toContain('/painel/p1/reservas/b1')
    expect(render('booking_accepted', ctx).text).toContain('/reservas/b1')
    expect(render('booking_confirmed', ctx).text).toContain('/reservas/b1')
    expect(render('booking_payment_submitted', ctx).text).toContain('/painel/p1/reservas/b1')
  })
})

describe('the client\'s acknowledgement of a request (slice 41)', () => {
  it('says it is not yet a reservation, and links to the booking', () => {
    const mail = render('booking_requested_client', {
      booking_id: 'b9', provider_id: 'p1', provider_slug: 's', provider_name: 'Salão X',
      starts_at: '2027-04-01T09:00:00Z', ends_at: '2027-04-01T20:00:00Z',
    })
    expect(mail.subject).toBe('Pedido enviado — Salão X')
    expect(mail.text).toContain('Ainda não é uma reserva')
    expect(mail.text).toContain('/reservas/b9')
  })
})

describe('refund notifications (slice 47)', () => {
  const ctx = {
    booking_id: 'b0000000-0000-0000-0000-000000000001', provider_id: 'p0000000-0000-0000-0000-000000000001',
    provider_name: 'Salão Horizonte', provider_slug: 'salao-horizonte', starts_at: '2026-12-15T09:00:00+01:00',
    amount_minor: 45000000, method: 'multicaixa_express', reference: 'MX-123', client_note: 'Não chegou nada.',
  }

  it('tells the client the amount, how, and where to answer', () => {
    const m = render('refund_sent', ctx)
    expect(m.subject).toContain('Salão Horizonte')
    expect(m.text).toContain('Multicaixa Express (ref. MX-123)')
    expect(m.text).toContain(`/reservas/${ctx.booking_id}#devolucao`)
    expect(m.text).toContain('não guarda nem transfere dinheiro')
  })

  it("tells the supplier the client disputes it, quoting the client's words", () => {
    const m = render('refund_disputed', ctx)
    expect(m.text).toContain('> Não chegou nada.')
    expect(m.text).toContain(`/painel/${ctx.provider_id}/reservas/${ctx.booking_id}#devolucao`)
    expect(notificationPath('refund_disputed', ctx)).toBe(`/painel/${ctx.provider_id}/reservas/${ctx.booking_id}#devolucao`)
  })
})
