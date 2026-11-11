import { describe, expect, it } from 'vitest'
import { clampMonth, datedTierSteps, eventWindow, monthGrid, nextStep, relativeTierSteps } from '@/lib/booking-labels'

/**
 * Slice 32. The words must say exactly what compute_refund_pct() (0026)
 * will decide; tests/integration/cancellation-policy.test.ts checks the
 * dated cut-offs against the database itself.
 */

const TIERS = [{ daysBefore: 7, refundPct: 50 }, { daysBefore: 30, refundPct: 100 }]

describe('cancellation steps', () => {
  it('lists tiers from most notice to least, ending at nothing', () => {
    expect(relativeTierSteps(TIERS)).toEqual([
      { label: 'Com pelo menos 30 dias de antecedência', refundPct: 100 },
      { label: 'Com pelo menos 7 dias de antecedência', refundPct: 50 },
      { label: 'Com menos de 7 dias', refundPct: 0 },
    ])
  })

  it('does not add a "nothing" step when a tier already runs to the start', () => {
    expect(relativeTierSteps([{ daysBefore: 0, refundPct: 20 }, { daysBefore: 1, refundPct: 100 }]))
      .toEqual([
        { label: 'Com pelo menos 1 dia de antecedência', refundPct: 100 },
        { label: 'Até ao início do evento', refundPct: 20 },
      ])
  })

  it('drops a tier that pays the same as the one below it, without moving any boundary', () => {
    // The platform default: an explicit 0% tier at 7 days used to print "0%" twice.
    expect(relativeTierSteps([
      { daysBefore: 30, refundPct: 100 }, { daysBefore: 14, refundPct: 50 }, { daysBefore: 7, refundPct: 0 },
    ]).map((s) => [s.label, s.refundPct])).toEqual([
      ['Com pelo menos 30 dias de antecedência', 100],
      ['Com pelo menos 14 dias de antecedência', 50],
      ['Com menos de 14 dias', 0],
    ])
    // Two tiers paying 50%: the lower one already covers 20 days' notice.
    expect(relativeTierSteps([{ daysBefore: 30, refundPct: 50 }, { daysBefore: 14, refundPct: 50 }])
      .map((s) => [s.label, s.refundPct])).toEqual([
      ['Com pelo menos 14 dias de antecedência', 50],
      ['Com menos de 14 dias', 0],
    ])
  })

  it('dates each cut-off from the event start, in Luanda time, marking the ones gone by', () => {
    const steps = datedTierSteps(TIERS, '2027-12-15T09:00:00Z', new Date('2027-11-20T00:00:00Z'))
    expect(steps.map((s) => s.refundPct)).toEqual([100, 50, 0])
    // 30 days before 15 Dec 10:00 Luanda = 15 Nov 10:00 — already past on 20 Nov.
    expect(steps[0]!.label).toMatch(/^Até 15 de novembro de 2027,? às 10:00$/)
    expect(steps[0]!.past).toBe(true)
    expect(steps[1]!.label).toMatch(/^Até 8 de dezembro de 2027,? às 10:00$/)
    expect(steps[1]!.past).toBe(false)
    expect(steps[2]!.label).toMatch(/^Depois de 8 de dezembro de 2027/)
  })
})

describe('the next step on a booking', () => {
  const base = {
    providerName: 'Salão Horizonte', startsAt: '2027-12-15T09:00:00Z', expiresAt: '2027-11-22T11:00:00Z',
    proofSubmitted: false, dueNow: null, canReview: false, address: null,
  }

  it('asks a client with a payment request to pay a stated amount, by the real deadline', () => {
    const step = nextStep({ ...base, status: 'awaiting_payment', dueNow: '540 000,00 Kz' })
    expect(step?.tone).toBe('act')
    expect(step?.title).toBe('Pague 540 000,00 Kz e envie o comprovativo')
    expect(step?.detail).toMatch(/^Até 22 de novembro de 2027/)
    expect(step?.action?.href).toBe('#pagamento')
  })

  it('stops asking once a proof is in', () => {
    const step = nextStep({ ...base, status: 'awaiting_payment', proofSubmitted: true })
    expect(step?.tone).toBe('wait')
    expect(step?.action).toBeUndefined()
  })

  it('counts the days to a confirmed event, in Luanda', () => {
    const step = nextStep({ ...base, status: 'confirmed', address: 'Rua 1, Talatona' }, new Date('2027-12-12T23:30:00Z'))
    // 23:30 UTC on the 12th is already the 13th in Luanda: two days left.
    expect(step?.detail).toBe('Faltam 2 dias. Local: Rua 1, Talatona.')
    expect(step?.action?.href).toContain('maps/search/?api=1&query=Rua%201%2C%20Talatona')
  })

  it('offers the contact link only when the supplier published a number', () => {
    expect(nextStep({ ...base, status: 'accepted' })?.action).toBeUndefined()
    expect(nextStep({ ...base, status: 'accepted', canContact: true })?.action?.href).toBe('#contacto')
  })

  it('asks for a review only when one can be left, and says nothing on a closed booking', () => {
    expect(nextStep({ ...base, status: 'completed', canReview: true })?.action?.href).toBe('#avaliar')
    expect(nextStep({ ...base, status: 'completed' })).toBeNull()
    expect(nextStep({ ...base, status: 'rejected' })).toBeNull()
  })
})

