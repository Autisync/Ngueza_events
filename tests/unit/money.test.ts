import { describe, expect, it } from 'vitest'
import { formatMinor, formatPrice, parseMajor, priceTransparencyScore } from '@/lib/money'

const NBSP = ' '

describe('parseMajor', () => {
  it('reads pt-AO formatting', () => {
    expect(parseMajor('2.000.000,50')).toBe(200000050n)
    expect(parseMajor('1.500')).toBe(150000n)
    expect(parseMajor('0,05')).toBe(5n)
  })

  it('keeps precision a float would lose', () => {
    // 0.1 + 0.2 !== 0.3 is exactly why prices are never floats.
    expect(parseMajor('0,10') + parseMajor('0,20')).toBe(parseMajor('0,30'))
  })

  it('refuses anything that is not an amount', () => {
    for (const bad of ['', 'grátis', '1,234', '2.000.000,555', '12abc']) {
      expect(() => parseMajor(bad)).toThrow()
    }
  })
})

describe('formatMinor', () => {
  it('groups thousands and keeps cêntimos', () => {
    expect(formatMinor(200000050n)).toBe(`2${NBSP}000${NBSP}000,50${NBSP}Kz`)
    expect(formatMinor(0n)).toBe(`0,00${NBSP}Kz`)
  })

  it('drops trailing cêntimos when compact and exact', () => {
    expect(formatMinor(18000000n, { compact: true })).toBe(`180${NBSP}000${NBSP}Kz`)
    expect(formatMinor(18000050n, { compact: true })).toBe(`180${NBSP}000,50${NBSP}Kz`)
  })

  it('round-trips through parseMajor', () => {
    for (const v of ['180.000', '2.000.000,50', '0,05', '95.000']) {
      expect(formatMinor(parseMajor(v))).toContain(v.split(',')[0]!.replace(/\./g, NBSP))
    }
  })
})

describe('formatPrice', () => {
  it('renders every mode in the spectrum', () => {
    expect(formatPrice({ mode: 'exact', minor: 18000000n })).toBe(`180${NBSP}000${NBSP}Kz`)
    expect(formatPrice({ mode: 'from', minor: 9500000n })).toBe(`desde 95${NBSP}000${NBSP}Kz`)
    expect(formatPrice({ mode: 'range', minor: 35000000n, maxMinor: 62000000n }))
      .toBe(`350${NBSP}000${NBSP}Kz – 620${NBSP}000${NBSP}Kz`)
    expect(formatPrice({ mode: 'on_request' })).toBe('Sob consulta')
  })
})

describe('priceTransparencyScore', () => {
  it('ranks concrete pricing above negotiation', () => {
    expect(priceTransparencyScore({ mode: 'exact', minor: 1n }))
      .toBeGreaterThan(priceTransparencyScore({ mode: 'range', minor: 1n, maxMinor: 2n }))
    expect(priceTransparencyScore({ mode: 'from', minor: 1n }))
      .toBeGreaterThan(priceTransparencyScore({ mode: 'on_request' }))
  })
})
