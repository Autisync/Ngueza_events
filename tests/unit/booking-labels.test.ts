import { describe, expect, it } from 'vitest'
import { datedTierSteps, nextStep, relativeTierSteps } from '@/lib/booking-labels'

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