/**
 * Slice 44. The month calendar is a plain grid computed on the server, so
 * the arithmetic has to be right on its own: Monday first, real month
 * lengths, and never a month in the past.
 */
describe('monthGrid', () => {
  it('starts on Monday: a month beginning on Sunday has six blanks', () => {
    // 1 November 2026 is a Sunday.
    expect(monthGrid('2026-11')).toMatchObject({ first: '2026-11-01', days: 30, leading: 6 })
  })
  it('a month beginning on Monday has none', () => {
    // 1 June 2026 is a Monday.
    expect(monthGrid('2026-06').leading).toBe(0)
  })
  it('knows February in a leap year', () => {
    expect(monthGrid('2028-02').days).toBe(29)
    expect(monthGrid('2027-02').days).toBe(28)
  })
  it('crosses the year both ways, and names the month in Portuguese', () => {
    expect(monthGrid('2026-12')).toMatchObject({ next: '2027-01', label: 'dezembro de 2026' })
    expect(monthGrid('2027-01').prev).toBe('2026-12')
  })
})

describe('clampMonth', () => {
  it('defaults to the current month for missing or malformed input', () => {
    expect(clampMonth(undefined, '2026-11')).toBe('2026-11')
    expect(clampMonth('2026-13', '2026-11')).toBe('2026-11')
    expect(clampMonth('nov', '2026-11')).toBe('2026-11')
  })
  it('never shows the past, and stops 18 months ahead', () => {
    expect(clampMonth('2026-01', '2026-11')).toBe('2026-11')
    expect(clampMonth('2027-03', '2026-11')).toBe('2027-03')
    expect(clampMonth('2030-01', '2026-11')).toBe('2028-05')
  })
})

describe('eventWindow', () => {
  const hours = (w: { startsAt: Date; endsAt: Date } | null) =>
    w ? (w.endsAt.getTime() - w.startsAt.getTime()) / 3600_000 : null

  it('a party past midnight ends the next day', () => {
    expect(hours(eventWindow('2026-12-15', '20:00', '02:00'))).toBe(6)
  })
  it('is Luanda time', () => {
    expect(eventWindow('2026-12-15', '09:00', '12:00')?.startsAt.toISOString()).toBe('2026-12-15T08:00:00.000Z')
  })
  it('spans two days with an end date', () => {
    expect(hours(eventWindow('2026-12-15', '09:00', '18:00', '2026-12-16'))).toBe(33)
  })
  it('an end date equal to the start is a single day', () => {
    expect(hours(eventWindow('2026-12-15', '09:00', '18:00', '2026-12-15'))).toBe(9)
  })
  it('refuses an end date before the start, a missing day, or more than a week', () => {
    expect(eventWindow('2026-12-15', '09:00', '18:00', '2026-12-14')).toBeNull()
    expect(eventWindow('2026-12-15', '09:00', '18:00', '2026-02-30')).toBeNull()
    expect(eventWindow('2026-02-30', '09:00', '18:00')).toBeNull()
    expect(eventWindow('2026-12-15', '09:00', '18:00', '2026-12-23')).toBeNull()
    expect(eventWindow('2026-12-15', '09:00', '09:00', '2026-12-22')).not.toBeNull()
  })
})

describe('the client list (slice 48)', () => {
  const now = new Date('2026-11-11T12:00:00Z')
  const B = (id: string, status: string, start: string) =>
    ({ id, status, startsAt: `${start}T09:00:00+01:00`, endsAt: `${start}T22:00:00+01:00` })

  it('puts payment due first, then upcoming soonest first, then the past newest first', async () => {
    const { groupClientBookings } = await import('@/lib/booking-labels')
    const g = groupClientBookings([
      B('a', 'confirmed', '2026-12-20'), B('b', 'awaiting_payment', '2026-12-01'),
      B('c', 'requested', '2026-11-20'), B('d', 'completed', '2026-10-01'),
      B('e', 'cancelled_provider', '2026-12-05'), B('f', 'confirmed', '2026-09-01'),
    ], now)
    expect(g.action.map((b) => b.id)).toEqual(['b'])
    expect(g.upcoming.map((b) => b.id)).toEqual(['c', 'a'])
    // A cancelled future date and a confirmed past date are both "past".
    expect(g.past.map((b) => b.id)).toEqual(['e', 'd', 'f'])
  })

  it('counts days in Luanda, and says today and tomorrow in words', async () => {
    const { listHint, dateTile } = await import('@/lib/booking-labels')
    expect(listHint(B('x', 'confirmed', '2026-11-11'), now)).toBe('É hoje')
    expect(listHint(B('x', 'confirmed', '2026-11-12'), now)).toBe('Amanhã')
    expect(listHint(B('x', 'confirmed', '2026-11-21'), now)).toBe('Daqui a 10 dias')
    expect(listHint(B('x', 'requested', '2026-11-21'), now)).toBe('À espera da resposta do fornecedor')
    expect(dateTile('2026-12-15T00:30:00+01:00')).toEqual({ day: '15', month: 'dez' })
  })
})
